import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { join, resolve } from "node:path";
import canonicalize from "canonicalize";
import { expect, onTestFinished } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  processTest,
  type TestProcesses,
} from "../support/process/processFixture.js";

const script = resolve("scripts/daniel-diligence.mjs");
interface PacketFile {
  path: string;
  body_base64: string;
  bytes: number;
  sha256: string;
}
interface Packet {
  version: number;
  exported_at: string;
  directories: string[];
  files: PacketFile[];
  manifest_sha256: string;
  packet_id: string;
}
const digest = (body: string | Buffer): string =>
  createHash("sha256").update(body).digest("hex");
const reidentify = (packet: Packet): void => {
  const canonical = canonicalize({
    version: packet.version,
    exported_at: packet.exported_at,
    directories: packet.directories,
    files: packet.files.map(({ path, bytes, sha256 }) => ({
      path,
      bytes,
      sha256,
    })),
  });
  if (canonical === undefined) throw new Error("Expected JSON packet metadata");
  packet.manifest_sha256 = digest(canonical);
  packet.packet_id = `pkt_${packet.manifest_sha256}`;
};
const initialize = async (
  processes: TestProcesses,
  out: string,
): Promise<void> => {
  const result = await processes.run(process.execPath, [
    script,
    "init",
    "--profile",
    "stablecoin",
    "--subject",
    "Fixture issuer",
    "--question",
    "Who can change redemption behavior?",
    "--out",
    out,
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
};
const serve = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler);
  onTestFinished(async () => {
    const closed = new Promise<void>((resolveClose, reject) =>
      server.close((error) =>
        error === undefined ? resolveClose() : reject(error),
      ),
    );
    server.closeAllConnections();
    await closed;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected fixture TCP listener");
  return `http://127.0.0.1:${String(address.port)}`;
};

processTest(
  "exports and imports an exact private packet including binary notes and empty directories without overwriting",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-packet-roundtrip-");
    const original = join(root, "original");
    await initialize(processes, original);
    await mkdir(join(original, "attachments", "empty"), { recursive: true });
    const bytes = Buffer.from([0, 255, 0, 17, 192, 128]);
    await writeFile(join(original, "attachments", "receipt.bin"), bytes);
    const file = join(root, "case.packet.json");
    const exported = await processes.run(process.execPath, [
      script,
      "export",
      "--case",
      original,
      "--out",
      file,
    ]);
    expect(exported.exitCode, exported.stderr).toBe(0);
    expect(JSON.parse(exported.stdout)).toMatchObject({ encrypted: false });
    const packet = JSON.parse(await readFile(file, "utf8")) as Packet;
    expect(packet.directories).toContain("attachments/empty");
    expect(packet.directories).toContain("evidence");
    const copy = join(root, "copy");
    const imported = await processes.run(process.execPath, [
      script,
      "import",
      "--file",
      file,
      "--out",
      copy,
    ]);
    expect(imported.exitCode, imported.stderr).toBe(0);
    for (const entry of packet.files) {
      expect(await readFile(join(copy, entry.path))).toEqual(
        await readFile(join(original, entry.path)),
      );
      if (process.platform !== "win32")
        expect((await lstat(join(copy, entry.path))).mode & 0o777).toBe(0o600);
    }
    expect(await readdir(join(copy, "attachments", "empty"))).toEqual([]);
    if (process.platform !== "win32") {
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
      expect((await lstat(copy)).mode & 0o777).toBe(0o700);
    }
    const reported = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      copy,
    ]);
    expect(reported.exitCode, reported.stderr).toBe(0);
    const repeated = await processes.run(process.execPath, [
      script,
      "import",
      "--file",
      file,
      "--out",
      copy,
    ]);
    expect(repeated.exitCode).toBe(1);
    expect(repeated.stderr).toContain("output already exists");
    expect(await readFile(join(copy, "attachments", "receipt.bin"))).toEqual(
      bytes,
    );
    const overwritten = await processes.run(process.execPath, [
      script,
      "export",
      "--case",
      original,
      "--out",
      file,
    ]);
    expect(overwritten.exitCode).toBe(1);
    expect(overwritten.stderr).toContain("output already exists");
  },
);

