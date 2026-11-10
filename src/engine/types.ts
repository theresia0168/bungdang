export type FactionId = 'dong' | 'seo' | 'nam' | 'buk' | 'none';

export type RegionId =
  | 'hanseong'
  | 'gyeonggi'
  | 'chungcheong'
  | 'jeolla'
  | 'gyeongsang'
  | 'gangwon'
  | 'hwanghae'
  | 'pyeongan'
  | 'hamgyeong';

export type SchoolId = 'toegye' | 'nammyeong' | 'hwadam' | 'giho' | 'none';

export type TraitId =
  | 'upright'
  | 'mild'
  | 'radical'
  | 'scholar'
  | 'writer'
  | 'schemer'
  | 'clean'
  | 'greedy'
  | 'ambitious'
  | 'inlaw'
  | 'mediator'
  | 'recluse'
  | 'seoeol';

/** active: 재직, idle: 한성에서 보직 대기, retired: 낙향, exiled: 유배 */
export type Status = 'active' | 'idle' | 'retired' | 'exiled' | 'dead' | 'royal';

export interface Flaw {
  id: string;
  label: string;
  public: boolean;
  knownBy: string[];
  t: number;
  /** 날조된 혐의. 탄핵이 실패하면 들통날 수 있다. */
  fake?: boolean;
}

export interface Character {
  id: string;
  name: string;
  ho?: string;
  clan: string;
  born: number;
  /** 천명: 이 해부터 매년 생사 판정 */
  destiny: number;
  checkMonth: number;
  faction: FactionId;
  lean?: 'nam' | 'buk';
  school: SchoolId;
  home: RegionId;
  location: RegionId;
  status: Status;
  office?: string;
  rank: number;
  /** 마지막으로 품계가 오른 시점. 승진 간격을 제한한다. */
  promotedAt: number;
  tenure: number;
  learning: number;
  politics: number;
  vigor: number;
  prestige: number;
  wealth: number;
  /** 성심(聖心): 왕의 신임 */
  favor: number;
  traits: TraitId[];
  flaws: Flaw[];
  /** 설욕 토큰: 이 인물이 원한을 품은 상대 */
  grudges: string[];
  exiledBy?: string;
  exilePlace?: string;
  /** 유배의 무게. 1 중도부처, 2 위리안치 */
  exileLevel?: number;
  /** 삭탈관작: 이 시점까지 서용되지 않는다 */
  banUntil?: number;
  /** 지낸 관직별로 물러난 달. 같은 자리에 곧바로 다시 앉지 않는다. */
  leftOffices?: Record<string, number>;
  teacher?: string;
  /** 지금 이 사람이 바라는 것. 들어주면 크게 고마워한다. */
  want?: Want;
  historical: boolean;
  bio?: string;
  founder?: boolean;
  tags: string[];
  death?: { t: number; cause: string };
}

export type WantKind = 'office' | 'wealth' | 'match' | 'revenge' | 'recall' | 'learning' | 'peace';

export interface Want {
  kind: WantKind;
  /** revenge: 원수, recall: 풀려나기를 바라는 사람 */
  about?: string;
  since: number;
}

/** 수치가 아닌 관계. 지기는 저절로 맺어지고, 맹약은 청해서 맺는다. */
export type BondKind = 'jigi' | 'maengyak';

export interface Bond {
  kind: BondKind;
  with: string;
  since: number;
  /** 당색이 다른 이와 몰래 맺은 맹약 */
  secret?: boolean;
}

/** 정적이 플레이어를 노려 꾸미는 일 */
export interface Plot {
  id: string;
  by: string;
  /** 꾸밈이 끝나 논핵을 시작하는 달 */
  due: number;
  /** 플레이어가 낌새를 챘는가 */
  known: boolean;
  /** 몸을 낮추어 공격의 기세가 꺾였다 */
  softened?: boolean;
}

/** 곧 갈릴 자리를 두고 벌어지는 경쟁 */
export interface Race {
  office: string;
  due: number;
  candidates: string[];
  /** 후보별 지지한 사람 */
  backers: Record<string, string[]>;
}

export interface KingState {
  /** 용안(龍顔). -100 진노 ~ 100 흡족 */
  mood: number;
  /** 붕당별 왕의 마음 -50 ~ 50 */
  lean: Partial<Record<FactionId, number>>;
  /** 한 당이 조정을 오래 쥐면 쌓이는 견제심 */
  wary: Partial<Record<FactionId, number>>;
}

export type ModScope = 'char' | 'clan' | 'faction';

/** holder(인물/가문/붕당)가 about 인물에 대해 갖는 호감 보정 */
export interface OpinionMod {
  id: string;
  scope: ModScope;
  holder: string;
  about: string;
  label: string;
  value: number;
  decay: number;
}

export type FocusKind = 'duty' | 'study' | 'social' | 'teach' | 'estate' | 'rest' | 'seowon' | 'munjip' | 'memorial';
export type MemorialTopic = 'sipye' | 'jojae' | 'recall';
export type ProjectKind = 'seowon' | 'munjip';

/** 여러 달에 걸친 논핵. 그동안 양쪽이 동조자와 구원자를 모은다. */
export interface Case {
  id: string;
  /** impeach: 관직에 있는 이를 논핵, aggravate: 유배 중인 이에게 죄를 더하자는 논의 */
  kind: 'impeach' | 'aggravate';
  attacker: string;
  target: string;
  opened: number;
  due: number;
  pros: string[];
  cons: string[];
  bonus: number;
  response?: 'explain' | 'endure';
  /** 공격자가 상소로 탄핵했다 (삼사 언관이 아님) */
  byMemorial?: boolean;
}

