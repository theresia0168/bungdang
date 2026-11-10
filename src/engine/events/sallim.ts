import type { GameState } from '../types';
import type { EventDef } from './types';
import { FACTION_META, REGION_META } from '../data/meta';
import { chance, pick } from '../rng';
import { clamp, fav, inCourt, isP, P, people, pres } from '../state';
import { sway, swayFaction } from '../opinion';
import { mourningLeft } from '../actions';

/* ───────── 산림과 유배지의 나날 ─────────
 * 낙향·시묘·유배 중에는 조정의 사건이 거의 오지 않는다. 그 빈 시간을 채우는 개인 사건들.
 */

export interface SallimRoll {
  id: string;
  cooldown?: number;
  weight(s: GameState): number;
  prepare?(s: GameState): Record<string, any> | null;
}

const retired = (s: GameState) => P(s).status === 'retired';

export const SALLIM_ROLLS: SallimRoll[] = [
  {
    id: 'p_summon',
    cooldown: 18,
    weight: (s) => {
      const p = P(s);
      return retired(s) && !mourningLeft(s) && (p.banUntil ?? 0) <= s.t && p.prestige >= 35 && !p.traits.includes('seoeol') ? 1.5 : 0;
    },
  },
  {
    id: 'p_sallim',
    cooldown: 14,
    weight: (s) => (retired(s) && P(s).faction !== 'none' ? 1.2 : 0),
  },
  {
    id: 'p_mourn_guest',
    cooldown: 8,
    weight: (s) => (retired(s) && mourningLeft(s) > 0 ? 2 : 0),
    prepare(s) {
      const p = P(s);
      const guests = people(s).filter((c) => !isP(s, c) && inCourt(c) && c.faction === p.faction && p.faction !== 'none').slice(0, 40);
      return guests.length ? { who: pick(s, guests).id } : {};
    },
  },
  {
    id: 'p_exile_pen',
    cooldown: 10,
    weight: (s) => (P(s).status === 'exiled' ? 2.5 : 0),
  },
];

