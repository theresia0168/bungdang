import type { FactionId, GameState } from './types';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { tOf } from './calendar';
import { chance, d6 } from './rng';
import { monthsSince, alive, clamp, inCourt, isP, josa, log, officeTitle, P, people, pushEvent } from './state';
import { opinion, sway, swayFaction } from './opinion';
import { influence, members, standing, updateLeaders } from './factions';
import { kingLean } from './king';

/** 당론의 강경함. 높으면 당이 논핵을 자주 벌이고 왕이 경계한다. */
export const lineOf = (s: GameState, f: FactionId) => Math.round(s.line[f] ?? 0);

export function lineLabel(v: number): string {
  if (v >= 35) return '강경';
  if (v >= 10) return '다소 강경';
  if (v > -10) return '중도';
  if (v > -35) return '다소 온건';
  return '온건';
}

function moveLine(s: GameState, f: FactionId, v: number) {
  s.line[f] = clamp((s.line[f] ?? 0) + v, -60, 60);
}


export function tickParty(s: GameState) {
  for (const f of Object.keys(s.line) as FactionId[]) {
    const v = s.line[f] ?? 0;
    s.line[f] = v * 0.98;
    if (v > 30 && s.factions[f]?.active) kingLean(s, f, -(v - 30) / 60);
  }
  const p = P(s);
  if (p.faction === 'none' || !inCourt(p) || s.pending.length >= 2) return;
  const f = p.faction;
  const st = s.factions[f];

  if (s.factions.dong.active && f === 'dong' && s.t >= tOf(1588, 1) && !s.flags.wingAsked && chance(s, 0.08)) {
    s.flags.wingAsked = s.t;
    pushEvent(s, 'dong_wing');
    return;
  }

  challengeLeader(s);
  const lead = st.leader ? s.chars[st.leader] : undefined;
  if (alive(lead) && !isP(s, lead) && monthsSince(s, 'challengeAt') >= 24 && influence(s, p) >= influence(s, lead) * 0.8 && chance(s, 0.1)) {
    s.flags.challengeAt = s.t;
    pushEvent(s, 'leader_challenge', { leader: lead.id });
    return;
  }

  if (monthsSince(s, 'councilAt') >= 10 && chance(s, 0.1)) {
    s.flags.councilAt = s.t;
    pushEvent(s, 'party_council');
  }
}


/* ───────── 영수의 당 운영 ─────────
 * 영수가 되면 당의 노선을 정하고, 요직에 당의 사람을 밀고, 당을 다독이거나 이견을 누른다.
 * 당의 평판(같은 당 사람들의 평균 호감)이 바닥이면 당 안에서 도전이 온다.
 */

export type LeadId = 'lead_hard' | 'lead_soft' | 'lead_slate' | 'lead_unite' | 'lead_discipline';

const isLeader = (s: GameState) => {
  const p = P(s);
  return p.faction !== 'none' && s.factions[p.faction]?.leader === p.id && inCourt(p);
};
const cdLeft = (s: GameState, id: string) => Math.max(0, Number(s.flags[`leadCd_${id}`] ?? -999) - s.t);
const setCd = (s: GameState, id: string, m: number) => (s.flags[`leadCd_${id}`] = s.t + m);

/** 같은 당에서 영수에게 가장 등을 돌린 당상관 */
function dissenter(s: GameState) {
  const p = P(s);
  return members(s, p.faction)
    .filter((c) => c.id !== p.id && c.rank <= 3 && inCourt(c))
    .sort((a, b) => opinion(s, a, p) - opinion(s, b, p))
    .find((c) => opinion(s, c, p) < 0);
}

/** 자리 경쟁 가운데 우리 당 후보가 있는 것 */
function partyRaces(s: GameState) {
  const p = P(s);
  return s.races.map((r) => ({ r, cand: r.candidates.map((id) => s.chars[id]).find((c) => c && c.faction === p.faction && c.id !== p.id) })).filter((x) => x.cand);
}

