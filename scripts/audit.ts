/** 이벤트·탄핵·결말 집계. 사용: npx tsx scripts/audit.ts [판 수] [aggr]  (aggr: 가능할 때마다 탄핵하는 공격적 플레이) */
import { newGame, PLAYABLE } from '../src/engine/setup';
import { advanceMonth, resolveEvent } from '../src/engine/turn';
import { viewEvent } from '../src/engine/events';
import { P } from '../src/engine/state';
import { runMonthly, startMemorial, TARGET_ACTIONS, actionError, runTargetAction } from '../src/engine/actions';
import type { ImpeachReport } from '../src/engine/conflict';

const runs = Number(process.argv[2] ?? 10);
const aggressive = process.argv[3] === 'aggr';
const tally: Record<string, number> = {};
const bump = (k: string, n = 1) => (tally[k] = (tally[k] ?? 0) + n);
const deaths: Record<string, number> = {};
const pImpeach: Record<string, number> = {};
const diffs: number[] = [];

for (const pl of PLAYABLE) {
  for (let r = 0; r < runs; r++) {
    const s = newGame({ kind: 'historical', id: pl.id }, 5000 + r * 7919);
    const push = s.log.push.bind(s.log);
    s.log.push = (...xs) => {
      for (const x of xs) {
        const m = x.text.match(/탄핵했다 — (.+)$/);
        if (m) bump('npc탄핵:' + m[1]);
        if (x.text.includes('사약을 받고')) bump('사약 사망(전체)');
        if (x.text.includes('옥사에 연루되어')) bump('옥사 사망(전체)');
        if (x.text.includes('위리안치되었다')) bump('위리안치(전체)');
        if (x.text.startsWith('[조정 쟁점]')) bump('쟁점(전체)');
        if (x.text.startsWith('[환국]')) bump('환국(전체)');
        if (x.text.startsWith('[인사]') && x.text.includes('거론된다')) bump('자리 경쟁(전체)');
        const tag = x.text.match(/^\[(팔도|추문|천변|환후|외척|국본)\]/);
        if (tag) bump(`[${tag[1]}]` + (tag[1] === '국본' ? ' ' + x.text.slice(5, 22) : ''));
      }
      return push(...xs);
    };
    const seenPlots = new Set<string>();
    let guard = 0;
    while (!s.over && guard++ < 400) {
      while (s.pending.length && !s.over) {
        const e = s.pending[0];
        if (e.def === 'impeached') bump('player 탄핵당함 이벤트');
        bump('ev:' + e.def + (e.def === 'notice' ? ':' + e.ctx.title : e.def === 'duty' ? ':' + e.ctx.sid : e.def === 'local' ? ':' + e.ctx.lid : ''));
        if (e.def === 'impeach_report') {
          const rep = e.ctx.report as ImpeachReport;
          if (rep.target === s.player.charId) {
            pImpeach[rep.outcome] = (pImpeach[rep.outcome] ?? 0) + 1;
            diffs.push(rep.aTotal - rep.dTotal);
          }
          if (rep.attacker === s.player.charId) bump('player공격결과:' + rep.outcome);
        }
        const v = viewEvent(s, e);
        const ok = v.choices.filter((c) => !c.disabled);
        const key = e.def === 'impeached' ? 'explain' : (ok[0] ?? v.choices[0]).key;
        resolveEvent(s, e.id, key);
      }
      if (s.over) break;
      if (aggressive) {
        const others = Object.values(s.chars).filter((c) => c.status === 'active' && c.office && c.faction !== P(s).faction);
        const t = others[(s.t * 13 + r) % Math.max(1, others.length)];
        const imp = TARGET_ACTIONS.find((a) => a.id === 'impeach')!;
        if (t && !actionError(s, imp, t) && s.player.focus?.kind !== 'memorial') {
          runTargetAction(s, 'impeach', t.id);
          bump('player가 탄핵 시도');
        }
        const friends = Object.values(s.chars).filter((c) => c.status !== 'dead' && c.status !== 'royal' && c.id !== s.player.charId);
        for (const a of ['visit'] as const) {
          const f = friends[(s.t * 7 + r + a.length) % friends.length];
          if (!actionError(s, TARGET_ACTIONS.find((x) => x.id === a)!, f)) runTargetAction(s, a, f.id);
        }
      }
      if (s.t % 6 === 0 && !s.player.focus) startMemorial(s, 'law', { lawId: 'hopae' });
      runMonthly(s, 'work');
      runMonthly(s, 'study');
      advanceMonth(s);
      for (const x of s.plots) {
        if (seenPlots.has(x.id)) continue;
        seenPlots.add(x.id);
        bump('음모 시작');
      }
    }
    const reason = s.over ? `${s.over.reason} (${1575 + Math.floor(s.over.t / 12)})` : '생존';
    const key = reason.replace(/\(\d+\)/, '').trim();
    deaths[key] = (deaths[key] ?? 0) + 1;
    bump('끝:지기·맹약', s.player.bonds.length);
    bump('끝:계승 세대', s.player.lineage.length);
    bump('끝:알아낸 바람', s.player.knownWants.length);
    bump('끝:세자=' + (s.heir ? s.chars[s.heir].name : '없음'));
    console.log(`${pl.id.padEnd(14)} r${r} ${reason} politics=${P(s).politics} rank=${P(s).rank} 의심=${Math.round(s.player.suspicion)} 왕의마음=${JSON.stringify(Object.fromEntries(Object.entries(s.king.lean).map(([k, v]) => [k, Math.round(v ?? 0)])))} 당론=${JSON.stringify(Object.fromEntries(Object.entries(s.line).map(([k, v]) => [k, Math.round(v ?? 0)])))}`);
  }
}
console.log('\n플레이어 종료 사유', deaths);
console.log('플레이어가 탄핵당한 결과', pImpeach);
const hist: Record<number, number> = {};
for (const d of diffs) hist[d] = (hist[d] ?? 0) + 1;
console.log('플레이어 탄핵 격차 분포', hist);
console.log('전체 집계', tally);

