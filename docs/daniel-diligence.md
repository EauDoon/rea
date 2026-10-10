# Daniel's diligence workflow

This fork is prepared for Daniel's stablecoin, DeFi, payment and commercial
research. It connects REA's artifact inspection to the questions that change an
integration, investment, product or partner decision. It uses the available
professional context and writing preferences; it stores no private holdings,
employer information or credentials.

The core reverse-engineering tools remain available. Complete source repositories
use ordinary code inspection; REA is useful when a claim depends on a shipped
artifact, bytecode, captured flow or requested runtime observation.

## Choose the decision

| Profile      | MCP prompt             | Questions it emphasizes                                                                                                        |
| ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `stablecoin` | `diligence_stablecoin` | Redemption rights, reserve scope, mint/freeze powers, liquidity, settlement and distribution economics.                        |
| `protocol`   | `diligence_protocol`   | Asset claims, share accounting, control, oracle/bridge dependencies, capacity and legitimate exit.                             |
| `token`      | `diligence_token`      | Deployment identity, effective controls, LP custody, holder concentration, sellability at the supplied size and value accrual. |
| `payments`   | `diligence_payments`   | Authorization, custody, idempotency, reversals, settlement, reconciliation and all-in costs.                                   |
| `competitor` | `diligence_competitor` | Observable journeys, APIs, partners, distribution, economics and build/buy/partner implications.                               |

Each profile has eight coverage questions and a primary source checklist. The
contracts in `src/contracts/diligenceProfiles.ts` own both the MCP prompt and the
local packet questions. Select applicable evidence rather than mechanically
running every available tool.

## Use the customized checkout

Build with the pinned Node/npm versions from `.nvmrc` and `package.json`:

```bash
cd /workspace/rea
export PATH=/workspace/.rea-cloud/toolchains/npm-11.16.0/bin:/workspace/.rea-cloud/toolchains/node-v24.18.0-linux-x64/bin:$PATH
export npm_config_cache=/workspace/.rea-cloud/npm-cache
export NODE_USE_ENV_PROXY=1
npm run build:cached
node scripts/daniel-diligence.mjs profiles
```

`npm run diligence -- profiles` also builds cached prerequisites before launching
the helper. Use `npm run diligence -- init ...` or `npm run diligence -- report
--case DIRECTORY` for the same workflow.

The `/workspace/.rea-cloud/` toolchain paths are for this prepared cloud
environment. Elsewhere, use the repository pins through your normal version
manager. Each cloud task already has an isolated checkout.

Use this checkout's `node scripts/rea.mjs mcp` as the MCP stdio child. The
upstream npm package does not contain this customization. Global client
registrations are not written by this onboarding task.

Get a guided workflow through your MCP client:

```json
{
  "name": "diligence_payments",
  "arguments": {
    "subject": "Caller-selected payment application",
    "decision_question": "Can we rely on its payout recovery and final settlement?",
    "target_path": "/absolute/path/to/shipped-app",
    "target_kind": "javascript"
  }
}
```

Prompts guide the agent without executing a tool. Evidence completion offers
records already retained in the current session. External terms, deployment
binding and live state require separately verified primary evidence.

## Create a durable packet

A research-only packet needs no artifact or API credentials:

```bash
node scripts/daniel-diligence.mjs init \
  --profile stablecoin \
  --subject "Selected issuer and stablecoin" \
  --question "Can our eligible customers redeem during a banking outage?" \
  --out _reference/diligence/issuer-review
```

Capture a caller-supplied bytecode carrier through the existing EVMole workflow:

```bash
node scripts/daniel-diligence.mjs init \
  --profile token \
  --subject "Selected token" \
  --question "Which controls and liquidity facts determine exit at my stated size?" \
  --target /absolute/path/to/runtime.hex \
  --kind evm-hex \
  --chain-context "Caller-supplied chain/address/block, pending verification" \
  --out _reference/diligence/token-review
```

`evm-raw` accepts raw bytes. `javascript` analyzes an extracted shipped
JavaScript/Electron artifact or ASAR through the production static workflow.
The helper does not execute the target or fetch a chain, explorer or website.
Explicit `chain` and `source` commands, described below, collect network
observations separately from this offline initialization.
EVM capture requires REA's existing Linux x64/prlimit support. Other targets
and runtime requests remain available through the ordinary CLI/MCP tools.

The output must be new and outside the inspected target, including symlink
aliases. Existing packets are preserved. Capture/validation failures do not
create a case. New packet directories use mode 0700 and files use mode 0600 on
POSIX hosts. Local packets live under the already ignored `_reference/` path.

