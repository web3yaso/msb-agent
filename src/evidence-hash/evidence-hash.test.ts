import { describe, expect, it } from "vitest";

import type { CheckResult, DealInput } from "../schemas/index.js";
import {
  canonicalizeChecks,
  canonicalizeDealInput,
  canonicalizeJson,
  computeEvidenceHash,
  EVIDENCE_HASH_SCHEME_VERSION,
  ENGINE_VERSION,
} from "./index.js";

const input: DealInput = {
  deal_id: "job-123",
  parties: [
    { role: "payer", country: "US", state: "NY" },
    { role: "payee", country: "SG" },
  ],
  activity: "money_transmission",
  amount_usdc: 10_000,
  monthly_volume_usdc: null,
  evidence: {
    state_mt_licenses: [],
    fincen_msb_registration: false,
    applicant_name: "Cafe\u0301",
  },
};

const checks: CheckResult[] = [
  {
    id: "us-state-license",
    result: "ESCALATE",
    basis: "manual_review",
    reason: "需人工核实",
    source: "NY Banking Law Article 13-B",
  },
  {
    id: "us-fincen-registration",
    result: "HOLD",
    basis: "missing_evidence",
    reason: "缺少 FinCEN MSB 注册证据",
    source: "31 CFR § 1022.380",
  },
];

const rulesFileBytes = new TextEncoder().encode(
  '[\n  {"id":"us-fincen-registration","source":"31 CFR § 1022.380"}\n]\n',
);

describe("canonicalizeJson", () => {
  it("递归排序键、移除空白、使用 JS 数字序列化并执行 NFC 规范化", () => {
    expect(
      canonicalizeJson({
        z: 1.5,
        nested: { b: "Cafe\u0301", a: -0 },
        a: [true, null],
      }),
    ).toBe('{"a":[true,null],"nested":{"a":0,"b":"Café"},"z":1.5}');
  });

  it("拒绝非 JSON 数值及 NFC 后重复的对象键", () => {
    expect(() => canonicalizeJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalizeJson({ é: 1, "e\u0301": 2 })).toThrow(TypeError);
  });
});

describe("canonicalizeDealInput", () => {
  it("按 role、country、state 排序 parties", () => {
    const reversedInput = { ...input, parties: [...input.parties].reverse() };

    expect(canonicalizeDealInput(reversedInput)).toBe(canonicalizeDealInput(input));
    expect(canonicalizeDealInput(input)).toContain(
      '"parties":[{"country":"SG","role":"payee"},{"country":"US","role":"payer","state":"NY"}]',
    );
  });
});

describe("canonicalizeChecks", () => {
  it("只保留 id、result 和 basis，按 id 排序且忽略 reason 与 source", () => {
    expect(canonicalizeChecks(checks)).toBe(
      '[{"basis":"missing_evidence","id":"us-fincen-registration","result":"HOLD"},{"basis":"manual_review","id":"us-state-license","result":"ESCALATE"}]',
    );

    expect(
      canonicalizeChecks([
        { ...checks[1], reason: "修改后的措辞" },
        { ...checks[0], source: "修改后的法源文案" },
      ]),
    ).toBe(canonicalizeChecks(checks));
  });

  it("basis 改变时规范化结果随之改变", () => {
    expect(canonicalizeChecks([{ ...checks[0], basis: "missing_evidence" }])).not.toBe(
      canonicalizeChecks([checks[0]]),
    );
  });
});

describe("computeEvidenceHash", () => {
  it("匹配 scheme 2 固定已知答案向量", () => {
    // 此向量锁定预映射字节序列，改动预映射必须同步更新此值并说明原因。
    expect(computeEvidenceHash(rulesFileBytes, input, checks)).toBe(
      "05635dccaa82c9b18f4a689aeba6663fd2a838717b6f52b64015ea54109e3e84",
    );
  });

  it("同一输入重复计算得到相同结果", () => {
    const firstHash = computeEvidenceHash(rulesFileBytes, input, checks);
    const secondHash = computeEvidenceHash(rulesFileBytes, input, checks);

    expect(secondHash).toBe(firstHash);
  });

  it("basis 或 engine_version 改变时 hash 随之改变", () => {
    const baseline = computeEvidenceHash(rulesFileBytes, input, checks);
    const changedBasis = computeEvidenceHash(rulesFileBytes, input, [
      { ...checks[0], basis: "missing_evidence" },
      checks[1],
    ]);
    const changedEngine = computeEvidenceHash(rulesFileBytes, input, checks, {
      engineVersion: "9.9.9",
      hashSchemeVersion: EVIDENCE_HASH_SCHEME_VERSION,
    });

    expect(changedBasis).not.toBe(baseline);
    expect(changedEngine).not.toBe(baseline);
  });

  it("hash_scheme_version 改变时 hash 随之改变", () => {
    const baseline = computeEvidenceHash(rulesFileBytes, input, checks);
    const changedHashScheme = computeEvidenceHash(rulesFileBytes, input, checks, {
      engineVersion: ENGINE_VERSION,
      hashSchemeVersion: "999",
    });

    expect(changedHashScheme).not.toBe(baseline);
  });

  it("默认使用公开的 engine 与 hash scheme 版本", () => {
    expect(
      computeEvidenceHash(rulesFileBytes, input, checks, {
        engineVersion: ENGINE_VERSION,
        hashSchemeVersion: EVIDENCE_HASH_SCHEME_VERSION,
      }),
    ).toBe(computeEvidenceHash(rulesFileBytes, input, checks));
  });
});
