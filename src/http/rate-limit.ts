import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";
import { DISCLAIMER } from "./constants.js";

export interface RateLimiterOptions {
  maxBuckets?: number;
  maxRequests: number;
  now?: () => number;
  resolveBucket?: (
    context: Context,
  ) => RateLimitBucketOverride | undefined | Promise<RateLimitBucketOverride | undefined>;
  shouldSkip?: (context: Context) => boolean | Promise<boolean>;
  trustProxyHeader: boolean;
  windowMs: number;
}
export interface RateLimitBucketOverride {
  key: string;
  maxRequests: number;
}
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const DEFAULT_MAX_BUCKETS = 10_000;
function getClientIp(context: Context, isTrustedProxy: boolean): string {
  if (isTrustedProxy) {
    const forwardedFor = context.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwardedFor !== undefined && forwardedFor !== "") return forwardedFor;
    const realIp = context.req.header("x-real-ip")?.trim();
    if (realIp !== undefined && realIp !== "") return realIp;
  }
  try {
    return getConnInfo(context).remote.address ?? "unknown";
  } catch {
    // Hono 的 app.request 测试环境没有 Node 连接对象；真实 Node 服务始终由连接层提供。
    return "unknown";
  }
}

function getRoutePrefix(path: string): string {
  if (path.startsWith("/.well-known/")) return "/.well-known";
  if (/^\/modules\/[^/]+\/schema$/.test(path)) return "/modules/:id/schema";
  if (/^\/modules\/[^/]+\/check$/.test(path)) return "/modules/:id/check";
  return path;
}

/** 创建适用于单实例部署的固定窗口限流中间件。 */
export function createRateLimiter(options: RateLimiterOptions): MiddlewareHandler {
  const maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;
  if (
    !Number.isSafeInteger(options.windowMs) ||
    !Number.isSafeInteger(options.maxRequests) ||
    !Number.isSafeInteger(maxBuckets) ||
    options.windowMs <= 0 ||
    options.maxRequests <= 0 ||
    maxBuckets <= 0
  ) {
    throw new Error("限流窗口与请求上限必须大于 0");
  }
  const buckets = new Map<string, RateLimitBucket>();
  const now = options.now ?? Date.now;

  function removeExpiredBuckets(currentTime: number): void {
    for (const [key, bucket] of buckets) {
      if (currentTime >= bucket.resetAt) buckets.delete(key);
    }
  }

  function makeRoom(currentTime: number): void {
    if (buckets.size < maxBuckets) return;
    removeExpiredBuckets(currentTime);
    if (buckets.size < maxBuckets) return;
    const oldestKey = buckets.keys().next().value;
    if (oldestKey !== undefined) buckets.delete(oldestKey);
  }

  return async (context, next) => {
    if ((await options.shouldSkip?.(context)) === true) {
      await next();
      return;
    }
    const currentTime = now();
    const override = await options.resolveBucket?.(context);
    if (
      override !== undefined &&
      (!Number.isSafeInteger(override.maxRequests) || override.maxRequests <= 0)
    ) {
      throw new Error("自定义限流请求上限必须大于 0");
    }
    const key =
      override?.key ??
      `${getClientIp(context, options.trustProxyHeader)}:${getRoutePrefix(context.req.path)}`;
    const maxRequests = override?.maxRequests ?? options.maxRequests;
    const existingBucket = buckets.get(key);
    const bucket =
      existingBucket === undefined || currentTime >= existingBucket.resetAt
        ? { count: 0, resetAt: currentTime + options.windowMs }
        : existingBucket;
    bucket.count += 1;
    if (existingBucket === undefined) makeRoom(currentTime);
    buckets.set(key, bucket);
    if (bucket.count > maxRequests) {
      return context.json(
        {
          error: "rate_limit_exceeded",
          message: "请求过于频繁，请稍后重试",
          disclaimer: DISCLAIMER,
        },
        429,
      );
    }
    await next();
  };
}
