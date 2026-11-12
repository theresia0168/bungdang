/** 1575~1821년 한 판을 끝까지 돌려 세대·붕당·왕대·인구·성능을 본다. 사용: npx tsx scripts/long.ts [인물 id] [시드] */
import { newGame } from '../src/engine/setup';
import { advanceMonth, resolveEvent } from '../src/engine/turn';
import { viewEvent } from '../src/engine/events';
import { P, people } from '../src/engine/state';
import { runMonthly, runSelfAction, startMemorial } from '../src/engine/actions';
import { FACTION_META } from '../src/engine/data/meta';
import { yearOf } from '../src/engine/calendar';
import { activeFactions, powerShare } from '../src/engine/factions';
import { computeEnding } from '../src/engine/ending';
import { lawToPush } from '../src/engine/laws';

const id = process.argv[2] ?? 'yu_seongryong';
const seed = Number(process.argv[3] ?? 99);
const s = newGame({ kind: 'historical', id }, seed);
const t0 = Date.now();
let lastY = 0;
while (!s.over) {
  while (s.pending.length) {
    const e = s.pending[0];
    const v = viewEvent(s, e);
    const ok = v.choices.filter((c) => !c.disabled);
    const pref = ['follow', 'accept', 'explain', 'yes', 'silent', 'calm', 'obey', 'king', 'hold', 'sit', 'take'];
    resolveEvent(s, e.id, (ok.find((c) => pref.includes(c.key)) ?? ok[0] ?? v.choices[0]).key);
    if (s.over) break;
  }
  if (s.over) break;
  const p = P(s);
  runMonthly(s, p.status === 'active' ? 'work' : p.status === 'retired' ? 'teach' : 'study');
  runMonthly(s, 'study');
  if (p.wealth > 60) runMonthly(s, 'buy_land');
  if (p.status === 'retired' && s.t % 6 === 0) runSelfAction(s, 'capital');
  if (s.t % 12 === 5 && !s.player.focus && p.faction !== 'none') {
    const push = lawToPush(s, p.faction);
    if (push) startMemorial(s, 'law', push);
  }
  advanceMonth(s);
  const y = yearOf(s.t);
  if (y % 25 === 0 && y !== lastY && s.t % 12 === 0) {
    lastY = y;
    const live = people(s);
    const share = powerShare(s);
    console.log(
      `${y} | ${P(s).name}(${yearOf(s.t) - P(s).born}세, ${P(s).office ?? P(s).status}) | 인물 ${live.length}명(조정 ${live.filter((c) => c.status === 'active').length}) 전체 ${Object.keys(s.chars).length} | ` +
        activeFactions(s).map((f) => `${FACTION_META[f].name} ${Math.round((share[f] ?? 0) * 100)}%/${live.filter((c) => c.faction === f).length}명`).join(' ') + ` 이판 ${FACTION_META[(Object.values(s.chars).find((c) => c.office === 'ijo' && c.status === 'active')?.faction) ?? 'none'].short}` +
        ` | 국고 ${Math.round(s.realm.treasury)} 용안 ${Math.round(s.king.mood)} 긴장 ${Math.round(s.tension)} | mods ${s.mods.length} | ${Math.round((Date.now() - t0) / 1000)}s`,
    );
  }
}
const e = computeEnding(s);
console.log(`끝: ${s.over?.reason} ${yearOf(s.t)} · 점수 ${e.score} · 세대 ${s.player.lineage.length + 1} · ${Math.round((Date.now() - t0) / 1000)}s`);
console.log('선대:', s.player.lineage.map((a) => `${a.name}(${a.peakOffice ?? '-'})`).join(' → '));

const cnt = (re: RegExp) => s.log.filter((e) => re.test(e.text)).length;
console.log(`횟수: 옥사 ${cnt(/\[옥사\] 국청이 끝/)} · 환국 ${cnt(/^\[환국\]/)} · 반정 시도 ${cnt(/\[반정\]|\[역모\]/)} · 탕평 인사 ${cnt(/^\[탕평\]/)} · 민란 ${cnt(/^\[민란\]/)} · 변법 ${cnt(/^\[국법\]/)} · 영수 승계 ${cnt(/영수가 되었다/)} · 시행 중인 법 ${Object.entries(s.laws).filter(([, v]) => v.on).map(([k]) => k).join(',')}`);
console.log('저장 크기', Math.round(JSON.stringify(s).length / 1024), 'KB, 연대기', s.log.length, '줄');
const keys = ['[국본]', '[국왕]', '[반정]', '호란]', '예송', '환국', '[붕당]', '탕평', '임오화변', '세도', '[민란]', '[옥사]', '[국법]', '과거', '급제', '장원'];
for (const e of s.log) if (keys.some((k) => e.text.includes(k))) console.log(`  ${yearOf(e.t)} ${e.text.slice(0, 90)}`);
