import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ModuleResponseSchema } from "../schemas/index.js";
import { createApp } from "./app.js";
import { DISCLAIMER, EU_MEMBER_COUNTRIES } from "./constants.js";

interface ErrorResponse {
  error: string;
  disclaimer: string;
}

interface DiscoveryResponse {
  disclaimer: string;
  modules: {
    module: string;
    pay_to: string;
    input_schema_url: string;
  }[];
}

const completeUsInput = {
  deal_id: "job-123",
  parties: [
    { role: "payer", country: "US", state: "NY" },
    { role: "payee", country: "SG" },
  ],
  activity: "money_transmission",
  amount_usdc: 10_000,
  monthly_volume_usdc: null,
  evidence: {
    fincen_msb_registration: true,
    bsa_aml_program: true,
    sar_monitoring_and_filing_controls: true,
    ny_money_transmitter_license: "NY-MT-123",
  },
};

describe("HTTP app", () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    vi.stubEnv("PAYMENT_MODE", "off");
    vi.stubEnv("US_MSB_PAY_TO", "0x1111111111111111111111111111111111111111");
    app = await createApp({ now: () => new Date("2026-07-24T00:00:00Z") });
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("GET /modules 返回四个模块、发现字段和免责声明", async () => {
    const response = await app.request("/modules");
    const body = (await response.json()) as DiscoveryResponse;

    expect(response.status).toBe(200);
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body.modules).toHaveLength(4);
    expect(body.modules).toContainEqual(
      expect.objectContaining({
        module: "us-msb",
        pay_to: "0x1111111111111111111111111111111111111111",
        input_schema_url: "/modules/us-msb/schema",
      }),
    );
  });

  it("GET /modules/:id/schema 生成模块 evidence schema 并保留免责声明", async () => {
    const response = await app.request("/modules/us-msb/schema");
    const body = (await response.json()) as {
      disclaimer: string;
      properties: {
        evidence: { properties: Record<string, unknown> };
      };
    };

    expect(response.status).toBe(200);
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body.properties.evidence.properties).toHaveProperty("fincen_msb_registration");
    expect(body.properties.evidence.properties).toHaveProperty("ny_bitlicense");
  });

  it("POST /modules/:id/check 返回完整 ModuleResponse 和 settlement constraints", async () => {
    const response = await app.request("/modules/us-msb/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(completeUsInput),
    });
    const body = ModuleResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body.overall).toBe("PASS");
    expect(body.settlement_constraints).toMatchObject({
      module: "us-msb",
      module_version: "2026.07.1",
      deal_id: "job-123",
      valid_until: "2026-07-27T00:00:00.000Z",
      blocked_check_ids: [],
      escalated_check_ids: [],
      evidence_hash: body.evidence_hash,
    });
  });

  it("请求 JSON 或 DealInput schema 不合法时返回 400", async () => {
    const malformedResponse = await app.request("/modules/us-msb/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const invalidResponse = await app.request("/modules/us-msb/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...completeUsInput, parties: [] }),
    });

    expect(malformedResponse.status).toBe(400);
    expect(((await malformedResponse.json()) as ErrorResponse).disclaimer).toBe(DISCLAIMER);
    expect(invalidResponse.status).toBe(400);
    expect(((await invalidResponse.json()) as ErrorResponse).error).toBe("invalid_request");
  });

  it.each([
    ["us-msb", "CA"],
    ["uk-msb", "US"],
    ["sg-msb", "US"],
    ["eu-msb", "US"],
  ])("%s 的全部 party 均在法域外时返回 422", async (moduleId, country) => {
    const response = await app.request(`/modules/${moduleId}/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...completeUsInput,
        parties: [{ role: "payer", country }],
      }),
    });
    const body = (await response.json()) as ErrorResponse;

    expect(response.status).toBe(422);
    expect(body.error).toBe("jurisdiction_not_applicable");
    expect(body.disclaimer).toBe(DISCLAIMER);
  });

  it("eu-msb 对任一欧盟成员国 party 受理请求", async () => {
    expect(EU_MEMBER_COUNTRIES.size).toBe(27);

    const response = await app.request("/modules/eu-msb/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...completeUsInput,
        parties: [
          { role: "payer", country: "US" },
          { role: "payee", country: "DE" },
        ],
      }),
    });
    const body = ModuleResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.module).toBe("eu-msb");
    expect(body.disclaimer).toBe(DISCLAIMER);
  });
});
