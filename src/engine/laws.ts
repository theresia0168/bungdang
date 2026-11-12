import type { FactionId, GameState } from './types';
import { tOf } from './calendar';
import { josa, log } from './state';
import { rand } from './rng';
import { topOf } from './opinion';

/* ───────── 국법(國法) ─────────
 * 나라의 법은 켜지고 꺼진다. 변법 상소로 새 법을 세우거나 있는 법을 없애자고 청할 수 있다.
 * 각 법은 국고·민심·국방·인사에 상시로 작용한다 (realm.ts, court.ts가 lawOn으로 읽는다).
 */

export interface LawDef {
  id: string;
  name: string;
  /** 무엇을 하는 법인가 */
  desc: string;
  /** 켜져 있을 때의 효과 */
  effect: string;
  /** 처음부터 시행 중인가 */
  initial: boolean;
  /** 이 무렵부터 논의할 수 있다 */
  from?: [number, number];
  /** 세울 때 왕의 마음 -1 ~ 1 (없앨 때는 반대) */
  king: number;
  /** 세우는 데 대한 당의 입장 (동인 계열은 dong, 서인은 seo로 본다) */
  stance: { dong: number; seo: number };
  /** 함께 설 수 없는 법 */
  excludes?: string;
  /** 세우는 데 맞서는 기득권의 힘 0~0.5. 조정 표결과 상소의 어려움에 더해진다 */
  resist?: number;
}

