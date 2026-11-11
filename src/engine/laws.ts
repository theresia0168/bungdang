import type { FactionId, GameState } from './types';
import { tOf } from './calendar';
import { log } from './state';
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
}

export const LAWS: LawDef[] = [
  {
    id: 'bumin',
    name: '부민고소금지법',
    desc: '아전과 백성이 수령을 고소하지 못하게 한 법. 위계를 지킨다지만 수령의 탐학을 막을 길이 없다.',
    effect: '수령의 착복 +4%p, 팔도 민심이 조금씩 깎인다',
    initial: true,
    king: -0.4,
    stance: { dong: 0.2, seo: 0.1 },
  },
  {
    id: 'jeseung',
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
    name: '호패법(號牌法)',
    desc: '열여섯 살 이상 남자에게 호패를 차게 해 호구와 군적을 바로잡는다.',
    effect: '세입 +5%, 팔도 조련 +0.3/월, 민심이 조금씩 깎인다',
    initial: false,
    king: 0.4,
    stance: { dong: -0.2, seo: 0.2 },
  },
  {
    id: 'yangbyeong',
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
    name: '서얼허통(庶孼許通)',
    desc: '서얼에게도 벼슬길을 연다.',
    effect: '서얼이 관직에 오를 수 있다',
    initial: false,
    king: 0.1,
    stance: { dong: -0.6, seo: 0.4 },
  },
  {
    id: 'hyangyak',
    name: '향약(鄕約) 보급',
    desc: '여씨향약을 온 나라 고을에 시행해 풍속을 바로잡는다.',
    effect: '팔도 민심 조금씩 상승, 사족의 힘이 커진다',
    initial: false,
    king: -0.3,
    stance: { dong: 0.7, seo: -0.3 },
  },
  {
    id: 'sachang',
    name: '사창제(社倉制)',
    desc: '고을마다 사창을 두어 흉년에 대비하고 환곡의 폐단을 줄인다.',
    effect: '흉년의 민심 하락이 준다. 세입 -3%',
    initial: false,
    king: 0,
    stance: { dong: 0.5, seo: 0.2 },
  },
  {
    id: 'nobi',
    name: '노비종모법(奴婢從母法)',
    desc: '양인 어머니의 자식은 양인으로 삼는다. 군역과 세를 질 양인이 는다.',
    effect: '세입 +5%, 팔도 조련 +0.2/월. 노비를 거느린 집안들이 싫어한다',
    initial: false,
    king: 0.2,
    stance: { dong: -0.4, seo: -0.2 },
  },
  {
    id: 'hullyeon',
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
    name: '속오군(束伍軍)',
    desc: '양반부터 노비까지 묶어 고을마다 지방군을 편성한다.',
    effect: '팔도 조련 +0.6/월, 전쟁 대비 점수 +5, 민심이 조금씩 깎인다',
    initial: false,
    from: [1594, 1],
    king: 0.3,
    stance: { dong: 0.1, seo: 0 },
  },
];

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
  log(s, `[국법] ${l.name}${on ? '이 시행되었다' : '이 폐지되었다'}.${by ? ` (${by}의 상소)` : ''}`, 'court');
}

/** 이 법을 세우는(enact=true) 일에 대한 당의 입장 */
export function lawStance(l: LawDef, f: FactionId, enact: boolean): number {
  if (f === 'none') return 0;
  const v = topOf(f) === 'seo' ? l.stance.seo : l.stance.dong;
  return enact ? v : -v;
}