| File                  | Purpose                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `case.json`           | Decision, profile, creation time, selected target and initial Evidence identity. |
| `brief.md`            | Coverage questions and primary evidence needed.                                  |
| `claims.json`         | Editable findings, status, citations and next checks for all eight questions.    |
| `sources.json`        | External source URLs, retrieval dates, scope and limitations.                    |
| `evidence/ev_*.json`  | Complete, unchanged REA Evidence with semantic identity verification.            |
| `captures/cap_*.json` | Immutable RPC observations or source snapshots with a content-based identifier.  |
| `notes.md`            | Analyst hypotheses, commercial terms, executed checks and reopen triggers.       |

All claims start `unknown` even when the artifact inspection succeeds. Add
primary source entries using this shape; the example is a placeholder:

```json
[
  {
    "id": "issuer_terms",
    "url": "https://issuer.example/redemption-terms",
    "retrieved_at": "2026-10-10T12:00:00+08:00",
    "scope": "Eligibility and redemption obligations for the selected holder class",
    "limitations": ["Analyst must examine the actual terms and version"]
  }
]
```

Update the existing claim's `statement`, `status`, `evidence_ids`, `capture_ids`, `source_ids`
and `next_check`. Status is `observed`, `derived`, `inferred` or `unknown`.
Complete REA Evidence from related investigations may be copied into `evidence/`
using each record's exact `ev_*.json` name. Cross-target evidence must be
interpreted according to its own subject and scope.

Render a fresh memo:

```bash
node scripts/daniel-diligence.mjs report \
  --case _reference/diligence/token-review
```

The command prints Markdown to stdout and leaves the packet files untouched.
It rejects altered semantic identifiers, renamed or non-regular evidence files,
missing citations, duplicate/missing coverage questions and observation claims
supported only by inferred artifact Evidence. It checks the initial artifact's
path, operation and encoding against the case. Reporting never fetches source
URLs or contacts an RPC endpoint. Older packets without `capture_ids` remain valid.

Citation validation does not establish that a source supports the claim. The
analyst must review that connection and state freshness. A populated checklist
is not an audit, deployment verification or investment recommendation. Unknown
coverage remains visible in the memo's opening decision statement.

## Collect deployment and source evidence

Network collection is an explicit source-checkout workflow. REA's core analysis
and MCP tools remain local. The commands add immutable captures without changing
claims, target bytes, wallets or chain state. Use an endpoint permitted by your
environment's network policy; missing access is a failed collection, not evidence
that a contract passed a check.

Set a read-only RPC endpoint in an environment variable through your environment
settings or shell. Keep credential values out of command arguments and case files.
The collector retains only the endpoint origin, not its path, query or credentials.

```bash
node scripts/daniel-diligence.mjs chain \
  --case _reference/diligence/token-review \
  --rpc-env DILIGENCE_RPC_URL \
  --chain-id 1 \
  --address CALLER_VERIFIED_CONTRACT_ADDRESS \
  --block finalized \
  --reads /absolute/path/to/selected-reads.json
```

The expected chain ID is a decimal string. The collector resolves the selected
block to a concrete number/hash, pins every code, storage and call read to that
number, then rechecks the block hash and chain ID. It captures runtime code,
EIP-1967 implementation/admin/beacon slots and code at discovered implementations.
Legacy proxies require explicit storage reads. A zero standard slot does not
establish that a contract is immutable. One endpoint's responses are provider
observations, not independent chain authentication or proof of consensus finality.

The optional reads file is an array. Each entry has a unique `id`:

```json
[
  {
    "id": "decimals",
    "method": "eth_call",
    "data": "0x313ce567"
  },
  {
    "id": "selected_role_slot",
    "method": "eth_getStorageAt",
    "slot": "0x0"
  }
]
```

Use a target's verified ABI and storage layout to select meaningful reads.
`eth_call` accepts optional `to`, `from`, `value`, `gas`, and an expectation:
`{"result":"0x..."}` or `{"revert":true}`. Storage reads accept an optional
`address` and `follow_implementation: true` for a caller-identified implementation
slot. `value` and `gas` are hexadecimal quantities. Call data and expected results
are hexadecimal bytes. The collector never sends a transaction.

A probe without an expectation reports an observation. An exact result or
recognized EVM revert can satisfy a declared expectation; connection failures,
malformed responses and provider outages remain unknown. These calls are
independent simulations at one block. They do not apply one call's writes before
the next, establish a transaction's inclusion, or test a payment application's
multi-step reconciliation and recovery. Successful bytes alone do not prove the
intended economic effect. Review both ordinary permitted flows and adverse cases.

