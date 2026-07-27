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
    price_usdc: string;
    input_schema_url: string;
  }[];
}

interface ServiceDirectoryResponse {
  disclaimer: string;
  endpoints: Record<string, string>;
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
const MAINTAINER_WALLET = "0x3333333333333333333333333333333333333333";

describe("HTTP app", () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeAll(async () => {
    vi.stubEnv("PAYMENT_MODE", "off");
    vi.stubEnv("US_MSB_PAY_TO", "0x1111111111111111111111111111111111111111");
    vi.stubEnv("MODULE_MAINTAINER_WALLET", MAINTAINER_WALLET);
    vi.stubEnv("MODULE_ROYALTY_BPS", "500");
    app = await createApp({
      now: () => new Date("2026-07-24T00:00:00Z"),
      accessLog: () => undefined,
    });
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
        price_usdc: "0.800000",
        input_schema_url: "/modules/us-msb/schema",
      }),
    );
  });

  it("GET / 返回服务目录和免责声明", async () => {
    const response = await app.request("/");
    const body = (await response.json()) as ServiceDirectoryResponse;

    expect(response.status).toBe(200);
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body.endpoints).toEqual(
      expect.objectContaining({
        modules: "/modules",
        check: "/modules/{id}/check (x402 paid)",
        schema: "/modules/{id}/schema",
        agent_card: "/.well-known/agent-card.json",
        agent_registration: "/.well-known/agent-registration.json",
        health: "/healthz",
      }),
    );
  });

  it("GET /static/agent-icon.png 返回缓存的 PNG", async () => {
    const response = await app.request("/static/agent-icon.png");
    const body = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(body.byteLength).toBeGreaterThan(0);
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

  it("GET agent card 免费返回 registration-v1，未注册时证明端点返回 404", async () => {
    const cardResponse = await app.request("/.well-known/agent-card.json");
    const card = (await cardResponse.json()) as {
      active: boolean;
      type: string;
      disclaimer: string;
      description: string;
      services: { name: string; endpoint: string; version: string }[];
      x402Support: boolean;
    };
    const registrationResponse = await app.request("/.well-known/agent-registration.json");

    expect(cardResponse.status).toBe(200);
    expect(cardResponse.headers.get("content-type")).toContain("application/json");
    expect(cardResponse.headers.get("cache-control")).toBe("public, max-age=300");
    expect(card.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(card.disclaimer).toBe(DISCLAIMER);
    expect(card.description).toContain(DISCLAIMER);
    expect(card.services).toHaveLength(2);
    expect(card.x402Support).toBe(true);
    expect(card.active).toBe(true);
    expect(registrationResponse.status).toBe(404);
    expect(await registrationResponse.json()).toHaveProperty("disclaimer", DISCLAIMER);
  });

  it("Arc x402 模式下两个 well-known 端点绝不触发支付", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://example.test");
    const arcPaymentConfig = {
      facilitatorUrl: "https://facilitator.example.test",
      mode: "x402-arc-testnet",
      modules: {},
      network: "arc-testnet",
    } as const;
    const arcApp = await createApp({
      accessLog: () => undefined,
      paymentConfig: arcPaymentConfig,
    });

    expect((await arcApp.request("/.well-known/agent-card.json")).status).toBe(200);
    expect((await arcApp.request("/.well-known/agent-registration.json")).status).toBe(404);
    vi.stubEnv("PUBLIC_BASE_URL", undefined);
  });

  it("Arc x402 模式下根路径和图标端点绝不触发支付", async () => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://example.test");
    const arcPaymentConfig = {
      facilitatorUrl: "https://facilitator.example.test",
      mode: "x402-arc-testnet",
      modules: {},
      network: "arc-testnet",
    } as const;
    const arcApp = await createApp({
      accessLog: () => undefined,
      paymentConfig: arcPaymentConfig,
    });

    expect((await arcApp.request("/")).status).toBe(200);
    expect((await arcApp.request("/static/agent-icon.png")).status).toBe(200);
    vi.stubEnv("PUBLIC_BASE_URL", undefined);
  });

  it("配置链上身份后证明端点返回 agentId", async () => {
    vi.stubEnv("ERC8004_AGENT_ID", "123");
    vi.stubEnv("ERC8004_IDENTITY_REGISTRY", "0x8004A818BFB912233c491871b3d84c89A494BD9e");
    const registeredApp = await createApp({ accessLog: () => undefined });
    const response = await registeredApp.request("/.well-known/agent-registration.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      registrations: [{ agentId: 123 }],
    });
    vi.stubEnv("ERC8004_AGENT_ID", undefined);
    vi.stubEnv("ERC8004_IDENTITY_REGISTRY", undefined);
  });

  it("GET /modules 超过限流窗口上限后返回 429", async () => {
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", "1");
    const limitedApp = await createApp({ accessLog: () => undefined });
    expect((await limitedApp.request("/modules")).status).toBe(200);
    const response = await limitedApp.request("/modules");
    expect(response.status).toBe(429);
    expect(await response.json()).toHaveProperty("disclaimer", DISCLAIMER);
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", undefined);
  });

  it.each(["/", "/static/agent-icon.png"])("%s 超过限流窗口上限后返回 429", async (path) => {
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", "1");
    const limitedApp = await createApp({ accessLog: () => undefined });

    expect((await limitedApp.request(path)).status).toBe(200);
    expect((await limitedApp.request(path)).status).toBe(429);
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", undefined);
  });

  it("GET /healthz 连续超过窗口上限次数仍豁免限流", async () => {
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", "1");
    const limitedApp = await createApp({ accessLog: () => undefined });
    const responses = [
      await limitedApp.request("/healthz"),
      await limitedApp.request("/healthz"),
      await limitedApp.request("/healthz"),
    ];

    expect(responses.map(({ status }) => status)).toEqual([200, 200, 200]);
    expect(await responses[0].json()).toEqual({ status: "ok", disclaimer: DISCLAIMER });
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", undefined);
  });

  it("身份配置不影响 evidence_hash 与 settlement constraints", async () => {
    const baselineApp = await createApp({ accessLog: () => undefined });
    vi.stubEnv("ERC8004_AGENT_ID", "123");
    vi.stubEnv("ERC8004_IDENTITY_REGISTRY", "0x8004A818BFB912233c491871b3d84c89A494BD9e");
    const identityApp = await createApp({ accessLog: () => undefined });
    const request = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(completeUsInput),
    });
    const baseline = ModuleResponseSchema.parse(
      await (await baselineApp.request("/modules/us-msb/check", request())).json(),
    );
    const withIdentity = ModuleResponseSchema.parse(
      await (await identityApp.request("/modules/us-msb/check", request())).json(),
    );
    expect(withIdentity.evidence_hash).toBe(baseline.evidence_hash);
    expect(withIdentity.settlement_constraints.evidence_hash).toBe(
      baseline.settlement_constraints.evidence_hash,
    );
    vi.stubEnv("ERC8004_AGENT_ID", undefined);
    vi.stubEnv("ERC8004_IDENTITY_REGISTRY", undefined);
  });

  it("GET /modules 将价格环境变量规范化为六位小数", async () => {
    vi.stubEnv("US_MSB_PRICE_USDC", "0.8");
    const normalizedApp = await createApp({
      now: () => new Date("2026-07-24T00:00:00Z"),
    });
    const response = await normalizedApp.request("/modules");
    const body = (await response.json()) as DiscoveryResponse;

    expect(body.modules.find(({ module }) => module === "us-msb")?.price_usdc).toBe("0.800000");
    vi.stubEnv("US_MSB_PRICE_USDC", undefined);
  });

  it("版税配置变化不影响 evidence_hash 或 settlement constraints", async () => {
    const firstApp = await createApp({
      now: () => new Date("2026-07-24T00:00:00Z"),
      royaltyConfig: {
        "us-msb": { maintainerWallet: MAINTAINER_WALLET, royaltyBps: 500 },
        "uk-msb": { maintainerWallet: MAINTAINER_WALLET, royaltyBps: 500 },
        "eu-msb": { maintainerWallet: MAINTAINER_WALLET, royaltyBps: 500 },
        "sg-msb": { maintainerWallet: MAINTAINER_WALLET, royaltyBps: 500 },
      },
    });
    const otherWallet = "0x4444444444444444444444444444444444444444";
    const secondApp = await createApp({
      now: () => new Date("2026-07-24T00:00:00Z"),
      royaltyConfig: {
        "us-msb": { maintainerWallet: otherWallet, royaltyBps: 1000 },
        "uk-msb": { maintainerWallet: otherWallet, royaltyBps: 1000 },
        "eu-msb": { maintainerWallet: otherWallet, royaltyBps: 1000 },
        "sg-msb": { maintainerWallet: otherWallet, royaltyBps: 1000 },
      },
    });
    const request = () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(completeUsInput),
    });
    const firstBody = ModuleResponseSchema.parse(
      await (await firstApp.request("/modules/us-msb/check", request())).json(),
    );
    const secondBody = ModuleResponseSchema.parse(
      await (await secondApp.request("/modules/us-msb/check", request())).json(),
    );

    expect(firstBody.evidence_hash).toBe(secondBody.evidence_hash);
    expect(firstBody.settlement_constraints).toEqual(secondBody.settlement_constraints);
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
    expect(body.maintainer_wallet).toBe(MAINTAINER_WALLET);
    expect(body.royalty_bps).toBe(500);
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
    const malformedBody = (await malformedResponse.json()) as ErrorResponse;
    expect(malformedBody.disclaimer).toBe(DISCLAIMER);
    expect(malformedBody).not.toHaveProperty("maintainer_wallet");
    expect(malformedBody).not.toHaveProperty("royalty_bps");
    expect(invalidResponse.status).toBe(400);
    expect(((await invalidResponse.json()) as ErrorResponse).error).toBe("invalid_request");
  });

  it("check 请求体超过 256KB 时返回 413", async () => {
    const response = await app.request("/modules/us-msb/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...completeUsInput,
        evidence: { oversized: "x".repeat(256 * 1024) },
      }),
    });

    expect(response.status).toBe(413);
    const body = (await response.json()) as ErrorResponse;
    expect(body.error).toBe("request_too_large");
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body).not.toHaveProperty("maintainer_wallet");
    expect(body).not.toHaveProperty("royalty_bps");
  });

  it("伪造支付头的 chunked 超限 body 返回 413 且不被完整缓冲", async () => {
    const totalChunks = 20;
    let pulledChunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulledChunks === totalChunks) {
          controller.close();
          return;
        }
        pulledChunks += 1;
        controller.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const request = new Request("http://localhost/modules/us-msb/check", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payment": "forged-credential",
      },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await app.request(request);

    expect(response.status).toBe(413);
    expect(pulledChunks).toBeLessThan(totalChunks);
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
    expect(body).not.toHaveProperty("maintainer_wallet");
    expect(body).not.toHaveProperty("royalty_bps");
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
