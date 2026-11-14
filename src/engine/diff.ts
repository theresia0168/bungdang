import type { GameState } from './types';

/* ───────── 난이도 ─────────
 * 순탄: 정적의 음모와 숙적의 움직임이 드물고, 고을의 원성이 덜 터진다. 결말 점수 −15%.
 * 험난: 음모가 빨리 무르익고, 숙적이 자주 움직이고, 고을이 쉽게 들끓는다. 결말 점수 +15%.
 */

export type Diff = 'easy' | 'normal' | 'hard';

export const DIFF_META: Record<Diff, { name: string; desc: string; score: number }> = {
  easy: { name: '순탄', desc: '정적의 음모와 숙적의 움직임이 드물고, 고을의 원성이 덜 터진다. 재산 +30으로 시작. 결말 점수 −15%.', score: -0.15 },
  normal: { name: '보통', desc: '본디의 조정.', score: 0 },
  hard: { name: '험난', desc: '음모가 빨리 무르익고, 숙적이 자주 움직이고, 고을이 쉽게 들끓는다. 결말 점수 +15%.', score: 0.15 },
};

export const diffOf = (s: GameState): Diff => (s.flags.diff as Diff) ?? 'normal';

/** 플레이어에게 닥치는 위험의 배수 */
export const diffK = (s: GameState) => ({ easy: 0.6, normal: 1, hard: 1.4 })[diffOf(s)];
