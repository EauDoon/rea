import { z } from "zod";

export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);
export const bytesSchema = z
  .string()
  .max(MAX_RESPONSE_BYTES)
  .regex(/^0x(?:[0-9a-fA-F]{2})*$/u);
export const wordSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/u);
export const quantitySchema = z
  .string()
  .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u)
  .max(66);
const slotSchema = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/u);
const idSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u);
const expectationSchema = z.union([
  z.strictObject({ result: bytesSchema }),
  z.strictObject({ revert: z.literal(true) }),
]);
const callSchema = z.strictObject({
  id: idSchema,
  method: z.literal("eth_call"),
  to: addressSchema.optional(),
  data: bytesSchema.max(256 * 1024),
  from: addressSchema.optional(),
  value: quantitySchema.optional(),
  gas: quantitySchema.optional(),
  expect: expectationSchema.optional(),
});
const storageSchema = z.strictObject({
  id: idSchema,
  method: z.literal("eth_getStorageAt"),
  address: addressSchema.optional(),
  slot: slotSchema,
  follow_implementation: z.boolean().optional(),
});
const readsSchema = z
  .array(z.union([callSchema, storageSchema]))
  .max(100)
  .refine(
    (reads) => new Set(reads.map((read) => read.id)).size === reads.length,
    "Read identifiers must be unique",
  )
  .refine(
    (reads) => reads.every((read) => !read.id.startsWith("eip1967_")),
    "The eip1967_ read identifier prefix is reserved",
  );
export const optionsSchema = z.strictObject({
  rpcUrl: z.string().url(),
  chainId: z
    .string()
    .regex(/^[1-9][0-9]*$/u)
    .max(78),
  address: addressSchema,
  block: z
    .union([
      z.enum(["latest", "safe", "finalized", "earliest"]),
      quantitySchema,
    ])
    .default("finalized"),
  reads: readsSchema.default([]),
});
export const rpcMethodSchema = z.enum([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_call",
]);
const requestSchema = z.strictObject({
  jsonrpc: z.literal("2.0"),
  id: z.number().int().positive(),
  method: rpcMethodSchema,
  params: z.array(z.unknown()),
});
const rpcErrorSchema = z
  .object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .passthrough();
const transportErrorSchema = z.strictObject({
  kind: z.enum(["transport", "http", "oversized", "protocol"]),
  message: z.string(),
  http_status: z.number().int().optional(),
});
const transcriptSchema = z
  .strictObject({
    request: requestSchema,
    response: z.unknown().optional(),
    transport_error: transportErrorSchema.optional(),
  })
  .refine(
    (entry) =>
      entry.response !== undefined || entry.transport_error !== undefined,
    "A transcript requires a response or a transport failure",
  );
const observationFields = {
  status: z.enum(["observed", "unknown"]),
  transcript_id: z.number().int().positive(),
  value: bytesSchema.optional(),
  reason: z.string().optional(),
};
const codeSchema = z.strictObject({
  address: addressSchema,
  purpose: z.string().min(1),
  ...observationFields,
});
const slotObservationSchema = z.strictObject({
  id: z.string().min(1),
  address: addressSchema,
  slot: slotSchema,
  decoded_address: addressSchema.optional(),
  ...observationFields,
});
const probeSchema = z.strictObject({
  id: z.string().min(1),
  transcript_id: z.number().int().positive(),
  status: z.enum(["pass", "fail", "observed", "unknown"]),
  expectation: expectationSchema.optional(),
  result: bytesSchema.optional(),
  error: rpcErrorSchema.optional(),
  reason: z.string().optional(),
});
export const recordSchema = z.strictObject({
  kind: z.literal("evm-rpc"),
  version: z.literal(1),
  created_at: z.iso.datetime(),
  rpc_origin: z.string().url(),
  block_selection: optionsSchema.shape.block,
  selected_reads: readsSchema,
  subject: z.strictObject({
    chain_id: optionsSchema.shape.chainId,
    address: addressSchema,
    block_number: quantitySchema,
    block_hash: wordSchema,
  }),
  transcript: z.array(transcriptSchema).min(6).max(400),
  code: z.array(codeSchema).min(1),
  slots: z.array(slotObservationSchema).min(3),
  probes: z.array(probeSchema),
  limitations: z.array(z.string()).min(1),
});

export const STANDARD_SLOTS = [
  [
    "eip1967_implementation",
    "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    "implementation",
  ],
  [
    "eip1967_admin",
    "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103",
    null,
  ],
  [
    "eip1967_beacon",
    "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
    "beacon",
  ],
];
export const LIMITATIONS = [
  "One RPC endpoint supplies these observations; its chain identity and results are not independently authenticated.",
  "Reads are pinned to a concrete block number and its hash is rechecked after collection; this does not prove consensus finality or rule out a dishonest endpoint.",
  "Standard proxy slots and explicitly selected reads do not discover every proxy, role, holder, parameter, or privilege. A zero slot does not establish immutability.",
  "eth_call probes simulate independently against the same block. They do not submit transactions or apply state changes between probes, and cannot establish transaction inclusion, multi-step recovery, or future sellability.",
  "A successful call establishes the returned bytes for the exact caller input; it does not independently establish the intended business effect.",
  "RPC endpoint paths, queries, and authentication are omitted. Endpoint values echoed in error or unknown metadata are redacted; validated chain results and protocol fields retain their source values. Transport failure messages are deliberately generic.",
];

