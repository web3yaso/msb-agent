import { z } from "zod";

import {
  CheckStatusSchema,
  EvidenceHashSchema,
  ModuleIdSchema,
  ModuleVersionSchema,
  UtcDateTimeSchema,
} from "./common.js";

export const CheckResultSchema = z.strictObject({
  id: z.string().min(1),
  result: CheckStatusSchema,
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
  evidence_hash: EvidenceHashSchema,
});

export const ModuleResponseSchema = z.strictObject({
  module: ModuleIdSchema,
  version: ModuleVersionSchema,
  updated_at: UtcDateTimeSchema,
  checks: z.array(CheckResultSchema),
  overall: CheckStatusSchema,
  settlement_constraints: SettlementConstraintsSchema,
  evidence_hash: EvidenceHashSchema,
  disclaimer: z.string().min(1),
});

export type CheckResult = z.infer<typeof CheckResultSchema>;
export type SettlementConstraints = z.infer<typeof SettlementConstraintsSchema>;
export type ModuleResponse = z.infer<typeof ModuleResponseSchema>;
