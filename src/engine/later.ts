import type { Character, FactionId, GameState, RegionId, TraitId } from './types';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { tOf, yearOf } from './calendar';
import { chance, d6, pick } from './rng';
import { addFlaw, alive, clamp, fav, inCourt, isP, josa, log, notice, P, people, pres, pushEvent } from './state';
import { topOf } from './opinion';
import { activeFactions, members, splitDong, updateLeaders } from './factions';
import { hwanguk, kingLean, kingMood } from './king';
import { vacate } from './court';
import { exile, kill } from './conflict';
import { genChar, liveFaction } from './generate';
import { defenseScore } from './realm';
import { setLaw } from './laws';
import { raiseAgenda } from './agenda';
import { startOksa } from './strife';
import { daeriPayback, heirKey, sejePayback, startGukbon } from './gukbon';
import { bibyeonJump, wonsuBonus } from './kwanje';

/* ═══════════════════ 1601~1821: 조선 후기의 붕당 정치 ═══════════════════
 * 왕이 바뀔 때마다 성향이 달라진다. 북인이 몰락하고 서인이 노론·소론으로 갈라지며,
 * 호란과 예송, 환국과 탕평, 세도로 이어진다.
 */

interface Scheduled {
  id: string;
  at: [number, number];
  window?: number;
  cond?: (s: GameState) => boolean;
  run: (s: GameState) => void;
}


/* ───────── 왕의 교체 ───────── */

type KingStyle = 'plain' | 'volatile' | 'tangpyeong' | 'sedo' | 'neutral';

const REIGN: Record<string, { born: number; style: KingStyle; lean: Partial<Record<string, number>>; text: string }> = {
  광해군: { born: 1575, style: 'neutral', lean: { buk: 25, seo: -15, nam: -5 }, text: '광해군이 즉위했다. 대북이 조정을 쥐고, 명과 후금 사이에서 줄타기를 한다.' },
  인조: { born: 1595, style: 'plain', lean: { seo: 25, nam: 5 }, text: '반정으로 능양군이 즉위했다(인조). 서인이 조정을 쥐고 남인 일부를 함께 쓴다.' },
  효종: { born: 1619, style: 'plain', lean: { seo: 15 }, text: '봉림대군이 즉위했다(효종). 청에 볼모로 있던 한을 품고 북벌을 꿈꾼다.' },
  현종: { born: 1641, style: 'neutral', lean: { seo: 5, nam: 5 }, text: '현종이 즉위했다. 효종의 상례를 두고 예송이 일어날 조짐이다.' },
  숙종: { born: 1661, style: 'volatile', lean: { nam: 10 }, text: '숙종이 열넷의 나이로 즉위했다. 왕권을 쥐려 판을 자주 뒤집는 임금이다.' },
  경종: { born: 1688, style: 'plain', lean: { soron: 20, noron: -10 }, text: '경종이 즉위했다. 병약한 왕을 두고 노론과 소론이 세제(世弟) 문제로 맞선다.' },
  영조: { born: 1694, style: 'tangpyeong', lean: { noron: 10 }, text: '연잉군이 즉위했다(영조). 붕당의 폐해를 누르려 탕평을 내세운다.' },
  정조: { born: 1752, style: 'tangpyeong', lean: { nam: 10, noron: -5 }, text: '정조가 즉위했다. "나는 사도세자의 아들이다." 탕평과 규장각으로 왕권을 세운다.' },
  순조: { born: 1790, style: 'sedo', lean: { noron: 30 }, text: '순조가 열하나의 나이로 즉위했다. 정순왕후의 수렴청정 뒤로 외척 안동 김씨가 권세를 잡는다.' },
};

export const kingId = (s: GameState) => (typeof s.flags.kingId === 'string' ? (s.flags.kingId as string) : 'seonjo');
export const kingStyle = (s: GameState) => (typeof s.flags.kingStyle === 'string' ? (s.flags.kingStyle as KingStyle) : 'plain');

function makeRoyal(s: GameState, name: string, born: number): Character {
  const c = genChar(s, { rank: 0, age: yearOf(s.t) - born, status: 'royal', faction: 'none', name, clan: '전주 이씨' });
  c.status = 'royal';
  c.rank = 0;
  c.office = undefined;
  c.destiny = 9999;
  c.bio = '조선의 국왕.';
  return c;
}

function crown(s: GameState, name: string) {
  const old = s.chars[kingId(s)];
  if (old && old.status !== 'dead') {
    old.status = 'dead';
    old.death = { t: s.t, cause: '승하했다' };
  }
  const r = REIGN[name];
  let k: Character | undefined;
  if (name === '광해군' && alive(s.chars.gwanghae)) k = s.chars.gwanghae;
  if (!k) k = makeRoyal(s, name, r.born);
  k.status = 'royal';
  s.flags.kingId = k.id;
  s.flags.kingStyle = r.style;
  s.heir = undefined;
  s.situations = s.situations.filter((x) => x.kind !== 'heir' && x.kind !== 'illness' && x.kind !== 'gukbon');
  s.flags.reignFrom = s.t;
  // 선왕의 밀지를 받들던 「왕의 사람」은 새 임금 아래에서 그 끈을 잃는다
  for (const c of Object.values(s.chars)) if (c.tags.includes('kingsman')) c.tags = c.tags.filter((t) => t !== 'kingsman');
  s.king.mood = 15;
  s.king.lean = {};
  s.king.base = {};
  for (const [f, v] of Object.entries(r.lean)) {
    const lf = s.factions[f as FactionId]?.active ? (f as FactionId) : null;
    const set = (x: FactionId) => {
      s.king.lean[x] = v ?? 0;
      s.king.base![x] = Math.round((v ?? 0) * 0.6);
    };
    if (lf) set(lf);
    else if (f === 'seo') for (const x of ['noron', 'soron'] as FactionId[]) if (s.factions[x].active) set(x);
  }
  log(s, `[국왕] ${r.text}`, 'history');
  const p = P(s);
  if (alive(p) && inCourt(p)) notice(s, '새 임금', `${r.text}\n\n왕이 바뀌면 성심은 절반만 남는다. 새 임금의 눈에 들어야 한다.`, 'history');
  for (const c of people(s)) c.favor = Math.round(c.favor * 0.5);
}

/* ───────── 실존 인물의 등장 ───────── */

interface Figure {
  key: string;
  name: string;
  clan: string;
  year: number;
  age: number;
  faction: FactionId;
  rank: number;
  traits: TraitId[];
  pol: number;
  learn: number;
}

