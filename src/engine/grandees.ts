import type { Character, GameState, Grandee } from './types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { chance, pick, randInt, weighted } from './rng';
import { alive, atSeat, clamp, inCourt, isP, josa, log, notice, officeTitle, P, people } from './state';
import { inLaws, opinion, sway, topOf } from './opinion';
import { members } from './factions';
import { caseOn } from './cases';
import { startPlot } from './plots';
import { npcOpen } from './npc';
import { rivalOf } from './rival';

/* ───────── 거물(巨物) ─────────
 * 조정을 움직이는 큰 인물 몇몇(당 영수, 정승, 숙적, 나의 원수)만 제 뜻을 품고 움직인다.
 * 나머지 대다수는 지금처럼 확률로 움직인다. 거물은 목표를 하나 정해 여러 달에 걸쳐 한 걸음씩 나아간다:
 *   자리: 제 사람을 요직에 밀어 올린다 / 끌어내리기: 정적의 흠을 캐고 대간을 모아 친다
 *   혼맥: 다른 큰 집안과 사돈을 맺는다 / 성심: 임금의 마음을 얻는다
 */


const MAX = 12;
/** 동시에 남을 끌어내리려는 거물은 셋까지 (논핵이 넘치지 않게) */
const MAX_TOPPLE = 2;

const isSamsa = (c: Character) => !!(c.office && OFFICE_MAP[c.office]?.samsa);
const live = (c?: Character): c is Character => !!c && alive(c) && inCourt(c) && (c.status === 'active' || c.status === 'idle');

/** 반년마다 거물을 다시 꼽는다 */
function refresh(s: GameState) {
  const p = P(s);
  const pick: Character[] = [];
  const add = (c?: Character) => {
    if (live(c) && !isP(s, c) && !pick.includes(c) && pick.length < MAX) pick.push(c);
  };
  for (const f of Object.values(s.factions)) if (f.active) add(s.chars[f.leader ?? '']);
  for (const c of people(s)) if (c.status === 'active' && c.rank <= 1 && c.office && OFFICE_MAP[c.office]) add(c);
  add(rivalOf(s));
  if (alive(p))
    people(s)
      .filter((c) => c.rank <= 3 && live(c) && opinion(s, c, p) <= -40)
      .sort((a, b) => opinion(s, a, p) - opinion(s, b, p))
      .slice(0, 3)
      .forEach(add);
  const old = s.grandees ?? {};
  const next: Record<string, Grandee> = {};
  for (const c of pick) next[c.id] = old[c.id] ?? newGoal(s, c);
  s.grandees = next;
}

/** 거물이 품을 뜻을 정한다 */
function newGoal(s: GameState, g: Character): Grandee {
  const p = P(s);
  const toppling = Object.values(s.grandees ?? {}).filter((x) => x.goal === 'topple').length;
  const foe = foeOf(s, g);
  const ally = protegeOf(s, g);
  const mate = mateOf(s, g);
  const opts: [Grandee, number][] = [];
  if (foe && toppling < MAX_TOPPLE) opts.push([{ goal: 'topple', target: foe.id, step: 0, since: s.t }, foe.id === p.id ? 1.5 : 3]);
  if (ally) opts.push([{ goal: 'place', target: ally.id, step: 0, since: s.t }, 2.5]);
  if (mate) opts.push([{ goal: 'marry', target: mate.id, step: 0, since: s.t }, 1.2]);
  opts.push([{ goal: 'favor', step: 0, since: s.t }, g.favor < 20 ? 2 : 0.5]);
  return weighted(s, opts) ?? { goal: 'favor', step: 0, since: s.t };
}

