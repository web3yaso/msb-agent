import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { RulesFileSchema, type RulesFile } from "../src/schemas/index.js";
import {
  checkSourceLinks,
  collectSourceUrls,
  type LinkExemption,
  type LinkFetcher,
} from "./link-check.js";

const RULES_DIRECTORY = "src/rules";
const EXEMPTIONS_PATH = "scripts/link-exemptions.json";

async function loadRulesFiles(): Promise<RulesFile[]> {
  const entries = await readdir(RULES_DIRECTORY, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map(({ name }) => name)
    .sort();

  return Promise.all(
    fileNames.map(async (fileName) => {
      const content = await readFile(path.join(RULES_DIRECTORY, fileName), "utf8");
      const parsedJson: unknown = JSON.parse(content);
      return RulesFileSchema.parse(parsedJson);
    }),
  );
}

async function loadExemptions(): Promise<LinkExemption[]> {
  const content = await readFile(EXEMPTIONS_PATH, "utf8");
  const parsedJson: unknown = JSON.parse(content);

  if (!Array.isArray(parsedJson)) {
    throw new TypeError("链接豁免清单必须是数组");
  }

  return parsedJson.map((entry: unknown) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("url" in entry) ||
      typeof entry.url !== "string" ||
      !("reason" in entry) ||
      typeof entry.reason !== "string"
    ) {
      throw new TypeError("链接豁免项必须包含 url 和 reason 字符串");
    }

    return { url: entry.url, reason: entry.reason };
  });
}

async function main(): Promise<void> {
  if (process.env.CHECK_RULE_LINKS !== "1") {
    process.stdout.write("链接存活检查已跳过：设置 CHECK_RULE_LINKS=1 可启用网络检查\n");
    return;
  }

  const [rulesFiles, exemptions] = await Promise.all([loadRulesFiles(), loadExemptions()]);
  const urls = collectSourceUrls(rulesFiles);
  const fetcher: LinkFetcher = (url, init) => fetch(url, init);
  const result = await checkSourceLinks(urls, exemptions, fetcher);

  if (result.exempted.length > 0) {
    process.stderr.write(
      `链接豁免警告：\n${result.exempted
        .map(({ url, reason }) => `- ${url}: ${reason}`)
        .join("\n")}\n`,
    );
  }

  if (result.networkErrors.length > 0) {
    process.stderr.write(
      `网络不可用，跳过 ${String(result.networkErrors.length)} 个链接：\n${result.networkErrors
        .map(({ url, message }) => `- ${url}: ${message}`)
        .join("\n")}\n`,
    );
  }

  if (result.failures.length > 0) {
    process.stderr.write(
      `链接存活检查失败：\n${result.failures
        .map(({ url, status }) => `- ${url}: HTTP ${String(status)}`)
        .join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `链接存活检查通过：检查 ${String(result.checked.length)}，豁免 ${String(result.exempted.length)}\n`,
  );
}

await main();
