import type { FactionId, RegionId, SchoolId, Status, TraitId } from '../types';

export interface RosterEntry {
  id: string;
  name: string;
  ho?: string;
  clan: string;
  born: number;
  destiny: number;
  faction: FactionId;
  lean?: 'nam' | 'buk';
  school: SchoolId;
  home: RegionId;
  status: Status;
  office?: string;
  rank: number;
  learning: number;
  politics: number;
  vigor: number;
  prestige: number;
  wealth: number;
  favor: number;
  traits: TraitId[];
  bio: string;
  tags?: string[];
  founder?: boolean;
  arrive?: [number, number];
  playable?: { difficulty: string; pitch: string };
}

/**
 * 1575년 시점의 관직 배치는 게임을 위해 각색했다.
 * 옥사 등 사건으로 죽은 인물의 천명은 사건이 없을 경우를 가정한 값이다.
 */
export const ROSTER: RosterEntry[] = [
  {
    id: 'kim_hyowon', name: '김효원', ho: '성암', clan: '선산 김씨', born: 1542, destiny: 1590,
    faction: 'dong', lean: 'nam', school: 'toegye', home: 'gyeongsang',
    status: 'active', office: 'jeonrang', rank: 5,
    learning: 4, politics: 4, vigor: 3, prestige: 45, wealth: 60, favor: 10,
    traits: ['upright', 'ambitious'], founder: true,
    bio: '신진 사림의 기수. 이조전랑으로서 외척 심의겸 일가의 전랑 진출을 막아서며 동인의 구심점이 된다.',
    playable: { difficulty: '보통', pitch: '동인의 기수. 분당의 한가운데서 시작한다.' },
  },
  {
    id: 'sim_uigyeom', name: '심의겸', ho: '손암', clan: '청송 심씨', born: 1535, destiny: 1587,
    faction: 'seo', school: 'none', home: 'hanseong',
    status: 'active', office: 'daesaheon', rank: 2,
    learning: 3, politics: 5, vigor: 3, prestige: 40, wealth: 150, favor: 30,
    traits: ['inlaw', 'ambitious'], founder: true,
    bio: '명종비 인순왕후의 아우. 을사년 이후 사림을 보호한 공이 있으나 신진 사림에게는 외척일 뿐이다.',
    playable: { difficulty: '보통', pitch: '외척 출신 서인의 구심점. 재력과 성심은 높지만 사림의 경계를 받는다.' },
  },
  {
    id: 'sim_chunggyeom', name: '심충겸', clan: '청송 심씨', born: 1545, destiny: 1594,
    faction: 'seo', school: 'none', home: 'hanseong',
    status: 'active', office: 'nanggwan', rank: 6,
    learning: 3, politics: 3, vigor: 3, prestige: 15, wealth: 80, favor: 10,
    traits: ['inlaw'],
    bio: '심의겸의 아우. 이조전랑 후임으로 천거되며 분당의 도화선이 된다.',
  },
  {
    id: 'yu_seongryong', name: '류성룡', ho: '서애', clan: '풍산 류씨', born: 1542, destiny: 1607,
    faction: 'dong', lean: 'nam', school: 'toegye', home: 'gyeongsang',
    status: 'active', office: 'gyori1', rank: 5,
    learning: 5, politics: 4, vigor: 4, prestige: 40, wealth: 50, favor: 15,
    traits: ['mild', 'scholar'],
    bio: '퇴계 이황의 수제자. 온건하고 신중하며 실무에 밝다.',
    playable: { difficulty: '쉬움', pitch: '퇴계의 수제자이자 온건한 실무가. 천명이 길다.' },
  },
  {
    id: 'yi_sanhae', name: '이산해', ho: '아계', clan: '한산 이씨', born: 1539, destiny: 1609,
    faction: 'dong', lean: 'buk', school: 'hwadam', home: 'hanseong',
    status: 'active', office: 'daesagan', rank: 3,
    learning: 4, politics: 5, vigor: 4, prestige: 35, wealth: 70, favor: 20,
    traits: ['writer', 'schemer'],
    bio: '토정 이지함의 조카. 문장으로 이름났고 정국의 흐름을 읽는 데 능하다.',
    playable: { difficulty: '보통', pitch: '정국의 흐름을 읽는 문장가. 권모가 무기다.' },
  },
  {
    id: 'yi_bal', name: '이발', ho: '동암', clan: '광산 이씨', born: 1544, destiny: 1606,
    faction: 'dong', lean: 'buk', school: 'hwadam', home: 'jeolla',
    status: 'active', office: 'jipyeong1', rank: 5,
    learning: 4, politics: 4, vigor: 3, prestige: 30, wealth: 40, favor: 5,
    traits: ['upright', 'radical'], tags: ['jeong_link'],
    bio: '동인 강경파의 선봉. 김효원의 뒤를 이어 이조전랑에 오른다.',
  },
  {
    id: 'jeong_yeorip', name: '정여립', ho: '죽도', clan: '동래 정씨', born: 1546, destiny: 1610,
    faction: 'seo', lean: 'buk', school: 'giho', home: 'jeolla',
    status: 'active', office: 'nanggwan', rank: 7,
    learning: 5, politics: 3, vigor: 4, prestige: 25, wealth: 40, favor: 0,
    traits: ['radical', 'ambitious'], tags: ['jeong'],
    bio: '율곡과 우계의 문하에서 촉망받던 젊은 학자. "천하는 공물(公物)"이라는 과격한 언사로 알려졌다.',
    playable: { difficulty: '매우 어려움', pitch: '역사는 그를 역적으로 기록한다. 운명을 거스를 수 있는가.' },
  },
  {
    id: 'kim_seongil', name: '김성일', ho: '학봉', clan: '의성 김씨', born: 1538, destiny: 1593,
    faction: 'dong', lean: 'nam', school: 'toegye', home: 'gyeongsang',
    status: 'active', office: 'jipyeong2', rank: 5,
    learning: 4, politics: 3, vigor: 3, prestige: 35, wealth: 40, favor: 0,
    traits: ['upright'],
    bio: '퇴계 문인. 거침없는 직언으로 "전상호(殿上虎)"라 불렸다.',
  },
  {
    id: 'heo_yeop', name: '허엽', ho: '초당', clan: '양천 허씨', born: 1517, destiny: 1580,
    faction: 'dong', lean: 'buk', school: 'hwadam', home: 'gangwon',
    status: 'active', office: 'gamsa_gyeongsang', rank: 2,
    learning: 4, politics: 4, vigor: 2, prestige: 40, wealth: 60, favor: 10,
    traits: ['upright'],
    bio: '화담 서경덕의 문인. 동인의 원로이자 허봉·허난설헌·허균의 아버지.',
  },
  {
    id: 'heo_bong', name: '허봉', ho: '하곡', clan: '양천 허씨', born: 1551, destiny: 1588,
    faction: 'dong', lean: 'buk', school: 'hwadam', home: 'hanseong',
    status: 'active', office: 'nanggwan', rank: 6,
    learning: 5, politics: 3, vigor: 2, prestige: 25, wealth: 40, favor: 5,
    traits: ['radical', 'writer'],
    bio: '허엽의 아들. 날카로운 언변의 동인 소장파.',
  },
  {
    id: 'no_susin', name: '노수신', ho: '소재', clan: '광주 노씨', born: 1515, destiny: 1590,
    faction: 'dong', lean: 'nam', school: 'toegye', home: 'gyeongsang',
    status: 'active', office: 'uuijeong', rank: 1,
    learning: 5, politics: 4, vigor: 3, prestige: 55, wealth: 70, favor: 25,
    traits: ['mild', 'scholar'],
    bio: '을사사화로 19년을 유배지에서 보낸 원로. 동인 계열의 중진 대신.',
  },
  {
    id: 'jeong_inhong', name: '정인홍', ho: '내암', clan: '서산 정씨', born: 1536, destiny: 1623,
    faction: 'dong', lean: 'buk', school: 'nammyeong', home: 'gyeongsang',
    status: 'retired', rank: 6,
    learning: 5, politics: 4, vigor: 5, prestige: 40, wealth: 50, favor: 0,
    traits: ['upright', 'radical'],
    bio: '남명 조식의 수제자. 경상우도 산림의 영수로 타협을 모른다.',
  },
  {
    id: 'choi_yeonggyeong', name: '최영경', ho: '수우당', clan: '화순 최씨', born: 1529, destiny: 1600,
    faction: 'dong', lean: 'buk', school: 'nammyeong', home: 'gyeongsang',
    status: 'retired', rank: 9,
    learning: 4, politics: 2, vigor: 3, prestige: 35, wealth: 30, favor: 0,
    traits: ['recluse', 'upright'], tags: ['jeong_link'],
    bio: '남명 문인으로 벼슬을 마다한 처사.',
  },
  {
    id: 'u_seongjeon', name: '우성전', ho: '추연', clan: '단양 우씨', born: 1542, destiny: 1593,
    faction: 'dong', lean: 'nam', school: 'toegye', home: 'gyeonggi',
    status: 'active', office: 'jeongeon1', rank: 6,
    learning: 4, politics: 3, vigor: 3, prestige: 25, wealth: 40, favor: 5,
    traits: ['mild'],
    bio: '퇴계 문인. 훗날 남인의 한 축이 된다.',
  },
  {
    id: 'yi_wonik', name: '이원익', ho: '오리', clan: '전주 이씨', born: 1547, destiny: 1634,
    faction: 'dong', lean: 'nam', school: 'none', home: 'gyeonggi',
    status: 'active', office: 'nanggwan', rank: 7,
    learning: 4, politics: 4, vigor: 5, prestige: 20, wealth: 30, favor: 5,
    traits: ['clean', 'mild'],
    bio: '태종의 후손. 몸집은 작으나 청렴하고 실무에 능하다.',
    playable: { difficulty: '쉬움', pitch: '말단 낭관에서 출발하는 청백리. 길게 보는 플레이에 맞는다.' },
  },
  {
    id: 'song_eunggae', name: '송응개', clan: '진천 송씨', born: 1536, destiny: 1588,
    faction: 'dong', lean: 'buk', school: 'none', home: 'hanseong',
    status: 'active', office: 'nanggwan', rank: 6,
    learning: 3, politics: 4, vigor: 3, prestige: 15, wealth: 40, favor: 0,
    traits: ['radical'],
    bio: '동인 강경파 언관.',
  },
  {
    id: 'jeong_cheol', name: '정철', ho: '송강', clan: '연일 정씨', born: 1536, destiny: 1593,
    faction: 'seo', school: 'giho', home: 'jeolla',
    status: 'active', office: 'doseungji', rank: 3,
    learning: 5, politics: 5, vigor: 3, prestige: 40, wealth: 60, favor: 25,
    traits: ['writer', 'radical'],
    bio: '관동별곡과 사미인곡의 문장가. 강직하나 과격하고 술을 즐긴다. 서인 강경파.',
    playable: { difficulty: '어려움', pitch: '서인 강경파의 칼. 세자 책봉 문제가 그를 기다린다.' },
  },
  {
    id: 'yi_i', name: '이이', ho: '율곡', clan: '덕수 이씨', born: 1536, destiny: 1584,
    faction: 'none', school: 'giho', home: 'gyeonggi',
    status: 'active', office: 'bujehak', rank: 3,
    learning: 6, politics: 4, vigor: 2, prestige: 60, wealth: 30, favor: 35,
    traits: ['scholar', 'mediator', 'clean'],
    bio: '아홉 번 장원한 구도장원공. 성학집요를 지어 바쳤다. 동서의 조제(調劑)를 주장한다.',
    playable: { difficulty: '매우 어려움', pitch: '동서 조제를 꿈꾸는 대학자. 천명이 짧다.' },
  },
  {
    id: 'seong_hon', name: '성혼', ho: '우계', clan: '창녕 성씨', born: 1535, destiny: 1598,
    faction: 'seo', school: 'giho', home: 'gyeonggi',
    status: 'retired', rank: 9,
    learning: 6, politics: 2, vigor: 2, prestige: 50, wealth: 30, favor: 10,
    traits: ['scholar', 'recluse', 'clean'],
    bio: '파주의 산림 처사. 이이의 벗이며 서인 학통의 한 축.',
  },
  {
    id: 'bak_sun', name: '박순', ho: '사암', clan: '충주 박씨', born: 1523, destiny: 1589,
    faction: 'seo', school: 'hwadam', home: 'jeolla',
    status: 'active', office: 'jwauijeong', rank: 1,
    learning: 5, politics: 4, vigor: 3, prestige: 50, wealth: 60, favor: 25,
    traits: ['clean', 'mild'],
    bio: '화담 문인이나 이이와 뜻을 같이해 서인이 된 청렴한 대신.',
  },
  {
    id: 'yun_dusu', name: '윤두수', ho: '오음', clan: '해평 윤씨', born: 1533, destiny: 1601,
    faction: 'seo', school: 'giho', home: 'hanseong',
    status: 'active', office: 'hojo', rank: 2,
    learning: 4, politics: 5, vigor: 4, prestige: 30, wealth: 100, favor: 15,
    traits: ['ambitious'],
    bio: '서인의 중진. 아우 윤근수와 함께 해평 윤씨 가문을 이끈다.',
  },
  {
    id: 'yun_geunsu', name: '윤근수', ho: '월정', clan: '해평 윤씨', born: 1537, destiny: 1616,
    faction: 'seo', school: 'giho', home: 'hanseong',
    status: 'active', office: 'nanggwan', rank: 4,
    learning: 4, politics: 3, vigor: 4, prestige: 25, wealth: 60, favor: 10,
    traits: ['writer'],
    bio: '윤두수의 아우. 문장과 외교에 밝다.',
  },
  {
    id: 'song_ikpil', name: '송익필', ho: '구봉', clan: '여산 송씨', born: 1534, destiny: 1599,
    faction: 'seo', school: 'giho', home: 'gyeonggi',
    status: 'retired', rank: 10,
    learning: 6, politics: 6, vigor: 4, prestige: 30, wealth: 40, favor: 0,
    traits: ['seoeol', 'schemer', 'scholar'],
    bio: '서얼 출신이라 벼슬길이 막힌 천재. 서인의 막후 책사로 불린다.',
  },
  {
    id: 'hwang_yungil', name: '황윤길', clan: '장수 황씨', born: 1536, destiny: 1601,
    faction: 'seo', school: 'giho', home: 'gyeonggi',
    status: 'active', office: 'nanggwan', rank: 4,
    learning: 3, politics: 3, vigor: 3, prestige: 20, wealth: 50, favor: 5,
    traits: [],
    bio: '서인 관료. 훗날 통신사 정사로 일본에 다녀온다.',
  },
  {
    id: 'gwon_cheol', name: '권철', clan: '안동 권씨', born: 1503, destiny: 1578,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'active', office: 'yeonguijeong', rank: 1,
    learning: 4, politics: 4, vigor: 2, prestige: 50, wealth: 90, favor: 30,
    traits: ['mild'],
    bio: '원로대신. 권율의 아버지.',
  },
  {
    id: 'seonjo', name: '선조', clan: '왕실', born: 1552, destiny: 1608,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'royal', rank: 0,
    learning: 5, politics: 5, vigor: 3, prestige: 100, wealth: 0, favor: 100,
    traits: [],
    bio: '조선 제14대 국왕. 방계 출신으로 즉위했다. 영민하나 의심이 많고, 신하들을 서로 견제시킨다.',
  },
  {
    id: 'imhae', name: '임해군', clan: '왕실', born: 1572, destiny: 1609,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'royal', rank: 0,
    learning: 2, politics: 2, vigor: 4, prestige: 10, wealth: 0, favor: 0,
    traits: [],
    bio: '선조의 맏아들. 공빈 김씨 소생. 성품이 거칠다는 평이 있다.',
  },
  {
    id: 'gwanghae', name: '광해군', clan: '왕실', born: 1575, destiny: 1641,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'royal', rank: 0,
    learning: 4, politics: 4, vigor: 4, prestige: 10, wealth: 0, favor: 0,
    traits: [], arrive: [1575, 4],
    bio: '선조의 둘째 아들. 공빈 김씨 소생.',
  },
  {
    id: 'sinseong', name: '신성군', clan: '왕실', born: 1578, destiny: 1592,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'royal', rank: 0,
    learning: 3, politics: 2, vigor: 1, prestige: 10, wealth: 0, favor: 0,
    traits: [], arrive: [1578, 6],
    bio: '인빈 김씨 소생. 선조가 각별히 아낀다.',
  },
  {
    id: 'uian', name: '의안군', clan: '왕실', born: 1577, destiny: 1588,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'royal', rank: 0,
    learning: 3, politics: 2, vigor: 1, prestige: 10, wealth: 0, favor: 0,
    traits: [], arrive: [1577, 2],
    bio: '인빈 김씨의 맏아들. 몸이 약하다.',
  },
  {
    id: 'jeongwon', name: '정원군', clan: '왕실', born: 1580, destiny: 1619,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'royal', rank: 0,
    learning: 3, politics: 3, vigor: 3, prestige: 10, wealth: 0, favor: 0,
    traits: [], arrive: [1580, 6],
    bio: '인빈 김씨 소생.',
  },
  {
    id: 'sunhwa', name: '순화군', clan: '왕실', born: 1580, destiny: 1607,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'royal', rank: 0,
    learning: 1, politics: 1, vigor: 4, prestige: 5, wealth: 0, favor: 0,
    traits: [], arrive: [1580, 9],
    bio: '순빈 김씨 소생.',
  },
  {
    id: 'uichang', name: '의창군', clan: '왕실', born: 1589, destiny: 1645,
    faction: 'none', school: 'none', home: 'hanseong',
    status: 'royal', rank: 0,
    learning: 3, politics: 2, vigor: 3, prestige: 5, wealth: 0, favor: 0,
    traits: [], arrive: [1589, 3],
    bio: '인빈 김씨 소생.',
  },
  {
    id: 'yi_hangbok', name: '이항복', ho: '백사', clan: '경주 이씨', born: 1556, destiny: 1618,
    faction: 'seo', school: 'giho', home: 'hanseong',
    status: 'active', office: 'nanggwan', rank: 9,
    learning: 5, politics: 4, vigor: 4, prestige: 20, wealth: 40, favor: 5,
    traits: ['writer', 'mild'], arrive: [1580, 3],
    bio: '재치와 해학으로 이름난 젊은 관료. 권율의 사위.',
  },
  {
    id: 'yi_deokhyeong', name: '이덕형', ho: '한음', clan: '광주 이씨', born: 1561, destiny: 1613,
    faction: 'dong', lean: 'nam', school: 'none', home: 'gyeonggi',
    status: 'active', office: 'nanggwan', rank: 9,
    learning: 5, politics: 4, vigor: 4, prestige: 20, wealth: 40, favor: 5,
    traits: ['mild', 'scholar'], arrive: [1580, 3],
    bio: '이산해의 사위. 어린 나이에 급제한 수재.',
  },
];