/** 끌어내리고 싶은 정적: 다른 당의 당상관 가운데 가장 미운 이 */
function foeOf(s: GameState, g: Character): Character | undefined {
  return people(s)
    .filter((c) => c.id !== g.id && c.status === 'active' && c.office && OFFICE_MAP[c.office] && c.rank <= 3 && c.faction !== 'none' && topOf(c.faction) !== topOf(g.faction))
    .map((c) => [c, opinion(s, g, c) - (g.grudges.includes(c.id) ? 20 : 0)] as const)
    .filter(([, v]) => v <= -20)
    .sort((a, b) => a[1] - b[1])[0]?.[0];
}

/** 밀어 올릴 제 사람: 같은 당에서 아끼는 젊은 관원 */
function protegeOf(s: GameState, g: Character): Character | undefined {
  if (g.faction === 'none') return undefined;
  return members(s, g.faction)
    .filter((c) => c.id !== g.id && c.status === 'active' && c.rank >= 3 && c.rank <= 6 && !isP(s, c))
    .sort((a, b) => opinion(s, g, b) + b.politics - (opinion(s, g, a) + a.politics))
    .find((c) => opinion(s, g, c) >= 5);
}

/** 사돈 맺을 만한 큰 집안 (같은 뿌리의 당, 아직 혼맥이 없는 집안. 플레이어 집안은 빼고) */
function mateOf(s: GameState, g: Character): Character | undefined {
  const p = P(s);
  return people(s)
    .filter((c) => c.clan !== g.clan && c.clan !== p.clan && c.rank <= 3 && inCourt(c) && c.faction !== 'none' && topOf(c.faction) === topOf(g.faction) && !inLaws(s, g.clan, c.clan))
    .sort((a, b) => a.rank - b.rank || b.prestige - a.prestige)[0];
}

/** 매달: 거물이 한 걸음씩 움직인다 */
export function tickGrandees(s: GameState) {
  if (s.t % 6 === 0 || !s.grandees) refresh(s);
  const p = P(s);
  for (const [id, gr] of Object.entries(s.grandees ?? {})) {
    const g = s.chars[id];
    if (!live(g)) {
      delete s.grandees![id];
      continue;
    }
    // 두 해가 지나도 이루지 못한 뜻은 접는다
    if (s.t - gr.since > 24) {
      s.grandees![id] = newGoal(s, g);
      continue;
    }
    if (!chance(s, 0.2)) continue;
    const done = step(s, g, gr, p);
    if (done) s.grandees![id] = { ...newGoal(s, g), since: s.t + randInt(s, 2, 6) };
  }
}

