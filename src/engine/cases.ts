import type { Case, Character, GameState } from './types';
import { chance, d6 } from './rng';
import { alive, clamp, collect, inCourt, isP, josa, log, notice, officeTitle, owe, P, people, pushEvent, uid } from './state';
import { addMod, opinion, sway, swayFaction, topOf } from './opinion';
import { impeach, kill, OUTCOME_LABEL, SUCCESS, type ImpeachReport, type RollPart } from './conflict';
import { vacate } from './court';
import { shortDate } from './calendar';
import { betray, fulfillAgainst, sworn } from './relations';

export const CASE_MONTHS = { impeach: 2, aggravate: 3 } as const;
const SIDE_CAP = 3;

export const caseOn = (s: GameState, targetId: string) => s.cases.find((c) => c.target === targetId);
export const caseById = (s: GameState, id: string) => s.cases.find((c) => c.id === id);

export function sideOf(cs: Case, id: string): 'attacker' | 'target' | 'pro' | 'con' | null {
  if (cs.attacker === id) return 'attacker';
  if (cs.target === id) return 'target';
  if (cs.pros.includes(id)) return 'pro';
  if (cs.cons.includes(id)) return 'con';
  return null;
}

/** 플레이어가 어느 편으로든 얽힌 공방 */
export const playerCases = (s: GameState) => s.cases.filter((c) => sideOf(c, s.player.charId));

export const nextLevelLabel = (c: Character) => ((c.exileLevel ?? 1) >= 2 ? '사사(賜死)' : '위리안치(圍籬安置)');

/** 논핵을 연다. 이미 그 사람을 두고 공방이 벌어지고 있으면 공격 편에 합류한다. */
export function openCase(
  s: GameState,
  atk: Character,
  tgt: Character,
  opt: { bonus?: number; byMemorial?: boolean; pros?: string[] } = {},
): Case | undefined {
  const ex = caseOn(s, tgt.id);
  if (ex) {
    if (!sideOf(ex, atk.id)) ex.pros.push(atk.id);
    return ex;
  }
  const kind = tgt.status === 'exiled' ? 'aggravate' : 'impeach';
  if (kind === 'impeach' && (tgt.status !== 'active' || !tgt.office)) return;
  const cs: Case = {
    id: uid(s, 'case'),
    kind,
    attacker: atk.id,
    target: tgt.id,
    opened: s.t,
    due: s.t + CASE_MONTHS[kind],
    pros: (opt.pros ?? []).filter((id) => id !== atk.id && id !== tgt.id),
    cons: [],
    bonus: opt.bonus ?? 0,
    byMemorial: opt.byMemorial,
  };
  s.cases.push(cs);
  const mine = isP(s, atk) || isP(s, tgt);
  if (kind === 'impeach') {
    log(s, `${josa(atk.name, '이/가')} ${officeTitle(tgt)} ${josa(tgt.name, '을/를')} 논핵하기 시작했다.`, mine ? 'player' : 'court');
  } else {
    log(s, `${josa(atk.name, '이/가')} 유배 중인 ${tgt.name}에게 ${nextLevelLabel(tgt)}의 죄를 더하라고 청했다.`, mine ? 'player' : 'court');
  }
  sway(s, tgt, atk.id, -10, '논핵', { clan: 0.3, decay: 0.2 });
  if (isP(s, tgt)) pushEvent(s, kind === 'impeach' ? 'impeached' : 'aggravated', { caseId: cs.id });
  return cs;
}

export function closeCase(s: GameState, cs: Case) {
  s.cases = s.cases.filter((c) => c.id !== cs.id);
}

/** 공방에 끼어들 만큼 마음이 기울었는가. 양수면 공격 편, 음수면 구원 편. */
function lean(s: GameState, c: Character, atk: Character, tgt: Character): number {
  const ot = opinion(s, c, tgt);
  const oa = opinion(s, c, atk);
  const party = (x: Character) => c.faction !== 'none' && x.faction === c.faction;
  const pro = -ot + oa * 0.5 + (party(atk) && !party(tgt) ? 10 : 0);
  const con = ot - oa * 0.5 + (party(tgt) && !party(atk) ? 10 : 0);
  if (pro >= 30 && pro > con) return pro;
  if (con >= 30 && con > pro) return -con;
  return 0;
}

