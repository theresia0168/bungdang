import type { Character, GameState } from '../types';
import type { EventDef } from './types';
import { OK } from './types';
import { OFFICE_MAP } from '../data/offices';
import { REGION_META, SCHOOL_META } from '../data/meta';
import { chance, d6, pick, weighted } from '../rng';
import { addFlaw, age, alive, clamp, inCourt, isP, josa, P, people, pushEvent } from '../state';
import { addMod, opinion, sway, swayFaction } from '../opinion';
import { vacate } from '../court';
import { monthOf, shortDate, yearOf } from '../calendar';
import { SALLIM_ROLLS } from './sallim';

interface PersonalRoll {
  id: string;
  /** 같은 사건이 다시 일어나기까지 최소 개월 (기본 12) */
  cooldown?: number;
  weight(s: GameState): number;
  prepare?(s: GameState): Record<string, any> | null;
}

const ROLLS: PersonalRoll[] = [
  { id: 'p_illness', weight: (s) => (s.player.sick ? 0 : age(s, P(s)) >= 45 ? 1 + (age(s, P(s)) - 45) / 10 : 0.4) },
  {
    id: 'p_bribe',
    weight: (s) => {
      const p = P(s);
      return p.status === 'active' && (p.office?.startsWith('gamsa_') || p.office === 'suryeong' || p.rank <= 5) ? 1.2 : 0;
    },
  },
  {
    id: 'p_poetry',
    weight: (s) => (P(s).status === 'exiled' ? 0 : 1),
    prepare(s) {
      const p = P(s);
      const near = people(s).filter((c) => !isP(s, c) && c.location === p.location && c.status !== 'exiled');
      if (near.length < 2) return null;
      const picked: Character[] = [];
      for (let i = 0; i < 6 && picked.length < 3; i++) {
        const c = weighted(s, near.map((c) => [c, c.faction === p.faction ? 3 : 1] as [Character, number]));
        if (c && !picked.includes(c)) picked.push(c);
      }
      return { attendees: picked.map((c) => c.id) };
    },
  },
  {
    id: 'p_disciple',
    weight: (s) => {
      const p = P(s);
      return p.prestige >= 30 && p.learning >= 4 && p.status !== 'exiled' ? 0.8 : 0;
    },
  },
  { id: 'p_child', weight: (s) => (age(s, P(s)) >= 32 && age(s, P(s)) <= 62 && s.player.children < 2 ? 0.6 : 0) },
  {
    id: 'p_slander',
    weight: () => 0.8,
    prepare(s) {
      const p = P(s);
      const foes = people(s).filter((c) => !isP(s, c) && inCourt(c) && opinion(s, c, p) <= -25);
      return foes.length ? { enemy: pick(s, foes).id } : null;
    },
  },
  { id: 'p_famine', weight: (s) => ((s.regions[P(s).home].harvest ?? 0) < 0 ? 2 : 0), prepare: (s) => ({ region: P(s).home }) },
];

const examSoon = (s: GameState) => {
  const y = yearOf(s.t);
  return monthOf(s.t) === 2 && (y - 1576) % 3 === 0;
};

