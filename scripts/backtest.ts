/** 국고 백테스트: 그냥 두기 / 국방 과잉 투자 / 1580년 재정 위기 세 경우를 여러 판 돌려 평균을 본다. 사용: npx tsx scripts/backtest.ts */
import { newGame } from '../src/engine/setup';
import { advanceMonth, resolveEvent } from '../src/engine/turn';
import { viewEvent } from '../src/engine/events';
import { monthOf, yearOf, tOf } from '../src/engine/calendar';
import { TAX_REGIONS, militaryNeed, monthlySpend, warReadiness, PROJECT_DEFS } from '../src/engine/realm';
import { uid } from '../src/engine/state';
import type { RegionId } from '../src/engine/types';

type Row = Record<string, number>;
const SEEDS = 6;
function run(mode: 'idle' | 'defense' | 'crisis') {
  const rows: Record<number, Row[]> = {};
  const fin: string[] = [];
  for (let r = 0; r < SEEDS; r++) {
    const s = newGame({ kind: 'historical', id: 'yi_wonik' }, 1000 + r * 613);
    let coups = 0, wins = 0, lostFac = 0;
    while (!s.over && s.t < 26 * 12) {
      while (s.pending.length) { const e = s.pending[0]; const v = viewEvent(s, e); const ok = v.choices.filter((c) => !c.disabled); const k = (ok.find((c) => c.key === 'silent') ?? ok[0] ?? v.choices[0]).key; resolveEvent(s, e.id, k); if (s.over) break; }
      if (s.over) break;
      if (mode === 'defense' && s.t % 4 === 0 && s.t < tOf(1592, 1)) {
        const regs: RegionId[] = ['gyeongsang', 'chungcheong', 'gyeonggi', 'hanseong', 'jeolla'];
        const reg = regs[(s.t / 4) % regs.length];
        const kinds = ['fort', 'jin', 'drill', 'navy'] as const;
        const k = kinds[Math.floor(s.t / 20) % kinds.length];
        if (!PROJECT_DEFS[k].ok?.(s, reg) && s.realm.projects.length < 5) s.realm.projects.push({ id: uid(s, 'pj'), kind: k, region: reg, by: s.player.charId, left: PROJECT_DEFS[k].months, cost: PROJECT_DEFS[k].cost, started: s.t });
      }
      if (mode === 'crisis' && s.t === tOf(1580, 1)) s.realm.treasury = -500;
      const beforeFac = Object.values(s.regions).reduce((a, x) => a + x.defense.fort + x.defense.jin + x.defense.navy, 0);
      const hadCoup = !!s.realm.coup;
      advanceMonth(s);
      const afterFac = Object.values(s.regions).reduce((a, x) => a + x.defense.fort + x.defense.jin + x.defense.navy, 0);
      if (afterFac < beforeFac) lostFac += beforeFac - afterFac;
      if (hadCoup && !s.realm.coup) { coups++; if (s.log.some((e) => e.t === s.t && e.text.startsWith('[반정]'))) wins++; }
      if (monthOf(s.t) === 11 && (yearOf(s.t) - 1575) % 4 === 0) {
        const y = yearOf(s.t);
        (rows[y] ??= []).push({
          treasury: s.realm.treasury, rev: s.realm.ledger?.revenue ?? 0, spend: monthlySpend(s) * 12, milNeed: militaryNeed(s) * 12,
          hidden: (TAX_REGIONS.reduce((a, x) => a + s.regions[x].hidden, 0) / TAX_REGIONS.length) * 100,
          arable: (TAX_REGIONS.reduce((a, x) => a + s.regions[x].arable, 0) / TAX_REGIONS.length) * 100,
          ready: warReadiness(s).score, auth: s.king.mood,
        });
      }
    }
    fin.push(`seed${r}: war=${s.realm.warPath} coups=${coups}(성공 ${wins}) 허물어진 시설=${lostFac} 예산=${s.realm.budget.tax}/${s.realm.budget.army}/${s.realm.budget.royal}`);
  }
  console.log(`\n=== ${mode} (${SEEDS}판 평균) ===`);
  console.log('연도  국고  세입  지출  군유지  은결%  경작지%  전쟁대비  용안');
  for (const [y, rs] of Object.entries(rows)) {
    const avg = (k: string) => Math.round(rs.reduce((a, x) => a + x[k], 0) / rs.length);
    console.log(`${y}  ${String(avg('treasury')).padStart(5)} ${String(avg('rev')).padStart(5)} ${String(avg('spend')).padStart(5)} ${String(avg('milNeed')).padStart(6)} ${String(avg('hidden')).padStart(6)} ${String(avg('arable')).padStart(7)} ${String(avg('ready')).padStart(8)} ${String(avg('auth')).padStart(5)}`);
  }
  console.log(fin.join('\n'));
}
run('idle');
run('defense');
run('crisis');