export const LEAD_ACTIONS: { id: LeadId; name: string; desc: string; check(s: GameState): string | null; run(s: GameState): string }[] = [
  {
    id: 'lead_hard',
    name: '당론을 세운다 (강경)',
    desc: '당의 노선을 강경하게 정한다. 당론 +20(영수가 세울 수 있는 것은 60까지). 강경한 이들의 호감 +4, 온건한 이들 −3. 긴장 +3. 당론이 30을 넘으면 왕이 그 당을 꺼린다. 반년에 한 번(온건과 함께).',
    check: (s) =>
      !isLeader(s) ? '당의 영수여야 한다' : cdLeft(s, 'line') ? `${cdLeft(s, 'line')}달 뒤에 다시 정할 수 있다` : lineOf(s, P(s).faction) >= 60 ? '당론이 이미 더없이 강경하다' : s.player.ap < 1 ? '행동력이 부족하다' : null,
    run(s) {
      const p = P(s);
      s.player.ap -= 1;
      setCd(s, 'line', 6);
      s.line[p.faction] = Math.min(60, (s.line[p.faction] ?? 0) + 20);
      s.tension = clamp(s.tension + 3, 0, 100);
      for (const c of members(s, p.faction)) {
        if (c.id === p.id) continue;
        if (c.traits.includes('radical') || c.traits.includes('upright')) sway(s, c, p.id, 4, '강경한 당론', { decay: 0.05 });
        else if (c.traits.includes('mild') || c.traits.includes('mediator')) sway(s, c, p.id, -3, '강경한 당론', { decay: 0.05 });
      }
      log(s, `${FACTION_META[p.faction].name}의 영수 ${josa(p.name, '이/가')} 강경한 당론을 세웠다.`, 'faction');
      return `당론을 강경하게 세웠다. (당론 ${lineOf(s, p.faction)}, 긴장 +3)`;
    },
  },
  {
    id: 'lead_soft',
    name: '당론을 누그러뜨린다 (온건)',
    desc: '당의 노선을 온건하게 정한다. 당론 −20. 온건한 이들의 호감 +4, 강경한 이들 −3. 긴장 −2, 왕의 경계가 풀린다. 반년에 한 번(강경과 함께).',
    check: (s) => (!isLeader(s) ? '당의 영수여야 한다' : cdLeft(s, 'line') ? `${cdLeft(s, 'line')}달 뒤에 다시 정할 수 있다` : s.player.ap < 1 ? '행동력이 부족하다' : null),
    run(s) {
      const p = P(s);
      s.player.ap -= 1;
      setCd(s, 'line', 6);
      s.line[p.faction] = clamp((s.line[p.faction] ?? 0) - 20, -100, 100);
      s.tension = clamp(s.tension - 2, 0, 100);
      kingLean(s, p.faction, 3);
      for (const c of members(s, p.faction)) {
        if (c.id === p.id) continue;
        if (c.traits.includes('mild') || c.traits.includes('mediator')) sway(s, c, p.id, 4, '온건한 당론', { decay: 0.05 });
        else if (c.traits.includes('radical')) sway(s, c, p.id, -3, '물러터진 당론', { decay: 0.05 });
      }
      log(s, `${FACTION_META[p.faction].name}의 영수 ${josa(p.name, '이/가')} 당론을 누그러뜨렸다.`, 'faction');
      return `당론을 누그러뜨렸다. (당론 ${lineOf(s, p.faction)}, 긴장 −2, 왕의 마음 +3)`;
    },
  },
  {
    id: 'lead_slate',
    name: '요직에 당의 사람을 민다',
    desc: '지금 벌어지는 자리 경쟁마다 우리 당 후보를 당론으로 민다. 영수와 당의 중진 둘이 지지에 이름을 올린다(후보마다 임용 점수 +6쯤). 석 달에 한 번.',
    check: (s) => (!isLeader(s) ? '당의 영수여야 한다' : cdLeft(s, 'slate') ? `${cdLeft(s, 'slate')}달 뒤에 다시 할 수 있다` : !partyRaces(s).length ? '우리 당 사람이 나선 자리 경쟁이 없다' : s.player.ap < 1 ? '행동력이 부족하다' : null),
    run(s) {
      const p = P(s);
      s.player.ap -= 1;
      setCd(s, 'slate', 3);
      const seniors = members(s, p.faction)
        .filter((c) => c.id !== p.id && c.rank <= 3 && inCourt(c))
        .sort((a, b) => influence(s, b) - influence(s, a))
        .slice(0, 2);
      const names: string[] = [];
      for (const { r, cand } of partyRaces(s)) {
        const list = r.backers[cand!.id];
        for (const id of [p.id, ...seniors.map((c) => c.id)]) if (!list.includes(id)) list.push(id);
        sway(s, cand!, p.id, 6, '당이 밀어 줌', { decay: 0.05 });
        names.push(cand!.name);
      }
      return `${names.join('·')}을 당론으로 밀었다. 중진 ${seniors.map((c) => c.name).join('·') || '없음'}이 함께 이름을 올렸다.`;
    },
  },
  {
    id: 'lead_unite',
    name: '당을 다독인다',
    desc: '재산 30으로 당의 사람들을 불러 잔치를 열고 서운한 이들을 달랜다. 같은 당 모두의 호감 +4, 동인이면 남북 갈등 −3. 반년에 한 번.',
    check: (s) => (!isLeader(s) ? '당의 영수여야 한다' : cdLeft(s, 'unite') ? `${cdLeft(s, 'unite')}달 뒤에 다시 할 수 있다` : P(s).wealth < 30 ? '재산 30이 든다' : s.player.ap < 1 ? '행동력이 부족하다' : null),
    run(s) {
      const p = P(s);
      s.player.ap -= 1;
      p.wealth -= 30;
      setCd(s, 'unite', 6);
      const fx = swayFaction(s, p.faction, p.id, 4, '영수의 잔치', 0.05);
      if (p.faction === 'dong') s.factions.dong.division = Math.max(0, s.factions.dong.division - 3);
      return `당의 사람들을 불러 잔치를 열었다. (재산 −30${fx ? `, ${fx}` : ''})`;
    },
  },
  {
    id: 'lead_discipline',
    name: '이견을 누른다',
    desc: '당론을 거스르는 중진 하나(같은 당에서 당신을 가장 꺼리는 당상관)를 공개로 꾸짖고 당의 일에서 뺀다. 그의 명망 −4, 그의 원한. 당론 +5. 다른 이들은 몸을 사려 호감 −2. 한 해에 한 번.',
    check: (s) => (!isLeader(s) ? '당의 영수여야 한다' : cdLeft(s, 'discipline') ? `${cdLeft(s, 'discipline')}달 뒤에 다시 할 수 있다` : !dissenter(s) ? '당론을 거스르는 중진이 없다' : s.player.ap < 1 ? '행동력이 부족하다' : null),
    run(s) {
      const p = P(s);
      s.player.ap -= 1;
      setCd(s, 'discipline', 12);
      const d = dissenter(s)!;
      d.prestige = clamp(d.prestige - 4, 0, 100);
      sway(s, d, p.id, -15, '영수에게 꾸지람을 들음', { decay: 0.05 });
      if (!d.grudges.includes(p.id)) d.grudges.push(p.id);
      swayFaction(s, p.faction, p.id, -2, '영수의 서슬', 0.05);
      s.line[p.faction] = clamp((s.line[p.faction] ?? 0) + 5, -100, 100);
      if (s.grandees?.[d.id]) delete s.grandees[d.id];
      log(s, `${FACTION_META[p.faction].name}의 영수 ${josa(p.name, '이/가')} 당론을 거스른 ${josa(d.name, '을/를')} 꾸짖어 당의 일에서 뺐다.`, 'faction');
      return `${josa(d.name, '을/를')} 꾸짖어 당의 일에서 뺐다. (그의 명망 −4, 그의 원한)`;
    },
  },
];

