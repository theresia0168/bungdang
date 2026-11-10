import type { Character, GameState, RegionId } from './types';
import type { EventDef } from './events/types';
import { choicesOf, resolveScene, type Scene } from './scenes';
import { REGION_META } from './data/meta';
import { monthOf, tOf } from './calendar';
import { chance, d6, pick, weighted } from './rng';
import { fav, monthsSince, pres, addFlaw, alive, clamp, inCourt, isP, josa, log, notice, officeTitle, owe, P, people, pushEvent } from './state';
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

/* ───────── 지방관의 일 ─────────
 * 관찰사·수령이 그 도에서 겪는 사건. 선택지의 수치는 scenes.ts가 힌트와 결과 문구로 풀어 쓴다.
 */

const localOffice = (s: GameState) => {
  const p = P(s);
  return p.status === 'active' && (p.office?.startsWith('gamsa_') || p.office === 'suryeong');
};
const here = (s: GameState) => P(s).location as RegionId;
const short = (s: GameState) => REGION_META[here(s)].short;
/** 관찰사면 도 전체, 수령이면 고을이라 몫이 작다 */
const cut = (k: number) => (s: GameState) => Math.max(2, Math.round(regionYield(s, here(s)) * k * (P(s).office === 'suryeong' ? 0.5 : 1)));
const exilesHere = (s: GameState) => people(s).filter((c) => c.status === 'exiled' && c.location === here(s) && !isP(s, c));
const bigwigs = (s: GameState) => people(s).filter((x) => !isP(s, x) && x.rank <= 2 && inCourt(x));

