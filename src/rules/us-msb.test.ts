import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { evaluate } from "../engine/index.js";
import {
  RulesFileSchema,
  type Activity,
  type DealInput,
  type RulesFile,
} from "../schemas/index.js";

const RULES_FILE_URL = new URL("./us-msb.json", import.meta.url);
const rulesFileBytes = await readFile(RULES_FILE_URL);
const parsedJson: unknown = JSON.parse(rulesFileBytes.toString("utf8"));
const rulesFile: RulesFile = RulesFileSchema.parse(parsedJson);

const validEvidence = {
  fincen_msb_registration: true,
  bsa_aml_program: { approved_at: "2026-07-01" },
  sar_monitoring_and_filing_controls: true,
  ny_money_transmitter_license: "NY-MT-123",
  ny_bitlicense: "NY-VC-123",
};

interface TriggerCase {
  ruleId: string;
  activity: Activity;
  amountUsdc?: number;
  state?: string;
}

const triggerCases: TriggerCase[] = [
  {
    ruleId: "us-fincen-registration-money-transmission",
    activity: "money_transmission",
  },
  {
    ruleId: "us-fincen-registration-threshold-activities",
    activity: "currency_exchange",
    amountUsdc: 1000.000001,
  },
  {
    ruleId: "us-bsa-aml-program",
    activity: "money_transmission",
  },
  {
    ruleId: "us-sar-controls",
    activity: "money_transmission",
  },
  {
    ruleId: "us-ny-money-transmitter-license",
    activity: "money_transmission",
    state: "NY",
  },
  {
    ruleId: "us-ny-bitlicense",
    activity: "crypto_transfer",
    state: "NY",
  },
];

function createInput(testCase: TriggerCase, country = "US"): DealInput {
  return {
    deal_id: `test-${testCase.ruleId}`,
    parties: [
      {
        role: "payer",
        country,
        ...(testCase.state === undefined ? {} : { state: testCase.state }),
      },
    ],
    activity: testCase.activity,
    amount_usdc: testCase.amountUsdc ?? 10_000,
    evidence: validEvidence,
  };
}

function findCheck(result: ReturnType<typeof evaluate>, ruleId: string) {
  const check = result.checks.find(({ id }) => id === ruleId);

  expect(check, `缺少规则 ${ruleId} 的检查结果`).toBeDefined();
  return check;
}

describe("us-msb 规则文件", () => {
  it("符合规则文件 schema 并携带指定模块版本", () => {
    expect(rulesFile.module).toBe("us-msb");
    expect(rulesFile.version).toBe("2026.07.1");
    expect(rulesFile.rules).toHaveLength(triggerCases.length);
  });

  it.each(triggerCases)("$ruleId 在适用输入下触发并执行证据判定", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: "PASS",
      reason: "所需证据齐全",
    });
  });

  it.each(triggerCases)("$ruleId 在美国法域外不触发", (testCase) => {
    const result = evaluate(rulesFile.rules, createInput(testCase, "CA"), rulesFileBytes);

    expect(findCheck(result, testCase.ruleId)).toMatchObject({
      result: "PASS",
      reason: "规则条件未触发",
    });
  });
});
