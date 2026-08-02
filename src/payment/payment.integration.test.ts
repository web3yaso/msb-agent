import type { MiddlewareHandler } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { evaluate } from "../engine/index.js";
import { createApp } from "../http/app.js";
import { ModuleResponseSchema } from "../schemas/index.js";
import { createX402Price, type PaymentConfig, type X402MiddlewareFactory } from "./index.js";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const royaltyConfig = {
  "us-msb": { maintainerWallet: PAY_TO, royaltyBps: 500 },
  "uk-msb": { maintainerWallet: PAY_TO, royaltyBps: 500 },
  "eu-msb": { maintainerWallet: PAY_TO, royaltyBps: 500 },
  "sg-msb": { maintainerWallet: PAY_TO, royaltyBps: 500 },
  "ae-msb": { maintainerWallet: PAY_TO, royaltyBps: 500 },
} as const;
const paymentConfig: PaymentConfig = {
  facilitatorUrl: "https://facilitator.example.test",
  mode: "x402-base-sepolia",
  modules: {
    "us-msb": {
      payTo: PAY_TO,
      priceAtomic: "1000000",
      priceUsdc: "1.000000",
    },
  },
  network: "base-sepolia",
};

const validInput = {
  deal_id: "paid-job",
  parties: [{ role: "payer", country: "US", state: "NY" }],
  activity: "money_transmission",
  amount_usdc: 10_000,
  monthly_volume_usdc: null,
  evidence: {
    fincen_msb_registration: true,
    bsa_aml_program: true,
    sar_monitoring_and_filing_controls: true,
    ny_money_transmitter_license: true,
  },
};

function createMockFacilitator(chargeCount: { value: number }): X402MiddlewareFactory {
  return (config) => {
    expect(config).toMatchObject({
      network: "base-sepolia",
      payTo: PAY_TO,
      priceAtomic: "1000000",
      priceUsdc: "1.000000",
    });
    const middleware: MiddlewareHandler = async (context, next) => {
      if (context.req.header("x-payment") !== "paid-credential") {
        return context.json({ error: "payment_required", amount: config.priceAtomic }, 402);
      }
      chargeCount.value += 1;
      await next();
    };
    return middleware;
  };
}

function paidRequest(): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-payment": "paid-credential",
    },
    body: JSON.stringify(validInput),
  };
}

