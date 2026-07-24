import { z } from "zod";

export const ActivitySchema = z.enum([
  "money_transmission",
  "currency_exchange",
  "stored_value",
  "crypto_transfer",
  "check_cashing",
]);

export const CheckStatusSchema = z.enum(["PASS", "HOLD", "ESCALATE"]);

export const ModuleIdSchema = z.enum(["us-msb", "uk-msb", "eu-msb", "sg-msb"]);

export const PartyRoleSchema = z.enum(["payer", "payee"]);

export const CountryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

export const UtcDateTimeSchema = z.iso.datetime({ offset: false });

export const ModuleVersionSchema = z.string().regex(/^\d{4}\.\d{2}\.\d+$/);

export const EvidenceHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export type Activity = z.infer<typeof ActivitySchema>;
export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type ModuleId = z.infer<typeof ModuleIdSchema>;
export type PartyRole = z.infer<typeof PartyRoleSchema>;
