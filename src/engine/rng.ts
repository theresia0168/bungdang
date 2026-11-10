import type { GameState } from './types';

/** mulberry32. 상태를 GameState에 저장해 저장/불러오기 후에도 결과가 재현된다. */
export function rand(s: GameState): number {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const chance = (s: GameState, p: number) => rand(s) < p;
export const d6 = (s: GameState) => 1 + Math.floor(rand(s) * 6);
export const randInt = (s: GameState, lo: number, hi: number) => lo + Math.floor(rand(s) * (hi - lo + 1));

export function pick<T>(s: GameState, arr: readonly T[]): T {
  return arr[Math.floor(rand(s) * arr.length)];
}

export function weighted<T>(s: GameState, items: [T, number][]): T | undefined {
  const total = items.reduce((a, [, w]) => a + Math.max(0, w), 0);
  if (total <= 0) return undefined;
  let r = rand(s) * total;
  for (const [v, w] of items) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export function shuffle<T>(s: GameState, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
