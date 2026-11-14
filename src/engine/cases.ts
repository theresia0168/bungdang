import type { Case, Character, GameState } from './types';
import { chance, d6 } from './rng';
import { addFlaw, alive, atSeat, clamp, collect, impeachEtiquette, inCourt, isP, josa, log, notice, officeTitle, owe, P, people, pushEvent, seatName, uid } from './state';
import { activeFactions, members } from './factions';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import type { EventDef } from './events/types';
import { addMod, opinion, sway, swayFaction, topOf } from './opinion';
import { impeach, kill, OUTCOME_LABEL, statParts, statPower, SUCCESS, type ImpeachReport, type RollPart } from './conflict';
import { vacate } from './court';
import { shortDate } from './calendar';
import { betray, fulfillAgainst, sworn } from './relations';

export const CASE_MONTHS = { impeach: 2, aggravate: 3 } as const;
const SIDE_CAP = 3;

export const caseOn = (s: GameState, targetId: string) => s.cases.find((c) => c.target === targetId);
export const caseById = (s: GameState, id: string) => s.cases.find((c) => c.id === id);

export function sideOf(cs: Case, id: string): 'attacker' | 'target' | 'pro' | 'con' | null {
  if (cs.attacker === id || cs.backer === id) return 'attacker';
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
  opt: { bonus?: number; byMemorial?: boolean; pros?: string[]; backer?: string } = {},
): Case | undefined {
  const ex = caseOn(s, tgt.id);
  if (ex) {
    if (!sideOf(ex, atk.id)) ex.pros.push(atk.id);
    return ex;
  }
  const kind = tgt.status === 'exiled' ? 'aggravate' : 'impeach';
  // 관직에 있든, 물러나 있든(보직 대기·낙향) 논핵할 수 있다. 물러난 이에게는 삭탈관직·문외출송·유배를 청한다
  if (kind === 'impeach' && !['active', 'idle', 'retired'].includes(tgt.status)) return;
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
    backer: opt.backer,
    offOffice: kind === 'impeach' && (tgt.status !== 'active' || !tgt.office) ? true : undefined,
  };
  s.cases.push(cs);
  s.flags[`caseOn_${tgt.id}`] = s.t;
  const mine = isP(s, atk) || isP(s, tgt);
  if (kind === 'impeach') {
    const who = tgt.status === 'active' && tgt.office ? officeTitle(tgt) : tgt.status === 'retired' ? '물러나 있는' : '전직';
    log(s, `${josa(atk.name, '이/가')} ${who} ${josa(tgt.name, '을/를')} 논핵하기 시작했다.`, mine ? 'player' : 'court');
  } else {
    log(s, `${josa(atk.name, '이/가')} 유배 중인 ${tgt.name}에게 ${nextLevelLabel(tgt)}의 죄를 더하라고 청했다.`, mine ? 'player' : 'court');
  }
  sway(s, tgt, atk.id, -10, '논핵', { clan: 0.3, decay: 0.2 });
  if (isP(s, tgt)) pushEvent(s, kind === 'impeach' ? 'impeached' : 'aggravated', { caseId: cs.id });
  return cs;
}

/* ───────── 대간 사주 ─────────
 * 중량급 대신은 몸소 논핵하지 않는다. 같은 당의 가까운 대간에게 흠을 넘겨주고 논핵하게 한 뒤 뒤에서 힘을 싣는다.
 * 일이 틀어지면 「대간을 사주했다」는 말이 새어 나온다.
 */

const isSamsaC = (c: Character) => !!(c.office && OFFICE_MAP[c.office]?.samsa);

/** 대신이 몸소 나서지 않고 대간을 부리는가 */
export const usesProxy = (c: Character) => c.rank <= 3 && !isSamsaC(c);

