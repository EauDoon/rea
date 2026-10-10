#!/usr/bin/env node
import { parseArgs } from "node:util";

import { DILIGENCE_PROFILES } from "../dist/contracts/diligenceProfiles.js";
import {
  initializeDiligenceWorkspace,
  renderDiligenceReport,
} from "./lib/diligence-workspace.mjs";

const help = `Daniel's local diligence workspace

node scripts/daniel-diligence.mjs profiles
node scripts/daniel-diligence.mjs init --profile token --subject NAME --question QUESTION --out NEW_DIRECTORY [--target PATH --kind evm-hex|evm-raw|javascript] [--chain-context TEXT]
node scripts/daniel-diligence.mjs report --case DIRECTORY

Build first with npm run build:cached. Run init with a new directory outside the target, preferably under ignored _reference/diligence/. Target inspection is offline and static. Omit target/kind for a research-only case. Report prints Markdown to stdout; it preserves case files.
`;

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
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  process.stderr.write(
    `Diligence workspace failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
