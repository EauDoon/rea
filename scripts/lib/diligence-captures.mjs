import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import canonicalize from "canonicalize";
import { z } from "zod";

import { validateChainEvidence } from "./diligence-chain.mjs";
import { validateSourceEvidence } from "./diligence-source.mjs";

const envelopeSchema = z.strictObject({
  capture_id: z.string().regex(/^cap_[a-f0-9]{64}$/u),
  record: z.unknown(),
});
const maxCaptureBytes = 16 * 1024 * 1024;

const validatedRecord = (record) => {
  if (record?.kind === "evm-rpc") return validateChainEvidence(record);
  if (record?.kind === "source") return validateSourceEvidence(record);
  throw new Error("Unsupported diligence capture kind");
};

const identify = (record) =>
  `cap_${createHash("sha256").update(canonicalize(record)).digest("hex")}`;

/** Immutable captures are integrity-checked provider observations, not REA Evidence. */
export const persistDiligenceCapture = async (root, input) => {
  const record = validatedRecord(input);
  const capture_id = identify(record);
  const contents = `${JSON.stringify({ capture_id, record }, null, 2)}\n`;
  if (Buffer.byteLength(contents) > maxCaptureBytes)
    throw new Error("Capture exceeds the portable packet's 16 MiB file limit");
  const directory = join(root, "captures");
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (!(await lstat(directory)).isDirectory())
    throw new Error("Expected an ordinary captures directory, not a symlink");
  await writeFile(join(directory, `${capture_id}.json`), contents, {
    flag: "wx",
    mode: 0o600,
  });
  return { capture_id, kind: record.kind, subject: record.subject };
};

export const loadDiligenceCaptures = async (root) => {
  const directory = join(root, "captures");
  try {
    if (!(await lstat(directory)).isDirectory())
      throw new Error("Expected an ordinary captures directory, not a symlink");
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
  const captures = new Map();
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (!entry.isFile() || !/^cap_[a-f0-9]{64}\.json$/u.test(entry.name))
      throw new Error(
        `Unrecognized or non-regular capture file: ${entry.name}`,
      );
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > maxCaptureBytes)
      throw new Error(
        "Expected a regular capture within the 16 MiB file limit",
      );
    const envelope = envelopeSchema.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (
      `${envelope.capture_id}.json` !== entry.name ||
      identify(envelope.record) !== envelope.capture_id
    )
      throw new Error(
        `Capture identity does not match its contents: ${entry.name}`,
      );
    const record = validatedRecord(envelope.record);
    // Validation must not normalize away values included in the commitment.
    if (identify(record) !== envelope.capture_id)
      throw new Error("Capture validation changed committed record values");
    captures.set(envelope.capture_id, record);
  }
  return captures;
};
