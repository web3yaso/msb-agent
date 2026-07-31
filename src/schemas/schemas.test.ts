import { describe, expect, it } from "vitest";

import {
  CheckResultSchema,
  DealInputSchema,
  EvmAddressSchema,
  ModuleResponseSchema,
  RoyaltyBpsSchema,
  RulesFileSchema,
  RuleSchema,
  SettlementConstraintsSchema,
} from "./index.js";

const EVIDENCE_HASH = "a".repeat(64);
const MAINTAINER_WALLET = "0x1111111111111111111111111111111111111111";

const validDealInput = {
  deal_id: "job-123",
  parties: [
    { role: "payer", country: "US", state: "NY" },
    { role: "payee", country: "SG" },
  ],
  activity: "money_transmission",
  amount_usdc: 10_000,
  monthly_volume_usdc: null,
  evidence: {
    fincen_msb_registration: false,
    state_mt_licenses: [],
  },
};

const validCheckResult = {
  id: "us-fincen-registration",
  result: "HOLD",
  basis: "missing_evidence",
  reason: "缺少 FinCEN MSB 注册证据",
  source: "31 CFR § 1022.380",
};

const validSettlementConstraints = {
  module: "us-msb",
  module_version: "2026.07.1",
  deal_id: "job-123",
  valid_until: "2026-07-27T00:00:00Z",
  blocked_check_ids: ["us-fincen-registration"],
  escalated_check_ids: [],
  evaluated_check_count: 1,
  evidence_hash: EVIDENCE_HASH,
};

const validRule = {
  id: "us-fincen-registration",
  when: {
    activity: ["money_transmission"],
    party_country: "US",
  },
  required_evidence: ["fincen_msb_registration"],
  result_if_missing: "HOLD",
  always_escalate: false,
  source: "31 CFR § 1022.380",
  source_url: "https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1022",
  accessed_date: "2026-07-23",
  note: "FinCEN 注册是联邦 AML 登记，不是全国经营牌照",
};

describe("DealInputSchema", () => {
  it("接受设计文档中的输入，并允许月交易量缺省或为 null", () => {
    expect(DealInputSchema.safeParse(validDealInput).success).toBe(true);

    const inputWithoutMonthlyVolume = { ...validDealInput };
    delete (inputWithoutMonthlyVolume as Partial<typeof validDealInput>).monthly_volume_usdc;

    expect(DealInputSchema.safeParse(inputWithoutMonthlyVolume).success).toBe(true);
  });

  it("拒绝未知 activity、负数金额和空 parties", () => {
    expect(
      DealInputSchema.safeParse({
        ...validDealInput,
        activity: "legal_advice",
        amount_usdc: -1,
        parties: [],
      }).success,
    ).toBe(false);
  });
});

