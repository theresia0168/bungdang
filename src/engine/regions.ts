import type { Character, GameState, RegionId } from './types';
import type { Choice, EventDef } from './events/types';
import { REGION_META } from './data/meta';
import { monthOf, tOf } from './calendar';
import { chance, d6, pick, weighted } from './rng';
import { addFlaw, alive, clamp, inCourt, isP, josa, log, notice, officeTitle, owe, P, people, pushEvent } from './state';
import { sway, swayFaction } from './opinion';

/* ───────── 도별 살림 ───────── */

export interface RegionEcon {
  /** 평년 한 해 공납에서 관찰사가 손댈 수 있는 재물의 크기 */
  yield: number;
  produce: string;
  /** 작황이 들쭉날쭉한 정도 */
  volatile: number;
  hazard: string;
}

export const REGION_ECON: Record<RegionId, RegionEcon> = {
  hanseong: { yield: 0, produce: '도성의 시전', volatile: 0, hazard: '화재' },
  gyeonggi: { yield: 14, produce: '쌀과 땔감. 권세가의 농장이 많다', volatile: 1, hazard: '왕릉·궁궐 부역' },
  chungcheong: { yield: 20, produce: '쌀과 면포', volatile: 1, hazard: '향전(鄕戰)' },
  jeolla: { yield: 32, produce: '나라의 곡창. 쌀과 세곡선', volatile: 1.3, hazard: '왜구, 세곡선 침몰' },
  gyeongsang: { yield: 26, produce: '쌀·면포와 왜관 교역', volatile: 1, hazard: '왜구' },
  gangwon: { yield: 8, produce: '목재와 산삼', volatile: 1.2, hazard: '화전민' },
  hwanghae: { yield: 14, produce: '소금과 어물', volatile: 1, hazard: '구월산 도적' },
  pyeongan: { yield: 13, produce: '사행 무역의 은과 인삼', volatile: 1.1, hazard: '사신 접대, 밀무역' },
  hamgyeong: { yield: 7, produce: '모피와 인삼. 땅이 척박하다', volatile: 1.5, hazard: '여진의 약탈' },
};

export const HARVEST_LABEL: Record<number, string> = { [-2]: '대흉', [-1]: '흉작', 0: '평년', 1: '풍작' };
const MULT: Record<number, number> = { [-2]: 0.3, [-1]: 0.6, 0: 1, 1: 1.4 };
export const harvestOf = (s: GameState, r: RegionId) => s.regions[r].harvest ?? 0;
export const harvestMult = (s: GameState, r: RegionId) => MULT[harvestOf(s, r)] ?? 1;

/** 이 도에서 올해 거둘 수 있는 재물의 크기. 작황과 민심을 탄다. */
export function regionYield(s: GameState, r: RegionId): number {
  const base = REGION_ECON[r].yield;
  const war = s.war.active && s.war.zones.includes(r) ? 0.5 : 1;
  return Math.max(1, Math.round(base * harvestMult(s, r) * (0.6 + s.regions[r].minsim / 250) * war));
}

/** 가을걷이: 해마다 9월에 도별 작황이 정해진다 */
export function rollHarvest(s: GameState) {
  const drought = (s.flags.droughtUntil as number | undefined) ?? -1;
  const parts: string[] = [];
  for (const r of Object.keys(REGION_ECON) as RegionId[]) {
    const e = REGION_ECON[r];
    if (!e.yield) continue;
    const v = e.volatile;
    let h = weighted<number>(s, [
      [1, 2],
      [0, 5],
      [-1, 1.6 * v],
      [-2, 0.5 * v],
    ])!;
    if (s.war.active && s.war.zones.includes(r)) h = Math.max(-2, h - 1);
    if (drought >= s.t && chance(s, 0.5)) h = Math.max(-2, h - 1);
    const reg = s.regions[r];
    reg.harvest = h;
    reg.minsim = clamp(reg.minsim + (h === 1 ? 5 : h === -1 ? -5 : h === -2 ? -12 : 0), 0, 100);
    if (h !== 0) parts.push(`${REGION_META[r].short} ${HARVEST_LABEL[h]}`);
  }
  delete s.flags.droughtUntil;
  log(s, `[작황] 올해 가을걷이 — ${parts.length ? parts.join(', ') : '팔도가 고루 평년작'}.`, 'court');
  const p = P(s);
  const home = harvestOf(s, p.home);
  if (p.status !== 'exiled') {
    const rent = Math.round(8 * (MULT[home] ?? 1));
    p.wealth += rent;
    if (p.home === 'hanseong') return;
    if (home === -2) notice(s, '고향의 대흉', `고향 ${REGION_META[p.home].short}에 대흉년이 들었다. 전장(田莊)에서 올라온 소출이 재산 +${rent}에 그쳤다. 고향 사람들이 굶주린다.`, 'personal');
    else log(s, `고향 ${REGION_META[p.home].short}의 작황은 ${HARVEST_LABEL[home]}. 전장의 소출 재산 +${rent}.`, 'player');
  }
}