describe("x402 支付层", () => {
  beforeAll(() => {
    vi.stubEnv("PUBLIC_BASE_URL", "https://example.test");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("Arc 使用 Circle GatewayWalletBatched AssetAmount，Base 保持美元价格", () => {
    const commonConfig = {
      facilitatorUrl: "https://facilitator.example.test",
      moduleId: "us-msb",
      path: "/modules/us-msb/check",
      payTo: PAY_TO,
      priceAtomic: "1000000",
      priceUsdc: "1.000000",
      resource: "https://example.test/modules/us-msb/check",
    } as const;

    expect(createX402Price({ ...commonConfig, network: "arc-testnet" })).toEqual({
      amount: "1000000",
      asset: "0x3600000000000000000000000000000000000000",
      extra: {
        minValiditySeconds: 604800,
        name: "GatewayWalletBatched",
        verifyingContract: "0x0077777d7eba4688bdef3e311b846f25870a19b9",
        version: "1",
      },
    });
    expect(createX402Price({ ...commonConfig, network: "base-sepolia" })).toBe("$1.000000");
  });

  it("base-sepolia 完成 402 → 支付 → 200", async () => {
    const chargeCount = { value: 0 };
    const app = await createApp({
      paymentConfig,
      royaltyConfig,
      x402MiddlewareFactory: createMockFacilitator(chargeCount),
    });

    const unpaidResponse = await app.request("/modules/us-msb/check", {
      ...paidRequest(),
      headers: { "content-type": "application/json" },
    });
    const paidResponse = await app.request("/modules/us-msb/check", paidRequest());

    expect(unpaidResponse.status).toBe(402);
    expect(paidResponse.status).toBe(200);
    expect(ModuleResponseSchema.parse(await paidResponse.json()).module).toBe("us-msb");
    expect(chargeCount.value).toBe(1);
  });

  it("入站为内部 HTTP URL 时，402 resource.url 使用 PUBLIC_BASE_URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        kinds: [{ network: "eip155:84532", scheme: "exact", x402Version: 2 }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const app = await createApp({
      paymentConfig,
      royaltyConfig,
    });

    const response = await app.request("http://internal-host/modules/us-msb/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validInput),
    });
    const encodedQuote = response.headers.get("payment-required");
    const quote = JSON.parse(Buffer.from(encodedQuote ?? "", "base64").toString("utf8")) as {
      resource: { url: string };
    };

    expect(response.status).toBe(402);
    expect(encodedQuote).not.toBeNull();
    expect(quote.resource.url).toBe("https://example.test/modules/us-msb/check");
    expect(quote.resource.url.startsWith("https://example.test")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("免费限流耗尽后已知已付重试仍返回 200", async () => {
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", "1");
    const chargeCount = { value: 0 };
    let evaluationCount = 0;
    const flakyEvaluate: typeof evaluate = (...arguments_) => {
      evaluationCount += 1;
      if (evaluationCount === 1) throw new Error("simulated engine failure");
      return evaluate(...arguments_);
    };
    const app = await createApp({
      accessLog: () => undefined,
      evaluateRules: flakyEvaluate,
      paymentConfig,
      royaltyConfig,
      x402MiddlewareFactory: createMockFacilitator(chargeCount),
    });
    const failedResponse = await app.request("/modules/us-msb/check", paidRequest());
    const retriedResponse = await app.request("/modules/us-msb/check", paidRequest());

    expect(failedResponse.status).toBe(500);
    expect(retriedResponse.status).toBe(200);
    expect(chargeCount.value).toBe(1);
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", undefined);
  });

  it("已知已付重试按单凭证独立限制为每分钟 60 次", async () => {
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", "1");
    const chargeCount = { value: 0 };
    let evaluationCount = 0;
    const alwaysFailEvaluate: typeof evaluate = () => {
      evaluationCount += 1;
      throw new Error("simulated engine failure");
    };
    const app = await createApp({
      accessLog: () => undefined,
      evaluateRules: alwaysFailEvaluate,
      paymentConfig,
      royaltyConfig,
      x402MiddlewareFactory: createMockFacilitator(chargeCount),
    });

    expect((await app.request("/modules/us-msb/check", paidRequest())).status).toBe(500);
    for (let requestIndex = 0; requestIndex < 60; requestIndex += 1) {
      expect((await app.request("/modules/us-msb/check", paidRequest())).status).toBe(500);
    }
    expect((await app.request("/modules/us-msb/check", paidRequest())).status).toBe(429);
    expect(chargeCount.value).toBe(1);
    expect(evaluationCount).toBe(61);
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", undefined);
  });

  it("无效支付凭证不得跳过限流计数", async () => {
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", "1");
    const chargeCount = { value: 0 };
    const app = await createApp({
      accessLog: () => undefined,
      paymentConfig,
      royaltyConfig,
      x402MiddlewareFactory: createMockFacilitator(chargeCount),
    });
    const invalidRequest = {
      ...paidRequest(),
      headers: { "content-type": "application/json", "payment-signature": "invalid" },
    };

    expect((await app.request("/modules/us-msb/check", invalidRequest)).status).toBe(402);
    expect((await app.request("/modules/us-msb/check", invalidRequest)).status).toBe(429);
    expect(chargeCount.value).toBe(0);
    vi.stubEnv("RATE_LIMIT_MAX_REQUESTS", undefined);
  });

  it("付费后引擎异常时，同一凭证重试不二次收费", async () => {
    const chargeCount = { value: 0 };
    let evaluationCount = 0;
    const flakyEvaluate: typeof evaluate = (...arguments_) => {
      evaluationCount += 1;
      if (evaluationCount === 1) {
        throw new Error("simulated engine failure");
      }
      return evaluate(...arguments_);
    };
    const app = await createApp({
      evaluateRules: flakyEvaluate,
      paymentConfig,
      royaltyConfig,
      x402MiddlewareFactory: createMockFacilitator(chargeCount),
    });

    const failedResponse = await app.request("/modules/us-msb/check", paidRequest());
    const failureBody = (await failedResponse.json()) as {
      payment_credential_id: string;
    };
    const retriedResponse = await app.request("/modules/us-msb/check", paidRequest());

    expect(failedResponse.status).toBe(500);
    expect(failureBody.payment_credential_id).toMatch(/^[a-f0-9]{64}$/);
    expect(retriedResponse.status).toBe(200);
    expect(chargeCount.value).toBe(1);
    expect(evaluationCount).toBe(2);
  });

  it("facilitator 不可达时返回 502", async () => {
    const unavailableFactory: X402MiddlewareFactory = () => async () => {
      await Promise.reject(new Error("facilitator offline"));
    };
    const app = await createApp({
      paymentConfig,
      royaltyConfig,
      x402MiddlewareFactory: unavailableFactory,
    });

    const response = await app.request("/modules/us-msb/check", paidRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "facilitator_unavailable",
    });
  });
});
