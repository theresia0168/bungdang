export type FactionId = 'dong' | 'seo' | 'nam' | 'buk' | 'noron' | 'soron' | 'none';

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
  | 'seoeol'
  | 'eloquent'
  | 'martial'
  | 'cautious'
  | 'loyal'
  | 'timid'
  | 'arrogant'
  | 'sickly';

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
  /** 조정 쟁점으로 이미 다루어진 달. 같은 허물로 거듭 논하지 않는다. */
  aired?: number;
  /** 탄핵의 근거로 쓰인 달. 3년 안에는 같은 일로 다시 탄핵하지 못한다. */
  usedAt?: number;
  /** 이 허물로 이미 벌을 받았다. 다시 탄핵거리가 되지 않는다. */
  settled?: boolean;
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
  /** 2품 이상(판서급) 자리에 있은 달 수: 정승 임용에서 대신의 경력으로 친다 */
  seniority?: number;
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
  /** 유배를 떠난 달 */
  exiledAt?: number;
  exilePlace?: string;
  /** 유배의 무게. 1 중도부처, 2 위리안치 */
  exileLevel?: number;
  /** 삭탈관작: 이 시점까지 서용되지 않는다 */
  banUntil?: number;
  /** 지낸 관직별로 물러난 달. 같은 자리에 곧바로 다시 앉지 않는다. */
  leftOffices?: Record<string, number>;
  teacher?: string;
  /** 살면서 당적을 바꾼 횟수 */
  switched?: number;
  /** 과거를 거치지 않고 선친의 음덕으로 벼슬길에 나섰다 */
  eumseo?: boolean;
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

/** 수치가 아닌 관계. 청해서 맺거나, 오래 가까이 지내면 저절로 맺어진다. */
export interface Bond {
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
  /** 경쟁이 시작될 때 자리에 있던 사람. 그가 물러나야 할 때만 물린다. */
  holder?: string;
  /** 이조가 의망하여 왕이 낙점한 후보 */
  nominee?: string;
}

