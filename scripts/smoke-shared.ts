import { ModuleIdSchema, type ModuleId } from "../src/schemas/index.js";

export const DEFAULT_DEPOSIT_USDC = "1.50";
export const MINIMUM_GATEWAY_BALANCE = 1_050_000n;
export const DEPOSIT_POLL_INTERVAL_MS = 15_000;
export const DEPOSIT_POLL_MAX_ATTEMPTS = 24;

export const SMOKE_DEAL_INPUT = {
  deal_id: "arc-testnet-smoke",
  parties: [
    { role: "payer", country: "US", state: "NY" },
    { role: "payee", country: "SG" },
    { role: "payee", country: "GB" },
    { role: "payee", country: "DE" },
    { role: "payee", country: "AE" },
  ],
  activity: "money_transmission",
  amount_usdc: 10_000,
  monthly_volume_usdc: 3_000_000,
  evidence: {},
};

export function getSmokeModule(rawModule = process.env.SMOKE_MODULE ?? "us-msb"): ModuleId {
  const parsedModule = ModuleIdSchema.safeParse(rawModule);
  if (!parsedModule.success) {
    throw new Error(`SMOKE_MODULE 非法：${rawModule}`);
  }
  return parsedModule.data;
}

export function getClientPrivateKey(
  rawValue = process.env.X402_SMOKE_CLIENT_PRIVATE_KEY,
): `0x${string}` {
  const rawPrivateKey = rawValue?.trim();
  const privateKey =
    rawPrivateKey !== undefined && !rawPrivateKey.startsWith("0x")
      ? `0x${rawPrivateKey}`
      : rawPrivateKey;
  if (privateKey === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("X402_SMOKE_CLIENT_PRIVATE_KEY 缺失或不是 32 字节十六进制私钥");
  }
  return privateKey as `0x${string}`;
}

export function getDepositAmount(configuredAmount = process.env.SMOKE_DEPOSIT_USDC): string {
  const trimmedAmount = configuredAmount?.trim();
  const amount =
    trimmedAmount === undefined || trimmedAmount === "" ? DEFAULT_DEPOSIT_USDC : trimmedAmount;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error(`SMOKE_DEPOSIT_USDC 必须是正数且最多 6 位小数：${amount}`);
  }
  return amount;
}

export function parseDepositAmountAtomic(amount: string): bigint {
  const [wholeAmount = "0", fractionalAmount = ""] = amount.split(".");
  return BigInt(`${wholeAmount}${fractionalAmount.padEnd(6, "0")}`);
}

export function getForceDeposit(rawValue = process.env.SMOKE_FORCE_DEPOSIT ?? "0"): boolean {
  const normalizedValue = rawValue.trim().toLowerCase();
  if (!["0", "1", "false", "true"].includes(normalizedValue)) {
    throw new Error("SMOKE_FORCE_DEPOSIT 只接受 0、1、false 或 true");
  }
  return normalizedValue === "1" || normalizedValue === "true";
}

export function getPublicSmokeBaseUrl(
  rawValue = process.env.SMOKE_BASE_URL ?? "https://msb-agent-production-769d.up.railway.app",
): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throw new Error(`SMOKE_BASE_URL 不是合法 URL：${rawValue}`);
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error(`SMOKE_BASE_URL 必须使用 HTTPS：${rawValue}`);
  }
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "");
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString().replace(/\/$/, "");
}

export function getSafeErrorMessage(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : "未知错误";
  if (secret === undefined || secret === "") {
    return message;
  }
  const secretVariants = secret.startsWith("0x") ? [secret, secret.slice(2)] : [secret];
  return secretVariants.reduce(
    (safeMessage, secretVariant) => safeMessage.replaceAll(secretVariant, "[REDACTED]"),
    message,
  );
}
