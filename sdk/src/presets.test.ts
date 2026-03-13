import { describe, it, expect } from 'vitest';
import { SSS1_PRESET, SSS2_PRESET } from './presets';

describe('SSS presets', () => {
  it('SSS-1 preset has preset=SSS-1 and decimals=6', () => {
    expect(SSS1_PRESET.preset).toBe('SSS-1');
    expect(SSS1_PRESET.decimals).toBe(6);
  });

  it('SSS-2 preset has preset=SSS-2 and decimals=6', () => {
    expect(SSS2_PRESET.preset).toBe('SSS-2');
    expect(SSS2_PRESET.decimals).toBe(6);
  });

  it('SSS-1 and SSS-2 presets are distinct', () => {
    expect(SSS1_PRESET.preset).not.toBe(SSS2_PRESET.preset);
  });
});
