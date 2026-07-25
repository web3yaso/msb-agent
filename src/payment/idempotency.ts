import { createHash } from "node:crypto";

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 支付凭证仅以哈希形式用于错误响应和短期幂等索引。
 */
export function getPaymentCredentialId(credential: string): string {
  return createHash("sha256").update(credential, "utf8").digest("hex");
}

/**
 * 幂等授权同时绑定资源与请求体，防止已付凭证被用于不同检查。
 */
export function getPaymentRetryKey(
  credentialId: string,
  path: string,
  requestBody: string,
): string {
  return createHash("sha256")
    .update(credentialId, "utf8")
    .update("\x1f", "utf8")
    .update(path, "utf8")
    .update("\x1f", "utf8")
    .update(requestBody, "utf8")
    .digest("hex");
}

export class PaidRetryStore {
  readonly #expiresAtByCredentialId = new Map<string, number>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  has(retryKey: string): boolean {
    const expiresAt = this.#expiresAtByCredentialId.get(retryKey);
    if (expiresAt === undefined) {
      return false;
    }
    if (expiresAt <= this.now().getTime()) {
      this.#expiresAtByCredentialId.delete(retryKey);
      return false;
    }
    return true;
  }

  remember(retryKey: string): void {
    this.#expiresAtByCredentialId.set(retryKey, this.now().getTime() + IDEMPOTENCY_WINDOW_MS);
  }
}