processTest(
  "rejects edited hashes, traversal, duplicate names, resource excess and rehashed invalid workspaces before committing import",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-packet-invalid-");
    const original = join(root, "case");
    await initialize(processes, original);
    const file = join(root, "original.json");
    const exported = await processes.run(process.execPath, [
      script,
      "export",
      "--case",
      original,
      "--out",
      file,
    ]);
    expect(exported.exitCode, exported.stderr).toBe(0);
    const source = JSON.parse(await readFile(file, "utf8")) as Packet;
    const mutate = async (
      name: string,
      change: (packet: Packet) => void,
      message: string,
    ): Promise<void> => {
      const packet = structuredClone(source);
      change(packet);
      const malformed = join(root, `${name}.json`);
      const out = join(root, name);
      await writeFile(malformed, JSON.stringify(packet));
      const result = await processes.run(process.execPath, [
        script,
        "import",
        "--file",
        malformed,
        "--out",
        out,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(message);
      expect(await readdir(root)).not.toContain(name);
      expect(
        (await readdir(root)).filter((entry) =>
          entry.startsWith(".rea-import-"),
        ),
      ).toEqual([]);
    };
    await mutate(
      "tampered",
      (packet) => {
        packet.manifest_sha256 = "0".repeat(64);
      },
      "manifest integrity mismatch",
    );
    await mutate(
      "traversal",
      (packet) => {
        packet.directories.push("../escape");
        reidentify(packet);
      },
      "traversal",
    );
    await mutate(
      "duplicate",
      (packet) => {
        packet.directories.push("evidence");
        reidentify(packet);
      },
      "Duplicate packet entry",
    );
    await mutate(
      "device",
      (packet) => {
        packet.directories.push("CON");
        reidentify(packet);
      },
      "portable ordinary filenames",
    );
    await mutate(
      "oversized",
      (packet) => {
        const first = packet.files[0];
        if (first === undefined) throw new Error("Missing fixture file");
        first.bytes = 17 * 1024 * 1024;
        reidentify(packet);
      },
      "resource limit",
    );
    await mutate(
      "body",
      (packet) => {
        const first = packet.files[0];
        if (first === undefined) throw new Error("Missing fixture file");
        first.body_base64 = "!".repeat(first.body_base64.length);
      },
      "integrity mismatch",
    );
    await mutate(
      "invalid-workspace",
      (packet) => {
        const claims = packet.files.find(({ path }) => path === "claims.json");
        if (claims === undefined) throw new Error("Missing claims file");
        const replacement = Buffer.from("[]\n");
        claims.body_base64 = replacement.toString("base64");
        claims.bytes = replacement.length;
        claims.sha256 = digest(replacement);
        reidentify(packet);
      },
      "Each profile coverage question must occur exactly once",
    );
  },
);

processTest.skipIf(process.platform === "win32")(
  "rejects case symlinks and output containment through an alias without leaking linked bytes",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-packet-links-");
    const original = join(root, "case");
    await initialize(processes, original);
    const alias = join(root, "alias");
    await symlink(original, alias, "dir");
    const contained = await processes.run(process.execPath, [
      script,
      "export",
      "--case",
      original,
      "--out",
      join(alias, "inside.json"),
    ]);
    expect(contained.exitCode).toBe(1);
    expect(contained.stderr).toContain("outside the case directory");
    const sentinel = join(root, "private.txt");
    await writeFile(sentinel, "Never include symlink target bytes");
    await symlink(sentinel, join(original, "linked.txt"));
    const output = join(root, "packet.json");
    const linked = await processes.run(process.execPath, [
      script,
      "export",
      "--case",
      original,
      "--out",
      output,
    ]);
    expect(linked.exitCode).toBe(1);
    expect(linked.stderr).toContain("symlink or special file");
    expect(await readdir(root)).not.toContain("packet.json");
    expect(await readFile(sentinel, "utf8")).toBe(
      "Never include symlink target bytes",
    );
  },
);

const comparisonFixture = async (): Promise<{
  url: string;
  advance: () => void;
}> => {
  let phase = 1;
  const url = await serve((request, response) => {
    response.setHeader("connection", "close");
    if (request.method === "GET") {
      response.end(`Redemption terms revision ${String(phase)}`);
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const rpc = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id: number;
        method: string;
        params: unknown[];
      };
      let result: unknown;
      switch (rpc.method) {
        case "eth_chainId":
          result = "0x1";
          break;
        case "eth_getBlockByNumber":
          result = {
            number: `0x${String(phase)}`,
            hash: `0x${String(phase).repeat(64)}`,
          };
          break;
        case "eth_getCode":
          result = phase === 1 ? "0x6001" : "0x6002";
          break;
        case "eth_getStorageAt":
          result = `0x${"0".repeat(63)}${rpc.params[1] === "0x0" ? String(phase) : "0"}`;
          break;
        case "eth_call":
          result = `0x${"0".repeat(63)}${String(phase)}`;
          break;
        default:
          response.writeHead(400);
          response.end("Unsupported fixture method");
          return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    });
  });
  return {
    url,
    advance: () => {
      phase++;
    },
  };
};

