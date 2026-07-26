import { describe, expect, it } from "vitest";

import { MODULE_DEFAULT_PRICE_USDC } from "./constants.js";

describe("HTTP 常量", () => {
  it("四模块使用设计指定的默认价格", () => {
    expect(MODULE_DEFAULT_PRICE_USDC).toEqual({
      "us-msb": "0.800000",
      "uk-msb": "0.400000",
      "eu-msb": "0.600000",
      "sg-msb": "0.200000",
    });
  });
});
