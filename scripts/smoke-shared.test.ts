import { describe, expect, it } from "vitest";

import {
  getClientPrivateKey,
  getDepositAmount,
  getForceDeposit,
  getPublicSmokeBaseUrl,
  getSafeErrorMessage,
  getSmokeModule,
  parseDepositAmountAtomic,
  SMOKE_DEAL_INPUT,
} from "./smoke-shared.js";

describe("smoke shared helpers", () => {
  it("规范化带或不带 0x 的客户端私钥", () => {
    const privateKeyBody = "ab".repeat(32);
    expect(getClientPrivateKey(privateKeyBody)).toBe(`0x${privateKeyBody}`);
    expect(getClientPrivateKey(`0x${privateKeyBody}`)).toBe(`0x${privateKeyBody}`);
  });

  it("拒绝缺失或非法的客户端私钥且不回显输入", () => {
    expect(() => getClientPrivateKey(undefined)).toThrow("缺失");
    expect(() => getClientPrivateKey("not-a-private-key")).toThrow(
      "X402_SMOKE_CLIENT_PRIVATE_KEY 缺失或不是 32 字节十六进制私钥",
    );
  });

  it("解析模块并拒绝未知模块", () => {
    expect(getSmokeModule("eu-msb")).toBe("eu-msb");
    expect(() => getSmokeModule("unknown")).toThrow("SMOKE_MODULE 非法");
  });

  it("解析存款金额及其原子单位", () => {
    expect(getDepositAmount(undefined)).toBe("1.50");
    expect(getDepositAmount(" 2.123456 ")).toBe("2.123456");
    expect(parseDepositAmountAtomic("2.123456")).toBe(2_123_456n);
    expect(() => getDepositAmount("0")).toThrow("必须是正数");
  });

  it("解析强制存款开关", () => {
    expect(getForceDeposit("1")).toBe(true);
    expect(getForceDeposit(" TRUE ")).toBe(true);
    expect(getForceDeposit("false")).toBe(false);
    expect(() => getForceDeposit("yes")).toThrow("只接受");
  });

  it("校验并规范化公网 HTTPS 基地址", () => {
    expect(getPublicSmokeBaseUrl("https://example.com/base/?ignored=1#hash")).toBe(
      "https://example.com/base",
    );
    expect(() => getPublicSmokeBaseUrl("http://example.com")).toThrow("必须使用 HTTPS");
    expect(() => getPublicSmokeBaseUrl("not-a-url")).toThrow("不是合法 URL");
  });

  it("从错误消息中清除私钥", () => {
    const secret = `0x${"12".repeat(32)}`;
    expect(
      getSafeErrorMessage(new Error(`failed for ${secret} / ${secret.slice(2)}`), secret),
    ).toBe("failed for [REDACTED] / [REDACTED]");
    expect(getSafeErrorMessage("unknown", secret)).toBe("未知错误");
  });

  it("共享固定交易输入", () => {
    expect(SMOKE_DEAL_INPUT.deal_id).toBe("arc-testnet-smoke");
    expect(SMOKE_DEAL_INPUT.parties).toHaveLength(5);
  });
});