export const responseOutcome = (entry) => {
  if (entry.transport_error !== undefined)
    return { status: "unknown", reason: entry.transport_error.message };
  const parsed = z
    .object({
      jsonrpc: z.literal("2.0"),
      id: z.literal(entry.request.id),
      result: z.unknown().optional(),
      error: rpcErrorSchema.optional(),
    })
    .passthrough()
    .safeParse(entry.response);
  if (
    !parsed.success ||
    Object.hasOwn(parsed.data, "result") === Object.hasOwn(parsed.data, "error")
  )
    return { status: "unknown", reason: "Malformed JSON-RPC response" };
  if (parsed.data.error !== undefined)
    return { status: "error", error: parsed.data.error };
  return { status: "result", result: parsed.data.result };
};

export const requiredResult = (result, schema, label) => {
  if (result.status !== "result")
    throw new Error(
      `Cannot establish ${label}: ${result.reason ?? "RPC error"}`,
    );
  const parsed = schema.safeParse(result.result);
  if (!parsed.success)
    throw new Error(`Cannot establish ${label}: invalid RPC result`);
  return parsed.data;
};
export const blockSchema = z
  .object({ number: quantitySchema, hash: wordSchema })
  .passthrough();
export const nonzeroAddress = (word) => {
  if (!wordSchema.safeParse(word).success || !/^0x0{24}/iu.test(word))
    return undefined;
  const address = `0x${word.slice(-40)}`;
  return /^0x0{40}$/u.test(address) ? undefined : address;
};
export const observation = (response, schema) => {
  const base = { transcript_id: response.transcript_id };
  if (response.status !== "result")
    return {
      ...base,
      status: "unknown",
      reason:
        response.reason ??
        `RPC error ${response.error.code}: ${response.error.message}`,
    };
  const parsed = schema.safeParse(response.result);
  return parsed.success
    ? { ...base, status: "observed", value: parsed.data }
    : {
        ...base,
        status: "unknown",
        reason: "RPC returned an invalid value for this method",
      };
};
const executionRevert = (error) => {
  // Codes 3 and -32000 are commonly used for EVM failures. A matching message
  // alone cannot turn an infrastructure/auth/rate-limit error into a passing probe.
  return (
    [3, -32000, -32015].includes(error.code) &&
    /^(?:execution reverted(?:$|[:\s])|VM execution error[.:\s].*\brevert)/iu.test(
      error.message,
    ) &&
    (error.data === undefined || bytesSchema.safeParse(error.data).success)
  );
};
export const evaluateProbe = (id, response, expectation) => {
  const base = {
    id,
    transcript_id: response.transcript_id,
    ...(expectation === undefined ? {} : { expectation }),
  };
  if (response.status === "unknown")
    return { ...base, status: "unknown", reason: response.reason };
  if (response.status === "error") {
    const reverted = executionRevert(response.error);
    return {
      ...base,
      error: response.error,
      status:
        reverted && expectation !== undefined
          ? "revert" in expectation
            ? "pass"
            : "fail"
          : "unknown",
      reason: reverted
        ? "RPC reported EVM execution reverted"
        : "RPC error does not establish an EVM revert",
    };
  }
  if (!bytesSchema.safeParse(response.result).success)
    return {
      ...base,
      status: "unknown",
      reason: "eth_call returned invalid byte data",
    };
  if (expectation === undefined)
    return { ...base, status: "observed", result: response.result };
  const matches =
    "result" in expectation &&
    response.result.toLowerCase() === expectation.result.toLowerCase();
  return {
    ...base,
    status: matches ? "pass" : "fail",
    result: response.result,
  };
};

export const callInput = (read, subject) =>
  Object.fromEntries(
    [
      ["to", read.to ?? subject],
      ["data", read.data],
      ["from", read.from],
      ["value", read.value],
      ["gas", read.gas],
    ].filter(([, value]) => value !== undefined),
  );

export const validateEndpointUrl = (input) => {
  const endpoint = new URL(input);
  if (!["https:", "http:"].includes(endpoint.protocol))
    throw new Error("RPC endpoint must use HTTP(S)");
  if (
    endpoint.protocol === "http:" &&
    !/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/u.test(endpoint.hostname)
  )
    throw new Error(
      "Remote RPC endpoints must use HTTPS; HTTP is limited to loopback fixtures",
    );
  if (endpoint.hash) throw new Error("RPC endpoint must not have a fragment");
  return endpoint;
};

export const validateSelectedBlock = (selection, resolvedNumber) => {
  const selectedNumber = selection === "earliest" ? "0x0" : selection;
  if (
    quantitySchema.safeParse(selectedNumber).success &&
    BigInt(resolvedNumber) !== BigInt(selectedNumber)
  )
    throw new Error("RPC returned a different block number than selected");
};