const LOCALS: Scene[] = [
  {
    id: 'jurchen',
    regions: ['hamgyeong', 'pyeongan'],
    weight: (s) => (winter(s) ? 3 : 1),
    title: '여진의 약탈',
    text: (s) => `강이 얼자 여진의 기병 수십이 ${short(s)} 변경을 넘어와 마을을 불사르고 사람과 소를 끌고 갔다. 진보(鎭堡)의 군관들이 명을 기다린다.`,
    opts: () => [
      { key: 'chase', label: '군사를 내어 뒤쫓는다', roll: { stat: 'mixed', need: 7, ok: { say: '여진을 강 건너까지 쫓아 잡혀간 백성을 되찾았다.', prestige: 3, favor: 3, prep: 2 }, fail: { say: '매복에 걸려 군관 여럿을 잃고 돌아왔다.', prestige: -3, minsim: -4 } } },
      { key: 'hold', label: '성을 굳게 지킨다', fx: { say: '성문을 닫고 버텼다. 성 밖 마을은 불탔다.', minsim: -4 } },
      { key: 'pay', label: '번호(藩胡) 추장에게 재물을 주어 달랜다', cost: 10, odds: { p: 0.7, yes: { say: '추장에게 비단과 소금을 보내 달랬다. 한동안은 조용할 것이다.', minsim: 2 }, no: { say: '약탈은 그쳤으나, 오랑캐에게 재물을 바쳤다는 말이 조정에 들어갔다.', minsim: 2, favor: -4 } } },
    ],
  },
  {
    id: 'fur_trade',
    regions: ['hamgyeong'],
    title: '북관의 모피 교역',
    text: () => '회령·경원의 개시(開市)에서 여진과 모피·인삼을 사고판다. 장사치들이 감영에 줄을 대려 하고, 군관들은 몰래 끼어든다.',
    opts: () => [
      { key: 'skim', label: '교역에 슬쩍 몫을 챙긴다', fx: { say: '담비 가죽 몇 짐이 감영 뒷방으로 들어왔다.', wealth: cut(1.2), flaw: { label: '사무역 연루', p: 0.3 } } },
      { key: 'tax', label: '세를 매겨 군량에 보탠다', fx: { say: '교역에 세를 매겨 군량을 채웠다.', prep: 2, favor: 1 } },
      { key: 'ban', label: '사사로운 교역을 엄금한다', fx: { say: '사무역을 엄금했다. 장사치들의 원성이 높다.', prestige: 2, minsim: -2 } },
    ],
  },
  {
    id: 'exile_guest',
    regions: ['hamgyeong', 'pyeongan', 'jeolla', 'gyeongsang', 'gangwon'],
    when: (s) => exilesHere(s).length > 0,
    setup(s) {
      const c = pick(s, exilesHere(s));
      return c ? { who: c.id } : null;
    },
    stale: (s, c) => (alive(s.chars[c.who]) && s.chars[c.who].status === 'exiled' ? null : '그는 이미 그곳에 없다.'),
    title: '귀양 온 선비',
    text: (s, c) => {
      const w = s.chars[c.who];
      return `${w.exilePlace ?? short(s)}에 귀양 와 있는 ${josa(w.name, '이/가')} 끼니를 잇기 어렵다는 말이 들린다. 그를 어떻게 대할지는 수령과 감사의 재량이다.`;
    },
    opts: () => [
      {
        key: 'kind',
        label: '몰래 양식과 서책을 보낸다',
        fx: {
          say: '귀양 온 선비에게 몰래 양식을 보냈다.',
          who: { v: 15 },
          note: '그의 당 호감 +3. 그를 귀양 보낸 쪽은 언짢아한다',
          run(s, c) {
            const w = s.chars[c.who];
            const p = P(s);
            if (w.faction !== 'none') swayFaction(s, w.faction, p.id, 3, '동지를 보살핌', 0.05);
            if (w.exiledBy && alive(s.chars[w.exiledBy])) sway(s, s.chars[w.exiledBy], p.id, -5, '죄인을 감쌈', { decay: 0.1 });
          },
        },
      },
      { key: 'strict', label: '조정의 뜻대로 엄히 감시한다', fx: { say: '엄히 감시했다.', favor: 2, who: { v: -10 } } },
    ],
  },
  {
    id: 'envoy',
    regions: ['pyeongan', 'hwanghae'],
    title: '명 사신의 행차',
    text: (s) => `명나라 사신 일행이 ${josa(short(s), '을/를')} 지난다. 연도의 고을마다 접대에 쓸 은과 인삼, 비단을 마련하느라 백성의 허리가 휜다.`,
    opts: () => [
      { key: 'lavish', label: '성대히 대접한다', fx: { say: '사신이 흡족해했다는 말이 왕의 귀에 들어갔다.', favor: 4, minsim: -5 } },
      { key: 'modest', label: '예법에 맞게 검소히 대접한다', odds: { p: 0.6, yes: { say: '예법대로 대접했다. 선비들이 칭찬한다.', prestige: 2 }, no: { say: '사신이 대접이 박하다고 투덜거렸고, 조정에서 말이 나왔다.', prestige: 2, favor: -3 } } },
      { key: 'trade', label: '사신단의 사무역에 끼어 몫을 챙긴다', fx: { say: '역관들을 통해 은과 인삼 몇 짐을 굴렸다.', wealth: 12, minsim: -3, flaw: { label: '사행 무역 연루', p: 0.35 } } },
    ],
  },
  {
    id: 'smuggle',
    regions: ['pyeongan'],
    title: '압록강의 밀무역',
    text: () => '의주 일대에서 인삼과 은이 압록강을 몰래 건너간다. 국법으로 금한 일이지만, 이 땅 사람들은 그것으로 먹고산다.',
    opts: () => [
      { key: 'crack', label: '엄히 단속한다', fx: { say: '밀무역꾼들을 잡아들였다.', prestige: 2, favor: 1, minsim: -3 } },
      { key: 'blind', label: '눈감아 주고 몫을 받는다', fx: { say: '상인들이 철마다 인사를 차려 온다.', wealth: cut(1.3), flaw: { label: '밀무역 묵인', p: 0.35 } } },
    ],
  },
  {
    id: 'bandit_lair',
    regions: ['hwanghae', 'gangwon'],
    title: '산적 소굴',
    text: (s) => `${short(s)}의 깊은 산에 도적 떼가 자리를 잡았다. 관아의 곡식을 털고는 굶주린 백성에게 나눠 준다는 소문이 돈다. 백성들 사이에선 의적이라 부르기도 한다.`,
    opts: () => [
      { key: 'raid', label: '관군을 모아 소굴을 친다', roll: { stat: 'politics', need: 7, ok: { say: '소굴을 쓸어버렸다.', prestige: 3, favor: 3 }, fail: { say: '관군이 산속에서 흩어졌다.', prestige: -3 } } },
      { key: 'relief', label: '환곡을 풀어 도적이 될 백성을 줄인다', fx: { say: '환곡을 풀었다. 산으로 들어가던 발길이 줄었다.', minsim: 6, favor: -1 } },
      { key: 'bribe', label: '도적과 몰래 거래해 고을만 비켜 가게 한다', fx: { say: '도적 우두머리와 은밀히 말을 맞췄다.', wealth: 6, flaw: { label: '도적과 결탁', p: 0.4 } } },
    ],
  },
  {
    id: 'corvee',
    regions: ['gyeonggi'],
    title: '왕릉 부역',
    text: () => '왕실의 능을 손보는 공사에 경기 백성을 동원하라는 명이 내려왔다. 하필 모내기 철이다.',
    opts: () => [
      { key: 'push', label: '기한 안에 엄히 독촉한다', fx: { say: '기한 안에 공사를 마쳤다. 논에는 모가 덜 심겼다.', favor: 4, minsim: -6 } },
      { key: 'plead', label: '농번기를 피하자고 장계를 올린다', fx: { say: '공사를 가을로 미루자고 청했다.', prestige: 2, minsim: 2, favor: -2 } },
    ],
  },
  {
    id: 'estate_grab',
    regions: ['gyeonggi', 'chungcheong', 'jeolla'],
    when: (s) => bigwigs(s).length > 0,
    setup(s) {
      const c = pick(s, bigwigs(s));
      return c ? { who: c.id } : null;
    },
    stale: (s, c) => (alive(s.chars[c.who]) ? null : '그는 이미 세상을 떠났다.'),
    title: '권세가의 농장',
    text: (s, c) => {
      const w = s.chars[c.who];
      return `${officeTitle(w)} ${w.name} 집안의 노비들이 ${short(s)}의 백성 땅을 빼앗아 농장을 넓히고 있다. 땅을 잃은 백성들이 감영 앞에 엎드렸다.`;
    },
    opts: () => [
      { key: 'fix', label: '땅을 돌려주게 한다', fx: { say: '백성에게 땅을 돌려주었다.', minsim: 6, prestige: 2, who: { v: -15, clan: 0.4 } } },
      { key: 'blind', label: '못 본 척한다', fx: { say: '권세가가 넌지시 고맙다는 기별을 보냈다.', owe: true, minsim: -5 } },
    ],
  },
  {
    id: 'grain_ship',
    regions: ['jeolla', 'chungcheong'],
    title: '세곡선 침몰',
    text: (s) => `${short(s)}에서 거둔 세곡을 싣고 한성으로 가던 조운선이 풍랑에 가라앉았다. 사공들은 바다가 사나웠다지만, 일부러 배를 가라앉히고 곡식을 빼돌렸다는 말도 있다.`,
    opts: () => [
      { key: 'recollect', label: '다시 거두어 채운다', fx: { say: '세곡을 다시 거두었다. 백성들이 이를 간다.', favor: 2, minsim: -7 } },
      { key: 'probe', label: '사공과 향리를 조사한다', roll: { stat: 'politics', need: 7, ok: { say: '향리와 사공이 짜고 곡식을 빼돌린 것을 밝혀냈다.', prestige: 3, favor: 2 }, fail: { say: '증좌를 찾지 못했다.' } } },
      { key: 'remit', label: '감면을 청하는 장계를 올린다', fx: { say: '감면을 청했다.', minsim: 3, favor: -2 } },
    ],
  },
  {
    id: 'wokou',
    regions: ['jeolla', 'gyeongsang'],
    when: (s) => s.t < tOf(1592, 4) || !s.war.active,
    title: '왜구 출몰',
    text: (s) => `${short(s)} 앞바다 섬마을에 왜선 몇 척이 나타나 곡식과 사람을 노략질했다. 수군 진의 배는 낡았다.`,
    opts: () => [
      { key: 'navy', label: '수군을 내어 친다', roll: { stat: 'politics', need: 7, ok: { say: '왜선을 쫓아 두 척을 불살랐다.', prestige: 3, prep: 3 }, fail: { say: '수군이 따라잡지 못했다.', prestige: -3, minsim: -3 } } },
      { key: 'move', label: '섬 주민을 뭍으로 옮긴다', fx: { say: '섬 주민을 뭍으로 옮겼다.', minsim: -3 } },
      { key: 'repair', label: '판옥선을 손보고 군사를 조련한다', cost: 15, fx: { say: '사재를 보태 배를 고치고 군사를 조련했다.', prep: 5, favor: 2 } },
    ],
  },
  {
    id: 'waegwan',
    regions: ['gyeongsang'],
    when: (s) => s.t < tOf(1592, 4),
    title: '왜관의 소문',
    text: () => '부산 왜관의 왜인들이 요즘 들어 부쩍 말수가 줄고, 쓰시마에서 오는 배가 뜸하다. 역관 하나가 "관백(關白)이 군사를 모은다더라"는 말을 전한다.',
    opts: () => [
      {
        key: 'report',
        label: '조정에 급히 장계를 올린다',
        odds: {
          p: 0.6,
          yes: { say: '장계를 올렸다. 비변사가 남쪽 성을 손보기로 했다.', prep: 3, run: (s) => void (s.flags.warned = true) },
          no: { say: '장계를 올렸으나 "변방 장수가 공을 탐해 소란을 피운다"는 말을 들었다.', prep: 3, favor: -2, run: (s) => void (s.flags.warned = true) },
        },
      },
      { key: 'trade', label: '왜관 교역에서 몫을 챙긴다', fx: { say: '왜관에서 은 몇 냥이 흘러 들어왔다.', wealth: 10, flaw: { label: '왜관 사무역', p: 0.3 } } },
      { key: 'ignore', label: '늘 있는 헛소문이다', fx: { say: '헛소문으로 여겼다.' } },
    ],
  },
  {
    id: 'hyangjeon',
    regions: ['chungcheong', 'gyeongsang', 'jeolla'],
    title: '향전(鄕戰)',
    text: (s) => `${short(s)}의 향교에서 좌수 자리와 서원 배향을 두고 두 집안의 유생들이 패를 갈라 싸운다. 한쪽은 당신과 같은 당, 다른 쪽은 상대 당과 줄이 닿아 있다.`,
    opts: () => [
      { key: 'own', label: '같은 당 쪽 손을 들어준다', fx: { say: '같은 당 유생들의 손을 들어주었다.', party: 4, others: -4, minsim: -2 } },
      { key: 'fair', label: '향약의 법도대로 공평하게 가린다', fx: { say: '향약의 법도대로 가렸다.', prestige: 2, minsim: 2 } },
    ],
  },
  {
    id: 'slash_burn',
    regions: ['gangwon', 'hamgyeong'],
    title: '화전민',
    text: (s) => `${short(s)} 산비탈에 불을 놓아 밭을 일구는 화전민이 늘었다. 세금을 피해 숨어든 이들이라 관아의 장부에 없다.`,
    opts: () => [
      { key: 'allow', label: '내버려 두어 먹고살게 한다', fx: { say: '화전민을 내버려 두었다.', minsim: 4 } },
      { key: 'register', label: '장부에 올려 세를 매긴다', fx: { say: '화전을 장부에 올렸다.', favor: 2, minsim: -3 } },
      { key: 'skim', label: '장부에 안 올리는 대신 사사로이 거둔다', fx: { say: '화전민에게서 몰래 곡식을 거두었다.', wealth: 5, flaw: { label: '은결 착복', p: 0.25 } } },
    ],
  },
  {
    id: 'salt',
    regions: ['hwanghae', 'jeolla', 'gyeongsang'],
    title: '염전의 세',
    text: (s) => `${short(s)} 바닷가 염전의 소금세를 두고 염한(鹽漢)들과 토호가 다툰다. 토호들은 소금을 사사로이 팔아 치부하고, 그 몫을 감영에 나누겠다고 넌지시 제안한다.`,
    opts: () => [
      { key: 'take', label: '토호의 몫을 받는다', fx: { say: '토호들이 철마다 소금 값을 나누어 보낸다.', wealth: cut(0.8), minsim: -2, flaw: { label: '염세 착복', p: 0.3 } } },
      { key: 'state', label: '소금세를 바로잡아 나라에 올린다', fx: { say: '소금세를 바로잡았다.', favor: 3, prestige: 1 } },
    ],
  },
  {
    id: 'bumper',
    when: (s) => harvestOf(s, here(s)) === 1,
    weight: () => 2,
    title: '풍년가',
    text: (s) => `올해 ${josa(short(s), '은/는')} 풍년이다. 곳간이 넘치고 마을마다 풍물 소리가 난다. 남는 곡식을 어찌할지 아전들이 묻는다.`,
    opts: () => [
      {
        key: 'store',
        label: '환곡으로 비축해 흉년에 대비한다',
        fx: {
          say: '남는 곡식을 환곡으로 비축했다.',
          minsim: 3,
          note: '다음 흉년의 피해가 준다',
          run(s) {
            const r = s.regions[here(s)];
            if (!r.tags.includes('reserve')) r.tags.push('reserve');
          },
        },
      },
      { key: 'feast', label: '잔치를 열어 노인을 위로한다', cost: 5, fx: { say: '양로연을 열었다. 노인들이 감사의 송덕을 읊는다.', minsim: 5, prestige: 2 } },
      { key: 'skim', label: '남는 곡식을 챙긴다', fx: { say: '남는 곡식이 사사로이 팔려 나갔다.', wealth: cut(0.7), flaw: { label: '환곡 착복', p: 0.25 } } },
    ],
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
    opts: (s) => {
      const reserve = s.regions[here(s)].tags.includes('reserve');
      return [
        reserve
          ? { key: 'relief', label: '비축한 환곡을 푼다', fx: { say: '비축해 둔 환곡을 풀었다. 굶어 죽는 이가 없었다.', minsim: 10, prestige: 2, run: (s) => void (s.regions[here(s)].tags = s.regions[here(s)].tags.filter((x) => x !== 'reserve')) } }
          : { key: 'relief', label: '감영 창고를 열어 진휼한다', fx: { say: '창고를 열었다.', minsim: 7, prestige: 2, favor: -2 } },
        { key: 'remit', label: '세금 감면을 청하는 장계를 올린다', fx: { say: '감면을 청했다.', minsim: 4, favor: -1 } },
        {
          key: 'squeeze',
          label: '정액대로 거둔다',
          fx: {
            say: '정액대로 거두었다. 길가에 굶어 죽은 이가 늘었다.',
            favor: 3,
            minsim: -10,
            note: '민심이 바닥이면 민란이 날 수 있다',
            run(s) {
              if (s.regions[here(s)].minsim >= 25 || !chance(s, 0.5)) return;
              const p = P(s);
              pres(p, -6);
              fav(p, -8);
              log(s, `[팔도] ${short(s)}에서 굶주린 백성들이 관아를 습격했다.`, 'court');
              return '굶주린 백성들이 관아로 몰려와 창고를 부쉈다. 민란이다! (명망 -6, 성심 -8)';
            },
          },
        },
      ];
    },
  },
  {
    id: 'plague',
    weight: () => 0.6,
    title: '역병',
    text: (s) => `${short(s)}의 몇 고을에 역병이 돌아 사람이 죽어 나간다. 백성들은 마을을 버리고 산으로 달아난다.`,
    opts: (s) => [
      { key: 'doctor', label: '의원과 약재를 보낸다', cost: 10, fx: { say: '의원과 약재를 보내 역병을 다스렸다.', minsim: 5, prestige: 2, sick: P(s).vigor <= 2 ? 0.25 : 0.08 } },
      { key: 'seal', label: '고을을 봉쇄해 번지지 않게 한다', fx: { say: '고을을 봉쇄했다. 안에 갇힌 이들의 원망이 크다.', minsim: -3 } },
      { key: 'flee', label: '감영을 잠시 옮겨 피한다', fx: { say: '감영을 옮겨 몸을 피했다. 선비들이 수군거린다.', prestige: -4 } },
    ],
  },
  {
    id: 'hyangri',
    weight: () => 0.8,
    title: '향리의 농간',
    text: (s) => `${short(s)} 고을의 향리들이 환곡 장부를 조작해 쌀에 겨를 섞어 빌려주고, 갚을 때는 알곡으로 받아 차익을 챙긴다는 고발이 들어왔다. 향리들은 수령들과도 줄이 닿아 있다.`,
    opts: () => [
      { key: 'purge', label: '장부를 뒤져 향리들을 처벌한다', fx: { say: '향리 몇을 곤장 치고 쫓아냈다.', minsim: 5, prestige: 2, favor: -1 } },
      { key: 'share', label: '향리들의 몫을 나누어 받는다', fx: { say: '향리들이 철마다 인사를 차려 온다.', wealth: 8, flaw: { label: '환곡 농간', p: 0.3 } } },
    ],
  },
];

const localOf = (id: string) => LOCALS.find((x) => x.id === id);

export function rollLocal(s: GameState) {
  if (!localOffice(s) || s.pending.length >= 2) return;
  if (monthsSince(s, 'localAt') < 2 || !chance(s, 0.3)) return;
  const r = here(s);
  const pool = LOCALS.filter((x) => (!x.regions || x.regions.includes(r)) && (!x.when || x.when(s)));
  const ev = weighted(s, pool.map((x) => [x, (x.weight?.(s) ?? 1) * (x.regions ? 1.5 : 1)] as [Scene, number]));
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
        choices: choicesOf(s, c, d),
      };
    },
    resolve(s, c, key) {
      const d = localOf(c.lid);
      if (!d) return;
      if (!localOffice(s)) return '이미 그 고을을 떠났다.';
      return resolveScene(s, d, c, key, here(s));
    },
  },
};

/** 관찰사 공납: 도의 살림과 작황에 따라 몫이 달라진다 */
export function tributeAmounts(s: GameState) {
  const y = regionYield(s, here(s));
  return { normal: Math.max(2, Math.round(y * 0.5)), exploit: Math.max(4, Math.round(y * 1.2)), y };
}

export const isLocalOffice = localOffice;
