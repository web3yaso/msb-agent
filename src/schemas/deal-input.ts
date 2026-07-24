import { z } from "zod";

import { ActivitySchema, CountryCodeSchema, PartyRoleSchema } from "./common.js";

export const PartySchema = z.strictObject({
  role: PartyRoleSchema,
  country: CountryCodeSchema,
  state: z.string().min(1).optional(),
});

export const DealInputSchema = z.strictObject({
  deal_id: z.string().min(1),
  parties: z.array(PartySchema).min(1),
  activity: ActivitySchema,
  amount_usdc: z.number().nonnegative(),
  monthly_volume_usdc: z.number().nonnegative().nullable().optional(),
  evidence: z.record(z.string(), z.unknown()),
});

export type Party = z.infer<typeof PartySchema>;
export type DealInput = z.infer<typeof DealInputSchema>;
