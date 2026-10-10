import {
  MAX_RESPONSE_BYTES,
  bytesSchema,
  wordSchema,
  quantitySchema,
  optionsSchema,
  rpcMethodSchema,
  STANDARD_SLOTS,
  LIMITATIONS,
  responseOutcome,
  requiredResult,
  blockSchema,
  nonzeroAddress,
  observation,
  evaluateProbe,
  callInput,
  validateEndpointUrl,
  validateSelectedBlock,
} from "./diligence-chain-contract.mjs";
import { validateChainEvidence } from "./diligence-chain-validation.mjs";
export { validateChainEvidence } from "./diligence-chain-validation.mjs";
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const REDACTED = "[redacted transport value]";
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const parseEndpoint = (input) => {
  const endpoint = validateEndpointUrl(input);
  const headers = { "content-type": "application/json" };
  if (endpoint.username || endpoint.password) {
    headers.authorization = `Basic ${Buffer.from(`${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`).toString("base64")}`;
  }
  const secrets = [
    input,
    endpoint.href,
    endpoint.pathname !== "/" ? endpoint.pathname : "",
    ...endpoint.searchParams.values(),
    endpoint.username,
    endpoint.password,
    decodeURIComponent(endpoint.username),
    decodeURIComponent(endpoint.password),
    headers.authorization ?? "",
    headers.authorization?.slice("Basic ".length) ?? "",
  ]
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length);
  // Path components can be routing words such as rpc or v1. Match whole tokens
  // so these cannot change jsonrpc or hexadecimal result bytes by substring.
  const pathComponents = [
    ...new Set([
      ...endpoint.pathname.split("/"),
      ...endpoint.pathname.split("/").map(decodeURIComponent),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(
      (value) =>
        new RegExp(
          `(?<![\\p{L}\\p{N}_])${escapeRegex(value)}(?![\\p{L}\\p{N}_])`,
          "gu",
        ),
    );
  endpoint.username = "";
  endpoint.password = "";
  const redact = (value) => {
    if (typeof value === "string")
      return pathComponents.reduce(
        (text, pattern) => text.replaceAll(pattern, REDACTED),
        secrets.reduce(
          (text, secret) => text.replaceAll(secret, REDACTED),
          value,
        ),
      );
    if (Array.isArray(value)) return value.map(redact);
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          redact(key),
          redact(entry),
        ]),
      );
    return value;
  };
  return { endpoint, headers, redact };
};

const redactError = (value, redact) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return redact(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      ["code", "message", "data"].includes(key) ? key : redact(key),
      redact(entry),
    ]),
  );
};

const redactResult = (value, method, redact) => {
  // These fields have protocol-defined ownership. Matching an endpoint token
  // does not turn an observed chain ID, byte string or block identity into auth.
  const schema =
    method === "eth_chainId"
      ? quantitySchema
      : method === "eth_getStorageAt"
        ? wordSchema
        : bytesSchema;
  if (method !== "eth_getBlockByNumber")
    return schema.safeParse(value).success ? value : redact(value);
  if (!blockSchema.safeParse(value).success) return redact(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) =>
      ["number", "hash"].includes(key)
        ? [key, entry]
        : [redact(key), redact(entry)],
    ),
  );
};

const redactResponse = (value, method, redact) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return redact(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === "result") return [key, redactResult(entry, method, redact)];
      if (key === "error") return [key, redactError(entry, redact)];
      if (key === "jsonrpc" && entry === "2.0") return [key, entry];
      if (key === "id") return [key, redact(entry)];
      return [redact(key), redact(entry)];
    }),
  );
};

const boundedBody = async (response) => {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new RangeError("RPC response exceeds size limit");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RESPONSE_BYTES)
      throw new RangeError("RPC response exceeds size limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const createRpc = (endpointInput, transcript) => {
  const { endpoint, headers, redact } = parseEndpoint(endpointInput);
  let transcriptBytes = 0;
  return {
    origin: endpoint.origin,
    async call(method, params) {
      const entry = {
        request: {
          jsonrpc: "2.0",
          id: transcript.length + 1,
          method: rpcMethodSchema.parse(method),
          params,
        },
      };
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(entry.request),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          entry.transport_error = {
            kind: "http",
            message: `RPC HTTP status ${response.status}`,
            http_status: response.status,
          };
        } else {
          const body = redactResponse(
            await boundedBody(response),
            method,
            redact,
          );
          if (
            transcriptBytes + Buffer.byteLength(JSON.stringify(body)) >
            MAX_TRANSCRIPT_BYTES
          )
            throw new RangeError("RPC transcript exceeds size limit");
          entry.response = body;
        }
      } catch (error) {
        entry.transport_error =
          error instanceof RangeError
            ? { kind: "oversized", message: "RPC response exceeds size limit" }
            : error instanceof SyntaxError
              ? { kind: "protocol", message: "RPC response is not JSON" }
              : {
                  kind: "transport",
                  message: "RPC transport failed or timed out",
                };
      }
      transcriptBytes += Buffer.byteLength(JSON.stringify(entry));
      transcript.push(entry);
      return { ...responseOutcome(entry), transcript_id: entry.request.id };
    },
  };
};