export const SALLIM_EVENTS: Record<string, EventDef> = {
  p_summon: {
    build(s) {
      const p = P(s);
      return {
        title: '조정의 부름',
        kind: 'court',
        text: `산림에 묻혀 지내는 ${p.name}의 이름이 경연에서 거론되었다. 왕이 "그만한 선비를 어찌 초야에 버려두는가" 하며 역마를 보내 불러올리라 명했다.`,
        choices: [
          { key: 'go', label: '부름에 응해 상경한다', hint: '한성에서 보직을 기다린다. 6개월간 임용 점수 +8, 성심 +3.' },
          { key: 'stay', label: '산림에 남겠다는 상소를 올린다', hint: `명망 +3${p.faction !== 'none' ? `, ${FACTION_META[p.faction].name} 호감 +2` : ''}. 지조를 지킨 선비로 이름이 난다.` },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'go') {
        p.status = 'idle';
        p.location = 'hanseong';
        if (s.player.focus?.kind === 'teach') s.player.focus = null;
        s.recs[p.id] = s.t + 6;
        fav(p, 3);
        return '역마를 타고 한성으로 올라왔다. (6개월간 임용 점수 +8, 성심 +3)';
      }
      pres(p, 3);
      const fx = swayFaction(s, p.faction, p.id, 2, '산림의 지조', 0.05);
      return `산림에 남겠다는 상소를 올렸다. (명망 +3${fx ? `, ${fx}` : ''})`;
    },
  },

  p_sallim: {
    build(s) {
      const p = P(s);
      const f = FACTION_META[p.faction].name;
      return {
        title: '산림의 공론',
        kind: 'personal',
        text: `${f}의 젊은 선비 몇이 ${REGION_META[p.home].short}의 집까지 찾아와 당의 갈 길을 묻는다. 조정에서 물러난 몸이지만 산림의 한마디는 아직 무게가 있다.`,
        choices: [
          { key: 'hard', label: '상대 당을 몰아붙여야 한다고 말한다', hint: `${f} 당론 +10 (강경), 긴장 +2, ${f} 호감 +2` },
          { key: 'soft', label: '숨을 고르고 화합해야 한다고 말한다', hint: `${f} 당론 -10 (온건), 긴장 -2, 명망 +1` },
          { key: 'book', label: '정치 이야기는 접고 경전만 논한다', hint: '학식 경험 +6' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const f = p.faction;
      if (key === 'book') {
        s.player.exp.learning += 6;
        return '밤새 경전을 논했다. (학식 경험 +6)';
      }
      const dir = key === 'hard' ? 1 : -1;
      s.line[f] = clamp((s.line[f] ?? 0) + 10 * dir, -60, 60);
      s.tension = clamp(s.tension + 2 * dir, 0, 100);
      if (dir > 0) return `산림의 강경론이 도성에 전해졌다. (${swayFaction(s, f, p.id, 2, '산림의 강경론', 0.08)}, 긴장 +2)`;
      pres(p, 1);
      return '산림의 온건론이 도성에 전해졌다. (긴장 -2, 명망 +1)';
    },
  },

  p_mourn_guest: {
    build(s, c) {
      const g = c.who ? s.chars[c.who] : undefined;
      return {
        title: '여막의 손님',
        kind: 'personal',
        text: g
          ? `시묘하는 여막에 ${g.name}(${FACTION_META[g.faction].name})이 문상을 왔다. 조정 소식을 전하며 은근히 당신의 뜻을 떠본다.`
          : '시묘하는 여막에 고을 선비들이 찾아와 예법을 묻는다.',
        choices: [
          ...(g ? [{ key: 'talk', label: '조정의 일을 함께 논한다', hint: `${g.name} 호감 +10, 정치 경험 +3` }] : []),
          { key: 'rite', label: '상중이니 예법만 이야기한다', hint: '명망 +2, 학식 경험 +3' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const g = c.who ? s.chars[c.who] : undefined;
      if (key === 'talk' && g && g.status !== 'dead') {
        s.player.exp.politics += 3;
        const fx = sway(s, g, p.id, 10, '여막의 정담', { decay: 0.1 });
        return `조정의 일을 밤늦도록 논했다. (${fx.join(', ')}, 정치 경험 +3)`;
      }
      pres(p, 2);
      s.player.exp.learning += 3;
      return '상례(喪禮)를 정성껏 이야기했다. 선비들이 감복했다. (명망 +2, 학식 경험 +3)';
    },
  },

  p_exile_pen: {
    build(s) {
      const p = P(s);
      return {
        title: '유배지의 붓',
        kind: 'personal',
        text: `${p.exilePlace ?? '유배지'}의 초가에서 맞는 또 한 철. 찾아오는 이도 드물고 할 일도 없다. 남은 것은 붓과 종이뿐이다.`,
        choices: [
          { key: 'write', label: '경전에 주석을 단다', hint: '학식 경험 +10, 명망 +2' },
          { key: 'teach', label: '고을 아이들을 가르친다', hint: `문인 +1, 명망 +1${p.faction !== 'none' ? `, 이 고장 ${FACTION_META[p.faction].name} 당세 +2` : ''}` },
          { key: 'poem', label: '임금을 그리는 시를 지어 올려 보낸다', hint: '성심을 되찾을 수 있다 (60%: 성심 +6, 40%: 원망으로 읽혀 성심 -4). 명망 +2.' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'write') {
        s.player.exp.learning += 10;
        pres(p, 2);
        return '주석이 한 권 분량으로 쌓였다. (학식 경험 +10, 명망 +2)';
      }
      if (key === 'teach') {
        s.player.disciples++;
        pres(p, 1);
        if (p.faction !== 'none') {
          const r = s.regions[p.location];
          r.influence[p.faction] = (r.influence[p.faction] ?? 0) + 2;
        }
        return `고을 아이들 가운데 쓸 만한 재목이 있다. (문인 ${s.player.disciples}명)`;
      }
      pres(p, 2);
      if (chance(s, 0.6)) {
        fav(p, 6);
        return '시를 읽은 왕이 한동안 말이 없었다고 한다. 마음이 조금 풀린 듯하다. (성심 +6, 명망 +2)';
      }
      fav(p, -4);
      return '시 한 구절이 원망으로 읽혔다. (성심 -4, 명망 +2)';
    },
  },
};
