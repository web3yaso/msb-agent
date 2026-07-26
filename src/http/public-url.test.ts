import { describe, expect, it } from "vitest";
import { resolvePublicBaseUrl } from "./public-url.js";

describe("resolvePublicBaseUrl", () => {
  it("off 模式无配置时回落 localhost", () => {
    expect(resolvePublicBaseUrl({}, "off", 4321)).toBe("http://localhost:4321");
  });
  it("付费模式要求显式 HTTPS 地址", () => {
    expect(() => resolvePublicBaseUrl({}, "x402-arc-testnet", 3000)).toThrow("PUBLIC_BASE_URL");
    expect(() =>
      resolvePublicBaseUrl({ PUBLIC_BASE_URL: "http://example.com" }, "x402-arc-testnet", 3000),
    ).toThrow("PUBLIC_BASE_URL");
  });
  it("移除末尾斜杠、query 与 hash", () => {
    expect(
      resolvePublicBaseUrl(
        { PUBLIC_BASE_URL: "https://example.com/path/?a=1#part" },
        "x402-arc-testnet",
        3000,
      ),
    ).toBe("https://example.com/path");
  });
  it("非法 URL 的错误包含变量名", () => {
    expect(() => resolvePublicBaseUrl({ PUBLIC_BASE_URL: "not a url" }, "off", 3000)).toThrow(
      "PUBLIC_BASE_URL",
    );
  });
});
