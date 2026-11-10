import type { GameState } from './types';
import { seedWants } from './relations';
import { initRoyal } from './royal';
import { ROSTER } from './data/roster';
import { fromRoster } from './generate';
import { tOf } from './calendar';

/** 나중에 생긴 필드를 채운다. 새 게임과 이어하기 모두 거친다. */
export function ensureState(s: GameState): GameState {
  const pl = s.player;
  pl.contacts ??= {};
  pl.suspicion ??= 0;
  pl.knownWants ??= [];
  pl.bonds ??= [];
  pl.proteges ??= [];
  pl.retainers ??= 0;
  pl.lowProfile ??= false;
  s.plots ??= [];
  s.races ??= [];
  s.king ??= { mood: 10, lean: {}, wary: {} };
  s.line ??= {};
  s.situations ??= [];
  if (!s.royal) {
    s.royal = initRoyal();
    for (const r of ROSTER) {
      if (r.status !== 'royal' || !r.arrive || s.chars[r.id]) continue;
      if (tOf(r.arrive[0], r.arrive[1]) <= s.t) fromRoster(s, r);
    }
  }
  if (!s.flags.wantsSeeded) {
    s.flags.wantsSeeded = true;
    if (!Object.values(s.chars).some((c) => c.want)) seedWants(s);
  }
  return s;
}
