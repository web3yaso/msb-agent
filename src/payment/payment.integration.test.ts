import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";

import { evaluate } from "../engine/index.js";
import { createApp } from "../http/app.js";
import { ModuleResponseSchema } from "../schemas/index.js";
import type { PaymentConfig, X402MiddlewareFactory } from "./index.js";

const PAY_TO = "0x1111111111111111111111111111111111111111";
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
  it("base-sepolia 完成 402 → 支付 → 200", async () => {
    const chargeCount = { value: 0 };
    const app = await createApp({
      paymentConfig,
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
      x402MiddlewareFactory: unavailableFactory,
    });

    const response = await app.request("/modules/us-msb/check", paidRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "facilitator_unavailable",
    });
  });
});
