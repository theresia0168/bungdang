import type { ArmyLevel, Character, GameState, RealmProject, RealmProjectKind, RegionDefense, RegionId, RoyalLevel, TaxLevel } from './types';
import { OFFICE_MAP } from './data/offices';
import { REGION_META } from './data/meta';
import { monthOf, tOf } from './calendar';
import { chance, d6, pick, weighted } from './rng';
import { addFlaw, alive, clamp, fav, isP, josa, log, monthsSince, notice, P, people, pres, uid } from './state';
import { kingMood } from './king';
import { holderOf, vacate } from './court';
import { REGION_ECON, harvestMult, regionYield } from './regions';
import { lawOn } from './laws';
import { opinion, sway } from './opinion';

/* ───────── 국정(國政) ─────────
 * 나라 살림: 가을에 팔도에서 세를 거두어 국고에 넣고, 다달이 녹봉·왕실 경비·군비·사업비를 쓴다.
 * 그 사이에서 관찰사와 수령이 착복하고, 땅 가진 이들은 은결로 세를 피한다.
 * 국방: 도마다 성곽·진보·조련·수군이 있고, 임진년의 전황이 이것으로 갈린다.
 */

export const TAX_SCALE = 5.6;
export const COASTAL: RegionId[] = ['gyeongsang', 'jeolla', 'chungcheong', 'gyeonggi', 'hwanghae'];
export const TAX_REGIONS = (Object.keys(REGION_ECON) as RegionId[]).filter((r) => REGION_ECON[r].yield > 0);

export const initDefense = (r: RegionId): RegionDefense => ({
  fort: r === 'hamgyeong' || r === 'pyeongan' ? 2 : r === 'hanseong' ? 2 : 1,
  jin: r === 'hamgyeong' ? 2 : r === 'gyeongsang' || r === 'jeolla' || r === 'pyeongan' ? 1 : r === 'hanseong' ? 0 : 1,
  drill: r === 'hamgyeong' ? 35 : 20,
  navy: r === 'gyeongsang' || r === 'jeolla' ? 1 : 0,
});

export function initRealm(): GameState['realm'] {
  return { treasury: 300, ledger: null, spent: [], royal: 1, projects: [], broke: 0, budget: { tax: 'normal', army: 'keep', royal: 'normal' }, authority: 60 };
}

/* ───────── 예산의 결 ───────── */

export const TAX_RATE: Record<TaxLevel, number> = { low: 0.85, normal: 1, high: 1.15 };
export const ARMY_RATE: Record<ArmyLevel, number> = { cut: 0.7, keep: 1, expand: 1.3 };
export const ROYAL_RATE: Record<RoyalLevel, number> = { cut: 0.75, normal: 1, lavish: 1.3 };
export const TAX_NAME: Record<TaxLevel, string> = { low: '경감', normal: '정액', high: '가렴' };
export const ARMY_NAME: Record<ArmyLevel, string> = { cut: '감군', keep: '유지', expand: '확충' };
export const ROYAL_NAME: Record<RoyalLevel, string> = { cut: '절감', normal: '관례', lavish: '넉넉히' };
export const BUDGET_DESC = {
  tax: '전세(田稅)를 얼마나 거둘지. 경감하면 세입 -15%에 민심이 오르고, 가렴하면 세입 +15%에 민심이 깎이며 은결이 는다.',
  army: '군비를 얼마나 댈지. 성곽·진보·수군의 유지비에 견주어 감군 70% · 유지 100% · 확충 130%를 댄다. 모자라면 조련이 풀리고 시설이 허물어지며, 넉넉하면 조련이 오른다.',
  royal: '내수사와 궁방의 씀씀이. 절감하면 용안이 어두워지고 왕실 권위가 깎이며, 넉넉하면 그 반대다.',
};

/* ───────── 세입 ───────── */

export function taxMult(s: GameState): number {
  let m = 1;
  if (lawOn(s, 'sumi')) m += 0.08;
  if (lawOn(s, 'daedong')) m += 0.12;
  if (lawOn(s, 'hopae')) m += 0.05;
  if (lawOn(s, 'nobi')) m += 0.05;
  if (lawOn(s, 'sachang')) m -= 0.03;
  return m;
}

/** 이 도에서 장부대로라면 거둘 세 */
export function regionTax(s: GameState, r: RegionId): number {
  const hide = s.regions[r].hidden * (lawOn(s, 'daedong') ? 0.5 : 1);
  return Math.round(regionYield(s, r) * TAX_SCALE * taxMult(s) * TAX_RATE[s.realm.budget.tax] * s.regions[r].arable * (1 - hide));
}

/** 관찰사가 빼돌리는 비율 */
function gamsaSkimRate(c: Character | undefined): number {
  if (!c) return 0.04;
  if (c.traits.includes('clean') || c.traits.includes('upright')) return 0;
  if (c.traits.includes('greedy')) return 0.14;
  return 0.05;
}

export function suryeongSkimRate(s: GameState, r: RegionId): number {
  let v = 0.06;
  if (lawOn(s, 'bumin')) v += 0.04;
  if ((s.regions[r].inspectUntil ?? 0) > s.t) v -= 0.05;
  return Math.max(0.01, v);
}