export const leadError = (s: GameState, id: LeadId) => LEAD_ACTIONS.find((a) => a.id === id)!.check(s);
export function runLead(s: GameState, id: LeadId): string {
  const a = LEAD_ACTIONS.find((x) => x.id === id)!;
  const err = a.check(s);
  return err ?? a.run(s);
}

/** 당내 서열: 영향력 순위와 영수와의 차이 */
export function partyRank(s: GameState): { rank: number; total: number; mine: number; leader?: string; his: number } | null {
  const p = P(s);
  if (p.faction === 'none') return null;
  const ms = members(s, p.faction).filter((c) => c.status !== 'dead').sort((a, b) => influence(s, b) - influence(s, a));
  const lead = s.factions[p.faction]?.leader;
  return { rank: ms.findIndex((c) => c.id === p.id) + 1, total: ms.length, mine: influence(s, p), leader: lead, his: lead ? influence(s, s.chars[lead]) : 0 };
}

/** 평판을 잃은 영수에게는 당 안에서 도전이 온다 */
function challengeLeader(s: GameState) {
  const p = P(s);
  if (!isLeader(s) || monthsSince(s, 'leaderChallengedAt') < 24) return;
  if (standing(s, p.faction) > -5 || !chance(s, 0.06)) return;
  const rival = members(s, p.faction)
    .filter((c) => c.id !== p.id && inCourt(c) && c.rank <= 3 && opinion(s, c, p) < 0)
    .sort((a, b) => influence(s, b) - influence(s, a))[0];
  if (!rival || influence(s, rival) < influence(s, p) * 0.7) return;
  s.flags.leaderChallengedAt = s.t;
  pushEvent(s, 'leader_defend', { rival: rival.id });
}