processTest(
  "compares retained source bytes, selected chain observations, block identities, claim changes and stale references",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-packet-compare-");
    const before = join(root, "before");
    const after = join(root, "after");
    await initialize(processes, before);
    await initialize(processes, after);
    const { url, advance } = await comparisonFixture();
    const reads = join(root, "reads.json");
    await writeFile(
      reads,
      JSON.stringify([
        { id: "selected", method: "eth_getStorageAt", slot: "0x0" },
        { id: "role", method: "eth_call", data: "0x12345678" },
      ]),
    );
    const address = `0x${"a".repeat(40)}`;
    for (const directory of [before, after]) {
      const source = await processes.run(process.execPath, [
        script,
        "source",
        "--case",
        directory,
        "--url",
        `${url}/terms`,
        "--scope",
        "Fixture source revision",
      ]);
      expect(source.exitCode, source.stderr).toBe(0);
      const chain = await processes.run(
        process.execPath,
        [
          script,
          "chain",
          "--case",
          directory,
          "--rpc-env",
          "REA_PACKET_TEST_RPC",
          "--chain-id",
          "1",
          "--address",
          address,
          "--reads",
          reads,
        ],
        { env: { ...process.env, REA_PACKET_TEST_RPC: `${url}/rpc` } },
      );
      expect(chain.exitCode, chain.stderr).toBe(0);
      await writeFile(
        join(directory, "sources.json"),
        JSON.stringify([
          {
            id: "terms",
            url: `${url}/terms`,
            retrieved_at: "2000-01-01T00:00:00Z",
            scope: "Old analyst reference retained for freshness review",
            limitations: ["Old reference"],
          },
        ]),
      );
      advance();
    }
    const claimsPath = join(after, "claims.json");
    const claims = JSON.parse(await readFile(claimsPath, "utf8")) as Array<{
      statement: string;
    }>;
    const first = claims[0];
    if (first === undefined) throw new Error("Missing first claim");
    first.statement =
      "Remaining controls need review after the observed changes.";
    await writeFile(claimsPath, JSON.stringify(claims));
    const compared = await processes.run(process.execPath, [
      script,
      "compare",
      "--before",
      before,
      "--after",
      after,
      "--max-age-days",
      "1",
    ]);
    expect(compared.exitCode, compared.stderr).toBe(0);
    const comparison = JSON.parse(compared.stdout) as {
      target_comparability: { status: string };
      claim_changes: unknown[];
      sources: {
        captures: Array<{ body_sha256: { changed: boolean } }>;
        after_register_freshness: Array<{ status: string }>;
      };
      chains: Array<{
        before_subject: { block_number: string };
        after_subject: { block_number: string };
        code: Array<{ comparison: string }>;
        slots: Array<{ comparison: string }>;
        probes: Array<{ comparison: string }>;
      }>;
    };
    expect(comparison.target_comparability.status).toBe(
      "shared-chain-address-observations",
    );
    expect(comparison.claim_changes).toHaveLength(1);
    expect(comparison.sources.captures[0]?.body_sha256.changed).toBe(true);
    expect(comparison.sources.after_register_freshness[0]?.status).toBe(
      "stale",
    );
    expect(comparison.chains[0]?.before_subject.block_number).toBe("0x1");
    expect(comparison.chains[0]?.after_subject.block_number).toBe("0x2");
    expect(comparison.chains[0]?.code[0]?.comparison).toBe(
      "observed-value-changed",
    );
    expect(
      comparison.chains[0]?.slots.some(
        ({ comparison: status }) => status === "observed-value-changed",
      ),
    ).toBe(true);
    expect(comparison.chains[0]?.probes[0]?.comparison).toBe(
      "observed-value-changed",
    );
    const invalid = await processes.run(process.execPath, [
      script,
      "compare",
      "--before",
      before,
      "--after",
      after,
      "--max-age-days",
      "NaN",
    ]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("--max-age-days");
  },
);

processTest(
  "keeps changed call inputs and changed selected expectations separate from behavioral changes",
  async ({ processes }) => {
    const root = await createTestTempDirectory("rea-packet-probe-input-");
    const { url } = await comparisonFixture();
    const cases = ["baseline", "calldata", "predicate"];
    const observed = `0x${"0".repeat(63)}1`;
    for (const name of cases) {
      const directory = join(root, name);
      await initialize(processes, directory);
      const reads = join(root, `${name}.json`);
      await writeFile(
        reads,
        JSON.stringify([
          {
            id: "role",
            method: "eth_call",
            data: name === "calldata" ? "0x87654321" : "0x12345678",
            expect: { result: name === "predicate" ? "0x00" : observed },
          },
        ]),
      );
      const captured = await processes.run(
        process.execPath,
        [
          script,
          "chain",
          "--case",
          directory,
          "--rpc-env",
          "REA_PACKET_TEST_RPC",
          "--chain-id",
          "1",
          "--address",
          `0x${"a".repeat(40)}`,
          "--reads",
          reads,
        ],
        { env: { ...process.env, REA_PACKET_TEST_RPC: `${url}/rpc` } },
      );
      expect(captured.exitCode, captured.stderr).toBe(0);
    }
    for (const name of ["calldata", "predicate"]) {
      const compared = await processes.run(process.execPath, [
        script,
        "compare",
        "--before",
        join(root, "baseline"),
        "--after",
        join(root, name),
      ]);
      expect(compared.exitCode, compared.stderr).toBe(0);
      const report = JSON.parse(compared.stdout) as {
        chains: Array<{
          probes: Array<{
            comparison: string;
            changed: boolean | null;
            before: { result: string; request: { data: string } };
            after: { result: string; request: { data: string } };
          }>;
        }>;
      };
      const probe = report.chains[0]?.probes[0];
      expect(probe?.comparison).toBe("changed-input");
      expect(probe?.changed).toBeNull();
      expect(probe?.before.result).toBe(observed);
      expect(probe?.after.result).toBe(observed);
      expect(probe?.after.request.data).toBe(
        name === "calldata" ? "0x87654321" : "0x12345678",
      );
    }
  },
);
