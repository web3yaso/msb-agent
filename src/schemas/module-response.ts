import { z } from "zod";

import {
  CheckBasisSchema,
  CheckStatusSchema,
  EngineVersionSchema,
  EvmAddressSchema,
  EvidenceHashSchema,
  EvidenceHashSchemeVersionSchema,
  ModuleIdSchema,
  ModuleVersionSchema,
  RoyaltyBpsSchema,
  UtcDateTimeSchema,
} from "./common.js";

export const CheckResultSchema = z.strictObject({
  id: z.string().min(1),
  result: CheckStatusSchema,
  basis: CheckBasisSchema,
  reason: z.string().min(1),
  source: z.string().min(1),
});

export const SettlementConstraintsSchema = z.strictObject({
  module: ModuleIdSchema,
  module_version: ModuleVersionSchema,
  deal_id: z.string().min(1),
  valid_until: UtcDateTimeSchema,
  blocked_check_ids: z.array(z.string().min(1)),
  escalated_check_ids: z.array(z.string().min(1)),
  evaluated_check_count: z.number().int().nonnegative(),
  evidence_hash: EvidenceHashSchema,
});

export const ModuleResponseSchema = z.strictObject({
  module: ModuleIdSchema,
  version: ModuleVersionSchema,
  engine_version: EngineVersionSchema,
  hash_scheme_version: EvidenceHashSchemeVersionSchema,
  updated_at: UtcDateTimeSchema,
  maintainer_wallet: EvmAddressSchema,
  royalty_bps: RoyaltyBpsSchema,
  checks: z.array(CheckResultSchema),
  overall: CheckStatusSchema,
  settlement_constraints: SettlementConstraintsSchema,
  evidence_hash: EvidenceHashSchema,
  disclaimer: z.string().min(1),
});

export type CheckResult = z.infer<typeof CheckResultSchema>;
export type SettlementConstraints = z.infer<typeof SettlementConstraintsSchema>;
export type ModuleResponse = z.infer<typeof ModuleResponseSchema>;
