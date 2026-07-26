import type { HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

function createTestApp(options: {
  maxBuckets?: number;
  now?: () => number;
  resolveBucket?: () => { key: string; maxRequests: number } | undefined;
  shouldSkip?: () => boolean;
  trustProxyHeader?: boolean;
}) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.use(
    "*",
    createRateLimiter({
      maxRequests: 1,
      maxBuckets: options.maxBuckets,
      now: options.now,
      resolveBucket: options.resolveBucket,
      shouldSkip: options.shouldSkip,
      trustProxyHeader: options.trustProxyHeader ?? false,
      windowMs: 100,
    }),
  );
  app.get("*", (context) => context.text("ok"));
  return app;
}

function requestFrom(
  app: ReturnType<typeof createTestApp>,
  address: string,
  headers?: HeadersInit,
): Response | Promise<Response> {
  const incoming = {
    socket: { remoteAddress: address, remoteFamily: "IPv4", remotePort: 1234 },
  } as unknown as HttpBindings["incoming"];
  return app.request("/resource", { headers }, { incoming });
}
describe("createRateLimiter", () => {
  it("拒绝非正整数配置", () => {
    expect(() =>
      createRateLimiter({
        maxRequests: Number.NaN,
        trustProxyHeader: false,
        windowMs: 100,
      }),
    ).toThrow("必须大于 0");
  });
  it("窗口内第 N+1 次返回 429 且含免责声明", async () => {
    const app = createTestApp({});
    expect((await app.request("/resource")).status).toBe(200);
    const response = await app.request("/resource");
    expect(response.status).toBe(429);
    expect(await response.json()).toHaveProperty("disclaimer");
  });
  it("窗口过期后恢复", async () => {
    let currentTime = 0;
    const app = createTestApp({ now: () => currentTime });
    await app.request("/resource");
    currentTime = 101;
    expect((await app.request("/resource")).status).toBe(200);
  });
  it("可信代理下不同 IP 独立计数", async () => {
    const app = createTestApp({ trustProxyHeader: true });
    await app.request("/resource", { headers: { "x-forwarded-for": "192.0.2.1" } });
    expect(
      (
        await app.request("/resource", {
          headers: { "x-forwarded-for": "192.0.2.2" },
        })
      ).status,
    ).toBe(200);
  });
  it("不信任代理头时伪造头不改变分桶", async () => {
    const app = createTestApp({ trustProxyHeader: false });
    await requestFrom(app, "203.0.113.1", {
      "x-forwarded-for": "192.0.2.1",
      "x-real-ip": "192.0.2.10",
    });
    expect(
      (
        await requestFrom(app, "203.0.113.1", {
          "x-forwarded-for": "192.0.2.2",
          "x-real-ip": "192.0.2.20",
        })
      ).status,
    ).toBe(429);
  });
  it("无代理头时不同连接按对端地址独立分桶", async () => {
    const app = createTestApp({ trustProxyHeader: false });
    await requestFrom(app, "203.0.113.1");
    expect((await requestFrom(app, "203.0.113.2")).status).toBe(200);
  });
  it("同一路由前缀不因路径参数变化而拆分桶", async () => {
    const app = createTestApp({});
    await app.request("/modules/us-msb/schema");
    expect((await app.request("/modules/eu-msb/schema")).status).toBe(429);
  });
  it("shouldSkip 放行且不计数", async () => {
    const app = createTestApp({ shouldSkip: () => true });
    expect((await app.request("/resource")).status).toBe(200);
    expect((await app.request("/resource")).status).toBe(200);
  });
  it("过期条目会在容量检查时惰性清理", async () => {
    let currentTime = 0;
    const app = createTestApp({
      maxBuckets: 2,
      now: () => currentTime,
      trustProxyHeader: true,
    });
    await app.request("/resource", { headers: { "x-forwarded-for": "192.0.2.1" } });
    await app.request("/resource", { headers: { "x-forwarded-for": "192.0.2.2" } });
    currentTime = 101;

    expect(
      (
        await app.request("/resource", {
          headers: { "x-forwarded-for": "192.0.2.3" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/resource", {
          headers: { "x-forwarded-for": "192.0.2.1" },
        })
      ).status,
    ).toBe(200);
  });
  it("达到 Map 上限时淘汰最旧条目", async () => {
    const app = createTestApp({ maxBuckets: 2, trustProxyHeader: true });
    await app.request("/resource", { headers: { "x-forwarded-for": "192.0.2.1" } });
    await app.request("/resource", { headers: { "x-forwarded-for": "192.0.2.2" } });
    await app.request("/resource", { headers: { "x-forwarded-for": "192.0.2.3" } });

    expect(
      (
        await app.request("/resource", {
          headers: { "x-forwarded-for": "192.0.2.1" },
        })
      ).status,
    ).toBe(200);
  });
  it("自定义桶使用独立 key 和宽松上限", async () => {
    const app = createTestApp({
      resolveBucket: () => ({ key: "paid-retry:credential", maxRequests: 2 }),
    });
    expect((await app.request("/resource")).status).toBe(200);
    expect((await app.request("/resource")).status).toBe(200);
    expect((await app.request("/resource")).status).toBe(429);
  });
});