/** 가을걷이 뒤 10월: 팔도의 세가 국고로 올라온다 */
export function collectTaxes(s: GameState) {
  const realm = s.realm;
  const p = P(s);
  const byRegion: NonNullable<GameState['realm']['ledger']>['byRegion'] = {};
  let total = 0;
  for (const r of TAX_REGIONS) {
    const due = regionTax(s, r);
    const g = holderOf(s, `gamsa_${r}`);
    let gamsa: number;
    if (g && isP(s, g)) {
      const choice = s.flags.tributeChoice;
      gamsa = choice === 'exploit' ? Math.round(due * 0.25) : choice === 'normal' ? Math.round(due * 0.08) : 0;
    } else gamsa = Math.round(due * gamsaSkimRate(g));
    const suryeong = Math.round(due * suryeongSkimRate(s, r));
    const got = Math.max(0, due - gamsa - suryeong);
    byRegion[r] = { due, got, gamsa, suryeong };
    total += got;
    // 탐욕스러운 관찰사의 착복은 흔적을 남긴다
    if (g && !isP(s, g) && gamsa > 0 && g.traits.includes('greedy') && chance(s, 0.25) && !g.flaws.some((f) => f.label === '공납 착복')) addFlaw(s, g, '공납 착복');
  }
  delete s.flags.tributeChoice;
  // 가을에 6할이 들고, 나머지는 봄에 조운선이 싣고 올라온다
  const now = Math.round(total * 0.6);
  realm.treasury = Math.round(realm.treasury + now);
  s.flags.taxLater = total - now;
  realm.ledger = { t: s.t, revenue: total, byRegion };
  const lost = Object.values(byRegion).reduce((a, x) => a + (x?.gamsa ?? 0) + (x?.suryeong ?? 0), 0);
  log(s, `[국고] 올해 팔도의 세는 ${total}이다. 6할이 먼저 국고에 들고 나머지는 봄에 조운선으로 올라온다. 중간에 새어 나간 것이 ${lost}쯤 된다는 말이 있다. (국고 ${realm.treasury})`, 'court');
  if (p.status === 'active' && p.office === 'hojo')
    notice(s, '세입과 예산', `올해 세입은 ${total}이다. 지방관들의 손을 타고 ${lost}이 새어 나갔다. 국고는 ${realm.treasury}.\n\n「국정」 탭에서 다음 한 해의 예산(전세·군비·왕실 경비)을 짤 수 있다. 한 달에 한 항목씩, 직권으로 고친다.`, 'court');
  else npcBudget(s);
}

/** NPC 호조판서가 성향과 형편을 따라 예산을 짠다 */
export function npcBudget(s: GameState) {
  const b = s.realm.budget;
  const hj = holderOf(s, 'hojo');
  const t = s.realm.treasury;
  const need = monthlySpend(s) * 12;
  // 조정은 왜란을 경고받기 전까지 태평하다
  const threat = !!s.flags.warned || s.war.active;
  b.tax = t < 0 ? 'high' : t > need ? 'low' : 'normal';
  b.army = t < -100 ? 'cut' : threat && t > need * 0.6 && !s.war.active ? 'expand' : 'keep';
  b.royal = t < 0 ? 'cut' : 'normal';
  if (hj?.traits.includes('greedy')) {
    b.tax = 'high';
    if (t > 0) b.royal = 'lavish';
  }
  if (hj?.traits.includes('clean') && b.tax === 'high' && t > -100) b.tax = 'normal';
  log(s, `[국고] 호조가 올해 예산을 짰다. 전세 ${TAX_NAME[b.tax]} · 군비 ${ARMY_NAME[b.army]} · 왕실 경비 ${ROYAL_NAME[b.royal]}.`, 'court');
}

/** 호조판서가 예산 한 항목을 고친다 (직권) */
export function setBudget(s: GameState, key: 'tax' | 'army' | 'royal', v: string): string {
  const p = P(s);
  if (p.status !== 'active' || p.office !== 'hojo') return '호조판서만 예산을 짤 수 있다';
  if (s.player.authorityUsed) return '이번 달 직권을 이미 썼다';
  const b = s.realm.budget;
  if (b[key] === v) return '이미 그렇게 짜여 있다';
  s.player.authorityUsed = true;
  (b as unknown as Record<string, string>)[key] = v;
  const fx: string[] = [];
  if (key === 'royal' && v === 'cut') {
    kingMood(s, -8);
    fav(p, -3);
    pres(p, 2);
    fx.push('용안이 어두워짐, 성심 -3, 명망 +2');
  } else if (key === 'royal' && v === 'lavish') {
    kingMood(s, 6);
    fav(p, 2);
    fx.push('용안이 밝아짐, 성심 +2');
  } else if (key === 'tax' && v === 'high') {
    fav(p, 1);
    fx.push('성심 +1');
  } else if (key === 'tax' && v === 'low') {
    pres(p, 2);
    fx.push('명망 +2');
  }
  const name = key === 'tax' ? `전세를 ${TAX_NAME[v as TaxLevel]}` : key === 'army' ? `군비를 ${ARMY_NAME[v as ArmyLevel]}` : `왕실 경비를 ${ROYAL_NAME[v as RoyalLevel]}`;
  log(s, `[국고] 호조판서 ${josa(p.name, '이/가')} ${name}으로 정했다.`, 'player');
  return `${name}으로 정했다.${fx.length ? ` (${fx.join(', ')})` : ''}`;
}

/* ───────── 세출 ───────── */

/** 성곽·진보·수군을 지키는 데 다달이 드는 돈. 예산이 이만큼 대 주어야 허물어지지 않는다. */
export function militaryNeed(s: GameState): number {
  let v = 2;
  for (const r of Object.values(s.regions)) v += r.defense.fort * 0.2 + r.defense.jin * 0.6 + r.defense.navy * 0.6;
  if (lawOn(s, 'jeseung')) v -= 2;
  if (lawOn(s, 'jingwan')) v += 3;
  if (lawOn(s, 'yangbyeong')) v += 6;
  if (lawOn(s, 'hullyeon')) v += 5;
  if (s.war.active) v += 8;
  return Math.max(0, Math.round(v * 10) / 10);
}

/** 예산에 따라 실제로 나가는 군비 */
export const militaryUpkeep = (s: GameState) => Math.round(militaryNeed(s) * ARMY_RATE[s.realm.budget.army] * 10) / 10;

/** 군비가 유지비를 얼마나 대 주는가. 국고가 바닥나면 반만 간다. */
export const armyFunding = (s: GameState) => ARMY_RATE[s.realm.budget.army] * (s.realm.treasury < 0 ? 0.5 : 1);

