import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { z } from "zod";

import { DILIGENCE_PROFILES } from "../../dist/contracts/diligenceProfiles.js";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { createEvmInterfaceService } from "../../dist/composition/evm.js";
import { analyzeJavaScriptApplication } from "../../dist/application/javascript/JavaScriptApplicationService.js";

const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Expected nonblank text");
const identifier = text.regex(/^[a-z][a-z0-9_]*$/u);
const evidenceId = text.regex(/^ev_[a-f0-9]{64}$/u);
const profileSchema = z.enum(Object.keys(DILIGENCE_PROFILES));
const targetSchema = z.strictObject({
  kind: z.enum(["evm-hex", "evm-raw", "javascript"]),
  path: text.refine(isAbsolute, "Expected an absolute local target path"),
});
const caseSchema = z
  .strictObject({
    version: z.literal(1),
    profile: profileSchema,
    subject: text,
    decision_question: text,
    created_at: z.iso.datetime(),
    timezone: z.literal("Asia/Singapore"),
    chain_context: text.nullable(),
    target: targetSchema.nullable(),
    initial_evidence_id: evidenceId.nullable(),
  })
  .refine(
    (value) => (value.target === null) === (value.initial_evidence_id === null),
    "A selected local target requires its initial Evidence identity",
  );
const claimsSchema = z.array(
  z.strictObject({
    question_id: identifier,
    status: z.enum(["unknown", "observed", "derived", "inferred"]),
    statement: text,
    evidence_ids: z.array(evidenceId),
    source_ids: z.array(identifier),
    next_check: text,
  }),
);
const sourcesSchema = z.array(
  z.strictObject({
    id: identifier,
    url: z
      .url()
      .refine(
        (value) => ["https:", "http:"].includes(new URL(value).protocol),
        "Use an HTTP(S) primary source URL",
      ),
    retrieved_at: z.iso.datetime({ offset: true }),
    scope: text,
    limitations: z.array(text),
  }),
);

/** Capture only the supplied artifact through the existing static production workflow. */
const captureTarget = async (target) => {
  if (target === null) return null;
  const result =
    target.kind === "javascript"
      ? await analyzeJavaScriptApplication({ input_path: target.path })
      : await createEvmInterfaceService().inspect({
          path: target.path,
          encoding: target.kind === "evm-hex" ? "hex" : "raw",
        });
  if (!result.ok) throw result.error;
  return parseEvidence(result.value);
};

const writeNew = (path, contents) =>
  writeFile(path, contents, { flag: "wx", mode: 0o600 });
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const markdown = (value) =>
  String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");

const readRegularJson = async (path) => {
  if (!(await lstat(path)).isFile())
    throw new Error(`Expected a regular JSON file: ${path}`);
  return JSON.parse(await readFile(path, "utf8"));
};

const canonicalFuturePath = async (path) => {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalFuturePath(parent), basename(path));
  }
};

