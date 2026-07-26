import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../http/app.js";
import { DISCLAIMER } from "../http/constants.js";
import {
  ModuleIdSchema,
  ModuleResponseSchema,
  type ModuleId,
  type ModuleResponse,
} from "../schemas/index.js";

const FIXED_REQUEST_TIME = "2026-07-24T12:00:00Z";
const DEMO_MAINTAINER_WALLET = "0x5555555555555555555555555555555555555555";

const CITELY_DEMO_INPUT = {
  deal_id: "citely-demo-10000-usdc",
  parties: [
    { role: "payer", country: "US", state: "NY" },
    { role: "payee", country: "SG" },
    { role: "payee", country: "GB" },
    { role: "payee", country: "DE" },
  ],
  activity: "money_transmission",
  amount_usdc: 10_000,
  monthly_volume_usdc: 3_000_000,
  evidence: {},
};

const EXPECTED_EVIDENCE_HASHES: Record<ModuleId, string> = {
  "us-msb": "fbf59533a95ef45bf3067772d45778f7c875aa0240a07b7a6376925b857cc12d",
  "uk-msb": "1d71297d3a4085997f5dc93aad106cc356bf1541eea803bbf2ce6965210b5252",
  "eu-msb": "33c65cb7cb4fb614d28ea99ecdc73e4254628c8a6cab1fe146231a1f7ccce271",
  "sg-msb": "f337f7ad5e547092ecf29f87e2678653a972443bc8f16731bba7130ad046e2f8",
};

describe("Citely Demo golden responses", () => {
  let responses: Record<ModuleId, ModuleResponse>;

  beforeAll(async () => {
    vi.stubEnv("PAYMENT_MODE", "off");
    vi.stubEnv("MODULE_MAINTAINER_WALLET", DEMO_MAINTAINER_WALLET);
    vi.stubEnv("MODULE_ROYALTY_BPS", "500");
    const app = await createApp({ now: () => new Date(FIXED_REQUEST_TIME) });
    const entries = await Promise.all(
      ModuleIdSchema.options.map(async (moduleId) => {
        const response = await app.request(`/modules/${moduleId}/check`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(CITELY_DEMO_INPUT),
        });

        expect(response.status).toBe(200);
        return [moduleId, ModuleResponseSchema.parse(await response.json())] as const;
      }),
    );
    responses = Object.fromEntries(entries) as Record<ModuleId, ModuleResponse>;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it.each(ModuleIdSchema.options)("%s 的完整 ModuleResponse 匹配 golden 快照", (moduleId) => {
    expect(responses[moduleId]).toMatchSnapshot();
  });

  it.each(ModuleIdSchema.options)("%s 的 evidence_hash 跨运行固定", (moduleId) => {
    const response = responses[moduleId];

    expect(response.evidence_hash).toBe(EXPECTED_EVIDENCE_HASHES[moduleId]);
    expect(response.settlement_constraints.evidence_hash).toBe(EXPECTED_EVIDENCE_HASHES[moduleId]);
  });

  it.each(ModuleIdSchema.options)("%s 保留免责声明", (moduleId) => {
    expect(responses[moduleId].disclaimer).toBe(DISCLAIMER);
  });

  it.each(ModuleIdSchema.options)("%s 回显固定版税配置", (moduleId) => {
    expect(responses[moduleId].maintainer_wallet).toBe(DEMO_MAINTAINER_WALLET);
    expect(responses[moduleId].royalty_bps).toBe(500);
  });
});
