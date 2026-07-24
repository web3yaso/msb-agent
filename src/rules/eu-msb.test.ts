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

const RULES_FILE_URL = new URL("./eu-msb.json", import.meta.url);
const rulesFileBytes = await readFile(RULES_FILE_URL);
const parsedJson: unknown = JSON.parse(rulesFileBytes.toString("utf8"));
const rulesFile: RulesFile = RulesFileSchema.parse(parsedJson);

const validEvidence = {
  eu_payment_institution_authorisation: "EU-PI-123",
  eu_emoney_institution_authorisation: "EU-EMI-123",
  eu_aml_policies_and_controls: { approved_at: "2026-07-01" },
  mica_casp_authorisation: "EU-CASP-123",
  eu_transfer_information_controls: true,
  bafin_payment_or_emoney_authorisation: "DE-ZAG-123",
  acpr_payment_or_emoney_authorisation: "FR-ACPR-123",
  dnb_payment_or_emoney_authorisation: "NL-DNB-123",
};

interface TriggerCase {
  ruleId: string;
  activity: Activity;
  country: string;
  expectedResult: CheckStatus;
  expectedReason: string;
  nonTriggerActivity?: Activity;
  nonTriggerCountry?: string;
}

const triggerCases: TriggerCase[] = [
  {
    ruleId: "eu-psd2-payment-institution-authorisation",
    activity: "money_transmission",
    country: "DE",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    nonTriggerActivity: "check_cashing",
  },
  {
    ruleId: "eu-emd2-emoney-authorisation",
    activity: "stored_value",
    country: "DE",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    nonTriggerActivity: "check_cashing",
  },
  {
    ruleId: "eu-amld-policies-controls",
    activity: "currency_exchange",
    country: "FR",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    nonTriggerActivity: "check_cashing",
  },
  {
    ruleId: "eu-mica-casp-authorisation",
    activity: "crypto_transfer",
    country: "NL",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    nonTriggerActivity: "check_cashing",
  },
  {
    ruleId: "eu-transfer-information-controls",
    activity: "money_transmission",
    country: "FR",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    nonTriggerActivity: "check_cashing",
  },
  {
    ruleId: "eu-amlr-2027-applicability",
    activity: "money_transmission",
    country: "DE",
    expectedResult: "ESCALATE",
    expectedReason:
      "规则无法确定性判定，需人工核实：AMLR 已生效但主体条款尚未适用，将自 2027-07-10 起适用；本项仅提示过渡准备并转人工，不把未来条款表述为当前违规",
    nonTriggerActivity: "check_cashing",
  },
  {
    ruleId: "eu-de-bafin-payment-emoney-authorisation",
    activity: "money_transmission",
    country: "DE",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    nonTriggerCountry: "US",
  },
  {
    ruleId: "eu-fr-acpr-payment-emoney-authorisation",
    activity: "money_transmission",
    country: "FR",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    nonTriggerCountry: "US",
  },
  {
    ruleId: "eu-nl-dnb-payment-emoney-authorisation",
    activity: "stored_value",
    country: "NL",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
    nonTriggerCountry: "US",
  },
];

function createInput(testCase: TriggerCase, isTriggered: boolean): DealInput {
  return {
    deal_id: `test-${testCase.ruleId}`,
    parties: [
      {
        role: "payer",
        country: isTriggered ? testCase.country : (testCase.nonTriggerCountry ?? testCase.country),
      },
    ],
    activity: isTriggered ? testCase.activity : (testCase.nonTriggerActivity ?? testCase.activity),
    amount_usdc: 10_000,
    evidence: validEvidence,
  };
}

function findCheck(result: ReturnType<typeof evaluate>, ruleId: string) {
  const check = result.checks.find(({ id }) => id === ruleId);

  expect(check, `缺少规则 ${ruleId} 的检查结果`).toBeDefined();
  return check;
}

describe("eu-msb 规则文件", () => {
  it("符合规则文件 schema 并携带指定模块版本", () => {
    expect(rulesFile.module).toBe("eu-msb");
    expect(rulesFile.version).toBe("2026.07.2");
    expect(rulesFile.rules).toHaveLength(triggerCases.length);
  });

  it.each(triggerCases)("$ruleId 在适用输入下触发", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase, true), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: testCase.expectedResult,
      reason: testCase.expectedReason,
    });
  });

  it.each(triggerCases)("$ruleId 在条件不匹配时不触发", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase, false), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: "PASS",
      reason: "规则条件未触发",
    });
  });
});
