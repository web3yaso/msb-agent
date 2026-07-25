import type { ModuleId } from "../schemas/index.js";
import { MODULE_PAY_TO_ENV, MODULE_PRICE_ENV } from "../http/constants.js";

export const PAYMENT_MODES = ["off", "x402-base-sepolia", "x402-arc-testnet"] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface ModulePaymentConfig {
  payTo: `0x${string}`;
  priceAtomic: string;
  priceUsdc: string;
}

export interface PaymentConfig {
  facilitatorUrl?: string;
  mode: PaymentMode;
  modules: Partial<Record<ModuleId, ModulePaymentConfig>>;
  network?: "base-sepolia" | "arc-testnet";
}

const DEFAULT_PAYMENT_MODE: PaymentMode = "x402-arc-testnet";
const DEFAULT_PRICE_USDC = "1.000000";
const MAX_PRICE_ATOMIC = 100_000_000n;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function requireEnvironmentValue(environment: NodeJS.ProcessEnv, variableName: string): string {
  const value = environment[variableName]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`支付配置缺失：${variableName}`);
  }
  return value;
}

/**
 * 将最多六位小数的 USDC 配置转换为规范小数字符串和原子单位。
 */
export function parseUsdcPrice(rawPrice: string): {
  priceAtomic: string;
  priceUsdc: string;
} {
  const matchedPrice = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(rawPrice.trim());
  if (matchedPrice === null) {
    throw new Error(`非法 USDC 价格：${rawPrice}`);
  }

  const wholePart = BigInt(matchedPrice[1]);
  const fractionalPart = (matchedPrice.at(2) ?? "").padEnd(6, "0");
  const atomicAmount = wholePart * 1_000_000n + BigInt(fractionalPart);
  if (atomicAmount <= 0n || atomicAmount > MAX_PRICE_ATOMIC) {
    throw new Error(`USDC 价格必须大于 0 且不超过 100：${rawPrice}`);
  }

  return {
    priceAtomic: atomicAmount.toString(),
    priceUsdc: `${wholePart.toString()}.${fractionalPart}`,
  };
}

function parseFacilitatorUrl(rawUrl: string): string {
  const facilitatorUrl = new URL(rawUrl);
  if (facilitatorUrl.protocol !== "https:" && facilitatorUrl.protocol !== "http:") {
    throw new Error("facilitator URL 必须使用 HTTP(S)");
  }
  return facilitatorUrl.toString().replace(/\/$/, "");
}

/**
 * 解析并完整校验启动支付配置；付费模式配置不完整时立即失败。
 */
export function loadPaymentConfig(environment: NodeJS.ProcessEnv = process.env): PaymentConfig {
  const rawMode = environment.PAYMENT_MODE?.trim() ?? DEFAULT_PAYMENT_MODE;
  if (!PAYMENT_MODES.some((mode) => mode === rawMode)) {
    throw new Error(`不支持的 PAYMENT_MODE：${rawMode}`);
  }
  const mode = rawMode as PaymentMode;
  if (mode === "off") {
    return { mode, modules: {} };
  }

  const isArc = mode === "x402-arc-testnet";
  const facilitatorVariable = isArc
    ? "X402_ARC_TESTNET_FACILITATOR_URL"
    : "X402_BASE_SEPOLIA_FACILITATOR_URL";
  const moduleIds = Object.keys(MODULE_PAY_TO_ENV) as ModuleId[];
  const modules = Object.fromEntries(
    moduleIds.map((moduleId) => {
      const payTo = requireEnvironmentValue(environment, MODULE_PAY_TO_ENV[moduleId]);
      if (!EVM_ADDRESS_PATTERN.test(payTo)) {
        throw new Error(`非法收款地址：${MODULE_PAY_TO_ENV[moduleId]}`);
      }
      const price = parseUsdcPrice(environment[MODULE_PRICE_ENV[moduleId]] ?? DEFAULT_PRICE_USDC);
      return [moduleId, { payTo: payTo as `0x${string}`, ...price }];
    }),
  ) as Record<ModuleId, ModulePaymentConfig>;

  return {
    facilitatorUrl: parseFacilitatorUrl(requireEnvironmentValue(environment, facilitatorVariable)),
    mode,
    modules,
    network: isArc ? "arc-testnet" : "base-sepolia",
  };
}
