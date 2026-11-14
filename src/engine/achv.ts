import type { GameState } from './types';
import { notice } from './state';

/* ───────── 업적 ─────────
 * 한 판 안에서 이룬 것을 s.player.achv에 적는다. 판을 넘어 모으는 일은 화면(localStorage)이 맡는다.
 */

export interface Achv {
  id: string;
  name: string;
  desc: string;
  test(s: GameState): boolean;
}

const deed = (s: GameState, re: RegExp) => s.player.deeds.some((d) => re.test(d));
const peaks = (s: GameState) => [...s.player.lineage.map((a) => a.peakOffice ?? ''), s.player.peakOffice ?? ''];

export const ACHIEVEMENTS: Achv[] = [
  { id: 'jeongseung', name: '백관의 으뜸', desc: '가문의 누군가가 정승에 오른다', test: (s) => peaks(s).some((o) => /의정/.test(o)) },
  { id: 'cheongbaek', name: '청백리', desc: '청백리에 뽑힌다', test: (s) => deed(s, /청백리/) },
  { id: 'seonjeong', name: '선정비', desc: '수령으로 있던 고을에 선정비가 선다', test: (s) => deed(s, /선정비/) },
  { id: 'rival', name: '끝까지 버틴 사람', desc: '숙적과의 오랜 다툼을 끝낸다', test: (s) => deed(s, /숙적 .+ 다툼이 끝남/) },
  { id: 'amhaeng', name: '암행어사 출두', desc: '암행어사로 고을에 출도한다', test: (s) => deed(s, /암행어사/) },
  { id: 'tongsin', name: '바다 건너', desc: '통신사로 일본에 다녀온다', test: (s) => deed(s, /통신사로/) },
  { id: 'uibyeong', name: '창의(倡義)', desc: '전란 때 의병을 일으킨다', test: (s) => deed(s, /의병/) },
  { id: 'namhan', name: '남한산성', desc: '병자호란 때 남한산성으로 어가를 호종한다', test: (s) => deed(s, /남한산성/) },
  { id: 'sunjeol', name: '남문루의 불길', desc: '강화도에서 순절한다', test: (s) => deed(s, /순절/) },
  { id: 'cheokhwa', name: '찢는 이', desc: '척화신으로 심양에 끌려간다', test: (s) => deed(s, /척화신으로 심양/) },
  { id: 'hold', name: '성을 지킨 수령', desc: '민란 때 고을의 성을 지킨다', test: (s) => deed(s, /성을 지킴/) },
  { id: 'gens5', name: '다섯 대', desc: '가문이 다섯 대를 잇는다', test: (s) => s.player.lineage.length >= 4 },
  { id: 'gens9', name: '아홉 대', desc: '가문이 아홉 대를 잇는다', test: (s) => s.player.lineage.length >= 8 },
  { id: 'timeline', name: '1821년', desc: '가문을 1821년까지 지킨다', test: (s) => s.over?.reason === 'timeline' },
  { id: 'marriage', name: '혼맥의 그물', desc: '한 대에 혼맥을 여덟 번 맺는다', test: (s) => s.player.stats.marriages >= 8 },
  { id: 'alt', name: '다른 역사', desc: '역사와 다른 임금이 즉위한다', test: (s) => !!s.flags.altKing },
  { id: 'hard', name: '험한 길', desc: '「험난」 난이도로 1821년에 이른다', test: (s) => s.flags.diff === 'hard' && s.over?.reason === 'timeline' },
];

/** 새로 이룬 업적을 적고 알린다 */
export function checkAchv(s: GameState) {
  const got = (s.player.achv ??= []);
  for (const a of ACHIEVEMENTS) {
    if (got.includes(a.id) || !a.test(s)) continue;
    got.push(a.id);
    if (!s.over) notice(s, `업적 — ${a.name}`, `${a.desc}.`, 'personal');
  }
}
