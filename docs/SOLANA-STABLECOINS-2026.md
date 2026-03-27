# Solana is the stablecoin chain now. Here's what that actually means.

I've been building stablecoin infrastructure on Solana for the past few months and spent a lot of time going deep on how all of this actually works under the hood. This isn't a price thread or a "Solana is going to flip Ethereum" take. It's more of a brain dump on what's actually happening, some stuff that concerns me, and where I think this is going.

Let me know what you think at the end — genuinely curious where people disagree.

---

## The numbers first, because they're actually insane

$650 billion in stablecoin transactions on Solana in February 2026. That's more than any other blockchain has ever done in a single month. Ever.

Solana's stablecoin supply hit $17 billion in March. It was $5 billion at the start of 2025. Circle minted $2.5 billion USDC on Solana in a single week earlier this month.

Solana now accounts for about 36% of global stablecoin transaction volume. It's been beating Ethereum on USDC transfer volume since December. Not in total supply — Ethereum still wins that — but in actual movement of money.

Why? Because sending USDC on Solana costs $0.001 and settles in 400ms. The economics just work better for anything that moves frequently.

Visa is using it for bank settlement. PayPal made Solana the primary network for PYUSD. Worldpay is using a stablecoin called USDG for client settlements. Western Union is integrated. These aren't crypto-native companies doing crypto experiments — these are traditional financial institutions routing real payment flows through Solana because it's cheaper and faster.

---

## Who's actually here

Beyond USDC ($8B+) and PYUSD ($777M, up 600% year-over-year), there's a bunch of newer stuff that's interesting:

**USDG** — Consortium stablecoin from Paxos Singapore, regulated by MAS. Kraken, Robinhood, Anchorage, Worldpay all in the consortium. Up 169% in 6 months. Worldpay using it for client settlements. This one is interesting because it's multi-institution by design — not just one company issuing and hoping.

**EURCV** — Société Générale. A French bank issuing on a permissionless blockchain. That sentence would have sounded insane two years ago.

**sUSD** — Solayer's T-bill backed stablecoin. Permissionless, yield-bearing. Interesting structure.

**JupUSD** — Jupiter's stablecoin integrated across their DEX ecosystem.

The thing that strikes me about this list is who's in it. These aren't DeFi-native stablecoin experiments anymore. The people building and using stablecoins on Solana are increasingly regulated institutions from the US, EU, Hong Kong, Singapore. The vibe has completely shifted.

---

## The tech: Token-2022 is powerful and also kind of terrifying

Every serious stablecoin launched on Solana in the last year+ uses Token-2022. Transfer hooks, permanent delegates, confidential transfers, transfer fees — this stuff gives issuers compliance capabilities that weren't possible before.

The regulators want freeze/seize/burn capabilities. GENIUS Act Section 4 literally mandates it. Permanent delegates are how you implement "we can freeze your tokens under lawful order" on Solana. Transfer hooks are how you enforce sanctions screening on every transfer.

But there are some things about Token-2022 that I don't think are widely understood:

**Transfer hooks brought reentrancy back.** Solana was basically immune to reentrancy attacks because of how its account model works. Transfer hooks change that. If your hook makes a CPI call back into your own program mid-transfer, you now have a reentrancy vector. Neodyme wrote about this. Most hook implementations I've looked at don't have reentrancy guards.

**There was a critical Token-2022 bug quietly patched in April 2025.** The confidential transfers extension — the ZK-based private transfer feature — had a vulnerability that could have allowed unlimited token minting or fund withdrawal without authorization. It was patched before anyone exploited it. But this was a critical bug in a production token standard that handles real money, and I don't think it got nearly enough attention.

**Transfer hooks and confidential transfers don't work together.** If you want privacy AND compliance enforcement hooks, you can't have both right now. They're incompatible extensions. A fix is apparently coming.

**Most hooks fail-open.** This one is the big one for me. The typical transfer hook implementation checks a compliance PDA that's passed in `remaining_accounts`. If the caller just... doesn't pass that account? The check gets skipped. Silently. A sanctioned wallet that knows this can bypass the entire compliance mechanism. This isn't a Token-2022 bug — it's an implementation pattern that's very easy to get wrong. But "easy to get wrong" in compliance infrastructure is a problem.

---

## The GENIUS Act deadline is real and most people aren't ready

The GENIUS Act passed in July 2025. OCC published proposed implementing rules on February 25, 2026. Public comments close May 1. Enforcement kicks off Q3 2026.

The technical requirements are specific:

- Freeze, seize, burn capability under lawful order
- 1:1 reserve backing (USD, T-bills ≤93 days, FDIC-insured deposits)
- Segregated, bankruptcy-remote reserve accounts
- Monthly public reserve attestations (CEO + CFO certified)
- AML/BSA compliance — you're classified as a financial institution
- No rehypothecation
- Private keys must be custodied by regulated entities

MiCA is already live. Travel Rule is a global requirement now. These aren't future concerns.

How many Solana stablecoin programs can actually check all these boxes today? Genuinely asking. I've been looking at a lot of them and the answer is: not many.