/* ───────── 다른 도의 소식 ───────── */

interface Incident {
  region: RegionId;
  chance: (s: GameState) => number;
  text: string;
  minsim: number;
  fx?: (s: GameState) => void;
}

const winter = (s: GameState) => [10, 11, 12, 1, 2].includes(monthOf(s.t));
const prewar = (s: GameState) => s.t < tOf(1592, 4);

const INCIDENTS: Incident[] = [
  { region: 'hamgyeong', chance: (s) => (winter(s) ? 0.06 : 0.015), text: '함경도 육진에 여진의 무리가 넘어와 마을을 노략질했다.', minsim: -5 },
  { region: 'pyeongan', chance: (s) => (winter(s) ? 0.03 : 0.008), text: '평안도 압록강 변에 여진이 출몰해 백성을 잡아갔다.', minsim: -4 },
  { region: 'jeolla', chance: (s) => (prewar(s) ? 0.02 : 0), text: '전라도 섬마을에 왜구가 들이닥쳤다.', minsim: -4, fx: (s) => (s.war.preparedness = clamp(s.war.preparedness + 1, 0, 100)) },
  { region: 'gyeongsang', chance: (s) => (prewar(s) ? 0.015 : 0), text: '경상도 해안에 왜선이 나타나 어민을 위협했다.', minsim: -3 },
  { region: 'hwanghae', chance: () => 0.015, text: '황해도 구월산에 도적 떼가 다시 모였다는 장계가 올라왔다.', minsim: -3 },
  { region: 'jeolla', chance: (s) => (harvestOf(s, 'jeolla') < 0 ? 0.03 : 0.008), text: '전라도의 세곡선이 안흥량에서 침몰했다.', minsim: -2 },
  { region: 'chungcheong', chance: () => 0.008, text: '충청도에서 서원 유생들이 향전(鄕戰)을 벌였다.', minsim: -2 },
  { region: 'gangwon', chance: () => 0.008, text: '강원도 산골에 화전민이 늘어 관아가 골머리를 앓는다.', minsim: -1 },
];

export function tickIncidents(s: GameState) {
  const p = P(s);
  for (const x of INCIDENTS) {
    if (!chance(s, x.chance(s))) continue;
    if (p.location === x.region && localOffice(s)) continue;
    const r = s.regions[x.region];
    r.minsim = clamp(r.minsim + x.minsim, 0, 100);
    x.fx?.(s);
    log(s, `[팔도] ${x.text}`, 'court');
  }
  for (const r of Object.values(s.regions)) if (r.minsim < 60) r.minsim += 0.15;
}

/* ───────── 지방관의 일 ───────── */

const localOffice = (s: GameState) => {
  const p = P(s);
  return p.status === 'active' && (p.office?.startsWith('gamsa_') || p.office === 'suryeong');
};
const here = (s: GameState) => P(s).location as RegionId;
const short = (s: GameState) => REGION_META[here(s)].short;
const pres = (c: Character, v: number) => (c.prestige = clamp(c.prestige + v, 0, 100));
const fav = (c: Character, v: number) => (c.favor = clamp(c.favor + v, -100, 100));
const mins = (s: GameState, v: number, r = here(s)) => {
  s.regions[r].minsim = clamp(s.regions[r].minsim + v, 0, 100);
};
/** 관찰사면 도 전체, 수령이면 고을이라 몫이 작다 */
const cut = (s: GameState, k: number) => Math.max(2, Math.round(regionYield(s, here(s)) * k * (P(s).office === 'suryeong' ? 0.5 : 1)));
const roll = (s: GameState, v: number, need: number) => {
  const r = d6(s) + v;
  return [r >= need, r] as const;
};

interface Local {
  id: string;
  regions?: RegionId[];
  when?(s: GameState): boolean;
  weight?(s: GameState): number;
  setup?(s: GameState): Record<string, any> | null;
  title: string;
  text(s: GameState, c: Record<string, any>): string;
  choices(s: GameState, c: Record<string, any>): Choice[];
  resolve(s: GameState, key: string, c: Record<string, any>): string;
}

