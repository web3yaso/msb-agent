import type { ModuleId } from "../schemas/index.js";

export const DISCLAIMER =
  "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。";

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