export function monthlyBudget(s: GameState): { label: string; value: number }[] {
  const out = [
    { label: '녹봉', value: s.realm.treasury < 0 ? 8 : 16 },
    { label: '왕실 경비', value: Math.round(10 * ROYAL_RATE[s.realm.budget.royal] * 10) / 10 },
    { label: '군비', value: militaryUpkeep(s) },
  ];
  const proj = s.realm.projects.reduce((a, x) => a + x.cost * (x.skim ? 1.3 : 1), 0);
  if (proj) out.push({ label: '나라 사업', value: Math.round(proj * 10) / 10 });
  return out;
}

export const monthlySpend = (s: GameState) => monthlyBudget(s).reduce((a, x) => a + x.value, 0);

/* ───────── 국방 ───────── */

export function defenseScore(s: GameState, r: RegionId): number {
  const d = s.regions[r].defense;
  const jin = lawOn(s, 'jingwan') ? 11 : 8;
  return Math.round(d.fort * 10 + d.jin * jin + d.drill * 0.35 + (COASTAL.includes(r) ? d.navy * 5 : 0));
}

/** 왜란이 닥쳤을 때 남쪽이 버틸 힘 */
export function warReadiness(s: GameState): { score: number; parts: { label: string; value: number }[] } {
  const south: RegionId[] = ['gyeongsang', 'chungcheong', 'gyeonggi', 'hanseong'];
  const avg = south.reduce((a, r) => a + defenseScore(s, r), 0) / south.length;
  const parts = [
    { label: '비변사의 대비', value: Math.round(s.war.preparedness * 0.5) },
    { label: '남쪽 고을의 방비', value: Math.round(avg * 0.5) },
  ];
  if (lawOn(s, 'jeseung')) parts.push({ label: '제승방략', value: -8 });
  if (lawOn(s, 'jingwan')) parts.push({ label: '진관 체제', value: 6 });
  if (lawOn(s, 'yangbyeong')) parts.push({ label: '양병', value: 10 });
  if (lawOn(s, 'hullyeon')) parts.push({ label: '훈련도감', value: 6 });
  if (lawOn(s, 'sogo')) parts.push({ label: '속오군', value: 5 });
  if (s.realm.treasury < 0) parts.push({ label: '바닥난 국고', value: -6 });
  return { score: parts.reduce((a, x) => a + x.value, 0), parts };
}

/* 임진년의 전황은 주사위 둘(2d6)에 대비 점수의 보정을 더해 정한다.
 * 11 이상이면 남쪽에서 막아내고, 3 이하면 남쪽이 무너진다. 그 사이는 역사대로. */
export const WAR_HELD_ROLL = 11;
export const WAR_ROUT_ROLL = 3;
export const warMod = (score: number) => Math.round((score - 35) / 8);

/** 대비 점수가 이만할 때 각 전황이 나올 확률 */
export function warOdds(score: number): { held: number; history: number; rout: number } {
  const m = warMod(score);
  let held = 0;
  let rout = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) {
      const r = a + b + m;
      if (r >= WAR_HELD_ROLL) held++;
      else if (r <= WAR_ROUT_ROLL) rout++;
    }
  return { held: held / 36, rout: rout / 36, history: (36 - held - rout) / 36 };
}

export const warForecast = (score: number) => {
  const o = warOdds(score);
  const pc = (v: number) => `${Math.round(v * 100)}%`;
  return `왜란이 나면 — 남쪽에서 막아냄 ${pc(o.held)} · 도성 함락(역사대로) ${pc(o.history)} · 남쪽 붕괴 ${pc(o.rout)}`;
};

/* ───────── 나라 사업 ───────── */

export interface ProjectDef {
  name: string;
  months: number;
  cost: number;
  /** 도를 고르는 사업인가 */
  regional: boolean;
  desc: string;
  /** 이 도에서 할 수 있는가 */
  ok?(s: GameState, r?: RegionId): string | null;
  done(s: GameState, x: RealmProject): string;
}

const def = (s: GameState, r?: RegionId) => (r ? s.regions[r].defense : undefined);

