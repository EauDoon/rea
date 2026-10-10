import { resolve } from "node:path";
import canonicalize from "canonicalize";

import { loadDiligenceWorkspace } from "./diligence-workspace.mjs";

const same = (left, right) => canonicalize(left) === canonicalize(right);
const requiredPath = (value, label) => {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${label} requires a nonblank path`);
  return resolve(value);
};

const values = (captures, kind) =>
  [...captures.entries()]
    .map(([id, envelope]) => ({ id, record: envelope.record ?? envelope }))
    .filter(({ record }) => record.kind === kind);
const latestBy = (records, key) => {
  const groups = new Map();
  for (const entry of records) {
    const identity = key(entry.record);
    const group = groups.get(identity) ?? [];
    group.push(entry);
    groups.set(identity, group);
  }
  for (const group of groups.values())
    group.sort(
      (a, b) =>
        Date.parse(a.record.created_at) - Date.parse(b.record.created_at) ||
        a.id.localeCompare(b.id),
    );
  return groups;
};
const changesBy = (before, after, key) => {
  const old = new Map(before.map((value) => [key(value), value]));
  const current = new Map(after.map((value) => [key(value), value]));
  return [...new Set([...old.keys(), ...current.keys()])]
    .sort()
    .flatMap((id) => {
      const previous = old.get(id) ?? null;
      const next = current.get(id) ?? null;
      return same(previous, next)
        ? []
        : [
            {
              id,
              change:
                previous === null
                  ? "added"
                  : next === null
                    ? "removed"
                    : "changed",
              before: previous,
              after: next,
            },
          ];
    });
};
const freshness = (id, retrievedAt, now, maximum) => {
  const age = (now - Date.parse(retrievedAt)) / 86_400_000;
  return {
    id,
    retrieved_at: retrievedAt,
    age_days: Number.isFinite(age) ? Number(age.toFixed(4)) : null,
    status: !Number.isFinite(age)
      ? "unknown"
      : age < 0
        ? "future-dated"
        : age > maximum
          ? "stale"
          : "within-selected-age",
    max_age_days: maximum,
  };
};
const latestPairs = (before, after, key) => {
  const old = latestBy(before, key);
  const current = latestBy(after, key);
  return [...new Set([...old.keys(), ...current.keys()])]
    .sort()
    .map((identity) => ({
      identity,
      previous: old.get(identity)?.at(-1) ?? null,
      next: current.get(identity)?.at(-1) ?? null,
      before_ids: (old.get(identity) ?? []).map(({ id }) => id),
      after_ids: (current.get(identity) ?? []).map(({ id }) => id),
    }));
};
const fieldChange = (before, after) => ({
  changed: !same(before ?? null, after ?? null),
  before: before ?? null,
  after: after ?? null,
});
const compareSources = (before, after, now, maximum) =>
  latestPairs(
    values(before.captures, "source"),
    values(after.captures, "source"),
    (record) => record.subject.url,
  ).map(({ identity, previous, next, before_ids, after_ids }) => ({
    url: identity,
    selected_before_capture_id: previous?.id ?? null,
    selected_after_capture_id: next?.id ?? null,
    before_capture_ids: before_ids,
    after_capture_ids: after_ids,
    body_sha256: fieldChange(
      previous?.record.body_sha256,
      next?.record.body_sha256,
    ),
    before_freshness:
      previous === null
        ? null
        : freshness(
            previous.id,
            previous.record.retrieved_at ?? previous.record.created_at,
            now,
            maximum,
          ),
    after_freshness:
      next === null
        ? null
        : freshness(
            next.id,
            next.record.retrieved_at ?? next.record.created_at,
            now,
            maximum,
          ),
  }));
const compareObservations = (before = [], after = [], key) => {
  const old = new Map(before.map((record) => [key(record), record]));
  const current = new Map(after.map((record) => [key(record), record]));
  return [...new Set([...old.keys(), ...current.keys()])].sort().map((id) => {
    const previous = old.get(id) ?? null;
    const next = current.get(id) ?? null;
    const changedInput =
      previous !== null &&
      next !== null &&
      (!same(previous.request ?? null, next.request ?? null) ||
        !same(previous.expectation ?? null, next.expectation ?? null));
    const comparable =
      previous !== null &&
      next !== null &&
      !changedInput &&
      previous.status !== "unknown" &&
      next.status !== "unknown";
    const content = (record) =>
      Object.fromEntries(
        Object.entries(record).filter(([name]) => name !== "transcript_id"),
      );
    const changed = comparable ? !same(content(previous), content(next)) : null;
    return {
      id,
      comparison:
        previous === null
          ? "coverage-added"
          : next === null
            ? "coverage-removed"
            : changedInput
              ? "changed-input"
              : !comparable
                ? "unknown"
                : changed
                  ? "observed-value-changed"
                  : "observed-value-unchanged",
      changed,
      before: previous,
      after: next,
    };
  });
};
const boundProbes = (capture) =>
  capture === null
    ? []
    : capture.record.probes.map((probe) => ({
        ...probe,
        request:
          capture.record.transcript[probe.transcript_id - 1].request.params[0],
      }));
const compareChains = (before, after) =>
  latestPairs(
    values(before.captures, "evm-rpc"),
    values(after.captures, "evm-rpc"),
    (record) =>
      `${record.subject.chain_id}:${record.subject.address.toLowerCase()}`,
  ).map(({ identity, previous, next, before_ids, after_ids }) => ({
    target: identity,
    selected_before_capture_id: previous?.id ?? null,
    selected_after_capture_id: next?.id ?? null,
    before_capture_ids: before_ids,
    after_capture_ids: after_ids,
    before_subject: previous?.record.subject ?? null,
    after_subject: next?.record.subject ?? null,
    comparable_chain_address: previous !== null && next !== null,
    code: compareObservations(
      previous?.record.code,
      next?.record.code,
      (record) => `${record.address.toLowerCase()}:${record.purpose}`,
    ),
    slots: compareObservations(
      previous?.record.slots,
      next?.record.slots,
      (record) =>
        `${record.address.toLowerCase()}:${BigInt(record.slot).toString(16)}`,
    ),
    probes: compareObservations(
      boundProbes(previous),
      boundProbes(next),
      (record) => record.id,
    ),
  }));
const localIdentity = (workspace) => ({
  target: workspace.case_.target,
  initial_evidence_id: workspace.case_.initial_evidence_id,
  sha256:
    workspace.evidence.get(workspace.case_.initial_evidence_id)?.subject?.digest
      .sha256 ?? null,
});

/** Compare explicit observations without inferring unchanged state from absent coverage. */
export const compareDiligenceWorkspaces = async ({
  before,
  after,
  maxAgeDays = 30,
}) => {
  const maximum = Number(maxAgeDays);
  if (
    !Number.isFinite(maximum) ||
    maximum < 0 ||
    String(maxAgeDays).trim() === ""
  )
    throw new Error("--max-age-days must be a finite nonnegative number");
  const previous = await loadDiligenceWorkspace(
    requiredPath(before, "compare --before"),
  );
  const next = await loadDiligenceWorkspace(
    requiredPath(after, "compare --after"),
  );
  const now = Date.now();
  const localBefore = localIdentity(previous);
  const localAfter = localIdentity(next);
  const chains = compareChains(previous, next);
  const sharedChains = chains.filter(
    ({ comparable_chain_address }) => comparable_chain_address,
  );
  return {
    version: 1,
    compared_at: new Date(now).toISOString(),
    before_directory: previous.root,
    after_directory: next.root,
    target_comparability: {
      status:
        sharedChains.length > 0
          ? "shared-chain-address-observations"
          : chains.length > 0
            ? "different-or-missing-chain-targets"
            : localBefore.sha256 !== null &&
                localBefore.sha256 === localAfter.sha256
              ? "same-local-artifact-digest"
              : "unknown",
      profile: fieldChange(previous.case_.profile, next.case_.profile),
      subject: fieldChange(previous.case_.subject, next.case_.subject),
      chain_context_unverified: fieldChange(
        previous.case_.chain_context,
        next.case_.chain_context,
      ),
      local_before: localBefore,
      local_after: localAfter,
      limitations: [
        "Matching labels and local paths do not establish target identity.",
        "RPC chain/address observations rely on the selected node and retain each block identity; they are not independent deployment authentication.",
        "Different blocks, missing probes and unknown coverage cannot establish unchanged behavior.",
      ],
    },
    claim_changes: changesBy(
      previous.claims,
      next.claims,
      ({ question_id }) => question_id,
    ),
    evidence: {
      added: [...next.evidence.keys()].filter(
        (id) => !previous.evidence.has(id),
      ),
      removed: [...previous.evidence.keys()].filter(
        (id) => !next.evidence.has(id),
      ),
    },
    captures: {
      added: [...next.captures.keys()].filter(
        (id) => !previous.captures.has(id),
      ),
      removed: [...previous.captures.keys()].filter(
        (id) => !next.captures.has(id),
      ),
    },
    sources: {
      captures: compareSources(previous, next, now, maximum),
      register_changes: changesBy(
        previous.sources,
        next.sources,
        ({ id }) => id,
      ),
      before_register_freshness: previous.sources.map((source) =>
        freshness(source.id, source.retrieved_at, now, maximum),
      ),
      after_register_freshness: next.sources.map((source) =>
        freshness(source.id, source.retrieved_at, now, maximum),
      ),
    },
    chains,
    limitations: [
      "Each target/source compares its latest retained retrieval timestamp; selected capture IDs and every retained ID are listed explicitly.",
      "Comparison is offline and only covers the retained records; no background monitoring or new retrieval occurred.",
      "Content hashes detect changed bytes, not changed legal meaning or factual truth.",
      "A recent retrieval is not proof that the underlying source or chain state is current.",
      "Analyst review is required; this report does not recommend a target as safe.",
    ],
  };
};