const LOCALS: Local[] = [
  {
    id: 'jurchen',
    regions: ['hamgyeong', 'pyeongan'],
    weight: (s) => (winter(s) ? 3 : 1),
    title: '여진의 약탈',
    text: (s) => `강이 얼자 여진의 기병 수십이 ${short(s)} 변경을 넘어와 마을을 불사르고 사람과 소를 끌고 갔다. 진보(鎭堡)의 군관들이 명을 기다린다.`,
    choices: (s) => [
      { key: 'chase', label: '군사를 내어 뒤쫓는다', hint: `정치력+강건 판정 (주사위 + ${Math.round((P(s).politics + P(s).vigor) / 2)} ≥ 7). 이기면 명망 +3, 성심 +3, 국방 대비 +2. 지면 명망 -3, 민심 -4.` },
      { key: 'hold', label: '성을 굳게 지킨다', hint: '민심 -4. 큰 탈은 없다.' },
      { key: 'pay', label: '번호(藩胡) 추장에게 재물을 주어 달랜다 (재산 10)', hint: '민심 +2. 조정에 알려지면 성심 -4 (30%).', disabled: P(s).wealth < 10 ? '재산이 모자란다' : undefined },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'chase') {
        const [ok, r] = roll(s, Math.round((p.politics + p.vigor) / 2), 7);
        if (ok) {
          pres(p, 3);
          fav(p, 3);
          s.war.preparedness = clamp(s.war.preparedness + 2, 0, 100);
          return `여진을 강 건너까지 쫓아 잡혀간 백성을 되찾았다. (판정 ${r}, 명망 +3, 성심 +3)`;
        }
        pres(p, -3);
        mins(s, -4);
        return `매복에 걸려 군관 여럿을 잃고 돌아왔다. (판정 ${r}, 명망 -3, 민심 -4)`;
      }
      if (key === 'hold') {
        mins(s, -4);
        return '성문을 닫고 버텼다. 성 밖 마을은 불탔다. (민심 -4)';
      }
      p.wealth -= 10;
      mins(s, 2);
      if (chance(s, 0.3)) {
        fav(p, -4);
        return '추장을 달래 약탈이 그쳤으나, 오랑캐에게 재물을 바쳤다는 말이 조정에 들어갔다. (성심 -4)';
      }
      return '추장에게 비단과 소금을 보내 달랬다. 한동안은 조용할 것이다. (민심 +2)';
    },
  },
  {
    id: 'fur_trade',
    regions: ['hamgyeong'],
    title: '북관의 모피 교역',
    text: () => '회령·경원의 개시(開市)에서 여진과 모피·인삼을 사고판다. 장사치들이 감영에 줄을 대려 하고, 군관들은 몰래 끼어든다.',
    choices: (s) => [
      { key: 'skim', label: '교역에 슬쩍 몫을 챙긴다', hint: `재산 +${cut(s, 1.2)}. 30% 확률로 「사무역 연루」 흠결.` },
      { key: 'tax', label: '세를 매겨 군량에 보탠다', hint: '국방 대비 +2, 성심 +1' },
      { key: 'ban', label: '사사로운 교역을 엄금한다', hint: '명망 +2, 민심 -2' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'skim') {
        const v = cut(s, 1.2);
        p.wealth += v;
        if (chance(s, 0.3)) addFlaw(s, p, '사무역 연루');
        return `담비 가죽 몇 짐이 감영 뒷방으로 들어왔다. (재산 +${v})`;
      }
      if (key === 'tax') {
        s.war.preparedness = clamp(s.war.preparedness + 2, 0, 100);
        fav(p, 1);
        return '교역에 세를 매겨 군량을 채웠다. (국방 대비 +2)';
      }
      pres(p, 2);
      mins(s, -2);
      return '사무역을 엄금했다. 장사치들의 원성이 높다. (명망 +2)';
    },
  },
  {
    id: 'exile_guest',
    regions: ['hamgyeong', 'pyeongan', 'jeolla', 'gyeongsang', 'gangwon'],
    when: (s) => people(s).some((c) => c.status === 'exiled' && c.location === here(s) && !isP(s, c)),
    setup(s) {
      const c = pick(s, people(s).filter((x) => x.status === 'exiled' && x.location === here(s) && !isP(s, x)));
      return c ? { who: c.id } : null;
    },
    title: '귀양 온 선비',
    text: (s, c) => {
      const w = s.chars[c.who];
      return `${w.exilePlace ?? short(s)}에 귀양 와 있는 ${josa(w.name, '이/가')} 끼니를 잇기 어렵다는 말이 들린다. 그를 어떻게 대할지는 수령과 감사의 재량이다.`;
    },
    choices: (s, c) => {
      const w = s.chars[c.who];
      return [
        { key: 'kind', label: '몰래 양식과 서책을 보낸다', hint: `${w.name} 호감 +15, 그의 당 호감 +3. 그를 귀양 보낸 쪽이 알면 언짢아한다.` },
        { key: 'strict', label: '조정의 뜻대로 엄히 감시한다', hint: `성심 +2, ${w.name} 호감 -10` },
      ];
    },
    resolve(s, key, c) {
      const p = P(s);
      const w = s.chars[c.who];
      if (!alive(w) || w.status !== 'exiled') return '그는 이미 그곳에 없다.';
      if (key === 'kind') {
        const fx = sway(s, w, p.id, 15, '귀양살이를 보살핌', { decay: 0.05, cap: 25 });
        if (w.faction !== 'none') swayFaction(s, w.faction, p.id, 3, '동지를 보살핌', 0.05);
        if (w.exiledBy && alive(s.chars[w.exiledBy])) sway(s, s.chars[w.exiledBy], p.id, -5, '죄인을 감쌈', { decay: 0.1 });
        return `${w.name}에게 몰래 양식을 보냈다. (${fx.join(', ')})`;
      }
      fav(p, 2);
      sway(s, w, p.id, -10, '엄한 감시', { decay: 0.05 });
      return `${josa(w.name, '을/를')} 엄히 감시했다. (성심 +2)`;
    },
  },
  {
    id: 'envoy',
    regions: ['pyeongan', 'hwanghae'],
    title: '명 사신의 행차',
    text: (s) => `명나라 사신 일행이 ${josa(short(s), '을/를')} 지난다. 연도의 고을마다 접대에 쓸 은과 인삼, 비단을 마련하느라 백성의 허리가 휜다.`,
    choices: () => [
      { key: 'lavish', label: '성대히 대접한다', hint: '성심 +4, 민심 -5' },
      { key: 'modest', label: '예법에 맞게 검소히 대접한다', hint: '명망 +2. 사신이 불평하면 성심 -3 (40%).' },
      { key: 'trade', label: '사신단의 사무역에 끼어 몫을 챙긴다', hint: '재산 +12, 민심 -3. 35% 확률로 「사행 무역 연루」 흠결.' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'lavish') {
        fav(p, 4);
        mins(s, -5);
        return '사신이 흡족해했다는 말이 왕의 귀에 들어갔다. (성심 +4, 민심 -5)';
      }
      if (key === 'modest') {
        pres(p, 2);
        if (chance(s, 0.4)) {
          fav(p, -3);
          return '사신이 대접이 박하다고 투덜거렸고, 조정에서 말이 나왔다. (명망 +2, 성심 -3)';
        }
        return '예법대로 대접했다. 선비들이 칭찬한다. (명망 +2)';
      }
      p.wealth += 12;
      mins(s, -3);
      if (chance(s, 0.35)) addFlaw(s, p, '사행 무역 연루');
      return '역관들을 통해 은과 인삼 몇 짐을 굴렸다. (재산 +12, 민심 -3)';
    },
  },
  {
    id: 'smuggle',
    regions: ['pyeongan'],
    title: '압록강의 밀무역',
    text: () => '의주 일대에서 인삼과 은이 압록강을 몰래 건너간다. 국법으로 금한 일이지만, 이 땅 사람들은 그것으로 먹고산다.',
    choices: (s) => [
      { key: 'crack', label: '엄히 단속한다', hint: '명망 +2, 성심 +1, 민심 -3' },
      { key: 'blind', label: '눈감아 주고 몫을 받는다', hint: `재산 +${cut(s, 1.3)}. 35% 확률로 「밀무역 묵인」 흠결.` },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'crack') {
        pres(p, 2);
        fav(p, 1);
        mins(s, -3);
        return '밀무역꾼들을 잡아들였다. (명망 +2, 성심 +1, 민심 -3)';
      }
      const v = cut(s, 1.3);
      p.wealth += v;
      if (chance(s, 0.35)) addFlaw(s, p, '밀무역 묵인');
      return `상인들이 철마다 인사를 차려 온다. (재산 +${v})`;
    },
  },
  {
    id: 'bandit_lair',
    regions: ['hwanghae', 'gangwon'],
    title: '산적 소굴',
    text: (s) => `${short(s)}의 깊은 산에 도적 떼가 자리를 잡았다. 관아의 곡식을 털고는 굶주린 백성에게 나눠 준다는 소문이 돈다. 백성들 사이에선 의적이라 부르기도 한다.`,
    choices: (s) => [
      { key: 'raid', label: '관군을 모아 소굴을 친다', hint: `정치력 판정 (주사위 + ${P(s).politics} ≥ 7). 이기면 명망 +3, 성심 +3. 지면 명망 -3.` },
      { key: 'relief', label: '환곡을 풀어 도적이 될 백성을 줄인다', hint: '민심 +6. 성심 -1 (나약하다는 말).' },
      { key: 'bribe', label: '도적과 몰래 거래해 고을만 비켜 가게 한다', hint: '재산 +6. 40% 확률로 「도적과 결탁」 흠결.' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'raid') {
        const [ok, r] = roll(s, p.politics, 7);
        if (ok) {
          pres(p, 3);
          fav(p, 3);
          return `소굴을 쓸어버렸다. (판정 ${r}, 명망 +3, 성심 +3)`;
        }
        pres(p, -3);
        return `관군이 산속에서 흩어졌다. (판정 ${r}, 명망 -3)`;
      }
      if (key === 'relief') {
        mins(s, 6);
        fav(p, -1);
        return '환곡을 풀었다. 산으로 들어가던 발길이 줄었다. (민심 +6)';
      }
      p.wealth += 6;
      if (chance(s, 0.4)) addFlaw(s, p, '도적과 결탁');
      return '도적 우두머리와 은밀히 말을 맞췄다. (재산 +6)';
    },
  },
  {
    id: 'corvee',
    regions: ['gyeonggi'],
    title: '왕릉 부역',
    text: () => '왕실의 능을 손보는 공사에 경기 백성을 동원하라는 명이 내려왔다. 하필 모내기 철이다.',
    choices: () => [
      { key: 'push', label: '기한 안에 엄히 독촉한다', hint: '성심 +4, 민심 -6' },
      { key: 'plead', label: '농번기를 피하자고 장계를 올린다', hint: '명망 +2, 민심 +2, 성심 -2' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'push') {
        fav(p, 4);
        mins(s, -6);
        return '기한 안에 공사를 마쳤다. 논에는 모가 덜 심겼다. (성심 +4, 민심 -6)';
      }
      pres(p, 2);
      mins(s, 2);
      fav(p, -2);
      return '공사를 가을로 미루자고 청했다. (명망 +2, 민심 +2, 성심 -2)';
    },
  },
  {
    id: 'estate_grab',
    regions: ['gyeonggi', 'chungcheong', 'jeolla'],
    when: (s) => people(s).some((c) => !isP(s, c) && c.rank <= 2 && inCourt(c)),
    setup(s) {
      const c = pick(s, people(s).filter((x) => !isP(s, x) && x.rank <= 2 && inCourt(x)));
      return c ? { who: c.id } : null;
    },
    title: '권세가의 농장',
    text: (s, c) => {
      const w = s.chars[c.who];
      return `${officeTitle(w)} ${w.name} 집안의 노비들이 ${short(s)}의 백성 땅을 빼앗아 농장을 넓히고 있다. 땅을 잃은 백성들이 감영 앞에 엎드렸다.`;
    },
    choices: (s, c) => {
      const w = s.chars[c.who];
      return [
        { key: 'fix', label: '땅을 돌려주게 한다', hint: `민심 +6, 명망 +2. ${w.name}과 그 가문의 호감 -15.` },
        { key: 'blind', label: '못 본 척한다', hint: `${w.name}이 신세를 진다. 민심 -5.` },
      ];
    },
    resolve(s, key, c) {
      const p = P(s);
      const w = s.chars[c.who];
      if (!alive(w)) return '그는 이미 세상을 떠났다.';
      if (key === 'fix') {
        mins(s, 6);
        pres(p, 2);
        const fx = sway(s, w, p.id, -15, '농장을 들춤', { clan: 0.4, decay: 0.08 });
        return `백성에게 땅을 돌려주었다. (민심 +6, 명망 +2, ${fx.join(', ')})`;
      }
      owe(s, w.id);
      mins(s, -5);
      return `${josa(w.name, '이/가')} 넌지시 고맙다는 기별을 보냈다. 그가 신세를 졌다. (민심 -5)`;
    },
  },
  {
    id: 'grain_ship',
    regions: ['jeolla', 'chungcheong'],
    title: '세곡선 침몰',
    text: (s) => `${short(s)}에서 거둔 세곡을 싣고 한성으로 가던 조운선이 풍랑에 가라앉았다. 사공들은 바다가 사나웠다지만, 일부러 배를 가라앉히고 곡식을 빼돌렸다는 말도 있다.`,
    choices: () => [
      { key: 'recollect', label: '다시 거두어 채운다', hint: '성심 +2, 민심 -7' },
      { key: 'probe', label: '사공과 향리를 조사한다', hint: '정치력 판정 (주사위 + 정치력 ≥ 7). 이기면 명망 +3, 성심 +2.' },
      { key: 'remit', label: '감면을 청하는 장계를 올린다', hint: '민심 +3, 성심 -2' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'recollect') {
        fav(p, 2);
        mins(s, -7);
        return '세곡을 다시 거두었다. 백성들이 이를 간다. (성심 +2, 민심 -7)';
      }
      if (key === 'probe') {
        const [ok, r] = roll(s, p.politics, 7);
        if (ok) {
          pres(p, 3);
          fav(p, 2);
          return `향리와 사공이 짜고 곡식을 빼돌린 것을 밝혀냈다. (판정 ${r}, 명망 +3, 성심 +2)`;
        }
        return `증좌를 찾지 못했다. (판정 ${r})`;
      }
      mins(s, 3);
      fav(p, -2);
      return '감면을 청했다. (민심 +3, 성심 -2)';
    },
  },
  {
    id: 'wokou',
    regions: ['jeolla', 'gyeongsang'],
    when: (s) => s.t < tOf(1592, 4) || !s.war.active,
    title: '왜구 출몰',
    text: (s) => `${short(s)} 앞바다 섬마을에 왜선 몇 척이 나타나 곡식과 사람을 노략질했다. 수군 진의 배는 낡았다.`,
    choices: (s) => [
      { key: 'navy', label: '수군을 내어 친다', hint: `정치력 판정 (주사위 + ${P(s).politics} ≥ 7). 이기면 명망 +3, 국방 대비 +3. 지면 명망 -3, 민심 -3.` },
      { key: 'move', label: '섬 주민을 뭍으로 옮긴다', hint: '민심 -3. 피해는 막는다.' },
      { key: 'repair', label: '판옥선을 손보고 군사를 조련한다 (재산 15)', hint: '국방 대비 +5, 성심 +2', disabled: P(s).wealth < 15 ? '재산이 모자란다' : undefined },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'navy') {
        const [ok, r] = roll(s, p.politics, 7);
        if (ok) {
          pres(p, 3);
          s.war.preparedness = clamp(s.war.preparedness + 3, 0, 100);
          return `왜선을 쫓아 두 척을 불살랐다. (판정 ${r}, 명망 +3, 국방 대비 +3)`;
        }
        pres(p, -3);
        mins(s, -3);
        return `수군이 따라잡지 못했다. (판정 ${r}, 명망 -3, 민심 -3)`;
      }
      if (key === 'move') {
        mins(s, -3);
        return '섬 주민을 뭍으로 옮겼다. (민심 -3)';
      }
      p.wealth -= 15;
      s.war.preparedness = clamp(s.war.preparedness + 5, 0, 100);
      fav(p, 2);
      return '사재를 보태 배를 고치고 군사를 조련했다. (국방 대비 +5, 성심 +2)';
    },
  },
  {
    id: 'waegwan',
    regions: ['gyeongsang'],
    when: (s) => s.t < tOf(1592, 4),
    title: '왜관의 소문',
    text: () => '부산 왜관의 왜인들이 요즘 들어 부쩍 말수가 줄고, 쓰시마에서 오는 배가 뜸하다. 역관 하나가 "관백(關白)이 군사를 모은다더라"는 말을 전한다.',
    choices: () => [
      { key: 'report', label: '조정에 급히 장계를 올린다', hint: '국방 대비 +3. 쓸데없는 소란이라는 말을 들을 수 있다 (성심 -2, 40%).' },
      { key: 'trade', label: '왜관 교역에서 몫을 챙긴다', hint: '재산 +10. 30% 확률로 「왜관 사무역」 흠결.' },
      { key: 'ignore', label: '늘 있는 헛소문이다', hint: '아무 일도 없다' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'report') {
        s.war.preparedness = clamp(s.war.preparedness + 3, 0, 100);
        s.flags.warned = true;
        if (chance(s, 0.4)) {
          fav(p, -2);
          return '장계를 올렸으나 "변방 장수가 공을 탐해 소란을 피운다"는 말을 들었다. (국방 대비 +3, 성심 -2)';
        }
        return '장계를 올렸다. 비변사가 남쪽 성을 손보기로 했다. (국방 대비 +3)';
      }
      if (key === 'trade') {
        p.wealth += 10;
        if (chance(s, 0.3)) addFlaw(s, p, '왜관 사무역');
        return '왜관에서 은 몇 냥이 흘러 들어왔다. (재산 +10)';
      }
      return '헛소문으로 여겼다.';
    },
  },
  {
    id: 'hyangjeon',
    regions: ['chungcheong', 'gyeongsang', 'jeolla'],
    title: '향전(鄕戰)',
    text: (s) => `${short(s)}의 향교에서 좌수 자리와 서원 배향을 두고 두 집안의 유생들이 패를 갈라 싸운다. 한쪽은 당신과 같은 당, 다른 쪽은 상대 당과 줄이 닿아 있다.`,
    choices: () => [
      { key: 'own', label: '같은 당 쪽 손을 들어준다', hint: '같은 당 호감 +4, 다른 당 호감 -4, 민심 -2' },
      { key: 'fair', label: '향약의 법도대로 공평하게 가린다', hint: '명망 +2, 민심 +2' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'own') {
        mins(s, -2);
        const fx = p.faction !== 'none' ? swayFaction(s, p.faction, p.id, 4, '향전에서 편듦', 0.1) : '';
        for (const f of ['dong', 'seo', 'nam', 'buk'] as const) if (s.factions[f].active && f !== p.faction) swayFaction(s, f, p.id, -4, '향전에서 편듦', 0.1);
        return `같은 당 유생들의 손을 들어주었다.${fx ? ` (${fx})` : ''}`;
      }
      pres(p, 2);
      mins(s, 2);
      return '향약의 법도대로 가렸다. (명망 +2, 민심 +2)';
    },
  },
  {
    id: 'slash_burn',
    regions: ['gangwon', 'hamgyeong'],
    title: '화전민',
    text: (s) => `${short(s)} 산비탈에 불을 놓아 밭을 일구는 화전민이 늘었다. 세금을 피해 숨어든 이들이라 관아의 장부에 없다.`,
    choices: () => [
      { key: 'allow', label: '내버려 두어 먹고살게 한다', hint: '민심 +4' },
      { key: 'register', label: '장부에 올려 세를 매긴다', hint: '성심 +2, 민심 -3' },
      { key: 'skim', label: '장부에 안 올리는 대신 사사로이 거둔다', hint: '재산 +5. 25% 확률로 「은결 착복」 흠결.' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'allow') {
        mins(s, 4);
        return '화전민을 내버려 두었다. (민심 +4)';
      }
      if (key === 'register') {
        fav(p, 2);
        mins(s, -3);
        return '화전을 장부에 올렸다. (성심 +2, 민심 -3)';
      }
      p.wealth += 5;
      if (chance(s, 0.25)) addFlaw(s, p, '은결 착복');
      return '화전민에게서 몰래 곡식을 거두었다. (재산 +5)';
    },
  },
  {
    id: 'salt',
    regions: ['hwanghae', 'jeolla', 'gyeongsang'],
    title: '염전의 세',
    text: (s) => `${short(s)} 바닷가 염전의 소금세를 두고 염한(鹽漢)들과 토호가 다툰다. 토호들은 소금을 사사로이 팔아 치부하고, 그 몫을 감영에 나누겠다고 넌지시 제안한다.`,
    choices: (s) => [
      { key: 'take', label: '토호의 몫을 받는다', hint: `재산 +${cut(s, 0.8)}. 30% 확률로 「염세 착복」 흠결. 민심 -2.` },
      { key: 'state', label: '소금세를 바로잡아 나라에 올린다', hint: '성심 +3, 명망 +1' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'take') {
        const v = cut(s, 0.8);
        p.wealth += v;
        mins(s, -2);
        if (chance(s, 0.3)) addFlaw(s, p, '염세 착복');
        return `토호들이 철마다 소금 값을 나누어 보낸다. (재산 +${v})`;
      }
      fav(p, 3);
      pres(p, 1);
      return '소금세를 바로잡았다. (성심 +3, 명망 +1)';
    },
  },
  {
    id: 'bumper',
    when: (s) => harvestOf(s, here(s)) === 1,
    weight: () => 2,
    title: '풍년가',
    text: (s) => `올해 ${josa(short(s), '은/는')} 풍년이다. 곳간이 넘치고 마을마다 풍물 소리가 난다. 남는 곡식을 어찌할지 아전들이 묻는다.`,
    choices: (s) => [
      { key: 'store', label: '환곡으로 비축해 흉년에 대비한다', hint: '민심 +3. 다음 흉년의 피해가 준다.' },
      { key: 'feast', label: '잔치를 열어 노인을 위로한다 (재산 5)', hint: '민심 +5, 명망 +2', disabled: P(s).wealth < 5 ? '재산이 모자란다' : undefined },
      { key: 'skim', label: '남는 곡식을 챙긴다', hint: `재산 +${cut(s, 0.7)}. 25% 확률로 「환곡 착복」 흠결.` },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'store') {
        mins(s, 3);
        const r = s.regions[here(s)];
        if (!r.tags.includes('reserve')) r.tags.push('reserve');
        return '남는 곡식을 환곡으로 비축했다. (민심 +3)';
      }
      if (key === 'feast') {
        p.wealth -= 5;
        mins(s, 5);
        pres(p, 2);
        return '양로연을 열었다. 노인들이 감사의 송덕을 읊는다. (민심 +5, 명망 +2)';
      }
      const v = cut(s, 0.7);
      p.wealth += v;
      if (chance(s, 0.25)) addFlaw(s, p, '환곡 착복');
      return `남는 곡식이 사사로이 팔려 나갔다. (재산 +${v})`;
    },
  },
  {
    id: 'lean',
    when: (s) => harvestOf(s, here(s)) < 0,
    weight: (s) => (harvestOf(s, here(s)) === -2 ? 4 : 2),
    title: '보릿고개',
    text: (s) => {
      const r = s.regions[here(s)];
      return `${short(s)}에 흉년이 들어 봄이 오기도 전에 곳간이 비었다. 유랑민이 길을 메우고, 세곡은 정해진 양의 절반도 걷히지 않는다.${r.tags.includes('reserve') ? ' 지난 풍년에 비축해 둔 환곡이 있다.' : ''}`;
    },
    choices: (s) => {
      const reserve = s.regions[here(s)].tags.includes('reserve');
      return [
        { key: 'relief', label: reserve ? '비축한 환곡을 푼다' : '감영 창고를 열어 진휼한다', hint: reserve ? '민심 +10, 명망 +2' : '민심 +7, 명망 +2, 성심 -2 (독단)' },
        { key: 'remit', label: '세금 감면을 청하는 장계를 올린다', hint: '민심 +4, 성심 -1' },
        { key: 'squeeze', label: '정액대로 거둔다', hint: '성심 +3, 민심 -10. 민심이 바닥이면 민란이 날 수 있다.' },
      ];
    },
    resolve(s, key) {
      const p = P(s);
      const r = s.regions[here(s)];
      if (key === 'relief') {
        if (r.tags.includes('reserve')) {
          r.tags = r.tags.filter((x) => x !== 'reserve');
          mins(s, 10);
          pres(p, 2);
          return '비축해 둔 환곡을 풀었다. 굶어 죽는 이가 없었다. (민심 +10, 명망 +2)';
        }
        mins(s, 7);
        pres(p, 2);
        fav(p, -2);
        return '창고를 열었다. (민심 +7, 명망 +2, 성심 -2)';
      }
      if (key === 'remit') {
        mins(s, 4);
        fav(p, -1);
        return '감면을 청했다. (민심 +4, 성심 -1)';
      }
      fav(p, 3);
      mins(s, -10);
      if (r.minsim < 25 && chance(s, 0.5)) {
        pres(p, -6);
        fav(p, -8);
        log(s, `[팔도] ${short(s)}에서 굶주린 백성들이 관아를 습격했다.`, 'court');
        return '굶주린 백성들이 관아로 몰려와 창고를 부쉈다. 민란이다! (명망 -6, 성심 -5)';
      }
      return '정액대로 거두었다. 길가에 굶어 죽은 이가 늘었다. (성심 +3, 민심 -10)';
    },
  },
  {
    id: 'plague',
    weight: () => 0.6,
    title: '역병',
    text: (s) => `${short(s)}의 몇 고을에 역병이 돌아 사람이 죽어 나간다. 백성들은 마을을 버리고 산으로 달아난다.`,
    choices: (s) => [
      { key: 'doctor', label: '의원과 약재를 보낸다 (재산 10)', hint: '민심 +5, 명망 +2', disabled: P(s).wealth < 10 ? '재산이 모자란다' : undefined },
      { key: 'seal', label: '고을을 봉쇄해 번지지 않게 한다', hint: '민심 -3. 병이 크게 번지지는 않는다.' },
      { key: 'flee', label: '감영을 잠시 옮겨 피한다', hint: '명망 -4. 병을 얻을 위험이 없다.' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'doctor') {
        p.wealth -= 10;
        mins(s, 5);
        pres(p, 2);
        if (chance(s, p.vigor <= 2 ? 0.25 : 0.08)) {
          s.player.sick = true;
          return '의원들과 함께 고을을 돌다 병을 얻었다. (민심 +5, 명망 +2, 병중)';
        }
        return '의원과 약재를 보내 역병을 다스렸다. (민심 +5, 명망 +2)';
      }
      if (key === 'seal') {
        mins(s, -3);
        return '고을을 봉쇄했다. 안에 갇힌 이들의 원망이 크다. (민심 -3)';
      }
      pres(p, -4);
      return '감영을 옮겨 몸을 피했다. 선비들이 수군거린다. (명망 -4)';
    },
  },
  {
    id: 'hyangri',
    weight: () => 0.8,
    title: '향리의 농간',
    text: (s) => `${short(s)} 고을의 향리들이 환곡 장부를 조작해 쌀에 겨를 섞어 빌려주고, 갚을 때는 알곡으로 받아 차익을 챙긴다는 고발이 들어왔다. 향리들은 수령들과도 줄이 닿아 있다.`,
    choices: () => [
      { key: 'purge', label: '장부를 뒤져 향리들을 처벌한다', hint: '민심 +5, 명망 +2. 지방 행정이 잠시 삐걱인다 (성심 -1).' },
      { key: 'share', label: '향리들의 몫을 나누어 받는다', hint: '재산 +8. 30% 확률로 「환곡 농간」 흠결.' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'purge') {
        mins(s, 5);
        pres(p, 2);
        fav(p, -1);
        return '향리 몇을 곤장 치고 쫓아냈다. (민심 +5, 명망 +2)';
      }
      p.wealth += 8;
      if (chance(s, 0.3)) addFlaw(s, p, '환곡 농간');
      return '향리들이 철마다 인사를 차려 온다. (재산 +8)';
    },
  },
];

