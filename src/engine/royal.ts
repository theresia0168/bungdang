import type { Character, Consort, FactionId, GameState, RoyalState, Situation } from './types';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { tOf } from './calendar';
import { chance, randInt, weighted } from './rng';
import { monthsSince, addFlaw, age, alive, clamp, inCourt, isP, josa, log, notice, P, pushEvent, uid } from './state';
import { swayFaction } from './opinion';
import { activeFactions, powerShare } from './factions';
import { vacate } from './court';
import { exile } from './conflict';
import { kingLean, kingMood } from './king';

/* ───────── 왕실 ───────── */

const CONSORTS: Consort[] = [
  { id: 'uiin', name: '의인왕후 박씨', title: '중전', born: 1555, alive: true, love: 30 },
  { id: 'gongbin', name: '공빈 김씨', title: '후궁', born: 1553, alive: true, love: 65 },
  { id: 'inbin', name: '인빈 김씨', title: '후궁', born: 1555, alive: true, love: 60, kin: '김공량' },
  { id: 'sunbin', name: '순빈 김씨', title: '후궁', born: 1560, alive: true, love: 25 },
];

const PRINCES: Record<string, { mother: string; love: number }> = {
  imhae: { mother: 'gongbin', love: 35 },
  gwanghae: { mother: 'gongbin', love: 45 },
  uian: { mother: 'inbin', love: 55 },
  sinseong: { mother: 'inbin', love: 75 },
  jeongwon: { mother: 'inbin', love: 50 },
  sunhwa: { mother: 'sunbin', love: 25 },
  uichang: { mother: 'inbin', love: 45 },
};

export function initRoyal(): RoyalState {
  return { consorts: CONSORTS.map((c) => ({ ...c })), princes: JSON.parse(JSON.stringify(PRINCES)), picks: {} };
}

export const consortOf = (s: GameState, id: string) => s.royal.consorts.find((c) => c.id === id);
export const motherOf = (s: GameState, prince: string) => consortOf(s, s.royal.princes[prince]?.mother ?? '');
export const loveOf = (s: GameState, prince: string) => Math.round(s.royal.princes[prince]?.love ?? 0);

/** 지금 살아 있고 궁에 들어온 왕자들, 나이순 */
export function princes(s: GameState): Character[] {
  return Object.keys(s.royal.princes)
    .map((id) => s.chars[id])
    .filter((c) => alive(c) && c.status === 'royal')
    .sort((a, b) => a.born - b.born);
}

/** 세자 후보: 열 살 넘은 왕자 */
export const candidates = (s: GameState) => princes(s).filter((c) => age(s, c) >= 10);

export const heirSit = (s: GameState) => s.situations.find((x) => x.kind === 'heir');

/** 왕이 가장 아끼는 후보 */
export function favorite(s: GameState): Character | undefined {
  return [...candidates(s)].sort((a, b) => loveOf(s, b.id) - loveOf(s, a.id))[0];
}

/** 각 후보에 쏠린 힘: 왕의 사랑 + 미는 당의 세 + 플레이어 */
export function heirOdds(s: GameState): Record<string, number> {
  const share = powerShare(s);
  const out: Record<string, number> = {};
  const p = P(s);
  for (const c of candidates(s)) {
    let v = loveOf(s, c.id) * 0.6 + (c.learning + c.politics) * 1.5;
    for (const f of activeFactions(s)) if (s.royal.picks[f] === c.id) v += (share[f] ?? 0) * 60;
    if (s.royal.backing === c.id) v += s.royal.backingPublic ? 4 + p.prestige / 10 + p.politics : motherOf(s, c.id)?.id === 'inbin' ? 8 : 3;
    out[c.id] = Math.max(1, Math.round(v));
  }
  return out;
}

const MERIT: Partial<Record<FactionId, [number, number, number]>> = {
  // 덕망, 총애, 장자
  seo: [1.3, 0.3, 0.6],
  dong: [0.7, 0.9, 0.4],
  nam: [1.1, 0.4, 0.6],
  buk: [0.8, 0.8, 0.3],
};

function choosePicks(s: GameState) {
  const cs = candidates(s);
  const eldest = cs[0]?.id;
  for (const f of activeFactions(s)) {
    const [m, l, e] = MERIT[f] ?? [1, 0.5, 0.5];
    const pickId = weighted(
      s,
      cs.map((c) => [c.id, Math.max(0.2, (c.learning + c.politics) * m + (loveOf(s, c.id) / 15) * l + (c.id === eldest ? 3 * e : 0))] as [string, number]),
    );
    if (pickId) s.royal.picks[f] = pickId;
  }
}

