import type { RegionId } from '../types';

export type OfficeGroup = 'uijeongbu' | 'yukjo' | 'samsa' | 'court' | 'cheongyo' | 'gamsa';

export const OFFICE_GROUPS: { id: OfficeGroup; name: string }[] = [
  { id: 'uijeongbu', name: '의정부' },
  { id: 'yukjo', name: '육조' },
  { id: 'samsa', name: '삼사 장관' },
  { id: 'court', name: '승정원 · 한성부 · 성균관' },
  { id: 'cheongyo', name: '청요직' },
  { id: 'gamsa', name: '팔도 관찰사' },
];

export interface OfficeDef {
  id: string;
  name: string;
  group: OfficeGroup;
  rank: number;
  weight: number;
  samsa?: boolean;
  cheongyo?: boolean;
  /** 학식이 임용 점수에 크게 든다 */
  literary?: boolean;
  /** 평균 재임 개월 */
  term: number;
  /** 임기가 정해진 자리 (관찰사 360일) */
  fixedTerm?: boolean;
  region?: RegionId;
  desc: string;
}

const GAMSA: [RegionId, string, number][] = [
  ['gyeonggi', '경기 관찰사', 3],
  ['chungcheong', '충청 관찰사', 3],
  ['jeolla', '전라 관찰사', 3],
  ['gyeongsang', '경상 관찰사', 3],
  ['gangwon', '강원 관찰사', 2],
  ['hwanghae', '황해 관찰사', 2],
  ['pyeongan', '평안 관찰사', 4],
  ['hamgyeong', '함경 관찰사', 3],
];

/** 같은 이름의 자리가 여럿이면 id 뒤에 1, 2…를 붙여 만든다 (jangnyeong1, jangnyeong2) */
const slots = (n: number, base: OfficeDef): OfficeDef[] => Array.from({ length: n }, (_, i) => ({ ...base, id: `${base.id}${i + 1}` }));

export const OFFICES: OfficeDef[] = [
  { id: 'yeonguijeong', name: '영의정', group: 'uijeongbu', rank: 1, weight: 10, term: 36, desc: '백관의 으뜸.' },
  { id: 'jwauijeong', name: '좌의정', group: 'uijeongbu', rank: 1, weight: 8, term: 30, desc: '의정부의 버금 정승.' },
  { id: 'uuijeong', name: '우의정', group: 'uijeongbu', rank: 1, weight: 7, term: 30, desc: '삼정승의 하나.' },
  { id: 'ijo', name: '이조판서', group: 'yukjo', rank: 2, weight: 8, term: 15, desc: '문관 인사를 맡는다. 관직 임용에 큰 영향을 주며 천거할 수 있다.' },
  { id: 'hojo', name: '호조판서', group: 'yukjo', rank: 2, weight: 5, term: 15, desc: '나라 살림을 맡는다. 녹봉이 많다.' },
  { id: 'yejo', name: '예조판서', group: 'yukjo', rank: 2, weight: 4, term: 15, desc: '과거를 주관한다. 같은 당 응시자가 유리해진다.' },
  { id: 'byeongjo', name: '병조판서', group: 'yukjo', rank: 2, weight: 6, term: 15, desc: '군정을 맡는다. 직무에 힘쓰면 국방 대비가 오른다.' },
  { id: 'hyeongjo', name: '형조판서', group: 'yukjo', rank: 2, weight: 4, term: 15, desc: '형옥을 맡는다.' },
  { id: 'gongjo', name: '공조판서', group: 'yukjo', rank: 2, weight: 2, term: 15, desc: '토목과 공장을 맡는다.' },
  { id: 'daesaheon', name: '대사헌', group: 'samsa', rank: 2, weight: 6, term: 10, samsa: true, desc: '사헌부의 장. 탄핵 공격 +1.' },
  { id: 'daejehak', name: '홍문관 대제학', group: 'samsa', rank: 2, weight: 4, term: 40, literary: true, desc: '문형(文衡). 나라의 글을 맡는 최고의 명예직으로, 학식이 높아야 오른다.' },
  { id: 'daesagan', name: '대사간', group: 'samsa', rank: 3, weight: 5, term: 10, samsa: true, desc: '사간원의 장. 탄핵 공격 +1.' },
  { id: 'bujehak', name: '홍문관 부제학', group: 'samsa', rank: 3, weight: 5, term: 10, samsa: true, desc: '홍문관의 실질적 장. 탄핵 공격 +1.' },
  { id: 'doseungji', name: '도승지', group: 'court', rank: 3, weight: 5, term: 12, desc: '왕명 출납을 맡는다. 올라오는 상소를 돌려보낼 수 있다.' },
  { id: 'panyun', name: '한성판윤', group: 'court', rank: 2, weight: 4, term: 14, desc: '도성의 행정을 맡는다.' },
  { id: 'seungji1', name: '좌승지', group: 'court', rank: 3, weight: 2, term: 10, desc: '승정원 승지. 왕의 곁에서 왕명을 출납한다.' },
  { id: 'seungji2', name: '우승지', group: 'court', rank: 3, weight: 2, term: 10, desc: '승정원 승지. 왕의 곁에서 왕명을 출납한다.' },
  { id: 'daesaseong', name: '성균관 대사성', group: 'court', rank: 3, weight: 3, term: 14, literary: true, desc: '성균관의 장. 유생을 이끈다. 학식이 높아야 오른다.' },
  { id: 'jeonrang', name: '이조전랑', group: 'cheongyo', rank: 5, weight: 6, term: 12, cheongyo: true, desc: '통청권(通淸權)으로 청요직 인사를 좌우한다. 천거할 수 있다.' },
  ...slots(2, { id: 'jangnyeong', name: '사헌부 장령', group: 'cheongyo', rank: 4, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' }),
  { id: 'eunggyo', name: '홍문관 응교', group: 'cheongyo', rank: 4, weight: 2, term: 12, cheongyo: true, samsa: true, literary: true, desc: '삼사 언관. 탄핵 공격 +1.' },
  ...slots(2, { id: 'gyori', name: '홍문관 교리', group: 'cheongyo', rank: 5, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' }),
  ...slots(2, { id: 'jipyeong', name: '사헌부 지평', group: 'cheongyo', rank: 5, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' }),
  ...slots(2, { id: 'jeongeon', name: '사간원 정언', group: 'cheongyo', rank: 6, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' }),
  ...GAMSA.map(
    ([region, name, weight]): OfficeDef => ({
      id: `gamsa_${region}`,
      name,
      group: 'gamsa',
      rank: 2,
      weight,
      term: 12,
      fixedTerm: true,
      region,
      desc: '한 도의 감사. 임기 1년(360일)을 채우면 교체된다. 해마다 가을에 공납을 어떻게 거둘지 정한다.',
    }),
  ),
];

export const OFFICE_MAP: Record<string, OfficeDef> = Object.fromEntries(OFFICES.map((o) => [o.id, o]));

export const rankLabel = (r: number) => (r >= 10 ? '무품' : `${r}품`);
export const salaryOf = (rank: number) => (rank <= 1 ? 6 : rank <= 2 ? 5 : rank <= 3 ? 4 : rank <= 5 ? 3 : rank <= 7 ? 2 : 1);