describe("响应 schemas", () => {
  it("校验 EVM 地址和版税基点边界", () => {
    expect(EvmAddressSchema.safeParse(MAINTAINER_WALLET).success).toBe(true);
    expect(EvmAddressSchema.safeParse(`0x${"1".repeat(39)}`).success).toBe(false);
    expect(EvmAddressSchema.safeParse(`0x${"1".repeat(41)}`).success).toBe(false);
    expect(EvmAddressSchema.safeParse(`0x${"g".repeat(40)}`).success).toBe(false);

    for (const royaltyBps of [0, 500, 10_000]) {
      expect(RoyaltyBpsSchema.safeParse(royaltyBps).success).toBe(true);
    }
    for (const royaltyBps of [-1, 10_001, 1.5]) {
      expect(RoyaltyBpsSchema.safeParse(royaltyBps).success).toBe(false);
    }
  });

  it("接受 CheckResult 和 settlement_constraints 契约", () => {
    expect(CheckResultSchema.safeParse(validCheckResult).success).toBe(true);
    expect(SettlementConstraintsSchema.safeParse(validSettlementConstraints).success).toBe(true);
  });

  it("settlement_constraints 要求已评估检查数", () => {
    const constraintsWithoutEvaluatedCount: Record<string, unknown> = {
      ...validSettlementConstraints,
    };
    delete constraintsWithoutEvaluatedCount.evaluated_check_count;

    expect(SettlementConstraintsSchema.safeParse(constraintsWithoutEvaluatedCount).success).toBe(
      false,
    );
  });

  it("接受包含 updated_at 和 escalated_check_ids 的 ModuleResponse", () => {
    expect(
      ModuleResponseSchema.safeParse({
        module: "us-msb",
        version: "2026.07.1",
        engine_version: "1.0.0",
        hash_scheme_version: "2",
        updated_at: "2026-07-24T00:00:00Z",
        maintainer_wallet: MAINTAINER_WALLET,
        royalty_bps: 500,
        checks: [validCheckResult],
        overall: "HOLD",
        settlement_constraints: validSettlementConstraints,
        evidence_hash: EVIDENCE_HASH,
        disclaimer: "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。",
      }).success,
    ).toBe(true);
  });

  it("拒绝缺失或非法版税字段，并接受合法响应", () => {
    const validResponse = {
      module: "us-msb",
      version: "2026.07.1",
      engine_version: "1.0.0",
      hash_scheme_version: "2",
      updated_at: "2026-07-24T00:00:00Z",
      maintainer_wallet: MAINTAINER_WALLET,
      royalty_bps: 500,
      checks: [validCheckResult],
      overall: "HOLD",
      settlement_constraints: validSettlementConstraints,
      evidence_hash: EVIDENCE_HASH,
      disclaimer: "不构成法律意见。",
    };
    const missingRoyaltyFields: Record<string, unknown> = { ...validResponse };
    delete missingRoyaltyFields.maintainer_wallet;
    delete missingRoyaltyFields.royalty_bps;

    expect(ModuleResponseSchema.safeParse(validResponse).success).toBe(true);
    expect(ModuleResponseSchema.safeParse(missingRoyaltyFields).success).toBe(false);
    expect(ModuleResponseSchema.safeParse({ ...validResponse, royalty_bps: 10_001 }).success).toBe(
      false,
    );
    expect(
      ModuleResponseSchema.safeParse({ ...validResponse, maintainer_wallet: "0x123" }).success,
    ).toBe(false);
  });

  it("区分 NOT_APPLICABLE，并要求每个 check 声明 basis", () => {
    expect(
      CheckResultSchema.safeParse({
        ...validCheckResult,
        result: "NOT_APPLICABLE",
        basis: "not_applicable",
      }).success,
    ).toBe(true);

    const resultWithoutBasis: Record<string, unknown> = { ...validCheckResult };
    delete resultWithoutBasis.basis;
    expect(CheckResultSchema.safeParse(resultWithoutBasis).success).toBe(false);
  });

  it("拒绝非 UTC 时间、非法版本和缺失 escalated_check_ids 的响应", () => {
    const invalidConstraints = { ...validSettlementConstraints };
    delete (invalidConstraints as Partial<typeof validSettlementConstraints>).escalated_check_ids;

    expect(
      ModuleResponseSchema.safeParse({
        module: "us-msb",
        version: "1.0.0",
        updated_at: "2026-07-24T01:00:00+01:00",
        checks: [validCheckResult],
        overall: "HOLD",
        settlement_constraints: invalidConstraints,
        evidence_hash: EVIDENCE_HASH,
        disclaimer: "不构成法律意见。",
      }).success,
    ).toBe(false);
  });
});

describe("规则 schemas", () => {
  it("接受普通 party 条件和带 role 的定向条件", () => {
    expect(RuleSchema.safeParse(validRule).success).toBe(true);
    expect(
      RuleSchema.safeParse({
        ...validRule,
        when: {
          party_country: { role: "payer", country: "US" },
          party_state: { role: "payer", state: "NY" },
          amount_gte: 1_000,
          monthly_volume_gte: 3_000_000,
        },
      }).success,
    ).toBe(true);
  });

  it("要求法源字段，并拒绝设计之外的 when 条件", () => {
    const ruleWithoutSource = { ...validRule };
    delete (ruleWithoutSource as Partial<typeof validRule>).source;

    expect(RuleSchema.safeParse(ruleWithoutSource).success).toBe(false);
    expect(
      RuleSchema.safeParse({
        ...validRule,
        when: { party_city: "New York" },
      }).success,
    ).toBe(false);
  });

  it("拒绝无证据要求且不强制升级的空判定规则", () => {
    expect(
      RuleSchema.safeParse({
        ...validRule,
        when: {},
        required_evidence: [],
        always_escalate: false,
      }).success,
    ).toBe(false);
  });

  it("要求规则文件为非空规则数组", () => {
    expect(
      RulesFileSchema.safeParse({
        module: "us-msb",
        version: "2026.07.1",
        updated_at: "2026-07-24T00:00:00Z",
        rules: [validRule],
      }).success,
    ).toBe(true);
    expect(
      RulesFileSchema.safeParse({
        module: "us-msb",
        version: "2026.07.1",
        updated_at: "2026-07-24T00:00:00Z",
        rules: [],
      }).success,
    ).toBe(false);
  });
});
