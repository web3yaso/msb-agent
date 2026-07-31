import { describe, expect, it } from "vitest";

import type { CheckResult, DealInput, Rule } from "../schemas/index.js";
import { aggregateCheckStatus, evaluate } from "./index.js";

const baseInput: DealInput = {
  deal_id: "job-123",
  parties: [
    { role: "payer", country: "US", state: "NY" },
    { role: "payee", country: "SG" },
  ],
  activity: "money_transmission",
  amount_usdc: 10_000,
  monthly_volume_usdc: 4_000_000,
  evidence: {
    fincen_registration: true,
    state_licenses: ["NY"],
  },
};

const baseRule: Rule = {
  id: "us-fincen-registration",
  when: {
    activity: ["money_transmission"],
    party_country: "US",
  },
  required_evidence: ["fincen_registration"],
  result_if_missing: "HOLD",
  always_escalate: false,
  source: "31 CFR § 1022.380",
  source_url: "https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1022",
  accessed_date: "2026-07-23",
  note: "FinCEN 注册证据检查",
};

function encodeRules(rules: readonly Rule[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(rules));
}

describe("evaluate", () => {
  it("匹配 activity 和任一 party，并根据证据输出 PASS 或 HOLD", () => {
    const rules = [baseRule];

    expect(evaluate(rules, baseInput, encodeRules(rules)).checks[0]?.result).toBe("PASS");
    expect(
      evaluate(
        rules,
        {
          ...baseInput,
          evidence: { fincen_registration: false },
        },
        encodeRules(rules),
      ).checks[0],
    ).toMatchObject({
      id: baseRule.id,
      result: "HOLD",
      source: baseRule.source,
    });
  });

  it("要求 country 和 state 条件由同一 party 满足，并支持 role 定向匹配", () => {
    const scopedRule: Rule = {
      ...baseRule,
      id: "us-payer-ny",
      when: {
        party_country: { role: "payer", country: "US" },
        party_state: { role: "payer", state: "NY" },
      },
    };
    const rules = [scopedRule];

    expect(evaluate(rules, baseInput, encodeRules(rules)).checks[0]?.result).toBe("PASS");
    expect(
      evaluate(
        rules,
        {
          ...baseInput,
          parties: [
            { role: "payer", country: "US" },
            { role: "payee", country: "SG", state: "NY" },
          ],
        },
        encodeRules(rules),
      ).checks[0],
    ).toMatchObject({
      result: "NOT_APPLICABLE",
      basis: "not_applicable",
      reason: "规则条件未触发",
    });
  });

  it("单笔金额低于门槛时输出 HOLD，不误报 PASS", () => {
    const thresholdRule: Rule = {
      ...baseRule,
      id: "us-amount-threshold",
      when: { party_country: "US", amount_gte: 20_000 },
      required_evidence: [],
    };
    const rules = [thresholdRule];
    const result = evaluate(rules, baseInput, encodeRules(rules));

    expect(result.checks[0]).toMatchObject({
      result: "HOLD",
      basis: "insufficient_aggregate_data",
      reason: "单笔未达门槛，聚合情形需采购方自行核实",
    });
  });

  it("单笔金额等于或高于门槛时继续执行证据判定", () => {
    const thresholdRule: Rule = {
      ...baseRule,
      id: "us-amount-boundary",
      when: { party_country: "US", amount_gte: 20_000 },
    };
    const rules = [thresholdRule];
    const rulesBytes = encodeRules(rules);

    expect(
      evaluate(rules, { ...baseInput, amount_usdc: 20_000 }, rulesBytes).checks[0],
    ).toMatchObject({
      result: "PASS",
      basis: "caller_assertion",
      reason: "所需证据齐全",
    });
    expect(
      evaluate(rules, { ...baseInput, amount_usdc: 20_001 }, rulesBytes).checks[0],
    ).toMatchObject({
      result: "PASS",
      basis: "caller_assertion",
      reason: "所需证据齐全",
    });
  });

  it("月交易量缺失时 HOLD，明确低于门槛时标记为不适用", () => {
    const volumeRule: Rule = {
      ...baseRule,
      id: "sg-monthly-volume",
      when: { party_country: "SG", monthly_volume_gte: 6_000_000 },
      required_evidence: [],
    };
    const rules = [volumeRule];

    expect(
      evaluate(rules, { ...baseInput, monthly_volume_usdc: null }, encodeRules(rules)).checks[0],
    ).toMatchObject({
      result: "HOLD",
      basis: "insufficient_aggregate_data",
      reason: "无法判定分级，需补交易量数据",
    });
    expect(evaluate(rules, baseInput, encodeRules(rules)).checks[0]).toMatchObject({
      result: "NOT_APPLICABLE",
      basis: "deterministic_threshold",
      reason: "月交易量未达规则门槛",
    });
  });

  it("适用规则无证据要求且不强制升级时防御性输出 ESCALATE", () => {
    const emptyRule: Rule = {
      ...baseRule,
      id: "empty-applicable-rule",
      when: { party_country: "US" },
      required_evidence: [],
    };
    const rules = [emptyRule];

    expect(evaluate(rules, baseInput, encodeRules(rules)).checks[0]).toMatchObject({
      result: "ESCALATE",
      basis: "manual_review",
      reason: "规则未定义任何可判定条件，需人工核实",
    });
  });

  it("月交易量等于或高于门槛时继续执行证据判定", () => {
    const volumeRule: Rule = {
      ...baseRule,
      id: "sg-monthly-volume-boundary",
      when: { party_country: "SG", monthly_volume_gte: 6_000_000 },
    };
    const rules = [volumeRule];
    const rulesBytes = encodeRules(rules);

    expect(
      evaluate(rules, { ...baseInput, monthly_volume_usdc: 6_000_000 }, rulesBytes).checks[0],
    ).toMatchObject({
      result: "PASS",
      basis: "caller_assertion",
      reason: "所需证据齐全",
    });
    expect(
      evaluate(
        rules,
        {
          ...baseInput,
          monthly_volume_usdc: 6_000_001,
          evidence: {},
        },
        rulesBytes,
      ).checks[0],
    ).toMatchObject({
      result: "HOLD",
      basis: "missing_evidence",
      reason: "缺少所需证据：fincen_registration",
    });
  });

  it("证据缺失且 result_if_missing 为 ESCALATE 时升级整体结果", () => {
    const escalationRule: Rule = {
      ...baseRule,
      id: "missing-evidence-escalation",
      required_evidence: ["manual_approval"],
      result_if_missing: "ESCALATE",
    };
    const rules = [escalationRule];
    const result = evaluate(rules, baseInput, encodeRules(rules));

    expect(result.checks[0]?.result).toBe("ESCALATE");
    expect(result.overall).toBe("ESCALATE");
  });

  it("activity 不匹配时输出 NOT_APPLICABLE", () => {
    const activityRule: Rule = {
      ...baseRule,
      id: "currency-exchange-only",
      when: {
        ...baseRule.when,
        activity: ["currency_exchange"],
      },
      required_evidence: ["missing_evidence"],
    };
    const rules = [activityRule];

    expect(evaluate(rules, baseInput, encodeRules(rules)).checks[0]).toMatchObject({
      result: "NOT_APPLICABLE",
      basis: "not_applicable",
      reason: "规则条件未触发",
    });
  });

  it("支持 party_state 纯字符串形式的匹配与不匹配", () => {
    const stateRule: Rule = {
      ...baseRule,
      id: "ny-state-rule",
      when: { party_state: "NY" },
    };
    const rules = [stateRule];
    const rulesBytes = encodeRules(rules);

    expect(evaluate(rules, baseInput, rulesBytes).checks[0]).toMatchObject({
      result: "PASS",
      reason: "所需证据齐全",
    });
    expect(
      evaluate(
        rules,
        {
          ...baseInput,
          parties: [
            { role: "payer", country: "US", state: "CA" },
            { role: "payee", country: "SG" },
          ],
        },
        rulesBytes,
      ).checks[0],
    ).toMatchObject({
      result: "NOT_APPLICABLE",
      basis: "not_applicable",
      reason: "规则条件未触发",
    });
  });

  it("原型链键名未由 evidence 显式提供时仍判定为证据缺失", () => {
    const prototypeKeyRule: Rule = {
      ...baseRule,
      id: "prototype-key-evidence",
      required_evidence: ["toString"],
    };
    const rules = [prototypeKeyRule];

    expect(
      evaluate(rules, { ...baseInput, evidence: {} }, encodeRules(rules)).checks[0],
    ).toMatchObject({
      result: "HOLD",
      basis: "missing_evidence",
      reason: "缺少所需证据：toString",
    });
  });

  it("always_escalate 对适用规则输出 ESCALATE，且不会静默跳过规则", () => {
    const escalationRule: Rule = {
      ...baseRule,
      id: "us-manual-review",
      when: { ...baseRule.when, amount_gte: 20_000 },
      required_evidence: [],
      always_escalate: true,
      note: "现有 when 无法表达实际法定条件",
    };
    const rules = [escalationRule];
    const result = evaluate(rules, baseInput, encodeRules(rules));

    expect(result.checks).toHaveLength(rules.length);
    expect(result.checks[0]).toMatchObject({
      result: "ESCALATE",
      basis: "manual_review",
      source: escalationRule.source,
    });
  });

  it("聚合取最坏结果，并保持重复求值完全确定", () => {
    const holdRule: Rule = {
      ...baseRule,
      id: "missing-state-license",
      required_evidence: ["missing_license"],
    };
    const escalationRule: Rule = {
      ...baseRule,
      id: "manual-review",
      required_evidence: [],
      always_escalate: true,
    };
    const rules = [baseRule, holdRule, escalationRule];
    const rulesBytes = encodeRules(rules);

    const firstResult = evaluate(rules, baseInput, rulesBytes);
    const secondResult = evaluate(rules, baseInput, rulesBytes);

    expect(firstResult.overall).toBe("ESCALATE");
    expect(secondResult).toEqual(firstResult);
  });
});