const FIGURES: Figure[] = [
  { key: 'yi_icheom', name: '이이첨', clan: '광주 이씨', year: 1608, age: 48, faction: 'buk', rank: 2, traits: ['schemer', 'radical'], pol: 7, learn: 5 },
  { key: 'jeong_inhong', name: '정인홍', clan: '서산 정씨', year: 1608, age: 72, faction: 'buk', rank: 2, traits: ['upright', 'radical'], pol: 5, learn: 7 },
  { key: 'kim_ryu', name: '김류', clan: '순천 김씨', year: 1620, age: 49, faction: 'seo', rank: 3, traits: ['ambitious'], pol: 6, learn: 5 },
  { key: 'choe_myeonggil', name: '최명길', clan: '전주 최씨', year: 1620, age: 34, faction: 'seo', rank: 4, traits: ['mediator'], pol: 7, learn: 6 },
  { key: 'kim_sangheon', name: '김상헌', clan: '안동 김씨', year: 1620, age: 50, faction: 'seo', rank: 3, traits: ['upright', 'radical'], pol: 6, learn: 7 },
  { key: 'song_siyeol', name: '송시열', clan: '은진 송씨', year: 1649, age: 42, faction: 'seo', rank: 3, traits: ['scholar', 'radical'], pol: 7, learn: 8 },
  { key: 'yun_hyu', name: '윤휴', clan: '남원 윤씨', year: 1659, age: 42, faction: 'nam', rank: 3, traits: ['scholar', 'radical'], pol: 6, learn: 8 },
  { key: 'heo_jeok', name: '허적', clan: '양천 허씨', year: 1670, age: 60, faction: 'nam', rank: 2, traits: ['mediator'], pol: 7, learn: 5 },
  { key: 'kim_seokju', name: '김석주', clan: '청풍 김씨', year: 1674, age: 40, faction: 'seo', rank: 2, traits: ['schemer', 'inlaw'], pol: 7, learn: 5 },
  { key: 'yun_jeung', name: '윤증', clan: '파평 윤씨', year: 1680, age: 51, faction: 'seo', rank: 3, traits: ['scholar', 'recluse'], pol: 4, learn: 8 },
  { key: 'nam_guman', name: '남구만', clan: '의령 남씨', year: 1680, age: 51, faction: 'seo', rank: 2, traits: ['mediator'], pol: 7, learn: 6 },
  { key: 'kim_changjip', name: '김창집', clan: '안동 김씨', year: 1715, age: 67, faction: 'noron', rank: 1, traits: ['radical'], pol: 6, learn: 5 },
  { key: 'jo_taegu', name: '조태구', clan: '양주 조씨', year: 1715, age: 55, faction: 'soron', rank: 2, traits: ['ambitious'], pol: 6, learn: 5 },
  { key: 'bak_munsu', name: '박문수', clan: '고령 박씨', year: 1724, age: 33, faction: 'soron', rank: 4, traits: ['upright', 'clean'], pol: 6, learn: 6 },
  { key: 'chae_jegong', name: '채제공', clan: '평강 채씨', year: 1760, age: 40, faction: 'nam', rank: 3, traits: ['mediator'], pol: 7, learn: 6 },
  { key: 'hong_gugyeong', name: '홍국영', clan: '풍산 홍씨', year: 1776, age: 28, faction: 'noron', rank: 3, traits: ['schemer', 'ambitious'], pol: 7, learn: 5 },
  { key: 'jeong_yakyong', name: '정약용', clan: '나주 정씨', year: 1789, age: 27, faction: 'nam', rank: 6, traits: ['scholar', 'writer'], pol: 5, learn: 8 },
  { key: 'kim_josun', name: '김조순', clan: '안동 김씨', year: 1800, age: 35, faction: 'noron', rank: 2, traits: ['inlaw', 'mild'], pol: 7, learn: 6 },
];

export const figure = (s: GameState, key: string): Character | undefined => {
  const id = s.flags[`fig_${key}`];
  const c = typeof id === 'string' ? s.chars[id] : undefined;
  return alive(c) ? c : undefined;
};

function spawnFigures(s: GameState) {
  const y = yearOf(s.t);
  for (const f of FIGURES) {
    if (f.year !== y || s.flags[`fig_${f.key}`]) continue;
    const c = genChar(s, { rank: f.rank, age: f.age, status: 'idle', faction: liveFaction(s, f.faction), name: f.name, clan: f.clan });
    c.traits = f.traits;
    c.politics = f.pol;
    c.learning = f.learn;
    c.prestige = 30 + f.learn * 3;
    c.historical = true;
    c.destiny = Math.max(c.destiny, y + 12);
    c.promotedAt = s.t - 40;
    s.flags[`fig_${f.key}`] = c.id;
  }
}

/* ───────── 붕당의 변천 ───────── */

/** 인조반정: 대북이 무너진다 */
function purgeBuk(s: GameState) {
  if (!s.factions.buk.active) return;
  const p = P(s);
  const bukMembers = members(s, 'buk');
  const top = bukMembers.filter((c) => c.status === 'active' && c.office && OFFICE_MAP[c.office] && c.rank <= 2).sort((a, b) => b.politics - a.politics);
  const killed: string[] = [];
  for (const c of top.slice(0, 3)) {
    if (isP(s, c)) continue;
    kill(s, c, '반정으로 죽임을 당했다');
    killed.push(c.name);
  }
  for (const c of bukMembers) {
    if (!alive(c) || isP(s, c)) continue;
    if (c.status === 'active' && c.office && OFFICE_MAP[c.office]) {
      if (chance(s, 0.5)) exile(s, c);
      else vacate(s, c, 'retired');
    }
    c.faction = chance(s, 0.5) ? 'nam' : 'none';
  }
  for (const r of Object.values(s.regions)) {
    const b = r.influence.buk ?? 0;
    r.influence.nam = (r.influence.nam ?? 0) + b * 0.4;
    delete r.influence.buk;
  }
  for (const r of Object.values(s.regions)) r.influence.seo = Math.round((r.influence.seo ?? 0) * 1.3);
  s.factions.buk.active = false;
  s.factions.buk.leader = undefined;
  s.tension = clamp(s.tension + 15, 0, 100);
  log(s, `[반정] 서인이 군사를 일으켜 광해군을 몰아냈다. 대북이 무너졌다.${killed.length ? ` ${killed.join('·')} 등이 죽었다.` : ''}`, 'history');
  if (p.faction === 'buk') pushEvent(s, 'later_banjeong', {});
  updateLeaders(s);
}

/** 서인이 노론과 소론으로 갈라선다 */
function splitSeo(s: GameState) {
  if (!s.factions.seo.active) return;
  const p = P(s);
  const songsiyeol = figure(s, 'song_siyeol');
  for (const c of Object.values(s.chars)) {
    if (c.faction !== 'seo' || isP(s, c)) continue;
    const elder = yearOf(s.t) - c.born >= 45;
    c.faction = chance(s, elder ? 0.7 : 0.35) ? 'noron' : 'soron';
  }
  if (songsiyeol) songsiyeol.faction = 'noron';
  const yj = figure(s, 'yun_jeung');
  if (yj) yj.faction = 'soron';
  const ngm = figure(s, 'nam_guman');
  if (ngm) ngm.faction = 'soron';
  const extra = [];
  for (const m of s.mods) {
    if (m.scope === 'faction' && m.holder === 'seo') {
      m.holder = 'noron';
      s.nextId += 1;
      extra.push({ ...m, id: `m${s.nextId}`, holder: 'soron' });
    }
  }
  s.mods.push(...extra);
  for (const r of Object.values(s.regions)) {
    const v = r.influence.seo ?? 0;
    r.influence.noron = Math.round(v * 0.6);
    r.influence.soron = v - (r.influence.noron ?? 0);
    delete r.influence.seo;
  }
  const lean = s.king.lean.seo ?? 0;
  s.king.lean.noron = lean;
  s.king.lean.soron = lean;
  delete s.king.lean.seo;
  s.line.noron = (s.line.seo ?? 0) + 10;
  s.line.soron = (s.line.seo ?? 0) - 10;
  s.factions.seo.active = false;
  s.factions.noron.active = true;
  s.factions.soron.active = true;
  log(s, '[붕당] 남인 처벌을 두고 서인이 갈라섰다. 송시열을 따르는 노론과 윤증을 따르는 소론이다.', 'faction');
  updateLeaders(s);
  if (p.faction === 'seo') pushEvent(s, 'later_seo_split', {});
}

