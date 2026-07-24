import { z } from "zod";

import {
  ActivitySchema,
  CountryCodeSchema,
  ModuleIdSchema,
  ModuleVersionSchema,
  PartyRoleSchema,
  UtcDateTimeSchema,
} from "./common.js";

const RoleScopedCountrySchema = z.strictObject({
  role: PartyRoleSchema,
  country: CountryCodeSchema,
});

const RoleScopedStateSchema = z.strictObject({
  role: PartyRoleSchema,
  state: z.string().min(1),
});

export const RuleWhenSchema = z.strictObject({
  activity: z.array(ActivitySchema).min(1).optional(),
  party_country: z.union([CountryCodeSchema, RoleScopedCountrySchema]).optional(),
  party_state: z.union([z.string().min(1), RoleScopedStateSchema]).optional(),
  amount_gte: z.number().nonnegative().optional(),
  monthly_volume_gte: z.number().nonnegative().optional(),
});

export const RuleSchema = z.strictObject({
  id: z.string().min(1),
  when: RuleWhenSchema,
  required_evidence: z.array(z.string().min(1)),
  result_if_missing: z.enum(["HOLD", "ESCALATE"]),
  always_escalate: z.boolean(),
  source: z.string().min(1),
  source_url: z.url(),
  accessed_date: z.iso.date(),
  note: z.string().min(1),
});

export const RulesFileSchema = z.strictObject({
  module: ModuleIdSchema,
  version: ModuleVersionSchema,
  updated_at: UtcDateTimeSchema,
  rules: z.array(RuleSchema).min(1),
});

export type RuleWhen = z.infer<typeof RuleWhenSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type RulesFile = z.infer<typeof RulesFileSchema>;