export const LAWS: LawDef[] = [
  {
    id: 'bumin',
    resist: 0.0,
    name: '부민고소금지법',
    desc: '아전과 백성이 수령을 고소하지 못하게 한 법. 위계를 지킨다지만 수령의 탐학을 막을 길이 없다.',
    effect: '수령의 착복 +4%p, 팔도 민심이 조금씩 깎인다',
    initial: true,
    king: -0.4,
    stance: { dong: 0.2, seo: 0.1 },
  },
  {
    id: 'jeseung',
    resist: 0.0,
    name: '제승방략(制勝方略)',
    desc: '변란이 나면 각 고을의 군사를 한곳에 모아 중앙에서 내려보낸 장수가 거느리는 방어 체제.',
    effect: '평시 군비 -2. 큰 침략에는 고을마다 버틸 힘이 없어 전쟁 대비 점수 -8',
    initial: true,
    king: 0.2,
    stance: { dong: 0, seo: 0 },
    excludes: 'jingwan',
  },
  {
    id: 'jingwan',
    resist: 0.15,
    name: '진관(鎭管) 체제 복구',
    desc: '도마다 거진(巨鎭)을 두고 고을들이 스스로 지키게 하는 옛 체제로 돌아간다.',
    effect: '군비 +3, 진보의 효과가 커지고 전쟁 대비 점수 +6',
    initial: false,
    king: -0.1,
    stance: { dong: 0.2, seo: 0.4 },
    excludes: 'jeseung',
  },
  {
    id: 'sumi',
    resist: 0.3,
    name: '수미법(收米法)',
    desc: '공물을 현물 대신 쌀로 거둔다. 방납의 폐단을 막지만 방납으로 배를 불리던 이들이 반발한다.',
    effect: '세입 +8%, 팔도 민심 조금씩 상승. 탐욕스러운 이들이 싫어한다',
    initial: false,
    from: [1576, 1],
    king: -0.2,
    stance: { dong: 0, seo: 0.8 },
  },
  {
    id: 'daedong',
    resist: 0.45,
    name: '대동법(大同法)',
    desc: '공물을 토지 결수에 따라 쌀로 고르게 거둔다. 땅 많은 이가 많이 낸다.',
    effect: '세입 +12%, 팔도 민심 상승. 은결의 이득이 준다. 지주들의 반발이 크다',
    initial: false,
    from: [1594, 1],
    king: -0.3,
    stance: { dong: 0.4, seo: 0.3 },
  },
  {
    id: 'hopae',
    resist: 0.25,
    name: '호패법(號牌法)',
    desc: '열여섯 살 이상 남자에게 호패를 차게 해 호구와 군적을 바로잡는다.',
    effect: '세입 +5%, 팔도 조련 +0.3/월, 민심이 조금씩 깎인다',
    initial: false,
    king: 0.4,
    stance: { dong: -0.2, seo: 0.2 },
  },
  {
    id: 'yangbyeong',
    resist: 0.3,
    name: '양병(養兵)',
    desc: '상비군 십만을 길러 변란에 대비하자는 이이의 주장.',
    effect: '군비 +8, 팔도 조련 +0.8/월, 전쟁 대비 점수 +10',
    initial: false,
    from: [1582, 1],
    king: -0.3,
    stance: { dong: -0.7, seo: 0.6 },
  },
  {
    id: 'seoeol',
    resist: 0.25,
    name: '서얼허통(庶孼許通)',
    desc: '서얼에게도 벼슬길을 연다.',
    effect: '서얼이 관직에 오를 수 있다',
    initial: false,
    king: 0.1,
    stance: { dong: -0.6, seo: 0.4 },
  },
  {
    id: 'hyangyak',
    resist: 0.15,
    name: '향약(鄕約) 보급',
    desc: '여씨향약을 온 나라 고을에 시행해 풍속을 바로잡는다.',
    effect: '팔도 민심 조금씩 상승, 사족의 힘이 커진다',
    initial: false,
    king: -0.3,
    stance: { dong: 0.7, seo: -0.3 },
  },
  {
    id: 'sachang',
    resist: 0.15,
    name: '사창제(社倉制)',
    desc: '고을마다 사창을 두어 흉년에 대비하고 환곡의 폐단을 줄인다.',
    effect: '흉년의 민심 하락이 준다. 세입 -3%',
    initial: false,
    king: 0,
    stance: { dong: 0.5, seo: 0.2 },
  },
  {
    id: 'nobi',
    resist: 0.35,
    name: '노비종모법(奴婢從母法)',
    desc: '양인 어머니의 자식은 양인으로 삼는다. 군역과 세를 질 양인이 는다.',
    effect: '세입 +5%, 팔도 조련 +0.2/월. 노비를 거느린 집안들이 싫어한다',
    initial: false,
    king: 0.2,
    stance: { dong: -0.4, seo: -0.2 },
  },
  {
    id: 'hullyeon',
    resist: 0.1,
    name: '훈련도감(訓鍊都監)',
    desc: '포수·사수·살수의 삼수병을 기르는 상설 군영.',
    effect: '군비 +5, 경기 조련 +1.5/월, 전쟁 대비 점수 +6',
    initial: false,
    from: [1592, 6],
    king: 0.5,
    stance: { dong: 0.3, seo: 0.3 },
  },
  {
    id: 'sogo',
    resist: 0.2,
    name: '속오군(束伍軍)',
    desc: '양반부터 노비까지 묶어 고을마다 지방군을 편성한다.',
    effect: '팔도 조련 +0.6/월, 전쟁 대비 점수 +5, 민심이 조금씩 깎인다',
    initial: false,
    from: [1594, 1],
    king: 0.3,
    stance: { dong: 0.1, seo: 0 },
  },
];

/** 한자 풀이를 뺀 이름으로 조사를 고른다: lawJosa('사창제(社倉制)', '이/가') → '사창제(社倉制)가' */
export function lawJosa(name: string, pair: string): string {
  const bare = name.replace(/\([^)]*\)/g, '');
  return name + josa(bare, pair).slice(bare.length);
}