/** 같은 뿌리의 당들을 한꺼번에 환국으로 친다 (서인이 갈라졌으면 노론·소론 모두) */
function hwangukTop(s: GameState, top: 'seo' | 'dong' | FactionId) {
  // 서인·동인 같은 뿌리를 부르면 갈라진 당들을 모두, 노론·소론처럼 콕 집으면 그 당만 친다
  const broad = top === 'seo' || top === 'dong';
  for (const f of activeFactions(s)) {
    if (broad ? topOf(f) !== topOf(top as FactionId) : f !== top) continue;
    hwanguk(s, f, true);
    // 쫓겨난 당은 지방의 세력도 꺾인다. 왕의 마음의 바탕도 식는다.
    for (const r of Object.values(s.regions)) if (r.influence[f]) r.influence[f] = Math.round((r.influence[f] ?? 0) * 0.7);
    s.king.base = { ...(s.king.base ?? {}), [f]: (s.king.base?.[f] ?? 0) - 10 };
  }
}

/* ───────── 호란(胡亂) ───────── */

const NORTH: RegionId[] = ['pyeongan', 'hwanghae', 'gyeonggi', 'hanseong'];

function horan(s: GameState, which: 'jeongmyo' | 'byeongja') {
  const avg = NORTH.reduce((a, r) => a + defenseScore(s, r), 0) / NORTH.length;
  const a = d6(s);
  const b = d6(s);
  const m = Math.round((avg - 35) / 8);
  const roll = a + b + m;
  const held = roll >= 11;
  const rout = roll <= 3;
  const dice = `북방 방비 ${Math.round(avg)}: 주사위 ${a}+${b} ${m >= 0 ? '+' : ''}${m} = ${roll}`;
  s.war.active = true;
  s.war.zones = held ? ['pyeongan'] : which === 'jeongmyo' ? ['pyeongan', 'hwanghae'] : [...NORTH];
  s.flags.horanEnd = s.t + (which === 'jeongmyo' ? 2 : 3);
  const p = P(s);
  if (which === 'jeongmyo') {
    if (held) log(s, `[정묘호란] 후금의 군사가 압록강을 건넜으나 의주와 안주의 성이 버텨 물러갔다. (${dice})`, 'war');
    else {
      log(s, `[정묘호란] 후금의 군사가 평양까지 밀고 내려왔다. 왕이 강화도로 피란하고, 형제의 맹약을 맺었다. (${dice})`, 'war');
      s.realm.treasury -= 80;
      kingMood(s, -15);
    }
  } else {
    if (held) {
      log(s, `[병자호란] 청 태종이 대군을 이끌고 왔으나 북방의 성들이 길목을 막아 한성에 이르지 못했다. 군신의 예를 피하고 화친을 맺었다. (${dice})`, 'war');
      kingMood(s, -5);
    } else {
      log(s, `[병자호란] 청군이 엿새 만에 한성에 닥쳤다. 왕이 남한산성으로 들어가 47일을 버티다 삼전도에서 청 태종에게 세 번 절하고 아홉 번 머리를 조아렸다. 소현세자와 봉림대군이 볼모로 끌려갔다. (${dice})`, 'war');
      s.realm.treasury -= rout ? 250 : 150;
      kingMood(s, rout ? -45 : -35);
      for (const r of NORTH) s.regions[r].minsim = clamp(s.regions[r].minsim - (rout ? 25 : 15), 0, 100);
      if (alive(p) && inCourt(p)) raiseAgenda(s, 'jeokhwa', {});
    }
  }
  if (alive(p) && inCourt(p)) notice(s, which === 'jeongmyo' ? '정묘호란' : '병자호란', `${held ? '북방의 성들이 버텼다.' : '도성이 위태롭다.'} (${dice})\n\n평안·황해·경기·도성의 성곽과 진보, 조련이 다음 호란의 향방을 가른다.`, 'war');
}

/* ───────── 민란 ───────── */

function rebellion(s: GameState, regions: RegionId[], name: string, months: number) {
  const avg = regions.reduce((a, r) => a + defenseScore(s, r), 0) / regions.length;
  const quick = d6(s) + Math.round((avg - 30) / 10) >= 5;
  s.war.active = true;
  s.war.zones = regions;
  s.flags.horanEnd = s.t + (quick ? 1 : months);
  for (const r of regions) s.regions[r].minsim = clamp(s.regions[r].minsim - 15, 0, 100);
  log(s, `[민란] ${name}이 일어났다.${quick ? ' 관군이 곧바로 진압에 나섰다.' : ' 관군이 쉽게 누르지 못한다.'}`, 'war');
}

function tickLaterWar(s: GameState) {
  const b = wonsuBonus(s);
  if (b && typeof s.flags.horanEnd === 'number' && (s.flags.horanEnd as number) > s.t + 1 && chance(s, 0.3)) s.flags.horanEnd = (s.flags.horanEnd as number) - b;
  const end = s.flags.horanEnd;
  if (typeof end === 'number' && s.t >= end && s.t > tOf(1600, 1)) {
    s.war.active = false;
    s.war.zones = [];
    delete s.flags.horanEnd;
    log(s, '전란이 가라앉았다.', 'war');
  }
}

/* ───────── 연표 ───────── */

const at = (y: number, m: number) => [y, m] as [number, number];
const L = (text: string, fx?: (s: GameState) => void) => (s: GameState) => {
  log(s, text, 'history');
  fx?.(s);
};