/** 배후의 뜻을 받아 논핵할 대간을 고른다 (없으면 undefined). withPlayer면 대간인 플레이어도 후보다 */
export function proxyFor(s: GameState, backer: Character, tgt: Character, withPlayer = false): Character | undefined {
  if (backer.faction === 'none') return undefined;
  const mine = isP(s, backer);
  const pool = people(s).filter((c) => {
    if (c.id === backer.id || c.id === tgt.id || c.status !== 'active' || !isSamsaC(c) || !atSeat(s, c)) return false;
    if (isP(s, c) && !withPlayer) return false;
    if (topOf(c.faction) !== topOf(backer.faction) || c.faction === 'none') return false;
    if (s.cases.some((x) => x.attacker === c.id) || caseOn(s, c.id)) return false;
    // 플레이어가 부리려면 신세를 졌거나 가까워야 한다
    if (mine) return (s.player.debts[c.id] ?? 0) > 0 || opinion(s, c, backer) >= 15;
    return isP(s, c) || opinion(s, c, backer) >= 5;
  });
  const score = (c: Character) => opinion(s, c, backer) - opinion(s, c, tgt) / 2 + statPower(c) * 2 + (mine && s.player.debts[c.id] ? 30 : 0) + (isP(s, c) ? 5 : 0);
  return pool.sort((a, b) => score(b) - score(a))[0];
}

/** 대간을 시켜 논핵을 연다. 배후가 아는 흠을 대간에게 넘겨준다 */
export function openByProxy(s: GameState, backer: Character, proxy: Character, tgt: Character, opt: { bonus?: number } = {}): Case | undefined {
  for (const f of tgt.flaws) if (!f.public && f.knownBy.includes(backer.id) && !f.knownBy.includes(proxy.id)) f.knownBy.push(proxy.id);
  const cs = openCase(s, proxy, tgt, { bonus: opt.bonus, backer: backer.id });
  if (cs) {
    const mine = isP(s, backer) || isP(s, proxy);
    if (mine || isP(s, tgt)) log(s, `[사주] ${josa(proxy.name, '이/가')} 앞장섰지만, 뒤에는 ${officeTitle(backer)} ${josa(backer.name, '이/가')} 있다${isP(s, tgt) ? '는 말이 들린다' : ''}.`, 'player');
  }
  return cs;
}

/** 판정이 난 뒤: 일이 틀어질수록 사주가 드러나기 쉽다 */
function exposeBacker(s: GameState, cs: Case, rep: ImpeachReport) {
  if (!cs.backer) return;
  const b = s.chars[cs.backer];
  const tgt = s.chars[cs.target];
  if (!alive(b)) return;
  const bad = rep.outcome === 'severe_backfire' ? 0.6 : rep.outcome === 'backfire' ? 0.4 : rep.outcome === 'rejected' || rep.outcome === 'shielded' ? 0.2 : 0.08;
  if (!chance(s, bad)) return;
  addFlaw(s, b, '대간 사주', true);
  b.favor = clamp(b.favor - 4, -100, 100);
  b.prestige = clamp(b.prestige - 2, 0, 100);
  if (alive(tgt)) sway(s, tgt, b.id, -15, '대간을 사주함', { clan: 0.3, decay: 0.1 });
  const mine = isP(s, b);
  log(s, `[사주] ${tgt?.name ?? ''} 논핵의 배후에 ${josa(b.name, '이/가')} 있었다는 말이 퍼졌다. 「대신이 대간을 부려 사사로운 원한을 갚는다」는 비난이 인다.`, mine || isP(s, tgt) ? 'player' : 'court');
  if (mine) notice(s, '사주가 드러나다', `${tgt?.name ?? ''} 논핵을 대간에게 시킨 것이 드러났다. (드러난 흠 「대간 사주」, 성심 −4, 명망 −2)`, 'danger');
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
    if (isP(s, c) || sideOf(cs, c.id) || !inCourt(c) || !atSeat(s, c)) continue;
    const l = lean(s, c, atk, tgt);
    // 수완 있는 이는 마음이 기운 사람들을 실제로 움직여 끌어온다
    if (!l || !chance(s, 0.09 + (l > 0 ? atk : tgt).politics * 0.015)) continue;
    if (l > 0 && cs.pros.length < 6) cs.pros.push(c.id);
    else if (l < 0 && cs.cons.length < 6) cs.cons.push(c.id);
  }
  // 신세를 진 이들이 은혜를 갚는다. 내가 몰릴 때만 저절로 나서고, 내가 공격할 때는 「연명·구원 요청」으로 직접 청한다.
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

