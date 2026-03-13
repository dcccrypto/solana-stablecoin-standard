import { SssConfig } from './types';

/**
 * SSS-1: Minimal stablecoin preset.
 * Features: Token-2022 mint, freeze authority, metadata.
 * Use for: Internal tokens, DAO treasuries, ecosystem settlement.
 */
export const SSS1_PRESET = {
  preset: 'SSS-1' as const,
  decimals: 6,
  uri: '',
};

/**
 * SSS-2: Compliant stablecoin preset.
 * Features: SSS-1 + permanent delegate + transfer hook + blacklist enforcement.
 * Use for: Regulated stablecoins (USDC/USDT-class).
 */
export const SSS2_PRESET = {
  preset: 'SSS-2' as const,
  decimals: 6,
  uri: '',
};

/** Create an SSS-1 config with overrides. */
export function sss1Config(overrides: Omit<SssConfig, 'preset'>): SssConfig {
  return { ...SSS1_PRESET, ...overrides, preset: 'SSS-1' };
}

/** Create an SSS-2 config with overrides. */
export function sss2Config(overrides: Omit<SssConfig, 'preset'>): SssConfig {
  if (!overrides.transferHookProgram) {
    throw new Error('SSS-2 requires transferHookProgram');
  }
  return { ...SSS2_PRESET, ...overrides, preset: 'SSS-2' };
}
