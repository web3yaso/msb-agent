import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { validateRuleDocument, type RuleDocument } from "./rule-validation.js";

const execFileAsync = promisify(execFile);
const RULES_DIRECTORY = "src/rules";

async function readPreviousContent(filePath: string): Promise<string | undefined> {
  const configuredBase = process.env.RULES_BASE_REF;

  try {
    await execFileAsync("git", ["diff", "--quiet", "HEAD", "--", filePath]);
    const baseReference = configuredBase ?? "HEAD^";
    const { stdout } = await execFileAsync("git", ["show", `${baseReference}:${filePath}`]);
    return stdout;
  } catch (error: unknown) {
    const exitCode =
      typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

    if (exitCode === 1) {
      try {
        const { stdout } = await execFileAsync("git", ["show", `HEAD:${filePath}`]);
        return stdout;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }
}

async function loadRuleDocuments(): Promise<RuleDocument[]> {
  const entries = await readdir(RULES_DIRECTORY, { withFileTypes: true });
  const ruleFileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    ruleFileNames.map(async (fileName) => {
      const filePath = path.posix.join(RULES_DIRECTORY, fileName);
      const [content, previousContent] = await Promise.all([
        readFile(filePath, "utf8"),
        readPreviousContent(filePath),
      ]);

      return { path: filePath, content, previousContent };
    }),
  );
}

async function main(): Promise<void> {
  const documents = await loadRuleDocuments();
  const errors = documents.flatMap((document) => validateRuleDocument(document).errors);

  if (errors.length > 0) {
    process.stderr.write(`规则校验失败：\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`规则校验通过：${String(documents.length)} 个文件\n`);
}

await main();