LAWS.push(
  {
    id: 'gyunyeok',
    resist: 0.2,
    name: '균역법(均役法)',
    desc: '양인이 내던 군포를 두 필에서 한 필로 줄이고, 모자란 것은 결작과 어염세로 메운다.',
    effect: '팔도 민심이 오르고, 세입 -3%. 지주들이 결작을 싫어한다',
    initial: false,
    from: [1750, 1],
    king: 0.8,
    stance: { dong: 0.3, seo: 0.2 },
  },
  {
    id: 'tongong',
    resist: 0.25,
    name: '신해통공(辛亥通共)',
    desc: '육의전을 뺀 시전 상인의 금난전권을 없애 누구나 장사할 수 있게 한다.',
    effect: '도성 민심이 오르고 세입 +3%. 시전과 줄 닿은 권세가들이 싫어한다',
    initial: false,
    from: [1791, 1],
    king: 0.6,
    stance: { dong: 0.6, seo: -0.2 },
  },
  {
    id: 'napsok',
    resist: 0.0,
    name: '납속(納粟)·공명첩',
    desc: '곡식이나 돈을 바치면 벼슬 이름이나 면천·면역을 내준다. 나라 곳간은 차지만 신분의 질서가 흔들린다.',
    effect: '세입 +6%, 팔도 민심이 조금씩 깎인다. 어느 당도 내놓고 반기지 않는다',
    initial: false,
    from: [1593, 1],
    king: 0.5,
    stance: { dong: -0.3, seo: -0.3 },
  },
  {
    id: 'gunyeong',
    resist: 0.1,
    name: '어영청·금위영(군영 증설)',
    desc: '훈련도감 밖에 도성을 지키는 군영을 더 둔다. 군영의 대장 자리는 권세가 된다.',
    effect: '군비 +4, 경기·도성 조련 목표 +12, 전쟁 대비 점수 +4',
    initial: false,
    from: [1623, 4],
    king: 0.4,
    stance: { dong: -0.1, seo: 0.5 },
  },
  {
    id: 'yeongjeong',
    resist: 0.15,
    name: '영정법(永定法)',
    desc: '풍흉에 따라 해마다 매기던 전세를 토지 1결에 4두로 고정한다. 농민의 부담은 가벼워지나 나라의 몫이 준다.',
    effect: '세입 -4%, 팔도 민심 조금씩 상승',
    initial: false,
    from: [1630, 1],
    king: 0.2,
    stance: { dong: 0.2, seo: 0.5 },
  },
  {
    id: 'ogajak',
    resist: 0.15,
    name: '오가작통법(五家作統法)',
    desc: '다섯 집을 한 통으로 묶어 서로 살피게 한다. 유민과 도적을 막고 호구를 바로잡는다.',
    effect: '세입 +3%, 팔도 조련 목표 +4, 은결이 덜 는다. 민심이 조금씩 깎인다',
    initial: false,
    from: [1670, 1],
    king: 0.4,
    stance: { dong: 0.5, seo: 0.0 },
  },
  {
    id: 'hopo',
    resist: 0.5,
    name: '호포제(戶布制)',
    desc: '군포를 사람이 아닌 집마다 매겨 양반도 내게 한다. 윤휴가 주장했다. 양반들의 반발이 거세다.',
    effect: '세입 +7%, 팔도 민심 상승, 은결이 덜 는다. 사족들이 크게 싫어한다',
    initial: false,
    from: [1675, 1],
    king: 0.3,
    stance: { dong: 0.5, seo: -0.6 },
  },
  {
    id: 'sangpyeong',
    resist: 0.1,
    name: '상평통보(常平通寶) 유통',
    desc: '동전을 찍어 온 나라에 쓰게 한다. 장사가 트이지만 돈이 귀해지는 전황(錢荒)이 오기도 한다.',
    effect: '세입 +4%, 팔도 민심 조금 상승',
    initial: false,
    from: [1678, 1],
    king: 0.3,
    stance: { dong: 0.4, seo: 0.4 },
  },
  {
    id: 'seowon',
    resist: 0.3,
    name: '서원 정리(書院 毁撤)',
    desc: '허락 없이 세운 서원과 사우를 헐어 낸다. 서원에 딸린 땅과 군역 빠진 이들이 나라로 돌아온다. 사림이 반발한다.',
    effect: '세입 +3%, 팔도 민심 조금 상승. 서원을 끼고 사는 사림이 싫어한다',
    initial: false,
    from: [1714, 1],
    king: 0.6,
    stance: { dong: -0.2, seo: -0.4 },
  },
  {
    id: 'sinmungo',
    resist: 0.1,
    name: '신문고(申聞鼓) 부활',
    desc: '억울한 백성이 대궐 앞의 북을 쳐 왕에게 직접 하소연하게 한다.',
    effect: '팔도 민심 조금 상승, 수령의 착복 -2%p',
    initial: false,
    from: [1760, 1],
    king: 0.5,
    stance: { dong: 0.3, seo: 0.1 },
  },
);

