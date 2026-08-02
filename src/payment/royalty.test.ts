import { describe, expect, it } from "vitest";

import { ZERO_ADDRESS } from "../http/constants.js";
import { loadRoyaltyConfig } from "./royalty.js";

const GLOBAL_WALLET = "0x1111111111111111111111111111111111111111";
const US_WALLET = "0x2222222222222222222222222222222222222222";

describe("版税配置", () => {
  it("off 模式无配置时全部回落为零地址和零费率", () => {
    const config = loadRoyaltyConfig({}, "off");

    for (const royalty of Object.values(config)) {
      expect(royalty).toEqual({ maintainerWallet: ZERO_ADDRESS, royaltyBps: 0 });
    }
  });

  it("全局钱包与费率应用到五模块", () => {
    const config = loadRoyaltyConfig(
      { MODULE_MAINTAINER_WALLET: GLOBAL_WALLET, MODULE_ROYALTY_BPS: "500" },
      "off",
    );

    for (const royalty of Object.values(config)) {
      expect(royalty).toEqual({ maintainerWallet: GLOBAL_WALLET, royaltyBps: 500 });
    }
  });

  it("模块配置只覆盖对应模块", () => {
    const config = loadRoyaltyConfig(
      {
        MODULE_MAINTAINER_WALLET: GLOBAL_WALLET,
        MODULE_ROYALTY_BPS: "500",
        US_MSB_MAINTAINER_WALLET: US_WALLET,
        US_MSB_ROYALTY_BPS: "750",
      },
      "off",
    );

    expect(config["us-msb"]).toEqual({ maintainerWallet: US_WALLET, royaltyBps: 750 });
    expect(config["uk-msb"]).toEqual({ maintainerWallet: GLOBAL_WALLET, royaltyBps: 500 });
    expect(config["eu-msb"]).toEqual({ maintainerWallet: GLOBAL_WALLET, royaltyBps: 500 });
    expect(config["sg-msb"]).toEqual({ maintainerWallet: GLOBAL_WALLET, royaltyBps: 500 });
    expect(config["ae-msb"]).toEqual({ maintainerWallet: GLOBAL_WALLET, royaltyBps: 500 });
  });

  it("付费模式缺失维护者钱包时启动失败", () => {
    expect(() => loadRoyaltyConfig({}, "x402-arc-testnet")).toThrow("MODULE_MAINTAINER_WALLET");
  });

  it.each(["secret", `0x${"1".repeat(39)}`, "1".repeat(40)])(
    "非法地址只在错误中显示变量名：%s",
    (wallet) => {
      expect(() => loadRoyaltyConfig({ MODULE_MAINTAINER_WALLET: wallet }, "off")).toThrow(
        "MODULE_MAINTAINER_WALLET",
      );
      try {
        loadRoyaltyConfig({ MODULE_MAINTAINER_WALLET: wallet }, "off");
      } catch (error: unknown) {
        expect(String(error)).not.toContain(wallet);
      }
    },
  );

  it.each(["10001", "-1", "5.5", "abc"])("拒绝非法版税基点 %s", (royaltyBps) => {
    expect(() =>
      loadRoyaltyConfig(
        { MODULE_MAINTAINER_WALLET: GLOBAL_WALLET, MODULE_ROYALTY_BPS: royaltyBps },
        "off",
      ),
    ).toThrow("MODULE_ROYALTY_BPS");
  });

  it("拒绝正费率与零地址组合", () => {
    expect(() =>
      loadRoyaltyConfig(
        { MODULE_MAINTAINER_WALLET: ZERO_ADDRESS, MODULE_ROYALTY_BPS: "100" },
        "off",
      ),
    ).toThrow("配置了版税基点但维护者钱包为零地址");
  });
});
