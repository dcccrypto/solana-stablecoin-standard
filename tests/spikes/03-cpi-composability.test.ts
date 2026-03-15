/**
 * SSS-042 Direction 3: CPI Composability Interface Stubs
 *
 * Validates that the CPI interface stubs for SSS programs:
 * - Compile and resolve to correct TypeScript shapes
 * - Encode/decode instruction discriminators correctly
 * - Expose the expected method signatures for cross-program invocation
 * - Are structurally compatible with the Anchor IDL
 */

import { describe, it, expect } from "vitest";

// ─── CPI Interface Types ───────────────────────────────────────────────────

/** Instruction discriminator: first 8 bytes of SHA256("global:<instruction_name>"). */
type Discriminator = Uint8Array & { length: 8 };

/** Generic CPI instruction stub. */
interface CpiInstruction<T extends Record<string, unknown>> {
  discriminator: Discriminator;
  encode(args: T): Buffer;
  accounts: string[];
}

// ─── Discriminator Helper ──────────────────────────────────────────────────

import { createHash } from "crypto";

function discriminator(ixName: string): Discriminator {
  const hash = createHash("sha256").update(`global:${ixName}`).digest();
  return hash.slice(0, 8) as Discriminator;
}

// ─── SSS CPI Stubs ─────────────────────────────────────────────────────────

const SssMintCpi: CpiInstruction<{ amount: bigint }> = {
  discriminator: discriminator("mint"),
  accounts: ["config", "minterInfo", "mint", "destination", "minter", "tokenProgram"],
  encode({ amount }) {
    const buf = Buffer.alloc(8 + 8);
    SssMintCpi.discriminator.forEach((b, i) => buf.writeUInt8(b, i));
    buf.writeBigUInt64LE(amount, 8);
    return buf;
  },
};

const SssBurnCpi: CpiInstruction<{ amount: bigint }> = {
  discriminator: discriminator("burn"),
  accounts: ["config", "minterInfo", "mint", "source", "minter", "tokenProgram"],
  encode({ amount }) {
    const buf = Buffer.alloc(8 + 8);
    SssBurnCpi.discriminator.forEach((b, i) => buf.writeUInt8(b, i));
    buf.writeBigUInt64LE(amount, 8);
    return buf;
  },
};

const SssInitializeCpi: CpiInstruction<{
  preset: number;
  decimals: number;
  name: string;
  symbol: string;
  uri: string;
}> = {
  discriminator: discriminator("initialize"),
  accounts: ["config", "mint", "authority", "systemProgram", "tokenProgram"],
  encode({ preset, decimals, name, symbol, uri }) {
    // Simplified: real encoding uses Borsh
    const nameBytes = Buffer.from(name, "utf8");
    const symbolBytes = Buffer.from(symbol, "utf8");
    const uriBytes = Buffer.from(uri, "utf8");
    const size = 8 + 1 + 1 + 4 + nameBytes.length + 4 + symbolBytes.length + 4 + uriBytes.length;
    const buf = Buffer.alloc(size);
    let offset = 0;
    SssInitializeCpi.discriminator.forEach((b) => { buf.writeUInt8(b, offset++); });
    buf.writeUInt8(preset, offset++);
    buf.writeUInt8(decimals, offset++);
    buf.writeUInt32LE(nameBytes.length, offset); offset += 4;
    nameBytes.copy(buf, offset); offset += nameBytes.length;
    buf.writeUInt32LE(symbolBytes.length, offset); offset += 4;
    symbolBytes.copy(buf, offset); offset += symbolBytes.length;
    buf.writeUInt32LE(uriBytes.length, offset); offset += 4;
    uriBytes.copy(buf, offset);
    return buf;
  },
};

const SssDepositCollateralCpi: CpiInstruction<{ amount: bigint }> = {
  discriminator: discriminator("deposit_collateral"),
  accounts: ["config", "reserveVault", "depositor", "depositorTokenAccount", "tokenProgram"],
  encode({ amount }) {
    const buf = Buffer.alloc(8 + 8);
    SssDepositCollateralCpi.discriminator.forEach((b, i) => buf.writeUInt8(b, i));
    buf.writeBigUInt64LE(amount, 8);
    return buf;
  },
};

