import type { Character, GameState } from './types';
import { inCourt, P, people } from './state';
import { inLaws, opinion } from './opinion';
import { bondWith } from './relations';

/* ───────── 인맥도 ─────────
 * 플레이어를 둘러싼 사람들을 관계별로 골라 낸다. UI의 인맥 탭이 그린다.
 */

export type TieKind = 'bond' | 'debt' | 'kin' | 'inlaw' | 'disciple' | 'teacher' | 'foe' | 'plot';

export const TIE_META: Record<TieKind, { name: string; color: string; dash?: string }> = {
  bond: { name: '맹약', color: '#e2c46a' },
  debt: { name: '신세 진 이', color: '#7fae6a', dash: '5 4' },
  kin: { name: '같은 가문', color: '#6aa0d6' },
  inlaw: { name: '혼맥', color: '#8fb9e6', dash: '2 3' },
  disciple: { name: '문인', color: '#b08ad6' },
  teacher: { name: '스승', color: '#b08ad6' },
  foe: { name: '정적', color: '#c0472f', dash: '6 3' },
  plot: { name: '나를 노림', color: '#ff6a4a' },
};

export interface Tie {
  c: Character;
  kinds: TieKind[];
  /** 그가 나를 보는 호감 */
  op: number;
  /** 내가 그를 보는 호감 */
  mine: number;
}

/** 관계가 있는 사람을 중요한 순서로 max명까지 */
export function network(s: GameState, max = 28): Tie[] {
  const p = P(s);
  const plotters = new Set(s.plots.filter((x) => x.known).map((x) => x.by));
  const out: (Tie & { w: number })[] = [];
  for (const c of people(s)) {
    if (c.id === p.id) continue;
    const kinds: TieKind[] = [];
    if (bondWith(s, c.id)) kinds.push('bond');
    if (s.player.debts[c.id]) kinds.push('debt');
    if (c.clan === p.clan) kinds.push('kin');
    else if (inLaws(s, p.clan, c.clan) && inCourt(c)) kinds.push('inlaw');
    if (c.teacher === p.id) kinds.push('disciple');
    if (p.teacher === c.id) kinds.push('teacher');
    if (plotters.has(c.id)) kinds.push('plot');
    const op = opinion(s, c, p);
    if (op <= -30 && inCourt(c)) kinds.push('foe');
    if (!kinds.length) continue;
    const w = kinds.length * 20 + Math.abs(op) + (kinds.includes('plot') ? 80 : 0) + (kinds.includes('bond') ? 60 : 0);
    out.push({ c, kinds, op, mine: opinion(s, p, c), w });
  }
  return out.sort((a, b) => b.w - a.w).slice(0, max);
}
