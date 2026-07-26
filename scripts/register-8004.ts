import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEFAULT_RPC_URL = "https://rpc.testnet.arc.network";
const DEFAULT_CHAIN_ID = 5_042_002;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
const IDENTITY_ABI = [
  {
    type: "function",
    name: "supportsInterface",
    stateMutability: "view",
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "setAgentURI",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "newURI", type: "string" },
    ],
    outputs: [],
  },
] as const;
const TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" },
    ],
  },
] as const;

function requireValue(name: string, fallback?: string): string {
  const configuredValue = process.env[name]?.trim();
  const value = configuredValue === "" ? fallback : (configuredValue ?? fallback);
  if (value === undefined || value === "") throw new Error(`配置缺失：${name}`);
  return value;
}

function parsePrivateKey(isRequired: boolean): Hex | undefined {
  const value = process.env.ERC8004_REGISTRAR_PRIVATE_KEY?.trim();
  if (value === undefined || value === "") {
    if (isRequired) throw new Error("配置缺失：ERC8004_REGISTRAR_PRIVATE_KEY");
    return undefined;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("非法配置：ERC8004_REGISTRAR_PRIVATE_KEY");
  }
  return value as Hex;
}

async function fetchAgentCard(agentCardUrl: string): Promise<void> {
  const parsedUrl = new URL(agentCardUrl);
  if (parsedUrl.protocol !== "https:") throw new Error("AGENT_CARD_URL 必须使用 HTTPS");
  const response = await fetch(parsedUrl);
  if (!response.ok) {
    throw new Error(`AGENT_CARD_URL 返回 HTTP ${String(response.status)}`);
  }
  if (!response.headers.get("content-type")?.includes("json")) {
    throw new Error("AGENT_CARD_URL content-type 不是 JSON");
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (body.type !== REGISTRATION_TYPE || typeof body.disclaimer !== "string") {
    throw new Error("AGENT_CARD_URL 缺少 registration-v1 type 或 disclaimer");
  }
}

async function main(): Promise<void> {
  const isConfirm = process.argv.includes("--confirm");
  const isUpdateUri = process.argv.includes("--update-uri");
  const rpcUrl = requireValue("ERC8004_RPC_URL", DEFAULT_RPC_URL);
  const registryValue = requireValue("ERC8004_IDENTITY_REGISTRY");
  if (!isAddress(registryValue)) throw new Error("非法配置：ERC8004_IDENTITY_REGISTRY");
  const registry = registryValue;
  const agentCardUrl = requireValue("AGENT_CARD_URL");
  const privateKey = parsePrivateKey(isConfirm);
  const account = privateKey === undefined ? undefined : privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ transport });

  const actualChainId = await publicClient.getChainId();
  if (actualChainId !== DEFAULT_CHAIN_ID) {
    throw new Error(
      `链 ID 不匹配：代码预期 ${String(DEFAULT_CHAIN_ID)}，RPC 实测 ${String(actualChainId)}`,
    );
  }
  const code = await publicClient.getCode({ address: registry });
  if (code === undefined || code === "0x") {
    throw new Error("Identity Registry 地址无合约；按设计 §3.2 预案 C 降级");
  }
  const [supportsErc721, name, symbol] = await Promise.all([
    publicClient.readContract({
      address: registry,
      abi: IDENTITY_ABI,
      functionName: "supportsInterface",
      args: ["0x80ac58cd"],
    }),
    publicClient.readContract({ address: registry, abi: IDENTITY_ABI, functionName: "name" }),
    publicClient.readContract({ address: registry, abi: IDENTITY_ABI, functionName: "symbol" }),
  ]);
  if (!supportsErc721) throw new Error("目标合约不支持 ERC-721 接口；按预案 C 降级");
  await fetchAgentCard(agentCardUrl);

  process.stdout.write(
    `chainId=${String(actualChainId)}\ncodeBytes=${String((code.length - 2) / 2)}\nname=${name}\nsymbol=${symbol}\n`,
  );
  if (account !== undefined) {
    const balance = await publicClient.getBalance({ address: account.address });
    process.stdout.write(`registrar=${account.address}\nbalance_usdc=${formatUnits(balance, 6)}\n`);
    if (balance === 0n) process.stdout.write("余额为 0：https://faucet.circle.com\n");
  } else {
    process.stdout.write("registrar=未配置（dry-run 只读探测不要求私钥）\n");
  }

  const agentIdValue = process.env.ERC8004_AGENT_ID?.trim();
  if (isUpdateUri && (agentIdValue === undefined || !/^\d+$/.test(agentIdValue))) {
    throw new Error("--update-uri 需要 ERC8004_AGENT_ID");
  }
  const functionName = isUpdateUri ? "setAgentURI" : "register";
  const args = isUpdateUri
    ? ([BigInt(agentIdValue ?? "0"), agentCardUrl] as const)
    : ([agentCardUrl] as const);
  const calldata = encodeFunctionData({
    abi: IDENTITY_ABI,
    functionName,
    args,
  });
  process.stdout.write(`mode=${isConfirm ? "confirm" : "dry-run"}\ncalldata=${calldata}\n`);
  if (!isConfirm || account === undefined) return;

  const gas = await publicClient.estimateContractGas({
    account,
    address: registry,
    abi: IDENTITY_ABI,
    functionName,
    args,
  });
  process.stdout.write(`estimatedGas=${String(gas)}\n`);
  const walletClient = createWalletClient({ account, transport });
  const hash = await walletClient.writeContract({
    account,
    address: registry,
    abi: IDENTITY_ABI,
    functionName,
    args,
    chain: null,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  process.stdout.write(`txHash=${hash}\nhttps://testnet.arcscan.app/tx/${hash}\n`);
  if (!isUpdateUri) {
    const transfer = receipt.logs
      .filter((log) => log.address.toLowerCase() === registry.toLowerCase())
      .map((log) => {
        try {
          return decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: log.topics });
        } catch {
          return undefined;
        }
      })
      .find(
        (event) =>
          event?.eventName === "Transfer" && event.args.from.toLowerCase() === ZERO_ADDRESS,
      );
    if (transfer === undefined) throw new Error("交易成功但未找到铸造 Transfer 日志");
    process.stdout.write(
      `agentId=${String(transfer.args.tokenId)}\n下一步设置 ERC8004_AGENT_ID=${String(transfer.args.tokenId)}\n`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "未知错误";
  process.stderr.write(`ERC-8004 注册失败：${message}\n`);
  process.exitCode = 1;
});
