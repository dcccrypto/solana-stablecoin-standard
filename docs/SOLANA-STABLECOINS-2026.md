# Solana is processing more stablecoin volume than any blockchain in history. Here's what's actually broken.

February 2026: $650 billion in stablecoin transactions on Solana. One chain, one month, more than any blockchain has ever done.

Solana now handles 36% of global stablecoin transaction volume. Its supply crossed $17 billion this month. Circle minted $2.5 billion USDC on Solana in a single week. Solana has been beating Ethereum on USDC transfer volume since December.

Visa, PayPal, Worldpay, Western Union. Not crypto companies experimenting. Payment infrastructure companies that moved real payment flows to Solana because it settles in 400ms and costs fractions of a cent per transaction. The same math that made Ethereum too expensive for high-frequency payments made Solana attractive.

Most of the coverage treats this as a success story and stops there. It is a success story. It's also a story about a lot of quietly broken infrastructure that nobody wants to talk about because the numbers look good.

---

**Who's issuing stablecoins on Solana right now**

USDC crossed $8 billion on Solana, over 10% of the global supply. Circle minted $2.5 billion in a single week in March. PYUSD hit $777 million and grew 600% year over year after PayPal moved it from Ethereum to Solana as the primary chain. USDG, the consortium coin from Paxos Singapore backed by Kraken, Robinhood, Anchorage, and Worldpay, grew 169% in six months. Societe Generale launched EURCV as a MiCA-compliant euro stablecoin on Solana. First Digital USD launched from Hong Kong in January 2025. Jupiter has JupUSD. Solayer has sUSD backed by T-bills.

The jurisdictions: US, EU, Singapore, Hong Kong. These are regulated institutions making long-term infrastructure decisions. That doesn't mean everything is fine. It means the stakes of what's broken are higher than they were when it was just DeFi natives playing around.

---

**The Token-2022 situation**

Every serious stablecoin launched on Solana in the past 18 months uses Token-2022. The old SPL standard was simple: mint, burn, freeze, transfer. Token-2022 adds what Solana calls extensions, optional capabilities baked into the token at creation time.

The ones that matter for stablecoins: transfer hooks, permanent delegates, confidential transfers, and transfer fees.

Transfer hooks let the issuer attach an arbitrary program to every transfer. Before a transfer settles, that program runs. That's how you enforce compliance on-chain: blacklists, sanctions checks, spend limits, all of it executed at the token level, not off-chain policy.

Permanent delegates let a designated authority transfer or burn any account without owner signature. The GENIUS Act requires issuers to have the technical capability to seize, freeze, or burn stablecoins under lawful order. Permanent delegates are the on-chain mechanism for that.

Confidential transfers encrypt amounts using zero-knowledge proofs. The auditor with the right key sees everything. Everyone else doesn't. Institutional compliance often requires exactly this split.

This gives Solana stablecoin issuers capabilities that genuinely don't exist at scale anywhere else right now. That's real.

What's also real:

Transfer hooks brought reentrancy back to Solana. Solana's account model made reentrancy attacks structurally difficult. Transfer hooks break that assumption. If a hook makes a CPI call back into the calling program mid-transfer, you have a reentrancy vector. Neodyme wrote about this in 2025. Most developers building transfer hook programs have never had to think about reentrancy on Solana before and aren't thinking about it now.

In April 2025, a critical vulnerability in the confidential transfers extension was quietly patched. The flaw was in the ZK cryptography. It could have allowed unlimited token minting or fund withdrawal without authorization. Nobody lost money. But this was a critical unlimited-mint bug in a production token standard that billions of dollars now sit on. The disclosure was minimal. If you're using confidential transfers, you need to know this happened.

Transfer hooks and confidential transfers are currently incompatible. You cannot combine them in one token today. A stablecoin that wants privacy and on-chain compliance enforcement cannot have both. A fix is reportedly in development.

Most transfer hook implementations fail open. The standard pattern is to check a compliance PDA that gets passed in `remaining_accounts`. The problem is that `remaining_accounts` is caller-supplied. If the caller doesn't include the PDA, the check doesn't run. The transfer goes through. A sanctioned address that understands this can bypass the entire compliance mechanism by omitting one account from the transaction. This is an implementation pattern problem, not a Token-2022 bug, but it's everywhere and it makes a lot of "we have on-chain compliance" claims inaccurate.

---

**The GENIUS Act deadline**

The GENIUS Act was signed July 18, 2025. The OCC published proposed implementing rules February 25, 2026. Public comments close May 1. Enforcement starts Q3 2026.

