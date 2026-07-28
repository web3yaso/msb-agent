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
  "us-msb": "44bf07506c3ba782b93d8208757737aee4894c0227a47865ca1d34e7b2aa45e4",
  "uk-msb": "8358d3e2e9abd808a8e117b3f62849bebaa9ec4632c2209aa52d2702bf249e2d",
  "eu-msb": "1830888a785947fa2910d1818838ca2f83599b5278bdb49b80b1e512bda63d3e",
  "sg-msb": "0e58bb4cb990e6321963bfb09a8404f54cd0f5f3ab0a13e2264a79ecdae61d00",
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

    expect(response.engine_version).toBe("1.0.0");
    expect(response.hash_scheme_version).toBe("2");
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
