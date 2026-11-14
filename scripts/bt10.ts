/** 10판 백테스트 한 판: npx tsx scripts/bt10.ts <인물> <시드> → JSON 한 줄 */
import { newGame } from '../src/engine/setup';
import { advanceMonth, resolveEvent } from '../src/engine/turn';
import { viewEvent } from '../src/engine/events';
import { P, people } from '../src/engine/state';
import { runMonthly, startMemorial } from '../src/engine/actions';
import { yearOf } from '../src/engine/calendar';
import { computeEnding } from '../src/engine/ending';
import { lawToPush } from '../src/engine/laws';
import { botMonth, PREF, type Profile } from './bot';
const [id, seedS, profS] = process.argv.slice(2);
const prof = (profS ?? 'passive') as Profile;
const s = newGame({ kind: 'historical', id }, Number(seedS));
const t0 = Date.now();
let overlapMonths = 0, vetoSame = 0, vetoes = 0, disabledByTrait = 0;
const traitBlock: Record<string, number> = {};
let prevLog = 0;
let rivals = 0, rivalEnds = 0, prevRival: string | undefined;
while (!s.over) {
  while (s.pending.length) {
    const e = s.pending[0]; const v = viewEvent(s, e);
    for (const c of v.choices) if (c.disabled && /성품이 허락하지/.test(c.disabled)) { disabledByTrait++; const k = c.disabled.split(' ')[0]; traitBlock[k] = (traitBlock[k] ?? 0) + 1; }
    const ok = v.choices.filter(c => !c.disabled);
    const pref = PREF[prof];
    resolveEvent(s, e.id, (ok.find(c => pref.includes(c.key)) ?? ok[0] ?? v.choices[0]).key);
    if (s.over) break;
  }
  if (s.over) break;
  const p = P(s);
  botMonth(s, prof);
  if (s.t % 12 === 5 && !s.player.focus && p.faction !== 'none') { const push = lawToPush(s, p.faction); if (push) startMemorial(s, 'law', push); }
  advanceMonth(s);
  if (s.player.rival && s.player.rival !== prevRival) rivals++;
  if (!s.player.rival && prevRival && s.flags.rivalEndAt === s.t) rivalEnds++;
  prevRival = s.player.rival;
  // 검사 1: 한 사람이 두 자리 경쟁에 동시에 거론되는가
  const ids = s.races.flatMap(r => r.candidates);
  if (ids.length !== new Set(ids).size) overlapMonths++;
  // 검사 2: 왕이 물리친 사람이 같은 달 그 자리에 제수되었는가
  const fresh = s.log.slice(prevLog);
  for (const e of fresh) {
    const m = e.text.match(/(\S+?)에 (\S+?)[을를] 의망했으나 왕이 물리치고/);
    if (!m) continue;
    vetoes++;
    // 물리친 사람이 같은 달 어느 자리에든 제수되었는가
    if (fresh.some(x => x.text.startsWith(m[2]) && x.text.includes('에 제수'))) vetoSame++;
  }
  prevLog = s.log.length;
}
const e = computeEnding(s);
const cnt = (re: RegExp) => s.log.filter(x => re.test(x.text)).length;
const live = people(s);
const traitCount: Record<string, number> = {};
for (const c of Object.values(s.chars)) for (const t of c.traits) traitCount[t] = (traitCount[t] ?? 0) + 1;
console.log(JSON.stringify({
  id, seed: seedS, prof, land: s.player.land, wealth: Math.round(P(s).wealth), impeachW: s.player.stats.impeachWins, impeachL: s.player.stats.impeachFails, marriages: s.player.stats.marriages, peakRank: s.player.peakRank, end: s.over?.reason, year: yearOf(s.t), score: e.score, gens: s.player.lineage.length + 1,
  peaks: [...s.player.lineage.map(a => a.peakOffice ?? '-'), s.player.peakOffice ?? '-'],
  hwanguk: cnt(/^\[환국\] 왕이/), oksa: cnt(/\[옥사\] 국청이 끝/), coup: cnt(/\[반정\]|\[역모\]/), minran: cnt(/^\[민란\]/), laws: cnt(/^\[국법\]/),
  gukbon: cnt(/^\[국본\].*갈렸다/),
  oksaSize: s.log.map(x => x.text.match(/국청이 끝났다\. (\d+)달 동안 (\d+)명/)).filter(Boolean).map(m => `${m![2]}명/${m![1]}달`),
  hwangukAfter: cnt(/^\[환국\] 여파/), cheongbaek: s.player.deeds.filter(d => d.includes('청백리')).length, vetoes, vetoSame, overlapMonths, disabledByTrait, traitBlock,
  traits: Object.fromEntries(['eloquent','martial','cautious','loyal','timid','arrogant','sickly'].map(t => [t, traitCount[t] ?? 0])),
  playerTraits: P(s).traits, minsim: Math.round(Object.values(s.regions).reduce((a, r) => a + r.minsim, 0) / 9), treasury: Math.round(s.realm.treasury),
  rivals, rivalEnds, achv: (s.player.achv ?? []).length, achvIds: s.player.achv, county: cnt(/^\[고을\]/), horan: s.player.deeds.filter(d => /호란|남한산성|강화도|심양/.test(d)).length,
  sec: Math.round((Date.now() - t0) / 1000),
}));