/** 매달: 후궁과 왕자의 사랑이 오르내리고, 국본 논의가 일어난다 */
export function tickRoyal(s: GameState) {
  const r = s.royal;
  const gong = consortOf(s, 'gongbin');
  if (gong?.alive && s.t >= tOf(1577, 5)) {
    gong.alive = false;
    const inbin = consortOf(s, 'inbin');
    if (inbin) inbin.love = clamp(inbin.love + 15, 0, 100);
  }
  for (const c of r.consorts) if (c.alive) c.love = clamp(c.love + randInt(s, -2, 2) * 0.5, 0, 100);
  for (const [id, pr] of Object.entries(r.princes)) {
    if (!alive(s.chars[id])) continue;
    const mom = consortOf(s, pr.mother);
    const pull = mom?.alive ? (mom.love - 50) / 200 : -0.1;
    pr.love = clamp(pr.love + pull + randInt(s, -1, 1) * 0.4, 0, 100);
  }
  if (s.heir && !alive(s.chars[s.heir])) {
    const dead = s.chars[s.heir];
    s.heir = undefined;
    log(s, `[국본] 세자 ${dead?.name ?? ''}의 죽음으로 국본이 비었다.`, 'history');
    if (s.war.active) {
      const next = [...candidates(s)].sort((a, b) => b.learning + b.politics - (a.learning + a.politics))[0];
      if (next) settleHeir(s, next.id, 'war');
    }
  }
  if (s.heir) return;
  const sit = heirSit(s);
  if (sit) return tickDebate(s, sit);
  if (s.war.active || s.t < tOf(1588, 1) || monthsSince(s, 'heirAt') < 30 || candidates(s).length < 2) return;
  const ill = s.situations.some((x) => x.kind === 'illness');
  if (chance(s, ill ? 0.12 : 0.025)) startDebate(s, ill ? '왕의 환후가 길어지자' : '왕자들이 장성하자');
}

/* ───────── 국본 논의 ───────── */

export function startDebate(s: GameState, cause: string) {
  if (heirSit(s) || s.heir || candidates(s).length < 2) return;
  s.royal.picks = {};
  choosePicks(s);
  const sit: Situation = { id: uid(s, 'sit'), kind: 'heir', since: s.t, until: s.t + randInt(s, 8, 14), data: { wrath: 0, pushed: false, offered: false } };
  s.situations.push(sit);
  s.tension = clamp(s.tension + 4, 0, 100);
  const picks = activeFactions(s)
    .filter((f) => s.royal.picks[f])
    .map((f) => `${FACTION_META[f].name}은 ${s.chars[s.royal.picks[f]!].name}`);
  log(s, `[국본] ${cause} 세자를 정하자는 말이 조정에 돌기 시작했다. ${picks.join(', ')} 쪽으로 기운다.`, 'history');
  const p = P(s);
  if (p.status !== 'exiled') pushEvent(s, 'heir_open');
}

function tickDebate(s: GameState, sit: Situation) {
  const cs = candidates(s);
  if (cs.length < 2) {
    s.situations = s.situations.filter((x) => x !== sit);
    if (cs.length) settleHeir(s, cs[0].id, 'designate');
    return;
  }
  s.tension = clamp(s.tension + 0.4, 0, 100);
  sit.data.wrath += 1;
  kingMood(s, -1);
  const p = P(s);
  const fav = favorite(s);
  if (s.royal.backing && s.royal.backingPublic && fav && s.royal.backing !== fav.id) p.favor = clamp(p.favor - 0.5, -100, 100);
  if (s.war.active) return resolveDebate(s, sit, 'war');
  const m = s.t - sit.since;
  if (!sit.data.pushed && m >= 3 && inCourt(p) && p.faction !== 'none' && s.royal.picks[p.faction] && s.pending.length < 2) {
    sit.data.pushed = true;
    pushEvent(s, 'heir_push');
  } else if (!sit.data.offered && m >= 2 && inCourt(p) && p.rank <= 4 && s.royal.backing !== 'sinseong' && alive(s.chars.sinseong) && consortOf(s, 'inbin')?.alive && chance(s, 0.25) && s.pending.length < 2) {
    sit.data.offered = true;
    pushEvent(s, 'heir_offer');
  }
  if (s.t >= sit.until) resolveDebate(s, sit);
}

