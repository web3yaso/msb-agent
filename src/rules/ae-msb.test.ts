import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { evaluate } from "../engine/index.js";
import {
  RulesFileSchema,
  type Activity,
  type CheckBasis,
  type CheckStatus,
  type DealInput,
  type RulesFile,
} from "../schemas/index.js";

const RULES_FILE_URL = new URL("./ae-msb.json", import.meta.url);
const rulesFileBytes = await readFile(RULES_FILE_URL);
const parsedJson: unknown = JSON.parse(rulesFileBytes.toString("utf8"));
const rulesFile: RulesFile = RulesFileSchema.parse(parsedJson);

const validEvidence = {
  aml_cft_program: { approved_at: "2026-07-01" },
  cbuae_rps_license: "RPS-123",
  goaml_registration: "GOAML-123",
  originator_beneficiary_information: true,
  vara_or_fsra_vasp_license: "VARA-123",
};

interface TriggerCase {
  ruleId: string;
  activity: Activity;
  expectedResult: CheckStatus;
  expectedBasis?: CheckBasis;
  expectedReason: string;
}

const paymentTokenRule = rulesFile.rules.find(({ id }) => id === "ae-payment-token-restrictions");

if (paymentTokenRule === undefined) {
  throw new Error("缺少规则 ae-payment-token-restrictions");
}

const triggerCases: TriggerCase[] = [
  {
    ruleId: "ae-cbuae-rps-license",
    activity: "money_transmission",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
  },
  {
    ruleId: "ae-aml-cft-program",
    activity: "check_cashing",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
  },
  {
    ruleId: "ae-goaml-registration",
    activity: "currency_exchange",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
  },
  {
    ruleId: "ae-wire-transfer-information",
    activity: "money_transmission",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
  },
  {
    ruleId: "ae-vasp-license-path",
    activity: "crypto_transfer",
    expectedResult: "PASS",
    expectedReason: "所需证据齐全",
  },
  {
    ruleId: "ae-payment-token-restrictions",
    activity: "crypto_transfer",
    expectedResult: "ESCALATE",
    expectedBasis: "manual_review",
    expectedReason: `规则无法确定性判定，需人工核实：${paymentTokenRule.note}`,
  },
];

const missingEvidenceCases = [
  {
    ruleId: "ae-cbuae-rps-license",
    activity: "money_transmission" as const,
    expectedResult: "HOLD" as const,
    evidenceKey: "cbuae_rps_license",
  },
  {
    ruleId: "ae-aml-cft-program",
    activity: "check_cashing" as const,
    expectedResult: "HOLD" as const,
    evidenceKey: "aml_cft_program",
  },
  {
    ruleId: "ae-goaml-registration",
    activity: "currency_exchange" as const,
    expectedResult: "HOLD" as const,
    evidenceKey: "goaml_registration",
  },
  {
    ruleId: "ae-wire-transfer-information",
    activity: "money_transmission" as const,
    expectedResult: "HOLD" as const,
    evidenceKey: "originator_beneficiary_information",
  },
  {
    ruleId: "ae-vasp-license-path",
    activity: "crypto_transfer" as const,
    expectedResult: "ESCALATE" as const,
    evidenceKey: "vara_or_fsra_vasp_license",
  },
];

function createInput(
  activity: Activity,
  evidence: DealInput["evidence"] = validEvidence,
  country = "AE",
): DealInput {
  return {
    deal_id: `test-ae-${activity}`,
    parties: [{ role: "payer", country }],
    activity,
    amount_usdc: 10_000,
    evidence,
  };
}

function findCheck(result: ReturnType<typeof evaluate>, ruleId: string) {
  const check = result.checks.find(({ id }) => id === ruleId);

  expect(check, `缺少规则 ${ruleId} 的检查结果`).toBeDefined();
  return check;
}

describe("ae-msb 规则文件", () => {
  it("符合规则文件 schema 并携带指定模块版本", () => {
    expect(rulesFile.module).toBe("ae-msb");
    expect(rulesFile.version).toBe("2026.08.1");
    expect(rulesFile.rules).toHaveLength(6);
  });

  it.each(triggerCases)("$ruleId 在适用输入下触发", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase.activity), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: testCase.expectedResult,
      ...(testCase.expectedBasis === undefined ? {} : { basis: testCase.expectedBasis }),
      reason: testCase.expectedReason,
    });
  });

  it.each(triggerCases)("$ruleId 在阿联酋法域外不触发", (testCase) => {
    const result = evaluate(
      rulesFile.rules,
      createInput(testCase.activity, validEvidence, "US"),
      rulesFileBytes,
    );

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: "NOT_APPLICABLE",
      basis: "not_applicable",
      reason: "规则条件未触发",
    });
  });

  it.each(missingEvidenceCases)("$ruleId 缺证据时按规则输出", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase.activity, {}), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: testCase.expectedResult,
      basis: "missing_evidence",
      reason: `缺少所需证据：${testCase.evidenceKey}`,
    });
  });

  it("AE crypto_transfer 证据齐全时仍聚合为 ESCALATE", () => {
    const result = evaluate(rulesFile.rules, createInput("crypto_transfer"), rulesFileBytes);

    expect(result.overall).toBe("ESCALATE");
  });

  it("AE check_cashing 证据齐全时聚合为 PASS", () => {
    const result = evaluate(rulesFile.rules, createInput("check_cashing"), rulesFileBytes);

    expect(result.overall).toBe("PASS");
  });
});
