import type { FactionId, GameState } from './types';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { tOf } from './calendar';
import { chance, d6 } from './rng';
import { monthsSince, alive, clamp, inCourt, isP, josa, log, P, people, pushEvent } from './state';
import { sway, swayFaction } from './opinion';
import { influence, updateLeaders } from './factions';
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

export const PARTY_EVENTS: Record<string, EventDef> = {
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
    build() {
      return {
        title: '갈라지는 동인',
        kind: 'court',
        text: '동인 안에서 두 목소리가 커진다. 퇴계 문하의 류성룡·우성전은 서인을 너그럽게 대하자 하고, 남명·화담 문하의 이산해·정인홍은 서인을 뿌리 뽑자고 한다.\n\n당이 아직 하나일 때 어느 쪽과 가까이할지 정해 둘 수 있다. 일찍 정할수록 그쪽 사람들이 당신을 믿는다.',
        choices: [
          { key: 'nam', label: '류성룡 쪽(온건파)과 가까이한다', hint: '온건파 호감 +8, 강경파 호감 -5. 분당 때 남인을 고르면 더 환영받는다.' },
          { key: 'buk', label: '이산해 쪽(강경파)과 가까이한다', hint: '강경파 호감 +8, 온건파 호감 -5. 분당 때 북인을 고르면 더 환영받는다.' },
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