export const LATER_SCHEDULE: Scheduled[] = [
  // 남북 분당이 끝나지 않았으면 마저 갈라선다
  { id: 'l_split_force', at: at(1601, 1), cond: (s) => s.factions.dong.active, run: (s) => splitDong(s) },
  { id: 'l_dongui', at: at(1610, 8), run: L('허준이 『동의보감』을 완성했다.') },
  { id: 'l_seonjo', at: at(1608, 2), run: (s) => crown(s, '광해군') },
  { id: 'l_daedong_gg', at: at(1608, 5), run: L('이원익의 건의로 경기도에 선혜법(대동법)을 시험 삼아 시행했다.') },
  { id: 'l_giyu', at: at(1609, 6), run: L('일본과 기유약조를 맺어 국교를 다시 열었다.') },
  {
    id: 'l_gyechuk',
    at: at(1613, 4),
    run(s) {
      log(s, '계축옥사: 서얼들의 은상 강도 사건이 영창대군 추대 역모로 번졌다. 대북이 소북과 서인을 몰아친다.', 'history');
      const pool = people(s).filter((c) => !isP(s, c) && (c.faction === 'seo' || c.faction === 'nam') && inCourt(c));
      const acc = pool.length ? pick(s, pool) : undefined;
      if (acc) startOksa(s, acc);
    },
  },
  { id: 'l_pyemo', at: at(1617, 11), run: (s) => raiseAgenda(s, 'pyemo', {}) },
  { id: 'l_sarhu', at: at(1619, 3), run: L('사르후 전투: 명을 돕던 강홍립의 조선군이 후금에 항복했다. 광해군의 뜻이었다는 말이 돈다.') },
  { id: 'l_banjeong', at: at(1623, 3), run: (s) => (purgeBuk(s), crown(s, '인조')) },
  {
    id: 'l_igwal',
    at: at(1624, 1),
    run(s) {
      rebellion(s, ['pyeongan', 'hwanghae', 'gyeonggi'], '반정공신 이괄의 난', 2);
      log(s, '이괄의 군사가 도성을 점령해 왕이 공주로 피란했다.', 'war');
      kingMood(s, -10);
    },
  },
  { id: 'l_jeongmyo', at: at(1627, 1), run: (s) => horan(s, 'jeongmyo') },
  { id: 'l_byeongja', at: at(1636, 12), run: (s) => horan(s, 'byeongja') },
  { id: 'l_sohyeon', at: at(1645, 4), run: L('볼모에서 돌아온 소현세자가 갑자기 세상을 떠났다. 독살이라는 소문이 돈다.', (s) => startGukbon(s, 'wonson')) },
  { id: 'l_hyojong', at: at(1649, 5), run: (s) => crown(s, '효종') },
  { id: 'l_bukbeol', at: at(1652, 3), run: (s) => raiseAgenda(s, 'bukbeol', {}) },
  { id: 'l_naseon', at: at(1658, 6), run: L('나선정벌: 청의 요청으로 조선 조총군이 흑룡강에서 러시아군을 무찔렀다.', (s) => kingMood(s, 5)) },
  { id: 'l_hyeonjong', at: at(1659, 5), run: (s) => crown(s, '현종') },
  { id: 'l_yesong1', at: at(1659, 7), run: (s) => raiseAgenda(s, 'yesong1', {}) },
  { id: 'l_famine', at: at(1670, 7), run: L('경신대기근: 가뭄과 냉해, 역병이 겹쳐 백성이 수없이 죽었다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 20, 0, 100);
    s.realm.treasury -= 120;
  }) },
  { id: 'l_yesong2', at: at(1674, 3), run: (s) => raiseAgenda(s, 'yesong2', {}) },
  { id: 'l_sukjong', at: at(1674, 9), run: (s) => crown(s, '숙종') },
  { id: 'l_gyeongsin', at: at(1680, 3), run: (s) => (log(s, '경신환국: 허적의 유악(油幄) 사건으로 왕이 남인을 내치고 서인을 불러들였다.', 'history'), hwangukTop(s, 'nam'), kingLean(s, 'seo', 10)) },
  { id: 'l_seo_split', at: at(1683, 6), run: (s) => splitSeo(s) },
  {
    id: 'l_gisa',
    at: at(1689, 2),
    run(s) {
      log(s, '기사환국: 희빈 장씨의 아들을 원자로 정하는 일에 반대한 서인이 쫓겨났다. 송시열이 사사되었다.', 'history');
      hwangukTop(s, 'seo');
      const ss = figure(s, 'song_siyeol');
      if (ss && !isP(s, ss)) kill(s, ss, '사약을 받고 죽었다');
      kingLean(s, 'nam', 20);
    },
  },
  {
    id: 'l_gapsul',
    at: at(1694, 4),
    run(s) {
      log(s, '갑술환국: 왕이 다시 남인을 내치고 서인을 불러들였다. 희빈 장씨가 빈으로 강등되었다. 남인은 다시 일어서지 못한다.', 'history');
      hwangukTop(s, 'nam');
      kingLean(s, 'nam', -25);
      s.king.base = { ...(s.king.base ?? {}), nam: -20 };
      // 조정의 남인 셋에 하나는 고향으로 물러나 다시 나오지 않는다
      for (const c of members(s, 'nam')) {
        if (isP(s, c) || c.status === 'exiled' || !chance(s, 0.35)) continue;
        if (c.office) vacate(s, c, 'retired');
        c.status = 'retired';
        c.location = c.home;
        c.tags.push('recluse_nam');
      }
      for (const r of Object.values(s.regions)) if (r.influence.nam) r.influence.nam = Math.round(r.influence.nam * 0.6);
      s.line.nam = -30;
    },
  },
  { id: 'l_mugo', at: at(1701, 10), run: L('무고의 옥: 희빈 장씨가 인현왕후를 저주했다는 죄로 사사되었다.', (s) => (s.tension = clamp(s.tension + 5, 0, 100))) },
  { id: 'l_daedong_all', at: at(1708, 1), run: (s) => (log(s, '황해도까지 대동법이 시행되어 대동법이 팔도로 확대되었다.', 'history'), setLaw(s, 'daedong', true)) },
  { id: 'l_gyeongjong', at: at(1720, 6), run: (s) => crown(s, '경종') },
  {
    id: 'l_sinim',
    at: at(1721, 12),
    run(s) {
      log(s, '신임옥사: 연잉군을 세제로 세우고 대리청정까지 밀어붙인 노론 4대신이 역모로 몰렸다. 소론이 조정을 쥔다.', 'history');
      hwangukTop(s, 'noron');
      const cj = figure(s, 'kim_changjip');
      if (cj && !isP(s, cj)) kill(s, cj, '신임옥사로 사사되었다');
      const pool = members(s, 'noron').filter((c) => !isP(s, c) && inCourt(c));
      const acc = pool.length ? pick(s, pool) : undefined;
      if (acc) {
        startOksa(s, acc);
        if (s.oksa) s.oksa.harsh = true;
      }
    },
  },
  { id: 'l_yeongjo', at: at(1724, 8), run: (s) => (crown(s, '영조'), sejePayback(s)) },
  { id: 'l_eulsa', at: at(1725, 3), run: (s) => (log(s, '을사환국: 영조가 소론 강경파를 내치고 노론을 불러들였다.', 'history'), hwangukTop(s, 'soron')) },
  {
    id: 'l_injwa',
    at: at(1728, 3),
    run(s) {
      rebellion(s, ['chungcheong', 'gyeongsang'], '소론 강경파와 남인이 일으킨 이인좌의 난', 2);
      kingLean(s, 'soron', -15);
      kingLean(s, 'nam', -10);
    },
  },
  { id: 'l_tangpyeongbi', at: at(1742, 3), run: L('영조가 성균관 앞에 탕평비를 세웠다. "두루 사귀되 편당 짓지 않는 것이 군자의 마음이다."', (s) => (s.tension = clamp(s.tension - 10, 0, 100))) },
  { id: 'l_gyunyeok', at: at(1750, 7), run: (s) => raiseAgenda(s, 'law_debate', { lawId: 'gyunyeok', abolish: false, by: figure(s, 'bak_munsu')?.id ?? '' }) },
  {
    id: 'l_naju',
    at: at(1755, 2),
    run(s) {
      log(s, '나주 괘서 사건(을해옥사): 소론 잔당이 조정을 비방하는 괘서를 붙였다가 발각되었다. 소론이 크게 꺾였다.', 'history');
      const pool = members(s, 'soron').filter((c) => !isP(s, c));
      const acc = pool.length ? pick(s, pool) : undefined;
      if (acc) {
        startOksa(s, acc);
        if (s.oksa) s.oksa.harsh = true;
      }
      kingLean(s, 'soron', -20);
    },
  },
  { id: 'l_imo', at: at(1762, 5), run: (s) => (inCourt(P(s)) ? pushEvent(s, 'later_imo', {}) : log(s, '임오화변: 영조가 세자를 뒤주에 가두었다. 여드레 만에 세자가 죽었다(사도세자).', 'history')) },
  { id: 'l_sipa', at: at(1772, 6), run: L('사도세자의 죽음을 두고 조정이 갈렸다. 세자를 동정하는 시파와 영조의 처분을 옳다는 벽파다.', (s) => (s.tension = clamp(s.tension + 6, 0, 100))) },
  { id: 'l_jeongjo', at: at(1776, 3), run: (s) => (crown(s, '정조'), imoPayback(s), daeriPayback(s)) },
  { id: 'l_gyujang', at: at(1776, 9), run: L('정조가 규장각을 세우고 젊은 문신들을 길렀다.') },
  { id: 'l_seoeol_gyujang', at: at(1779, 3), run: (s) => (log(s, '정조가 박제가·유득공 등 서얼 출신을 규장각 검서관으로 썼다.', 'history'), setLaw(s, 'seoeol', true)) },
  { id: 'l_tongong', at: at(1791, 1), run: (s) => raiseAgenda(s, 'law_debate', { lawId: 'tongong', abolish: false, by: figure(s, 'chae_jegong')?.id ?? '' }) },
  {
    id: 'l_hwaseong',
    at: at(1796, 9),
    run: L('수원 화성이 완공되었다. 정약용의 거중기가 공기를 크게 줄였다.', (s) => {
      s.regions.gyeonggi.defense.fort = Math.min(5, s.regions.gyeonggi.defense.fort + 2);
      s.realm.treasury -= 100;
    }),
  },
  { id: 'l_sunjo', at: at(1800, 7), run: (s) => crown(s, '순조') },
  {
    id: 'l_sinyu',
    at: at(1801, 2),
    run(s) {
      log(s, '신유박해: 천주교를 믿는다는 죄로 남인 시파가 대거 처벌되었다. 정약용이 강진으로 유배되었다.', 'history');
      const jy = figure(s, 'jeong_yakyong');
      if (jy && !isP(s, jy) && jy.status !== 'exiled') exile(s, jy);
      const pool = members(s, 'nam').filter((c) => !isP(s, c) && inCourt(c));
      const acc = pool.length ? pick(s, pool) : undefined;
      if (acc) {
        startOksa(s, acc);
        if (s.oksa) s.oksa.harsh = true;
      }
    },
  },
  { id: 'l_sedo', at: at(1802, 10), run: L('김조순의 딸이 왕비가 되었다. 안동 김씨의 세도가 시작된다.', (s) => kingLean(s, 'noron', 15)) },
  { id: 'l_hong', at: at(1811, 12), run: (s) => rebellion(s, ['pyeongan'], '평안도 차별에 맞선 홍경래의 난', 4) },
  { id: 'l_cholera', at: at(1821, 8), run: L('서북에서 괴질(콜레라)이 번져 팔도에 수많은 사람이 죽었다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 8, 0, 100);
  }) },
];

