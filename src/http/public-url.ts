import type { PaymentMode } from "../payment/config.js";

/** 解析服务公网基地址，避免把猜测的地址写入链上身份。 */
export function resolvePublicBaseUrl(
  environment: NodeJS.ProcessEnv,
  mode: PaymentMode,
  port: number,
): string {
  const rawUrl = environment.PUBLIC_BASE_URL?.trim();
  if (rawUrl === undefined || rawUrl === "") {
    if (mode === "off") return `http://localhost:${String(port)}`;
    throw new Error("公网地址配置缺失：PUBLIC_BASE_URL");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("非法公网地址：PUBLIC_BASE_URL");
  }
  if (mode !== "off" && parsedUrl.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL 在付费模式下必须使用 HTTPS");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL 必须使用 HTTP(S)");
  }
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString().replace(/\/+$/, "");
}