export interface KingState {
  /** 왕대마다 정해진 당별 마음의 바탕. 왕의 마음은 이리로 돌아온다 */
  base?: Partial<Record<FactionId, number>>;
  /** 용안(龍顔). -100 진노 ~ 100 흡족 */
  mood: number;
  /** 붕당별 왕의 마음 -50 ~ 50. 한 당이 조정을 오래 쥐면 식고, 깊이 식으면 환국이 난다. */
  lean: Partial<Record<FactionId, number>>;
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
export type MemorialTopic = 'sipye' | 'jojae' | 'recall' | 'law';
export type ProjectKind = 'seowon' | 'munjip';

/** 여러 달에 걸친 논핵. 그동안 양쪽이 동조자와 구원자를 모은다. */
export interface Case {
  id: string;
  /** impeach: 관직에 있는 이를 논핵, aggravate: 유배 중인 이에게 죄를 더하자는 논의 */
  kind: 'impeach' | 'aggravate';
  /** 대상이 스스로 물러났다 (논핵은 이어지되 판정에 참작) */
  resigned?: boolean;
  /** 처음부터 관직이 없던 이를 논핵했다 */
  offOffice?: boolean;
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
  /** 당의 영수가 이미 당론을 모았다 */
  rallied?: boolean;
  /** 표적이 맞탄핵을 했는지 따졌다 */
  countered?: boolean;
  /** 이 논핵 자체가 맞탄핵이다 */
  counter?: boolean;
  /** 성균관 유생들이 이미 끼어들었다 */
  yusaeng?: boolean;
  /** 플레이어가 통문을 돌렸다 */
  tongmun?: boolean;
  /** 플레이어가 고른 죄목(흠결 id). 없으면 아는 흠결을 모두 쓴다 */
  charges?: string[];
  /** 대간이 풍문으로 논했다 */
  pungmun?: boolean;
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
  /** 변법 상소: 다룰 법 */
  lawId?: string;
  /** 변법 상소: 폐지를 청하는가 */
  abolish?: boolean;
  /** 상소에 담은 조목 (sangso.ts) */
  articles?: string[];
  progress: number;
  required: number;
  cosigners: string[];
}

export interface PlayerState {
  charId: string;
  /** 알아서 처리하는 일: 이벤트 종류 → 고를 선택지 */
  auto?: Record<string, string>;
  /** 알아서 처리할 때 고르는 선택지의 이름 (화면 표시용) */
  autoLabel?: Record<string, string>;
  /** 이 대가 걷는 가문의 길: 벼슬길·산림·가세 */
  path?: 'office' | 'sallim' | 'wealth';
  /** 숙적: 플레이어를 노리는 다른 당의 인물 */
  rival?: string;
  /** 이 판에서 이룬 업적 */
  achv?: string[];
  /** 수령으로 있는 고을의 원성 */
  county?: { region: RegionId; harm: number; good: number; since: number };
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
  /** 이번 달 교유의 행동력 +1을 이미 받았다 */
  socialBonus: boolean;
  /** 내가 이끈 논핵을 연 달들. 잦으면 왕과 조정이 싫증을 낸다. */
  impeachAt: number[];
  /** 탄핵 계사에 담을 죄목 (흠결 id). 탄핵을 시작할 때 쓰고 비운다 */
  draftCharges?: string[] | null;
  /** 개인 사건별로 마지막에 일어난 달 */
  eventAt: Record<string, number>;
  /** 앞서 간 선대들. 가문을 이어 하면 쌓인다. */
  lineage: Ancestor[];
  /** 첫 해 길잡이에서 해낸 단계 */
  guide: string[];
  /** 이번 달에 이미 한 월간 행동 */
  done: string[];
  /** 강학의 진척 (6이 되면 문인 +1) */
  teach: number;
  /** 가진 전장(田莊). 가을마다 소작료가 들어온다 */
  land: number;
  /** 장부에서 뺀 은결(隱結). 세를 내지 않아 소출이 더 들어오지만 들키면 흠결이 된다 */
  hiddenLand: number;
  /** 빌려준 장리(長利) */
  loans: { amount: number; due: number }[];
  /** 살면서 당적을 바꾼 횟수 */
  factionChanges: number;
  /** 과거 준비 (학문 수양·강학을 할 때마다 쌓인다) */
  examPrep?: number;
}

export interface RegionDefense {
  /** 성곽 0~5 */
  fort: number;
  /** 진보(鎭堡) 0~3 */
  jin: number;
  /** 군사 조련 0~100 */
  drill: number;
  /** 수군 판옥선 0~3 (바닷가 도) */
  navy: number;
}

export type RealmProjectKind = 'fort' | 'jin' | 'drill' | 'navy' | 'dyke' | 'survey' | 'palace' | 'relief';

/** 나라에서 벌이는 사업. 국고에서 다달이 비용이 나간다. */
export interface RealmProject {
  id: string;
  kind: RealmProjectKind;
  region?: RegionId;
  /** 맡은 사람 */
  by: string;
  left: number;
  cost: number;
  started: number;
  /** 맡은 이가 공사비를 빼돌린다 */
  skim?: boolean;
}

export interface Ledger {
  t: number;
  revenue: number;
  byRegion: Partial<Record<RegionId, { due: number; got: number; gamsa: number; suryeong: number }>>;
}

export interface RealmState {
  /** 국고 */
  treasury: number;
  /** 지난해 세입 */
  ledger: Ledger | null;
  /** 지난달 지출 내역 */
  spent: { label: string; value: number }[];
  /** 왕실 경비 수준 0.6~1.4 */
  royal: number;
  projects: RealmProject[];
  /** 국고가 바닥난 지 몇 달 */
  broke: number;
  /** 임진년의 전황: 막아냄 / 역사대로 / 무너짐 */
  warPath?: 'held' | 'history' | 'rout';
  /** 호조가 짠 한 해 예산 */
  budget: Budget;
  /** 꾸며지고 있는 반정 */
  coup?: { faction: FactionId; leader: string; due: number; joined?: boolean; reported?: boolean };
}

export type TaxLevel = 'low' | 'normal' | 'high';
export type ArmyLevel = 'cut' | 'keep' | 'expand';
export type RoyalLevel = 'cut' | 'normal' | 'lavish';

export interface Budget {
  /** 전세: 경감 / 정액 / 가렴 */
  tax: TaxLevel;
  /** 군비: 감군 / 유지 / 확충 */
  army: ArmyLevel;
  /** 왕실 경비: 절감 / 관례 / 넉넉히 */
  royal: RoyalLevel;
}

export interface LawState {
  on: boolean;
  since: number;
}

export interface Ancestor {
  id: string;
  name: string;
  died: number;
  cause: string;
  score: number;
  peakOffice?: string;
}

export interface FactionState {
  id: FactionId;
  active: boolean;
  division: number;
  leader?: string;
  /** 이때까지 영수가 바뀌지 않는다 (후계 다툼에서 이긴 이) */
  lockUntil?: number;
  /** 영수 후계 다툼 */
  contest?: { cands: string[]; due: number; backers: Record<string, string[]> };
}

/** 역모 고변으로 열린 국청 */
export interface Oksa {
  accused: string;
  faction: FactionId;
  due: number;
  /** 고변한 이 (괘서를 붙인 이) */
  by?: string;
  /** 꾸며 낸 고변인가 */
  fabricated?: boolean;
  /** 위관 */
  judge?: string;
  /** 옥사를 넓힐 것인가 */
  harsh?: boolean;
  /** 위관이 진위를 캐어 수상한 점을 찾았다 */
  cleared?: boolean;
  /** 옥사의 기세 1~3: 몇 단계까지, 몇 명까지 번지는가 */
  sev?: number;
  /** 국문을 기다리는 이들 (누가 불어서 끌려왔는가) */
  queue?: { id: string; depth: number; by?: string }[];
  /** 국문을 받은 이들의 결과 */
  done?: Record<string, string>;
  /** 국문이 몇 달째인가 */
  month?: number;
  /** 구명 상소가 올라온 이들 */
  pleaded?: string[];
}

export interface RegionState {
  id: RegionId;
  influence: Partial<Record<FactionId, number>>;
  minsim: number;
  tags: string[];
  /** 올해 작황. -2 대흉, -1 흉작, 0 평년, 1 풍작 */
  harvest?: number;
  defense: RegionDefense;
  /** 경작지의 넓이 (처음 1). 개간과 제언으로 늘고 전란으로 준다 */
  arable: number;
  /** 장부에서 빠진 땅의 비율 0~0.3 */
  hidden: number;
  /** 감찰로 수령의 착복이 줄어드는 시점 */
  inspectUntil?: number;
}

export type SituationKind = 'heir' | 'scandal' | 'omen' | 'illness' | 'inlaw' | 'gukbon';

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
  realm: RealmState;
  laws: Record<string, LawState>;
  oksa?: Oksa;
  /** 겸직: 자리 id → 맡은 이와 맡은 때 */
  kyeom?: Record<string, { who: string; since: number }>;
  nextId: number;
  over?: { reason: string; t: number };
}
