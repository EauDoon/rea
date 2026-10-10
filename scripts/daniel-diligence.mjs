#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";

import { DILIGENCE_PROFILES } from "../dist/contracts/diligenceProfiles.js";
import {
  initializeDiligenceWorkspace,
  loadDiligenceWorkspace,
  renderDiligenceReport,
} from "./lib/diligence-workspace.mjs";
import { collectChainEvidence } from "./lib/diligence-chain.mjs";
import { collectSourceEvidence } from "./lib/diligence-source.mjs";
import { persistDiligenceCapture } from "./lib/diligence-captures.mjs";
import {
  exportDiligencePacket,
  importDiligencePacket,
  compareDiligenceWorkspaces,
} from "./lib/diligence-packets.mjs";

const help = `Daniel's local diligence workspace

node scripts/daniel-diligence.mjs profiles
node scripts/daniel-diligence.mjs init --profile token --subject NAME --question QUESTION --out NEW_DIRECTORY [--target PATH --kind evm-hex|evm-raw|javascript] [--chain-context TEXT]
node scripts/daniel-diligence.mjs report --case DIRECTORY
node scripts/daniel-diligence.mjs source --case DIRECTORY --url HTTPS_URL --scope TEXT [--max-bytes N] [--timeout-ms N]
node scripts/daniel-diligence.mjs chain --case DIRECTORY --rpc-env VARIABLE --chain-id DECIMAL_ID --address ADDRESS [--block finalized|safe|latest|HEX_NUMBER] [--reads JSON_FILE]
node scripts/daniel-diligence.mjs export --case DIRECTORY --out NEW_PRIVATE_JSON_FILE
node scripts/daniel-diligence.mjs import --file PRIVATE_JSON_FILE --out NEW_DIRECTORY
node scripts/daniel-diligence.mjs compare --before DIRECTORY --after DIRECTORY [--max-age-days N]

Build first with npm run build:cached. Run init with a new directory outside the target, preferably under ignored _reference/diligence/. Target inspection is offline and static. Omit target/kind for a research-only case. Only source/chain make explicit read-only network requests. The RPC endpoint is read from a named environment variable and never stored in full. Add returned capture_ids to applicable claims after reviewing the retained evidence. Report prints Markdown; compare prints JSON; neither changes cases. Export bundles contain private case content and must be stored in your private backup location.
`;

const argumentsFor = (names) =>
  parseArgs({
    args: process.argv.slice(3),
    options: Object.fromEntries(
      names.map((name) => [name, { type: "string" }]),
    ),
  }).values;
const required = (values, name) => {
  const value = values[name];
  if (value === undefined || value.trim() === "")
    throw new Error(`Missing --${name}`);
  return value;
};
const positiveNumber = (values, name) => {
  if (values[name] === undefined) return undefined;
  const value = Number(values[name]);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`--${name} must be a positive number`);
  return value;
};
const printJson = (value) =>
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const collectIntoCase = async (command) => {
  const values = argumentsFor(
    command === "source"
      ? ["case", "url", "scope", "max-bytes", "timeout-ms"]
      : ["case", "rpc-env", "chain-id", "address", "block", "reads"],
  );
  const { root } = await loadDiligenceWorkspace(required(values, "case"));
  let record;
  if (command === "source") {
    record = await collectSourceEvidence({
      url: required(values, "url"),
      scope: required(values, "scope"),
      maxBytes: positiveNumber(values, "max-bytes"),
      timeoutMs: positiveNumber(values, "timeout-ms"),
    });
  } else {
    const variable = required(values, "rpc-env");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable))
      throw new Error("--rpc-env must name an environment variable");
    const rpcUrl = process.env[variable];
    if (!rpcUrl)
      throw new Error(`RPC environment variable is unset: ${variable}`);
    record = await collectChainEvidence({
      rpcUrl,
      chainId: required(values, "chain-id"),
      address: required(values, "address"),
      block: values.block,
      reads:
        values.reads === undefined
          ? []
          : JSON.parse(await readFile(values.reads, "utf8")),
    });
  }
  printJson(await persistDiligenceCapture(root, record));
};

const managePacket = async (command) => {
  if (command === "export") {
    const values = argumentsFor(["case", "out"]);
    printJson(
      await exportDiligencePacket({
        caseDirectory: required(values, "case"),
        out: required(values, "out"),
      }),
    );
  } else if (command === "import") {
    const values = argumentsFor(["file", "out"]);
    printJson(
      await importDiligencePacket({
        file: required(values, "file"),
        out: required(values, "out"),
      }),
    );
  } else {
    const values = argumentsFor(["before", "after", "max-age-days"]);
    printJson(
      await compareDiligenceWorkspaces({
        before: required(values, "before"),
        after: required(values, "after"),
        maxAgeDays: positiveNumber(values, "max-age-days"),
      }),
    );
  }
};

try {
  const command = process.argv[2];
  if (command === undefined || command === "--help") {
    process.stdout.write(help);
  } else if (command === "profiles") {
    if (process.argv.length !== 3)
      throw new Error("profiles takes no arguments");
    process.stdout.write(`${JSON.stringify(DILIGENCE_PROFILES, null, 2)}\n`);
  } else if (command === "init") {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: Object.fromEntries(
        [
          "profile",
          "subject",
          "question",
          "out",
          "target",
          "kind",
          "chain-context",
        ].map((name) => [name, { type: "string" }]),
      ),
    });
    process.stdout.write(
      `${JSON.stringify(await initializeDiligenceWorkspace(values), null, 2)}\n`,
    );
  } else if (command === "report") {
    const { values } = parseArgs({
      args: process.argv.slice(3),
      options: { case: { type: "string" } },
    });
    if (values.case === undefined)
      throw new Error("report requires --case DIRECTORY");
    process.stdout.write(await renderDiligenceReport(values.case));
  } else if (command === "source" || command === "chain") {
    await collectIntoCase(command);
  } else if (["export", "import", "compare"].includes(command)) {
    await managePacket(command);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(
    `Diligence workspace failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
