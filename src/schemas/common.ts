import { z } from "zod";

export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const EvmAddressSchema = z.string().regex(EVM_ADDRESS_PATTERN);

export const RoyaltyBpsSchema = z.number().int().min(0).max(10_000);

export const ActivitySchema = z.enum([
  "money_transmission",
  "currency_exchange",
  "stored_value",
  "crypto_transfer",
  "check_cashing",
]);

export const CheckStatusSchema = z.enum(["PASS", "HOLD", "ESCALATE", "NOT_APPLICABLE"]);

export const CheckBasisSchema = z.enum([
  "not_applicable",
  "caller_assertion",
  "missing_evidence",
  "deterministic_threshold",
  "insufficient_aggregate_data",
  "manual_review",
]);

export const EngineVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const EvidenceHashSchemeVersionSchema = z.string().regex(/^\d+$/);

export const ModuleIdSchema = z.enum(["us-msb", "uk-msb", "eu-msb", "sg-msb", "ae-msb"]);

export const PartyRoleSchema = z.enum(["payer", "payee"]);

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

export const UtcDateTimeSchema = z.iso.datetime({ offset: false });

export const ModuleVersionSchema = z.string().regex(/^\d{4}\.\d{2}\.\d+$/);

export const EvidenceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export type Activity = z.infer<typeof ActivitySchema>;
export type CheckBasis = z.infer<typeof CheckBasisSchema>;
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type ModuleId = z.infer<typeof ModuleIdSchema>;
export type PartyRole = z.infer<typeof PartyRoleSchema>;