export const LAW_MAP: Record<string, LawDef> = Object.fromEntries(LAWS.map((l) => [l.id, l]));

export function initLaws(): Record<string, { on: boolean; since: number }> {
  return Object.fromEntries(LAWS.map((l) => [l.id, { on: l.initial, since: 0 }]));
}

export const lawOn = (s: GameState, id: string) => !!s.laws?.[id]?.on;

/** 지금 논의할 수 있는 법인가 */
export const lawOpen = (s: GameState, l: LawDef) => !l.from || s.t >= tOf(l.from[0], l.from[1]);

/** 세우거나(on=true) 없앤다 */
export function setLaw(s: GameState, id: string, on: boolean, by?: string) {
  const l = LAW_MAP[id];
  if (!l) return;
  s.laws[id] = { on, since: s.t };
  if (on && l.excludes && s.laws[l.excludes]?.on) s.laws[l.excludes] = { on: false, since: s.t };
  if (id === 'seoeol') s.flags.seoeolOpen = on;
  log(s, `[국법] ${lawJosa(l.name, '이/가')} ${on ? '시행되었다' : '폐지되었다'}.${by ? ` (${by}의 상소)` : ''}`, 'history');
}

/** 이 법을 세우는(enact=true) 일에 대한 당의 입장 */
export function lawStance(l: LawDef, f: FactionId, enact: boolean): number {
  if (f === 'none') return 0;
  const v = topOf(f) === 'seo' ? l.stance.seo : l.stance.dong;
  return enact ? v : -v;
}

/** 이 당 사람이 밀 만한 법: 당론이 뚜렷이 찬성하는데 아직 없는 법, 또는 뚜렷이 반대하는데 시행 중인 법 */
export function lawToPush(s: GameState, f: FactionId): { lawId: string; abolish: boolean } | null {
  if (f === 'none') return null;
  const opts: { lawId: string; abolish: boolean; w: number }[] = [];
  for (const l of LAWS) {
    if (!lawOpen(s, l)) continue;
    const on = !!s.laws[l.id]?.on;
    // 막 바뀐 법은 5년, 부결된 법은 3년 동안 다시 다투지 않는다
    if (s.laws[l.id]?.since && s.t - s.laws[l.id].since < 60) continue;
    if (lawCooldown(s, l.id)) continue;
    const v = lawStance(l, f, !on);
    if (v >= 0.4) opts.push({ lawId: l.id, abolish: on, w: v });
  }
  if (!opts.length) return null;
  // 당론이 미는 법들 가운데 무게를 따라 고른다 (늘 같은 법만 밀지 않게)
  const total = opts.reduce((a, o) => a + o.w, 0);
  let r = rand(s) * total;
  for (const o of opts) {
    r -= o.w;
    if (r <= 0) return { lawId: o.lawId, abolish: o.abolish };
  }
  return { lawId: opts[0].lawId, abolish: opts[0].abolish };
}

/** 이 법을 세우거나 없애는 데 맞서는 힘. 세울 때는 기득권이, 없앨 때는 이미 굳은 관행이 버틴다 */
export const lawResist = (l: LawDef, enact: boolean) => (enact ? (l.resist ?? 0.15) : 0.1);

/** 이 법을 다시 논하려면 기다려야 하는 달 수 (부결 3년, 바뀐 뒤 5년) */
export function lawCooldown(s: GameState, id: string): number {
  const f = s.flags[`lawFail_${id}`];
  const fail = typeof f === 'number' ? f + 36 - s.t : 0;
  const since = s.laws[id]?.since;
  const changed = since ? since + 60 - s.t : 0;
  return Math.max(0, fail, changed);
}