export const PROJECT_DEFS: Record<RealmProjectKind, ProjectDef> = {
  fort: {
    name: '성곽 수축',
    months: 6,
    cost: 8,
    regional: true,
    desc: '성을 높이 쌓고 해자를 판다. 그 도의 성곽 +1 (최대 5).',
    ok: (s, r) => ((def(s, r)?.fort ?? 5) >= 5 ? '성곽이 이미 튼튼하다' : null),
    done(s, x) {
      const d = s.regions[x.region!].defense;
      d.fort = Math.min(5, d.fort + 1);
      s.regions[x.region!].minsim = clamp(s.regions[x.region!].minsim - 2, 0, 100);
      return `성곽 ${d.fort}`;
    },
  },
  jin: {
    name: '진보 설치',
    months: 5,
    cost: 7,
    regional: true,
    desc: '요해처에 진보(鎭堡)를 새로 두고 군관을 보낸다. 진보 +1 (최대 3). 군비가 다달이 더 든다.',
    ok: (s, r) => ((def(s, r)?.jin ?? 3) >= 3 ? '진보가 이미 넉넉하다' : null),
    done(s, x) {
      const d = s.regions[x.region!].defense;
      d.jin = Math.min(3, d.jin + 1);
      return `진보 ${d.jin}`;
    },
  },
  drill: {
    name: '군사 조련',
    months: 3,
    cost: 5,
    regional: true,
    desc: '군적을 정비하고 장정을 모아 조련한다. 조련 +25.',
    ok: (s, r) => ((def(s, r)?.drill ?? 100) >= 95 ? '이미 잘 조련되어 있다' : null),
    done(s, x) {
      const d = s.regions[x.region!].defense;
      d.drill = Math.min(100, d.drill + 25);
      return `조련 ${Math.round(d.drill)}`;
    },
  },
  navy: {
    name: '판옥선 건조',
    months: 6,
    cost: 9,
    regional: true,
    desc: '바닷가 도의 수영(水營)에 판옥선을 짓는다. 수군 +1 (최대 3).',
    ok: (s, r) => (!r || !COASTAL.includes(r) ? '바닷가 도에서만 할 수 있다' : (def(s, r)?.navy ?? 3) >= 3 ? '수군이 이미 강하다' : null),
    done(s, x) {
      const d = s.regions[x.region!].defense;
      d.navy = Math.min(3, d.navy + 1);
      return `수군 ${d.navy}`;
    },
  },
  dyke: {
    name: '제언(堤堰) 수축',
    months: 5,
    cost: 6,
    regional: true,
    desc: '저수지와 보를 쌓는다. 그 도의 흉년이 덜 들고 경작지 +5%, 민심 +5.',
    ok: (s, r) => (r && s.regions[r].tags.includes('dyke') ? '이미 제언을 쌓았다' : r === 'hanseong' ? '도성에는 쌓을 곳이 없다' : null),
    done(s, x) {
      const reg = s.regions[x.region!];
      if (!reg.tags.includes('dyke')) reg.tags.push('dyke');
      reg.minsim = clamp(reg.minsim + 5, 0, 100);
      reg.arable = Math.min(1.5, reg.arable + 0.05);
      return '흉년이 덜 들고 경작지 +5%';
    },
  },
  survey: {
    name: '양전(量田)',
    months: 6,
    cost: 5,
    regional: true,
    desc: '토지를 다시 재어 장부에서 빠진 은결을 찾아낸다. 그 도의 세가 늘지만 땅 가진 권세가들이 반발한다. 늘어날 세로 비용을 갚으므로 국고가 바닥나도 벌일 수 있다.',
    ok: (s, r) => (r === 'hanseong' ? '도성에는 잴 땅이 없다' : r && s.regions[r].hidden < 0.04 ? '빠진 땅이 거의 없다' : null),
    done(s, x) {
      const r = x.region!;
      const was = s.regions[r].hidden;
      s.regions[r].hidden = 0;
      // 숨어 있던 땅의 절반쯤은 새로 일군 땅까지 함께 장부에 오른다
      s.regions[r].arable = Math.min(1.5, s.regions[r].arable + was * 0.5);
      s.regions[r].minsim = clamp(s.regions[r].minsim - 3, 0, 100);
      for (const c of people(s)) if (c.traits.includes('greedy') && c.rank <= 3 && x.by && s.chars[x.by]) sway(s, c, x.by, -6, '양전으로 땅을 들춤', { decay: 0.1 });
      const p = P(s);
      if (p.home === r && s.player.hiddenLand > 0) {
        const n = s.player.hiddenLand;
        s.player.hiddenLand = 0;
        if (!p.flaws.some((f) => f.label === '은결 은닉' && f.public)) addFlaw(s, p, '은결 은닉', true);
        pres(p, -3);
        notice(s, '양전', `${REGION_META[r].short}의 양전에서 당신 집안의 은결 ${n}결이 드러났다. (흠결 공개, 명망 -3)`, 'danger');
      }
      return `은결 ${Math.round(was * 100)}%를 찾아냄`;
    },
  },
  palace: {
    name: '궁궐 중수',
    months: 8,
    cost: 12,
    regional: false,
    desc: '전각을 고치고 새로 짓는다. 왕이 크게 기뻐하지만 경기 백성이 부역에 시달린다.',
    done(s) {
      kingMood(s, 20);
      s.regions.gyeonggi.minsim = clamp(s.regions.gyeonggi.minsim - 5, 0, 100);
      return '용안이 크게 밝아짐';
    },
  },
  relief: {
    name: '진휼',
    months: 1,
    cost: 25,
    regional: true,
    desc: '나라 창고를 열어 굶주린 도를 구한다. 민심 +12.',
    done(s, x) {
      const reg = s.regions[x.region!];
      reg.minsim = clamp(reg.minsim + 12, 0, 100);
      return '민심 +12';
    },
  },
};

export const MILITARY: RealmProjectKind[] = ['fort', 'jin', 'drill', 'navy'];

/** 플레이어가 이 사업을 건의할 수 있는 자리인가 */
export function projectAuthority(s: GameState, kind: RealmProjectKind, r?: RegionId): string | null {
  const p = P(s);
  if (p.status !== 'active' || !p.office) return '관직에 있어야 한다';
  const o = OFFICE_MAP[p.office];
  if (p.office.startsWith('gamsa_')) {
    if (kind === 'palace') return '관찰사가 건의할 일이 아니다';
    return r && r !== p.location ? '관찰사는 자기 도의 일만 건의할 수 있다' : null;
  }
  if (!o) return '판서·정승·관찰사만 나라 사업을 건의할 수 있다';
  if (o.rank === 1) return null;
  if (p.office === 'byeongjo') return MILITARY.includes(kind) ? null : '병조판서는 군사에 관한 사업만 건의한다';
  if (p.office === 'hojo') return kind === 'survey' || kind === 'relief' || kind === 'dyke' ? null : '호조판서는 양전·진휼·제언을 건의한다';
  if (p.office === 'gongjo') return kind === 'fort' || kind === 'dyke' || kind === 'palace' ? null : '공조판서는 성곽·제언·궁궐 공역을 건의한다';
  if (p.office === 'panyun') return r === 'hanseong' && (kind === 'fort' || kind === 'drill' || kind === 'relief') ? null : '한성판윤은 도성의 일만 건의한다';
  return '판서·정승·관찰사만 나라 사업을 건의할 수 있다 (자리마다 다룰 수 있는 일이 다르다)';
}

export function projectError(s: GameState, kind: RealmProjectKind, r?: RegionId): string | null {
  const d = PROJECT_DEFS[kind];
  if (d.regional && !r) return '도를 골라야 한다';
  const a = projectAuthority(s, kind, r);
  if (a) return a;
  if (s.player.authorityUsed) return '이번 달 직권을 이미 썼다';
  const e = d.ok?.(s, r);
  if (e) return e;
  if (s.realm.projects.some((x) => x.kind === kind && x.region === r)) return '같은 사업이 이미 진행 중이다';
  if (s.realm.projects.length >= 5) return '이미 벌인 사업이 너무 많다';
  return null;
}