The compliance gap isn't abstract risk. It's a business risk for anyone operating right now who hasn't thought this through.

---

## The thing nobody talks about: everyone is rebuilding the same thing

Here's what I keep coming back to. Solana has $17B in stablecoins and is processing $650B a month. There are new stablecoins launching constantly.

And every single one is building the same compliance infrastructure from scratch.

The governance system. The blacklist enforcement. The reserve attestation. The emergency pause. The authority rotation. The timelock for admin changes. The oracle integration. The Travel Rule hooks.

All of it. Every time.

On Ethereum this problem got solved at the protocol layer with ERC-20 and then layered standards on top. If you say you're ERC-20 compliant, integrators know what to expect. The composability is why Ethereum DeFi moves so fast.

Solana has Token-2022 for the token mechanics. But there's no stablecoin standard — no shared specification for what the compliance layer, governance layer, and emergency controls should look like. Every issuer invents their own, every integrator writes custom parsing code, every auditor starts from scratch.

I've been working on something called the Solana Stablecoin Standard (SSS) that tries to address this — formally verified presets (SSS-1 minimal, SSS-2 compliant, SSS-3 reserve-backed) that issuers can build on. It has 41 Kani formal proofs, a TLA+ spec, MiCA and GENIUS Act compliance presets built in. Not launching it as "the" standard — it's open source MIT, more of a reference implementation people can build on or critique. But I'll share more on that separately.

The point is: the gap is real and it's a solvable problem.

---

## Some stuff that actually concerns me

**The CLARITY Act.** There's a March 2026 draft bill that proposes banning platforms from offering yield on stablecoin balances. If this passes, yield-bearing stablecoins — sUSD, parts of USDG's value prop, and others — face legal uncertainty. The $17B supply number looks different if the yield mechanic gets killed.

**The audit culture.** The audit standards around Solana stablecoin programs are years behind Ethereum DeFi. Most programs have had no external audit. The Token-2022 confidential transfers bug from April 2025 was caught internally — which is lucky. The culture of "ship first, audit later (maybe)" is a real risk when you're handling institutional money.

**Oracle dependence.** CDP-backed stablecoins on Solana are mostly dependent on Pyth. If Pyth publishes a wrong price during high volatility — and Pyth prices come with confidence intervals that can be ±10-15% — CDPs liquidate incorrectly. Most programs check staleness but not confidence intervals. That's a meaningful gap.

**Single-key authority.** Most Solana stablecoin programs are controlled by a single keypair. One compromised laptop and the entire protocol is at risk. The multisig tooling (Squads) exists and is good. But it's not mandatory and most teams aren't using it properly pre-mainnet.

---

## Two primitives that I think are underrated

**Probabilistic Balance Standard (PBS)** — funds committed to a contract that are released only when a cryptographic condition is proven. Insurance payouts without an insurance company. Escrow without an escrow agent. The payout triggers automatically when the proof matches. 

This maps directly to things like automated insurance (Reflect.money is doing something conceptually similar), enterprise compliance where payment requires proof of delivery, or any situation where "trust me" isn't good enough.

**Agent Payment Channels (APC)** — payment infrastructure where automated systems (including AI agents) pay each other for verified outputs. Agent A commits funds. Agent B does work and submits a proof. Payment releases when the proof checks out. No intermediary.

This sounds like science fiction but the settlement properties of Solana (400ms, sub-cent fees) make it practical in a way it isn't on any other chain. Keeper networks, compliance oracles, data feeds, rebalancing bots — any automated system that needs to pay for services based on verified outputs.

---

## What good looks like (checklist)

If you're building a stablecoin on Solana in 2026, here's what I'd consider non-negotiable before mainnet:

- Fail-closed transfer hooks (missing compliance PDA = transaction fails, not skips)
- External security audit — not optional
- Authority under Squads multisig before mainnet
- Timelocked admin operations (5+ days for anything that touches user funds)
- On-chain reserve attestation, not just monthly PDFs
- Oracle confidence interval checks, not just staleness
- Documented trust assumptions — what trusted parties exist and what can they do

None of this is exotic. Most of it is just not cutting corners.

---

## Alright, I want your takes on a few things

This is where I'm genuinely uncertain and would love input:

**Is the standard gap actually a problem, or does the market solve it?** Maybe issuers *should* differentiate on their compliance implementations rather than converge on a standard. Counter-argument welcome.

**How do you handle Travel Rule for DeFi?** VASP-to-VASP data sharing makes sense for institutions, but what about DeFi protocols interacting with stablecoins? The regulation is pretty unclear here.

**Yield prohibition — how likely is the CLARITY Act to pass and what does it do to the stablecoin ecosystem?** I genuinely don't know how to think about this one.

**What's the right timelock duration for a production stablecoin?** 5 days feels right for most admin ops but too long for emergency oracle changes. How do other people handle this?

**Is the single-program-for-all-features approach right, or should stablecoins be more modular (separate programs per feature)?** This comes up every time we discuss architecture and I still don't have a strong opinion.

Drop your takes. These aren't rhetorical — I actually want to understand where people land on this stuff.

— @dcc_crypto
