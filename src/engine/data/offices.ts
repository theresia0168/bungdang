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
  /** 속한 관서 (조직도) */
  dept?: DeptId;
  /** 이 무렵에 생긴다 */
  from?: [number, number];
  /** 이 무렵에 없어진다 */
  to?: [number, number];
  /** 이 법이 시행 중일 때만 있다 */
  law?: string;
  /** 전란·변란 중에만 둔다 */
  war?: boolean;
  /** 겸직: 이 품계 이상의 실직에 있는 이가 겸한다. 본직을 잃으면 함께 내려놓는다 */
  concurrent?: number;
  /** 군문의 자리 */
  military?: boolean;
  /** 허직(虛職): 실권 없이 녹봉으로 대우하는 자리. 보직을 기다리는 당상관만 앉고, 요직으로 옮기는 데 걸림이 없다 */
  sinecure?: boolean;
}

export type DeptId =
  | 'uijeongbu' | 'ijo' | 'hojo' | 'yejo' | 'byeongjo' | 'hyeongjo' | 'gongjo'
  | 'saheonbu' | 'saganwon' | 'hongmungwan'
  | 'seungjeongwon' | 'hanseongbu' | 'seonggyungwan'
  | 'bibyeonsa' | 'seonhyecheong'
  | 'hullyeon' | 'eoyeong' | 'geumwi' | 'jangyong'
  | 'gyujanggak' | 'gamyeong' | 'wonsu' | 'jungchubu';

export interface DeptDef {
  id: DeptId;
  name: string;
  /** 조직도에서 묶이는 갈래 */
  branch: 'uijeongbu' | 'samsa' | 'gunmun' | 'etc' | 'oe';
  desc: string;
}

export const BRANCHES: { id: DeptDef['branch']; name: string }[] = [
  { id: 'uijeongbu', name: '의정부 · 육조' },
  { id: 'samsa', name: '삼사(三司)' },
  { id: 'etc', name: '승정원 · 비변사 · 여러 관서' },
  { id: 'gunmun', name: '군문(軍門)' },
  { id: 'oe', name: '외직' },
];

export const DEPTS: DeptDef[] = [
  { id: 'uijeongbu', name: '의정부', branch: 'uijeongbu', desc: '삼정승이 백관을 거느리고 국정을 의논한다.' },
  { id: 'ijo', name: '이조', branch: 'uijeongbu', desc: '문관의 인사.' },
  { id: 'hojo', name: '호조', branch: 'uijeongbu', desc: '호구·전세·재정.' },
  { id: 'yejo', name: '예조', branch: 'uijeongbu', desc: '예악·제사·과거·외교.' },
  { id: 'byeongjo', name: '병조', branch: 'uijeongbu', desc: '무관의 인사와 군정.' },
  { id: 'hyeongjo', name: '형조', branch: 'uijeongbu', desc: '법률·형옥·노비.' },
  { id: 'gongjo', name: '공조', branch: 'uijeongbu', desc: '토목·영선·공장.' },
  { id: 'saheonbu', name: '사헌부', branch: 'samsa', desc: '관원을 규찰하고 탄핵한다.' },
  { id: 'saganwon', name: '사간원', branch: 'samsa', desc: '왕에게 간쟁한다.' },
  { id: 'hongmungwan', name: '홍문관', branch: 'samsa', desc: '경연과 문한을 맡는 옥당.' },
  { id: 'seungjeongwon', name: '승정원', branch: 'etc', desc: '왕명을 출납하는 왕의 비서실.' },
  { id: 'bibyeonsa', name: '비변사', branch: 'etc', desc: '변방의 일을 의논하던 임시 기구. 전란을 거치며 국정의 중심이 되었다. 대신과 판서들이 겸직한다.' },
  { id: 'seonhyecheong', name: '선혜청', branch: 'etc', desc: '대동미를 거두고 나누는 관청. 당상은 겸직이다.' },
  { id: 'hanseongbu', name: '한성부', branch: 'etc', desc: '도성의 행정.' },
  { id: 'seonggyungwan', name: '성균관', branch: 'etc', desc: '나라의 최고 학당.' },
  { id: 'jungchubu', name: '중추부', branch: 'etc', desc: '맡은 일이 없는 당상관을 대우하는 관서. 실권은 없고 녹봉만 받으며 다음 보직을 기다린다.' },
  { id: 'gyujanggak', name: '규장각', branch: 'etc', desc: '정조가 세운 왕실 도서관이자 학술·정책 기구.' },
  { id: 'wonsu', name: '도원수부 · 체찰부', branch: 'gunmun', desc: '전란과 변란이 일면 두는 임시 지휘부.' },
  { id: 'hullyeon', name: '훈련도감', branch: 'gunmun', desc: '삼수병을 기르는 상설 군영.' },
  { id: 'eoyeong', name: '어영청', branch: 'gunmun', desc: '도성을 지키는 군영.' },
  { id: 'geumwi', name: '금위영', branch: 'gunmun', desc: '대궐과 도성을 지키는 군영.' },
  { id: 'jangyong', name: '장용영', branch: 'gunmun', desc: '정조가 왕권을 받치려 세운 친위 군영.' },
  { id: 'gamyeong', name: '팔도 감영', branch: 'oe', desc: '팔도의 관찰사.' },
];

