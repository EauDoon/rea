import { createHash } from "node:crypto";
import { z } from "zod";

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
// An 8 MiB decoded body and its base64 representation fit the portable packet's
// 16 MiB file limit. Caller budgets can reduce this allocation, not enlarge it.
const MAX_CAPTURE_BYTES = DEFAULT_MAX_BYTES;
const MAX_REDIRECTS = 5;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const credentialParameters = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "password",
  "refresh_token",
  "secret",
  "signature",
  "token",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
  "x-goog-credential",
  "x-goog-signature",
]);
const text = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);
const timestamp = z.iso.datetime();
const maxBytesSchema = z
  .number()
  .int()
  .min(1)
  .max(
    MAX_CAPTURE_BYTES,
    "Source byte limit must fit the 8 MiB portable capture budget",
  );
const timeoutSchema = z.number().int().min(1).max(300_000);
const schema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("source"),
  created_at: timestamp,
  started_at: timestamp,
  retrieved_at: timestamp,
  subject: z.strictObject({ url: text }),
  final_url: text,
  redirects: z
    .array(
      z.strictObject({
        url: text,
        status: z
          .number()
          .int()
          .refine((status) => redirectStatuses.has(status)),
        location: text,
        resolved_url: text,
      }),
    )
    .max(MAX_REDIRECTS),
  status: z.number().int().min(200).max(299),
  content_type: z.string().nullable(),
  content_encoding: z.string().nullable(),
  body_representation: z.literal("fetch-decoded-bytes"),
  body_base64: z.string().max(4 * Math.ceil(MAX_CAPTURE_BYTES / 3)),
  body_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byte_length: z.number().int().min(0).max(MAX_CAPTURE_BYTES),
  scope: text,
  limits: z.strictObject({
    max_bytes: maxBytesSchema,
    timeout_ms: timeoutSchema,
    max_redirects: z.literal(MAX_REDIRECTS),
  }),
  limitations: z.array(text).min(1),
});

const checkedUrl = (value) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Source capture requires a valid absolute URL");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error(
      "Source capture requires HTTPS, except HTTP loopback fixtures",
    );
  if (url.username !== "" || url.password !== "")
    throw new Error("Source URLs must not contain transport credentials");
  for (const name of url.searchParams.keys())
    if (credentialParameters.has(name.toLowerCase()))
      throw new Error(
        "Source URLs must not contain credential query parameters",
      );
  return url;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Validate retained bytes and retrieval provenance without making requests. */
export const validateSourceEvidence = (input) => {
  const record = schema.parse(input);
  if (
    record.created_at !== record.retrieved_at ||
    Date.parse(record.started_at) > Date.parse(record.retrieved_at)
  )
    throw new Error("Source capture retrieval timestamps are inconsistent");
  let current = checkedUrl(record.subject.url).href;
  for (const redirect of record.redirects) {
    const destination = checkedUrl(
      new URL(redirect.location, current).href,
    ).href;
    if (redirect.url !== current || redirect.resolved_url !== destination)
      throw new Error("Source capture redirect chain is inconsistent");
    current = destination;
  }
  if (record.final_url !== current)
    throw new Error(
      "Source capture final URL does not match its redirect chain",
    );
  if (
    record.byte_length > record.limits.max_bytes ||
    record.body_base64.length > 4 * Math.ceil(record.limits.max_bytes / 3)
  )
    throw new Error("Source capture exceeds its declared byte limit");
  const bytes = Buffer.from(record.body_base64, "base64");
  if (
    bytes.toString("base64") !== record.body_base64 ||
    bytes.length !== record.byte_length ||
    sha256(bytes) !== record.body_sha256
  )
    throw new Error(
      "Source capture body encoding, byte length or SHA-256 mismatch",
    );
  return record;
};

const readBoundedBody = async (response, maxBytes) => {
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new Error(
          "Source capture exceeded its maximum decoded body bytes",
        );
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
};

const requestSource = async (initial, signal) => {
  let current = initial;
  const redirects = [];
  while (true) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal,
      headers: { "user-agent": "REA-source-capture/1" },
    });
    if (!redirectStatuses.has(response.status)) {
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Source request returned HTTP ${response.status}`);
      }
      return { response, redirects, finalUrl: current.href };
    }
    await response.body?.cancel();
    if (redirects.length === MAX_REDIRECTS)
      throw new Error("Source capture exceeded its maximum redirects");
    const location = response.headers.get("location");
    if (location === null)
      throw new Error("Source redirect is missing its Location header");
    const destination = checkedUrl(new URL(location, current).href);
    redirects.push({
      url: current.href,
      status: response.status,
      location,
      resolved_url: destination.href,
    });
    current = destination;
  }
};

/** Explicitly fetch one source and its redirects; never crawl or execute it. */
export const collectSourceEvidence = async ({
  url,
  scope,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = 30_000,
}) => {
  const original = text.parse(url);
  const initial = checkedUrl(original);
  const sourceScope = text.parse(scope);
  const maximum = maxBytesSchema.parse(maxBytes);
  const timeout = timeoutSchema.parse(timeoutMs);
  const started = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const { response, redirects, finalUrl } = await requestSource(
      initial,
      controller.signal,
    );
    const bytes = await readBoundedBody(response, maximum);
    const retrieved = new Date().toISOString();
    return validateSourceEvidence({
      version: 1,
      kind: "source",
      created_at: retrieved,
      started_at: started,
      retrieved_at: retrieved,
      subject: { url: original },
      final_url: finalUrl,
      redirects,
      status: response.status,
      content_type: response.headers.get("content-type"),
      content_encoding: response.headers.get("content-encoding"),
      body_representation: "fetch-decoded-bytes",
      body_base64: bytes.toString("base64"),
      body_sha256: sha256(bytes),
      byte_length: bytes.length,
      scope: sourceScope,
      limits: {
        max_bytes: maximum,
        timeout_ms: timeout,
        max_redirects: MAX_REDIRECTS,
      },
      limitations: [
        "Retains the exact bytes returned by Fetch after its HTTP content decoding (for example gzip), not compressed wire bytes. Content-Encoding records the response header.",
        "GET response only; scripts, linked documents, authenticated sessions and browser rendering are not captured. A successful response does not establish factual accuracy, completeness or issuer authenticity.",
        "Local retrieval timestamps and a SHA-256 digest establish retained content identity, not a trusted timestamp or independent attestation. Source terms and state can change after retrieval.",
      ],
    });
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(`Source capture timed out after ${timeout}ms`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