const localOf = (id: string) => LOCALS.find((x) => x.id === id);

export function rollLocal(s: GameState) {
  if (!localOffice(s) || s.pending.length >= 2) return;
  const at = typeof s.flags.localAt === 'number' ? s.flags.localAt : -99;
  if (s.t - at < 2 || !chance(s, 0.3)) return;
  const r = here(s);
  const pool = LOCALS.filter((x) => (!x.regions || x.regions.includes(r)) && (!x.when || x.when(s)));
  const ev = weighted(s, pool.map((x) => [x, (x.weight?.(s) ?? 1) * (x.regions ? 1.5 : 1)] as [Local, number]));
  if (!ev) return;
  const ctx = ev.setup ? ev.setup(s) : {};
  if (!ctx) return;
  s.flags.localAt = s.t;
  pushEvent(s, 'local', { ...ctx, lid: ev.id });
}

export const REGION_EVENTS: Record<string, EventDef> = {
  local: {
    build(s, c) {
      const d = localOf(c.lid)!;
      const h = harvestOf(s, here(s));
      return {
        title: `${short(s)} — ${d.title}`,
        kind: 'court',
        text: `${d.text(s, c)}\n\n(올해 ${short(s)} 작황: ${HARVEST_LABEL[h]} · 민심 ${Math.round(s.regions[here(s)].minsim)})`,
        choices: d.choices(s, c),
      };
    },
    resolve(s, c, key) {
      const d = localOf(c.lid);
      if (!d) return;
      if (!localOffice(s)) return '이미 그 고을을 떠났다.';
      return d.resolve(s, key, c);
    },
  },
};

/** 관찰사 공납: 도의 살림과 작황에 따라 몫이 달라진다 */
export function tributeAmounts(s: GameState) {
  const y = regionYield(s, here(s));
  return { normal: Math.max(2, Math.round(y * 0.5)), exploit: Math.max(4, Math.round(y * 1.2)), y };
}

export const isLocalOffice = localOffice;