export const PARTY_EVENTS: Record<string, EventDef> = {
  leader_defend: {
    build(s, c) {
      const p = P(s);
      const r = s.chars[c.rival];
      return {
        title: '영수 자리가 흔들린다',
        kind: 'danger',
        text: `당 안에서 당신을 두고 말이 많다. 당론이 당을 그르친다는 것이다. ${officeTitle(r)} ${josa(r.name, '이/가')} 중진들을 모아 새 영수를 세우자고 한다.\n\n당의 평판 ${standing(s, p.faction)} · 당내 영향력 — 당신 ${influence(s, p)} : ${r.name} ${influence(s, r)}`,
        choices: [
          { key: 'fight', label: '맞서서 자리를 지킨다', hint: '영향력 + 주사위 대결. 지면 영수 자리를 잃고 두 해 동안 되찾기 어렵다. 이기면 그의 원한' },
          { key: 'yield', label: '자리를 내준다', hint: '영수에서 물러난다. 당의 호감 +5, 명망 +1 (물러날 줄 아는 사람)' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const r = s.chars[c.rival];
      if (!alive(r) || !isLeader(s)) return;
      const st = s.factions[p.faction];
      const lose = () => {
        st.leader = r.id;
        st.lockUntil = s.t + 24;
        s.flags.leaderBoostUntil = 0;
        log(s, `${josa(r.name, '이/가')} ${FACTION_META[p.faction].name}의 새 영수가 되었다.`, 'faction');
      };
      if (key === 'yield') {
        lose();
        swayFaction(s, p.faction, p.id, 5, '물러날 줄 앎', 0.05);
        p.prestige = clamp(p.prestige + 1, 0, 100);
        return `영수 자리를 ${r.name}에게 내주었다.`;
      }
      const a = influence(s, p) + d6(s) + d6(s);
      const b = influence(s, r) + d6(s) + d6(s);
      if (a >= b) {
        sway(s, r, p.id, -15, '영수 다툼', { decay: 0.05 });
        if (!r.grudges.includes(p.id)) r.grudges.push(p.id);
        return `중론이 당신 편에 섰다. 자리를 지켰다. (${Math.round(a)} : ${Math.round(b)})`;
      }
      lose();
      swayFaction(s, p.faction, p.id, -3, '영수 다툼', 0.05);
      p.prestige = clamp(p.prestige - 3, 0, 100);
      s.player.deeds.push(`${FACTION_META[p.faction].name}의 영수 자리를 잃음`);
      return `중론이 ${r.name}에게 기울었다. 영수 자리를 잃었다. (${Math.round(a)} : ${Math.round(b)}, 명망 −3)`;
    },
  },

  party_council: {
    build(s) {
      const p = P(s);
      const f = p.faction;
      const v = lineOf(s, f);
      return {
        title: `${FACTION_META[f].name}의 당론 회의`,
        kind: 'court',
        text: `${FACTION_META[f].name}의 요인들이 한 사랑방에 모였다. 상대 당을 몰아붙일 것인가, 숨을 고를 것인가를 두고 의견이 갈린다.\n\n지금 당론: ${lineLabel(v)} (${v})\n\n당론이 강경하면 우리 당이 논핵을 자주 벌이고 왕이 경계한다(환국 위험). 온건하면 상대 당에 밀릴 수 있다.`,
        choices: [
          { key: 'hard', label: '강경론을 편다', hint: `판정 (주사위 + 정치력 ${p.politics}${st(s) ? ' + 영수 3' : ''} ≥ 7). 통하면 당론 +15, 긴장 +3, 같은 당 강경파 호감 상승.` },
          { key: 'soft', label: '온건론을 편다', hint: `같은 판정. 통하면 당론 -15, 긴장 -2, 온건파 호감 상승.` },
          { key: 'quiet', label: '말을 아낀다', hint: '아무 일도 일어나지 않는다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const f = p.faction;
      if (key === 'quiet') return '말없이 듣기만 했다.';
      const r = d6(s) + p.politics + (st(s) ? 3 : 0);
      const dir = key === 'hard' ? 1 : -1;
      const fans = people(s).filter((c) => c.faction === f && !isP(s, c) && (key === 'hard' ? c.traits.includes('radical') : c.traits.includes('mild') || c.traits.includes('mediator')));
      if (r >= 7) {
        moveLine(s, f, 15 * dir);
        s.tension = clamp(s.tension + (dir > 0 ? 3 : -2), 0, 100);
        for (const c of fans) sway(s, c, p.id, 6, dir > 0 ? '강경론에 공감' : '온건론에 공감', { decay: 0.1 });
        log(s, `${FACTION_META[f].name}이 ${p.name}의 말을 따라 ${dir > 0 ? '강경' : '온건'}한 쪽으로 당론을 잡았다.`, 'faction');
        return `당신의 말이 당론이 되었다. (판정 ${r}, 당론 ${dir > 0 ? '+15' : '-15'} → ${lineLabel(lineOf(s, f))})`;
      }
      moveLine(s, f, -5 * dir);
      const fx = swayFaction(s, f, p.id, -2, '당론에서 밀림', 0.1);
      return `좌중을 설득하지 못했다. (판정 ${r}${fx ? `, ${fx}` : ''})`;
    },
  },

  leader_challenge: {
    build(s, c) {
      const p = P(s);
      const lead = s.chars[c.leader];
      const mine = influence(s, p);
      const his = influence(s, lead);
      return {
        title: '영수의 자리',
        kind: 'court',
        text: `당 안에서 당신을 따르는 사람이 부쩍 늘었다. 몇몇은 노골적으로 영수 ${lead.name}의 시대는 끝났다고 말한다.\n\n당내 영향력 — 당신 ${mine} : ${lead.name} ${his}`,
        choices: [
          { key: 'challenge', label: '영수 자리를 다툰다', hint: `영향력 + 주사위 대결. 이기면 2년 동안 영수로 떠오르기 쉽다(영향력 +6). 지면 같은 당 호감 -8, ${lead.name}의 원한.` },
          { key: 'support', label: '영수를 받든다', hint: `${lead.name}의 호감 +15, 그가 신세를 진다.` },
          { key: 'wait', label: '때를 기다린다', hint: '아무 일도 일어나지 않는다' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const lead = s.chars[c.leader];
      if (!alive(lead)) return;
      if (key === 'wait') return '때를 기다리기로 했다.';
      if (key === 'support') {
        sway(s, lead, p.id, 15, '영수를 받듦', { decay: 0.08 });
        s.player.debts[lead.id] = Math.min(3, (s.player.debts[lead.id] ?? 0) + 1);
        return `${josa(lead.name, '을/를')} 받들겠다고 했다. 그가 신세를 졌다.`;
      }
      const a = influence(s, p) + d6(s) + d6(s);
      const b = influence(s, lead) + d6(s) + d6(s);
      if (a > b) {
        s.flags.leaderBoostUntil = s.t + 24;
        updateLeaders(s);
        sway(s, lead, p.id, -20, '영수 자리를 빼앗김', { decay: 0.05 });
        s.player.deeds.push(`${FACTION_META[p.faction].name}의 영수 자리를 다툼`);
        return `당의 중론이 당신에게 기울었다. (${Math.round(a)} : ${Math.round(b)})`;
      }
      const fx = swayFaction(s, p.faction, p.id, -8, '분수를 모름', 0.08);
      sway(s, lead, p.id, -25, '영수 자리를 넘봄', { decay: 0.05 });
      if (!lead.grudges.includes(p.id)) lead.grudges.push(p.id);
      return `당은 ${josa(lead.name, '을/를')} 택했다. (${Math.round(a)} : ${Math.round(b)}${fx ? `, ${fx}` : ''})`;
    },
  },

  dong_wing: {
    build(s) {
      // 지금 동인 안에서 각 노선을 대표하는 이들 (플레이어는 빼고)
      const wing = (w: 'nam' | 'buk') =>
        people(s)
          .filter((c) => c.faction === 'dong' && c.lean === w && !isP(s, c))
          .sort((a, b) => b.prestige + b.politics * 5 - (a.prestige + a.politics * 5))
          .slice(0, 2)
          .map((c) => c.name);
      const nam = wing('nam');
      const buk = wing('buk');
      const namTxt = nam.length ? `퇴계 문하의 ${nam.join('·')}` : '퇴계 문하의 선비들';
      const bukTxt = buk.length ? `남명·화담 문하의 ${buk.join('·')}` : '남명·화담 문하의 선비들';
      return {
        title: '갈라지는 동인',
        kind: 'court',
        text: `동인 안에서 두 목소리가 커진다. ${josa(namTxt, '은/는')} 서인을 너그럽게 대하자 하고, ${josa(bukTxt, '은/는')} 서인을 뿌리 뽑자고 한다.\n\n당이 아직 하나일 때 어느 쪽과 가까이할지 정해 둘 수 있다. 일찍 정할수록 그쪽 사람들이 당신을 믿는다.`,
        choices: [
          { key: 'nam', label: nam[0] ? `${nam[0]} 쪽(온건파)과 가까이한다` : '온건파와 가까이한다', hint: '온건파 호감 +8, 강경파 호감 -5. 분당 때 남인을 고르면 더 환영받는다.' },
          { key: 'buk', label: buk[0] ? `${buk[0]} 쪽(강경파)과 가까이한다` : '강경파와 가까이한다', hint: '강경파 호감 +8, 온건파 호감 -5. 분당 때 북인을 고르면 더 환영받는다.' },
          { key: 'mediate', label: '양쪽을 중재한다', hint: '동인 분열 -4, 명망 +2. 양쪽 모두 호감 -2.' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const dongs = people(s).filter((c) => c.faction === 'dong' && !isP(s, c));
      if (key === 'mediate') {
        s.factions.dong.division = Math.max(0, s.factions.dong.division - 4);
        p.prestige = clamp(p.prestige + 2, 0, 100);
        for (const c of dongs) sway(s, c, p.id, -2, '어정쩡한 중재', { decay: 0.1 });
        return '양쪽을 오가며 다툼을 누그러뜨렸다. (동인 분열 -4, 명망 +2)';
      }
      const w = key === 'buk' ? 'buk' : 'nam';
      s.flags.wing = w;
      p.lean = w;
      for (const c of dongs) {
        if (c.lean === w) sway(s, c, p.id, 8, '같은 길', { decay: 0.05 });
        else if (c.lean) sway(s, c, p.id, -5, '다른 길', { decay: 0.05 });
      }
      return `${w === 'nam' ? '류성룡' : '이산해'} 쪽과 가까이하기로 했다.`;
    },
  },
};

const st = (s: GameState) => {
  const p = P(s);
  return p.faction !== 'none' && s.factions[p.faction].leader === p.id;
};
