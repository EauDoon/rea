import { isDeepStrictEqual } from "node:util";
import {
  bytesSchema,
  wordSchema,
  quantitySchema,
  recordSchema,
  STANDARD_SLOTS,
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

const sameJson = isDeepStrictEqual;
const requireBoundResult = (entry, expectedMethod, expectedParams) => {
  if (
    entry?.request.method !== expectedMethod ||
    !sameJson(entry.request.params, expectedParams)
  )
    throw new Error("Chain observation does not match its pinned RPC request");
  return { ...responseOutcome(entry), transcript_id: entry.request.id };
};

const validateIdentity = (record) => {
  const { transcript, subject } = record;
  if (new URL(record.rpc_origin).origin !== record.rpc_origin)
    throw new Error(
      "RPC origin must omit endpoint path, query and credentials",
    );
  validateEndpointUrl(record.rpc_origin);
  for (let index = 0; index < transcript.length; index++) {
    if (transcript[index].request.id !== index + 1)
      throw new Error("RPC transcript identifiers must be contiguous");
  }
  const firstChain = requiredResult(
    requireBoundResult(transcript[0], "eth_chainId", []),
    quantitySchema,
    "recorded chain identity",
  );
  const lastChain = requiredResult(
    requireBoundResult(transcript.at(-1), "eth_chainId", []),
    quantitySchema,
    "recorded final chain identity",
  );
  if (
    BigInt(firstChain) !== BigInt(subject.chain_id) ||
    BigInt(lastChain) !== BigInt(subject.chain_id)
  )
    throw new Error("Recorded chain identities disagree");
  const firstBlock = requiredResult(
    requireBoundResult(transcript[1], "eth_getBlockByNumber", [
      record.block_selection,
      false,
    ]),
    blockSchema,
    "recorded block identity",
  );
  validateSelectedBlock(record.block_selection, firstBlock.number);
  const lastBlock = requiredResult(
    requireBoundResult(transcript.at(-2), "eth_getBlockByNumber", [
      subject.block_number,
      false,
    ]),
    blockSchema,
    "recorded final block identity",
  );
  for (const block of [firstBlock, lastBlock]) {
    if (
      block.number !== subject.block_number ||
      block.hash !== subject.block_hash
    )
      throw new Error("Recorded block identities disagree");
  }
};

const validateObservations = (record) => {
  const { transcript, subject } = record;
  const usedIds = new Set([1, 2, transcript.length - 1, transcript.length]);
  const use = (id) => {
    if (usedIds.has(id))
      throw new Error("RPC observation has a duplicate transcript binding");
    usedIds.add(id);
    return transcript[id - 1];
  };
  for (const item of record.code) {
    const response = requireBoundResult(
      use(item.transcript_id),
      "eth_getCode",
      [item.address, subject.block_number],
    );
    const expected = {
      address: item.address,
      purpose: item.purpose,
      ...observation(response, bytesSchema),
    };
    if (!sameJson(item, expected))
      throw new Error("Code observation differs from RPC transcript");
  }
  for (const item of record.slots) {
    const response = requireBoundResult(
      use(item.transcript_id),
      "eth_getStorageAt",
      [item.address, item.slot, subject.block_number],
    );
    const expected = {
      id: item.id,
      address: item.address,
      slot: item.slot,
      ...observation(response, wordSchema),
    };
    const address =
      expected.status === "observed"
        ? nonzeroAddress(expected.value)
        : undefined;
    if (address !== undefined) expected.decoded_address = address;
    if (!sameJson(item, expected))
      throw new Error("Storage observation differs from RPC transcript");
  }
  for (const item of record.probes) {
    const entry = use(item.transcript_id);
    if (
      entry?.request.method !== "eth_call" ||
      entry.request.params[1] !== subject.block_number
    )
      throw new Error("Probe is not bound to a pinned eth_call");
    const expected = evaluateProbe(
      item.id,
      { ...responseOutcome(entry), transcript_id: item.transcript_id },
      item.expectation,
    );
    if (!sameJson(item, expected))
      throw new Error("Probe verdict differs from RPC transcript");
  }
  if (usedIds.size !== transcript.length)
    throw new Error("RPC transcript contains unbound observations");
};

const validateCoverage = (record) => {
  const { subject, transcript } = record;
  if (
    !record.code.some(
      (item) => item.purpose === "subject" && item.address === subject.address,
    )
  )
    throw new Error("Missing subject code observation");
  for (const [id, slot] of STANDARD_SLOTS) {
    if (
      !record.slots.some(
        (item) =>
          item.id === id &&
          item.address === subject.address &&
          item.slot === slot,
      )
    )
      throw new Error("Missing standard proxy slot observation");
  }
  for (const read of record.selected_reads) {
    const collection =
      read.method === "eth_call" ? record.probes : record.slots;
    const item = collection.find((entry) => entry.id === read.id);
    if (item === undefined)
      throw new Error("Missing caller-selected read observation");
    const params =
      read.method === "eth_call"
        ? [callInput(read, subject.address), subject.block_number]
        : [read.address ?? subject.address, read.slot, subject.block_number];
    requireBoundResult(transcript[item.transcript_id - 1], read.method, params);
    if (read.method === "eth_call" && !sameJson(item.expectation, read.expect))
      throw new Error("Probe changed the caller-selected expectation");
  }
  const storageReads = record.selected_reads.filter(
    (read) => read.method === "eth_getStorageAt",
  );
  if (record.slots.length !== STANDARD_SLOTS.length + storageReads.length)
    throw new Error("Unexpected or duplicate storage observations");
  validateFollowups(record);
};

const validateFollowups = (record) => {
  const expectedCode = [
    { address: record.subject.address, purpose: "subject" },
  ];
  let beaconProbeCount = 0;
  const followSlot = (id, purpose) => {
    const address = record.slots.find(
      (item) => item.id === id,
    )?.decoded_address;
    if (address !== undefined) expectedCode.push({ address, purpose });
    return address;
  };
  followSlot("eip1967_implementation", "implementation");
  const beacon = followSlot("eip1967_beacon", "beacon");
  if (beacon !== undefined) {
    beaconProbeCount = 1;
    const probe = record.probes.find(
      (item) => item.id === "eip1967_beacon_implementation",
    );
    if (probe === undefined || probe.expectation !== undefined)
      throw new Error("Missing beacon implementation call");
    const result = requireBoundResult(
      record.transcript[probe.transcript_id - 1],
      "eth_call",
      [{ to: beacon, data: "0x5c60da1b" }, record.subject.block_number],
    );
    const implementation =
      result.status === "result" ? nonzeroAddress(result.result) : undefined;
    if (implementation !== undefined)
      expectedCode.push({
        address: implementation,
        purpose: "beacon-implementation",
      });
  }
  for (const read of record.selected_reads) {
    if (
      read.method === "eth_getStorageAt" &&
      read.follow_implementation === true
    )
      followSlot(read.id, `selected-storage:${read.id}`);
  }
  const actualCode = record.code.map(({ address, purpose }) => ({
    address,
    purpose,
  }));
  if (!sameJson(actualCode, expectedCode))
    throw new Error(
      "Implementation code coverage differs from selected proxy observations",
    );
  if (
    record.probes.length !==
    record.selected_reads.filter((read) => read.method === "eth_call").length +
      beaconProbeCount
  )
    throw new Error("Unexpected or duplicate call probes");
};

/** Validate persisted records, including verdicts, coverage and transcript bindings. */
export const validateChainEvidence = (input) => {
  const record = recordSchema.parse(input);
  validateIdentity(record);
  validateObservations(record);
  validateCoverage(record);
  return record;
};