/** 거물을 칠수록 연명의 무게가 커진다: 정승 1.5씩 6까지, 당상관 1.25씩 4.5까지, 그 아래 1씩 3까지 */
export function prosWeight(tgt: Character): { per: number; cap: number } {
  return tgt.rank <= 1 ? { per: 1.5, cap: 6 } : tgt.rank <= 3 ? { per: 1.25, cap: 4.5 } : { per: 1, cap: SIDE_CAP };
}
const prosPart = (n: number, tgt: Character): RollPart => {
  const w = prosWeight(tgt);
  return { label: `동조 ${n}인${w.per > 1 ? ' (거물 탄핵)' : ''}`, value: Math.round(Math.min(w.cap, n * w.per) * 2) / 2 };
};

function resolveImpeach(s: GameState, cs: Case) {
  const atk = s.chars[cs.attacker];
  const tgt = s.chars[cs.target];
  const bonus: RollPart[] = [];
  if (cs.pros.length) bonus.push(prosPart(cs.pros.length, tgt));
  if (cs.bonus) bonus.push({ label: '정국', value: cs.bonus });
  if (cs.byMemorial) bonus.push({ label: '상소로 탄핵', value: -1 });
  const hap = hapgyeOf(s, cs);
  if (hap) bonus.push({ label: hap >= 3 ? '삼사 합계' : '양사 합계', value: hap >= 3 ? 3 : 1 });
  const defBonus = cs.cons.length ? [sidePart('구원', cs.cons.length)] : [];
  if (cs.resigned) defBonus.push({ label: '스스로 물러남', value: 1 });
  const backer = cs.backer ? s.chars[cs.backer] : undefined;
  if (alive(backer)) bonus.push({ label: `배후의 ${officeTitle(backer)} ${backer.name}`, value: backer.rank <= 1 ? 2 : 1 });
  const rep = impeach(s, atk, tgt, { bonus, defBonus, response: cs.response, hapgye: hap, charges: cs.charges, pungmun: cs.pungmun });
  exposeBacker(s, cs, rep);
  const success = SUCCESS.includes(rep.outcome);
  if (rep.outcome === 'rejected' || rep.outcome === 'shielded') pihyeom(s, cs, rep);
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
  // 가죄는 거듭 올리는 상소의 글과 막후의 힘이 반씩이다
  const aParts: RollPart[] = statParts(atk, 0.5, '가죄 상소', '막후');
  if (cs.pros.length) aParts.push(prosPart(cs.pros.length, tgt));
  const hap = hapgyeOf(s, cs);
  if (hap) aParts.push({ label: hap >= 3 ? '삼사 합계' : '양사 합계', value: hap >= 3 ? 3 : 1 });
  // 한 번에 안 되면 날마다 거듭 청한다: 물리칠수록 상소가 거세진다
  const tries = Number(s.flags[`aggTry_${tgt.id}`] ?? 0);
  if (tries) aParts.push({ label: `거듭된 청 (${tries}번째 물리친 뒤)`, value: Math.min(3, tries) });
  if (tgt.tags.includes('royalWrath')) aParts.push({ label: '왕의 진노', value: 2 });
  if (tgt.favor <= -30) aParts.push({ label: '성심 잃음', value: 1 });
  if (s.tension >= 60) aParts.push({ label: '격앙된 정국', value: 1 });
  const dParts: RollPart[] = [{ label: toDeath ? '왕의 관용 (사사)' : '왕의 관용', value: toDeath ? 5 : 2 }];
  const pr = Math.floor(tgt.prestige / 25);
  if (pr) dParts.push({ label: '명망', value: pr });
  if (cs.cons.length) dParts.push(sidePart('구원', cs.cons.length));
  if (tgt.favor >= 20) dParts.push({ label: '성심', value: 1 });
  // 왕이 아끼는 이는 차마 죽이지 못한다
  const kingLeanT = tgt.faction !== 'none' ? (s.king.lean[tgt.faction] ?? 0) : 0;
  const cherished = tgt.favor >= 30 || kingLeanT >= 15;
  if (cherished) dParts.push({ label: '왕이 아낌', value: 2 });
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
    if (cherished || tries > 0) {
      const fname = atk.faction !== 'none' ? FACTION_META[atk.faction].name : '대간';
      log(s, `[사사] 왕은 「차마 죽일 수 없다」며 ${tries > 0 ? `${tries + 1}번이나 ` : ''}물리쳤으나, 연일 이어지는 ${fname}의 상소를 끝내 이기지 못하고 ${tgt.name}에게 사약을 내렸다.`, mine ? 'player' : 'history');
      s.king.mood = clamp(s.king.mood - 5, -100, 100);
    }
    kill(s, tgt, '사약을 받고 죽었다');
    addMod(s, 'clan', tgt.clan, atk.id, '사사의 원한', -45, 0.05);
    if (tgt.faction !== 'none') swayFaction(s, tgt.faction, atk.id, -15, '동지를 죽임', 0.05);
  } else {
    atk.favor = clamp(atk.favor - 3, -100, 100);
    s.flags[`aggTry_${tgt.id}`] = tries + 1;
    log(s, `${tgt.name}에게 죄를 더하자는 논의는 왕이 받아들이지 않았다.${tries + 1 >= 2 ? ' 그러나 상소는 그치지 않는다.' : ''}`, mine ? 'player' : 'court');
  }
  if (outcome !== 'spared') delete s.flags[`aggTry_${tgt.id}`];
  if (outcome !== 'spared') s.tension = clamp(s.tension + (outcome === 'sasa' ? 6 : 1), 0, 100);
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
      // 임기가 차서 보직 대기가 되거나 체직되어도 논핵은 끝까지 간다. 환국으로 쫓겨난 이의 논핵은 환국(king.ts)이 거둔다
      (cs.kind === 'impeach' ? !['active', 'idle', 'retired'].includes(tgt.status) : tgt.status !== 'exiled');
    if (stale) {
      closeCase(s, cs);
      continue;
    }
    npcCounter(s, cs);
    rally(s, cs);
    recruit(s, cs);
    if (s.t < cs.due) continue;
    closeCase(s, cs);
    if (stepDown(s, cs)) continue;
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
  if (!inCourt(p) || !atSeat(s, p)) return `${seatName(s)}에 있어야 한다`;
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
  // 물러난다고 논핵이 끝나지는 않는다. 다만 스스로 물러난 점이 판정에 참작된다
  cs.resigned = true;
  vacate(s, p, 'retired');
  p.prestige = clamp(p.prestige + 1, 0, 100);
  p.favor = clamp(p.favor - 3, -100, 100);
  // 스스로 물러나도 탄핵을 시인한 셈이다: 반년 동안 서용되지 않는다
  p.banUntil = Math.max(p.banUntil ?? 0, s.t + 6);
  s.player.deeds.push(`${shortDate(s.t)} 탄핵을 받고 사직`);
  log(s, `${josa(p.name, '이/가')} ${s.chars[cs.attacker].name}의 논핵을 받고 스스로 물러났다. 그러나 대간은 논핵을 거두지 않았다.`, 'player');
}