/** Create a new private packet without overwriting a case or changing the inspected target. */
export const initializeDiligenceWorkspace = async (options) => {
  const profile = profileSchema.parse(options.profile);
  const subject = text.parse(options.subject);
  const decisionQuestion = text.parse(options.question);
  if ((options.target === undefined) !== (options.kind === undefined))
    throw new Error(
      "Supply both --target and --kind, or neither for a research-only case",
    );
  const target =
    options.target === undefined
      ? null
      : targetSchema.parse({
          kind: options.kind,
          path: await realpath(resolve(options.target)),
        });
  const output = resolve(text.parse(options.out));
  const canonicalOutput = await canonicalFuturePath(output);
  if (target !== null) {
    const relation = relative(target.path, canonicalOutput);
    if (
      relation === "" ||
      (!relation.startsWith(`..${sep}`) &&
        relation !== ".." &&
        !isAbsolute(relation))
    )
      throw new Error(
        "Keep the evidence workspace outside the inspected target",
      );
  }
  try {
    await lstat(output);
    throw new Error("The output already exists; select a new case directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const captured = await captureTarget(target);
  const definition = DILIGENCE_PROFILES[profile];
  const case_ = caseSchema.parse({
    version: 1,
    profile,
    subject,
    decision_question: decisionQuestion,
    created_at: new Date().toISOString(),
    timezone: "Asia/Singapore",
    chain_context: options["chain-context"] ?? null,
    target,
    initial_evidence_id: captured?.evidence_id ?? null,
  });
  // Analysis/validation failures leave no partial case; exclusive creation
  // also protects a destination created by another caller during capture.
  await mkdir(dirname(canonicalOutput), { recursive: true });
  await mkdir(canonicalOutput, { mode: 0o700 });
  await mkdir(join(canonicalOutput, "evidence"), { mode: 0o700 });
  if (captured !== null)
    await writeNew(
      join(canonicalOutput, "evidence", `${captured.evidence_id}.json`),
      json(captured),
    );
  await writeNew(join(canonicalOutput, "case.json"), json(case_));
  await writeNew(join(canonicalOutput, "sources.json"), "[]\n");
  await writeNew(
    join(canonicalOutput, "claims.json"),
    json(
      Object.keys(definition.questions).map((questionId) => ({
        question_id: questionId,
        status: "unknown",
        statement: "Not established.",
        evidence_ids: [],
        source_ids: [],
        next_check: definition.questions[questionId],
      })),
    ),
  );
  await writeNew(
    join(canonicalOutput, "brief.md"),
    renderBrief(case_, definition),
  );
  await writeNew(
    join(canonicalOutput, "notes.md"),
    "# Analyst notes\n\nRecord hypotheses, competing explanations, executed checks, amounts and units, commercial terms, and what would change the decision. Preserve source values and Evidence provenance.\n",
  );
  return {
    case_directory: canonicalOutput,
    profile,
    evidence_id: captured?.evidence_id ?? null,
    coverage: "unreviewed",
  };
};

const renderBrief = (case_, definition) =>
  `# ${markdown(case_.subject)}\n\nDecision: ${markdown(case_.decision_question)}\n\n${definition.objective}\n\n## Coverage questions\n\n${Object.entries(
    definition.questions,
  )
    .map(([id, question]) => `- ${id}: ${question}`)
    .join(
      "\n",
    )}\n\n## Primary evidence needed\n\n${definition.sources.map((source) => `- ${source}`).join("\n")}\n\n## Working files\n\nEdit claims.json with cited observations, derivations, inferences and unknowns. Enter dated primary source references in sources.json. Place complete, unchanged REA Evidence JSON records in evidence/ using their ev_*.json identifiers. Run the report command to validate references and render a new memo to stdout. It never overwrites these notes.\n\nLocal target inspection does not verify chain/address/block, runtime/init-code identity, economic promises or external terms. Case chain context is analyst-supplied and unverified. All questions start unknown, including after a successful capture.\n`;

const loadEvidence = async (root) => {
  const evidence = new Map();
  for (const entry of await readdir(join(root, "evidence"), {
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/^ev_[a-f0-9]{64}\.json$/u.test(entry.name))
      throw new Error(
        `Unrecognized or non-regular Evidence file: ${entry.name}`,
      );
    const record = parseEvidence(
      await readRegularJson(join(root, "evidence", entry.name)),
    );
    if (`${record.evidence_id}.json` !== entry.name)
      throw new Error(
        `Evidence filename does not match its semantic identifier: ${entry.name}`,
      );
    evidence.set(record.evidence_id, record);
  }
  return evidence;
};

const validateClaims = (case_, claims, sources, evidence) => {
  const questions = DILIGENCE_PROFILES[case_.profile].questions;
  const suppliedQuestions = claims.map(({ question_id }) => question_id);
  if (
    new Set(suppliedQuestions).size !== claims.length ||
    JSON.stringify([...suppliedQuestions].sort()) !==
      JSON.stringify(Object.keys(questions).sort())
  )
    throw new Error(
      "Each profile coverage question must occur exactly once; keep unresolved questions unknown",
    );
  const sourceIds = new Set(sources.map(({ id }) => id));
  if (sourceIds.size !== sources.length)
    throw new Error("Source identifiers must be unique");
  for (const claim of claims)
    validateClaimReferences(claim, sourceIds, evidence);
  validateInitialCapture(case_, evidence);
};

const validateClaimReferences = (claim, sourceIds, evidence) => {
  for (const id of claim.evidence_ids)
    if (!evidence.has(id)) throw new Error(`Missing Evidence reference: ${id}`);
  for (const id of claim.source_ids)
    if (!sourceIds.has(id))
      throw new Error(`Missing primary source reference: ${id}`);
  if (
    claim.status !== "unknown" &&
    claim.evidence_ids.length + claim.source_ids.length === 0
  )
    throw new Error(
      `A ${claim.status} claim needs cited evidence or a primary source: ${claim.question_id}`,
    );
  if (
    ["observed", "derived"].includes(claim.status) &&
    claim.source_ids.length === 0 &&
    claim.evidence_ids.every((id) => evidence.get(id).confidence === "inferred")
  )
    throw new Error(
      `Inferred artifact Evidence cannot substantiate an ${claim.status} claim: ${claim.question_id}`,
    );
};

const validateInitialCapture = (case_, evidence) => {
  if (case_.initial_evidence_id !== null) {
    const initial = evidence.get(case_.initial_evidence_id);
    if (initial === undefined)
      throw new Error("The case's initial Evidence is missing");
    const expectedOperation =
      case_.target?.kind === "javascript"
        ? "analyze_javascript_application"
        : "inspect_evm_interface";
    if (
      initial.operation !== expectedOperation ||
      initial.subject?.local_path !== case_.target?.path
    )
      throw new Error(
        "Initial Evidence does not match the selected target and operation",
      );
    if (
      case_.target.kind !== "javascript" &&
      initial.parameters.encoding !==
        (case_.target.kind === "evm-hex" ? "hex" : "raw")
    )
      throw new Error(
        "Initial Evidence does not match the selected carrier encoding",
      );
  }
};

/** Validate record integrity and citation coverage; analyst conclusions still require review. */
export const renderDiligenceReport = async (directory) => {
  const root = await realpath(resolve(directory));
  const case_ = caseSchema.parse(
    await readRegularJson(join(root, "case.json")),
  );
  const claims = claimsSchema.parse(
    await readRegularJson(join(root, "claims.json")),
  );
  const sources = sourcesSchema.parse(
    await readRegularJson(join(root, "sources.json")),
  );
  if (!(await lstat(join(root, "evidence"))).isDirectory())
    throw new Error("Expected an ordinary Evidence directory, not a symlink");
  const evidence = await loadEvidence(root);
  validateClaims(case_, claims, sources, evidence);
  return renderMemo(case_, claims, sources, evidence);
};

const renderMemo = (case_, claims, sources, evidence) => {
  const definition = DILIGENCE_PROFILES[case_.profile];
  const unknowns = claims.filter(({ status }) => status === "unknown");
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: case_.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  return `# ${markdown(case_.subject)}: diligence memo

Decision question: ${markdown(case_.decision_question)}

Recommendation: ${unknowns.length > 0 ? "Insufficient evidence for a complete coverage decision." : "Analyst decision required; populated coverage is not assurance or an investment recommendation."}

${unknowns.length} of ${claims.length} coverage questions remain unknown. Prepared ${date} (${case_.timezone}). Profile: ${case_.profile}.

## Scope and evidence limits

Target: ${case_.target === null ? "No local artifact selected." : `${markdown(case_.target.path)} (${case_.target.kind}).`}

Chain/state context (analyst-supplied, unverified): ${markdown(case_.chain_context ?? "Not supplied.")}

Claim text and external references are analyst-entered. This helper validates REA record integrity and citation coverage; it does not verify factual entailment, external page contents, deployed authenticity, fresh state or target behavior. An inferred finding remains an inference. Optional tests and audits are unperformed unless their actual results are attached.

## Findings and open questions

| Question | Status | Analyst statement | Evidence / sources | Next check or reopen trigger |
| --- | --- | --- | --- | --- |
${claims.map((claim) => `| ${markdown(definition.questions[claim.question_id])} | ${claim.status} | ${markdown(claim.statement)} | ${[...claim.evidence_ids, ...claim.source_ids].join(", ") || "None"} | ${markdown(claim.next_check)} |`).join("\n")}

## Artifact evidence

${evidence.size === 0 ? "No REA Evidence captured." : [...evidence.values()].map((record) => `- ${record.evidence_id}: ${record.operation}; ${record.confidence}; ${record.authority}; provider ${markdown(record.provider.id)} ${markdown(record.provider.version ?? "unknown version")}; SHA-256 ${record.subject?.digest.sha256 ?? "no artifact identity"}.\n  Limitations: ${record.limitations.map(markdown).join("; ") || "None declared by this record."}`).join("\n")}

## Primary source register

${sources.length === 0 ? "No external primary sources recorded." : sources.map((source) => `- ${source.id}: ${markdown(source.url)}; retrieved ${source.retrieved_at}; scope: ${markdown(source.scope)}; limitations: ${source.limitations.map(markdown).join("; ") || "None declared by analyst."}`).join("\n")}

## Evidence to resolve next

${unknowns.length === 0 ? "Review claim entailment, adverse sequences, economic assumptions and state freshness before deciding." : unknowns.map((claim) => `- ${claim.question_id}: ${markdown(claim.next_check)}`).join("\n")}
`;
};
