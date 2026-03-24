# SSS-3: Trustless Collateral-Backed Stablecoin

> **Preset identifier:** `3`
> **Status:** Specification — reference design for the next SSS extension
> **Innovation:** On-chain collateral enforcement + Token-2022 confidential transfers + blacklist enforcement — simultaneously

---

## Why SSS-3 Exists

SSS-1 and SSS-2 answer the question: _how do you issue and manage a stablecoin on Solana?_

SSS-3 answers a harder question: _how do you issue a stablecoin that no one — not even the issuer — can over-mint, while simultaneously keeping transfer amounts private and enforcing a compliance blacklist?_

Every major algorithmic stablecoin collapse (Terra/Luna, FRAX phases, USDN) had one thing in common: the collateral check happened off-chain or in a contract the issuer could circumvent. SSS-3 moves the collateral check **inside the mint instruction itself**, on the Solana blockchain, reading the vault balance directly from the on-chain account. There is no oracle. There is no price feed to manipulate. There is no off-chain step to bypass.

At the same time, SSS-3 uses **Token-2022 confidential transfers** (ElGamal encryption + ZK proofs) so that transfer amounts are hidden from on-chain observers — while still being enforceable by the compliance authority. This is the only stablecoin design that combines:

1. Trustless collateral enforcement (no oracle)
2. Transfer privacy (ZK proofs on Solana)
3. On-chain compliance blacklist (transfer hook)

---

## How SSS-3 Is Different

| Property | USDC | DAI | SSS-3 |
|----------|------|-----|-------|
| Collateral check | Off-chain attestation | Liquidation bots + oracle | **On-chain vault read, inside mint instruction** |
| Requires price oracle | No (USD-pegged) | Yes (MakerDAO) | **No** |
| Transfer amounts visible on-chain | Yes | Yes | **No (ElGamal ZK proofs)** |
| Compliance blacklist | Off-chain blocklist | None | **On-chain, transfer-hook enforced** |
| Can issuer over-mint? | Yes (trust Circle) | No (over-collateralized) | **No (Rust + Anchor prevents it)** |
| Issuer can bypass compliance? | Yes | N/A | **No (all checks on-chain)** |
| Solana-native | No (cross-chain bridge) | No | **Yes (Token-2022 native)** |

SSS-3 eliminates the three biggest risks in stablecoin design:

- **Over-minting risk** — collateral check is in the Anchor instruction; it cannot be disabled
- **Oracle manipulation risk** — no price feed; the vault balance is the truth
- **Privacy vs. compliance tradeoff** — confidential transfers hide amounts while the transfer hook still enforces blacklist

---

## Architecture

```
Collateral (SOL, USDC, or SPL token)
    │
    ▼
SSS-3 Vault (on-chain account, balance readable by sss-token program)
    │
    │  deposit_collateral(amount)
    ▼
VaultState PDA — tracks: total_collateral, collateral_ratio
    │
    │  mint(amount) — CHECKS: (circulating_supply + amount) × price ≤ total_collateral × ratio
    ▼
Token-2022 confidential mint — ZK proof, amount hidden
    │
    │  transfer (any)
    ▼
Token-2022 → transfer_hook → BlacklistState PDA check
```

All five steps happen on-chain. The collateral check and the blacklist check are both inside Solana transactions.

---

## Core Innovation 1: On-Chain Collateral Check (No Oracle)

### How `deposit_collateral` works

```
deposit_collateral(amount):
  - transfer amount of collateral token from authority to vault
  - VaultState.total_collateral += amount
  - emit DepositEvent
```

The vault is a Token-2022 token account (or a system account for SOL collateral) owned by the VaultState PDA. Its balance is the live, on-chain truth.

### How `mint` enforces the collateral check