/* ───────── 삼사 합계 ───────── */

/** 언관이 어느 관청 사람인가: 사헌부 / 사간원 / 홍문관 */
export function samsaHouse(c: Character | undefined): 'heon' | 'gan' | 'hong' | null {
  const o = c?.status === 'active' ? c.office : undefined;
  if (!o) return null;
  if (o === 'daesaheon' || o.startsWith('jangnyeong') || o.startsWith('jipyeong')) return 'heon';
  if (o === 'daesagan' || o.startsWith('jeongeon')) return 'gan';
  if (o === 'bujehak' || o === 'eunggyo' || o.startsWith('gyori') || o === 'daejehak') return 'hong';
  return null;
}

/** 공격 편에 선 언관들의 관청 수. 둘이면 양사 합계, 셋이면 삼사 합계 */
export function hapgyeOf(s: GameState, cs: Case): number {
  const houses = new Set<string>();
  for (const id of [cs.attacker, ...cs.pros]) {
    const h = samsaHouse(s.chars[id]);
    if (h) houses.add(h);
  }
  return houses.size >= 2 ? houses.size : 0;
}

/* ───────── 당론 결집 ───────── */

/** 당의 영수가 같은 당 사람들을 공방에 불러낸다. 플레이어가 그 당 사람이면 부름을 받는다. */
function rally(s: GameState, cs: Case) {
  if (cs.rallied) return;
  cs.rallied = true;
  const atk = s.chars[cs.attacker];
  const tgt = s.chars[cs.target];
  const p = P(s);
  // 당상관이 걸린 큰 공방에서만 영수가 나선다
  if (Math.min(atk.rank, tgt.rank) > 3 && !isP(s, atk) && !isP(s, tgt)) return;
  for (const f of activeFactions(s)) {
    if (f === 'none') continue;
    const side: 'pros' | 'cons' | null = tgt.faction === f && atk.faction !== f ? 'cons' : atk.faction === f && tgt.faction !== f ? 'pros' : null;
    if (!side) continue;
    const lead = s.chars[s.factions[f]?.leader ?? ''];
    if (!alive(lead) || isP(s, lead) || !inCourt(lead)) continue;
    if (!chance(s, s.tension >= 50 ? 0.35 : 0.15)) continue;
    const called = members(s, f)
      .filter((c) => !isP(s, c) && !sideOf(cs, c.id) && inCourt(c) && atSeat(s, c))
      .sort((a, b) => b.politics - a.politics)
      .slice(0, 3);
    for (const c of called) cs[side].push(c.id);
    if (!sideOf(cs, lead.id) && atSeat(s, lead)) cs[side].push(lead.id);
    const mine = isP(s, atk) || isP(s, tgt);
    log(s, `[당론] ${FACTION_META[f].name}의 영수 ${josa(lead.name, '이/가')} 당론을 모아 ${tgt.name} ${side === 'pros' ? '논핵에 힘을 실었다' : '구원에 나섰다'}.`, mine ? 'player' : 'court');
    if (p.faction === f && !sideOf(cs, p.id) && inCourt(p) && atSeat(s, p) && !s.pending.some((e) => e.def === 'party_rally'))
      pushEvent(s, 'party_rally', { caseId: cs.id, side, leader: lead.id });
  }
}

