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

const RULES_FILE_URL = new URL("./sg-msb.json", import.meta.url);
const rulesFileBytes = await readFile(RULES_FILE_URL);
const parsedJson: unknown = JSON.parse(rulesFileBytes.toString("utf8"));
const rulesFile: RulesFile = RulesFileSchema.parse(parsedJson);

const validEvidence = {
  mas_major_payment_institution_licence: "MPI-123",
  mas_financial_institution_directory_entry: "FID-123",
  mas_psn01_aml_cft_program: { approved_at: "2026-07-01" },
  mas_psn02_dpt_aml_cft_program: { approved_at: "2026-07-01" },
};

interface TriggerCase {
  ruleId: string;
  activity: Activity;
  expectedResult: CheckStatus;
  expectedReason: string;
  monthlyVolumeUsdc?: number;
}

const triggerCases: TriggerCase[] = [
  {
    ruleId: "sg-psa-licence-class",
    activity: "money_transmission",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    monthlyVolumeUsdc: 2_320_903.605137,
  },
  {
    ruleId: "sg-mas-register-lookup",
    activity: "currency_exchange",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
  },
  {
    ruleId: "sg-psn01-aml-program",
    activity: "money_transmission",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
  },
  {
    ruleId: "sg-psn02-dpt-aml-program",
    activity: "crypto_transfer",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
  },
  {
    ruleId: "sg-dpt-scope",
    activity: "crypto_transfer",
    expectedResult: "ESCALATE",
    expectedReason:
      "规则无法确定性判定，需人工核实：2021 修正案自 2024-04-04 起施行并扩展 DPT 服务范围；现有 activity 无法表达代币账户、托管、转移安排、境内外服务对象及过渡豁免，必须转人工核实",
  },
];

function createInput(testCase: TriggerCase, country = "SG"): DealInput {
  return {
    deal_id: `test-${testCase.ruleId}`,
    parties: [{ role: "payer", country }],
    activity: testCase.activity,
    amount_usdc: 10_000,
    ...(testCase.monthlyVolumeUsdc === undefined
      ? {}
      : { monthly_volume_usdc: testCase.monthlyVolumeUsdc }),
    evidence: validEvidence,
  };
}

function findCheck(result: ReturnType<typeof evaluate>, ruleId: string) {
  const check = result.checks.find(({ id }) => id === ruleId);

  expect(check, `缺少规则 ${ruleId} 的检查结果`).toBeDefined();
  return check;
}

describe("sg-msb 规则文件", () => {
  it("符合规则文件 schema 并携带指定模块版本", () => {
    expect(rulesFile.module).toBe("sg-msb");
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

  it.each(triggerCases)("$ruleId 在新加坡法域外不触发", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase, "US"), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: "PASS",
      reason: "规则条件未触发",
    });
  });

  it("sg-psa-licence-class 缺少月交易量时输出 HOLD", () => {
    const testCase = triggerCases[0];

    const input = createInput(testCase);
    delete input.monthly_volume_usdc;
    const result = evaluate(rulesFile.rules, input, rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: "HOLD",
      reason: "无法判定分级，需补交易量数据",
    });
  });
});