type Outcome = 'wrath' | 'delay' | 'designate' | 'war' | 'history';

/** 논의가 끝난다 */
export function resolveDebate(s: GameState, sit: Situation, force?: Outcome) {
  s.situations = s.situations.filter((x) => x !== sit);
  s.flags.heirAt = s.t;
  const odds = heirOdds(s);
  const cs = candidates(s);
  if (!cs.length) return;
  const fav = favorite(s)!;
  const top = [...cs].sort((a, b) => (odds[b.id] ?? 0) - (odds[a.id] ?? 0))[0];
  if (force === 'war') {
    const best = [...cs].sort((a, b) => b.learning + b.politics - (a.learning + a.politics))[0];
    return settleHeir(s, best.id, 'war');
  }
  if (force === 'history') return heirShelved(s, fav, true);
  const loved = loveOf(s, fav.id);
  let out: Outcome;
  if (fav.id !== top.id && loved >= 60 && chance(s, clamp(0.35 + sit.data.wrath / 40, 0.2, 0.8))) out = 'wrath';
  else if (chance(s, 0.3)) out = 'delay';
  else out = 'designate';
  if (out === 'wrath') return heirShelved(s, fav, false);
  if (out === 'delay') {
    log(s, '[국본] 왕이 "과인이 아직 늙지 않았다"며 세자 책봉 논의를 덮었다.', 'history');
    if (s.royal.backing) notice(s, '국본 논의가 덮였다', '왕이 세자 책봉을 미뤘다. 누구도 이기지 못했고, 누구도 다치지 않았다. 언젠가 다시 불붙을 것이다.', 'court');
    return;
  }
  const win = weighted(s, cs.map((c) => [c.id, odds[c.id] ?? 1] as [string, number]))!;
  settleHeir(s, win, 'designate');
}

/** 왕이 진노해 총애하지 않는 왕자를 민 쪽을 친다 (건저의의 꼴) */
function heirShelved(s: GameState, fav: Character, history: boolean) {
  const p = P(s);
  const hit = activeFactions(s).filter((f) => s.royal.picks[f] && s.royal.picks[f] !== fav.id);
  const fallen: string[] = [];
  if (!history) {
    for (const f of hit) {
      const lead = s.chars[s.factions[f].leader ?? ''];
      kingLean(s, f, -12);
      if (lead && alive(lead) && !isP(s, lead) && lead.status === 'active') {
        lead.favor = clamp(lead.favor - 25, -100, 100);
        if (chance(s, 0.5)) exile(s, lead, undefined, true);
        else vacate(s, lead);
        fallen.push(lead.name);
      }
    }
    for (const f of activeFactions(s)) if (s.royal.picks[f] === fav.id) kingLean(s, f, 6);
    s.tension = clamp(s.tension + 8, 0, 100);
    log(s, `[국본] 세자를 세우자는 청에 왕이 크게 노했다. 왕은 ${josa(fav.name, '을/를')} 아끼고 있었던 것이다.${fallen.length ? ` ${fallen.join(', ')} 등이 화를 입었다.` : ''}`, 'history');
  }
  if (!s.royal.backing) return;
  if (s.royal.backing === fav.id) {
    p.favor = clamp(p.favor + (s.royal.backingPublic ? 5 : 8), -100, 100);
    notice(s, '왕의 뜻을 읽었다', `왕은 처음부터 ${josa(fav.name, '을/를')} 마음에 두고 있었다. 그쪽에 섰던 당신은 왕의 눈에 들었다. (성심 +${s.royal.backingPublic ? 5 : 8})`, 'court');
    return;
  }
  if (!s.royal.backingPublic) {
    notice(s, '국본 논의가 꺾였다', '왕이 진노했지만, 은밀히 줄을 댔던 당신은 드러나지 않았다.', 'court');
    return;
  }
  const risk = clamp(0.35 + (p.rank <= 2 ? 0.15 : 0) - (p.favor >= 50 ? 0.15 : 0), 0.1, 0.7);
  if (p.status === 'active' && p.office && OFFICE_MAP[p.office] && chance(s, risk)) {
    vacate(s, p);
    p.favor = clamp(p.favor - 15, -100, 100);
    s.player.deeds.push('국본 논의로 파직');
    notice(s, '왕의 진노', `세자를 세우자고 앞장섰던 당신도 화를 입었다. 파직되었다. (성심 -15, 화를 입을 확률 ${Math.round(risk * 100)}%)`, 'danger');
  } else {
    p.favor = clamp(p.favor - 8, -100, 100);
    notice(s, '왕의 진노', `세자를 세우자고 했던 당신을 왕이 차갑게 본다. (성심 -8, 파직될 확률 ${Math.round(risk * 100)}%를 넘겼다)`, 'danger');
  }
}

