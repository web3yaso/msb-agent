import { describe, expect, it } from "vitest";

import type { CheckResult, DealInput } from "../schemas/index.js";
import {
  canonicalizeChecks,
  canonicalizeDealInput,
  canonicalizeJson,
  computeEvidenceHash,
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
    reason: "需人工核实",
    source: "NY Banking Law Article 13-B",
  },
  {
    id: "us-fincen-registration",
    result: "HOLD",
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
  it("只保留 id 和 result，按 id 排序且忽略 reason 与 source", () => {
    expect(canonicalizeChecks(checks)).toBe(
      '[{"id":"us-fincen-registration","result":"HOLD"},{"id":"us-state-license","result":"ESCALATE"}]',
    );

    expect(
      canonicalizeChecks([
        { ...checks[1], reason: "修改后的措辞" },
        { ...checks[0], source: "修改后的法源文案" },
      ]),
    ).toBe(canonicalizeChecks(checks));
  });
});

describe("computeEvidenceHash", () => {
  it("匹配固定已知向量", () => {
    expect(computeEvidenceHash(rulesFileBytes, input, checks)).toBe(
      "896e5beaec71172e3e1ea565587de3533b036abc359dc673bb36f1deb717ca37",
    );
  });

  it("同一输入重复计算得到相同结果", () => {
    const firstHash = computeEvidenceHash(rulesFileBytes, input, checks);
    const secondHash = computeEvidenceHash(rulesFileBytes, input, checks);

    expect(secondHash).toBe(firstHash);
  });
});