/* ───────── 맞탄핵 ───────── */

/** 정치력 높은 NPC는 자기를 친 이를 되받아친다 */
function npcCounter(s: GameState, cs: Case) {
  if (cs.countered || cs.counter || cs.kind !== 'impeach') return;
  cs.countered = true;
  const atk = s.chars[cs.attacker];
  const tgt = s.chars[cs.target];
  if (isP(s, tgt) || atk.status !== 'active' || !atk.office || caseOn(s, atk.id)) return;
  const samsa = !!samsaHouse(tgt);
  if (impeachEtiquette(tgt, atk, samsa) || tgt.politics < 4) return;
  if (!chance(s, tgt.traits.includes('radical') || tgt.traits.includes('schemer') ? 0.35 : 0.15)) return;
  const c2 = openCase(s, tgt, atk, { byMemorial: !samsa });
  if (c2) {
    c2.counter = true;
    log(s, `${josa(tgt.name, '이/가')} 물러서지 않고 ${josa(atk.name, '을/를')} 맞받아 논핵했다.`, isP(s, atk) ? 'player' : 'court');
  }
}

/* ───────── 인피 사직과 피혐 ───────── */

/** 판정을 앞두고 형세가 크게 기울면 NPC 대신은 스스로 물러난다(인피) */
function stepDown(s: GameState, cs: Case): boolean {
  const tgt = s.chars[cs.target];
  // 이미 물러난 이(다시 열린 논핵)는 또 물러날 자리가 없다
  if (isP(s, tgt) || tgt.rank > 3 || cs.kind !== 'impeach' || cs.resigned || !tgt.office) return false;
  const atk = s.chars[cs.attacker];
  const edge = statPower(atk) + prosPart(cs.pros.length, tgt).value - (statPower(tgt) + Math.min(SIDE_CAP, cs.cons.length) + (tgt.favor >= 50 ? 2 : 0));
  if (edge < 3 || !chance(s, tgt.traits.includes('upright') || tgt.traits.includes('mild') ? 0.6 : 0.35)) return false;
  const title = officeTitle(tgt);
  vacate(s, tgt);
  tgt.prestige = clamp(tgt.prestige + 1, 0, 100);
  // 정승이나 원수처럼 여기는 이는 물러나도 놓아주지 않는다: 삭탈관직과 유배를 다시 청한다
  const chase = tgt.rank <= 1 || atk.grudges.includes(tgt.id);
  const mine = !!sideOf(cs, P(s).id);
  log(s, `${title}였던 ${josa(tgt.name, '이/가')} 논핵의 형세를 보고 스스로 사직하고 물러났다(인피).${chase ? ' 그러나 대간은 「물러난 것으로 죄가 덮이지 않는다」며 논핵을 이어 갔다.' : ''}`, mine ? 'player' : 'court');
  if (chase) {
    const c2 = openCase(s, atk, tgt, { pros: cs.pros, bonus: (cs.bonus ?? 0) - 1 });
    if (c2) {
      c2.resigned = true;
      c2.cons = cs.cons.filter((id) => id !== atk.id);
    }
  } else if (mine) notice(s, '인피 사직', `${josa(tgt.name, '이/가')} 판정을 기다리지 않고 스스로 물러났다. 논핵은 그것으로 끝났다.`, 'court');
  return true;
}

