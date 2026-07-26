import { describe, expect, it } from "vitest";

import { AGENT_SHORT_DESCRIPTION, DISCLAIMER, MODULE_DEFAULT_PRICE_USDC } from "./constants.js";

describe("HTTP 常量", () => {
  it("四模块使用设计指定的默认价格", () => {
    expect(MODULE_DEFAULT_PRICE_USDC).toEqual({
      "us-msb": "0.800000",
      "uk-msb": "0.400000",
      "eu-msb": "0.600000",
      "sg-msb": "0.200000",
    });
  });

  it("agent 短描述包含完整免责声明", () => {
    expect(AGENT_SHORT_DESCRIPTION).toContain(DISCLAIMER);
  });
});
