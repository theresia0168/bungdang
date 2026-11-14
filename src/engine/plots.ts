import type { Character, GameState, Plot } from './types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { chance, randInt } from './rng';
import { alive, atSeat, chargeable, clamp, impeachEtiquette, inCourt, isP, josa, knownFlaws, notice, officeTitle, P, people, uid } from './state';
import { opinion } from './opinion';
import { diffOf } from './diff';
import { bondWith } from './relations';
import { caseOn, openCase } from './cases';

/** 플레이어를 노리는 정적이 바로 논핵하지 않고 몇 달 동안 준비한다 */
export function startPlot(s: GameState, by: Character): boolean {
  if (bondWith(s, by.id) || s.plots.some((x) => x.by === by.id) || s.plots.length >= 2) return false;
  if (diffOf(s) === 'easy' && !chance(s, 0.6)) return false;
  const plot: Plot = { id: uid(s, 'plot'), by: by.id, due: s.t + (diffOf(s) === 'hard' ? randInt(s, 1, 3) : randInt(s, 2, 4)), known: false };
  s.plots.push(plot);
  const tip = s.player.bonds.map((b) => s.chars[b.with]).find((c) => alive(c) && inCourt(c) && c.faction === by.faction);
  if (tip) revealPlot(s, plot, `맹약을 맺은 ${josa(tip.name, '이/가')} 몰래 귀띔해 왔다`);
  return true;
}

export function revealPlot(s: GameState, plot: Plot, how: string) {
  if (plot.known) return;
  plot.known = true;
  const p = P(s);
  const by = s.chars[plot.by];
  const kf = knownFlaws(p, by.id);
  notice(
    s,
    '음모의 낌새',
    `${how}. ${by.name}(${FACTION_META[by.faction].name}, ${officeTitle(by)})${josa(by.name, '이/가').slice(by.name.length)} 당신을 논핵하려고 사람을 모으고 있다. 약 ${Math.max(1, plot.due - s.t)}개월 뒤에 움직일 듯하다.\n\n` +
      (kf.length ? `그가 쥔 당신의 흠결: ${kf.map((f) => `「${f.label}」`).join(', ')}` : '그가 쥔 당신의 흠결은 없는 듯하다.') +
      '\n\n대응할 길:\n' +
      '· 선제공격 — 먼저 그를 논핵하면 그의 계획은 무너진다.\n' +
      '· 화해 — 인물 창의 「화해 청함」 (행동력 1, 재산 10).\n' +
      '· 흠결 무마 — 그가 쥔 숨은 흠결을 「흠결 무마」로 덮는다 (행동력 1, 재산 25).\n' +
      '· 근신 — 거취의 「근신」. 이번 달 남은 행동력을 모두 쓰는 대신 그의 공격이 크게 약해진다.',
    'danger',
  );
}

/** 원한을 품은 이가 스스로 일을 꾸민다 */
function grudgePlots(s: GameState) {
  const p = P(s);
  if (p.status !== 'active' || !p.office || s.plots.length >= 2 || !chance(s, 0.09)) return;
  const foe = people(s)
    .filter((c) => !isP(s, c) && inCourt(c) && atSeat(s, c) && c.politics >= 2 && !bondWith(s, c.id) && !s.plots.some((x) => x.by === c.id) && !caseOn(s, c.id) && !impeachEtiquette(c, p, !!(c.office && OFFICE_MAP[c.office]?.samsa)))
    .filter((c) => {
      const samsa = c.office && OFFICE_MAP[c.office]?.samsa ? 1 : 0;
      const edge = c.politics + chargeable(s, p, c.id).length + samsa - p.politics - Math.floor(p.prestige / 25) - (p.favor >= 20 ? 1 : 0);
      return edge >= -2;
    })
    .map((c) => [c, opinion(s, c, p) - (c.grudges.includes(p.id) ? 20 : 0)] as const)
    .filter(([, v]) => v <= -25)
    .sort((a, b) => a[1] - b[1])[0];
  if (foe) startPlot(s, foe[0]);
}

export function tickPlots(s: GameState) {
  grudgePlots(s);
  const p = P(s);
  for (const pl of [...s.plots]) {
    const by = s.chars[pl.by];
    const drop = (why?: string) => {
      s.plots = s.plots.filter((x) => x !== pl);
      if (why && pl.known) notice(s, '음모가 꺾이다', why, 'court');
    };
    if (!alive(by) || !inCourt(by) || !atSeat(s, by)) {
      drop(by ? `${josa(by.name, '이/가')} 조정을 떠나 당신을 노리던 계획도 흐지부지되었다.` : undefined);
      continue;
    }
    if (bondWith(s, by.id) || opinion(s, by, p) > -5) {
      drop(`${josa(by.name, '이/가')} 마음을 돌려 당신을 노리던 계획을 거두었다.`);
      continue;
    }
    if (caseOn(s, by.id)) {
      drop(`${josa(by.name, '이/가')} 논핵을 당해 제 몸 지키기에 바빠졌다. 당신을 노리던 계획은 흐지부지되었다.`);
      continue;
    }
    if (!pl.known) {
      const friends = people(s).filter((c) => !isP(s, c) && inCourt(c) && c.faction === by.faction && c.id !== by.id && opinion(s, c, p) >= 40).length;
      const ch = clamp(0.15 + p.politics * 0.03 + s.player.retainers * 0.1 + Math.min(2, friends) * 0.1 + (p.traits.includes('schemer') ? 0.1 : 0), 0.05, 0.85);
      if (chance(s, ch)) {
        const how = friends ? `${FACTION_META[by.faction].name}에 있는 벗이 넌지시 알려 왔다` : s.player.retainers ? '식객이 저잣거리에서 소문을 물어 왔다' : '심상치 않은 소문이 들려온다';
        revealPlot(s, pl, how);
      }
    }
    if (s.t < pl.due) continue;
    drop();
    if (p.status !== 'active' || !p.office || caseOn(s, p.id)) continue;
    openCase(s, by, p, { bonus: pl.softened ? -2 : 1 });
  }
}

/** 근신: 알려진 음모의 기세를 꺾는다 */
export function humbleEffects(s: GameState): number {
  let n = 0;
  for (const pl of s.plots) {
    if (pl.known && !pl.softened) {
      pl.softened = true;
      n++;
    }
  }
  return n;
}

export const knownPlots = (s: GameState) => s.plots.filter((x) => x.known);
