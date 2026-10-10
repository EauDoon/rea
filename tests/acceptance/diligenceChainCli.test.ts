import { once } from "node:events";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { expect, onTestFinished } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  processTest,
  type TestProcesses,
} from "../support/process/processFixture.js";

const script = resolve("scripts/daniel-diligence.mjs");
const address = `0x${"11".repeat(20)}`;
const implementation = `0x${"22".repeat(20)}`;
const owner = `0x${"33".repeat(20)}`;
const legacyImplementation = `0x${"44".repeat(20)}`;
const beacon = `0x${"55".repeat(20)}`;
const blockHash = `0x${"ab".repeat(32)}`;
const word = (value: string): string => `0x${value.slice(2).padStart(64, "0")}`;
const zeroWord = word("0x0");
const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
// Independently calculated from keccak256("eip1967.proxy.admin") - 1.
const adminSlot =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const beaconSlot =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

interface RpcRequest {
  id: number;
  method: string;
  params: unknown[];
}
interface RpcReply {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  httpStatus?: number;
}
interface Capture {
  capture_id: string;
  record: {
    kind: string;
    rpc_origin: string;
    block_selection: string;
    subject: {
      chain_id: string;
      address: string;
      block_number: string;
      block_hash: string;
    };
    transcript: Array<{
      request: RpcRequest;
      response?: { jsonrpc?: string; result?: unknown };
    }>;
    code: Array<{
      address: string;
      purpose: string;
      status: string;
      value?: string;
    }>;
    slots: Array<{ id: string; status: string; decoded_address?: string }>;
    probes: Array<{ id: string; status: string; result?: string }>;
  };
}

const defaultReply = (request: RpcRequest): RpcReply => {
  if (request.method === "eth_chainId") return { result: "0x1" };
  if (request.method === "eth_getBlockByNumber")
    return { result: { number: "0x7b", hash: blockHash } };
  if (request.method === "eth_getCode")
    return {
      result: request.params[0] === address ? "0x60016000" : "0x60026000",
    };
  if (request.method === "eth_getStorageAt") {
    if (request.params[1] === implementationSlot)
      return { result: word(implementation) };
    if (request.params[1] === adminSlot) return { result: word(owner) };
    if (request.params[1] === "0x01")
      return { result: word(legacyImplementation) };
    return { result: zeroWord };
  }
  const call = request.params[0] as { data: string };
  if (call.data === "0x8da5cb5b") return { result: word(owner) };
  if (call.data === "0xaaaa") return { result: word("0x1") };
  if (call.data === "0xbbbb")
    return {
      error: {
        code: 3,
        message: "execution reverted: unauthorized",
        data: "0x",
      },
    };
  if (call.data === "0xcccc")
    return {
      error: {
        code: -32005,
        message: "execution reverted: provider capacity",
        data: "0x",
      },
    };
  if (call.data === "0xdddd") return { result: 1 };
  if (call.data === "0x5c60da1b") return { result: word(legacyImplementation) };
  return { result: "0x00" };
};

const startRpc = async (
  reply: (request: RpcRequest, index: number) => RpcReply = defaultReply,
) => {
  const requests: RpcRequest[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const parsed = JSON.parse(body) as RpcRequest;
    requests.push(parsed);
    const result = reply(parsed, requests.length);
    response.setHeader("content-type", "application/json");
    response.statusCode = result.httpStatus ?? 200;
    const { httpStatus: _httpStatus, ...payload } = result;
    response.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, ...payload }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const bound = server.address();
  if (bound === null || typeof bound === "string")
    throw new Error("Missing RPC fixture port");
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error === undefined ? done() : reject(error))),
    );
  });
  return {
    requests,
    origin: `http://127.0.0.1:${bound.port}`,
    url: `http://127.0.0.1:${bound.port}/private-rpc-token?apiKey=secret-query-token`,
  };
};

