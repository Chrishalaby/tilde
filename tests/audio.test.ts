import { describe, expect, it } from 'vitest';
import { MATERIAL } from '../src/config';
import { createAudio, type AudioContextSnapshot } from '../src/audio/index';

function snapshot(over: Partial<AudioContextSnapshot> = {}): AudioContextSnapshot {
  return { biome: MATERIAL.GRASS, nearWater: 0, altitude: 0, speed: 0, timeOfDay: 0.5, ...over };
}

describe('createAudio', () => {
  it('constructs without touching the Web Audio API', () => {
    const audio = createAudio();
    expect(audio.started).toBe(false);
    expect(typeof audio.start).toBe('function');
  });

  it('update before start is a no-op and leaves started false', () => {
    const audio = createAudio();
    expect(() => audio.update(0.016, snapshot())).not.toThrow();
    expect(() =>
      audio.update(1, snapshot({ biome: MATERIAL.FOREST, altitude: 210, speed: 3.1, nearWater: 1 })),
    ).not.toThrow();
    expect(() => audio.update(0.5, snapshot({ biome: MATERIAL.SNOW }))).not.toThrow();
    expect(audio.started).toBe(false);
  });

  it('discover before start is a no-op', () => {
    const audio = createAudio();
    expect(() => audio.discover()).not.toThrow();
    expect(audio.started).toBe(false);
  });

  it('start degrades to silence with no AudioContext available', async () => {
    const audio = createAudio();
    await expect(audio.start()).resolves.toBeUndefined();
    expect(audio.started).toBe(false);
    expect(() => audio.update(0.016, snapshot())).not.toThrow();
    expect(() => audio.discover()).not.toThrow();
  });

  it('getVolume reflects setVolume clamped to [0,1] before start', () => {
    const audio = createAudio();
    expect(audio.getVolume()).toBe(1);
    audio.setVolume(0.5);
    expect(audio.getVolume()).toBe(0.5);
    audio.setVolume(0);
    expect(audio.getVolume()).toBe(0);
    audio.setVolume(-3);
    expect(audio.getVolume()).toBe(0);
    audio.setVolume(4.2);
    expect(audio.getVolume()).toBe(1);
    audio.setVolume(Number.NaN);
    expect(audio.getVolume()).toBe(0);
    expect(audio.started).toBe(false);
  });
});
