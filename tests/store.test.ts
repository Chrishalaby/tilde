import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadPose,
  loadSettings,
  loadWorld,
  savePose,
  saveSettings,
  saveWorld,
  type Settings,
} from '../src/state/store';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

interface Stub {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

function createStub(): Stub {
  const map = new Map<string, string>();
  return {
    get length(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
    getItem(key: string): string | null {
      const v = map.get(key);
      return v === undefined ? null : v;
    },
    key(index: number): string | null {
      const keys = Array.from(map.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    setItem(key: string, value: string): void {
      map.set(key, String(value));
    },
  };
}

function setLocalStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

function install(): Stub {
  const stub = createStub();
  setLocalStorage(stub);
  return stub;
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('store without localStorage', () => {
  it('returns DEFAULT_SETTINGS when localStorage is missing', () => {
    setLocalStorage(undefined);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns null for world and pose when localStorage is missing', () => {
    setLocalStorage(undefined);
    expect(loadWorld()).toBeNull();
    expect(loadPose()).toBeNull();
  });

  it('does not throw when saving with localStorage missing', () => {
    setLocalStorage(undefined);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
    expect(() => saveWorld({ seed: 1, genVersion: 1 })).not.toThrow();
    expect(() => savePose({ x: 0, z: 0, yaw: 0, pitch: 0, timeOfDay: 0 })).not.toThrow();
  });

  it('does not throw when localStorage itself throws', () => {
    setLocalStorage({
      getItem(): string {
        throw new Error('blocked');
      },
      setItem(): void {
        throw new Error('blocked');
      },
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('store with a localStorage stub', () => {
  it('round-trips settings', () => {
    const stub = install();
    const settings: Settings = { cellW: 12, cellH: 22, volume: 0.35, grain: false, headBob: false };
    saveSettings(settings);
    expect(stub.getItem('tilde.settings.v3')).toBeTypeOf('string');
    expect(loadSettings()).toEqual(settings);
  });

  it('round-trips the defaults', () => {
    install();
    saveSettings(DEFAULT_SETTINGS);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips world and pose', () => {
    install();
    saveWorld({ seed: 987654, genVersion: 1 });
    expect(loadWorld()).toEqual({ seed: 987654, genVersion: 1 });
    const pose = { x: 12.5, z: -40.25, yaw: 1.5, pitch: -0.25, timeOfDay: 0.4 };
    savePose(pose);
    expect(loadPose()).toEqual(pose);
  });

  it('falls back to defaults when the stored value is corrupt', () => {
    const stub = install();
    stub.setItem('tilde.settings.v3', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    stub.setItem('tilde.settings.v3', '"nope"');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    stub.setItem('tilde.world', '{"seed":"x"}');
    expect(loadWorld()).toBeNull();
  });

  it('keeps known fields when unknown ones are stored', () => {
    const stub = install();
    stub.setItem('tilde.settings.v3', JSON.stringify({ cellW: 9, junk: true }));
    const loaded = loadSettings();
    expect(loaded.cellW).toBe(9);
    expect(loaded.cellH).toBe(DEFAULT_SETTINGS.cellH);
    expect(loaded.volume).toBe(DEFAULT_SETTINGS.volume);
  });
});
