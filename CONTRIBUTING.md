# Contributing to the Solana Stablecoin Standard

Thank you for your interest in contributing to SSS.

## License

By submitting a Pull Request, you agree that your Contribution is
licensed under the Apache License 2.0 and that you have the right to
make the Contribution (i.e. you own the code or have permission to
submit it).

## Attribution

The Solana Stablecoin Standard was created by Khubair (github.com/dcccrypto).
Contributors are credited in the CHANGELOG and commit history.

## How to Contribute

1. Fork `dcccrypto/solana-stablecoin-standard`
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Write tests for your changes
4. Ensure `cargo check` and `npx vitest run` pass
5. Open a PR against `main` with a clear description

## Standards

- All arithmetic must use `checked_*` — no raw `+/-`
- New instructions must have corresponding Kani proofs in `proofs.rs`
- New SDK methods must have vitest tests
- `overflow-checks = true` must remain in `Cargo.toml`

## Commercial Licensing

If you intend to use SSS in a commercial product, please review the
NOTICE file and contact the original author about a commercial license.
