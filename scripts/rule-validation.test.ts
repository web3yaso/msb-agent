import { describe, expect, it } from "vitest";

import { validateRuleDocument } from "./rule-validation.js";

const validRule = {
  id: "test-rule",
  when: { activity: ["money_transmission"] },
  required_evidence: ["licence"],
  result_if_missing: "HOLD",
  always_escalate: false,
  source: "Test Act, section 1",
  source_url: "https://example.gov.test/act",
  accessed_date: "2026-07-23",
  note: "测试规则",
};

function createRulesFile(
  version = "2026.07.1",
  updatedAt = "2026-07-24T00:00:00Z",
  rule: unknown = validRule,
): string {
  return JSON.stringify({
    module: "us-msb",
    version,
    updated_at: updatedAt,
    rules: [rule],
  });
}

describe("validateRuleDocument", () => {
  it("拒绝缺少 source 的坏规则 fixture", () => {
    const ruleWithoutSource: Record<string, unknown> = { ...validRule };
    delete ruleWithoutSource.source;
    const result = validateRuleDocument({
      path: "fixture/missing-source.json",
      content: createRulesFile("2026.07.1", "2026-07-24T00:00:00Z", ruleWithoutSource),
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("rules.0.source")]),
    );
  });

  it("规则内容变化但 version 未递增时失败", () => {
    const result = validateRuleDocument({
      path: "fixture/stale-version.json",
      previousContent: createRulesFile(),
      content: createRulesFile("2026.07.1", "2026-07-25T00:00:00Z", {
        ...validRule,
        note: "规则内容已变化",
      }),
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("version 必须高于上一版")]),
    );
  });

  it("规则内容变化但 updated_at 未更新时失败", () => {
    const result = validateRuleDocument({
      path: "fixture/stale-updated-at.json",
      previousContent: createRulesFile(),
      content: createRulesFile("2026.07.2", "2026-07-24T00:00:00Z", {
        ...validRule,
        note: "规则内容已变化",
      }),
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("updated_at 必须晚于上一版")]),
    );
  });

  it("规则内容变化且 version 与 updated_at 均递增时通过", () => {
    const result = validateRuleDocument({
      path: "fixture/valid-bump.json",
      previousContent: createRulesFile(),
      content: createRulesFile("2026.07.2", "2026-07-25T00:00:00Z", {
        ...validRule,
        note: "规则内容已变化",
      }),
    });

    expect(result.errors).toEqual([]);
  });
});
