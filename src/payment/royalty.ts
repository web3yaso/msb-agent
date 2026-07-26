import {
  MODULE_MAINTAINER_WALLET_ENV,
  MODULE_ROYALTY_BPS_ENV,
  ZERO_ADDRESS,
} from "../http/constants.js";
import {
  EVM_ADDRESS_PATTERN,
  ModuleIdSchema,
  RoyaltyBpsSchema,
  type ModuleId,
} from "../schemas/index.js";
import type { PaymentMode } from "./config.js";

export interface ModuleRoyaltyConfig {
  maintainerWallet: `0x${string}`;
  royaltyBps: number;
}

function resolveEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  moduleVariableName: string,
  globalVariableName: string,
): { value: string | undefined; variableName: string } {
  const moduleValue = environment[moduleVariableName]?.trim();
  if (moduleValue !== undefined && moduleValue !== "") {
    return { value: moduleValue, variableName: moduleVariableName };
  }
  const globalValue = environment[globalVariableName]?.trim();
  return {
    value: globalValue === "" ? undefined : globalValue,
    variableName: globalVariableName,
  };
}

/**
 * 解析每模块版税配置：全局变量 + 每模块可选覆盖；x402 模式下维护者钱包必填。
 */
export function loadRoyaltyConfig(
  environment: NodeJS.ProcessEnv,
  mode: PaymentMode,
): Record<ModuleId, ModuleRoyaltyConfig> {
  return Object.fromEntries(
    ModuleIdSchema.options.map((moduleId) => {
      const walletConfig = resolveEnvironmentValue(
        environment,
        MODULE_MAINTAINER_WALLET_ENV[moduleId],
        "MODULE_MAINTAINER_WALLET",
      );
      if (walletConfig.value === undefined && mode !== "off") {
        throw new Error("支付配置缺失：MODULE_MAINTAINER_WALLET");
      }
      if (walletConfig.value !== undefined && !EVM_ADDRESS_PATTERN.test(walletConfig.value)) {
        throw new Error(`非法维护者钱包地址：${walletConfig.variableName}`);
      }
      const maintainerWallet = (walletConfig.value ?? ZERO_ADDRESS) as `0x${string}`;

      const royaltyConfig = resolveEnvironmentValue(
        environment,
        MODULE_ROYALTY_BPS_ENV[moduleId],
        "MODULE_ROYALTY_BPS",
      );
      const rawRoyaltyBps = royaltyConfig.value ?? "0";
      if (!/^\d{1,5}$/.test(rawRoyaltyBps)) {
        throw new Error(`非法版税基点：${royaltyConfig.variableName}`);
      }
      const royaltyBps = Number(rawRoyaltyBps);
      if (!RoyaltyBpsSchema.safeParse(royaltyBps).success) {
        throw new Error(`非法版税基点：${royaltyConfig.variableName}`);
      }
      if (royaltyBps > 0 && maintainerWallet === ZERO_ADDRESS) {
        throw new Error("配置了版税基点但维护者钱包为零地址");
      }

      return [moduleId, { maintainerWallet, royaltyBps }];
    }),
  ) as Record<ModuleId, ModuleRoyaltyConfig>;
}