/** 탄핵이 막히면 언관들이 피혐(避嫌)하며 줄사퇴한다. 둘 이상 물러나면 왕이 결국 뜻을 굽히기도 한다. */
function pihyeom(s: GameState, cs: Case, rep: ImpeachReport) {
  const tgt = s.chars[cs.target];
  const p = P(s);
  const samsas = [cs.attacker, ...cs.pros].map((id) => s.chars[id]).filter((c) => alive(c) && samsaHouse(c));
  const quit: Character[] = [];
  for (const c of samsas) {
    if (isP(s, c)) {
      pushEvent(s, 'pihyeom', { caseId: cs.id, target: tgt.id, others: samsas.filter((x) => !isP(s, x)).map((x) => x.id) });
      continue;
    }
    if (chance(s, c.traits.includes('upright') || c.traits.includes('radical') ? 0.6 : 0.35)) quit.push(c);
  }
  for (const c of quit) vacate(s, c);
  if (!quit.length) return;
  const mine = !!sideOf(cs, p.id);
  log(s, `[피혐] ${quit.map((c) => c.name).join('·')} 등 언관들이 ${tgt.name} 논핵이 막히자 피혐하며 물러났다.`, mine ? 'player' : 'court');
  if (quit.length >= 2 && alive(tgt) && tgt.status === 'active' && chance(s, 0.4)) {
    vacate(s, tgt);
    rep.text += ` 언관들이 줄지어 물러나자 왕이 결국 ${josa(tgt.name, '을/를')} 체직했다.`;
    log(s, `[피혐] 언관들이 줄지어 물러나자 왕이 결국 ${josa(tgt.name, '을/를')} 체직했다.`, mine ? 'player' : 'court');
  }
}

