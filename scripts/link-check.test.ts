import { describe, expect, it, vi } from "vitest";

import type { RulesFile } from "../src/schemas/index.js";
import { checkSourceLinks, collectSourceUrls, type LinkFetcher } from "./link-check.js";

const rulesFile: RulesFile = {
  module: "sg-msb",
  version: "2026.07.1",
  updated_at: "2026-07-24T00:00:00Z",
  rules: [
    {
      id: "first",
      when: {},
      required_evidence: [],
      result_if_missing: "HOLD",
      always_escalate: false,
      source: "First source",
      source_url: "https://example.test/first",
      accessed_date: "2026-07-23",
      note: "测试",
    },
    {
      id: "second",
      when: {},
      required_evidence: [],
      result_if_missing: "HOLD",
      always_escalate: false,
      source: "Second source",
      source_url: "https://example.test/exempt",
      accessed_date: "2026-07-23",
      note: "测试",
    },
  ],
};

describe("collectSourceUrls", () => {
  it("收集并去重排序规则法源链接", () => {
    expect(collectSourceUrls([rulesFile, rulesFile])).toEqual([
      "https://example.test/exempt",
      "https://example.test/first",
    ]);
  });
});

describe("checkSourceLinks", () => {
  it("跳过豁免链接并报告明确的 HTTP 坏链接", async () => {
    const fetcher = vi.fn<LinkFetcher>().mockResolvedValue(new Response(null, { status: 404 }));
    const result = await checkSourceLinks(
      collectSourceUrls([rulesFile]),
      [{ url: "https://example.test/exempt", reason: "待核实" }],
      fetcher,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.exempted).toHaveLength(1);
    expect(result.failures).toEqual([{ url: "https://example.test/first", status: 404 }]);
  });

  it("将网络不可用与 HTTP 失败分开报告", async () => {
    const fetcher = vi.fn<LinkFetcher>().mockRejectedValue(new TypeError("fetch failed"));
    const result = await checkSourceLinks(collectSourceUrls([rulesFile]), [], fetcher);

    expect(result.failures).toEqual([]);
    expect(result.networkErrors).toHaveLength(2);
  });
});