/* ───────── 일본 통신사 ───────── */

const TONGSIN = [1607, 1617, 1624, 1636, 1643, 1655, 1682, 1711, 1719, 1748, 1764, 1811];

const tongsinCall = (y: number): Scheduled => ({
  id: `l_tongsin_${y}`,
  at: at(y, 2),
  cond: (s) => {
    const p = P(s);
    return alive(p) && inCourt(p) && p.rank <= 5 && p.rank >= 3 && s.player.abroadUntil <= s.t;
  },
  run: (s) => pushEvent(s, 'later_tongsin', {}),
});

LATER_SCHEDULE.push(...TONGSIN.map(tongsinCall));


/* ───────── 시기별 사건 더하기: 법의 시행, 국본, 바깥일, 재변 ───────── */

const lawAt = (id: string, y: number, m: number, text: string): Scheduled => ({
  id: `l_law_${id}`,
  at: at(y, m),
  cond: (s) => !s.laws[id]?.on,
  run: (s) => (log(s, text, 'history'), setLaw(s, id, true)),
});
const debateAt = (id: string, y: number, m: number, by?: string): Scheduled => ({
  id: `l_debate_${id}_${y}`,
  at: at(y, m),
  cond: (s) => !s.laws[id]?.on,
  run: (s) => raiseAgenda(s, 'law_debate', { lawId: id, abolish: false, by: (by && figure(s, by)?.id) || '' }),
});
const playerAt = (id: string, y: number, m: number, cond: (s: GameState) => boolean, alt?: string): Scheduled => ({
  id: `l_ev_${id}`,
  at: at(y, m),
  run: (s) => {
    const p = P(s);
    if (alive(p) && p.status !== 'exiled' && cond(s)) pushEvent(s, id, {});
    else if (alt) log(s, alt, 'history');
  },
});

