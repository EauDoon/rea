import type { PromptContract } from "./promptContracts.js";

/** Daniel's decision questions; these are coverage requirements, not findings. */
export const DILIGENCE_PROFILES = {
  stablecoin: {
    title: "Stablecoin and redemption diligence",
    objective:
      "Determine whether the claimed money, liquidity and redemption promises are supported at the selected issuer, asset and state.",
    questions: {
      identity:
        "Which issuer, token, chain, implementation, reserve period and legal entity does the claim cover?",
      redemption:
        "Who can redeem, against whom, in what asset, under which fees, minimums, hours and suspension rights?",
      reserves:
        "Which dated reserve evidence establishes asset composition, custody, encumbrances and liabilities, and what does it leave unexamined?",
      authority:
        "Who can mint, burn, freeze, seize, pause or upgrade, and what effective powers bypass the stated roles?",
      liquidity:
        "Separate reserve accounting value, immediate executable liquidity, market liquidity and a holder's legal redemption right.",
      settlement:
        "Where do ledger credit, chain finality and final fiat settlement occur, and who absorbs a reversal or failed payout?",
      economics:
        "Who receives yield, pays fees and funds distribution; which costs or incentives make the business sustainable?",
      stress:
        "What happens during a run, custodian outage, bank closure or depeg, and can ordinary eligible users still exit?",
    },
    sources: [
      "Issuer redemption terms and applicable legal documents",
      "Dated reserve report with scope and liability coverage",
      "Implementation source, deployment binding and pinned role reads",
      "Bank, custodian and settlement operating terms",
    ],
  },
  protocol: {
    title: "DeFi mechanism and integration diligence",
    objective:
      "Decide whether an integration preserves its asset, accounting, control and exit invariants under ordinary and adverse sequences.",
    questions: {
      identity:
        "Bind each contract to chain, address, implementation, code version and the block of relevant state reads.",
      assets:
        "Trace each asset and claim across vaults, wrappers, adapters and bridges; identify shared underlying exposures.",
      accounting:
        "Check decimals, share conversion, fee bases, rounding and first/last depositor behavior against explicit invariants.",
      authority:
        "Map upgrades, minting, parameter edits, guardian actions, inherited controls and their reachable bypasses.",
      dependencies:
        "Identify oracle freshness, manipulation paths, bridge trust, external calls and correlated dependencies.",
      capacity:
        "Which executable liquidity and adverse price/volume assumptions support collateral, liquidation and exposure caps?",
      liveness:
        "Can permitted deposits, withdrawals, repayments and claims complete during pauses, stress and dependency failures?",
      assurance:
        "Which reachable break paths were executed, which remain static hypotheses, and what change invalidates inherited assurance?",
    },
    sources: [
      "Source at a named commit and deployed implementation binding",
      "Pinned parameter, role, oracle and liquidity reads",
      "Independent invariant tests and execution outcomes",
      "Relevant primary incident reports and current integration terms",
    ],
  },
  token: {
    title: "Token controls and position exit diligence",
    objective:
      "Establish the effective controls and whether the supplied position can exit under the specified state, liquidity and restrictions.",
    questions: {
      identity:
        "Which chain, token address, implementation and block are examined, and is runtime code tied to that deployment?",
      control:
        "Who can change balances, supply, transfer rules, fees, trading access or implementation, including indirect control?",
      liquidity:
        "Who controls pools, LP positions and unlocks, and how concentrated are economically relevant holders?",
      sellability:
        "Can the holder sell the supplied amount through the specified route; which transfer restrictions, taxes and slippage were actually tested?",
      value:
        "Which enforceable mechanism links protocol revenue or utility to this token, and who can change it?",
      dilution:
        "What vesting, emissions, unlocks, treasury powers and incentive obligations change the exposure?",
      incentives:
        "Which actor can profitably deviate under stress or weak liquidity, and what is the reachable impact?",
      decision:
        "Which missing fact could reverse the position decision, and what size or timing assumption makes the answer stale?",
    },
    sources: [
      "Deployment-bound source and pinned privileged-role reads",
      "Pool reserves, route quotes and LP custody at a stated block",
      "Holder/vesting evidence and enforceable token terms",
      "Read-only sell simulation for the caller's amount and route",
    ],
  },
  payments: {
    title: "Payment application and settlement diligence",
    objective:
      "Test a payment promise across user authorization, application state, asset custody, settlement and recovery responsibilities.",
    questions: {
      identity:
        "Which shipped application, API version, route, geography, asset and customer type does the flow cover?",
      flow: "Trace initiation, quote, authorization, transfer, ledger credit, beneficiary payout and final settlement separately.",
      custody:
        "Who holds keys and customer assets at each stage; which entity owes the user and on what terms?",
      authorization:
        "What can users, operators and agents authorize; how are limits, approvals, replay and delegated authority enforced?",
      recovery:
        "What happens on duplicate requests, reordered webhooks, timeouts, reorgs, partial completion and failed payouts?",
      reconciliation:
        "Which independent identifiers and observations reconcile asset movement, fees and ledger obligations?",
      economics:
        "Separate quoted fees, spread, network costs, prefunding, fraud losses and partner revenue share; use supplied amounts and currencies.",
      coverage:
        "Which licensing, partner, geographic, availability and redemption claims have current primary evidence?",
    },
    sources: [
      "Shipped application or caller-selected captured flow",
      "Versioned API and webhook contracts",
      "Custody, settlement, operating and partner terms",
      "Independent sandbox execution and reconciliation records",
    ],
  },
  competitor: {
    title: "Competitor product and commercial diligence",
    objective:
      "Explain a competitor's observable product mechanism, distribution and commercial tradeoffs without treating shipped clues as verified commercial facts.",
    questions: {
      identity:
        "Which dated product version, region, user tier and shipped artifact or capture is being compared?",
      journey:
        "What does the user do and receive, and which steps are observed versus inferred from static modules?",
      mechanism:
        "Which routes, APIs, dependencies and asset flows implement the claimed feature?",
      control:
        "Which issuer, custodian, payment or infrastructure partner owns each critical obligation and decision?",
      distribution:
        "Which customer, integration or channel evidence supports the distribution claim?",
      economics:
        "Who pays, who gains and who bears each cost; which pricing and volume assumptions are known?",
      differentiation:
        "Which measured workflow differences matter to the selected user, and where is comparison coverage incomplete?",
      decision:
        "What build, buy, partner or positioning decision follows, and which evidence would change it?",
    },
    sources: [
      "Dated shipped artifact or user-owned passive capture",
      "Current product documentation and published pricing",
      "Primary partner announcements and agreed terms where available",
      "Comparable customer workflows under stated conditions",
    ],
  },
} as const;