ROLLS.push(
  {
    id: 'p_mourning',
    weight: (s) => (!s.flags.mourned && age(s, P(s)) >= 30 && age(s, P(s)) <= 58 && P(s).status !== 'exiled' ? 0.45 : 0),
  },
  {
    id: 'p_examiner',
    weight: (s) => {
      const p = P(s);
      return examSoon(s) && p.status === 'active' && p.rank <= 4 && p.location === 'hanseong' ? 6 : 0;
    },
  },
  { id: 'p_kin_crime', weight: (s) => (P(s).status === 'exiled' ? 0 : 0.6) },
  {
    id: 'p_slave_suit',
    weight: () => 0.5,
    prepare(s) {
      const p = P(s);
      const near = people(s).filter((c) => !isP(s, c) && c.clan !== p.clan && (c.home === p.home || c.location === p.location) && c.status !== 'exiled');
      return near.length ? { other: pick(s, near).id } : null;
    },
  },
  {
    id: 'p_envoy',
    weight: (s) => {
      const p = P(s);
      return p.rank <= 3 && inCourt(p) && s.player.abroadUntil <= s.t && !s.flags[`envoy_${yearOf(s.t)}`] ? 0.7 : 0;
    },
  },
  {
    id: 'p_debate',
    weight: (s) => (P(s).learning >= 4 && P(s).status !== 'exiled' ? 0.6 : 0),
    prepare(s) {
      const p = P(s);
      const pool = people(s).filter((c) => !isP(s, c) && c.learning >= 4 && c.school !== p.school && c.school !== 'none');
      return pool.length ? { other: pick(s, pool).id } : null;
    },
  },
  ...SALLIM_ROLLS,
);

export function rollPersonal(s: GameState) {
  // 조정 사건이 드문 낙향·유배 중에는 개인 사건이 더 자주 온다
  const away = P(s).status === 'retired' || P(s).status === 'exiled';
  if (!alive(P(s)) || !chance(s, away ? 0.2 : 0.12)) return;
  const last = s.player.eventAt;
  const pool = ROLLS.filter((r) => s.t - (last[r.id] ?? -999) >= (r.cooldown ?? 12))
    .map((r) => [r, r.weight(s)] as [PersonalRoll, number])
    .filter(([, w]) => w > 0);
  const r = weighted(s, pool);
  if (!r) return;
  const ctx = r.prepare ? r.prepare(s) : {};
  if (!ctx) return;
  last[r.id] = s.t;
  pushEvent(s, r.id, ctx);
}