/** 세자가 정해진다 */
export function settleHeir(s: GameState, id: string, how: 'designate' | 'war') {
  const sit = heirSit(s);
  if (sit) s.situations = s.situations.filter((x) => x !== sit);
  const c = s.chars[id];
  s.heir = id;
  s.flags.heirAt = s.t;
  for (const f of activeFactions(s)) {
    if (!s.royal.picks[f]) continue;
    if (s.royal.picks[f] === id) kingLean(s, f, how === 'war' ? 3 : 6);
    else if (how === 'designate') {
      kingLean(s, f, -4);
      s.tension = clamp(s.tension + 2, 0, 100);
    }
  }
  if (how === 'designate') log(s, `[국본] ${josa(c.name, '이/가')} 세자로 책봉되었다.`, 'history');
  const p = P(s);
  const b = s.royal.backing;
  if (!b) return;
  if (b === id) {
    const pub = !!s.royal.backingPublic;
    p.prestige = clamp(p.prestige + (pub ? 4 : 1), 0, 100);
    p.favor = clamp(p.favor + (pub ? 3 : 2), -100, 100);
    notice(s, '세자 책봉', `당신이 밀던 ${josa(c.name, '이/가')} 세자가 되었다. 당신은 「세자의 사람」으로 불린다. (명망 +${pub ? 4 : 1}, 성심 +${pub ? 3 : 2}. 앞으로 임용 점수 +2)`, 'history');
  } else if (s.royal.backingPublic) {
    p.favor = clamp(p.favor - 5, -100, 100);
    notice(s, '세자 책봉', `${josa(c.name, '이/가')} 세자가 되었다. 다른 왕자를 드러내 놓고 밀었던 당신을 새 세자는 기억할 것이다. (성심 -5)`, 'court');
  }
}

/** 건저의 같은 역사 사건이 논의를 끝낼 때 */
export function endDebateByHistory(s: GameState) {
  const sit = heirSit(s);
  if (sit) resolveDebate(s, sit, 'history');
  else s.flags.heirAt = s.t;
}

/* ───────── 플레이어의 줄서기 ───────── */

export function backError(s: GameState, id: string, pub: boolean): string | null {
  const p = P(s);
  if (s.heir) return '이미 세자가 정해졌다';
  if (!heirSit(s)) return '국본 논의가 일고 있을 때만 할 수 있다';
  if (!candidates(s).some((c) => c.id === id)) return '세자 후보가 아니다';
  if (p.status === 'exiled') return '귀양 중이다';
  if (s.royal.backing === id && (s.royal.backingPublic || !pub)) return '이미 밀고 있다';
  if (s.player.ap < 1) return '행동력이 부족하다';
  if (pub && !inCourt(p)) return '조정에 있어야 한다';
  if (!pub && p.wealth < 20) return '재산 20이 필요하다';
  return null;
}