function recruit(s: GameState, cs: Case) {
  const atk = s.chars[cs.attacker];
  const tgt = s.chars[cs.target];
  for (const c of people(s)) {
    if (isP(s, c) || sideOf(cs, c.id) || !inCourt(c) || c.location !== 'hanseong') continue;
    const l = lean(s, c, atk, tgt);
    if (!l || !chance(s, 0.15)) continue;
    if (l > 0 && cs.pros.length < 6) cs.pros.push(c.id);
    else if (l < 0 && cs.cons.length < 6) cs.cons.push(c.id);
  }
  // 신세를 진 이들이 은혜를 갚는다. 내가 몰릴 때만 저절로 나서고, 내가 공격할 때는 「연명 요청」으로 직접 청한다.
  const mySide = isP(s, tgt) ? 'cons' : isP(s, atk) ? 'pros' : null;
  if (!mySide) return;
  const paid: string[] = [];
  for (const id of mySide === 'cons' ? Object.keys(s.player.debts) : []) {
    const c = s.chars[id];
    if (!alive(c) || !inCourt(c) || sideOf(cs, id)) continue;
    collect(s, id);
    cs[mySide].push(id);
    paid.push(c.name);
  }
  if (paid.length) {
    notice(
      s,
      '은혜를 갚다',
      `당신에게 신세를 졌던 ${paid.join(', ')}${paid.length > 1 ? ' 등이' : josa(paid[0], '이/가').slice(paid[0].length)} ${mySide === 'cons' ? '구원 상소에 이름을 올렸다' : '논핵에 가세했다'}.`,
      'court',
    );
  }
  // 맹약을 맺은 이와 문인은 부르지 않아도 온다
  const friends = sworn(s, mySide === 'cons' ? 'con' : 'pro').filter((c) => !sideOf(cs, c.id));
  for (const c of friends) cs[mySide].push(c.id);
  if (friends.length) {
    const names = friends.map((c) => c.name).join(', ');
    notice(s, '벗이 나서다', `${names}${friends.length > 1 ? ' 등이' : josa(friends[0].name, '이/가').slice(friends[0].name.length)} 부르지 않았는데도 ${mySide === 'cons' ? '당신을 구원하러' : '당신의 논핵에 힘을 보태러'} 나섰다.`, 'court');
  }
}

const sidePart = (label: string, n: number): RollPart => ({ label: `${label} ${n}인`, value: Math.min(SIDE_CAP, n) });

function resolveImpeach(s: GameState, cs: Case) {
  const atk = s.chars[cs.attacker];
  const tgt = s.chars[cs.target];
  const bonus: RollPart[] = [];
  if (cs.pros.length) bonus.push(sidePart('동조', cs.pros.length));
  if (cs.bonus) bonus.push({ label: '정국', value: cs.bonus });
  if (cs.byMemorial) bonus.push({ label: '상소로 탄핵', value: -1 });
  const defBonus = cs.cons.length ? [sidePart('구원', cs.cons.length)] : [];
  const rep = impeach(s, atk, tgt, { bonus, defBonus, response: cs.response });
  const success = SUCCESS.includes(rep.outcome);
  const p = P(s);
  if (isP(s, tgt) && !success && cs.response === 'endure') p.prestige = clamp(p.prestige + 3, 0, 100);
  for (const id of cs.pros) {
    const c = s.chars[id];
    if (!alive(c)) continue;
    if (success) sway(s, tgt, id, -8, '논핵 동조', { decay: 0.15 });
    else c.favor = clamp(c.favor - 1, -100, 100);
  }
  return rep;
}

/** 유배 중인 이에게 죄를 더하자는 논의. 사사는 왕의 관용을 넘어서야 한다. */
function resolveAggravate(s: GameState, cs: Case): ImpeachReport {
  const atk = s.chars[cs.attacker];
  const tgt = s.chars[cs.target];
  const lv = tgt.exileLevel ?? 1;
  const toDeath = lv >= 2;
  const aParts: RollPart[] = [{ label: '정치력', value: atk.politics }];
  if (cs.pros.length) aParts.push(sidePart('동조', cs.pros.length));
  if (tgt.tags.includes('royalWrath')) aParts.push({ label: '왕의 진노', value: 2 });
  if (tgt.favor <= -30) aParts.push({ label: '성심 잃음', value: 1 });
  if (s.tension >= 60) aParts.push({ label: '격앙된 정국', value: 1 });
  const dParts: RollPart[] = [{ label: toDeath ? '왕의 관용 (사사)' : '왕의 관용', value: toDeath ? 5 : 2 }];
  const pr = Math.floor(tgt.prestige / 25);
  if (pr) dParts.push({ label: '명망', value: pr });
  if (cs.cons.length) dParts.push(sidePart('구원', cs.cons.length));
  if (tgt.favor >= 20) dParts.push({ label: '성심', value: 1 });
  const aRoll = d6(s);
  const dRoll = d6(s);
  const aTotal = aRoll + aParts.reduce((a, x) => a + x.value, 0);
  const dTotal = dRoll + dParts.reduce((a, x) => a + x.value, 0);
  let outcome: ImpeachReport['outcome'] = 'spared';
  if (aTotal > dTotal) outcome = toDeath ? 'sasa' : 'wiri';
  const mine = isP(s, atk) || isP(s, tgt);
  if (outcome === 'wiri') {
    tgt.exileLevel = 2;
    log(s, `${josa(tgt.name, '이/가')} 위리안치되었다. 유배지의 집 둘레에 가시울타리가 쳐졌다.`, mine ? 'player' : 'court');
    if (isP(s, tgt)) s.player.deeds.push(`${shortDate(s.t)} 위리안치`);
  } else if (outcome === 'sasa') {
    kill(s, tgt, '사약을 받고 죽었다');
    addMod(s, 'clan', tgt.clan, atk.id, '사사의 원한', -45, 0.05);
    if (tgt.faction !== 'none') swayFaction(s, tgt.faction, atk.id, -15, '동지를 죽임', 0.05);
  } else {
    atk.favor = clamp(atk.favor - 3, -100, 100);
    log(s, `${tgt.name}에게 죄를 더하자는 논의는 왕이 받아들이지 않았다.`, mine ? 'player' : 'court');
  }
  if (outcome !== 'spared') s.tension = clamp(s.tension + (outcome === 'sasa' ? 6 : 2), 0, 100);
  const text = `${josa(atk.name, '이/가')} 청한 ${tgt.name}의 가죄 — ${OUTCOME_LABEL[outcome]}`;
  return { attacker: atk.id, target: tgt.id, aParts, dParts, aRoll, dRoll, aTotal, dTotal, outcome, text };
}

