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
EVM capture requires REA's existing Linux x64/prlimit support. Other targets
and runtime requests remain available through the ordinary CLI/MCP tools.

The output must be new and outside the inspected target, including symlink
aliases. Existing packets are preserved. Capture/validation failures do not
create a case. New packet directories use mode 0700 and files use mode 0600 on
POSIX hosts. Local packets live under the already ignored `_reference/` path.

| File                 | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `case.json`          | Decision, profile, creation time, selected target and initial Evidence identity. |
| `brief.md`           | Coverage questions and primary evidence needed.                                  |
| `claims.json`        | Editable findings, status, citations and next checks for all eight questions.    |
| `sources.json`       | External source URLs, retrieval dates, scope and limitations.                    |
| `evidence/ev_*.json` | Complete, unchanged REA Evidence with semantic identity verification.            |
| `notes.md`           | Analyst hypotheses, commercial terms, executed checks and reopen triggers.       |

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

Update the existing claim's `statement`, `status`, `evidence_ids`, `source_ids`
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
path, operation and encoding against the case. Source URLs are never fetched.

Citation validation does not establish that a source supports the claim. The
analyst must review that connection and state freshness. A populated checklist
is not an audit, deployment verification or investment recommendation. Unknown
coverage remains visible in the memo's opening decision statement.

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