describe("aggregateCheckStatus", () => {
  const createCheck = (result: CheckResult["result"]): CheckResult => ({
    id: result,
    result,
    basis: result === "NOT_APPLICABLE" ? "not_applicable" : "caller_assertion",
    reason: result,
    source: "测试法源",
  });

  it("按 ESCALATE、HOLD、PASS 顺序取最坏状态，并将 NOT_APPLICABLE 视为中性", () => {
    expect(aggregateCheckStatus([createCheck("PASS")])).toBe("PASS");
    expect(aggregateCheckStatus([createCheck("NOT_APPLICABLE"), createCheck("PASS")])).toBe("PASS");
    expect(
      aggregateCheckStatus([
        createCheck("NOT_APPLICABLE"),
        createCheck("PASS"),
        createCheck("HOLD"),
      ]),
    ).toBe("HOLD");
    expect(
      aggregateCheckStatus([
        createCheck("NOT_APPLICABLE"),
        createCheck("PASS"),
        createCheck("HOLD"),
        createCheck("ESCALATE"),
      ]),
    ).toBe("ESCALATE");
  });

  it("所有检查均不适用时返回 NOT_APPLICABLE", () => {
    expect(
      aggregateCheckStatus([createCheck("NOT_APPLICABLE"), createCheck("NOT_APPLICABLE")]),
    ).toBe("NOT_APPLICABLE");
  });
});
