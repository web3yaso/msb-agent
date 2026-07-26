import type { ModuleId } from "../schemas/index.js";

export const DISCLAIMER =
  "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。";

export const AGENT_NAME = "MSB Compliance Module Service";
export const AGENT_SHORT_DESCRIPTION =
  "四法域（US / UK / EU / SG）跨境汇款 MSB 监管合规检查项状态 API：确定性规则引擎，" +
  "每条规则带法源引用，按次 x402 收费（Arc Testnet USDC）。" +
  DISCLAIMER;
export const AGENT_CATEGORY = "compliance";
export const AGENT_TAGS = [
  "compliance",
  "msb",
  "kyc-aml",
  "x402",
  "regtech",
  "cross-border-payments",
] as const;
export const AGENT_IMAGE_PATH = "/static/agent-icon.png";
export const AGENT_DOCS_PATH = "/";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const EU_MEMBER_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

export const MODULE_JURISDICTIONS: Record<ModuleId, string> = {
  "us-msb": "United States",
  "uk-msb": "United Kingdom",
  "eu-msb": "European Union",
  "sg-msb": "Singapore",
};

export const MODULE_PAY_TO_ENV: Record<ModuleId, string> = {
  "us-msb": "US_MSB_PAY_TO",
  "uk-msb": "UK_MSB_PAY_TO",
  "eu-msb": "EU_MSB_PAY_TO",
  "sg-msb": "SG_MSB_PAY_TO",
};

export const MODULE_PRICE_ENV: Record<ModuleId, string> = {
  "us-msb": "US_MSB_PRICE_USDC",
  "uk-msb": "UK_MSB_PRICE_USDC",
  "eu-msb": "EU_MSB_PRICE_USDC",
  "sg-msb": "SG_MSB_PRICE_USDC",
};

export const MODULE_MAINTAINER_WALLET_ENV: Record<ModuleId, string> = {
  "us-msb": "US_MSB_MAINTAINER_WALLET",
  "uk-msb": "UK_MSB_MAINTAINER_WALLET",
  "eu-msb": "EU_MSB_MAINTAINER_WALLET",
  "sg-msb": "SG_MSB_MAINTAINER_WALLET",
};

export const MODULE_ROYALTY_BPS_ENV: Record<ModuleId, string> = {
  "us-msb": "US_MSB_ROYALTY_BPS",
  "uk-msb": "UK_MSB_ROYALTY_BPS",
  "eu-msb": "EU_MSB_ROYALTY_BPS",
  "sg-msb": "SG_MSB_ROYALTY_BPS",
};

export const MODULE_DEFAULT_PRICE_USDC: Record<ModuleId, string> = {
  "us-msb": "0.800000",
  "uk-msb": "0.400000",
  "eu-msb": "0.600000",
  "sg-msb": "0.200000",
};