const initialize = async (processes: TestProcesses) => {
  const root = await createTestTempDirectory("rea-chain-diligence-");
  const directory = join(root, "case");
  const result = await processes.run(process.execPath, [
    script,
    "init",
    "--profile",
    "stablecoin",
    "--subject",
    "Selected stablecoin",
    "--question",
    "Who can pause or upgrade?",
    "--out",
    directory,
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  return { root, directory };
};
const runChain = async (
  processes: TestProcesses,
  directory: string,
  url: string,
  extra: string[] = [],
) =>
  processes.run(
    process.execPath,
    [
      script,
      "chain",
      "--case",
      directory,
      "--rpc-env",
      "REA_DILIGENCE_TEST_RPC",
      "--chain-id",
      "1",
      "--address",
      address,
      ...extra,
    ],
    { env: { ...process.env, REA_DILIGENCE_TEST_RPC: url }, timeoutMs: 25_000 },
  );
const loadCapture = async (
  directory: string,
  stdout: string,
): Promise<Capture> => {
  const summary = JSON.parse(stdout) as { capture_id: string };
  return JSON.parse(
    await readFile(
      join(directory, "captures", `${summary.capture_id}.json`),
      "utf8",
    ),
  ) as Capture;
};

processTest(
  "captures deployed code, legacy and standard proxy storage, roles and exact independent calls at one block",
  async ({ processes }) => {
    const rpc = await startRpc();
    const { root, directory } = await initialize(processes);
    const reads = join(root, "reads.json");
    await writeFile(
      reads,
      JSON.stringify([
        {
          id: "legacy_implementation",
          method: "eth_getStorageAt",
          slot: "0x01",
          follow_implementation: true,
        },
        { id: "owner", method: "eth_call", data: "0x8da5cb5b" },
        {
          id: "transfer_allowed",
          method: "eth_call",
          data: "0xaaaa",
          from: owner,
          value: "0x0",
          gas: "0x186a0",
          expect: { result: word("0x1") },
        },
        {
          id: "unauthorized_pause",
          method: "eth_call",
          data: "0xbbbb",
          from: address,
          expect: { revert: true },
        },
        {
          id: "expected_result_mismatch",
          method: "eth_call",
          data: "0xeeee",
          expect: { result: word("0x1") },
        },
      ]),
    );
    const result = await runChain(processes, directory, rpc.url, [
      "--reads",
      reads,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const capture = await loadCapture(directory, result.stdout);
    expect(capture.record.subject).toEqual({
      chain_id: "1",
      address,
      block_number: "0x7b",
      block_hash: blockHash,
    });
    expect(capture.record.rpc_origin).toBe(rpc.origin);
    expect(capture.record.slots).toContainEqual(
      expect.objectContaining({ id: "eip1967_admin", decoded_address: owner }),
    );
    expect(JSON.stringify(capture)).not.toContain("private-rpc-token");
    expect(JSON.stringify(capture)).not.toContain("secret-query-token");
    expect(capture.record.code).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address,
          purpose: "subject",
          status: "observed",
          value: "0x60016000",
        }),
        expect.objectContaining({
          address: implementation,
          purpose: "implementation",
          status: "observed",
        }),
        expect.objectContaining({
          address: legacyImplementation,
          purpose: "selected-storage:legacy_implementation",
          status: "observed",
        }),
      ]),
    );
    expect(capture.record.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "owner",
          status: "observed",
          result: word(owner),
        }),
        expect.objectContaining({ id: "transfer_allowed", status: "pass" }),
        expect.objectContaining({ id: "unauthorized_pause", status: "pass" }),
        expect.objectContaining({
          id: "expected_result_mismatch",
          status: "fail",
        }),
      ]),
    );
    expect(
      rpc.requests.find(
        (request) =>
          request.method === "eth_call" &&
          (request.params[0] as { data: string }).data === "0xaaaa",
      )?.params,
    ).toEqual([
      {
        to: address,
        data: "0xaaaa",
        from: owner,
        value: "0x0",
        gas: "0x186a0",
      },
      "0x7b",
    ]);
    for (const request of rpc.requests) {
      expect([
        "eth_chainId",
        "eth_getBlockByNumber",
        "eth_getCode",
        "eth_getStorageAt",
        "eth_call",
      ]).toContain(request.method);
      if (
        ["eth_getCode", "eth_getStorageAt", "eth_call"].includes(request.method)
      )
        expect(request.params.at(-1)).toBe("0x7b");
    }
    expect(
      rpc.requests
        .filter((request) => request.method === "eth_getBlockByNumber")
        .map((request) => request.params),
    ).toEqual([
      ["finalized", false],
      ["0x7b", false],
    ]);
    const report = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      directory,
    ]);
    expect(report.exitCode, report.stderr).toBe(0);
    expect(report.stdout).toContain(capture.capture_id);
  },
);