/** 왕이 재가할 확률 */
export function approvalChance(s: GameState, kind: RealmProjectKind): number {
  const p = P(s);
  const d = PROJECT_DEFS[kind];
  const total = d.cost * d.months;
  const t = s.realm.treasury;
  let v = 0.55 + p.favor / 200 + s.king.mood / 300;
  if (kind === 'survey') v += t < 0 ? 0.15 : 0;
  else if (t < total) v -= 0.35;
  else if (t < total * 2) v -= 0.1;
  else if (t > 500) v += 0.1;
  if (kind === 'palace') v += 0.25;
  if (MILITARY.includes(kind)) v += s.t >= tOf(1590, 1) ? 0.1 : -0.1;
  if (kind === 'survey') v -= 0.05;
  if (s.war.active && MILITARY.includes(kind)) v += 0.25;
  return clamp(v, 0.05, 0.95);
}

/** 사업을 건의한다. skim이면 공사비 일부를 빼돌린다 */
export function proposeProject(s: GameState, kind: RealmProjectKind, r: RegionId | undefined, skim = false): string {
  const err = projectError(s, kind, r);
  if (err) return err;
  const p = P(s);
  if (skim && (p.traits.includes('clean') || p.traits.includes('upright'))) return '청렴한 성품이 허락하지 않는다';
  s.player.authorityUsed = true;
  const d = PROJECT_DEFS[kind];
  const where = r ? `${REGION_META[r].short} ` : '';
  const ch = approvalChance(s, kind);
  if (!chance(s, ch)) {
    fav(p, -1);
    return `${where}${d.name}을 아뢰었으나 왕이 윤허하지 않았다. (재가 확률 ${Math.round(ch * 100)}%, 성심 -1)`;
  }
  s.realm.projects.push({ id: uid(s, 'pj'), kind, region: r, by: p.id, left: d.months, cost: d.cost, started: s.t, skim });
  fav(p, 1);
  pres(p, 1);
  log(s, `[국정] ${josa(p.name, '이/가')} 아뢴 ${where}${d.name}을 왕이 윤허했다.`, 'player');
  return `${where}${josa(d.name, '이/가')} 윤허되었다. ${d.months}개월 동안 다달이 국고 ${d.cost}이 든다.${skim ? ' 공사비의 일부가 당신의 집으로 흘러들 것이다.' : ''} (성심 +1, 명망 +1)`;
}

