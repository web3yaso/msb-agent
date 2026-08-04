import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { evaluate } from "../engine/index.js";
import {
  RulesFileSchema,
  type Activity,
  type CheckStatus,
  type DealInput,
  type RulesFile,
} from "../schemas/index.js";

const RULES_FILE_URL = new URL("./uk-msb.json", import.meta.url);
const rulesFileBytes = await readFile(RULES_FILE_URL);
const parsedJson: unknown = JSON.parse(rulesFileBytes.toString("utf8"));
const rulesFile: RulesFile = RulesFileSchema.parse(parsedJson);

const validEvidence = {
  fca_payment_institution_authorisation_or_registration: "FRN-123456",
  fca_emoney_authorisation_or_registration: "FRN-234567",
  hmrc_aml_registration_or_fca_supervision: "XAML00000123456",
  uk_aml_policies_and_controls: { approved_at: "2026-07-01" },
  uk_sar_monitoring_and_reporting_controls: true,
};

interface TriggerCase {
  ruleId: string;
  activity: Activity;
  expectedResult: CheckStatus;
  expectedReason: string;
}

const triggerCases: TriggerCase[] = [
  {
    ruleId: "uk-fca-payment-institution-authorisation",
    activity: "money_transmission",
    expectedResult: "PASS",
    expectedReason: "All required evidence provided",
  },
  {
    ruleId: "uk-fca-emoney-authorisation",
    activity: "stored_value",
    expectedResult: "PASS",
    expectedReason: "All required evidence provided",
  },
  {
    ruleId: "uk-hmrc-aml-supervision",
    activity: "currency_exchange",
    expectedResult: "PASS",
    expectedReason: "All required evidence provided",
  },
  {
    ruleId: "uk-mlr-policies-controls",
    activity: "check_cashing",
    expectedResult: "PASS",
    expectedReason: "All required evidence provided",
  },
  {
    ruleId: "uk-poca-sar-controls",
    activity: "money_transmission",
    expectedResult: "PASS",
    expectedReason: "All required evidence provided",
  },
  {
    ruleId: "uk-crypto-regulatory-perimeter",
    activity: "crypto_transfer",
    expectedResult: "ESCALATE",
    expectedReason:
      "Cannot be decided deterministically; manual review required: 现有 when 无法表达代币性质、具体受规管活动、豁免和金融推广等监管边界，必须转人工核实",
  },
];

function createInput(testCase: TriggerCase, country = "GB"): DealInput {
  return {
    deal_id: `test-${testCase.ruleId}`,
    parties: [{ role: "payer", country }],
    activity: testCase.activity,
    amount_usdc: 10_000,
    evidence: validEvidence,
  };
}

function findCheck(result: ReturnType<typeof evaluate>, ruleId: string) {
  const check = result.checks.find(({ id }) => id === ruleId);

  expect(check, `缺少规则 ${ruleId} 的检查结果`).toBeDefined();
  return check;
}

describe("uk-msb 规则文件", () => {
  it("符合规则文件 schema 并携带指定模块版本", () => {
    expect(rulesFile.module).toBe("uk-msb");
    expect(rulesFile.version).toBe("2026.07.1");
    expect(rulesFile.rules).toHaveLength(triggerCases.length);
  });

  it.each(triggerCases)("$ruleId 在适用输入下触发", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: testCase.expectedResult,
      reason: testCase.expectedReason,
    });
  });

  it.each(triggerCases)("$ruleId 在英国法域外不触发", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase, "US"), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: "NOT_APPLICABLE",
      basis: "not_applicable",
      reason: "Rule conditions not triggered by this deal",
    });
  });
});