The technical requirements, not the policy summary: 1:1 reserve backing in USD, T-bills under 93 days maturity, or FDIC-insured deposits. Segregated, bankruptcy-remote accounts. No rehypothecation of reserves. Monthly reports certified by CEO and CFO personally. Annual audited financials for larger issuers. The issuer is classified as a financial institution under the Bank Secrecy Act, which means KYC, AML, transaction monitoring, suspicious activity reporting, annual compliance certification. Private keys for reserves must be held by federally or state regulated custodians. No yield to token holders, that's an explicit prohibition. And: the issuer must be technically capable of seizing, freezing, or burning tokens under lawful order.

MiCA is already in force across the EU. Travel Rule is a global requirement for VASP-to-VASP transfers above thresholds. Singapore, Hong Kong, UAE, Japan all have stablecoin frameworks.

Look at most Solana stablecoin programs and ask whether they actually comply with all of this. Many don't. Single private key controls everything. No formal on-chain reserve attestation, just monthly reports. Transfer hooks that fail open. No timelocked admin operations. No documented capability for a regulator to verify freeze/burn is possible.

This isn't abstract future risk. Q3 2026 is close and the gap between what's implemented and what's required is real.

---

**The infrastructure reinvention problem**

Every new stablecoin on Solana is building the same things from scratch. The governance system. The blacklist enforcement. The reserve attestation. The emergency pause mechanism. The authority rotation code. The oracle integration. The timelock logic. The Travel Rule hooks.

Every team, from zero, solving problems other teams have already solved, without the benefit of a shared specification to audit against or build on top of.

Ethereum partially solved this with standards. ERC-20 defined a token interface. ERC-4626 standardized yield vaults. These standards didn't eliminate risk but they created shared foundations. An auditor verifying an ERC-4626 vault has a spec to check against. A wallet implementing ERC-20 support covers every ERC-20 token. Composability follows from shared interfaces.

Solana has Token-2022 for the token mechanics. There is no stablecoin standard above that. No shared specification for governance. No standard event schema so indexers don't write custom parsers for every stablecoin. No compliance interface that carries any shared meaning. Every integrator, every wallet, every DEX builds custom handling for every stablecoin because there's nothing to standardize against.

The result: different blacklist enforcement semantics across programs, some fail closed and many fail open. Different authority models, some multisig and most single key. Different reserve attestation, some on-chain and many just PDFs. Different event schemas requiring custom indexer code for each one.

The Solana Stablecoin Standard project is an open source attempt at addressing this gap. Formally verified preset configurations, MiCA and GENIUS Act compliance mappings, standard event schemas, reference implementations for governance and compliance layers. Not positioned as the only answer. Positioned as a contribution to a conversation that needs to happen.

---

**The "trustless" problem**

A lot of Solana stablecoins describe themselves as trustless or decentralized. The practical test: if the issuer's authority private key is compromised right now, what happens?

For most Solana stablecoins, the answer is that an attacker can mint unlimited tokens in a single transaction with no delay and no circuit breaker. One compromised laptop, one transaction, entire protocol value gone.

That's not trustless. That's a single point of failure with better marketing language.

Stablecoins do require trust. All of them. Circle can freeze your USDC. Paxos can blacklist your PYUSD. The GENIUS Act mandates this capability. The question isn't whether trust exists but whether it's bounded, documented, and protected.

A multisig with 3-of-5 or 4-of-7 signers where no single device holds multiple keys meaningfully reduces the single-compromise risk. Timelocked admin operations give users and watchdogs time to react if something malicious is proposed. A separate guardian network that can trigger emergency pause without issuer involvement removes the issuer as a single point of failure for emergency response. Squads Protocol handles the multisig and timelock infrastructure on Solana and manages over $10 billion. The tooling exists. Most stablecoin programs on Solana aren't using it pre-mainnet.

---

**The oracle confidence interval gap**

CDP stablecoins on Solana mostly use Pyth for price feeds. Pyth is good. The gap is in how programs use it.

Pyth prices come with a confidence interval. If the price is $100 with a confidence interval of +/-10%, the true price could be anywhere from $90 to $110. During high volatility, confidence intervals widen. Most programs check that the Pyth feed isn't stale. Most don't check that the confidence interval is within acceptable bounds before using the price.

The two effects compound badly. Markets are most volatile right before liquidations. Confidence intervals are widest during that same period. A program that accepts a price with a 15% confidence interval can liquidate healthy positions because the oracle was uncertain, not because the position was actually undercollateralized.