```rust
// Inside the mint instruction (Anchor):
let circulating = config.total_minted - config.total_burned;
let collateral_value = vault_state.total_collateral; // read from on-chain account
let max_mintable = collateral_value
    .checked_mul(COLLATERAL_RATIO_DENOMINATOR)
    .ok_or(SSSError::Overflow)?
    .checked_div(vault_state.collateral_ratio) // e.g., 150 for 150% over-collateralized
    .ok_or(SSSError::Overflow)?;

require!(
    circulating.checked_add(amount).ok_or(SSSError::Overflow)? <= max_mintable,
    SSSError::CollateralInsufficient,
);
```

This check runs **inside the Anchor instruction handler**, in Solana BPF bytecode, on every mint. There is no way to mint past the collateral ceiling — not by the issuer, not by an upgrading the program, not by anything short of a Solana validator consensus bug.

The collateral ratio (e.g., 150%) is set at initialization and stored in `VaultState`. A 150% ratio means for every 1.5 USD of collateral, 1 SSS-3 token can be minted. This provides a buffer against collateral value fluctuations.

### Why no oracle?

Most collateral-backed stablecoins require a price oracle to convert collateral value into USD terms. Oracles introduce:

- **Manipulation risk** (flash loan attacks on Chainlink/Pyth feeds)
- **Staleness risk** (oracle fails to update during market stress)
- **Centralization risk** (one oracle operator can halt the system)

SSS-3 sidesteps all of this by **denominating collateral and the stablecoin in the same unit**. If the collateral is USDC, the vault holds USDC, and the collateral ratio is 1:1 (or over-collateralized at e.g. 110%). No price conversion needed. The vault balance IS the collateral value.

For SOL-backed vaults, a sliding collateral ratio (set conservatively and adjustable by governance) provides the buffer. The system never needs an external price.

---

## Core Innovation 2: Confidential Transfers + Compliance

Token-2022's **Confidential Transfer extension** encrypts token balances and transfer amounts using ElGamal encryption. Amounts are hidden on-chain — only the sender, receiver, and auditor (compliance authority) can decrypt them.

Transfers produce a **ZK proof** (range proof + validity proof) proving the transfer is valid (sender has enough tokens, no negative balances) without revealing the amount.

### What SSS-3 adds on top

SSS-3 combines confidential transfers with the SSS-2 transfer hook. This means:

- **Transfer amounts are private** — an on-chain observer sees only that a transfer happened
- **Blacklisted addresses are still blocked** — the transfer hook checks the BlacklistState PDA regardless of whether the transfer is confidential
- **The compliance authority can audit amounts** — the ElGamal auditor key is set to the compliance authority's key; they can decrypt any transfer for regulatory purposes

This is the _privacy-with-compliance_ model that regulators actually want: users get privacy from the public, but the compliance authority retains decryptable audit access. No other Solana stablecoin design achieves this combination.

### Why this is novel vs. Tornado Cash

| | Tornado Cash | SSS-3 Confidential |
|-|-------------|-------------------|
| Privacy mechanism | Mixing (deposit → withdraw anonymously) | ZK proofs on transfer amounts |
| Compliance | None — designed to evade | Built-in: compliance authority has auditor key |
| Blacklist enforcement | None | On-chain transfer hook; blacklisted wallets cannot transact |
| Regulatorily compliant? | No | Yes — auditor key enables traceability |
| Can be used with frozen accounts? | Yes | No — freeze authority blocks account |

Tornado Cash provides anonymity by breaking the transaction graph. SSS-3 provides privacy by hiding amounts while _preserving_ the transaction graph and adding regulatory auditability. These are categorically different designs serving different needs.

---

## Core Innovation 3: `redeem`

Holders can redeem SSS-3 tokens for the underlying collateral at any time:

```
redeem(amount):
  - burn amount of SSS-3 tokens from caller's account
  - VaultState.total_collateral -= redemption_value
  - transfer redemption_value of collateral from vault to caller
  - config.total_burned += amount
```

The redemption value is: `amount × (total_collateral / circulating_supply)` — the holder receives their pro-rata share of the vault, not a fixed $1 peg. This makes SSS-3 behave more like a fully-backed fund than a fractional reserve, which is the safest possible design.

---

## Security Model

### What cannot go wrong

