import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import canonicalize from "canonicalize";
import { expect, onTestFinished } from "vitest";

import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import {
  processTest,
  type TestProcesses,
} from "../support/process/processFixture.js";

const script = resolve("scripts/daniel-diligence.mjs");

const serve = async (handler: RequestListener): Promise<string> => {
  const server = createServer(handler);
  onTestFinished(async () => {
    const closed = new Promise<void>((resolveClose, reject) => {
      server.close((error) => {
        if (error === undefined) resolveClose();
        else reject(error);
      });
    });
    server.closeAllConnections();
    await closed;
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Expected a TCP source fixture listener");
  return `http://127.0.0.1:${String(address.port)}`;
};

const initialize = async (processes: TestProcesses): Promise<string> => {
  const root = await createTestTempDirectory("rea-source-capture-");
  const output = join(root, "case");
  const result = await processes.run(process.execPath, [
    script,
    "init",
    "--profile",
    "stablecoin",
    "--subject",
    "Fixture issuer",
    "--question",
    "What redemption terms were actually retrieved?",
    "--out",
    output,
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  return output;
};

const sourceArgs = (output: string, url: string): string[] => [
  script,
  "source",
  "--case",
  output,
  "--url",
  url,
  "--scope",
  "Read-only capture of the selected issuer terms",
];

processTest(
  "retains fetched decoded bytes, redirect provenance and source identity, then rejects a reidentified corrupt body offline",
  async ({ processes }) => {
    const body = Buffer.concat([
      Buffer.from("Issuer terms\r\n撤回条件\n", "utf8"),
      Buffer.from([0, 255, 128]),
    ]);
    const visited: string[] = [];
    const url = await serve((request, response) => {
      visited.push(request.url ?? "");
      if (request.url?.startsWith("/start") === true) {
        response.writeHead(302, {
          location: "/terms?note=keep%20caller%20text&key=product-key",
        });
        response.end();
      } else {
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-encoding": "gzip",
        });
        response.end(gzipSync(body));
      }
    });
    const output = await initialize(processes);
    const original = `${url}/start?name=issuer`;
    const captured = await processes.run(
      process.execPath,
      sourceArgs(output, original),
    );
    expect(captured.exitCode, captured.stderr).toBe(0);
    const summary = JSON.parse(captured.stdout) as { capture_id: string };
    const capturePath = join(output, "captures", `${summary.capture_id}.json`);
    const envelope = JSON.parse(await readFile(capturePath, "utf8")) as {
      capture_id: string;
      record: Record<string, unknown> & { body_base64: string };
    };
    expect(envelope.capture_id).toBe(summary.capture_id);
    expect(envelope.record).toMatchObject({
      kind: "source",
      subject: { url: original },
      final_url: `${url}/terms?note=keep%20caller%20text&key=product-key`,
      redirects: [
        {
          url: original,
          status: 302,
          location: "/terms?note=keep%20caller%20text&key=product-key",
          resolved_url: `${url}/terms?note=keep%20caller%20text&key=product-key`,
        },
      ],
      status: 200,
      content_type: "application/octet-stream",
      content_encoding: "gzip",
      body_representation: "fetch-decoded-bytes",
      body_sha256: createHash("sha256").update(body).digest("hex"),
      byte_length: body.length,
    });
    expect(Buffer.from(envelope.record.body_base64, "base64")).toEqual(body);
    expect(visited).toEqual([
      "/start?name=issuer",
      "/terms?note=keep%20caller%20text&key=product-key",
    ]);
    const report = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(report.exitCode, report.stderr).toBe(0);
    expect(report.stdout).toContain(summary.capture_id);

    // Recompute the outer commitment so this proves the offline source validator
    // checks the retained body, independently of the capture envelope's hash.
    envelope.record.body_base64 =
      Buffer.from("changed terms").toString("base64");
    const canonical = canonicalize(envelope.record);
    if (canonical === undefined) throw new Error("Expected canonical record");
    envelope.capture_id = `cap_${createHash("sha256").update(canonical).digest("hex")}`;
    await writeFile(
      join(output, "captures", `${envelope.capture_id}.json`),
      JSON.stringify(envelope),
    );
    await unlink(capturePath);
    const rejected = await processes.run(process.execPath, [
      script,
      "report",
      "--case",
      output,
    ]);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("byte length or SHA-256 mismatch");
    expect(visited).toHaveLength(2);
  },
);

processTest(
  "bounds decoded response bytes, redirect count and a streaming timeout without retaining failed captures",
  async ({ processes }) => {
    const url = await serve((request, response) => {
      switch (request.url) {
        case "/large":
          response.writeHead(200, { "content-encoding": "gzip" });
          response.end(gzipSync(Buffer.alloc(1024, 65)));
          break;
        case "/loop":
          response.writeHead(302, { location: "/loop" });
          response.end();
          break;
        case "/slow":
          response.writeHead(200);
          response.write("pending");
          break;
        default:
          response.writeHead(503);
          response.end("Unavailable terms are not a successful source capture");
      }
    });
    const output = await initialize(processes);
    const failures = [
      ["/missing", [], "HTTP 503"],
      ["/large", ["--max-bytes", "32"], "maximum decoded body bytes"],
      ["/loop", [], "maximum redirects"],
      ["/slow", ["--timeout-ms", "50"], "timed out after 50ms"],
    ] as const;
    for (const [path, options, message] of failures) {
      const result = await processes.run(
        process.execPath,
        [...sourceArgs(output, `${url}${path}`), ...options],
        { timeoutMs: 15_000 },
      );
      expect(result.exitCode, result.stdout).toBe(1);
      expect(result.stderr).toContain(message);
    }
    expect(
      await readdir(join(output, "captures")).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return [];
      }),
    ).toEqual([]);
  },
);

processTest(
  "rejects credential URLs and insecure remote URLs before requests and rejects credential-bearing redirects",
  async ({ processes }) => {
    const visited: string[] = [];
    const secret = "source-test-credential";
    const url = await serve((request, response) => {
      visited.push(request.url ?? "");
      response.writeHead(302, { location: `/terms?access_token=${secret}` });
      response.end();
    });
    const output = await initialize(processes);
    const invalidUrls = [
      `${url.replace("http://", `http://user:${secret}@`)}/terms`,
      `${url}/terms?api_key=${secret}`,
      "http://example.invalid/terms",
    ];
    for (const invalidUrl of invalidUrls) {
      const result = await processes.run(
        process.execPath,
        sourceArgs(output, invalidUrl),
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).not.toContain(secret);
    }
    expect(visited).toEqual([]);
    const redirect = await processes.run(
      process.execPath,
      sourceArgs(output, `${url}/start`),
    );
    expect(redirect.exitCode).toBe(1);
    expect(redirect.stderr).toContain("credential query parameters");
    expect(redirect.stderr).not.toContain(secret);
    expect(visited).toEqual(["/start"]);
  },
);