Multi-oracle verification where you require two feeds to agree within a tolerance, and confidence gating where you halt price-sensitive operations above a confidence threshold, both address this. Not many programs have either.

---

**Probabilistic Balance Standard and Agent Payment Channels**

Two primitives that exist on Solana and don't in any practical form elsewhere.

PBS: a party commits an amount with a condition hash. When the counterparty proves the condition, funds release automatically. No intermediary decides whether the condition was met. The proof is mathematical. Applications include automated insurance claims that resolve when a verifiable event occurs, B2B payments that release on proof of delivery, escrow with mathematically verified release conditions. Reflect.money's "automatic, no-claims, no-delays" insurance model is conceptually this. The economics work on Solana, at sub-cent fees and 400ms finality, in a way they don't on Ethereum.

APC: payment infrastructure for automated systems paying each other for verified outputs. An initiator opens a channel with a deposit. The counterparty does work and submits a hash of the output. Payment releases when the hash verifies. Force close is available after a timeout. Keeper networks, compliance oracle operators, data feed providers, rebalancing systems, any automated workflow where one system pays another for verifiable outputs. The combination of 400ms finality and sub-cent fees makes micropayments between automated systems viable.

Neither is science fiction and neither requires new tooling. They're executable on Solana today.

---

**The audit situation**

Most Solana stablecoin programs have had no external security audit. The programs holding significant user funds were written, tested internally, and deployed to mainnet.

Ethereum DeFi went through this phase. The list of protocols that lost user funds due to unaudited code is long. The culture shifted. Launching a serious DeFi protocol on Ethereum today without at least one external audit is unusual. The community expects it. LPs expect it.

That norm hasn't fully arrived on Solana yet. The security firms exist and are capable: Neodyme, OtterSec, Ackee Blockchain. The tooling for Solana-specific audits has matured. The cultural pressure to require audits before mainnet is still forming.

The April 2025 Token-2022 confidential transfers bug was found and patched internally. Lucky. The argument that external audits are too expensive doesn't hold up when you're holding or targeting user funds at any meaningful scale. A serious audit costs $30,000 to $100,000. The expected loss from an exploited vulnerability is that cost times orders of magnitude.

---

**The CLARITY Act risk**

A March 2026 draft bill proposes banning platforms from offering yield on stablecoin balances. The details are in flux but the intent is to prevent yield-bearing stablecoins from competing directly with bank deposits.

This directly affects sUSD, parts of USDG's value proposition, and the DeFi yield use cases that have driven significant stablecoin adoption on Solana. The $17 billion supply number changes if the yield mechanic gets legally restricted.

The argument behind the bill is substantively coherent. Regulators who understand what yield-bearing stablecoins are will take it seriously. Whether it passes is uncertain. Treating it as unlikely to matter is probably wrong.

---

**What production-ready looks like in 2026**

Transfer hooks that fail closed. If the compliance account isn't in the transaction, the transaction fails. Not succeeds with a skipped check. Fails.

Authority under multisig before mainnet. Not "we plan to add multisig." Under multisig at launch.

Timelocked admin operations. Parameters that affect user funds need a waiting period, five days is a common threshold, before changes take effect.

On-chain reserve attestation. Monthly PDFs are policy documents. They can say anything. On-chain attestation is verifiable.

External security audit before mainnet from a firm that does Solana work. General smart contract auditors miss Solana-specific issues.

Confidence interval validation in oracle usage, not just staleness checks.

Documented trust assumptions: what trusted parties exist, what they can do, what limits apply. Not to claim there's no trust. To characterize it accurately.

Off-chain monitoring that watches on-chain state and alerts when invariants break. Supply diverging from expected. Reserve ratio dropping. Circuit breaker triggering. You need to know when these happen.

---

**The standard question**

Solana has Token-2022 for token mechanics. It doesn't have a stablecoin standard.

Every indexer writes custom parsers. Every auditor starts from scratch. Every integrator builds custom handling. Every wallet needs to understand each stablecoin's specific behavior individually.

The gap is solvable. The Solana stablecoin ecosystem is large enough now that the collective cost of not having shared foundations is significant. The question is whether the community treats it as a priority before the ecosystem is ten times larger.

What are your actual takes on this? Specifically: does the single-program-many-feature-flags architecture make sense at scale, or should the more complex features like PBS and confidential transfers be separate programs that compose with a simpler core? And where do people land on the CLARITY Act risk to yield-bearing stablecoins?
