import { LinearSRGBColorSpace } from 'three';
import { describe, expect, it } from 'vitest';
import { skyAt } from '../src/render/sky';

describe('skyAt', () => {
  it('uses the day paper at noon', () => {
    expect(skyAt(0.5).paper.getHexString(LinearSRGBColorSpace)).toBe('ebe9e2');
  });

  it('uses the night paper at midnight', () => {
    expect(skyAt(0).paper.getHexString(LinearSRGBColorSpace)).toBe('1a1c1b');
  });

  it('gives one ink per material', () => {
    expect(skyAt(0.5).inks).toHaveLength(8);
    expect(skyAt(0).inks).toHaveLength(8);
  });
});