/** 매달: 사업을 진행하고 돈을 쓴다 */
export function tickRealm(s: GameState) {
  const realm = s.realm;
  const p = P(s);
  const spend = monthlyBudget(s);
  realm.spent = spend;
  const broke = realm.treasury < 0;
  const surveyCost = realm.projects.filter((x) => x.kind === 'survey').reduce((a, x) => a + x.cost, 0);
  const total = spend.reduce((a, x) => a + (broke && x.label === '나라 사업' ? surveyCost : x.value), 0);
  realm.treasury = Math.round((realm.treasury - total) * 10) / 10;

  {
    for (const x of [...realm.projects]) {
      // 국고가 바닥나면 양전 말고는 멈춘다
      if (broke && x.kind !== 'survey') continue;
      x.left--;
      const mgr = s.chars[x.by];
      if (x.skim && mgr) {
        if (isP(s, mgr) && alive(mgr)) {
          mgr.wealth += Math.round(x.cost * 0.3 * 10) / 10;
          if (chance(s, 0.06) && !mgr.flaws.some((f) => f.label === '공사비 착복')) addFlaw(s, mgr, '공사비 착복');
        }
      }
      if (x.left > 0) continue;
      realm.projects = realm.projects.filter((y) => y !== x);
      const d = PROJECT_DEFS[x.kind];
      // 착복이 심하면 공사가 부실하다
      if (x.skim && chance(s, 0.35)) {
        log(s, `[국정] ${x.region ? REGION_META[x.region].short + ' ' : ''}${d.name}이 끝났으나 부실 공사라는 말이 돈다.`, 'court');
        if (mgr && isP(s, mgr)) notice(s, '부실 공사', `${d.name}이 끝났지만 빼돌린 공사비 탓에 제대로 되지 않았다. 효과가 없다.`, 'danger');
        continue;
      }
      const what = d.done(s, x);
      log(s, `[국정] ${x.region ? REGION_META[x.region].short + ' ' : ''}${d.name}이 끝났다. (${what})`, mgr && isP(s, mgr) ? 'player' : 'court');
      if (mgr && isP(s, mgr)) {
        pres(mgr, 2);
        fav(mgr, 2);
        notice(s, '사업 완공', `당신이 맡은 ${x.region ? REGION_META[x.region].short + ' ' : ''}${d.name}이 끝났다. (${what}, 명망 +2, 성심 +2)`, 'court');
      }
    }
  }

  // 군비가 모자라면 조련이 풀리고 시설이 허물어진다. 넉넉하면 조련이 오른다.
  const fund = armyFunding(s);
  const lost: string[] = [];
  for (const r of Object.values(s.regions)) {
    const d = r.defense;
    let drift = fund >= 1.2 ? 0.5 : fund >= 1 ? -0.2 : -(0.5 + (1 - fund) * 4);
    if (fund < 1 && chance(s, (1 - fund) * 0.025)) {
      const opts = (['fort', 'jin', 'navy'] as const).filter((k) => d[k] > 0 && (k !== 'fort' || d.fort > 1 || r.id !== 'hanseong'));
      const k = opts.length ? pick(s, opts) : undefined;
      if (k) {
        d[k]--;
        lost.push(`${REGION_META[r.id].short} ${k === 'fort' ? '성곽' : k === 'jin' ? '진보' : '판옥선'}`);
      }
    }
    if (lawOn(s, 'hopae')) drift += 0.3;
    if (lawOn(s, 'yangbyeong')) drift += 0.8;
    if (lawOn(s, 'nobi')) drift += 0.2;
    if (lawOn(s, 'sogo')) drift += 0.6;
    if (lawOn(s, 'hullyeon') && (r.id === 'gyeonggi' || r.id === 'hanseong')) drift += 1.5;
    d.drill = clamp(d.drill + drift, 0, 100);
  }
  if (lost.length) {
    log(s, `[국방] 군량과 군포가 끊겨 ${lost.join(', ')}이 허물어지고 군사가 흩어졌다.`, 'court');
    const bj = holderOf(s, 'byeongjo');
    if (bj && isP(s, bj)) notice(s, '허물어지는 방비', `군비가 모자라 ${lost.join(', ')}이 허물어졌다. 호조에 군비를 늘려 달라고 해야 한다.`, 'danger');
  }
  // 예산의 결이 민심과 용안에 미친다
  const b = realm.budget;
  if (b.tax !== 'normal') for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim + (b.tax === 'low' ? 0.15 : -0.2), 0, 100);
  if (b.royal === 'cut') kingMood(s, -0.4);
  else if (b.royal === 'lavish') kingMood(s, 0.3);
  // 법이 민심에 미치는 결
  let mood = 0;
  if (lawOn(s, 'bumin')) mood -= 0.08;
  if (lawOn(s, 'sumi')) mood += 0.1;
  if (lawOn(s, 'daedong')) mood += 0.2;
  if (lawOn(s, 'hopae')) mood -= 0.08;
  if (lawOn(s, 'hyangyak')) mood += 0.08;
  if (lawOn(s, 'sogo')) mood -= 0.06;
  if (mood) for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim + mood, 0, 100);

  // 국고가 바닥나면
  if (realm.treasury < 0) {
    realm.broke++;
    kingMood(s, -1.5);
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 0.3, 0, 100);
    const hj = holderOf(s, 'hojo');
    if (hj) fav(hj, -1);
    if (realm.broke === 1) {
      log(s, '[국고] 호조의 창고가 바닥났다. 녹봉이 깎이고 나라 사업이 멈추었다.', 'court');
      if (hj && isP(s, hj)) notice(s, '바닥난 국고', '국고가 바닥났다. 호조판서인 당신에게 비난이 쏠린다. 세를 독촉하거나 왕실 경비를 줄여야 한다.', 'danger');
      else if (alive(p) && p.status === 'active') notice(s, '바닥난 국고', '나라 창고가 바닥나 녹봉이 반으로 깎였다. 나라 사업도 멈추었다.', 'danger');
    }
    if (realm.broke >= 6 && hj && !isP(s, hj) && chance(s, 0.2)) {
      vacate(s, hj);
      log(s, `[국고] 나라 살림을 그르친 책임을 물어 호조판서 ${josa(hj.name, '을/를')} 갈았다.`, 'court');
    }
    // NPC 호조판서는 급하면 공명첩을 판다
    // 세곡이 곧 올라올 철(1·2월, 8·9월)에는 기다린다
    const soon = [1, 2, 8, 9].includes(monthOf(s.t));
    if (hj && !isP(s, hj) && realm.treasury < -150 && !soon && monthsSince(s, 'gongmyeongAt') >= 6) sellTitles(s);
    // 오래 바닥나 있으면 NPC 호조가 군비와 왕실 경비부터 줄인다
    if (hj && !isP(s, hj) && realm.broke % 6 === 0) {
      if (realm.budget.royal !== 'cut') realm.budget.royal = 'cut';
      else if (realm.budget.army !== 'cut') realm.budget.army = 'cut';
      realm.budget.tax = 'high';
    }
  } else realm.broke = 0;

  if (monthOf(s.t) === 1) yearlyLand(s);
  if (monthOf(s.t) === 3 && typeof s.flags.taxLater === 'number') {
    realm.treasury = Math.round(realm.treasury + s.flags.taxLater);
    log(s, `[국고] 조운선이 남은 세곡 ${s.flags.taxLater}을 싣고 올라왔다. (국고 ${realm.treasury})`, 'court');
    delete s.flags.taxLater;
  }
  npcProjects(s);
}

/** 정월: 경작지가 늘고 줄며, 은결이 그 원인을 따라 늘고 준다 */
export function yearlyLand(s: GameState) {
  for (const r of TAX_REGIONS) {
    const reg = s.regions[r];
    const war = s.war.active && s.war.zones.includes(r);
    // 개간: 민심이 좋고 난리가 없으면 진전(陳田)이 다시 일구어진다
    if (war) reg.arable = Math.max(0.6, reg.arable - 0.04);
    else if (reg.minsim >= 45) reg.arable = Math.min(1.5, reg.arable + 0.004 + (reg.minsim - 45) / 5000);
    // 은결: 고을에 뿌리박은 탐욕스러운 권세가, 수령 고소를 막는 법, 가렴주구가 키우고 감찰이 줄인다
    const greedy = people(s).filter((c) => c.home === r && c.traits.includes('greedy') && c.rank <= 4).length;
    let dh = 0.002 + Math.min(3, greedy) * 0.005;
    if (lawOn(s, 'bumin')) dh += 0.003;
    if (s.realm.budget.tax === 'high') dh += 0.005;
    if ((reg.inspectUntil ?? 0) > s.t - 12) dh -= 0.01;
    reg.hidden = clamp(reg.hidden + dh, 0, 0.3);
  }
}

/** 공명첩을 팔고 납속을 받는다 */
export function sellTitles(s: GameState): number {
  s.flags.gongmyeongAt = s.t;
  s.realm.treasury += 120;
  // 전란 중의 납속은 나라를 구하는 일로 여겨 체통이 덜 깎인다
  s.realm.authority = clamp(s.realm.authority - (s.war.active ? 1 : 3), 0, 100);
  for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 0.5, 0, 100);
  log(s, '[국고] 바닥난 국고를 메우려 공명첩(空名帖)을 팔고 납속(納粟)을 받았다. 벼슬을 돈으로 산다는 말에 조정의 체통이 깎였다.', 'court');
  return 120;
}

