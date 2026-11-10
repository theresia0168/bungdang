/** 무작위 행동으로 끝까지 돌려 결말 점수를 본다. 사용: npx tsx scripts/sim.ts [판 수] */
import { newGame, PLAYABLE } from '../src/engine/setup';
import { advanceMonth, resolveEvent } from '../src/engine/turn';
import { viewEvent } from '../src/engine/events';
import { computeEnding } from '../src/engine/ending';
import { P } from '../src/engine/state';
import { FACTION_META } from '../src/engine/data/meta';
import { TARGET_ACTIONS, FOCUS_INFO, runSelfAction, setFocus } from '../src/engine/actions';
import type { FocusKind } from '../src/engine/types';

const runs = Number(process.argv[2] ?? 3);
const ids = [...PLAYABLE.map((p) => p.id)];

for (const id of ids) {
  for (let r = 0; r < runs; r++) {
    const s = newGame({ kind: 'historical', id }, 1000 + r * 7919);
    let guard = 0;
    let actions = 0;
    while (!s.over && guard++ < 2000) {
      while (s.pending.length) {
        const e = s.pending[0];
        const v = viewEvent(s, e);
        const ok = v.choices.filter((c) => !c.disabled);
        const pick = ok[(s.t + guard) % ok.length] ?? v.choices[0];
        resolveEvent(s, e.id, pick.key);
        if (s.over) break;
      }
      if (s.over) break;
      // 가끔 무작위 행동
      if (s.t % 2 === 0) {
        const chars = Object.values(s.chars).filter((c) => c.status !== 'dead' && c.status !== 'royal');
        const t = chars[(s.t * 31 + r) % chars.length];
        const a = TARGET_ACTIONS[(s.t * 7) % TARGET_ACTIONS.length];
        if (!a.check(s, t)) {
          a.run(s, t);
          actions++;
        }
      }
      // 낙향해 있으면 다시 벼슬을 구하러 올라간다 (시묘·처분 중이면 저절로 막힌다)
      if (P(s).status === 'retired' && s.t % 6 === 0) runSelfAction(s, 'capital');
      if (!s.player.focus) {
        const kinds = Object.keys(FOCUS_INFO) as FocusKind[];
        setFocus(s, kinds[s.t % 5], 'sipye');
      }
      advanceMonth(s);
    }
    const p = P(s);
    const e = computeEnding(s);
    const alive = Object.values(s.chars).filter((c) => c.status !== 'dead' && c.status !== 'royal').length;
    const factions = (['dong', 'seo', 'nam', 'buk'] as const)
      .filter((f) => s.factions[f].active)
      .map((f) => FACTION_META[f].name)
      .join('/');
    console.log(
      `${id.padEnd(15)} run${r} end=${1575 + Math.floor(s.t / 12)}.${(s.t % 12) + 1} ${s.over?.reason.slice(0, 18).padEnd(18)} ` +
        `office=${(s.player.peakOffice ?? '-').padEnd(8)} prestige=${Math.round(p.prestige)} faction=${FACTION_META[p.faction].name} ` +
        `score=${e.score} chars=${alive} mods=${s.mods.length} log=${s.log.length} acts=${actions} factions=${factions} tension=${Math.round(s.tension)} flags=${['gichuk', 'geonjeo', 'daedong'].filter((k) => s.flags[k]).join(',')}`,
    );
  }
}
