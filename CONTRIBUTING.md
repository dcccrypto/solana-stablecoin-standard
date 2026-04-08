# Contributing to the Solana Stablecoin Standard

Thank you for your interest in contributing to SSS! This guide will help you get started.

---

## Getting Started

1. **Fork** [`dcccrypto/solana-stablecoin-standard`](https://github.com/dcccrypto/solana-stablecoin-standard)
2. **Clone** your fork and install dependencies:
   ```bash
   git clone https://github.com/<you>/solana-stablecoin-standard.git
   cd solana-stablecoin-standard
   npm install
   cd sdk && npm install && cd ..
   ```
3. **Create a branch:** `git checkout -b feat/your-feature`
4. **Make your changes**, write tests, and verify everything passes
5. **Open a PR** against `main` with a clear description

---

## Development Setup

### Prerequisites

| Tool | Version |
|---|---|
| Rust | 2021 edition |
| Solana CLI | 2.3.13+ |
| Anchor | 0.32.0 |
| Node.js | 20+ |
| npm/yarn | latest |

### Build & Test

```bash
# On-chain programs
anchor build
anchor test

# TypeScript SDK
cd sdk && npx vitest run

# Backend
cd backend && cargo test

# Lint everything
cargo clippy -- -D warnings
cd sdk && npx eslint src --ext .ts
```

---

## Code Standards

### Rust (On-Chain Programs)

- **All arithmetic must use `checked_*` operations** — no raw `+`, `-`, `*`, `/`. The `overflow-checks = true` flag is enforced in Cargo.toml and must remain.
- **New instructions require Kani proofs** — add corresponding proofs in `programs/sss-token/src/proofs.rs`.
- **Feature flag bits must not collide** — check existing assignments in `state.rs` and `crates/sss-cpi/src/flags.rs` before adding new flags.
- **Error variants** — add new error types to `programs/sss-token/src/error.rs` with descriptive messages.
- **Events** — new events go in `programs/sss-token/src/events.rs` following the existing schema.

### TypeScript (SDK)

- **New SDK methods require vitest tests** — co-locate as `ModuleName.test.ts` next to the module file.
- **Type safety** — no `any` types. Use the generated IDL types.
- **IDL sync** — after `anchor build`, copy IDLs: `cp target/idl/sss_token.json sdk/src/idl/sss_token.json`

### Backend (Rust/axum)

- **Follow existing patterns** — route handlers in `routes/`, database ops in `db.rs`.
- **API changes** — update `api-types.ts` in the SDK and `docs/api.md`.

---

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update relevant documentation if behavior changes
- Reference any related issues (e.g., `SSS-147`, `BUG-033`)
- All CI checks must pass before merge

---

## Commit Messages

Follow conventional commits:

```
feat(sdk): add RedemptionQueueModule with FIFO operations
fix(program): enforce pause check on deposit_collateral
docs: update SSS-3 trust assumptions after SSS-147 hardening
test: add Kani proofs for PDA seed collision resistance
```

---

## Attribution

The Solana Stablecoin Standard was created by [Khubair](https://github.com/dcccrypto). Contributors are credited in the CHANGELOG and commit history.

---

## License

By submitting a Pull Request, you agree that your contribution is licensed under the Apache License 2.0 and that you have the right to make the contribution.