LATER_SCHEDULE.push(
  { id: 'l_hoetoe', at: at(1611, 3), run: L('회퇴변척: 정인홍이 이언적·이황의 문묘 종사를 깎아내리자 성균관 유생들이 그의 이름을 유적(儒籍)에서 지웠다.', (s) => (s.tension = clamp(s.tension + 4, 0, 100))) },
  { id: 'l_seogung', at: at(1618, 1), run: L('인목대비가 서궁에 유폐되었다. 폐모를 반대한 이항복이 북청으로 귀양 갔다.', (s) => kingMood(s, -5)) },
  lawAt('gunyeong', 1624, 7, '이괄의 난을 겪은 뒤 도성을 지킬 어영청을 두었다. 금위영·총융청·수어청이 뒤따른다.'),
  lawAt('yeongjeong', 1635, 6, '영정법: 전세를 풍흉에 관계없이 토지 1결에 4두로 정했다.'),
  playerAt('later_gangbin', 1646, 3, (s) => inCourt(P(s)) && !!s.flags.wonsonAt, '소현세자빈 강씨가 왕을 저주했다는 죄로 사사되었다.'),
  { id: 'l_hamel', at: at(1653, 8), run: L('제주에 표류한 네덜란드 사람 하멜 일행을 붙잡아 도성으로 올려 보냈다.') },
  { id: 'l_naseon1', at: at(1654, 4), run: L('1차 나선정벌: 변급이 이끈 조총군이 흑룡강에서 러시아군을 물리쳤다.', (s) => kingMood(s, 3)) },
  lawAt('ogajak', 1675, 9, '남인 정권이 오가작통법을 다시 엄히 시행했다.'),
  debateAt('hopo', 1677, 3, 'yun_hyu'),
  lawAt('sangpyeong', 1678, 1, '상평통보를 찍어 온 나라에 쓰게 했다.'),
  { id: 'l_gumwi', at: at(1682, 3), run: L('금위영을 두어 오군영 체제가 갖추어졌다. 군영 대장 자리를 두고 당들의 다툼이 치열하다.') },
  { id: 'l_wonja', at: at(1688, 11), run: (s) => startGukbon(s, 'wonja', '희빈 장씨가 왕자를 낳자') },
  playerAt('later_ulleung', 1693, 6, (s) => inCourt(P(s)) && P(s).rank <= 5, '안용복이 일본에 건너가 울릉도와 독도가 조선 땅임을 따졌다.'),
  { id: 'l_baekdu', at: at(1712, 5), run: L('청과의 경계를 정하는 백두산정계비를 세웠다.') },
  debateAt('seowon', 1714, 6),
  { id: 'l_seje', at: at(1721, 8), run: (s) => startGukbon(s, 'seje', '왕이 병약하고 후사가 없자') },
  { id: 'l_apseul', at: at(1725, 10), run: L('영조가 무릎을 짓누르는 압슬형을 없앴다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim + 2, 0, 100);
  }) },
  { id: 'l_giyu_cheobun', at: at(1729, 8), run: L('기유처분: 영조가 신임옥사의 시비를 반씩 나누어 노론과 소론을 함께 썼다.', (s) => (s.tension = clamp(s.tension - 6, 0, 100))) },
  debateAt('seowon', 1741, 4),
  { id: 'l_juncheon', at: at(1760, 2), run: L('청계천 준천: 장정 20만 명을 들여 도성의 개천을 쳐냈다.', (s) => {
    s.regions.hanseong.minsim = clamp(s.regions.hanseong.minsim + 10, 0, 100);
    s.realm.treasury -= 60;
  }) },
  { id: 'l_goguma', at: at(1764, 7), run: L('통신사 조엄이 쓰시마에서 고구마를 들여왔다. 흉년의 구황 작물로 남쪽에 퍼진다.', (s) => {
    for (const r of ['gyeongsang', 'jeolla'] as RegionId[]) s.regions[r].arable = Math.min(1.5, s.regions[r].arable + 0.03);
  }) },
  lawAt('sinmungo', 1771, 11, '영조가 신문고를 다시 달았다.'),
  { id: 'l_daeri_seson', at: at(1775, 11), run: (s) => startGukbon(s, 'daeri_seson', '여든을 넘긴 왕이 기력이 쇠하자') },
  { id: 'l_seungheon', at: at(1784, 3), run: L('이승훈이 북경에서 세례를 받고 돌아왔다. 남인 소장파 사이에 서학이 번진다.') },
  playerAt('later_jinsan', 1791, 11, (s) => inCourt(P(s)) && (P(s).faction === 'nam' || P(s).rank <= 3), '진산 사건: 윤지충이 어머니의 신주를 불사른 일로 처형되었다. 남인이 신서파와 공서파로 갈린다.'),
  { id: 'l_wonhaeng', at: at(1795, 2), run: L('정조가 어머니 혜경궁을 모시고 화성으로 행차했다(원행을묘).', (s) => kingMood(s, 6)) },
  {
    id: 'l_sinyu_p',
    at: at(1801, 3),
    cond: (s) => s.flags.jinsan === 'tolerate',
    run(s) {
      const p = P(s);
      if (!alive(p) || p.status === 'exiled') return;
      if (chance(s, 0.45)) {
        exile(s, p);
        notice(s, '신유박해', '진산 사건 때 서학을 감쌌던 일이 들추어졌다. 사학(邪學)의 무리로 몰려 귀양을 간다.', 'danger');
      } else notice(s, '신유박해', '진산 사건 때 서학을 감쌌던 일로 이름이 오르내렸지만, 가까스로 화를 면했다.', 'danger');
    },
  },
  { id: 'l_jeongsun', at: at(1805, 1), run: L('정순왕후가 세상을 떠났다. 벽파가 무너지고 안동 김씨의 시파가 조정을 쥔다.', (s) => (s.tension = clamp(s.tension - 3, 0, 100))) },
  { id: 'l_gisa_famine', at: at(1809, 8), run: L('기사년 대기근: 팔도에 흉년이 들어 굶주린 백성이 길을 메웠다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 12, 0, 100);
    s.realm.treasury -= 60;
  }) },
  { id: 'l_gapsul_famine', at: at(1814, 8), run: L('갑술년에 다시 큰 흉년이 들었다. 삼정의 문란이 깊어 간다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 8, 0, 100);
  }) },
);

/* ───────── 역사의 세자 책봉: 국본이 일찍 선 왕대에는 책봉 논의가 일지 않는다 ───────── */

const heirAt = (y: number, m: number, name: string): Scheduled => ({
  id: `l_heir_${y}`,
  at: at(y, m),
  run(s) {
    const k = heirKey(s);
    if (typeof s.flags[k] === 'number') return;
    s.flags[k] = s.t;
    log(s, `[국본] ${josa(name, '이/가')} 세자로 책봉되었다.`, 'history');
  },
});

LATER_SCHEDULE.push(
  heirAt(1608, 10, '왕자 이지'),
  heirAt(1625, 1, '소현세자'),
  heirAt(1649, 8, '현종'),
  heirAt(1667, 1, '숙종'),
  heirAt(1690, 6, '희빈 장씨의 아들(경종)'),
  heirAt(1725, 3, '효장세자'),
  heirAt(1784, 8, '문효세자'),
  { id: 'l_munhyo', at: at(1786, 5), run: L('문효세자가 다섯 살에 홍역으로 세상을 떠났다. 국본이 다시 비었다.', (s) => delete s.flags[heirKey(s)]) },
  heirAt(1800, 1, '순조'),
  heirAt(1812, 7, '효명세자'),
);

/* ───────── 정조의 초계문신, 세도기의 매관매직 ───────── */

for (let y = 1781; y <= 1799; y += 2)
  LATER_SCHEDULE.push({
    id: `l_chogye_${y}`,
    at: at(y, 2),
    cond: (s) => {
      const p = P(s);
      return alive(p) && p.status === 'active' && p.rank >= 5 && p.rank <= 9 && p.learning >= 6 && !p.tags.includes('chogye');
    },
    run: (s) => pushEvent(s, 'later_chogye', {}),
  });

for (let y = 1806; y <= 1820; y += 3)
  LATER_SCHEDULE.push({
    id: `l_maegwan_${y}`,
    at: at(y, 6),
    cond: (s) => {
      const p = P(s);
      return alive(p) && p.status !== 'exiled' && p.rank >= 3 && p.wealth >= 80 && !p.traits.includes('clean');
    },
    run: (s) => pushEvent(s, 'later_maegwan', {}),
  });

