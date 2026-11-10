/** 관직 순환 점검: 임기, 같은 자리 재임, 품계보다 낮은 자리 제수 */
import { newGame, PLAYABLE } from '../src/engine/setup';
import { advanceMonth, resolveEvent } from '../src/engine/turn';
import { viewEvent } from '../src/engine/events';
import { holderMap } from '../src/engine/court';
import { OFFICE_MAP } from '../src/engine/data/offices';

const runs = Number(process.argv[2] ?? 3);
const stints: Record<string, number[]> = {};
let same = 0;
const sameBy: Record<string, number> = {};
let chars = 0;
let games = 0;
let appointments = 0;
const down: Record<string, number> = {};
let idleHigh = 0;
let samples = 0;

const groupOf = (id: string) => {
  const o = OFFICE_MAP[id];
  return o.group === 'gamsa' ? '관찰사' : o.rank === 1 ? '정승' : o.cheongyo ? '청요직' : `${o.rank}품 ${o.group}`;
};

for (const pl of PLAYABLE) {
  for (let r = 0; r < runs; r++) {
    const s = newGame({ kind: 'historical', id: pl.id }, 9000 + r * 7919);
    let prev = holderMap(s);
    const since: Record<string, number> = Object.fromEntries(Object.keys(prev).map((k) => [k, s.t]));
    const lastHeld: Record<string, { who: string; t: number }[]> = {};
    let ranks: Record<string, number> = Object.fromEntries(Object.values(s.chars).map((c) => [c.id, c.rank]));
    let guard = 0;
    while (!s.over && guard++ < 400) {
      while (s.pending.length && !s.over) {
        const e = s.pending[0];
        const v = viewEvent(s, e);
        const ok = v.choices.filter((c) => !c.disabled);
        resolveEvent(s, e.id, (ok[0] ?? v.choices[0]).key);
      }
      if (s.over) break;
      advanceMonth(s);
      const hm = holderMap(s);
      for (const id of Object.keys(OFFICE_MAP)) {
        const a = prev[id];
        const b = hm[id];
        if (a?.id === b?.id) continue;
        const g = groupOf(id);
        if (a) {
          (stints[g] ??= []).push(s.t - (since[id] ?? s.t));
          (lastHeld[id] ??= []).push({ who: a.id, t: s.t });
        }
        if (b) {
          appointments++;
          since[id] = s.t;
          const back = (lastHeld[id] ?? []).filter((x) => x.who === b.id).at(-1);
          if (back && s.t - back.t <= 36) {
            same++;
            const k = `${g} ${s.t - back.t <= 24 ? '2년 안' : '2~3년'}`;
            sameBy[k] = (sameBy[k] ?? 0) + 1;
          }
          const before = ranks[b.id] ?? b.rank;
          if (before < OFFICE_MAP[id].rank) down[`${before}품 → ${OFFICE_MAP[id].rank}품 ${g}`] = (down[`${before}품 → ${OFFICE_MAP[id].rank}품 ${g}`] ?? 0) + 1;
        }
      }
      for (const c of Object.values(s.chars)) if (c.status === 'idle' && c.rank <= 2) idleHigh++;
      samples++;
      prev = hm;
      ranks = Object.fromEntries(Object.values(s.chars).map((c) => [c.id, c.rank]));
    }
    chars += Object.keys(s.chars).length;
    games++;
  }
}

const avg = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1);
const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * q)] ?? 0;
console.log('평균 재임(개월) / 중앙값 / 90%:');
for (const [g, xs] of Object.entries(stints).sort()) console.log(`  ${g.padEnd(14)} n=${String(xs.length).padStart(4)} 평균 ${avg(xs)} 중앙 ${pct(xs, 0.5)} 90% ${pct(xs, 0.9)}`);
console.log(`제수 ${appointments}건, 3년 안에 같은 자리 재임 ${same}건 (${((same / appointments) * 100).toFixed(1)}%)`);
console.log('같은 자리 재임 내역:', sameBy);
console.log('품계보다 낮은 자리 제수:', down);
console.log(`게임 끝 인물 수 평균 ${(chars / games).toFixed(0)}`);
console.log(`대기 중인 2품 이상 평균 ${(idleHigh / samples).toFixed(1)}명`);
