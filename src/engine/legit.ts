import type { GameState } from './types';
import { clamp, log } from './state';

/* ───────── 왕의 정통성(正統性) ─────────
 * 조선의 큰 사건 가운데 많은 것이 임금의 정통성에서 비롯되었다.
 * 서자·차남·방계·반정으로 오른 임금은 명분으로 왕권을 세우려 하고(북벌·탕평·『천의소감』), 신하들은 예론으로 그 약점을 건드린다(예송).
 * 정통성이 낮으면 왕권의 바탕(용안이 돌아가는 자리)이 낮아지고, 국본 논의와 역모가 일어나기 쉽다.
 */

export interface Legit {
  score: number;
  why: string[];
}

const SEONJO_WHY = ['명종의 후사가 없어 방계(중종의 서손)에서 들어와 왕위를 이었다'];

export function legitOf(s: GameState): Legit {
  const score = typeof s.flags.legit === 'number' ? (s.flags.legit as number) : 50;
  const raw = s.flags.legitWhy;
  const why = typeof raw === 'string' ? (raw ? raw.split('|') : []) : SEONJO_WHY;
  return { score, why };
}

export function setLegit(s: GameState, score: number, why: string[]) {
  s.flags.legit = clamp(Math.round(score), 5, 95);
  s.flags.legitWhy = why.join('|');
}

/** 정통성이 흔들리거나 굳어진다 */
export function shakeLegit(s: GameState, d: number, why: string) {
  const L = legitOf(s);
  setLegit(s, L.score + d, [...L.why, why]);
  log(s, `[정통성] ${why}. 왕의 정통성이 ${d < 0 ? '흔들린다' : '굳어진다'}. (${d > 0 ? '+' : ''}${d})`, 'history');
}

export const legitName = (v: number) => (v >= 75 ? '굳건함' : v >= 55 ? '무난함' : v >= 40 ? '흔들림' : '위태로움');

/** 정통성이 왕권의 바탕에 보태거나 깎는 몫 */
export const legitAuthority = (s: GameState) => Math.round((legitOf(s).score - 55) * 0.15 * 10) / 10;

/** 즉위하는 임금의 정통성과 그 까닭 */
export function legitAtCrown(s: GameState, name: string): [number, string[]] {
  const f = s.flags;
  switch (name) {
    case '광해군':
      return [40, ['공빈 김씨 소생의 서자이자 둘째 아들이다', '명이 세자 책봉의 고명을 끝내 미루었다', '적통인 어린 영창대군이 살아 있다']];
    case '임해군':
      return [38, ['공빈 김씨 소생의 서자다', '거친 행실로 명의 책봉을 받기 어렵다', '적통인 영창대군이 살아 있다']];
    case '정원군':
    case '의창군':
      return [35, ['인빈 김씨 소생의 서자다', '형들을 제치고 섰다', '적통인 영창대군이 살아 있다']];
    case '인조':
      if (f.banjeongDone) return [35, ['반정으로 숙부를 몰아내고 섰다', '명의 책봉을 받기까지 곡절이 많았다']];
      if (f.injoEarly) return [60, ['아버지의 뒤를 이은 맏아들이다']];
      return [45, ['후사 없는 임금의 뒤를 방계로 이었다']];
    case '경선군':
      return [62, ['소현세자의 적장자로 법도에 맞는 계승이다', '어리고 병약하다']];
    case '효종':
      if (f.wonsonKept) return [45, ['조카의 뒤를 방계로 이었다', '형 소현세자의 죽음에 의혹이 남아 있다']];
      return f.samjeondo ? [40, ['둘째 아들로 적장손(원손)을 제치고 섰다', '형 소현세자의 죽음에 의혹이 남아 있다', '삼전도의 치욕을 겪은 왕실이다']] : [45, ['둘째 아들로 적장손(원손)을 제치고 섰다', '형 소현세자의 죽음에 의혹이 남아 있다']];
    case '현종':
      return [62, ['효종의 적장자다', '그러나 효종이 차남이었다는 시비가 따라다닌다']];
    case '숙종':
      return [85, ['3대 만의 적장자 계승이다']];
    case '경종':
      return [55, ['숙종의 맏아들이나 어머니 희빈 장씨가 사사되었다', '후사가 없다']];
    case '밀풍군':
      return [30, ['종친으로 소론이 받들어 세웠다', '숙종의 아들 연잉군이 살아 있다']];
    case '영조':
      if (f.yeongjoCoup) return [30, ['무수리 출신 숙빈 최씨의 아들이다', '정변으로 밀풍군을 몰아내고 섰다']];
      return [35, ['무수리 출신 숙빈 최씨의 아들이다', '형 경종을 독살했다는 말이 따라다닌다']];
    case '장조':
      return [45, ['영조의 아들이나 임오년에 죽을 뻔했던 세자다', '화증이 깊다']];
    case '정조':
      if (f.sadoAlive) return [58, ['아버지 장조의 선위를 받았다']];
      if (f.gapsin) return [50, ['「죄인(사도세자)의 아들」이라는 말이 따라다닌다', '효장세자의 후사로 입적되어 그 굴레를 조금 덜었다']];
      return [45, ['영조의 손자다', '「죄인(사도세자)의 아들」이라는 말이 따라다닌다']];
    case '순조':
      return [65, ['정조의 아들이다', '열한 살 어린 임금이다']];
    default:
      return [45, ['뜻밖에 대통을 이었다']];
  }
}