/** 한 걸음 나아간다. 뜻을 이루었거나 접으면 true */
function step(s: GameState, g: Character, gr: Grandee, p: Character): boolean {
  const t = gr.target ? s.chars[gr.target] : undefined;
  const mine = (c?: Character) => !!c && (isP(s, c) || (p.faction !== 'none' && topOf(c.faction) === topOf(p.faction)));
  switch (gr.goal) {
    case 'topple': {
      if (!t || !alive(t) || t.status !== 'active' || caseOn(s, t.id) || !atSeat(s, g)) return true;
      if (gr.step === 0) {
        // 사람을 풀어 흠을 캔다
        const hid = t.flaws.filter((f) => !f.public && !f.knownBy.includes(g.id));
        if (hid.length) pick(s, hid).knownBy.push(g.id);
        if (isP(s, t) && chance(s, 0.4)) notice(s, '거물의 눈길', `${officeTitle(g)} ${josa(g.name, '이/가')} 사람을 풀어 당신의 뒤를 캔다는 말이 들린다.`, 'danger');
        gr.step = 1;
        return false;
      }
      if (gr.step === 1) {
        // 같은 당 대간들을 불러 술을 먹이고 마음을 모은다
        for (const c of people(s).filter((c) => isSamsa(c) && c.faction === g.faction && !isP(s, c)).slice(0, 3)) sway(s, c, g.id, 6, '거물의 부름', { decay: 0.1 });
        gr.step = 2;
        if (mine(t)) log(s, `[거물] ${officeTitle(g)} ${josa(g.name, '이/가')} 대간들을 불러 모은다. ${t.name}을 겨눈다는 말이 돈다.`, 'court');
        return false;
      }
      // 친다: 플레이어면 음모로, 아니면 (대신이면 대간을 시켜) 논핵한다
      if (isP(s, t)) startPlot(s, g);
      else npcOpen(s, g, t, { bonus: 1 });
      return true;
    }
    case 'place': {
      if (!t || !alive(t) || t.status !== 'active' || t.faction !== g.faction) return true;
      if (t.rank <= 2 || gr.step >= 3) {
        if (t.rank <= 2 && mine(t)) log(s, `[거물] ${josa(g.name, '이/가')} 밀어 올린 ${josa(t.name, '이/가')} 당상의 높은 자리에 이르렀다.`, 'court');
        return true;
      }
      // 자리 경쟁에 나서 있으면 지지하고, 아니면 이조에 천거를 넣는다
      const race = s.races.find((r) => r.candidates.includes(t.id));
      if (race) {
        if (!race.backers[t.id].includes(g.id)) race.backers[t.id].push(g.id);
      } else s.recs[t.id] = Math.max(s.recs[t.id] ?? 0, s.t + 6);
      sway(s, t, g.id, 5, '밀어 줌', { decay: 0.05 });
      if (gr.step === 0 && (mine(t) || mine(g))) log(s, `[거물] ${officeTitle(g)} ${josa(g.name, '이/가')} ${officeTitle(t)} ${josa(t.name, '을/를')} 요직에 밀어 올리려 한다.`, 'court');
      gr.step++;
      return false;
    }
    case 'marry': {
      if (!t || !alive(t) || inLaws(s, g.clan, t.clan)) return true;
      s.marriages.push({ a: g.clan, b: t.clan, t: s.t });
      log(s, `[혼맥] ${FACTION_META[g.faction].name}의 ${g.clan} ${josa(g.name, '이/가')} ${t.clan} ${t.name}의 집안과 사돈을 맺었다.`, 'court');
      return true;
    }
    case 'favor': {
      // 경연에 부지런히 나가고, 진상을 올리고, 임금의 뜻을 받든다
      g.favor = clamp(g.favor + 3, -100, 100);
      gr.step++;
      return gr.step >= 3 || g.favor >= 40;
    }
  }
}

/** 화면에 보일 거물들의 움직임 (소문으로 들리는 만큼) */
export function grandeeRumors(s: GameState): { id: string; text: string; danger: boolean }[] {
  const p = P(s);
  const out: { id: string; text: string; danger: boolean; w: number }[] = [];
  for (const [id, gr] of Object.entries(s.grandees ?? {})) {
    const g = s.chars[id];
    if (!live(g)) continue;
    const t = gr.target ? s.chars[gr.target] : undefined;
    const near = p.faction !== 'none' && topOf(g.faction) === topOf(p.faction);
    let text = '';
    let w = 0;
    if (gr.goal === 'topple' && t) {
      text = isP(s, t) ? '당신을 끌어내리려 한다' : `${officeTitle(t)} ${josa(t.name, '을/를')} 끌어내리려 한다`;
      w = isP(s, t) ? 10 : near || topOf(t.faction) === topOf(p.faction) ? 5 : 2;
    } else if (gr.goal === 'place' && t) {
      text = `${officeTitle(t)} ${josa(t.name, '을/를')} 요직에 밀어 올리려 한다`;
      w = near ? 3 : 2;
    } else if (gr.goal === 'marry' && t) {
      text = `${josa(t.clan, '과/와')} 사돈을 맺으려 한다`;
      w = 1;
    } else {
      text = '임금의 마음을 얻으려 애쓴다';
      w = 0.5;
    }
    out.push({ id, text, danger: gr.goal === 'topple' && !!t && (isP(s, t) || topOf(t.faction) === topOf(p.faction)), w });
  }
  return out.sort((a, b) => b.w - a.w).slice(0, 4);
}