const artifactStep: PromptContract["steps"][number] = {
  tools: [
    "inspect_evm_interface",
    "analyze_javascript_application",
    "inspect_web_network_capture",
  ],
  instruction:
    "Route only a supplied local target: explicit EVM raw/hex carriers to inspect_evm_interface, extracted JavaScript/Electron artifacts to analyze_javascript_application, retained network captures to inspect_web_network_capture. A complete source repository is inspected with ordinary source tools. This step does not fetch deployments or establish live chain state, reserves, legal rights, licensing or transaction behavior. Preserve SHA-256 identities, source locations, provider/version, limitations and evidence_kind; selectors and recovered types remain inferences.",
};

/** Advertised workflows share the same coverage owner as the local dossier helper. */
export const DILIGENCE_PROMPTS: readonly PromptContract[] = Object.entries(
  DILIGENCE_PROFILES,
).map(([profile, definition]) => ({
  name: `diligence_${profile}`,
  title: definition.title,
  description: definition.objective,
  objective: definition.objective,
  arguments: {
    subject: {
      description: "Caller-selected product, asset, protocol or competitor",
      required: true,
    },
    decision_question: {
      description:
        "Concrete decision and exposure, amount or integration context when relevant",
      required: true,
    },
    target_path: {
      description: "Optional absolute local artifact or retained capture path",
      required: false,
    },
    target_kind: {
      description:
        "Explicit target representation, including raw/hex encoding for EVM",
      required: false,
    },
    chain_context: {
      description:
        "Caller-supplied chain/address/block or time; unverified until bound to primary evidence",
      required: false,
    },
    evidence_id: {
      description: "Relevant Evidence already retained in this session",
      required: false,
      completion: "evidence",
    },
  },
  steps: [
    artifactStep,
    {
      tools: ["inspect_analysis_view", "trace_application_feature"],
      instruction:
        "Reuse returned JavaScript Evidence and trace a known route, API, module or string seed when it resolves the decision. Do not rerun a producer to read a result already available. Require primary sources for external claims: " +
        definition.sources.join("; ") +
        ". Preserve their date, scope and identity separately from offline artifact Evidence.",
    },
    {
      tools: ["record_unknown", "list_unknowns"],
      instruction:
        "Examine only applicable questions and retain unresolved ones explicitly: " +
        Object.values(definition.questions).join(" ") +
        " Missing source, state, position size or execution evidence is an unknown, never a passing control. Do not infer safety from selectors, role names, marketing, audit coverage percentages or a missing finding.",
    },
    {
      tools: ["export_evidence_bundle"],
      instruction:
        "Lead the memo with the supported decision or insufficient evidence. For each material finding include preconditions, break path, impact, cited evidence, remedy and reopen trigger. Distinguish observations, derivations, inferences and unknowns; connect technical consequences to user promises, money and commercial obligations. Use plain American English and Singapore time for human-facing dates. Export to a caller-selected new absolute path only when a durable packet is requested. Keep signing, wallet actions, live funds, deployment, external messages and publication outside this investigation's scope unless separately instructed.",
    },
  ],
}));