Retain the exact bytes of a selected primary source:

```bash
node scripts/daniel-diligence.mjs source \
  --case _reference/diligence/token-review \
  --url https://issuer.example/redemption-terms \
  --scope "Eligibility, suspension rights and fees for the selected holder class"
```

The command retains the original/final URL, redirect chain, retrieval timestamps,
response metadata, content hash and base64-encoded body. It uses HTTPS, fetches no
linked resources and executes no scripts. The retained body is the decoded bytes
returned by Fetch, which may differ from compressed transport bytes. A page
snapshot is not automatically a readable extraction or a verified factual claim.
The default and maximum body budget is 8 MiB; `--max-bytes` can impose a smaller
budget and `--timeout-ms` selects a timeout up to 300,000 ms. Each portable
capture file has a 16 MiB ceiling, including base64/JSON overhead.

Both commands return a `capture_id`. Inspect `captures/<capture_id>.json`, then
cite it in a claim's `capture_ids` only if the observation supports the claim.
Each envelope binds the entire record to its SHA-256 canonical JSON identifier.
Report/import additionally validate source byte hashes and RPC transcript,
block, selected-read and verdict relationships. A hash detects changed content;
it does not authenticate an author or establish factual truth.

## Export, restore and compare investigations

Export a validated case to a new private file outside the case directory:

```bash
node scripts/daniel-diligence.mjs export \
  --case _reference/diligence/token-review \
  --out /absolute/private-backups/token-review.packet.json

node scripts/daniel-diligence.mjs import \
  --file /absolute/private-backups/token-review.packet.json \
  --out _reference/diligence/token-review-restored

node scripts/daniel-diligence.mjs compare \
  --before _reference/diligence/token-review \
  --after _reference/diligence/token-review-restored \
  --max-age-days 7
```

Packets retain all regular case files, including notes, claims, source bytes and
Evidence. They carry per-file hashes and a manifest hash, with private POSIX file
permissions. They are **not encrypted** and should go to your private backup
destination. Nothing is uploaded automatically. An export stored only in this
workspace is not an off-environment backup.

Import verifies the manifest and bytes before extraction, validates the restored
workspace offline, and refuses existing destinations. Symlinks, special files,
duplicate paths and traversal are rejected. The portable format permits 16 MiB
per file, 64 MiB total decoded bytes, 10,000 entries and 32 directory levels;
excessive packets fail explicitly.

Comparison reports changed claims, added/removed evidence, source content hashes,
and code/storage/probe changes for matching chain/address observations. It retains
both block identities and flags source retrieval ages against your selected
threshold. Matching subject labels do not establish deployment identity; an
unchanged comparison does not establish safety. This command runs offline and
does not install background monitoring.

## Connect the customized MCP server

Use your client's normal MCP settings to launch this checkout's server. A cloud
configuration example is:

```json
{
  "mcpServers": {
    "rea": {
      "command": "/workspace/.rea-cloud/toolchains/node-v24.18.0-linux-x64/bin/node",
      "args": ["/workspace/rea/scripts/rea.mjs", "mcp"],
      "env": { "NODE_USE_ENV_PROXY": "1" }
    }
  }
}
```

The cloud path must be reachable by the client launching the process; desktop
clients need their own local checkout path. Validate initialization,
`listPrompts`, `getPrompt` for `diligence_stablecoin`, and `listTools`. This fork
currently advertises 11 prompts and 139 tools. The packet commands are CLI
workflows and do not add network tools to the MCP server. Client configuration
and live processes are separate from a saved cloud environment.

## Write the decision Daniel needs

Lead with the supported decision and the reason it changes the user's outcome.
Trace money, effective authority, executable liquidity and obligations across
the system. Separate reserve accounting value, market liquidity, redeemability
and immediate exit. For payments, separate ledger credit, chain finality and
final beneficiary settlement. For tokens, use the caller's actual size and
route; missing size remains a limitation.

For each material finding give its reachable preconditions, break path, impact,
evidence, remedy and reopen trigger. Preserve competing explanations and
unperformed checks. Bind deployed conclusions to the chain, implementation,
block/time and source version. Offline SHA-256 digests are not Ethereum Keccak
code hashes, inferred selectors are not a verified ABI, and a static read does
not prove a transaction succeeds.

Use plain American English and Singapore time for human-facing dates. Keep
private professional research separate from public posts and publication.
This workflow prepares evidence and decisions; signing, trades, fund movement,
deployment and external messages need their own explicit instruction.