export const DEPT_MAP: Record<string, DeptDef> = Object.fromEntries(DEPTS.map((d) => [d.id, d]));

const JO_NAME = { ijo: '이조', hojo: '호조', yejo: '예조', byeongjo: '병조', hyeongjo: '형조', gongjo: '공조' } as const;

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
  { id: 'yeonguijeong', dept: 'uijeongbu', name: '영의정', group: 'uijeongbu', rank: 1, weight: 10, term: 36, desc: '백관의 으뜸.' },
  { id: 'jwauijeong', dept: 'uijeongbu', name: '좌의정', group: 'uijeongbu', rank: 1, weight: 8, term: 30, desc: '의정부의 버금 정승.' },
  { id: 'uuijeong', dept: 'uijeongbu', name: '우의정', group: 'uijeongbu', rank: 1, weight: 7, term: 30, desc: '삼정승의 하나.' },
  { id: 'ijo', dept: 'ijo', name: '이조판서', group: 'yukjo', rank: 2, weight: 8, term: 15, desc: '문관 인사를 맡는다. 관직 임용에 큰 영향을 주며 천거할 수 있다.' },
  { id: 'hojo', dept: 'hojo', name: '호조판서', group: 'yukjo', rank: 2, weight: 5, term: 15, desc: '나라 살림을 맡는다. 녹봉이 많다.' },
  { id: 'yejo', dept: 'yejo', name: '예조판서', group: 'yukjo', rank: 2, weight: 4, term: 15, desc: '과거를 주관한다. 같은 당 응시자가 유리해진다.' },
  { id: 'byeongjo', dept: 'byeongjo', name: '병조판서', group: 'yukjo', rank: 2, weight: 6, term: 15, desc: '군정을 맡는다. 직무에 힘쓰면 남쪽 방비가 오른다.' },
  { id: 'hyeongjo', dept: 'hyeongjo', name: '형조판서', group: 'yukjo', rank: 2, weight: 4, term: 15, desc: '형옥을 맡는다.' },
  { id: 'gongjo', dept: 'gongjo', name: '공조판서', group: 'yukjo', rank: 2, weight: 2, term: 15, desc: '토목과 공장을 맡는다.' },
  { id: 'daesaheon', dept: 'saheonbu', name: '대사헌', group: 'samsa', rank: 2, weight: 6, term: 10, samsa: true, desc: '사헌부의 장. 탄핵 공격 +1.' },
  { id: 'daejehak', dept: 'hongmungwan', name: '홍문관 대제학', group: 'samsa', rank: 2, weight: 4, term: 40, literary: true, desc: '문형(文衡). 나라의 글을 맡는 최고의 명예직으로, 학식이 높아야 오른다.' },
  { id: 'daesagan', dept: 'saganwon', name: '대사간', group: 'samsa', rank: 3, weight: 5, term: 10, samsa: true, desc: '사간원의 장. 탄핵 공격 +1.' },
  { id: 'bujehak', dept: 'hongmungwan', name: '홍문관 부제학', group: 'samsa', rank: 3, weight: 5, term: 10, samsa: true, desc: '홍문관의 실질적 장. 탄핵 공격 +1.' },
  { id: 'doseungji', dept: 'seungjeongwon', name: '도승지', group: 'court', rank: 3, weight: 5, term: 12, desc: '왕명 출납을 맡는다. 올라오는 상소를 돌려보낼 수 있다.' },
  { id: 'panyun', dept: 'hanseongbu', name: '한성판윤', group: 'court', rank: 2, weight: 4, term: 14, desc: '도성의 행정을 맡는다.' },
  { id: 'seungji1', dept: 'seungjeongwon', name: '좌승지', group: 'court', rank: 3, weight: 2, term: 10, desc: '승정원 승지. 왕의 곁에서 왕명을 출납한다.' },
  { id: 'seungji2', dept: 'seungjeongwon', name: '우승지', group: 'court', rank: 3, weight: 2, term: 10, desc: '승정원 승지. 왕의 곁에서 왕명을 출납한다.' },
  { id: 'daesaseong', dept: 'seonggyungwan', name: '성균관 대사성', group: 'court', rank: 3, weight: 3, term: 14, literary: true, desc: '성균관의 장. 유생을 이끈다. 학식이 높아야 오른다.' },
  { id: 'jeonrang', dept: 'ijo', name: '이조전랑', group: 'cheongyo', rank: 5, weight: 6, term: 12, cheongyo: true, desc: '통청권(通淸權)으로 청요직 인사를 좌우한다. 천거할 수 있다.' },
  ...slots(2, { id: 'jangnyeong', dept: 'saheonbu', name: '사헌부 장령', group: 'cheongyo', rank: 4, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' }),
  { id: 'eunggyo', dept: 'hongmungwan', name: '홍문관 응교', group: 'cheongyo', rank: 4, weight: 2, term: 12, cheongyo: true, samsa: true, literary: true, desc: '삼사 언관. 탄핵 공격 +1.' },
  ...slots(2, { id: 'gyori', dept: 'hongmungwan', name: '홍문관 교리', group: 'cheongyo', rank: 5, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' }),
  ...slots(2, { id: 'jipyeong', dept: 'saheonbu', name: '사헌부 지평', group: 'cheongyo', rank: 5, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' }),
  ...slots(2, { id: 'jeongeon', dept: 'saganwon', name: '사간원 정언', group: 'cheongyo', rank: 6, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' }),
  ...GAMSA.map(
    ([region, name, weight]): OfficeDef => ({
      id: `gamsa_${region}`,
      name,
      group: 'gamsa',
      dept: 'gamyeong',
      rank: 2,
      weight,
      term: 12,
      fixedTerm: true,
      region,
      desc: '한 도의 감사. 임기 1년(360일)을 채우면 교체된다. 해마다 가을에 공납을 어떻게 거둘지 정한다.',
    }),
  ),
  // ── 육조 참판 ──
  ...(['ijo', 'hojo', 'yejo', 'byeongjo', 'hyeongjo', 'gongjo'] as const).map(
    (d): OfficeDef => ({ id: `champan_${d}`, dept: d, name: `${JO_NAME[d]}참판`, group: 'yukjo', rank: 3, weight: d === 'ijo' ? 3 : 2, term: 14, desc: '판서를 보좌하는 버금 자리. 판서와 손발이 맞아야 일이 된다.' }),
  ),
  // ── 삼사의 다른 자리 ──
  { id: 'jibui', dept: 'saheonbu', name: '사헌부 집의', group: 'cheongyo', rank: 4, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '대사헌을 보좌하는 언관. 탄핵 공격 +1.' },
  { id: 'sagan', dept: 'saganwon', name: '사간원 사간', group: 'cheongyo', rank: 4, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '대사간을 보좌하는 언관. 탄핵 공격 +1.' },
  { id: 'heonnap', dept: 'saganwon', name: '사간원 헌납', group: 'cheongyo', rank: 5, weight: 2, term: 12, cheongyo: true, samsa: true, desc: '삼사 언관. 탄핵 공격 +1.' },
  { id: 'jikjehak', dept: 'hongmungwan', name: '홍문관 직제학', group: 'cheongyo', rank: 4, weight: 2, term: 12, cheongyo: true, samsa: true, literary: true, desc: '옥당의 상급 관원. 탄핵 공격 +1.' },
  ...slots(2, { id: 'suchan', dept: 'hongmungwan', name: '홍문관 수찬', group: 'cheongyo', rank: 6, weight: 1, term: 12, cheongyo: true, samsa: true, literary: true, desc: '옥당의 젊은 문신. 탄핵 공격 +1.' }),
  // ── 승정원·한성부 ──
  { id: 'busengji1', dept: 'seungjeongwon', name: '좌부승지', group: 'court', rank: 3, weight: 1, term: 10, desc: '승정원 승지.' },
  { id: 'busengji2', dept: 'seungjeongwon', name: '우부승지', group: 'court', rank: 3, weight: 1, term: 10, desc: '승정원 승지.' },
  { id: 'jwayun', dept: 'hanseongbu', name: '한성부 좌윤', group: 'court', rank: 3, weight: 1, term: 14, desc: '한성판윤을 보좌한다.' },
  // ── 겸직: 비변사·선혜청 ──
  { id: 'bibyeon_do', dept: 'bibyeonsa', name: '비변사 도제조', group: 'court', rank: 1, weight: 3, term: 36, concurrent: 1, desc: '정승이 겸한다. 변방과 군국(軍國)의 일을 총괄한다.' },
  ...slots(3, { id: 'bibyeon_je', dept: 'bibyeonsa', name: '비변사 제조', group: 'court', rank: 2, weight: 2, term: 24, concurrent: 2, desc: '판서·대신이 겸한다. 해마다 비변사 회의에서 방비의 큰 줄기를 정한다.' }),
  { id: 'seonhye', dept: 'seonhyecheong', name: '선혜청 당상', group: 'court', rank: 2, weight: 2, term: 24, concurrent: 2, from: [1608, 5], desc: '대동미를 맡는 겸직. 호조와 함께 나라 살림을 쥔다.' },
  // ── 군문 ──
  { id: 'hullyeon_dj', dept: 'hullyeon', name: '훈련대장', group: 'court', rank: 2, weight: 4, term: 30, law: 'hullyeon', military: true, desc: '훈련도감의 장. 도성의 군권을 쥔다. 반정이 일면 그의 칼끝이 향방을 가른다.' },
  { id: 'eoyeong_dj', dept: 'eoyeong', name: '어영대장', group: 'court', rank: 2, weight: 3, term: 30, law: 'gunyeong', military: true, desc: '어영청의 장. 도성의 군권을 나눠 쥔다.' },
  { id: 'geumwi_dj', dept: 'geumwi', name: '금위대장', group: 'court', rank: 2, weight: 3, term: 30, law: 'gunyeong', from: [1682, 3], military: true, desc: '금위영의 장. 대궐을 지킨다.' },
  { id: 'jangyong_dj', dept: 'jangyong', name: '장용대장', group: 'court', rank: 2, weight: 4, term: 30, from: [1793, 1], to: [1802, 2], military: true, desc: '정조의 친위 군영 장용영의 장. 왕의 사람만 오른다.' },
  // ── 규장각 ──
  { id: 'gyujang_je', dept: 'gyujanggak', name: '규장각 제학', group: 'court', rank: 2, weight: 3, term: 30, literary: true, from: [1776, 9], desc: '규장각의 장. 왕의 학문과 정책을 돕는다. 학식이 높아야 오른다.' },
  { id: 'gyujang_jik', dept: 'gyujanggak', name: '규장각 직각', group: 'cheongyo', rank: 5, weight: 2, term: 18, literary: true, from: [1776, 9], desc: '규장각의 젊은 학사. 왕의 총애를 받는 자리.' },
  // ── 중추부: 보직을 기다리는 대신들의 자리 ──
  { id: 'yeongjungchu', dept: 'jungchubu', name: '영중추부사', group: 'court', rank: 1, weight: 0, term: 48, sinecure: true, desc: '물러난 정승을 대우하는 자리. 실권은 없다.' },
  ...slots(2, { id: 'panjungchu', dept: 'jungchubu', name: '판중추부사', group: 'court', rank: 1, weight: 0, term: 48, sinecure: true, desc: '물러난 정승을 대우하는 자리. 실권은 없다.' }),
  ...slots(6, { id: 'jijungchu', dept: 'jungchubu', name: '지중추부사', group: 'court', rank: 2, weight: 0, term: 36, sinecure: true, desc: '보직이 없는 2품 대신을 대우하는 자리. 실권은 없다.' }),
  ...slots(6, { id: 'dongjungchu', dept: 'jungchubu', name: '동지중추부사', group: 'court', rank: 3, weight: 0, term: 36, sinecure: true, desc: '보직이 없는 당상관을 대우하는 자리. 실권은 없다.' }),
  // ── 전시 ──
  { id: 'dowonsu', dept: 'wonsu', name: '도원수', group: 'court', rank: 2, weight: 5, term: 60, war: true, military: true, desc: '전란·변란 때 군사를 총지휘한다. 그의 정치력이 전황에 보탬이 된다. 난이 끝나면 자리도 없어진다.' },
  { id: 'chechal', dept: 'wonsu', name: '도체찰사', group: 'court', rank: 1, weight: 3, term: 60, war: true, concurrent: 1, desc: '정승이 겸하는 전시 총책. 전란이 끝나면 내려놓는다.' },
];

export const OFFICE_MAP: Record<string, OfficeDef> = Object.fromEntries(OFFICES.map((o) => [o.id, o]));

export const rankLabel = (r: number) => (r >= 10 ? '무품' : `${r}품`);
export const salaryOf = (rank: number) => (rank <= 1 ? 6 : rank <= 2 ? 5 : rank <= 3 ? 4 : rank <= 5 ? 3 : rank <= 7 ? 2 : 1);
