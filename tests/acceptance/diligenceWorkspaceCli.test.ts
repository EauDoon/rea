import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";

import { parseEvidence } from "../../src/domain/evidence.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { processTest } from "../support/process/processFixture.js";

const script = resolve("scripts/daniel-diligence.mjs");

processTest(
  "renders a research-only decision with dated source references and rejects uncited findings",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-diligence-sources-");
    const output = join(root, "case");
    const initialized = await processes.run(process.execPath, [
      script,
      "init",
      "--profile",
      "stablecoin",
      "--subject",
      "Issuer",
      "--question",
      "Who is eligible to redeem?",
      "--out",
      output,
    ]);
    expect(initialized.exitCode).toBe(0);
    const claimsPath = join(output, "claims.json");
    const claims = JSON.parse(await readFile(claimsPath, "utf8")) as Array<{
      status: string;
      statement: string;
      source_ids: string[];
    }>;
    const redemption = claims[1];
    if (redemption === undefined)
      throw new Error("missing redemption question");
    redemption.status = "observed";
    redemption.statement =
      "The analyst-read terms restrict direct redemption to eligible customers.";
    await writeFile(claimsPath, JSON.stringify(claims));
    const uncited = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(uncited.exitCode).toBe(1);
    expect(uncited.stderr).toContain(
      "needs cited evidence or a primary source",
    );
    redemption.source_ids = ["issuer_terms"];
    await writeFile(claimsPath, JSON.stringify(claims));
    const missing = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Missing primary source reference");
    await writeFile(
      join(output, "sources.json"),
      JSON.stringify([
        {
          id: "issuer_terms",
          url: "https://issuer.example/terms",
          retrieved_at: "2026-10-10T12:00:00+08:00",
          scope: "Selected customer eligibility; manually examined by analyst",
          limitations: ["No reserve or actual payout verification"],
        },
      ]),
    );
    const report = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("7 of 8 coverage questions remain unknown");
    expect(report.stdout).toContain("No local artifact selected");
    expect(report.stdout).toContain("2026-10-10T12:00:00+08:00");
    expect(report.stdout).toContain("does not verify factual entailment");
  },
);

