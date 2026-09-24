import { describe, expect, it } from 'vitest';
import { createPlayer } from '../src/player/controller';
import { EYE_HEIGHT, JUMP_HEIGHT } from '../src/config';

type Listener = (ev: unknown) => void;

function fakeDom() {
  const listeners = new Map<string, Listener[]>();
  const target = {
    addEventListener: (type: string, fn: Listener) => {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener: () => {},
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = target;
  g.document = { ...target, pointerLockElement: null };
  const fire = (type: string, ev: unknown) => {
    for (const fn of listeners.get(type) ?? []) fn(ev);
  };
  return { fire };
}

function press(fire: (type: string, ev: unknown) => void, code: string, repeat = false) {
  fire('keydown', { code, key: code, repeat, target: null, preventDefault: () => {} });
}

describe('jumping', () => {
  it('rises about the jump height and lands back on the ground', () => {
    const { fire } = fakeDom();
    const canvas = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLCanvasElement;
    const player = createPlayer({ canvas, heightAt: () => 10, initial: { x: 0, z: 0, yaw: 0, pitch: 0 }, headBob: false });
    for (let i = 0; i < 120; i++) player.update(1 / 60);
    const rest = player.view.y;
    expect(rest).toBeCloseTo(10 + EYE_HEIGHT, 2);
    press(fire, 'Space');
    let peak = rest;
    for (let i = 0; i < 90; i++) {
      player.update(1 / 60);
      peak = Math.max(peak, player.view.y);
    }
    expect(peak - rest).toBeGreaterThan(JUMP_HEIGHT * 0.85);
    expect(peak - rest).toBeLessThan(JUMP_HEIGHT * 1.1);
    for (let i = 0; i < 120; i++) player.update(1 / 60);
    expect(player.view.y).toBeCloseTo(rest, 2);
    player.dispose();
  });

  it('ignores key repeat so holding space does not bounce forever', () => {
    const { fire } = fakeDom();
    const canvas = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as HTMLCanvasElement;
    const player = createPlayer({ canvas, heightAt: () => 0, initial: { x: 0, z: 0, yaw: 0, pitch: 0 }, headBob: false });
    for (let i = 0; i < 60; i++) player.update(1 / 60);
    const rest = player.view.y;
    press(fire, 'Space');
    for (let i = 0; i < 90; i++) {
      press(fire, 'Space', true);
      player.update(1 / 60);
    }
    for (let i = 0; i < 60; i++) player.update(1 / 60);
    expect(player.view.y).toBeCloseTo(rest, 2);
    player.dispose();
  });
});