/** 조정의 대신들도 사업을 아뢴다 */
function npcProjects(s: GameState) {
  const realm = s.realm;
  if (realm.treasury < 120 || realm.projects.length >= 4 || !chance(s, 0.07)) return;
  const threat = s.t >= tOf(1590, 1) || s.war.active;
  const opts: [[RealmProjectKind, string, RegionId | undefined], number][] = [];
  const by = (id: string) => holderOf(s, id);
  const bj = by('byeongjo');
  if (bj && !isP(s, bj)) {
    for (const r of ['gyeongsang', 'jeolla', 'hamgyeong', 'pyeongan', 'chungcheong'] as RegionId[]) {
      const w = threat ? 1.5 : 0.4;
      for (const k of MILITARY) if (!PROJECT_DEFS[k].ok?.(s, r)) opts.push([[k, bj.id, r], w * (k === 'drill' ? 1.5 : 1)]);
    }
  }
  for (const r of TAX_REGIONS) {
    const g = by(`gamsa_${r}`);
    if (!g || isP(s, g)) continue;
    if (s.regions[r].minsim < 40) opts.push([['relief', g.id, r], 1.5]);
    if (!PROJECT_DEFS.dyke.ok?.(s, r)) opts.push([['dyke', g.id, r], 0.3]);
  }
  const hj = by('hojo');
  if (hj && !isP(s, hj)) for (const r of TAX_REGIONS) if (s.regions[r].hidden > 0.12) opts.push([['survey', hj.id, r], 0.6]);
  const top = by('yeonguijeong') ?? by('jwauijeong');
  if (top && !isP(s, top) && s.king.mood > 20 && realm.treasury > 350 && !realm.projects.some((x) => x.kind === 'palace')) opts.push([['palace', top.id, undefined], 0.4]);
  const pickd = weighted(s, opts.filter(([[k, , r]]) => !realm.projects.some((x) => x.kind === k && x.region === r)));
  if (!pickd) return;
  const [kind, id, r] = pickd;
  const d = PROJECT_DEFS[kind];
  const mgr = s.chars[id];
  const skim = mgr.traits.includes('greedy') && chance(s, 0.6);
  realm.projects.push({ id: uid(s, 'pj'), kind, region: r, by: id, left: d.months + (skim ? 2 : 0), cost: d.cost, started: s.t, skim });
  if (skim && !mgr.flaws.some((f) => f.label === '공사비 착복')) addFlaw(s, mgr, '공사비 착복');
  log(s, `[국정] ${josa(mgr.name, '이/가')} 아뢴 ${r ? REGION_META[r].short + ' ' : ''}${josa(d.name, '이/가')} 윤허되었다.`, 'court');
}

/* ───────── 직무의 권한 ───────── */

export type PowerId = 'hojo_press' | 'hojo_titles' | 'hojo_hwangok' | 'byeongjo_review' | 'gamsa_inspect' | 'gamsa_drill' | 'gongjo_hurry';

export interface OfficePower {
  id: PowerId;
  name: string;
  desc: string;
  office(o: string): boolean;
  check?(s: GameState): string | null;
  run(s: GameState): string;
}

export const POWERS: OfficePower[] = [
  {
    id: 'hojo_press',
    name: '세곡 독촉',
    desc: '밀린 세곡과 공물을 다그쳐 거둔다. 국고 +40, 팔도 민심 -2. 흉년이면 원성이 더 크다.',
    office: (o) => o === 'hojo',
    check: (s) => (s.flags.pressAt && s.t - Number(s.flags.pressAt) < 6 ? '반년에 한 번만 독촉할 수 있다' : null),
    run(s) {
      s.flags.pressAt = s.t;
      s.realm.treasury += 40;
      const bad = TAX_REGIONS.filter((r) => harvestMult(s, r) < 1).length;
      for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 2 - (bad >= 3 ? 1 : 0), 0, 100);
      fav(P(s), 1);
      return '호조 서리들을 풀어 밀린 세곡을 다그쳤다. (국고 +40, 팔도 민심 -2, 성심 +1)';
    },
  },
  {
    id: 'hojo_titles',
    name: '공명첩 발매',
    desc: '이름만 있는 벼슬 첩지를 팔고 곡식을 바치게 한다. 국고 +120. 왕실 권위 -3 (전란 중에는 -1), 명망 -2, 팔도 민심 조금 하락. 반년에 한 번.',
    office: (o) => o === 'hojo',
    check: (s) => (monthsSince(s, 'gongmyeongAt') < 6 ? '반년에 한 번만 팔 수 있다' : null),
    run(s) {
      sellTitles(s);
      pres(P(s), -2);
      return '공명첩을 팔아 국고를 메웠다. (국고 +120, 왕실 권위 -3, 명망 -2)';
    },
  },
  {
    id: 'hojo_hwangok',
    name: '환곡 전용',
    desc: '고을마다 흉년에 대비해 쌓아 둔 환곡을 끌어다 쓴다. 국고 +80. 비축한 환곡이 사라지고 팔도 민심 -2. 1년에 한 번.',
    office: (o) => o === 'hojo',
    check: (s) => (monthsSince(s, 'hwangokAt') < 12 ? '1년에 한 번만 끌어다 쓸 수 있다' : null),
    run(s) {
      s.flags.hwangokAt = s.t;
      s.realm.treasury += 80;
      for (const r of Object.values(s.regions)) {
        r.tags = r.tags.filter((x) => x !== 'reserve');
        r.minsim = clamp(r.minsim - 2, 0, 100);
      }
      return '고을의 환곡을 끌어다 국고를 메웠다. 다음 흉년이 걱정이다. (국고 +80, 팔도 민심 -2)';
    },
  },
  {
    id: 'byeongjo_review',
    name: '군적 점고',
    desc: '팔도의 군적을 점검한다. 모든 도의 조련 +6, 국방 대비 +2. 권세가 자제의 빠진 이름이 드러나 고관들이 언짢아한다.',
    office: (o) => o === 'byeongjo',
    run(s) {
      const p = P(s);
      for (const r of Object.values(s.regions)) r.defense.drill = clamp(r.defense.drill + 6, 0, 100);
      s.war.preparedness = clamp(s.war.preparedness + 2, 0, 100);
      for (const c of people(s)) if (!isP(s, c) && c.rank <= 2 && c.traits.includes('greedy') && opinion(s, c, p) < 30) sway(s, c, p.id, -3, '군적 점고', { decay: 0.2 });
      return '팔도 군적을 점고했다. (조련 +6, 국방 대비 +2)';
    },
  },
  {
    id: 'gamsa_inspect',
    name: '수령 감찰',
    desc: '도내 수령들의 장부를 뒤진다. 1년 동안 이 도 수령의 착복이 크게 준다. 탐학한 수령이 걸리면 파직시킨다.',
    office: (o) => o.startsWith('gamsa_'),
    run(s) {
      const p = P(s);
      const r = s.regions[p.location];
      r.inspectUntil = s.t + 12;
      const bad = people(s).filter((c) => c.office === 'suryeong' && c.location === p.location && !isP(s, c) && (c.traits.includes('greedy') || c.flaws.length > 0));
      const w = bad.length ? pick(s, bad) : undefined;
      if (w) {
        vacate(s, w);
        addFlaw(s, w, '탐학', true);
        sway(s, w, p.id, -20, '감찰로 파직', { clan: 0.3, decay: 0.1 });
        r.minsim = clamp(r.minsim + 3, 0, 100);
        pres(p, 2);
        return `수령들의 장부를 뒤져 ${josa(w.name, '을/를')} 파직시켰다. 1년 동안 이 도의 착복이 준다. (민심 +3, 명망 +2)`;
      }
      return '수령들의 장부를 뒤졌다. 크게 걸린 자는 없었지만 1년 동안 이 도의 착복이 준다.';
    },
  },
  {
    id: 'gamsa_drill',
    name: '도내 군사 조련',
    desc: '감영의 재량으로 병영과 진보의 군사를 조련한다. 이 도의 조련 +10, 민심 -1.',
    office: (o) => o.startsWith('gamsa_'),
    run(s) {
      const p = P(s);
      const r = s.regions[p.location];
      r.defense.drill = clamp(r.defense.drill + 10, 0, 100);
      r.minsim = clamp(r.minsim - 1, 0, 100);
      return `${REGION_META[p.location].short}의 군사를 조련했다. (조련 ${Math.round(r.defense.drill)})`;
    },
  },
  {
    id: 'gongjo_hurry',
    name: '공역 독려',
    desc: '진행 중인 나라 사업 하나를 한 달 앞당긴다.',
    office: (o) => o === 'gongjo',
    check: (s) => (s.realm.projects.some((x) => x.left > 1) ? null : '앞당길 사업이 없다'),
    run(s) {
      const x = s.realm.projects.filter((y) => y.left > 1).sort((a, b) => b.left - a.left)[0];
      x.left--;
      return `${PROJECT_DEFS[x.kind].name}의 공역을 독려했다. (남은 ${x.left}개월)`;
    },
  },
];