export const PERSONAL_EVENTS: Record<string, EventDef> = {
  p_illness: {
    build: (s) => ({
      title: '몸져눕다',
      kind: 'personal',
      text: '오한과 기침이 그치지 않는다. 의원은 몸을 돌보지 않으면 큰 병이 될 것이라 한다.\n\n병중에는 천명 판정에 -1이 붙는다.',
      choices: [
        { key: 'rest', label: '요양에 전념한다', hint: '현재 활동을 멈추고 요양한다.' },
        { key: 'doctor', label: '명의를 부른다 (재산 30)', hint: '병이 바로 낫는다.', disabled: P(s).wealth < 30 ? '재산이 부족하다' : undefined },
        { key: 'ignore', label: '일을 놓지 않는다', hint: '30% 확률로 강건이 영구히 1 줄어든다.' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'doctor') {
        p.wealth -= 30;
        return '의원의 처방으로 금세 털고 일어났다.';
      }
      s.player.sick = true;
      if (key === 'rest') {
        return '요양에 들어갔다.';
      }
      if (chance(s, 0.3) && p.vigor > 1) {
        p.vigor--;
        return '무리한 탓에 몸이 상했다. 강건 -1';
      }
      return '병을 안고 일을 계속한다.';
    },
  },

  p_bribe: {
    build: () => ({
      title: '은밀한 청탁',
      kind: 'personal',
      text: '한 상인이 밤늦게 찾아와 방납 이권을 봐 달라며 은자 꾸러미를 내밀었다. 아무도 보지 않았다.',
      choices: [
        { key: 'take', label: '받는다', hint: '재산 +30, 숨은 흠결 1' },
        { key: 'refuse', label: '물리친다', hint: '명망 +2 (강직하면 +4)' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'take') {
        p.wealth += 30;
        addFlaw(s, p, '뇌물 수수');
        return '은자를 받았다. 재산 +30';
      }
      p.prestige = clamp(p.prestige + (p.traits.includes('upright') ? 4 : 2), 0, 100);
      return '상인을 꾸짖어 돌려보냈다.';
    },
  },

  p_poetry: {
    build(s, c) {
      const names = (c.attendees as string[]).map((id) => s.chars[id]?.name).filter(Boolean);
      return {
        title: '시회(詩會)',
        kind: 'personal',
        text: `${REGION_META[P(s).location].short}의 선비들이 시회를 연다며 당신을 청했다. ${names.join(', ')} 등이 온다고 한다.`,
        choices: [
          { key: 'go', label: '참석한다 (재산 5)', hint: '참석자 호감 +6, 그 가문 호감 소폭 상승' },
          { key: 'no', label: '사양한다' },
        ],
      };
    },
    resolve(s, c, key) {
      if (key !== 'go') return;
      const p = P(s);
      p.wealth = Math.max(0, p.wealth - 5);
      const fx: string[] = [];
      for (const id of c.attendees as string[]) {
        const t = s.chars[id];
        if (alive(t)) fx.push(...sway(s, t, p.id, 6, '시회', { clan: 0.2, decay: 0.2, cap: 15 }));
      }
      if (p.traits.includes('writer')) p.prestige = clamp(p.prestige + 2, 0, 100);
      return fx.join(', ');
    },
  },

  p_disciple: {
    build: () => ({
      title: '배움을 청하는 선비',
      kind: 'personal',
      text: '젊은 선비 하나가 당신의 명성을 듣고 찾아와 제자가 되기를 청한다. 문인은 식년시에 응시하며, 급제하면 당신의 사람이 된다.',
      choices: [
        { key: 'yes', label: '제자로 받는다', hint: '문인 +1' },
        { key: 'no', label: '돌려보낸다' },
      ],
    }),
    resolve(s, _c, key) {
      if (key !== 'yes') return;
      s.player.disciples++;
      return `문인이 ${s.player.disciples}명이 되었다.`;
    },
  },

  p_child: {
    build: () => ({
      title: '혼기에 이른 자녀',
      kind: 'personal',
      text: '자녀가 혼기에 이르렀다. 어느 가문과 사돈을 맺느냐에 따라 앞날이 달라질 것이다. 인물 창에서 혼담을 넣을 수 있다.',
      choices: OK,
    }),
    resolve(s) {
      s.player.children++;
    },
  },

  p_slander: {
    build(s, c) {
      const e = s.chars[c.enemy];
      return {
        title: '비방',
        kind: 'personal',
        text: `${josa(e.name, '이/가')} 당신을 헐뜯는 말을 퍼뜨리고 다닌다.`,
        choices: [
          { key: 'rebut', label: '반박하는 글을 돌린다', hint: '주사위 + 정치력 대결. 이기면 그의 명망 -4, 지면 당신 명망 -3' },
          { key: 'ignore', label: '무시한다', hint: '명망 -2' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const e = s.chars[c.enemy];
      if (key === 'ignore' || !alive(e)) {
        p.prestige = clamp(p.prestige - 2, 0, 100);
        return;
      }
      const a = d6(s) + p.politics;
      const b = d6(s) + e.politics;
      if (a >= b) {
        e.prestige = clamp(e.prestige - 4, 0, 100);
        return `반박이 먹혔다 (${a} 대 ${b}). ${e.name}의 명망 -4`;
      }
      p.prestige = clamp(p.prestige - 3, 0, 100);
      return `오히려 말이 더 퍼졌다 (${a} 대 ${b}). 명망 -3`;
    },
  },

  p_famine: {
    build(s, c) {
      const r = REGION_META[c.region as keyof typeof REGION_META];
      return {
        title: '흉년',
        kind: 'personal',
        text: `고향 ${r.short}에 큰 가뭄이 들어 굶주리는 백성이 늘었다. 고향 사람들이 당신을 바라본다.`,
        choices: [
          { key: 'relief', label: '곳간을 열어 구휼한다 (재산 20)', hint: '명망 +4, 민심 +5, 고향에서 당세 +2', disabled: P(s).wealth < 20 ? '재산이 부족하다' : undefined },
          { key: 'ignore', label: '형편이 어렵다', hint: '고향 민심 -3' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const r = s.regions[c.region as keyof typeof s.regions];
      if (key === 'relief') {
        p.wealth -= 20;
        p.prestige = clamp(p.prestige + 4, 0, 100);
        r.minsim = clamp(r.minsim + 5, 0, 100);
        if (p.faction !== 'none') r.influence[p.faction] = (r.influence[p.faction] ?? 0) + 2;
        return '곳간을 열었다. 고향에서 칭송이 자자하다.';
      }
      r.minsim = clamp(r.minsim - 3, 0, 100);
    },
  },

  p_mourning: {
    build(s) {
      const p = P(s);
      const canReturn = p.status === 'active' && !!p.office && p.rank <= 3;
      return {
        title: '부친상(父親喪)',
        kind: 'personal',
        text: '고향에서 부친이 돌아가셨다는 기별이 왔다. 예법대로라면 벼슬을 내려놓고 3년(27개월) 동안 무덤 곁에서 시묘해야 한다.',
        choices: [
          { key: 'full', label: '벼슬을 내려놓고 시묘한다', hint: '낙향하고 27개월 동안 한성에 올라갈 수 없다. 명망 +6. 고향에서 강학할 수 있다.' },
          {
            key: 'gibok',
            label: '왕명을 받들어 기복출사(起復出仕)한다',
            hint: '자리를 지킨다. 성심 +3, 명망 -5 (강직하면 -8)',
            disabled: canReturn ? undefined : '당상관으로 재직 중일 때만 왕이 기복을 명한다',
          },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      s.flags.mourned = true;
      if (key === 'gibok') {
        p.favor = clamp(p.favor + 3, -100, 100);
        p.prestige = clamp(p.prestige - (p.traits.includes('upright') ? 8 : 5), 0, 100);
        return '상복을 입은 채 조정에 나갔다. 사림의 눈길이 곱지 않다.';
      }
      if (p.office) vacate(s, p, 'retired');
      p.status = p.status === 'exiled' ? p.status : 'retired';
      p.location = p.status === 'exiled' ? p.location : p.home;
      p.banUntil = Math.max(p.banUntil ?? 0, s.t + 27);
      s.flags.mournUntil = s.t + 27;
      p.prestige = clamp(p.prestige + 6, 0, 100);
      s.player.deeds.push(`${shortDate(s.t)} 부친상, 시묘`);
      return '고향으로 내려가 여막을 짓고 시묘를 시작했다.';
    },
  },

  p_examiner: {
    build(s) {
      return {
        title: '과장(科場)의 시관',
        kind: 'court',
        text: '다음 달 식년시의 시관(試官)으로 뽑혔다. 누구를 붙이고 누구를 떨어뜨릴지가 당신 손에 달렸다.',
        choices: [
          { key: 'fair', label: '공정하게 채점한다', hint: '명망 +2' },
          { key: 'faction', label: '같은 당 선비의 답안을 후하게 본다', hint: '급제자 가운데 같은 당이 늘고 당내 호감 +5. 35% 확률로 「과장 부정」 흠결' },
          {
            key: 'leak',
            label: '문인에게 시제(試題)를 흘린다',
            hint: '이번 시험에서 문인의 급제 판정 +3. 50% 확률로 「시제 누설」 흠결',
            disabled: s.player.disciples ? undefined : '문인이 없다',
          },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'fair') {
        p.prestige = clamp(p.prestige + 2, 0, 100);
        return '사사로움 없이 채점했다.';
      }
      if (key === 'faction') {
        s.flags.examBias = p.faction;
        if (p.faction !== 'none') swayFaction(s, p.faction, p.id, 5, '과장의 은혜', 0.1);
        if (chance(s, 0.35)) addFlaw(s, p, '과장(科場) 부정');
        return '같은 당 선비들의 답안에 후한 점수를 주었다.';
      }
      s.flags.examLeak = true;
      if (chance(s, 0.5)) addFlaw(s, p, '시제 누설');
      return '문인들에게 넌지시 시제를 일러 주었다.';
    },
  },

  p_kin_crime: {
    build(s) {
      const p = P(s);
      return {
        title: '일가의 행패',
        kind: 'personal',
        text: `고향 ${REGION_META[p.home].short}에서 ${p.clan.split(' ')[1] ?? p.clan} 일가 하나가 당신의 세도를 믿고 이웃의 논밭을 빼앗았다는 고발이 들어왔다. 수령은 당신의 눈치만 본다.`,
        choices: [
          { key: 'cover', label: '조용히 덮는다', hint: '숨은 흠결 「친족의 비리」' },
          { key: 'punish', label: '엄히 다스리라고 수령에게 이른다', hint: '명망 +3, 일가의 원망' },
          { key: 'pay', label: '재산 20으로 물어 주고 타이른다', hint: '명망 +1, 고향 민심 +3', disabled: p.wealth < 20 ? '재산이 모자란다' : undefined },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'cover') {
        addFlaw(s, p, '친족의 비리');
        return '일은 조용히 묻혔다. 적어도 지금은.';
      }
      if (key === 'punish') {
        p.prestige = clamp(p.prestige + 3, 0, 100);
        addMod(s, 'clan', p.clan, p.id, '일가를 벌함', -8, 0.1);
        return '일가를 엄히 다스리게 했다. 문중 어른들이 서운해한다.';
      }
      p.wealth -= 20;
      p.prestige = clamp(p.prestige + 1, 0, 100);
      s.regions[p.home].minsim = clamp(s.regions[p.home].minsim + 3, 0, 100);
      return '빼앗은 땅값을 물어 주고 일가를 타일렀다.';
    },
  },

  p_slave_suit: {
    build(s, c) {
      const o = s.chars[c.other];
      return {
        title: '노비 송사',
        kind: 'personal',
        text: `도망친 노비 몇 명의 소유를 두고 ${o.clan}의 ${o.name} 집안과 송사가 붙었다. 문서가 오래되어 어느 쪽도 확실하지 않다.`,
        choices: [
          { key: 'yield', label: '양보한다', hint: `${o.name} 호감 +10, 재산 -10` },
          { key: 'fight', label: '끝까지 다툰다', hint: `주사위 + 정치력 대결. 이기면 재산 +20, 지면 명망 -2. 어느 쪽이든 ${o.name} 호감이 떨어진다` },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const o = s.chars[c.other];
      if (!alive(o)) return;
      if (key === 'yield') {
        p.wealth = Math.max(0, p.wealth - 10);
        return sway(s, o, p.id, 10, '송사를 양보', { clan: 0.3, decay: 0.1 }).join(', ');
      }
      const a = d6(s) + p.politics;
      const b = d6(s) + o.politics;
      if (a >= b) {
        p.wealth += 20;
        return `송사에서 이겼다 (${a} 대 ${b}). 재산 +20. (${sway(s, o, p.id, -15, '송사', { clan: 0.3, decay: 0.1 }).join(', ')})`;
      }
      p.prestige = clamp(p.prestige - 2, 0, 100);
      return `송사에서 졌다 (${a} 대 ${b}). 명망 -2. (${sway(s, o, p.id, -8, '송사', { clan: 0.3, decay: 0.1 }).join(', ')})`;
    },
  },

  p_envoy: {
    build(s) {
      const p = P(s);
      return {
        title: '연행(燕行)',
        kind: 'court',
        text: '명나라 황제의 생일을 하례하는 성절사(聖節使)로 당신이 거론된다. 북경까지 오가는 데 다섯 달이 걸리는 고된 길이지만, 사행은 큰 영예이고 무역으로 남는 것도 있다.',
        choices: [
          {
            key: 'go',
            label: '사행길에 오른다',
            hint: `성심 +6, 명망 +2, 재산 +25. 다섯 달 동안 서신만 보낼 수 있다.${p.vigor <= 2 ? ' 몸이 약해 병을 얻을 수 있다.' : ''}`,
          },
          { key: 'no', label: '병을 핑계로 사양한다', hint: '성심 -3' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      s.flags[`envoy_${yearOf(s.t)}`] = true;
      if (key === 'no') {
        p.favor = clamp(p.favor - 3, -100, 100);
        return '사행을 사양했다.';
      }
      s.player.abroadUntil = s.t + 5;
      p.favor = clamp(p.favor + 6, -100, 100);
      p.prestige = clamp(p.prestige + 2, 0, 100);
      p.wealth += 25;
      if (p.vigor <= 2 && chance(s, 0.35)) s.player.sick = true;
      s.player.deeds.push(`${shortDate(s.t)} 성절사로 북경에 감`);
      s.player.ap = Math.min(s.player.ap, 1);
      return '압록강을 건너 북경으로 향했다. 다섯 달 뒤에 돌아온다.';
    },
  },

  p_debate: {
    build(s, c) {
      const o = s.chars[c.other];
      return {
        title: '서신 논변',
        kind: 'personal',
        text: `${SCHOOL_META[o.school].name}의 ${josa(o.name, '이/가')} 이기(理氣)와 사단칠정(四端七情)에 관한 당신의 글을 반박하는 편지를 보내왔다. 사림이 두 사람의 논변을 지켜본다.`,
        choices: [
          { key: 'win', label: '조목조목 반박한다', hint: '주사위 + 학식 대결. 이기면 명망 +4, 지면 명망 -2. 학식 경험 +5' },
          { key: 'respect', label: '서로의 견해를 존중하며 왕복한다', hint: `${o.name} 호감 +8, 학식 경험 +3` },
          { key: 'no', label: '답하지 않는다' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const o = s.chars[c.other];
      if (key === 'no' || !alive(o)) return;
      if (key === 'respect') {
        s.player.exp.learning += 3;
        return sway(s, o, p.id, 8, '학문의 벗', { decay: 0.1 }).join(', ');
      }
      s.player.exp.learning += 5;
      const a = d6(s) + p.learning;
      const b = d6(s) + o.learning;
      if (a >= b) {
        p.prestige = clamp(p.prestige + 4, 0, 100);
        sway(s, o, p.id, -5, '논변에서 짐', { decay: 0.15 });
        return `논변에서 이겼다 (${a} 대 ${b}). 명망 +4`;
      }
      p.prestige = clamp(p.prestige - 2, 0, 100);
      return `상대의 논리가 더 정밀했다 (${a} 대 ${b}). 명망 -2`;
    },
  },

  p_audience: {
    build: () => ({
      title: '경연(經筵)',
      kind: 'court',
      text: '경연 자리에서 왕이 당신에게 지금의 폐단이 무엇인지 물었다. 좌우의 신하들이 숨을 죽인다.',
      choices: [
        { key: 'blunt', label: '직언한다', hint: '성심 -5, 명망 +4 (강직하면 +6)' },
        { key: 'flatter', label: '왕의 뜻에 맞춘다', hint: '성심 +6, 명망 -2' },
        { key: 'learned', label: '경전을 들어 답한다', hint: '학식 5 이상이면 성심 +5, 명망 +2. 아니면 성심 -2' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'blunt') {
        p.favor = clamp(p.favor - 5, -100, 100);
        p.prestige = clamp(p.prestige + (p.traits.includes('upright') ? 6 : 4), 0, 100);
      } else if (key === 'flatter') {
        p.favor = clamp(p.favor + 6, -100, 100);
        p.prestige = clamp(p.prestige - 2, 0, 100);
      } else if (p.learning >= 5) {
        p.favor = clamp(p.favor + 5, -100, 100);
        p.prestige = clamp(p.prestige + 2, 0, 100);
        return '왕이 고개를 끄덕였다.';
      } else {
        p.favor = clamp(p.favor - 2, -100, 100);
        return '왕이 지루한 기색을 보였다.';
      }
    },
  },
};