processTest(
  "retains unknown RPC failures and resolves beacon implementation code without passing infrastructure errors",
  async ({ processes }) => {
    const rpc = await startRpc((request) => {
      if (
        request.method === "eth_getStorageAt" &&
        request.params[1] === beaconSlot
      )
        return { result: word(beacon) };
      if (
        request.method === "eth_getStorageAt" &&
        request.params[1] !== implementationSlot
      )
        return {
          error: { code: -32601, message: "storage method unavailable" },
        };
      if (
        request.method === "eth_call" &&
        (request.params[0] as { data: string }).data === "0xffff"
      )
        return { httpStatus: 429 };
      return defaultReply(request);
    });
    const { root, directory } = await initialize(processes);
    const reads = join(root, "reads.json");
    await writeFile(
      reads,
      JSON.stringify([
        {
          id: "provider_error",
          method: "eth_call",
          data: "0xcccc",
          expect: { revert: true },
        },
        {
          id: "invalid_result",
          method: "eth_call",
          data: "0xdddd",
          expect: { result: "0x01" },
        },
        {
          id: "rate_limit",
          method: "eth_call",
          data: "0xffff",
          expect: { revert: true },
        },
      ]),
    );
    const result = await runChain(processes, directory, rpc.url, [
      "--reads",
      reads,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const capture = await loadCapture(directory, result.stdout);
    expect(capture.record.slots).toContainEqual(
      expect.objectContaining({ id: "eip1967_admin", status: "unknown" }),
    );
    expect(capture.record.code).toContainEqual(
      expect.objectContaining({
        address: legacyImplementation,
        purpose: "beacon-implementation",
        status: "observed",
      }),
    );
    for (const id of ["provider_error", "invalid_result", "rate_limit"])
      expect(capture.record.probes).toContainEqual(
        expect.objectContaining({ id, status: "unknown" }),
      );
  },
);

processTest(
  "rejects chain mismatches and block changes without persisting a capture",
  async ({ processes }) => {
    for (const failure of ["chain", "reorg", "selected_block"] as const) {
      let blockRequests = 0;
      const rpc = await startRpc((request) => {
        if (failure === "chain" && request.method === "eth_chainId")
          return { result: "0x2" };
        if (request.method === "eth_getBlockByNumber" && ++blockRequests === 2)
          return { result: { number: "0x7b", hash: `0x${"cd".repeat(32)}` } };
        return defaultReply(request);
      });
      const { directory } = await initialize(processes);
      const result = await runChain(
        processes,
        directory,
        rpc.url,
        failure === "selected_block" ? ["--block", "0x7c"] : [],
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(
        /chain ID does not match|Block changed|different block number/u,
      );
      const names = await readdir(directory);
      if (names.includes("captures"))
        expect(await readdir(join(directory, "captures"))).toEqual([]);
    }
  },
);

processTest(
  "rejects transaction RPC and malformed selections before connecting",
  async ({ processes }) => {
    const rpc = await startRpc();
    const { root, directory } = await initialize(processes);
    const reads = join(root, "reads.json");
    for (const selected of [
      [{ id: "send", method: "eth_sendTransaction", to: address, data: "0x" }],
      [
        {
          id: "bad",
          method: "eth_call",
          data: "0x0",
          expect: { result: "0x" },
        },
      ],
      [
        {
          id: "eip1967_implementation",
          method: "eth_getStorageAt",
          slot: "0x1",
        },
      ],
    ]) {
      await writeFile(reads, JSON.stringify(selected));
      const result = await runChain(processes, directory, rpc.url, [
        "--reads",
        reads,
      ]);
      expect(result.exitCode).toBe(1);
    }
    expect(rpc.requests).toEqual([]);
  },
);

processTest(
  "offline validation rejects invented verdicts even when JSON is structurally valid",
  async ({ processes }) => {
    const rpc = await startRpc();
    const { root, directory } = await initialize(processes);
    const reads = join(root, "reads.json");
    await writeFile(
      reads,
      JSON.stringify([
        {
          id: "limited",
          method: "eth_call",
          data: "0xcccc",
          expect: { revert: true },
        },
      ]),
    );
    const result = await runChain(processes, directory, rpc.url, [
      "--reads",
      reads,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const capture = await loadCapture(directory, result.stdout);
    const changedSelection = structuredClone(capture.record);
    changedSelection.block_selection = "0x7c";
    const initialBlock = changedSelection.transcript[1];
    if (initialBlock === undefined) throw new Error("Missing block request");
    initialBlock.request.params[0] = "0x7c";
    const selectionValidation = await processes.run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {readFileSync} from 'node:fs'; import {validateChainEvidence} from './scripts/lib/diligence-chain.mjs'; validateChainEvidence(JSON.parse(readFileSync(0,'utf8')));",
      ],
      { input: JSON.stringify(changedSelection) },
    );
    expect(selectionValidation.exitCode).toBe(1);
    expect(selectionValidation.stderr).toContain(
      "different block number than selected",
    );
    const probe = capture.record.probes[0];
    if (probe === undefined) throw new Error("Missing captured probe");
    probe.status = "pass";
    const validation = await processes.run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {readFileSync} from 'node:fs'; import {validateChainEvidence} from './scripts/lib/diligence-chain.mjs'; validateChainEvidence(JSON.parse(readFileSync(0,'utf8')));",
      ],
      { input: JSON.stringify(capture.record) },
    );
    expect(validation.exitCode).toBe(1);
    expect(validation.stderr).toContain(
      "Probe verdict differs from RPC transcript",
    );
  },
);

processTest(
  "redacts endpoint credentials echoed in RPC messages, object keys and nested data",
  async ({ processes }) => {
    const basic = Buffer.from("fixture-user:fixture-password").toString(
      "base64",
    );
    const rpc = await startRpc((request) =>
      request.method === "eth_call"
        ? {
            error: {
              code: -32005,
              message: `service private-rpc-token ${basic}`,
              data: {
                "secret-query-token": [
                  "fixture-user",
                  "fixture-password",
                  `Basic ${basic}`,
                ],
              },
            },
          }
        : defaultReply(request),
    );
    const { root, directory } = await initialize(processes);
    const reads = join(root, "reads.json");
    await writeFile(
      reads,
      JSON.stringify([
        {
          id: "echoed_error",
          method: "eth_call",
          data: "0xaaaa",
          expect: { revert: true },
        },
      ]),
    );
    const url = new URL(rpc.url);
    url.username = "fixture-user";
    url.password = "fixture-password";
    const result = await runChain(processes, directory, url.href, [
      "--reads",
      reads,
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    const capture = await loadCapture(directory, result.stdout);
    for (const secret of [
      "private-rpc-token",
      "secret-query-token",
      "fixture-user",
      "fixture-password",
      basic,
    ])
      expect(JSON.stringify(capture)).not.toContain(secret);
    expect(capture.record.probes).toContainEqual(
      expect.objectContaining({ id: "echoed_error", status: "unknown" }),
    );
  },
);

processTest(
  "preserves protocol keys and typed results when endpoint components overlap RPC content",
  async ({ processes }) => {
    const rpc = await startRpc();
    const { directory } = await initialize(processes);
    for (const endpoint of ["/rpc/1", "/rpc/1?apiKey=1"]) {
      const result = await runChain(
        processes,
        directory,
        `${rpc.origin}${endpoint}`,
      );
      expect(result.exitCode, result.stderr).toBe(0);
      const capture = await loadCapture(directory, result.stdout);
      expect(capture.record.subject.chain_id).toBe("1");
      expect(capture.record.subject.block_hash).toBe(blockHash);
      expect(capture.record.transcript[0]?.response).toMatchObject({
        jsonrpc: "2.0",
        result: "0x1",
      });
      expect(capture.record.code).toContainEqual(
        expect.objectContaining({
          address,
          value: "0x60016000",
          status: "observed",
        }),
      );
      expect(capture.record.probes).toEqual([]);
    }
  },
);