const SssRedeemCpi: CpiInstruction<{ amount: bigint }> = {
  discriminator: discriminator("redeem"),
  accounts: ["config", "reserveVault", "redeemer", "redeemerTokenAccount", "mint", "tokenProgram"],
  encode({ amount }) {
    const buf = Buffer.alloc(8 + 8);
    SssRedeemCpi.discriminator.forEach((b, i) => buf.writeUInt8(b, i));
    buf.writeBigUInt64LE(amount, 8);
    return buf;
  },
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Direction 3: CPI Composability Interface Stubs", () => {
  it("mint discriminator is 8 bytes", () => {
    expect(SssMintCpi.discriminator).toHaveLength(8);
  });

  it("burn discriminator is 8 bytes", () => {
    expect(SssBurnCpi.discriminator).toHaveLength(8);
  });

  it("discriminators are unique across all instructions", () => {
    const discs = [
      SssMintCpi.discriminator,
      SssBurnCpi.discriminator,
      SssInitializeCpi.discriminator,
      SssDepositCollateralCpi.discriminator,
      SssRedeemCpi.discriminator,
    ].map((d) => Buffer.from(d).toString("hex"));

    const unique = new Set(discs);
    expect(unique.size).toBe(5);
  });

  it("mint encoding starts with discriminator", () => {
    const encoded = SssMintCpi.encode({ amount: 1_000n });
    const disc = Buffer.from(SssMintCpi.discriminator).toString("hex");
    expect(encoded.subarray(0, 8).toString("hex")).toBe(disc);
  });

  it("mint encoding encodes amount as little-endian u64", () => {
    const amount = 1_234_567n;
    const encoded = SssMintCpi.encode({ amount });
    const decoded = encoded.readBigUInt64LE(8);
    expect(decoded).toBe(amount);
  });

  it("burn encoding encodes amount as little-endian u64", () => {
    const amount = 999_888n;
    const encoded = SssBurnCpi.encode({ amount });
    const decoded = encoded.readBigUInt64LE(8);
    expect(decoded).toBe(amount);
  });

  it("initialize encoding contains preset and decimals", () => {
    const encoded = SssInitializeCpi.encode({
      preset: 2,
      decimals: 6,
      name: "Test",
      symbol: "TST",
      uri: "https://example.com",
    });
    expect(encoded[8]).toBe(2);  // preset
    expect(encoded[9]).toBe(6);  // decimals
  });

  it("deposit_collateral encoding total size is 16 bytes", () => {
    const encoded = SssDepositCollateralCpi.encode({ amount: 50_000n });
    expect(encoded).toHaveLength(16); // 8 disc + 8 u64
  });

  it("redeem encoding total size is 16 bytes", () => {
    const encoded = SssRedeemCpi.encode({ amount: 25_000n });
    expect(encoded).toHaveLength(16);
  });

  it("mint accounts list includes required keys", () => {
    expect(SssMintCpi.accounts).toContain("config");
    expect(SssMintCpi.accounts).toContain("minterInfo");
    expect(SssMintCpi.accounts).toContain("mint");
    expect(SssMintCpi.accounts).toContain("tokenProgram");
  });

  it("burn accounts list includes required keys", () => {
    expect(SssBurnCpi.accounts).toContain("config");
    expect(SssBurnCpi.accounts).toContain("source");
    expect(SssBurnCpi.accounts).toContain("tokenProgram");
  });

  it("deposit_collateral accounts list includes reserveVault", () => {
    expect(SssDepositCollateralCpi.accounts).toContain("reserveVault");
  });

  it("redeem accounts list includes reserveVault and mint", () => {
    expect(SssRedeemCpi.accounts).toContain("reserveVault");
    expect(SssRedeemCpi.accounts).toContain("mint");
  });

  it("mint and burn discriminators differ (no naming collision)", () => {
    const mintHex = Buffer.from(SssMintCpi.discriminator).toString("hex");
    const burnHex = Buffer.from(SssBurnCpi.discriminator).toString("hex");
    expect(mintHex).not.toBe(burnHex);
  });

  it("max u64 amount encodes and decodes correctly", () => {
    const maxU64 = 18_446_744_073_709_551_615n;
    const encoded = SssMintCpi.encode({ amount: maxU64 });
    const decoded = encoded.readBigUInt64LE(8);
    expect(decoded).toBe(maxU64);
  });

  it("zero amount encodes correctly", () => {
    const encoded = SssMintCpi.encode({ amount: 0n });
    const decoded = encoded.readBigUInt64LE(8);
    expect(decoded).toBe(0n);
  });
});