export interface Scheme {
  kind: 'investigate';
  targetId: string;
  progress: number;
  required: number;
}

export type GoalKind = 'climb' | 'jeonrang' | 'rival' | 'leader' | 'seowon' | 'munjip' | 'family' | 'prestige' | 'jojae';

export interface Goal {
  kind: GoalKind;
  targetId?: string;
  rank?: number;
  since: number;
  base?: number;
}

export interface Focus {
  kind: FocusKind;
  topic?: MemorialTopic;
  targetId?: string;
  progress: number;
  required: number;
  cosigners: string[];
}

export interface PlayerState {
  charId: string;
  focus: Focus | null;
  cooldowns: Record<string, number>;
  exp: { learning: number; politics: number };
  children: number;
  disciples: number;
  deeds: string[];
  peakRank: number;
  peakOffice?: string;
  stats: {
    exiled: number;
    impeachWins: number;
    impeachFails: number;
    memorials: number;
    marriages: number;
    jojae: number;
  };
  doctor: number;
  sick: boolean;
  /** 이번 달에 남은 행동력 */
  ap: number;
  /** 이번 달에 직권 행동을 썼는가 */
  authorityUsed: boolean;
  /** 이번 달에 겸인을 부렸는가 */
  hired: boolean;
  /** 나에게 신세를 진 사람과 그 횟수. 공방과 청탁에서 갚는다. */
  debts: Record<string, number>;
  /** 진행 중인 뒷조사 */
  scheme: Scheme | null;
  /** 탐문 결과 */
  intel: Record<string, { t: number; dirty: boolean }>;
  projects: Partial<Record<ProjectKind, number>>;
  built: ProjectKind[];
  goal: Goal | null;
  goalsDone: string[];
  /** 이 시점까지 연행(燕行) 중이다 */
  abroadUntil: number;
  /** 인물별로 최근 교유한 달들. 같은 사람에게 거듭하면 효과가 준다. */
  contacts: Record<string, number[]>;
  /** 다른 당과 내통한다는 당내 의심 0~100 */
  suspicion: number;
  /** 바람을 알아낸 인물 */
  knownWants: string[];
  bonds: Bond[];
  /** 후원하는 재야의 인재. 식년시에 급제하면 문인으로 출사한다. */
  proteges: string[];
  /** 거느린 식객 수. 매달 재산이 들고 행동력과 소문을 가져온다. */
  retainers: number;
  /** 이번 달 몸을 낮추었다 */
  lowProfile: boolean;
}

export interface FactionState {
  id: FactionId;
  active: boolean;
  division: number;
  leader?: string;
}

export interface RegionState {
  id: RegionId;
  influence: Partial<Record<FactionId, number>>;
  minsim: number;
  tags: string[];
  /** 올해 작황. -2 대흉, -1 흉작, 0 평년, 1 풍작 */
  harvest?: number;
}

export type SituationKind = 'heir' | 'scandal' | 'omen' | 'illness' | 'inlaw';

/** 몇 달 동안 조정의 분위기를 바꾸는 정국 상황 */
export interface Situation {
  id: string;
  kind: SituationKind;
  since: number;
  until: number;
  data: Record<string, any>;
}

export interface Consort {
  id: string;
  name: string;
  title: string;
  born: number;
  alive: boolean;
  /** 왕의 총애 0~100 */
  love: number;
  kin?: string;
}

export interface RoyalState {
  consorts: Consort[];
  /** 왕자별 어머니와 왕의 사랑 */
  princes: Record<string, { mother: string; love: number }>;
  /** 플레이어가 미는 왕자 */
  backing?: string;
  /** 드러내 놓고 미는가, 은밀히 줄을 댔는가 */
  backingPublic?: boolean;
  /** 각 당이 미는 왕자 */
  picks: Partial<Record<FactionId, string>>;
}

export interface PendingEvent {
  id: string;
  def: string;
  ctx: Record<string, any>;
}

export type LogKind = 'history' | 'court' | 'player' | 'death' | 'faction' | 'war';

export interface LogEntry {
  t: number;
  text: string;
  kind: LogKind;
}

export interface GameState {
  version: number;
  rng: number;
  t: number;
  chars: Record<string, Character>;
  marriages: { a: string; b: string; t: number }[];
  mods: OpinionMod[];
  factions: Record<FactionId, FactionState>;
  regions: Record<RegionId, RegionState>;
  player: PlayerState;
  flags: Record<string, number | boolean | string>;
  /** 붕당 간 긴장도 0~100 */
  tension: number;
  war: { active: boolean; preparedness: number; zones: RegionId[] };
  heir?: string;
  pending: PendingEvent[];
  log: LogEntry[];
  /** 천거 효과 만료 시점 */
  recs: Record<string, number>;
  cases: Case[];
  plots: Plot[];
  races: Race[];
  king: KingState;
  /** 붕당의 노선. -100 온건 ~ 100 강경 */
  line: Partial<Record<FactionId, number>>;
  situations: Situation[];
  royal: RoyalState;
  nextId: number;
  over?: { reason: string; t: number };
}
