import { newGame } from '../src/engine/setup';
import { advanceMonth, resolveEvent } from '../src/engine/turn';
import { viewEvent } from '../src/engine/events';
import { computeEnding } from '../src/engine/ending';
import { P } from '../src/engine/state';
import { TARGET_ACTIONS, setFocus } from '../src/engine/actions';
import { holderOf } from '../src/engine/court';

const id = process.argv[2] ?? 'yi_wonik';
const runs = Number(process.argv[3] ?? 3);

for (let r = 0; r < runs; r++) {
  const s = newGame({ kind: 'historical', id }, 4242 + r * 101);
  let impeachSeen = 0;
  while (!s.over) {
    while (s.pending.length) {
      const e = s.pending[0];
      if (e.def === 'impeached') impeachSeen++;
      const v = viewEvent(s, e);
      const ok = v.choices.filter((c) => !c.disabled);
      resolveEvent(s, e.id, (ok[0] ?? v.choices[0]).key);
      if (s.over) break;
    }
    if (s.over) break;
    const p = P(s);
    const want = p.status === 'active' ? 'duty' : 'study';
    if (!s.player.focus || s.player.focus.kind !== want) setFocus(s, want);
    for (const officeId of ['ijo', 'jeonrang']) {
      const h = holderOf(s, officeId);
      if (!h) continue;
      for (const aid of ['visit', 'letter'] as const) {
        const a = TARGET_ACTIONS.find((x) => x.id === aid)!;
        if (!a.check(s, h)) a.run(s, h);
      }
    }
    if (p.status === 'retired') s.player.focus = null;
    advanceMonth(s);
  }
  const p = P(s);
  console.log(`\n=== ${id} run${r}: ${s.over?.reason} @ ${1575 + Math.floor(s.t / 12)} | score ${computeEnding(s).score} | prestige ${Math.round(p.prestige)} | impeached ${impeachSeen}x | flaws ${p.flaws.length}`);
  console.log(s.player.deeds.join('\n'));
}
