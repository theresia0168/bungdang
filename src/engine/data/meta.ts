import type { FactionId, RegionId, SchoolId, TraitId } from '../types';

/** 붕당 색은 오방색(동-청, 서-백, 남-적, 북-흑, 중앙-황)을 따른다. */
export const FACTION_META: Record<FactionId, { name: string; short: string; color: string; desc: string }> = {
  dong: {
    name: '동인',
    short: '東',
    color: '#4a8fd0',
    desc: '김효원을 중심으로 한 신진 사림. 외척 정치의 청산을 주장한다. 퇴계·남명·화담 문인이 많다.',
  },
  seo: {
    name: '서인',
    short: '西',
    color: '#e8e1cc',
    desc: '심의겸을 중심으로 한 기성 사림. 기호 지방의 율곡·우계 문인이 중심이다.',
  },
  nam: {
    name: '남인',
    short: '南',
    color: '#d0534a',
    desc: '동인 가운데 온건파. 류성룡·우성전 등 퇴계 문인이 중심이다.',
  },
  buk: {
    name: '북인',
    short: '北',
    color: '#8a8fb0',
    desc: '동인 가운데 강경파. 이산해·정인홍 등 남명·화담 문인이 중심이다.',
  },
  none: {
    name: '무당',
    short: '中',
    color: '#c9a227',
    desc: '어느 붕당에도 속하지 않았다.',
  },
};

export const SCHOOL_META: Record<SchoolId, { name: string; desc: string }> = {
  toegye: { name: '퇴계학파', desc: '이황의 학통. 경상좌도가 중심이다.' },
  nammyeong: { name: '남명학파', desc: '조식의 학통. 경상우도가 중심이며 실천과 기개를 중시한다.' },
  hwadam: { name: '화담학파', desc: '서경덕의 학통. 개성과 경기에 뿌리를 두었다.' },
  giho: { name: '기호학파', desc: '이이·성혼의 학통. 경기·충청·황해가 중심이다.' },
  none: { name: '무소속', desc: '뚜렷한 학통이 없다.' },
};

export const TRAIT_META: Record<TraitId, { name: string; desc: string }> = {
  upright: { name: '강직', desc: '탄핵 공격 +1. 선물을 받지 않으며 탐욕스러운 자를 경멸한다.' },
  mild: { name: '온건', desc: '탄핵 공격 -1. 서신과 방문의 효과 +2.' },
  radical: { name: '과격', desc: '탄핵 공격 +1. 다른 당 인물의 호감 -5.' },
  scholar: { name: '학자', desc: '학문 수양과 강학의 효율이 높다.' },
  writer: { name: '문장가', desc: '상소 가납 판정 +1.' },
  schemer: { name: '권모', desc: '뒷조사가 빠르고 정확하다. 다른 이들의 호감 -5.' },
  clean: { name: '청렴', desc: '탄핵 방어 +1. 흠결이 잘 생기지 않지만 축재에 서툴다.' },
  greedy: { name: '탐욕', desc: '축재 효율이 높지만 흠결이 잘 생긴다.' },
  ambitious: { name: '야심', desc: '정치 경험을 더 빨리 쌓는다.' },
  inlaw: { name: '외척', desc: '왕실의 인척. 사림의 경계를 받는다(호감 -10).' },
  mediator: { name: '조제', desc: '모든 이의 호감 +5. 조제 상소가 더 쉽다.' },
  recluse: { name: '은일', desc: '벼슬에 뜻이 없는 산림 처사. 관직 임용 가능성이 낮다.' },
  seoeol: { name: '서얼', desc: '서얼 출신이라 관직에 오를 수 없다.' },
};

export interface RegionMeta {
  id: RegionId;
  name: string;
  short: string;
  weight: number;
  schools: [SchoolId, number][];
  influence: Partial<Record<FactionId, number>>;
  exile?: string[];
  desc: string;
}

export const REGIONS: RegionMeta[] = [
  {
    id: 'hanseong',
    name: '한성부',
    short: '한성',
    weight: 0.1,
    schools: [['toegye', 3], ['hwadam', 3], ['giho', 3], ['nammyeong', 1], ['none', 1]],
    influence: { dong: 58, seo: 42 },
    desc: '도성. 조정과 궐이 있는 곳.',
  },
  {
    id: 'gyeonggi',
    name: '경기도',
    short: '경기',
    weight: 0.14,
    schools: [['giho', 5], ['hwadam', 2], ['toegye', 2], ['none', 1]],
    influence: { dong: 40, seo: 60 },
    desc: '기호 사림의 본거지. 파주에 이이와 성혼이 있다.',
  },
  {
    id: 'chungcheong',
    name: '충청도',
    short: '충청',
    weight: 0.14,
    schools: [['giho', 5], ['toegye', 2], ['hwadam', 1], ['none', 2]],
    influence: { dong: 35, seo: 65 },
    desc: '기호학파의 영향이 강하다.',
  },
  {
    id: 'jeolla',
    name: '전라도',
    short: '전라',
    weight: 0.16,
    schools: [['giho', 4], ['hwadam', 3], ['toegye', 1], ['none', 2]],
    influence: { dong: 50, seo: 50 },
    exile: ['진도', '흥양', '제주'],
    desc: '나라의 곡창. 동서의 세력이 팽팽하다.',
  },
  {
    id: 'gyeongsang',
    name: '경상도',
    short: '경상',
    weight: 0.22,
    schools: [['toegye', 5], ['nammyeong', 4], ['none', 1]],
    influence: { dong: 82, seo: 18 },
    exile: ['거제', '남해'],
    desc: '영남. 좌도는 퇴계, 우도는 남명의 학통이 뿌리내렸다.',
  },
  {
    id: 'gangwon',
    name: '강원도',
    short: '강원',
    weight: 0.05,
    schools: [['giho', 4], ['hwadam', 3], ['toegye', 2], ['none', 1]],
    influence: { dong: 50, seo: 50 },
    exile: ['삼척'],
    desc: '산간 지방. 강릉에 명문가가 있다.',
  },
  {
    id: 'hwanghae',
    name: '황해도',
    short: '황해',
    weight: 0.06,
    schools: [['giho', 6], ['none', 4]],
    influence: { dong: 35, seo: 65 },
    desc: '이이가 해주 석담에서 강학한 곳.',
  },
  {
    id: 'pyeongan',
    name: '평안도',
    short: '평안',
    weight: 0.07,
    schools: [['none', 6], ['giho', 2], ['toegye', 2]],
    influence: { dong: 50, seo: 50 },
    exile: ['강계', '위원'],
    desc: '서북 변경. 명으로 가는 사행로가 지난다.',
  },
  {
    id: 'hamgyeong',
    name: '함경도',
    short: '함경',
    weight: 0.06,
    schools: [['none', 7], ['giho', 2], ['toegye', 1]],
    influence: { dong: 50, seo: 50 },
    exile: ['회령', '갑산', '경원'],
    desc: '동북 변경. 대표적인 유배지.',
  },
];

export const REGION_META = Object.fromEntries(REGIONS.map((r) => [r.id, r])) as Record<RegionId, RegionMeta>;

export const EXILE_WEIGHTS: [RegionId, number][] = [
  ['hamgyeong', 3],
  ['pyeongan', 2],
  ['jeolla', 2],
  ['gyeongsang', 2],
  ['gangwon', 1],
];

export const FLAW_POOL = [
  '뇌물 수수',
  '은결(隱結) 은닉',
  '인사 청탁',
  '방납(防納) 연루',
  '첩실 추문',
  '친족의 비리',
  '공금 유용',
];