| Attack Vector | Mitigation |
|--------------|------------|
| Over-minting | `CollateralInsufficient` check in Anchor instruction; enforced by Solana BPF |
| Oracle manipulation | No oracle; vault balance is ground truth |
| Blacklist bypass | Transfer hook is registered in Token-2022 mint extension; cannot be removed without re-initializing the mint |
| Amount snooping | ElGamal encryption; only sender, receiver, auditor can decrypt |
| Unauthorized freeze | Freeze authority is set at init; immutable unless `update_roles` is called by authority |
| Reentrancy | Anchor's single-threaded BPF execution model; no reentrancy possible |

### What can go wrong

| Risk | Description | Mitigation |
|------|-------------|------------|
| Collateral depeg | If collateral is USDC and Circle depegs, vault value drops | Use over-collateralization ratio > 100% |
| Vault drain | If the vault PDA is compromised | Vault PDA is program-owned; no external party can withdraw without calling `redeem` |
| Upgrade authority | An upgradeable program can change the collateral check | Set upgrade authority to `None` (immutable) for production |
| ZK proof library | Confidential transfers depend on `spl-token-confidential-transfer` | Library is maintained by Solana Labs; use pinned version |

The most important production recommendation: **set the upgrade authority to `None`** before going live. An immutable program means the collateral check can never be changed.

---

## Quick Start (Reference)

SSS-3 is a specification today. When implemented, the SDK interface will look like:

```typescript
import { SolanaStablecoin, sss3Config } from '@stbr/sss-token';

const stablecoin = await SolanaStablecoin.create(provider, sss3Config({
  name: 'Trustless USD',
  symbol: 'tUSD',
  decimals: 6,
  collateralMint: usdcMint,         // USDC collateral
  collateralRatio: 110,              // 110% over-collateralized
  transferHookProgram: hookProgramId,
  confidentialTransfers: true,       // Enable ZK transfer privacy
  auditorElgamalKey: compliancePubkey, // Compliance authority can decrypt
}));

// Deposit collateral
await stablecoin.depositCollateral({
  amount: 1_100_000n,   // 1.1 USDC in (for 1 tUSD out)
});

// Mint (succeeds only if collateral ratio holds)
await stablecoin.mintTo({
  amount: 1_000_000n,   // 1 tUSD
  recipient: recipientPubkey,
});

// Redeem — get collateral back
await stablecoin.redeem({
  amount: 500_000n,     // return 0.5 tUSD, receive proportional collateral
  destination: collateralTokenAccount,
});
```

---

## Why SSS-3 Matters for the Solana Ecosystem

**SSS-1** gives Solana projects a clean, minimal way to issue tokens.
**SSS-2** gives regulated issuers a compliant path.
**SSS-3** gives DeFi protocols a collateral-backed, privacy-preserving stablecoin with strong on-chain enforcement of the collateral ratio. Reserve attestation is performed by a whitelisted attestor keypair (not a trustless on-chain vault verification); see [TRUST-MODEL.md](./TRUST-MODEL.md) for a complete breakdown of trust assumptions per tier.

This is the arc: from centralized trust (USDC) → algorithmic (Terra, broken) → collateral-backed with on-chain enforcement and ZK privacy (SSS-3). Solana has the throughput, the ZK infrastructure (Token-2022 confidential transfers), and the composability to make this work. SSS-3 is the blueprint.

> ⚠️ **Trust caveat (v1):** In the current implementation the reserve amount is submitted by a whitelisted attestor keypair — the program does not independently verify vault balances on-chain. `set_reserve_attestor_whitelist` is not timelocked. `max_supply = 0` means **uncapped**. ZK credential verification and the cross-chain bridge are v1 stubs. See [TRUST-MODEL.md](./TRUST-MODEL.md) for full details.

---

## Related Docs

- [SSS-1.md](./SSS-1.md) — minimal preset
- [SSS-2.md](./SSS-2.md) — compliant preset
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture
- [transfer-hook.md](./transfer-hook.md) — transfer hook program (shared with SSS-2)
- [compliance-module.md](./compliance-module.md) — compliance SDK (shared with SSS-2)