/* ───────── 비변사가 국정의 중심이 되는 고비 ───────── */
LATER_SCHEDULE.push(
  { id: 'l_bb_1592', at: at(1592, 6), run: (s) => bibyeonJump(s, 10, '왜란이 일자 비변사가 전쟁을 총괄하게 되었다. 군량과 외교, 장수의 임명까지 비변사 회의에서 정한다.') },
  { id: 'l_bb_1598', at: at(1598, 12), run: (s) => bibyeonJump(s, 9, '전쟁이 끝났지만 비변사는 물러나지 않았다. 재정과 인사까지 쥔 국정 최고 기관으로 자리를 굳혔다. 의정부는 이름만 남는다.') },
  { id: 'l_bb_1637', at: at(1637, 2), run: (s) => bibyeonJump(s, 4, '호란을 치르며 비변사 당상이 늘고, 팔도의 일을 나누어 맡는 당상까지 두게 되었다.') },
  { id: 'l_bb_1802', at: at(1802, 11), run: (s) => bibyeonJump(s, 15, '척신들이 비변사 당상 자리를 차지하고 서로를 천거해 요직과 인사를 독점한다. 왕은 비변사가 정한 일을 따를 뿐이다.') },
);

/** 매달: 인물 등장, 전란 종료, 늘그막의 처리 */
export function tickLater(s: GameState) {
  if (yearOf(s.t) < 1601) return;
  spawnFigures(s);
  tickLaterWar(s);
}

/* ───────── 사건 ───────── */