export function backPrince(s: GameState, id: string, pub: boolean): string {
  const err = backError(s, id, pub);
  if (err) return err;
  const p = P(s);
  const c = s.chars[id];
  s.player.ap -= 1;
  const switched = s.royal.backing && s.royal.backing !== id;
  const wasPublic = s.royal.backingPublic;
  s.royal.backing = id;
  if (pub) {
    s.royal.backingPublic = true;
    const pick = p.faction !== 'none' ? s.royal.picks[p.faction] : undefined;
    const fx = pick === id ? swayFaction(s, p.faction, p.id, 4, '국본 논의에 앞장섬', 0.08) : pick ? swayFaction(s, p.faction, p.id, -5, '당론과 다른 왕자를 밂', 0.08) : '';
    p.prestige = clamp(p.prestige + (pick === id ? 2 : 0), 0, 100);
    const sit = heirSit(s);
    if (sit) sit.data.wrath += 2;
    if (switched && wasPublic) {
      p.prestige = clamp(p.prestige - 4, 0, 100);
      addFlaw(s, p, '국본 논의의 변절', true);
    }
    return `${josa(c.name, '을/를')} 세자로 세워야 한다고 드러내 놓고 아뢰었다.${fx ? ` (${fx})` : ''}${switched && wasPublic ? ' 말을 바꾼 당신을 두고 변절했다는 말이 돈다. (명망 -4)' : ''}`;
  }
  p.wealth -= 20;
  s.royal.backingPublic = false;
  const mom = motherOf(s, id);
  if (mom) mom.love = clamp(mom.love + 2, 0, 100);
  if (chance(s, 0.15)) {
    addFlaw(s, p, mom?.kin ? `외척 ${mom.kin}과 결탁` : '궁중과 내통', false);
    return `${mom?.name ?? '궁중'} 쪽에 재물을 넣어 ${josa(c.name, '을/를')} 밀기로 했다. 심부름꾼의 입이 가볍다는 게 마음에 걸린다. (재산 -20, 숨은 흠결)`;
  }
  return `${mom?.name ?? '궁중'} 쪽에 은밀히 재물을 넣어 ${josa(c.name, '을/를')} 밀기로 했다. (재산 -20)`;
}

export function dropBacking(s: GameState): string {
  if (!s.royal.backing) return '밀고 있는 왕자가 없다';
  const p = P(s);
  if (s.royal.backingPublic && heirSit(s)) {
    p.prestige = clamp(p.prestige - 2, 0, 100);
    s.royal.backing = undefined;
    s.royal.backingPublic = undefined;
    return '말을 거두고 물러섰다. 줏대가 없다는 말을 들었다. (명망 -2)';
  }
  s.royal.backing = undefined;
  s.royal.backingPublic = undefined;
  return '손을 뗐다.';
}

/* ───────── 이벤트 ───────── */

const list = (s: GameState) =>
  candidates(s)
    .map((c) => `· ${c.name} (${age(s, c)}세, ${motherOf(s, c.id)?.name ?? ''} 소생) — 왕의 사랑 ${loveOf(s, c.id)}`)
    .join('\n');

