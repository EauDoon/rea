import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  rm,
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
import canonicalize from "canonicalize";

import { loadDiligenceWorkspace } from "./diligence-workspace.mjs";

// A JSON packet retains bytes without archives, extraction tools or executable metadata.
const LIMITS = Object.freeze({
  max_entries: 10_000,
  max_depth: 32,
  max_path_bytes: 1_024,
  max_file_bytes: 16 * 1024 * 1024,
  max_total_bytes: 64 * 1024 * 1024,
  max_packet_bytes: 96 * 1024 * 1024,
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (left, right) => canonicalize(left) === canonicalize(right);
const manifest = ({ version, exported_at, directories, files }) => ({
  version,
  exported_at,
  directories,
  files: files.map(({ path, bytes, sha256: digest }) => ({
    path,
    bytes,
    sha256: digest,
  })),
});
const inside = (parent, child) => {
  const relation = relative(parent, child);
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${sep}`) &&
      !isAbsolute(relation))
  );
};
const requiredPath = (value, label) => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} requires a nonblank path`);
  return resolve(value);
};
const futurePath = async (path) => {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await futurePath(parent), basename(path));
  }
};
const absent = async (path) => {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    "The output already exists; select a new packet or directory",
  );
};
const regularBytes = async (path, limit) => {
  if (!(await lstat(path)).isFile())
    throw new Error(`Expected a regular file, not a symlink: ${path}`);
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const state = await handle.stat();
    if (!state.isFile() || state.size > limit)
      throw new Error(
        `Regular file exceeds the ${limit}-byte resource limit: ${path}`,
      );
    const data = Buffer.alloc(state.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(
        data,
        offset,
        data.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      offset !== state.size ||
      after.size !== state.size ||
      after.mtimeMs !== state.mtimeMs
    )
      throw new Error(`File changed while reading: ${path}`);
    return data.subarray(0, offset);
  } finally {
    await handle.close();
  }
};
const packetPath = (value) => {
  if (
    typeof value !== "string" ||
    value === "" ||
    Buffer.byteLength(value) > LIMITS.max_path_bytes ||
    /[\\:]/u.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error("Packet entry has an invalid or excessive relative path");
  const segments = value.split("/");
  if (
    segments.length > LIMITS.max_depth ||
    segments.some((part) => part === "" || part === "." || part === "..")
  )
    throw new Error(
      "Packet entry traversal or excessive directory depth is forbidden",
    );
  if (
    segments.some(
      (part) =>
        /[<>"|?*]/u.test(part) ||
        /[ .]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part),
    )
  )
    throw new Error(
      "Packet entries must use portable ordinary filenames, not device names",
    );
  return value;
};
const readTree = async (root) => {
  const directories = [];
  const files = [];
  let totalBytes = 0;
  const visit = async (directory, prefix) => {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    )) {
      const path = packetPath(
        prefix === "" ? child.name : `${prefix}/${child.name}`,
      );
      if (directories.length + files.length >= LIMITS.max_entries)
        throw new Error(
          `Packet exceeds the ${LIMITS.max_entries}-entry resource limit`,
        );
      const absolute = join(directory, child.name);
      const state = await lstat(absolute);
      if (state.isSymbolicLink() || (!state.isFile() && !state.isDirectory()))
        throw new Error(`Packet contains a symlink or special file: ${path}`);
      if (!inside(root, await realpath(absolute)))
        throw new Error(`Packet path escaped the case directory: ${path}`);
      if (state.isDirectory()) {
        directories.push(path);
        await visit(absolute, path);
      } else {
        if (totalBytes + state.size > LIMITS.max_total_bytes)
          throw new Error(
            `Packet exceeds the ${LIMITS.max_total_bytes}-byte decoded resource limit`,
          );
        const bytes = await regularBytes(absolute, LIMITS.max_file_bytes);
        if (!inside(root, await realpath(absolute)))
          throw new Error(`Packet path escaped the case directory: ${path}`);
        totalBytes += bytes.length;
        files.push({
          path,
          body_base64: bytes.toString("base64"),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
      }
    }
  };
  await visit(root, "");
  return {
    directories: directories.sort(),
    files: files.sort((a, b) => a.path.localeCompare(b.path, "en")),
    totalBytes,
  };
};

/** Export a fully validated case to a new private, integrity-checkable file. */
export const exportDiligencePacket = async ({ caseDirectory, out }) => {
  const directory = requiredPath(caseDirectory, "export --case");
  if (!(await lstat(directory)).isDirectory())
    throw new Error("The case must be an ordinary directory, not a symlink");
  const { root } = await loadDiligenceWorkspace(directory);
  const output = await futurePath(requiredPath(out, "export --out"));
  if (inside(root, output))
    throw new Error(
      "Keep the exported packet outside the case directory, including symlink aliases",
    );
  await absent(output);
  const { directories, files, totalBytes } = await readTree(root);
  const packet = {
    version: 1,
    exported_at: new Date().toISOString(),
    directories,
    files,
  };
  const digest = sha256(canonicalize(manifest(packet)));
  const serialized = `${JSON.stringify({ ...packet, manifest_sha256: digest, packet_id: `pkt_${digest}` })}\n`;
  if (Buffer.byteLength(serialized) > LIMITS.max_packet_bytes)
    throw new Error(
      `Packet exceeds the ${LIMITS.max_packet_bytes}-byte serialized resource limit`,
    );
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const stage = await validatedStage(packet, dirname(output));
  try {
    const stagedBundle = join(
      stage.temporary,
      `.rea-bundle-${randomUUID()}.json`,
    );
    await writeFile(stagedBundle, serialized, { flag: "wx", mode: 0o600 });
    // A same-filesystem hard link publishes complete bytes and refuses existing destinations.
    await link(stagedBundle, output);
  } finally {
    await removeOwnedDirectory(stage.temporary, stage.identity);
  }
  return {
    packet: output,
    packet_id: `pkt_${digest}`,
    files: files.length,
    directories: directories.length,
    decoded_bytes: totalBytes,
    encrypted: false,
    limits: LIMITS,
  };
};

const exactKeys = (value, keys, label) => {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !same(Object.keys(value).sort(), [...keys].sort())
  )
    throw new Error(`Invalid ${label} fields`);
};
const validateFileBytes = (file) => {
  if (
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 0 ||
    file.bytes > LIMITS.max_file_bytes ||
    typeof file.body_base64 !== "string" ||
    file.body_base64.length !== 4 * Math.ceil(file.bytes / 3)
  )
    throw new Error(
      `Invalid packet byte length or file resource limit: ${file.path}`,
    );
  const bytes = Buffer.from(file.body_base64, "base64");
  if (
    bytes.length !== file.bytes ||
    bytes.toString("base64") !== file.body_base64 ||
    sha256(bytes) !== file.sha256
  )
    throw new Error(
      `Packet file hash or base64 integrity mismatch: ${file.path}`,
    );
};
const validatePacket = (packet) => {
  exactKeys(
    packet,
    [
      "version",
      "exported_at",
      "directories",
      "files",
      "manifest_sha256",
      "packet_id",
    ],
    "packet",
  );
  if (
    packet.version !== 1 ||
    typeof packet.exported_at !== "string" ||
    !Number.isFinite(Date.parse(packet.exported_at))
  )
    throw new Error("Unsupported packet version or invalid export date");
  if (
    !Array.isArray(packet.directories) ||
    !Array.isArray(packet.files) ||
    packet.directories.length + packet.files.length > LIMITS.max_entries
  )
    throw new Error(
      "Packet entry resource limit exceeded or invalid entry lists",
    );
  const names = new Set();
  const directories = new Set();
  const reserve = (path) => {
    packetPath(path);
    if (names.has(path)) throw new Error(`Duplicate packet entry: ${path}`);
    names.add(path);
  };
  for (const directory of packet.directories) {
    reserve(directory);
    directories.add(directory);
  }
  let totalBytes = 0;
  for (const file of packet.files) {
    exactKeys(file, ["path", "body_base64", "bytes", "sha256"], "packet file");
    reserve(file.path);
    validateFileBytes(file);
    totalBytes += file.bytes;
    if (totalBytes > LIMITS.max_total_bytes)
      throw new Error("Packet decoded byte resource limit exceeded");
  }
  for (const name of names) {
    const parts = name.split("/");
    parts.pop();
    while (parts.length > 0) {
      const parent = parts.join("/");
      if (!directories.has(parent))
        throw new Error(
          `Missing or conflicting packet parent directory: ${parent}`,
        );
      parts.pop();
    }
  }
  const digest = sha256(canonicalize(manifest(packet)));
  if (packet.manifest_sha256 !== digest || packet.packet_id !== `pkt_${digest}`)
    throw new Error("Packet manifest integrity mismatch");
  return { packet, totalBytes };
};
const sameIdentity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino;
const removeOwnedDirectory = async (path, identity) => {
  try {
    if (!sameIdentity(await lstat(path), identity))
      throw new Error(
        `Cleanup retained a directory whose identity changed: ${path}`,
      );
    await rm(path, { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};
const removeReservation = async (path, identity) => {
  try {
    if (!sameIdentity(await lstat(path), identity))
      throw new Error(
        `Cleanup retained an output reservation whose identity changed: ${path}`,
      );
    // Another writer's files must survive even if it entered our empty reservation.
    await rmdir(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw new Error(
      `Cleanup retained output reservation ${path}: ${error.message}`,
      { cause: error },
    );
  }
};
const validatedStage = async (packet, parent) => {
  const temporary = await mkdtemp(join(parent, ".rea-import-"));
  const identity = await lstat(temporary);
  try {
    for (const directory of [...packet.directories].sort(
      (a, b) => a.split("/").length - b.split("/").length,
    ))
      await mkdir(join(temporary, directory), { mode: 0o700 });
    for (const entry of packet.files)
      await writeFile(
        join(temporary, entry.path),
        Buffer.from(entry.body_base64, "base64"),
        { flag: "wx", mode: 0o600 },
      );
    await loadDiligenceWorkspace(temporary);
    return { temporary, identity };
  } catch (error) {
    await removeOwnedDirectory(temporary, identity);
    throw error;
  }
};

/** Verify before extraction, validate offline, then atomically replace only our empty reservation. */
export const importDiligencePacket = async ({ file, out }) => {
  const input = requiredPath(file, "import --file");
  const { packet, totalBytes } = validatePacket(
    JSON.parse(
      (await regularBytes(input, LIMITS.max_packet_bytes)).toString("utf8"),
    ),
  );
  const output = await futurePath(requiredPath(out, "import --out"));
  await absent(output);
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const { temporary, identity: temporaryIdentity } = await validatedStage(
    packet,
    dirname(output),
  );
  let reservedIdentity;
  try {
    await mkdir(output, { mode: 0o700 });
    reservedIdentity = await lstat(output);
    if (!sameIdentity(await lstat(temporary), temporaryIdentity))
      throw new Error("Import temporary directory ownership changed");
    if (!sameIdentity(await lstat(output), reservedIdentity))
      throw new Error("Import output reservation ownership changed");
    await rename(temporary, output);
    reservedIdentity = undefined;
  } finally {
    await removeOwnedDirectory(temporary, temporaryIdentity);
    if (reservedIdentity !== undefined)
      await removeReservation(output, reservedIdentity);
  }
  return {
    case_directory: output,
    packet_id: packet.packet_id,
    files: packet.files.length,
    decoded_bytes: totalBytes,
    verification:
      "byte hashes, manifest and offline workspace validation passed",
    authenticity:
      "unknown; hashes detect edits but do not authenticate the author",
  };
};

export { compareDiligenceWorkspaces } from "./diligence-comparison.mjs";
