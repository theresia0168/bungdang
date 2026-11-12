/** 인물별 한 판 백테스트: 그럴듯한 정책으로 끝까지 돌리고 행장과 주요 사건을 뽑는다. 사용: npx tsx scripts/story.ts */
import { newGame, PLAYABLE } from '../src/engine/setup';
import { advanceMonth, resolveEvent } from '../src/engine/turn';
import { viewEvent } from '../src/engine/events';
import { computeEnding } from '../src/engine/ending';
import { P } from '../src/engine/state';
import { MONTHLY, runMonthly, runSelfAction, startMemorial } from '../src/engine/actions';
import { FACTION_META } from '../src/engine/data/meta';
import { warReadiness } from '../src/engine/realm';
import { yearOf, monthOf } from '../src/engine/calendar';
import { lawToPush } from '../src/engine/laws';

for (const pc of PLAYABLE) {
  const s = newGame({ kind: 'historical', id: pc.id }, 20261113);
  const start = { ...P(s) };
  const hits: string[] = [];
  let ready1591 = 0;
  while (!s.over) {
    while (s.pending.length) {
      const e = s.pending[0];
      const v = viewEvent(s, e);
      const ok = v.choices.filter((c) => !c.disabled);
      // 정책: 대체로 첫 선택지(정석), 공신·호종·의병은 받아들이고, 반정·괘서 같은 극단은 피한다
      const pref = ['follow', 'accept', 'explain', 'yes', 'silent', 'calm', 'obey', 'king', 'hold'];
      const k = (ok.find((c) => pref.includes(c.key)) ?? ok[0] ?? v.choices[0]).key;
      resolveEvent(s, e.id, k);
      if (s.over) break;
    }
    if (s.over) break;
    const p = P(s);
    // 이달의 행동: 관직이면 업무, 낙향이면 강학, 남으면 학문
    runMonthly(s, p.status === 'active' ? 'work' : p.status === 'retired' ? 'teach' : 'study');
    runMonthly(s, 'study');
    if (p.wealth > 60) runMonthly(s, 'buy_land');
    if (p.status === 'retired' && s.t % 6 === 0) runSelfAction(s, 'capital');
    // 1년에 한 번쯤 당론에 맞는 변법 상소
    if (s.t % 12 === 5 && !s.player.focus && p.faction !== 'none') {
      const push = lawToPush(s, p.faction);
      if (push) startMemorial(s, 'law', push);
    }
    if (yearOf(s.t) === 1591 && monthOf(s.t) === 12) ready1591 = warReadiness(s).score;
    advanceMonth(s);
  }
  const p = P(s);
  const e = computeEnding(s);
  const mine = s.log.filter((x) => x.kind === 'player').map((x) => `${yearOf(x.t)} ${x.text}`);
  const pick = (re: RegExp, n = 4) => mine.filter((x) => re.test(x)).slice(0, n);
  const big = s.log.filter((x) => /\[반정\]|\[역모\]|\[옥사\] 국청이 끝|\[탕평\]|임진왜란:|\[국법\].*(시행|폐지)되었다/.test(x.text)).map((x) => `${yearOf(x.t)} ${x.text.slice(0, 70)}`);
  console.log(`\n████ ${pc.name} (${FACTION_META[start.faction].name}, ${1575 - start.born}세 시작) ████`);
  console.log(`결말: ${s.over?.reason} @${yearOf(s.t)}.${monthOf(s.t)} · 점수 ${e.score} · 최고 관직 ${s.player.peakOffice ?? '-'} · 명망 ${Math.round(p.prestige)} · 정치/학식 ${p.politics}/${p.learning} · 당 ${FACTION_META[p.faction].name} · 재산 ${Math.round(p.wealth)} · 전장 ${s.player.land}결`);
  if (s.player.lineage.length) console.log(`선대: ${s.player.lineage.map((a) => `${a.name} ${1575 + Math.floor(a.died / 12)}년 ${a.cause}`).join(' / ')}`);
  const exams = s.log.filter((x) => x.kind === 'player' && /(식년시|별시)에 (급제|장원)/.test(x.text)).length;
  const minsim = Math.round(Object.values(s.regions).reduce((a, r) => a + r.minsim, 0) / 9);
  console.log(`가문: ${s.player.lineage.length + 1}대 · 과거 급제 ${exams}번 · 선대 최고 관직 ${s.player.lineage.map((a) => a.peakOffice ?? '-').join('/')} · 1821 민심 평균 ${minsim}`);
  console.log(`통계: 유배 ${s.player.stats.exiled} · 탄핵 승/패 ${s.player.stats.impeachWins}/${s.player.stats.impeachFails} · 상소 ${s.player.stats.memorials} · 혼인 ${s.player.stats.marriages} · 이룬 뜻 ${s.player.goalsDone.length}`);
  const imp = pick(/논핵하기 시작|탄핵|유배|파직/, 5);
  if (imp.length) console.log(`공방: ${imp.join(' | ')}`);
  console.log(`정국: 1591 전쟁대비 ${ready1591} · 전황 ${s.realm.warPath ?? '-'} · 국고 ${Math.round(s.realm.treasury)} · 시행 법 ${Object.entries(s.laws).filter(([, v]) => v.on).map(([k]) => k).join(',')}`);
  if (big.length) console.log(`큰 사건: ${big.slice(0, 8).join(' | ')}`);
}
