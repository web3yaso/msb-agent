import { createPublicClient, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const IDENTITY_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
] as const;

function requireValue(name: string, fallback?: string): string {
  const configuredValue = process.env[name]?.trim();
  const value = configuredValue === "" ? fallback : (configuredValue ?? fallback);
  if (value === undefined || value === "") throw new Error(`配置缺失：${name}`);
  return value;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${String(response.status)}`);
  return (await response.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const rawAgentId = requireValue("ERC8004_AGENT_ID");
  if (!/^\d+$/.test(rawAgentId)) throw new Error("非法 ERC8004_AGENT_ID");
  const agentId = BigInt(rawAgentId);
  const rawRegistry = requireValue("ERC8004_IDENTITY_REGISTRY");
  if (!isAddress(rawRegistry)) throw new Error("非法 ERC8004_IDENTITY_REGISTRY");
  const registry = rawRegistry;
  const agentCardUrl = requireValue("AGENT_CARD_URL");
  const publicBaseUrl = requireValue("PUBLIC_BASE_URL").replace(/\/+$/, "");
  const agentCardParsedUrl = new URL(agentCardUrl);
  const publicBaseParsedUrl = new URL(publicBaseUrl);
  if (
    (agentCardParsedUrl.protocol !== "https:" &&
      !(agentCardParsedUrl.protocol === "http:" && agentCardParsedUrl.hostname === "localhost")) ||
    (publicBaseParsedUrl.protocol !== "https:" &&
      !(publicBaseParsedUrl.protocol === "http:" && publicBaseParsedUrl.hostname === "localhost"))
  ) {
    throw new Error("agentURI 与公网 URL 必须使用 HTTPS（localhost 可使用 HTTP）");
  }
  const configuredOwner = process.env.ERC8004_REGISTRAR_ADDRESS?.trim();
  let expectedOwner: `0x${string}`;
  if (configuredOwner !== undefined && configuredOwner !== "") {
    if (!isAddress(configuredOwner)) throw new Error("非法 ERC8004_REGISTRAR_ADDRESS");
    expectedOwner = configuredOwner;
  } else {
    const privateKey = requireValue("ERC8004_REGISTRAR_PRIVATE_KEY");
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new Error("非法 ERC8004_REGISTRAR_PRIVATE_KEY");
    }
    expectedOwner = privateKeyToAccount(privateKey as Hex).address;
  }
  const client = createPublicClient({
    transport: http(requireValue("ERC8004_RPC_URL", "https://rpc.testnet.arc.network")),
  });
  const [owner, tokenUri, card, registration] = await Promise.all([
    client.readContract({
      address: registry,
      abi: IDENTITY_ABI,
      functionName: "ownerOf",
      args: [agentId],
    }),
    client.readContract({
      address: registry,
      abi: IDENTITY_ABI,
      functionName: "tokenURI",
      args: [agentId],
    }),
    fetchJson(agentCardUrl),
    fetchJson(`${publicBaseUrl}/.well-known/agent-registration.json`),
  ]);
  const cardRegistrations = card.registrations as { agentId?: number }[] | undefined;
  const domainRegistrations = registration.registrations as { agentId?: number }[] | undefined;
  const tokenUriUrl = new URL(tokenUri);
  if (
    tokenUriUrl.protocol !== "https:" &&
    !(tokenUriUrl.protocol === "http:" && tokenUriUrl.hostname === "localhost")
  ) {
    throw new Error("链上 agentURI 必须使用 HTTPS（localhost 可使用 HTTP）");
  }
  const checks = [
    ["ownerOf 等于注册钱包", owner.toLowerCase() === expectedOwner.toLowerCase()],
    ["tokenURI 等于 AGENT_CARD_URL", tokenUri === agentCardUrl],
    [
      "card registration agentId 与链上一致",
      cardRegistrations?.[0]?.agentId === Number(agentId) &&
        domainRegistrations?.[0]?.agentId === Number(agentId),
    ],
    ["card 含 disclaimer", typeof card.disclaimer === "string"],
  ] as const;
  let hasFailure = false;
  for (const [label, passed] of checks) {
    process.stdout.write(`${passed ? "PASS" : "FAIL"} ${label}\n`);
    hasFailure ||= !passed;
  }
  if (hasFailure) throw new Error("链上闭环校验未全部通过");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "未知错误";
  process.stderr.write(`ERC-8004 校验失败：${message}\n`);
  process.exitCode = 1;
});
