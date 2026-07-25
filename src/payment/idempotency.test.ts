import { describe, expect, it } from "vitest";

import { getPaymentCredentialId, getPaymentRetryKey, PaidRetryStore } from "./idempotency.js";

describe("支付重试幂等", () => {
  it("只保存凭证哈希且在 24 小时后过期", () => {
    let now = new Date("2026-07-24T00:00:00Z");
    const store = new PaidRetryStore(() => now);
    const credentialId = getPaymentCredentialId("signed-payment");
    const retryKey = getPaymentRetryKey(credentialId, "/modules/us-msb/check", "{}");

    expect(credentialId).not.toContain("signed-payment");
    expect(store.has(retryKey)).toBe(false);
    store.remember(retryKey);
    expect(store.has(retryKey)).toBe(true);

    now = new Date("2026-07-25T00:00:00Z");
    expect(store.has(retryKey)).toBe(false);
  });

  it("不同路径或请求体不会共享已付重试授权", () => {
    const credentialId = getPaymentCredentialId("signed-payment");

    expect(getPaymentRetryKey(credentialId, "/a", "{}")).not.toBe(
      getPaymentRetryKey(credentialId, "/b", "{}"),
    );
    expect(getPaymentRetryKey(credentialId, "/a", "{}")).not.toBe(
      getPaymentRetryKey(credentialId, "/a", '{"changed":true}'),
    );
  });
});