export const LATER_EVENTS: Record<string, EventDef> = {
  later_banjeong: {
    build: () => ({
      title: '인조반정',
      kind: 'danger',
      text: '서인들이 군사를 일으켜 광해군을 몰아냈다. 대북의 요인들이 줄줄이 죽거나 귀양을 간다. 북인인 당신에게도 칼끝이 향한다.',
      choices: [
        { key: 'nam', label: '남인에 몸을 의탁한다', hint: '당적을 바꾼다 (평생 횟수에 들지 않는다). 성심 -5' },
        { key: 'retire', label: '고향으로 물러난다', hint: '관직을 내려놓고 낙향한다. 무당이 된다' },
        { key: 'stand', label: '끝까지 대북의 의리를 지킨다', hint: '절반의 확률로 유배된다. 명망 +5' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'nam') {
        p.faction = 'nam';
        fav(p, -5);
        return '남인과 손을 잡았다.';
      }
      if (key === 'retire') {
        if (p.office) vacate(s, p, 'retired');
        p.status = 'retired';
        p.location = p.home;
        p.faction = 'none';
        return '고향으로 물러났다.';
      }
      pres(p, 5);
      p.faction = 'none';
      if (chance(s, 0.5)) {
        exile(s, p);
        return '대북의 의리를 지키다 귀양을 갔다.';
      }
      return '대북의 의리를 지켰다. 다행히 화는 면했다.';
    },
  },
  later_seo_split: {
    build: () => ({
      title: '노론과 소론',
      kind: 'court',
      text: '남인을 얼마나 엄히 다스릴 것인가를 두고 서인이 둘로 갈라섰다. 송시열을 따르는 노론은 의리와 명분을, 윤증·남구만을 따르는 소론은 온건함과 실리를 내세운다. 어느 쪽에 설 것인가.',
      choices: [
        { key: 'noron', label: '노론에 선다', hint: '송시열의 편. 강경하다' },
        { key: 'soron', label: '소론에 선다', hint: '윤증·남구만의 편. 온건하다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      p.faction = key as FactionId;
      return `${FACTION_META[p.faction].name}에 섰다.`;
    },
  },
  later_tongsin: {
    build: () => ({
      title: '통신사(通信使)',
      kind: 'court',
      text: '일본에 보내는 통신사의 일행으로 당신이 거론된다. 바다를 건너 에도까지 열 달이 걸리는 먼 길이다. 가는 곳마다 일본의 문사들이 시문을 청하니 학식이 빛날 기회이고, 왜인의 사정을 살펴 오는 것도 나라에 보탬이 된다.',
      choices: [
        { key: 'go', label: '통신사로 떠난다', hint: '열 달 동안 조정을 비운다 (서신만). 학식 경험 +8, 명망 +4, 성심 +3, 재산 +15. 병을 얻을 수 있다 (15%)' },
        { key: 'decline', label: '병을 핑계로 사양한다', hint: '성심 -2' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key !== 'go') {
        fav(p, -2);
        return '통신사 일행에서 빠졌다.';
      }
      s.player.abroadUntil = s.t + 10;
      s.player.exp.learning += 8;
      pres(p, 4);
      fav(p, 3);
      p.wealth += 15;
      if (chance(s, 0.15)) s.player.sick = true;
      s.player.deeds.push(`${yearOf(s.t)}.02 통신사로 일본에 감`);
      log(s, `${josa(p.name, '이/가')} 통신사 일행으로 일본에 건너갔다.`, 'player');
      return '부산에서 배를 타고 일본으로 향했다. 열 달 뒤에 돌아온다.';
    },
  },
  later_gangbin: {
    build: () => ({
      title: '강빈의 옥사',
      kind: 'danger',
      text: '소현세자의 빈 강씨가 왕의 수라에 독을 넣으려 했다는 죄목으로 사사하라는 왕명이 내려졌다. 원손을 세우자던 이들은 이것이 원손의 어머니를 없애려는 것임을 안다. 대신들은 눈치만 본다.',
      choices: [
        { key: 'save', label: '죄가 분명하지 않다며 구명한다', hint: '성심 -10, 명망 +6' },
        { key: 'silent', label: '입을 다문다', hint: '아무 일도 없다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      log(s, '소현세자빈 강씨가 왕을 저주했다는 죄로 사사되었다.', 'history');
      s.tension = clamp(s.tension + 4, 0, 100);
      if (key === 'save') {
        fav(p, -10);
        pres(p, 6);
        log(s, `${josa(p.name, '이/가')} 강빈의 죄가 분명하지 않다며 구명했다.`, 'player');
        return '강빈을 구명했으나 왕명을 되돌리지 못했다. 선비들은 당신의 이름을 기억한다. (성심 -10, 명망 +6)';
      }
      return '입을 다물었다.';
    },
  },
  later_ulleung: {
    build: () => ({
      title: '울릉도 쟁계(鬱陵島爭界)',
      kind: 'court',
      text: '동래 사람 안용복이 일본에 건너가 울릉도와 자산도가 조선 땅이라 따지고 돌아왔다. 쓰시마는 울릉도를 「다케시마」라 부르며 조선 사람의 왕래를 막으라 한다. 조정의 의논이 갈린다.',
      choices: [
        { key: 'hard', label: '울릉도는 조선 땅이라고 분명히 따진다', hint: '명망 +4, 성심 +3. 국고 -10 (수토군을 보낸다)' },
        { key: 'soft', label: '왜와 다툼을 피하고 섬을 비워 둔다', hint: '성심 +1. 명망 -2' },
        { key: 'punish', label: '함부로 국경을 넘은 안용복을 벌하자고 한다', hint: '명망 -3' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      log(s, '안용복이 일본에 건너가 울릉도와 독도가 조선 땅임을 따졌다.', 'history');
      if (key === 'hard') {
        pres(p, 4);
        fav(p, 3);
        s.realm.treasury -= 10;
        log(s, '조정이 울릉도가 조선 땅임을 쓰시마에 분명히 하고, 3년마다 수토관을 보내기로 했다.', 'history');
        return '울릉도는 조선 땅이라고 따졌다. 쓰시마가 물러섰다. (명망 +4, 성심 +3)';
      }
      if (key === 'soft') {
        fav(p, 1);
        pres(p, -2);
        return '다툼을 피하자고 했다. 겁이 많다는 말을 들었다. (명망 -2)';
      }
      pres(p, -3);
      return '안용복을 벌하자고 했다. 공을 세운 백성을 벌한다는 말이 돈다. (명망 -3)';
    },
  },
  later_jinsan: {
    build: () => ({
      title: '진산(珍山) 사건',
      kind: 'danger',
      text: '전라도 진산의 선비 윤지충이 천주교를 믿어 어머니의 신주를 불사르고 제사를 지내지 않았다. 남인 가운데 서학에 너그러운 신서파와 이를 공격하는 공서파가 맞선다. 노론 벽파는 이 기회에 남인을 통째로 치려 한다.',
      choices: [
        { key: 'harsh', label: '윤지충을 엄벌하고 서학을 금하자고 한다', hint: '명망 +2, 성심 +2. 공서파의 길이다' },
        { key: 'tolerate', label: '죄는 윤지충 한 사람에 그치자고 한다', hint: '명망 +3. 훗날 사학의 무리로 몰릴 수 있다' },
        { key: 'silent', label: '말을 아낀다', hint: '아무 일도 없다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      log(s, '진산 사건: 윤지충이 어머니의 신주를 불사른 일로 처형되었다. 남인이 신서파와 공서파로 갈린다.', 'history');
      s.tension = clamp(s.tension + 4, 0, 100);
      s.flags.jinsan = key;
      if (key === 'harsh') {
        pres(p, 2);
        fav(p, 2);
        return '서학을 엄히 금하자고 했다. (명망 +2, 성심 +2)';
      }
      if (key === 'tolerate') {
        pres(p, 3);
        return '죄를 한 사람에 그치자고 했다. 정조가 고개를 끄덕였지만, 벽파가 당신의 이름을 적어 두었다. (명망 +3)';
      }
      return '말을 아꼈다.';
    },
  },
  later_chogye: {
    build: () => ({
      title: '초계문신(抄啓文臣)',
      kind: 'personal',
      text: '정조가 서른일곱 아래의 젊은 문신 가운데 재주 있는 이를 골라 규장각에서 다시 공부시킨다. 왕이 몸소 시험을 내고 성적을 매긴다. 당신의 이름이 명단에 올랐다.',
      choices: [
        { key: 'join', label: '규장각에 나아가 배운다', hint: '학식 경험 +10, 성심 +6, 명망 +3. 몇 달 동안 업무가 밀린다 (행동력 -1)' },
        { key: 'decline', label: '맡은 일이 바쁘다며 사양한다', hint: '성심 -3' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key !== 'join') {
        fav(p, -3);
        return '초계문신을 사양했다. 왕이 서운해한다.';
      }
      p.tags.push('chogye');
      s.player.exp.learning += 10;
      fav(p, 6);
      pres(p, 3);
      s.player.ap = Math.max(0, s.player.ap - 1);
      s.player.deeds.push(`${yearOf(s.t)} 초계문신에 뽑힘`);
      log(s, `${josa(p.name, '이/가')} 초계문신으로 뽑혀 규장각에서 공부했다.`, 'player');
      return '규장각에서 왕이 내는 시험을 치렀다. 왕이 당신의 답안에 붉은 점을 찍었다. (성심 +6, 명망 +3)';
    },
  },
  later_maegwan: {
    build: (s) => {
      const p = P(s);
      return {
        title: '세도가의 문객',
        kind: 'danger',
        text: `안동 김씨 세도가의 문객이 찾아와 넌지시 말한다. "대감께서 성의를 보이시면 다음 정사(政事)에 좋은 자리가 날 겁니다." 벼슬이 돈으로 오가는 세상이다. 거절하면 세도가의 눈 밖에 난다.`,
        choices: [
          { key: 'pay', label: `재물을 바친다 (재산 -${Math.min(150, Math.round(p.wealth * 0.4))})`, hint: '성심 +8, 다음 승진이 빨라진다. 숨은 흠결 「매관」' },
          { key: 'refuse', label: '정중히 거절한다', hint: '노론 세도가가 언짢아한다 (성심 -4)' },
          { key: 'expose', label: '매관매직을 탄핵하는 상소를 올린다', hint: '명망 +6, 성심 -10. 세도가의 미움을 산다', disabled: inCourt(p) ? undefined : '조정에 있어야 한다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'pay') {
        p.wealth -= Math.min(150, Math.round(p.wealth * 0.4));
        fav(p, 8);
        p.promotedAt -= 24;
        addFlaw(s, p, '매관(賣官)', false);
        return '재물을 바쳤다. 곧 좋은 소식이 있을 거라 한다. (성심 +8, 숨은 흠결)';
      }
      if (key === 'refuse') {
        fav(p, -4);
        return '거절했다. 문객이 차갑게 웃으며 돌아갔다. (성심 -4)';
      }
      pres(p, 6);
      fav(p, -10);
      kingLean(s, 'noron', -2);
      log(s, `${josa(p.name, '이/가')} 세도가의 매관매직을 탄핵하는 상소를 올렸다.`, 'player');
      return '세도가의 매관매직을 들춰냈다. 선비들이 박수를 치지만 세도가는 당신의 이름을 잊지 않을 것이다. (명망 +6, 성심 -10)';
    },
  },
  later_imo: {
    build: () => ({
      title: '임오화변(壬午禍變)',
      kind: 'danger',
      text: '영조가 세자를 창경궁 휘령전 앞에 불러 뒤주에 들어가라 명했다. 대신들은 엎드려 떨고, 세손이 할아버지의 옷자락을 붙잡고 운다.',
      choices: [
        { key: 'save', label: '목숨을 걸고 세자를 구명한다', hint: '성심 -15, 명망 +8. 훗날 세손(정조)이 기억할 것이다' },
        { key: 'silent', label: '엎드려 입을 다문다', hint: '아무 일도 없다' },
        { key: 'side', label: '세자의 비행은 사실이라 아뢴다', hint: '성심 +6, 명망 -6. 세손이 즉위하면 미움을 산다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      log(s, '임오화변: 영조가 세자를 뒤주에 가두었다. 여드레 만에 세자가 죽었다(사도세자).', 'history');
      s.flags.imo = key;
      if (key === 'save') {
        fav(p, -15);
        pres(p, 8);
        return '세자를 구명하다 왕의 노여움을 샀다. 그러나 세손이 당신을 보았다.';
      }
      if (key === 'side') {
        fav(p, 6);
        pres(p, -6);
        return '세자의 비행을 아뢰었다.';
      }
      return '엎드려 입을 다물었다.';
    },
  },
};

/** 정조가 즉위할 때 임오년에 한 일을 갚는다 */
export function imoPayback(s: GameState) {
  const p = P(s);
  if (s.flags.imo === 'save') {
    fav(p, 30);
    notice(s, '세손의 기억', '정조가 즉위하며 임오년에 세자를 구명한 당신을 잊지 않았다. (성심 +30)', 'personal');
  } else if (s.flags.imo === 'side') {
    fav(p, -30);
    notice(s, '세손의 기억', '정조가 즉위하며 임오년에 세자의 비행을 아뢴 당신을 차갑게 대한다. (성심 -30)', 'danger');
  }
}