processTest(
  "captures a shipped JavaScript artifact and renders unknown coverage without executing its code",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-diligence-");
    const target = join(root, "app");
    const output = join(root, "case");
    const sideEffect = join(root, "executed.txt");
    await mkdir(target);
    const shipped = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(sideEffect)}, 'executed'); export const route = '/redeem';\n`;
    await writeFile(join(target, "payment.mjs"), shipped);
    const initialized = await processes.run(process.execPath, [
      script,
      "init",
      "--profile",
      "payments",
      "--subject",
      "Payment app",
      "--question",
      "Can payouts recover?",
      "--target",
      target,
      "--kind",
      "javascript",
      "--out",
      output,
    ]);
    expect(initialized.exitCode).toBe(0);
    const summary = JSON.parse(initialized.stdout) as { evidence_id: string };
    const evidence = parseEvidence(
      JSON.parse(
        await readFile(
          join(output, "evidence", `${summary.evidence_id}.json`),
          "utf8",
        ),
      ),
    );
    expect(evidence.operation).toBe("analyze_javascript_application");
    expect(evidence.subject?.local_path).toBe(target);
    expect(JSON.stringify(evidence.normalized_result)).toContain("/redeem");
    expect(await readFile(join(target, "payment.mjs"), "utf8")).toBe(shipped);
    expect(await readdir(root)).not.toContain("executed.txt");
    const before = await readFile(join(output, "claims.json"), "utf8");
    const report = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(report.exitCode).toBe(0);
    expect(report.stdout).toContain("8 of 8 coverage questions remain unknown");
    expect(report.stdout).toContain("Asia/Singapore");
    expect(report.stdout).toContain(summary.evidence_id);
    expect(await readFile(join(output, "claims.json"), "utf8")).toBe(before);
    const repeated = await processes.run(process.execPath, [
      script,
      "init",
      "--profile",
      "payments",
      "--subject",
      "Overwrite",
      "--question",
      "Overwrite?",
      "--out",
      output,
    ]);
    expect(repeated.exitCode).toBe(1);
    expect(repeated.stderr).toContain("output already exists");
    expect(await readFile(join(output, "claims.json"), "utf8")).toBe(before);
  },
);

processTest.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "captures real EVM Evidence and rejects tampering, unsupported claims and lost coverage",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-diligence-evm-");
    const target = join(root, "runtime.hex");
    const output = join(root, "case");
    await writeFile(target, "0x00\n");
    const initialized = await processes.run(process.execPath, [
      script,
      "init",
      "--profile",
      "token",
      "--subject",
      "Selected token",
      "--question",
      "Can my position exit?",
      "--target",
      target,
      "--kind",
      "evm-hex",
      "--out",
      output,
    ]);
    expect(initialized.exitCode).toBe(0);
    const summary = JSON.parse(initialized.stdout) as { evidence_id: string };
    const evidencePath = join(
      output,
      "evidence",
      `${summary.evidence_id}.json`,
    );
    const originalEvidence = await readFile(evidencePath, "utf8");
    const record = parseEvidence(JSON.parse(originalEvidence));
    expect(record.confidence).toBe("inferred");
    expect(record.normalized_result).toMatchObject({
      bytecode: { hex: "00", deployment_authenticity: "unknown" },
      runtime_execution: "not-performed",
      discovery_completeness: "unknown",
    });
    const claimsPath = join(output, "claims.json");
    const claims = JSON.parse(await readFile(claimsPath, "utf8")) as Array<{
      question_id: string;
      status: string;
      statement: string;
      evidence_ids: string[];
    }>;
    const first = claims[0];
    if (first === undefined) throw new Error("missing initialized coverage");
    first.status = "observed";
    first.statement = "Deployment verified";
    first.evidence_ids = [summary.evidence_id];
    await writeFile(claimsPath, JSON.stringify(claims));
    const unsupported = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(unsupported.exitCode).toBe(1);
    expect(unsupported.stderr).toContain(
      "Inferred artifact Evidence cannot substantiate",
    );
    first.status = "inferred";
    const editedClaims = JSON.stringify(claims);
    await writeFile(claimsPath, editedClaims);
    const supported = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(supported.exitCode).toBe(0);
    expect(supported.stdout).toContain(
      "7 of 8 coverage questions remain unknown",
    );
    first.evidence_ids = [`ev_${"f".repeat(64)}`];
    await writeFile(claimsPath, JSON.stringify(claims));
    const missing = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Missing Evidence reference");
    await writeFile(claimsPath, JSON.stringify(claims.slice(1)));
    const lost = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(lost.exitCode).toBe(1);
    expect(lost.stderr).toContain(
      "Each profile coverage question must occur exactly once",
    );
    await writeFile(claimsPath, editedClaims);
    const tampered = {
      ...JSON.parse(originalEvidence),
      confidence: "observed",
    };
    await writeFile(evidencePath, JSON.stringify(tampered));
    const rejected = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain(
      "Evidence semantic identifier does not match",
    );
  },
);

processTest.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "keeps packets outside inspected artifacts through symlink aliases and leaves invalid input uncreated",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-diligence-paths-");
    const target = join(root, "app");
    const alias = join(root, "alias");
    await mkdir(target);
    await writeFile(join(target, "index.js"), "export const value = 1;\n");
    await symlink(target, alias, "dir");
    const inside = await processes.run(process.execPath, [
      script,
      "init",
      "--profile",
      "competitor",
      "--subject",
      "App",
      "--question",
      "How does it work?",
      "--target",
      target,
      "--kind",
      "javascript",
      "--out",
      join(alias, "new", "case"),
    ]);
    expect(inside.exitCode).toBe(1);
    expect(inside.stderr).toContain("outside the inspected target");
    expect(await readdir(target)).toEqual(["index.js"]);
    const invalid = join(root, "invalid.hex");
    await writeFile(invalid, "not bytecode");
    const failed = await processes.run(process.execPath, [
      script,
      "init",
      "--profile",
      "token",
      "--subject",
      "Token",
      "--question",
      "What controls exist?",
      "--target",
      invalid,
      "--kind",
      "evm-hex",
      "--out",
      join(root, "failed"),
    ]);
    expect(failed.exitCode).toBe(1);
    expect(await readdir(root)).not.toContain("failed");
  },
);