export function powerError(s: GameState, w: OfficePower): string | null {
  const p = P(s);
  if (p.status !== 'active' || !p.office || !w.office(p.office)) return '그 자리에 있어야 한다';
  if (s.player.authorityUsed) return '이번 달 직권을 이미 썼다';
  return w.check?.(s) ?? null;
}

export function usePower(s: GameState, id: PowerId): string {
  const w = POWERS.find((x) => x.id === id)!;
  const err = powerError(s, w);
  if (err) return err;
  s.player.authorityUsed = true;
  return w.run(s);
}

/* ───────── 임진년의 전황 ───────── */

/** 1592년 4월, 왜군이 상륙할 때 대비 점수로 전황을 정한다 */
export function decideWarPath(s: GameState): { path: 'held' | 'history' | 'rout'; text: string } {
  const { score } = warReadiness(s);
  const a = d6(s);
  const b = d6(s);
  const m = warMod(score);
  const r = a + b + m;
  const path = r >= WAR_HELD_ROLL ? 'held' : r <= WAR_ROUT_ROLL ? 'rout' : 'history';
  s.realm.warPath = path;
  return { path, text: `전쟁 대비 ${score}: 주사위 ${a}+${b} ${m >= 0 ? '+' : ''}${m} = ${r}` };
}

/** 몽진 속도와 왜군의 진군 속도를 겨룬다. 왜군이 빠르면 어가가 사로잡힌다. */
export function raceForKing(s: GameState): { caught: boolean; text: string } {
  const north: RegionId[] = ['hanseong', 'gyeonggi', 'hwanghae'];
  const nd = north.reduce((a, r) => a + defenseScore(s, r), 0) / north.length;
  const ja = d6(s);
  const jMod = (s.realm.warPath === 'rout' ? 3 : 1) - Math.round(nd / 20);
  const ka = d6(s);
  const kMod = 3 + (s.flags.escorted ? 1 : 0) + (s.realm.treasury < 0 ? -1 : 0);
  const jp = ja + jMod;
  const kg = ka + kMod;
  return { caught: jp > kg, text: `왜군의 진군 ${ja}${jMod >= 0 ? '+' : ''}${jMod}=${jp} · 몽진 ${ka}+${kMod}=${kg}` };
}

/** 전란 중 매달: 전장의 방비가 버티는지 */
export function tickWarFront(s: GameState) {
  if (!s.war.active) return;
  for (const r of s.war.zones) {
    const reg = s.regions[r];
    const sc = defenseScore(s, r);
    reg.defense.drill = clamp(reg.defense.drill - 1.5, 0, 100);
    if (sc < 25) reg.minsim = clamp(reg.minsim - 1, 0, 100);
    if (sc >= 55 && chance(s, 0.06)) {
      s.war.preparedness = clamp(s.war.preparedness + 2, 0, 100);
      log(s, `[전황] ${REGION_META[r].short}의 성과 진보가 왜군의 공세를 막아냈다.`, 'war');
    } else if (sc < 20 && chance(s, 0.05) && reg.defense.fort > 0) {
      reg.defense.fort--;
      log(s, `[전황] ${REGION_META[r].short}의 성 하나가 왜군에게 떨어졌다.`, 'war');
    }
  }
}