const createObservations = (rpc, block) => {
  const code = [];
  const slots = [];
  const probes = [];
  const getCode = async (address, purpose) => {
    code.push({
      address,
      purpose,
      ...observation(
        await rpc.call("eth_getCode", [address, block.number]),
        bytesSchema,
      ),
    });
  };
  const getSlot = async (id, address, slot) => {
    const result = {
      id,
      address,
      slot,
      ...observation(
        await rpc.call("eth_getStorageAt", [address, slot, block.number]),
        wordSchema,
      ),
    };
    const decoded =
      result.status === "observed" ? nonzeroAddress(result.value) : undefined;
    if (decoded !== undefined) result.decoded_address = decoded;
    slots.push(result);
    return decoded;
  };
  return { code, slots, probes, getCode, getSlot };
};

const readBlock = async (rpc, selection, label) =>
  requiredResult(
    await rpc.call("eth_getBlockByNumber", [selection, false]),
    blockSchema,
    label,
  );

/** Collect bounded, read-only RPC observations pinned to one block. Never signs or submits. */
export const collectChainEvidence = async (input) => {
  const options = optionsSchema.parse(input);
  const transcript = [];
  const rpc = createRpc(options.rpcUrl, transcript);
  const chainId = requiredResult(
    await rpc.call("eth_chainId", []),
    quantitySchema,
    "chain identity",
  );
  if (BigInt(chainId) !== BigInt(options.chainId))
    throw new Error("RPC chain ID does not match selected chain");
  const block = await readBlock(rpc, options.block, "concrete block");
  validateSelectedBlock(options.block, block.number);
  const { code, slots, probes, getCode, getSlot } = createObservations(
    rpc,
    block,
  );
  await getCode(options.address, "subject");
  for (const [id, slot, follow] of STANDARD_SLOTS) {
    const address = await getSlot(id, options.address, slot);
    if (address === undefined || follow === null) continue;
    await getCode(address, follow);
    if (follow === "beacon") {
      const response = await rpc.call("eth_call", [
        { to: address, data: "0x5c60da1b" },
        block.number,
      ]);
      probes.push(evaluateProbe("eip1967_beacon_implementation", response));
      const implementation =
        response.status === "result"
          ? nonzeroAddress(response.result)
          : undefined;
      if (implementation !== undefined)
        await getCode(implementation, "beacon-implementation");
    }
  }
  for (const read of options.reads) {
    if (read.method === "eth_call") {
      probes.push(
        evaluateProbe(
          read.id,
          await rpc.call("eth_call", [
            callInput(read, options.address),
            block.number,
          ]),
          read.expect,
        ),
      );
    } else {
      const implementation = await getSlot(
        read.id,
        read.address ?? options.address,
        read.slot,
      );
      if (read.follow_implementation === true && implementation !== undefined)
        await getCode(implementation, `selected-storage:${read.id}`);
    }
  }
  const finalBlock = await readBlock(rpc, block.number, "final block identity");
  if (finalBlock.number !== block.number || finalBlock.hash !== block.hash)
    throw new Error(
      "Block changed during collection; discard this run and retry at a stable block",
    );
  const finalChainId = requiredResult(
    await rpc.call("eth_chainId", []),
    quantitySchema,
    "final chain identity",
  );
  if (BigInt(finalChainId) !== BigInt(options.chainId))
    throw new Error("RPC chain ID changed during collection");
  return validateChainEvidence({
    kind: "evm-rpc",
    version: 1,
    created_at: new Date().toISOString(),
    rpc_origin: rpc.origin,
    block_selection: options.block,
    selected_reads: options.reads,
    subject: {
      chain_id: options.chainId,
      address: options.address,
      block_number: block.number,
      block_hash: block.hash,
    },
    transcript,
    code,
    slots,
    probes,
    limitations: LIMITATIONS,
  });
};