export function tickCases(s: GameState) {
  for (const cs of [...s.cases]) {
    const atk = s.chars[cs.attacker];
    const tgt = s.chars[cs.target];
    const stale =
      !alive(atk) ||
      !alive(tgt) ||
      (cs.kind === 'impeach' ? tgt.status !== 'active' || !tgt.office : tgt.status !== 'exiled');
    if (stale) {
      closeCase(s, cs);
      continue;
    }
    recruit(s, cs);
    if (s.t < cs.due) continue;
    closeCase(s, cs);
    const rep = cs.kind === 'impeach' ? resolveImpeach(s, cs) : resolveAggravate(s, cs);
    const side = sideOf(cs, s.player.charId);
    const won = SUCCESS.includes(rep.outcome) || rep.outcome === 'wiri' || rep.outcome === 'sasa';
    if (won && (side === 'attacker' || side === 'pro')) fulfillAgainst(s, 'revenge', tgt.id);
    if (side && !s.over) pushEvent(s, 'impeach_report', { report: rep, kind: cs.kind });
  }
}

export function joinError(s: GameState, cs: Case, side: 'pro' | 'con'): string | null {
  const p = P(s);
  if (sideOf(cs, p.id)) return '이미 이 공방에 얽혀 있다';
  if (p.status === 'exiled') return side === 'con' ? null : '유배 중이다';
  if (!inCourt(p) || p.location !== 'hanseong') return '한성의 조정에 있어야 한다';
  if (s.player.ap < 1) return '행동력이 부족하다';
  return null;
}

/** 남의 공방에 끼어든다. 구원하면 그가 신세를 진다. */
export function joinCase(s: GameState, caseId: string, side: 'pro' | 'con'): string {
  const cs = caseById(s, caseId);
  if (!cs) return '';
  const err = joinError(s, cs, side);
  if (err) return err;
  const p = P(s);
  const atk = s.chars[cs.attacker];
  const tgt = s.chars[cs.target];
  s.player.ap -= 1;
  s.flags.joinedCase = true;
  const fx: string[] = [];
  if (side === 'pro') {
    cs.pros.push(p.id);
    const broke = betray(s, tgt);
    if (broke) fx.push('배신');
    fx.push(...sway(s, tgt, p.id, -12, '논핵 동조', { clan: 0.3, decay: 0.15 }));
    fx.push(...sway(s, atk, p.id, 6, '동조', { faction: 0.1, decay: 0.2 }));
    if (p.faction !== 'none' && topOf(tgt.faction) === topOf(p.faction)) fx.push(swayFaction(s, p.faction, p.id, -6, '동당을 공격', 0.1));
    return `${tgt.name} 논핵에 이름을 올렸다. (${fx.filter(Boolean).join(', ')})`;
  }
  cs.cons.push(p.id);
  owe(s, tgt.id);
  fx.push(...sway(s, tgt, p.id, 12, '구원', { clan: 0.3, decay: 0.1 }));
  fx.push(...sway(s, atk, p.id, -8, '구원 상소', { decay: 0.2 }));
  if (p.faction !== 'none' && atk.faction === p.faction && tgt.faction !== p.faction) fx.push(swayFaction(s, p.faction, p.id, -4, '당론을 거스름', 0.1));
  return `${josa(tgt.name, '을/를')} 구원하는 상소를 올렸다. 그가 당신에게 신세를 졌다. (${fx.filter(Boolean).join(', ')})`;
}

/** 내가 걸린 공방에서 사직하고 물러난다 */
export function withdraw(s: GameState, cs: Case) {
  const p = P(s);
  closeCase(s, cs);
  vacate(s, p, 'retired');
  p.prestige = clamp(p.prestige + 1, 0, 100);
  p.favor = clamp(p.favor - 3, -100, 100);
  // 스스로 물러나도 탄핵을 시인한 셈이다: 반년 동안 서용되지 않는다
  p.banUntil = Math.max(p.banUntil ?? 0, s.t + 6);
  s.player.deeds.push(`${shortDate(s.t)} 탄핵을 받고 사직`);
  log(s, `${josa(p.name, '이/가')} ${s.chars[cs.attacker].name}의 논핵을 받고 스스로 물러났다.`, 'player');
}