export const CASE_EVENTS: Record<string, EventDef> = {
  saju_request: {
    build(s, c) {
      const b = s.chars[c.backer];
      const t = s.chars[c.target];
      const p = P(s);
      const known = t ? t.flaws.filter((f) => !f.public && f.knownBy.includes(b?.id ?? '')).length : 0;
      return {
        title: '대신의 부탁',
        kind: 'court',
        text: `${officeTitle(b)} ${josa(b?.name ?? '', '이/가')} 사람을 보내 조용히 만나자고 한다. 술상을 물리자 그가 말한다. 「${officeTitle(t)} ${josa(t?.name ?? '', '은/는')} 조정을 어지럽히는 자요. 대간의 붓으로 바로잡아 주시오.」${known ? ` 그가 ${t?.name}의 숨은 허물 ${known}가지를 적은 쪽지를 건넨다.` : ''}\n\n대신은 몸소 논핵하지 않는다. 앞에 서는 것은 대간인 당신이다. 이기면 그가 신세를 지지만, 지면 무고의 허물은 당신이 진다.`,
        choices: [
          { key: 'accept', label: '붓을 든다', hint: `${t?.name}을 논핵한다. 대신이 뒤에서 힘을 싣고(+${(b?.rank ?? 9) <= 1 ? 2 : 1}) 당신에게 신세를 진다. 같은 당의 호감 +3` },
          { key: 'refuse', label: '「언관의 붓은 대신의 칼이 아니오」 하고 물리친다', hint: `명망 +2. ${b?.name}의 호감 −12, 같은 당의 호감 −3` },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const b = s.chars[c.backer];
      const t = s.chars[c.target];
      if (!alive(b) || !alive(t) || p.status !== 'active' || caseOn(s, t.id) || s.cases.some((x) => x.attacker === p.id)) return '때를 놓쳐 일이 흐지부지되었다.';
      if (key === 'refuse') {
        p.prestige = clamp(p.prestige + 2, 0, 100);
        sway(s, b, p.id, -12, '부탁을 물리침', { decay: 0.1 });
        if (p.faction !== 'none') swayFaction(s, p.faction, p.id, -3, '당의 일을 외면함', 0.1);
        return `${b.name}의 부탁을 물리쳤다. 곧은 언관이라는 말이 돈다. (명망 +2)`;
      }
      const cs = openByProxy(s, b, p, t, { bonus: c.bonus ?? 0 });
      if (!cs) return '논핵을 열지 못했다.';
      owe(s, b.id);
      if (p.faction !== 'none') swayFaction(s, p.faction, p.id, 3, '당의 일에 앞장섬', 0.1);
      return `${josa(t.name, '을/를')} 논핵하는 계사를 올렸다. 뒤에는 ${b.name}이 있다. (그가 신세를 졌다)`;
    },
  },
  party_rally: {
    build(s, c) {
      const cs = caseById(s, c.caseId);
      const lead = s.chars[c.leader];
      if (!cs) return { title: '당론의 부름', text: '논핵은 이미 끝났다.', choices: [{ key: 'no', label: '확인' }] };
      const tgt = s.chars[cs.target];
      const atk = s.chars[cs.attacker];
      return {
        title: '당론의 부름',
        kind: 'court',
        text: `당의 영수 ${josa(lead.name, '이/가')} 사람을 보내 왔다. ${c.side === 'pros' ? `${atk.name}이 일으킨 ${tgt.name} 논핵에 함께 이름을 올리라는 것이다.` : `논핵을 당한 동지 ${josa(tgt.name, '을/를')} 구원하라는 것이다.`} 당론이 정해진 일이다.`,
        choices: [
          { key: 'yes', label: '당론을 따른다', hint: `행동력 없이 ${c.side === 'pros' ? '동조' : '구원'} 편에 선다. 같은 당 호감 +3. 상대의 원한을 산다.` },
          { key: 'no', label: '이번에는 빠진다', hint: '같은 당 호감 -5' },
        ],
      };
    },
    resolve(s, c, key) {
      const cs = caseById(s, c.caseId);
      const p = P(s);
      if (!cs) return '';
      if (key === 'no') return swayFaction(s, p.faction, p.id, -5, '당론을 외면', 0.1) || '빠지기로 했다.';
      if (sideOf(cs, p.id)) return '';
      const tgt = s.chars[cs.target];
      const atk = s.chars[cs.attacker];
      const fx: string[] = [swayFaction(s, p.faction, p.id, 3, '당론을 따름', 0.1)];
      if (c.side === 'pros') {
        cs.pros.push(p.id);
        fx.push(...sway(s, tgt, p.id, -12, '논핵 동조', { clan: 0.3, decay: 0.15 }));
      } else {
        cs.cons.push(p.id);
        owe(s, tgt.id);
        fx.push(...sway(s, atk, p.id, -8, '구원 상소', { decay: 0.2 }));
      }
      return `당론을 따라 ${c.side === 'pros' ? '논핵에 이름을 올렸다' : '구원 상소에 이름을 올렸다'}. (${fx.filter(Boolean).join(', ')})`;
    },
  },
  pihyeom: {
    build(s, c) {
      const tgt = s.chars[c.target];
      return {
        title: '피혐(避嫌)',
        kind: 'court',
        text: `${tgt?.name ?? ''} 논핵이 막혔다. 언관으로서 말이 받아들여지지 않았으니 물러나 피혐하는 것이 법도다. 함께한 언관들이 줄지어 물러나면 왕도 끝내 버티기 어렵다.`,
        choices: [
          { key: 'quit', label: '피혐하고 물러난다', hint: '관직을 내려놓는다. 명망 +3. 다른 언관과 함께 둘 이상 물러나면 40% 확률로 왕이 상대를 체직한다.' },
          { key: 'stay', label: '자리를 지킨다', hint: '명망 -2. 공론에서 말을 바꾼 이로 보인다.' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const tgt = s.chars[c.target];
      if (key === 'stay') {
        p.prestige = clamp(p.prestige - 2, 0, 100);
        return '자리를 지켰다. 언관이 말을 굽혔다는 뒷말이 돈다. (명망 -2)';
      }
      if (p.status === 'active' && p.office) vacate(s, p);
      p.prestige = clamp(p.prestige + 3, 0, 100);
      const others = (c.others as string[]).map((id) => s.chars[id]).filter((x) => alive(x) && x.status === 'active' && samsaHouse(x));
      const joiners = others.filter(() => chance(s, 0.45));
      for (const x of joiners) vacate(s, x);
      let extra = '';
      if (joiners.length >= 1 && alive(tgt) && tgt.status === 'active' && chance(s, 0.4)) {
        vacate(s, tgt);
        extra = ` 언관들이 줄지어 물러나자 왕이 결국 ${josa(tgt.name, '을/를')} 체직했다!`;
        log(s, `[피혐] ${josa(p.name, '이/가')} 앞장선 언관들의 피혐에 왕이 뜻을 굽혀 ${josa(tgt.name, '을/를')} 체직했다.`, 'player');
      }
      return `피혐하며 물러났다.${joiners.length ? ` ${joiners.map((x) => x.name).join('·')}도 함께 물러났다.` : ''}${extra} (명망 +3)`;
    },
  },
};