export const ROYAL_EVENTS: Record<string, EventDef> = {
  heir_open: {
    build(s) {
      const p = P(s);
      const fav = favorite(s);
      const pick = p.faction !== 'none' ? s.royal.picks[p.faction] : undefined;
      const choices = candidates(s).map((c) => ({
        key: `pub:${c.id}`,
        label: `${josa(c.name, '을/를')} 세자로 세워야 한다고 아뢴다`,
        hint: `${c.id === fav?.id ? '왕의 뜻에 맞는다.' : '왕의 뜻과 어긋날 수 있다.'}${pick === c.id ? ' 당론과 같다.' : pick ? ' 당론과 다르다.' : ''}${inCourt(p) ? '' : ' (조정에 있어야 한다)'}`,
        disabled: inCourt(p) ? undefined : '조정에 있어야 한다',
      }));
      return {
        title: '국본(國本) 논의',
        kind: 'history',
        text: `왕에게는 적자(嫡子)가 없다. 왕자들이 장성하자, 누구를 세자로 세울지를 두고 조정이 술렁인다.\n\n${list(s)}\n\n${pick ? `당신의 당은 ${josa(s.chars[pick].name, '을/를')} 민다. ` : ''}왕은 ${fav ? josa(fav.name, '을/를') : '누군가를'} 각별히 아낀다는 말이 있다. 선뜻 나섰다가 왕의 뜻과 어긋나면 화를 입는다. 논의는 몇 달 이어질 것이다.`,
        choices: [...choices, { key: 'wait', label: '지켜본다', hint: '왕실 탭에서 나중에 줄을 설 수 있다.' }],
      };
    },
    resolve(s, _c, key) {
      if (key === 'wait') return '말을 아꼈다. 판이 기우는 쪽을 볼 생각이다.';
      const id = key.slice(4);
      s.player.ap += 1;
      const out = backPrince(s, id, true);
      if (s.royal.backing !== id) s.player.ap -= 1;
      return out;
    },
  },

  heir_push: {
    build(s) {
      const p = P(s);
      const pick = s.royal.picks[p.faction]!;
      const c = s.chars[pick];
      const fav = favorite(s);
      return {
        title: '연명 상소',
        kind: 'danger',
        text: `${FACTION_META[p.faction].name}의 원로들이 ${josa(c.name, '을/를')} 세자로 세우자는 연명 상소를 꾸민다. 당신의 이름도 올리자고 한다.\n\n${fav && fav.id !== c.id ? `그러나 왕의 마음은 ${fav.name} 쪽에 있다. 잘못하면 상소에 이름을 올린 이들이 한꺼번에 화를 입는다.` : '왕도 내심 그 왕자를 아끼니, 해볼 만한 싸움이다.'}`,
        choices: [
          { key: 'sign', label: '이름을 올린다', hint: `${josa(c.name, "을/를")} 드러내 놓고 민다. 당 호감 +4, 명망 +2. 왕의 짜증이 쌓인다.` },
          { key: 'sick', label: '병을 핑계로 빠진다', hint: '당 호감 -4. 화는 피한다.' },
          { key: 'leak', label: '상소 계획을 궁중에 흘린다', hint: `성심 +8. 숨은 흠결 「연명 밀고」. 들키면 당이 등을 돌린다.` },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const sit = heirSit(s);
      const pick = s.royal.picks[p.faction];
      if (!sit || !pick) return '논의가 이미 끝났다.';
      if (key === 'sign') {
        s.royal.backing = pick;
        s.royal.backingPublic = true;
        sit.data.wrath += 3;
        p.prestige = clamp(p.prestige + 2, 0, 100);
        const pr = s.royal.princes[pick];
        if (pr) pr.love = clamp(pr.love + 2, 0, 100);
        return `연명 상소에 이름을 올렸다. (${swayFaction(s, p.faction, p.id, 4, '연명에 동참', 0.08)}, 명망 +2)`;
      }
      if (key === 'sick') return `병을 핑계로 빠졌다. (${swayFaction(s, p.faction, p.id, -4, '연명을 피함', 0.08)})`;
      p.favor = clamp(p.favor + 8, -100, 100);
      addFlaw(s, p, '연명 밀고', false);
      sit.data.wrath += 6;
      const lead = s.chars[s.factions[p.faction].leader ?? ''];
      if (lead && !isP(s, lead)) lead.favor = clamp(lead.favor - 10, -100, 100);
      return '궁중에 상소 계획을 흘렸다. 왕이 미리 노여움을 품었다. (성심 +8, 숨은 흠결)';
    },
  },

  heir_offer: {
    build(s) {
      const inbin = consortOf(s, 'inbin')!;
      return {
        title: '궁중에서 온 사람',
        kind: 'danger',
        text: `밤늦게 ${inbin.kin ?? '인빈의 친정'}이 보낸 사람이 찾아왔다. 비단 보따리를 내밀며 말한다.\n\n"마마께서는 신성군을 아끼십니다. 대감께서 조정에서 한마디만 거들어 주시면, 이 은혜는 잊지 않으실 겁니다."`,
        choices: [
          { key: 'take', label: '받는다 — 신성군 쪽에 은밀히 선다', hint: '재산 +15. 신성군을 은밀히 민다. 25% 확률로 「외척과 결탁」 흠결.' },
          { key: 'refuse', label: '정중히 돌려보낸다', hint: '아무 일도 없다.' },
          { key: 'expose', label: '외척이 국본에 끼어든다고 탄핵한다', hint: '명망 +4. 왕이 언짢아한다 (성심 -6). 인빈의 미움을 산다.', disabled: inCourt(P(s)) ? undefined : '조정에 있어야 한다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'take') {
        p.wealth += 15;
        s.royal.backing = 'sinseong';
        s.royal.backingPublic = false;
        if (chance(s, 0.25)) addFlaw(s, p, '외척과 결탁', false);
        return '보따리를 받았다. 당신은 이제 신성군 쪽 사람이다. (재산 +15)';
      }
      if (key === 'refuse') return '돌려보냈다.';
      p.prestige = clamp(p.prestige + 4, 0, 100);
      p.favor = clamp(p.favor - 6, -100, 100);
      const inbin = consortOf(s, 'inbin');
      if (inbin) inbin.love = clamp(inbin.love - 5, 0, 100);
      const pr = s.royal.princes.sinseong;
      if (pr) pr.love = clamp(pr.love - 4, 0, 100);
      log(s, `${josa(p.name, '이/가')} 외척이 국본 논의에 끼어든다고 상소했다.`, 'player');
      return '외척의 청탁을 들춰냈다. 선비들은 박수를 치지만 왕의 낯빛은 어둡다. (명망 +4, 성심 -6)';
    },
  },
};