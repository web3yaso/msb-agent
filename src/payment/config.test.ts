import { describe, expect, it } from "vitest";

import { loadPaymentConfig, parseUsdcPrice, resolveModulePrices } from "./config.js";

const PAY_TO = "0x1111111111111111111111111111111111111111";

function paidEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PAYMENT_MODE: "x402-base-sepolia",
    X402_BASE_SEPOLIA_FACILITATOR_URL: "https://facilitator.example.test",
    US_MSB_PAY_TO: PAY_TO,
    UK_MSB_PAY_TO: PAY_TO,
    EU_MSB_PAY_TO: PAY_TO,
    SG_MSB_PAY_TO: PAY_TO,
    ...overrides,
  };
}

describe("支付配置", () => {
  it("将 USDC 小数精确转换为六位小数和原子单位", () => {
    expect(parseUsdcPrice("1")).toEqual({
      priceAtomic: "1000000",
      priceUsdc: "1.000000",
    });
    expect(parseUsdcPrice("0.000001")).toEqual({
      priceAtomic: "1",
      priceUsdc: "0.000001",
    });
  });

  it.each(["0", "1.0000000", "1e6", "-1", "100.000001"])("拒绝非法或危险价格 %s", (price) => {
    expect(() => parseUsdcPrice(price)).toThrow();
  });

  it("仅显式 off 才关闭支付", () => {
    expect(loadPaymentConfig({ PAYMENT_MODE: "off" })).toEqual({
      mode: "off",
      modules: {},
    });
    expect(() => loadPaymentConfig({})).toThrow("支付配置缺失");
  });

  it("PAYMENT_MODE 缺省时使用 arc-testnet", () => {
    const environment = paidEnvironment({
      PAYMENT_MODE: undefined,
      X402_ARC_TESTNET_FACILITATOR_URL: "https://circle.example.test",
    });

    expect(loadPaymentConfig(environment)).toMatchObject({
      facilitatorUrl: "https://circle.example.test",
      mode: "x402-arc-testnet",
      network: "arc-testnet",
    });
  });

  it("解析 base-sepolia 配置并允许按模块覆盖价格", () => {
    const config = loadPaymentConfig(paidEnvironment({ UK_MSB_PRICE_USDC: "2.5" }));

    expect(config).toMatchObject({
      facilitatorUrl: "https://facilitator.example.test",
      mode: "x402-base-sepolia",
      network: "base-sepolia",
    });
    expect(config.modules["us-msb"]?.priceAtomic).toBe("800000");
    expect(config.modules["sg-msb"]?.priceAtomic).toBe("200000");
    expect(config.modules["uk-msb"]?.priceAtomic).toBe("2500000");
  });

  it("统一解析并规范化发现与支付使用的模块价格", () => {
    expect(resolveModulePrices({ US_MSB_PRICE_USDC: "0.8" })["us-msb"]).toEqual({
      priceAtomic: "800000",
      priceUsdc: "0.800000",
    });
  });

  it("付费模式缺少收款地址、facilitator 或地址非法时启动失败", () => {
    expect(() => loadPaymentConfig(paidEnvironment({ SG_MSB_PAY_TO: undefined }))).toThrow(
      "SG_MSB_PAY_TO",
    );
    expect(() =>
      loadPaymentConfig(paidEnvironment({ X402_BASE_SEPOLIA_FACILITATOR_URL: undefined })),
    ).toThrow("X402_BASE_SEPOLIA_FACILITATOR_URL");
    expect(() => loadPaymentConfig(paidEnvironment({ US_MSB_PAY_TO: "secret" }))).toThrow(
      "US_MSB_PAY_TO",
    );
  });
});
