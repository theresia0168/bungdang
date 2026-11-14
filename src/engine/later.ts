import type { Character, FactionId, GameState, RegionId, TraitId } from './types';
import type { EventDef } from './events/types';
import { FACTION_META, REGION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { recordReign, tOf, yearOf } from './calendar';
import { chance, d6, pick, randInt } from './rng';
import { addFlaw, alive, clamp, fav, inCourt, isP, josa, log, notice, officeTitle, P, people, pres, pushEvent } from './state';
import { swayFaction, topOf } from './opinion';
import { activeFactions, members, powerShare, splitDong, updateLeaders } from './factions';
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
import { candidates, favorite } from './royal';
import { legitAtCrown, legitName, legitOf, setLegit, shakeLegit } from './legit';

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
  // 선조의 세자가 광해군이 아니었다면 (1608~1623년의 열린 구간)
  임해군: { born: 1572, style: 'volatile', lean: { seo: -5 }, text: '임해군이 즉위했다. 성품이 거칠고 술을 즐겨, 신하들이 숨을 죽인다.' },
  정원군: { born: 1580, style: 'plain', lean: {}, text: '정원군이 즉위했다. 너그럽되 결단이 무르다는 평이다. 인빈 김씨의 친정이 힘을 얻는다.' },
  의창군: { born: 1589, style: 'plain', lean: {}, text: '의창군이 즉위했다. 젊은 임금이라 대신들이 정사를 이끈다.' },
  // 대체역사의 갈래: 원손이 지켜졌다면, 세제 책봉이 무산되었다면, 사도세자가 살았다면
  경선군: { born: 1636, style: 'plain', lean: { nam: 10, seo: 5 }, text: '소현세자의 맏아들 경선군이 열네 살로 즉위했다. 몸이 약해 대신들이 정사를 이끈다. 봉림대군은 숨을 죽인다.' },
  밀풍군: { born: 1698, style: 'plain', lean: { soron: 25, noron: -20, nam: 5 }, text: '경종이 후사 없이 승하하자 소론이 종친 밀풍군을 받들었다. 소현세자의 증손이다. 연잉군과 노론은 숨을 죽인다.' },
  장조: { born: 1735, style: 'volatile', lean: { nam: 10, soron: 5, noron: -10 }, text: '임오년에 목숨을 건진 세자가 즉위했다(장조). 화증(火症)이 깊어 그의 노여움을 아무도 가늠하지 못한다.' },
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

function crown(s: GameState, name: string, opt: { char?: Character; text?: string } = {}) {
  const old = s.chars[kingId(s)];
  if (old && old.status !== 'dead') {
    old.status = 'dead';
    old.death = { t: s.t, cause: '승하했다' };
  }
  let k: Character | undefined = opt.char;
  if (!k && name === '광해군' && alive(s.chars.gwanghae)) k = s.chars.gwanghae;
  const r = REIGN[name] ?? { born: k?.born ?? yearOf(s.t) - 20, style: 'plain' as KingStyle, lean: {}, text: `${josa(name, '이/가')} 즉위했다.` };
  const text = opt.text ?? r.text;
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
  // 선조의 왕자가 오르면, 국본 논의 때 그를 밀었던 당을 가까이한다
  if (s.royal?.princes?.[k.id]) {
    for (const f of activeFactions(s)) {
      const pk = s.royal.picks?.[f];
      if (pk) kingLean(s, f, pk === k.id ? 15 : -5);
    }
  }
  recordReign(s, name, yearOf(s.t));
  {
    const [lg, why] = legitAtCrown(s, name);
    setLegit(s, lg, why);
  }
  if (s.flags.altKing && s.flags.altKing !== k.id) delete s.flags.altKing;
  log(s, `[국왕] ${text}`, 'history');
  {
    const lg = legitOf(s);
    if (lg.score < 55) log(s, `[정통성] ${name}의 정통성은 「${legitName(lg.score)}」. ${lg.why.join(', ')}. 명분을 세워 왕권을 다지려 할 것이다.`, 'history');
  }
  const p = P(s);
  if (alive(p) && inCourt(p)) notice(s, '새 임금', `${text}\n\n왕이 바뀌면 성심은 절반만 남는다. 새 임금의 눈에 들어야 한다.`, 'history');
  for (const c of people(s)) c.favor = Math.round(c.favor * 0.5);
  // 세자 시절부터 받든 왕자가 임금이 되었다
  if (s.royal?.backing === k.id && alive(p) && p.status !== 'exiled') {
    fav(p, 12);
    if (!p.tags.includes('kingsman')) p.tags.push('kingsman');
    notice(s, '잠저의 인연', `세자 시절부터 받들어 온 ${josa(k.name, '이/가')} 임금이 되었다. 새 임금이 당신을 「과인의 사람」이라 부른다. (성심 +12, 왕의 사람)`, 'personal');
  }
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

/* ───────── 선조 뒤의 열린 구간(1608~1623) ─────────
 * 선조가 승하하면 실제 세자가 즉위한다. 세자가 없으면 왕이 아끼던 왕자가 유교(遺敎)로 잇는다.
 * 그 임금이 후사 없이 승하하면 아우가 잇고(방계 계승), 정원군이면 맏아들 능양군이 잇는다.
 * 1623년에는 역사로 돌아온다: 실정이 크면 서인이 반정을 일으키고, 아니면 임금이 후사 없이 승하해 능양군이 대통을 잇는다.
 */
const SLOT_END = tOf(1623, 3);
const kingNow = (s: GameState) => s.chars[kingId(s)];
const kingNameNow = (s: GameState) => kingNow(s)?.name ?? '임금';

function crownAfterSeonjo(s: GameState) {
  let c = s.heir && alive(s.chars[s.heir]) ? s.chars[s.heir] : undefined;
  const byWill = !c;
  if (!c) {
    c = favorite(s);
    if (c) log(s, `[국본] 선조가 세자를 정하지 못한 채 위독해지자, 유교(遺敎)로 ${josa(c.name, '을/를')} 후사로 삼았다.`, 'history');
  }
  if (!c || c.id === 'gwanghae') return crown(s, '광해군');
  // 역사에서 임해군은 아우에게 죽었다. 임금이 된 그에게는 몇 해가 더 주어진다
  if (c.id === 'imhae') c.destiny = randInt(s, 1612, 1620);
  crown(s, c.name, { char: c, text: `선조가 승하하고 ${byWill ? '' : '세자 '}${REIGN[c.name]?.text ?? `${josa(c.name, '이/가')} 즉위했다.`}` });
}

/** 열린 구간에 임금이 승하하면 누가 잇는가 */
function tickSlot(s: GameState) {
  if (s.t <= tOf(1608, 2) || s.t >= SLOT_END) return;
  const k = kingNow(s);
  if (!k || k.status !== 'dead') return;
  if (k.id === 'jeongwon') {
    s.flags.injoEarly = true;
    crown(s, '인조', { text: `${josa(k.name, '이/가')} 승하하고 맏아들 능양군이 대통을 이었다(인조). 반정 없이 선 임금이라 공신의 그늘이 없다.` });
    purgeBuk(s, 'fade');
    return;
  }
  const next = candidates(s).find((c) => c.id !== k.id);
  if (next) {
    if (next.id === 'imhae') next.destiny = Math.max(next.destiny, randInt(s, 1612, 1620));
    crown(s, next.name, {
      char: next,
      text: `${josa(k.name, '이/가')} 후사 없이 승하하여 아우 ${josa(next.name, '이/가')} 대통을 이었다(방계 계승). ${(REIGN[next.name]?.text ?? '').replace(/^\S+ 즉위했다\. ?/, '')}`.trim(),
    });
    return;
  }
  s.flags.injoEarly = true;
  crown(s, '인조', { text: `${josa(k.name, '이/가')} 후사 없이 승하하여 선조의 손자 능양군이 대통을 이었다(인조, 방계 계승).` });
  purgeBuk(s, 'fade');
}

/** 1623년, 역사로 돌아오는 길: 반정인가, 방계 계승인가 */
function slotVerdict(s: GameState): 'done' | 'coup' | 'bang' {
  const k = kingNow(s);
  if (!k || k.status === 'dead' || s.flags.injoEarly) return 'done';
  if (k.id === 'gwanghae') return 'coup';
  if (k.id === 'jeongwon') return 'bang';
  let bad = 0;
  if (s.flags.pyemo) bad += 2;
  if (kingStyle(s) === 'volatile') bad += 2;
  if (s.king.mood < 0) bad += 1;
  if ((s.king.lean.seo ?? 0) < 0) bad += 1;
  return bad >= 3 ? 'coup' : 'bang';
}

function slotEnd(s: GameState) {
  const v = (s.flags.slotEnd as string | undefined) ?? slotVerdict(s);
  const k = kingNow(s);
  if (v === 'coup' && k && k.status !== 'dead') {
    s.flags.deposed = k.name;
    s.flags.banjeongDone = true;
    purgeBuk(s);
    crown(s, '인조');
    banjeongReward(s);
    return;
  }
  if (v === 'bang' && k && k.status !== 'dead') {
    crown(s, '인조', {
      text:
        k.id === 'jeongwon'
          ? `${josa(k.name, '이/가')} 승하하고 맏아들 능양군이 대통을 이었다(인조). 반정 없이 선 임금이라 공신의 그늘이 없다.`
          : `${josa(k.name, '이/가')} 후사 없이 승하하여 선조의 손자 능양군이 대통을 이었다(인조, 방계 계승). 서인이 조정을 쥐고 남인 일부를 함께 쓴다.`,
    });
  }
  purgeBuk(s, 'fade');
}

/* ───────── 대체역사의 세 갈래: 원손(1649~)·밀풍군(1724~)·장조(1776~) ─────────
 * 국본 싸움에서 역사의 반대쪽이 이기면(이기기 어렵다) 다른 임금이 선다. 몇 해 뒤 역사로 돌아온다.
 */
function crownAlt(s: GameState, name: string, kind: string, endT: number) {
  crown(s, name);
  s.flags.altKing = kingId(s);
  s.flags.altKind = kind;
  s.flags.altEnd = endT;
}

/** 대체 임금이 물러나면 역사의 임금이 잇는다 */
function tickAlt(s: GameState) {
  const kind = s.flags.altKind;
  if (!kind || typeof s.flags.altEnd !== 'number' || s.t < (s.flags.altEnd as number)) return;
  const k = kingNow(s);
  if (!k || k.id !== s.flags.altKing) {
    delete s.flags.altKind;
    return;
  }
  delete s.flags.altKind;
  const p = P(s);
  if (kind === 'gyeongseon') {
    crown(s, '효종', { text: `병약하던 ${josa(k.name, '이/가')} 후사 없이 승하하여 숙부 봉림대군이 대통을 이었다(효종, 방계 계승). ${s.flags.samjeondo ? '청에 볼모로 있던 한을 품고 북벌을 꿈꾼다.' : '굳센 기상으로 북방의 방비를 다진다.'}` });
    if (s.flags.wonsonSide === 'b' && alive(p)) {
      fav(p, -10);
      notice(s, '숙부의 기억', '효종이 즉위하며 원손을 세우자 했던 당신을 차갑게 본다. (성심 -10)', 'danger');
    }
  } else if (kind === 'jangjo') {
    crown(s, '정조', { text: `화증이 깊어진 ${josa(k.name, '이/가')} 세손에게 선위했다(정조). 젊은 임금이 탕평과 규장각으로 왕권을 세운다.` });
    imoPayback(s);
    sipaTurn(s, 'jeongjo');
  }
}

/** 1724년: 세제 책봉이 무산되었으면 소론이 종친을 받든다 */
function crownAfterGyeongjong(s: GameState) {
  if (!s.flags.sejeFailed) {
    crown(s, '영조');
    sejePayback(s);
    return;
  }
  crownAlt(s, '밀풍군', 'milpung', tOf(1728, 3));
  const p = P(s);
  if (alive(p) && s.flags.sejeSide === 'b') {
    fav(p, 12);
    notice(s, '새 임금의 은혜', '세제 책봉을 막아섰던 당신을 밀풍군과 소론이 반긴다. (성심 +12)', 'personal');
  }
}

/** 1728년: 밀풍군의 조정이 무너지고 연잉군이 대통을 잇는다 */
function milpungEnd(s: GameState) {
  const k = kingNow(s);
  if (!k || k.id !== s.flags.altKing) return;
  delete s.flags.altKind;
  const coup = s.king.mood < 0 || (s.factions.noron.active && chance(s, 0.5));
  if (coup) {
    log(s, '무신정변: 노론이 연잉군을 받들어 군사를 일으켰다. 밀풍군은 강화로 쫓겨나고 소론 대신들이 줄줄이 잡혀갔다.', 'history');
    if (s.factions.soron.active) hwangukTop(s, 'soron');
    s.flags.yeongjoCoup = true;
    crown(s, '영조', { text: '정변으로 연잉군이 즉위했다(영조). 피로 얻은 자리라 붕당의 폐해를 누르려 탕평을 내세운다.' });
  } else {
    crown(s, '영조', { text: '밀풍군이 후사 없이 승하하여 경종의 아우 연잉군이 대통을 이었다(영조, 방계 계승). 붕당의 폐해를 누르려 탕평을 내세운다.' });
  }
  sejePayback(s);
}

/* ───────── 붕당의 변천 ───────── */

/** 인조반정: 대북이 무너진다 */
function purgeBuk(s: GameState, mode: 'coup' | 'fade' = 'coup') {
  if (!s.factions.buk.active) return;
  const p = P(s);
  const bukMembers = members(s, 'buk');
  const top = bukMembers.filter((c) => c.status === 'active' && c.office && OFFICE_MAP[c.office] && c.rank <= 2).sort((a, b) => b.politics - a.politics);
  const killed: string[] = [];
  if (mode === 'coup') {
    for (const c of top.slice(0, 3)) {
      if (isP(s, c)) continue;
      kill(s, c, '반정으로 죽임을 당했다');
      killed.push(c.name);
    }
  }
  for (const c of bukMembers) {
    if (!alive(c) || isP(s, c)) continue;
    if (c.status === 'active' && c.office && OFFICE_MAP[c.office] && (mode === 'coup' || chance(s, 0.4))) {
      if (mode === 'coup' && chance(s, 0.5)) exile(s, c);
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
  if (mode === 'fade') {
    s.tension = clamp(s.tension + 5, 0, 100);
    log(s, '[붕당] 새 임금 아래에서 기댈 곳을 잃은 대북이 흩어졌다. 일부는 남인에 몸을 맡기고, 나머지는 벼슬을 버렸다.', 'history');
    if (p.faction === 'buk' && alive(p)) {
      p.faction = 'nam';
      notice(s, '흩어지는 대북', '대북이 흩어졌다. 당신은 남인에 몸을 맡겼다. (당적 변경은 평생 횟수에 들지 않는다)', 'court');
    }
    updateLeaders(s);
    return;
  }
  s.tension = clamp(s.tension + 15, 0, 100);
  log(s, `[반정] 서인이 군사를 일으켜 ${josa(String(s.flags.deposed ?? '광해군'), '을/를')} 몰아냈다. 대북이 무너졌다.${killed.length ? ` ${killed.join('·')} 등이 죽었다.` : ''}`, 'history');
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
  updateLeaders(s);
  log(s, `[붕당] 남인 처벌을 두고 서인이 갈라섰다. ${josa(headOf(s, 'song_siyeol', 'noron'), '을/를')} 따르는 노론과 ${josa(headOf(s, 'yun_jeung', 'soron'), '을/를')} 따르는 소론이다.`, 'faction');
  if (p.faction === 'seo') pushEvent(s, 'later_seo_split', {});
}

/** 같은 뿌리의 당들을 한꺼번에 환국으로 친다 (서인이 갈라졌으면 노론·소론 모두) */
function hwangukTop(s: GameState, top: 'seo' | 'dong' | FactionId) {
  // 서인·동인 같은 뿌리를 부르면 갈라진 당들을 모두, 노론·소론처럼 콕 집으면 그 당만 친다
  const broad = top === 'seo' || top === 'dong';
  const hit = activeFactions(s).filter((f) => (broad ? topOf(f) === topOf(top as FactionId) : f === top));
  // 서인처럼 갈라진 당을 통째로 칠 때는 한 번의 환국으로 적는다
  const names: string[] = [];
  for (const f of hit) names.push(...hwanguk(s, f, true, hit.length > 1));
  if (hit.length > 1) log(s, `[환국] 왕이 ${FACTION_META[top as FactionId].name}(${hit.map((f) => FACTION_META[f].name).join('·')})의 전횡을 꺾었다. ${names.slice(0, 6).join(', ')} 등이 하루아침에 자리에서 물러났다.`, 'history');
  for (const f of hit) {
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
  s.flags[`${which}Held`] = held;
  if (which === 'byeongja' && !held) s.flags.samjeondo = true;
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
  if (!held && alive(p) && p.status !== 'exiled') pushEvent(s, 'horan_flight', { which });
}

/** 남한산성에서 고른 자리가 전란 뒤까지 따라온다 */
function horanAfter(s: GameState) {
  const p = P(s);
  if (!alive(p) || p.status === 'exiled') return;
  pushEvent(s, 'horan_sokhwan', {});
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
  // 플레이어가 다스리는 고을이 난리 한가운데 있으면
  const p = P(s);
  if (alive(p) && p.status === 'active' && regions.includes(p.location as RegionId) && (p.office === 'suryeong' || p.office?.startsWith('gamsa_')))
    pushEvent(s, 'rebel_local', { name, quick });
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
/** 그때의 상황을 보고 문장을 짓는 연대기 기록 */
const Ldyn = (text: (s: GameState) => string, fx?: (s: GameState) => void) => (s: GameState) => {
  log(s, text(s), 'history');
  fx?.(s);
};
/** 이 당을 대표하는 이름: 실존 인물이 살아 있으면 그, 아니면 당의 영수, 그도 없으면 당 이름 */
function headOf(s: GameState, figKey: string, f: FactionId): string {
  const fig = figure(s, figKey);
  if (fig) return fig.name;
  const lead = s.chars[s.factions[f]?.leader ?? ''];
  return alive(lead) ? lead.name : f === 'noron' ? '강경한 원로들' : f === 'soron' ? '온건한 소장들' : `${FACTION_META[f].name}의 원로들`;
}
const L = (text: string, fx?: (s: GameState) => void) => (s: GameState) => {
  log(s, text, 'history');
  fx?.(s);
};

/* ───────── 시간 창 + 조건 ─────────
 * 국내 정치의 큰 사건은 정해진 달에 터지지 않는다. 역사의 날짜 앞뒤로 창이 열리고,
 * 창 안에서 형세가 무르익을수록(ripe: 달마다 터질 확률) 일찍 터진다.
 * 창이 닫힐 때까지 터지지 않았으면 마지막 달에 터진다(late). 그때 형세가 맞지 않으면 사건이 다르게 끝나거나 지나간다.
 * pre가 거짓이면 그 달에는 터지지 않는다. 창이 닫힐 때까지 pre가 거짓이면 사건은 일어나지 않는다.
 */
const windowed = (
  id: string,
  from: [number, number],
  to: [number, number],
  o: {
    pre?: (s: GameState) => boolean;
    ripe: (s: GameState) => number;
    run: (s: GameState, late: boolean) => void;
    /** 조짐: 형세가 이만큼 무르익으면(또는 창이 닫히기 반년 전) 먼저 기록된다. 사건은 조짐 뒤 석 달이 지나야 터진다 */
    omen?: { at?: number; text: (s: GameState) => string };
    /** 폐단이 이미 쌓여 있는 사건: 창이 열리자마자 조짐을 기록한다 */
    omenAtStart?: boolean;
    /** 이 사건에 쫓겨날 당. 조짐이 보일 때 그 당의 플레이어가 대비할 수 있다 */
    warn?: FactionId[];
    /** 조짐 목록에 보일 이름 */
    label?: string;
    /** 거듭 누르면 끝내 일어나지 않을 수 있는가 (뒤의 역사가 기대는 사건은 늦출 수만 있다) */
    cancellable?: boolean;
  },
): Scheduled => {
  const t1 = tOf(to[0], to[1]);
  if (o.label) WINDOWS.push({ id, label: o.label, t1, warn: o.warn, cancellable: !!o.cancellable });
  return {
    id,
    at: from,
    window: t1 - tOf(from[0], from[1]),
    cond: (s) => {
      if (o.pre && !o.pre(s)) return false;
      // 플레이어가 부추기면 일찍, 누르면 늦게 무르익는다
      const nudge = Number(s.flags[`nudge_${id}`] ?? 0);
      const r = clamp(o.ripe(s) + nudge * 0.03, 0, 0.5);
      if (o.omen) {
        const key = `omen_${id}`;
        if (typeof s.flags[key] !== 'number') {
          // 형세가 기준을 넘으면 바로, 아니면 형세에 비례한 확률로 조짐이 먼저 비친다
          if (o.omenAtStart || r >= (o.omen.at ?? 0.06) || s.t >= t1 - 6 || chance(s, Math.min(0.5, r * 1.5))) {
            s.flags[key] = s.t;
            log(s, `[조짐] ${o.omen.text(s)}`, 'history');
            if (o.warn) warnPlayer(s, o.omen.text(s), o.warn);
          }
          return s.t >= t1;
        }
        if (s.t - (s.flags[key] as number) < 3 && s.t < t1) return false;
        // 조짐이 비친 뒤에는 사건이 조금 더 빨리 무르익는다
        return s.t >= t1 || chance(s, Math.min(0.5, r * 1.5));
      }
      return s.t >= t1 || chance(s, r);
    },
    run: (s) => {
      const nudge = Number(s.flags[`nudge_${id}`] ?? 0);
      if (s.t >= t1 && o.cancellable && nudge <= -2) {
        s.flags[`skip_${id}`] = true;
        log(s, `[조짐] ${o.label ?? '그 일'}의 기운이 끝내 가라앉았다. 조정을 달래는 말들이 쌓여 판이 뒤집히지 않았다.`, 'history');
        return;
      }
      o.run(s, s.t >= t1);
    },
  };
};

/** 조짐이 보이는 시간 창 사건들 (플레이어가 부추기거나 누를 수 있다) */
export interface OmenWindow {
  id: string;
  label: string;
  t1: number;
  warn?: FactionId[];
  cancellable: boolean;
}
export const WINDOWS: OmenWindow[] = [];

/** 지금 조짐이 보이는(아직 터지지 않은) 사건들 */
export function liveOmens(s: GameState): OmenWindow[] {
  return WINDOWS.filter((w) => typeof s.flags[`omen_${w.id}`] === 'number' && !s.flags[`h_${w.id}`] && s.t <= w.t1);
}

export function nudgeError(s: GameState, id: string): string | null {
  const p = P(s);
  if (!alive(p) || p.status === 'exiled') return '움직일 수 없다';
  if (!inCourt(p) || p.rank > 5) return '조정에 있는 5품 이상이어야 한다';
  if (s.player.ap < 1) return '행동력이 부족하다';
  const last = s.flags[`nudgeAt_${id}`];
  if (typeof last === 'number' && s.t - last < 6) return `${6 - (s.t - last)}달 뒤에 다시 움직일 수 있다`;
  return null;
}

/** 조짐을 부추기거나(dir 1) 누른다(dir -1) */
export function nudgeOmen(s: GameState, id: string, dir: 1 | -1): string {
  const w = WINDOWS.find((x) => x.id === id);
  if (!w) return '';
  const err = nudgeError(s, id);
  if (err) return err;
  const p = P(s);
  s.player.ap -= 1;
  s.flags[`nudgeAt_${id}`] = s.t;
  s.flags[`nudge_${id}`] = Number(s.flags[`nudge_${id}`] ?? 0) + dir;
  const mine = p.faction !== 'none' && !!w.warn?.includes(p.faction);
  if (dir > 0) {
    s.tension = clamp(s.tension + 2, 0, 100);
    if (p.faction !== 'none') {
      if (mine) swayFaction(s, p.faction, p.id, -6, '당을 위태롭게 함', 0.1);
      else swayFaction(s, p.faction, p.id, 3, '판을 흔듦', 0.1);
    }
    for (const f of w.warn ?? []) if (f !== p.faction && s.factions[f]?.active) swayFaction(s, f, p.id, -4, '우리를 노림', 0.1);
    return `${w.label}의 불씨에 바람을 넣었다. 상소와 사랑방의 말이 거세진다. (긴장 +2)`;
  }
  s.tension = clamp(s.tension - 1, 0, 100);
  pres(p, 1);
  fav(p, 1);
  for (const f of w.warn ?? []) if (s.factions[f]?.active) swayFaction(s, f, p.id, 3, '판을 지켜 줌', 0.1);
  return `${w.label}의 기운을 누르려 양쪽을 달래는 글을 올렸다.${w.cancellable ? ' 거듭 누르면 끝내 일어나지 않을 수도 있다.' : ' 늦출 수는 있어도 막을 수는 없는 흐름이다.'} (긴장 -1, 명망 +1, 성심 +1)`;
}
/** 환국의 조짐: 쫓겨날 당의 플레이어가 조정에 있으면 대비할 길을 고른다 */
function warnPlayer(s: GameState, text: string, fs: FactionId[]) {
  const p = P(s);
  if (!alive(p) || p.status !== 'active' || !p.office || !OFFICE_MAP[p.office] || !fs.includes(p.faction)) return;
  if (s.pending.length >= 3) return;
  pushEvent(s, 'later_omen_warn', { text, faction: p.faction });
}
const avgMinsim = (s: GameState) => {
  const rs = Object.values(s.regions);
  return rs.reduce((a, r) => a + r.minsim, 0) / rs.length;
};
const shareOf = (s: GameState, f: FactionId | 'seoRoot') => {
  const sh = powerShare(s);
  if (f === 'seoRoot') return (sh.seo ?? 0) + (sh.noron ?? 0) + (sh.soron ?? 0);
  return sh[f] ?? 0;
};
const seoLean = (s: GameState) => Math.max(s.king.lean.seo ?? -99, s.king.lean.noron ?? -99, s.king.lean.soron ?? -99);
const happened = (s: GameState, id: string) => !!s.flags[`h_${id}`] && !s.flags[`skip_${id}`];

export const LATER_SCHEDULE: Scheduled[] = [
  // 남북 분당이 끝나지 않았으면 마저 갈라선다
  { id: 'l_split_force', at: at(1601, 1), cond: (s) => s.factions.dong.active, run: (s) => splitDong(s) },
  { id: 'l_dongui', at: at(1610, 8), run: L('허준이 『동의보감』을 완성했다.') },
  { id: 'l_seonjo', at: at(1608, 2), run: (s) => crownAfterSeonjo(s) },
  { id: 'l_daedong_gg', at: at(1608, 5), run: L('이원익의 건의로 경기도에 선혜법(대동법)을 시험 삼아 시행했다.') },
  { id: 'l_giyu', at: at(1609, 6), run: L('일본과 기유약조를 맺어 국교를 다시 열었다.') },
  windowed('l_gyechuk', [1612, 6], [1614, 12], {
    label: '계축옥사',
    cancellable: true,
    omen: { text: () => '문경 새재에서 은상을 턴 강도들이 붙잡혔다. 서얼 출신 명문가 자제들이라 국문이 길어지고, 대북이 그 배후를 캐려 한다는 말이 돈다.' },
    pre: (s) => s.factions.buk.active && kingNameNow(s) !== '인조',
    // 대북이 조정을 쥘수록, 긴장이 높을수록 일찍 터진다
    ripe: (s) => 0.03 + (shareOf(s, 'buk') >= 0.35 ? 0.04 : 0) + s.tension / 2000,
    run(s) {
      log(s, '계축옥사: 서얼들의 은상 강도 사건이 영창대군 추대 역모로 번졌다. 대북이 소북과 서인을 몰아친다.', 'history');
      const pool = people(s).filter((c) => !isP(s, c) && (c.faction === 'seo' || c.faction === 'nam') && inCourt(c));
      const acc = pool.length ? pick(s, pool) : undefined;
      if (acc) startOksa(s, acc);
    },
  }),
  { id: 'l_pyemo', at: at(1617, 11), run: (s) => raiseAgenda(s, 'pyemo', {}) },
  { id: 'l_sarhu', at: at(1619, 3), run: Ldyn((s) => `사르후 전투: 명을 돕던 강홍립의 조선군이 후금에 항복했다. ${kingNameNow(s) === '인조' ? '강홍립이 형세를 보고 스스로 항복했다는 말이 돈다.' : `${kingNameNow(s)}의 밀지가 있었다는 말이 돈다.`}`) },
  { id: 'l_slot_decide', at: at(1623, 1), run: (s) => (s.flags.slotEnd = slotVerdict(s)) },
  {
    id: 'l_banjeong_invite',
    at: at(1623, 2),
    cond: (s) => {
      const p = P(s);
      return alive(p) && p.status !== 'exiled' && topOf(p.faction) === 'seo' && s.flags.slotEnd === 'coup';
    },
    run: (s) => pushEvent(s, 'later_banjeong_invite', {}),
  },
  { id: 'l_banjeong', at: at(1623, 3), run: (s) => slotEnd(s) },
  {
    id: 'l_igwal',
    at: at(1624, 1),
    cond: (s) => !!s.flags.banjeongDone,
    run(s) {
      rebellion(s, ['pyeongan', 'hwanghae', 'gyeonggi'], '반정공신 이괄의 난', 2);
      log(s, '이괄의 군사가 도성을 점령해 왕이 공주로 피란했다.', 'war');
      shakeLegit(s, -5, '반정공신이 난을 일으켜 도성을 내주었다');
      kingMood(s, -10);
    },
  },
  { id: 'l_jeongmyo', at: at(1627, 1), run: (s) => horan(s, 'jeongmyo') },
  { id: 'l_byeongja', at: at(1636, 12), run: (s) => horan(s, 'byeongja') },
  { id: 'l_sohyeon', at: at(1645, 4), run: Ldyn((s) => `${s.flags.samjeondo ? '볼모에서 돌아온 ' : ''}소현세자가 갑자기 세상을 떠났다. 독살이라는 소문이 돈다.`, (s) => (startGukbon(s, 'wonson'), shakeLegit(s, -3, '세자가 의문의 죽음을 맞았다'))) },
  { id: 'l_hyojong', at: at(1649, 5), run: (s) => (s.flags.wonsonKept ? crownAlt(s, '경선군', 'gyeongseon', s.t + randInt(s, 24, 72)) : crown(s, '효종', s.flags.samjeondo ? {} : { text: '봉림대군이 즉위했다(효종). 호란을 막아 낸 나라의 임금답게 굳센 기상으로 북방의 방비를 다진다.' })) },
  windowed('l_bukbeol', [1650, 1], [1656, 12], {
    label: '북벌 논의',
    cancellable: true,
    pre: (s) => kingNameNow(s) === '효종' && !!s.flags.samjeondo,
    // 정통성이 흔들릴수록 명분이 급하다
    ripe: (s) => 0.03 + (legitOf(s).score < 50 ? 0.05 : 0),
    omen: { text: () => '효종이 산림의 선비들을 불러들이고 어영청의 군사를 손수 살핀다. 「삼전도의 치욕을 씻어야 한다」는 말이 대궐에서 자주 들린다.' },
    run: (s) => raiseAgenda(s, 'bukbeol', {}),
  }),
  { id: 'l_bukbeol_none', at: at(1656, 12), cond: (s) => kingNameNow(s) === '효종' && !s.flags.samjeondo, run: L('삼전도의 치욕이 없었으니 효종이 북벌을 외칠 까닭도 약했다. 북방의 군비를 다듬는 데 그쳤다.') },
  { id: 'l_naseon', at: at(1658, 6), run: L('나선정벌: 청의 요청으로 조선 조총군이 흑룡강에서 러시아군을 무찔렀다.', (s) => kingMood(s, 5)) },
  { id: 'l_hyeonjong', at: at(1659, 5), run: (s) => crown(s, '현종') },
  { id: 'l_yesong1', at: at(1659, 7), run: (s) => raiseAgenda(s, 'yesong1', {}) },
  { id: 'l_famine', at: at(1670, 7), run: L('경신대기근: 가뭄과 냉해, 역병이 겹쳐 백성이 수없이 죽었다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 20, 0, 100);
    s.realm.treasury -= 120;
  }) },
  { id: 'l_yesong2', at: at(1674, 3), run: (s) => raiseAgenda(s, 'yesong2', {}) },
  { id: 'l_sukjong', at: at(1674, 9), run: (s) => crown(s, '숙종') },
  // 경신환국: 남인이 조정을 오래 쥐고 왕의 마음이 식을수록 일찍 터진다
  windowed('l_gyeongsin', [1678, 1], [1684, 12], {
    label: '경신환국',
    cancellable: true,
    warn: ['nam'],
    omen: { text: (s) => (figure(s, 'heo_jeok') ? `${josa(figure(s, 'heo_jeok')!.name, '이/가')} 집안 잔치에 궁중의 유악(油幄)을 허락 없이 가져다 썼다는 말에 왕의 낯빛이 굳었다. 남인의 독주를 못마땅해하는 기색이 역력하다.` : '남인 대신들이 군권까지 쥐려 한다는 말에 왕의 낯빛이 굳었다. 남인의 독주를 못마땅해하는 기색이 역력하다.') },
    pre: (s) => kingNameNow(s) === '숙종' && s.factions.nam.active,
    ripe: (s) => 0.012 + (shareOf(s, 'nam') >= 0.35 ? 0.03 : 0) + ((s.king.lean.nam ?? 0) < 0 ? 0.03 : 0) + s.tension / 3000,
    run(s, late) {
      if (late && shareOf(s, 'nam') < 0.2) {
        s.flags.skip_l_gyeongsin = true;
        log(s, '남인이 이미 힘을 잃어 숙종이 판을 뒤집을 까닭이 없었다. 경신년의 환국은 일어나지 않았다.', 'history');
        if (s.factions.seo.active) kingLean(s, 'seo', 5);
        return;
      }
      log(s, figure(s, 'heo_jeok') ? `경신환국: ${figure(s, 'heo_jeok')!.name}의 유악(油幄) 사건으로 왕이 남인을 내치고 서인을 불러들였다.` : '경신환국: 남인 대신들의 전횡을 문제 삼아 왕이 남인을 내치고 서인을 불러들였다.', 'history');
      hwangukTop(s, 'nam');
      kingLean(s, 'seo', 10);
      s.flags.gyeongsinAt = s.t;
    },
  }),
  // 서인의 분당: 남인을 얼마나 엄히 다스릴지를 두고 다투다 갈라선다. 긴장이 높고 서인이 조정을 쥘수록 빠르다
  windowed('l_seo_split', [1681, 1], [1688, 6], {
    label: '서인의 분당',
    omen: { text: (s) => `남인을 얼마나 엄히 다스릴지를 두고 서인의 노장과 소장이 얼굴을 붉히는 일이 잦다. ${figure(s, 'song_siyeol') && figure(s, 'yun_jeung') ? '송시열과 제자 윤증 사이에 오가는 편지에 금이 간다.' : '스승과 제자 사이에도 금이 간다.'}` },
    pre: (s) => s.factions.seo.active && !!s.flags.h_l_gyeongsin,
    ripe: (s) => 0.015 + (shareOf(s, 'seo') >= 0.5 ? 0.02 : 0) + s.tension / 2500,
    run: (s) => splitSeo(s),
  }),
  // 기사환국: 원자 정호를 두고 왕의 마음이 남인 쪽으로 기울수록 일찍 터진다
  windowed('l_gisa', [1688, 12], [1691, 12], {
    label: '기사환국',
    cancellable: true,
    warn: ['seo', 'noron', 'soron'],
    omen: { at: 0.05, text: () => '희빈 장씨의 아들을 원자로 정한 일을 두고 서인 원로들이 거듭 상소한다. 왕이 노기를 감추지 않는다.' },
    pre: (s) => kingNameNow(s) === '숙종' && shareOf(s, 'seoRoot') > 0,
    ripe: (s) => 0.03 + ((s.king.lean.nam ?? 0) - seoLean(s) > 10 ? 0.05 : 0) + (s.king.mood < 0 ? 0.02 : 0),
    run(s, late) {
      if (late && shareOf(s, 'seoRoot') < 0.25) {
        s.flags.skip_l_gisa = true;
        log(s, '서인이 이미 조정에서 밀려나 있어, 원자 정호를 두고 판이 뒤집히는 일은 없었다.', 'history');
        kingLean(s, 'nam', 10);
        return;
      }
      const ss = figure(s, 'song_siyeol');
      log(s, `기사환국: 희빈 장씨의 아들을 원자로 정하는 일에 반대한 서인이 쫓겨났다. 중전 민씨가 폐위되고 희빈 장씨가 왕비가 되었다.${ss && !isP(s, ss) ? ` ${josa(ss.name, '이/가')} 사사되었다.` : ''}`, 'history');
      hwangukTop(s, 'seo');
      if (ss && !isP(s, ss)) kill(s, ss, '사약을 받고 죽었다');
      kingLean(s, 'nam', 20);
    },
  }),
  // 갑술환국: 기사환국 뒤 남인의 독주에 왕이 싫증을 낼수록 일찍 터진다
  windowed('l_gapsul', [1693, 6], [1697, 12], {
    label: '갑술환국',
    cancellable: true,
    warn: ['nam'],
    omen: { text: () => '왕이 폐비 민씨를 내친 일을 뉘우친다는 말이 궁중에서 흘러나온다. 남인은 폐비 복위를 꾀하는 서인을 옥사로 엮으려 서두른다.' },
    pre: (s) => kingNameNow(s) === '숙종' && happened(s, 'l_gisa') && s.factions.nam.active,
    ripe: (s) => 0.015 + (shareOf(s, 'nam') >= 0.4 ? 0.04 : 0) + ((s.king.lean.nam ?? 0) < 0 ? 0.03 : 0) + s.tension / 3000,
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
  }),
  { id: 'l_mugo', at: at(1701, 10), run: L('무고의 옥: 희빈 장씨가 인현왕후를 저주했다는 죄로 사사되었다.', (s) => (s.tension = clamp(s.tension + 5, 0, 100))) },
  { id: 'l_daedong_all', at: at(1708, 1), run: (s) => (log(s, '황해도까지 대동법이 시행되어 대동법이 팔도로 확대되었다.', 'history'), setLaw(s, 'daedong', true)) },
  { id: 'l_gyeongjong', at: at(1720, 6), run: (s) => crown(s, '경종') },
  {
    id: 'l_sinim',
    at: at(1721, 12),
    run(s) {
      log(s, `${s.flags.sejeFailed ? '신축환국: 연잉군을 세제로 세우려다 뜻을 이루지 못한 노론 4대신이 조정에서 쫓겨났다.' : '신축환국: 연잉군을 세제로 세우고 대리청정까지 밀어붙인 노론 4대신이 「임금을 핍박했다」며 조정에서 쫓겨났다.'}${s.flags.dokdae ? ' 정유년 독대 때부터 쌓인 소론의 의심이 터졌다.' : ''} 소론이 조정을 쥔다.`, 'history');
      hwangukTop(s, 'noron');
      const pool = members(s, 'noron').filter((c) => !isP(s, c) && inCourt(c));
      const acc = pool.length ? pick(s, pool) : undefined;
      if (acc) {
        startOksa(s, acc);
        if (s.oksa) s.oksa.harsh = true;
      }
    },
  },
  { id: 'l_yeongjo', at: at(1724, 8), run: (s) => crownAfterGyeongjong(s) },
  { id: 'l_milpung_end', at: at(1728, 3), cond: (s) => s.flags.altKind === 'milpung', run: (s) => milpungEnd(s) },
  // 을사환국: 영조 즉위 뒤 소론이 조정을 쥐고 있을수록 일찍 터진다
  windowed('l_eulsa', [1724, 10], [1726, 12], {
    label: '을사환국',
    cancellable: true,
    warn: ['soron'],
    omen: { at: 0.05, text: () => '즉위한 영조가 경종 때 노론을 친 소론 강경파를 보는 눈길이 차갑다. 「신임년의 일을 바로잡아야 한다」는 노론의 상소가 잇따른다.' },
    pre: (s) => kingNameNow(s) === '영조' && s.factions.soron.active,
    ripe: (s) => 0.03 + (shareOf(s, 'soron') >= 0.4 ? 0.05 : 0),
    run: (s) => (log(s, '을사환국: 영조가 소론 강경파를 내치고 노론을 불러들였다.', 'history'), hwangukTop(s, 'soron'), (s.flags.eulsaAt = s.t)),
  }),
  {
    id: 'l_injwa',
    at: at(1728, 3),
    cond: (s) => !s.flags.sejeFailed,
    run(s) {
      rebellion(s, ['chungcheong', 'gyeongsang'], '소론 강경파와 남인이 일으킨 이인좌의 난', 2);
      kingLean(s, 'soron', -15);
      kingLean(s, 'nam', -10);
    },
  },
  // 탕평비: 붕당의 다툼이 거셀수록(긴장이 높을수록) 왕이 서둘러 세운다
  windowed('l_tangpyeongbi', [1740, 1], [1744, 12], {
    label: '탕평비',
    pre: (s) => kingNameNow(s) === '영조',
    ripe: (s) => 0.03 + (s.tension >= 50 ? 0.04 : 0) + (s.tension >= 70 ? 0.04 : 0),
    omen: { at: 0.03, text: () => '노론과 소론이 신임년의 의리를 두고 다시 상소를 주고받는다. 왕이 「이 싸움을 끝내야 한다」며 손수 글을 짓는다는 말이 돈다.' },
    run: Ldyn(
      (s) => `${s.flags.yeongjoCoup ? '정변으로 대통을 이은' : '무신년의 난을 겪은'} 영조가 붕당의 다툼이 역모와 정변으로까지 번지는 것을 막으려 성균관 앞에 탕평비를 세웠다. "두루 사귀되 편당 짓지 않는 것이 군자의 마음이다."`,
      (s) => {
        s.tension = clamp(s.tension - 10, 0, 100);
        shakeLegit(s, 3, '탕평의 대의를 내걸었다');
      },
    ),
  }),
  // 균역법: 군포 두 필을 견디지 못한 백성의 도망과 인징·족징이 쌓일수록 일찍 논의된다
  windowed('l_gyunyeok', [1749, 1], [1751, 6], {
    label: '균역 논의',
    pre: (s) => kingNameNow(s) === '영조' && !s.laws.gyunyeok?.on,
    ripe: (s) => 0.04 + (avgMinsim(s) < 60 ? 0.04 : 0) + (avgMinsim(s) < 50 ? 0.04 : 0),
    omenAtStart: true,
    omen: { text: () => '군포 두 필을 견디지 못한 양인들이 도망하자, 고을마다 이웃과 일가에게 대신 물리는 인징·족징이 극심하다. 「양역의 폐단을 고치지 않으면 나라가 무너진다」는 상소가 잇따른다.' },
    run: (s) => raiseAgenda(s, 'law_debate', { lawId: 'gyunyeok', abolish: false, by: figure(s, 'bak_munsu')?.id ?? '' }),
  }),
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
  { id: 'l_imo', at: at(1762, 6), run: (s) => (inCourt(P(s)) ? pushEvent(s, 'later_imo', {}) : log(s, '임오화변: 영조가 세자를 뒤주에 가두었다. 여드레 만에 세자가 죽었다(사도세자).', 'history')) },
  {
    id: 'l_sipa',
    at: at(1772, 6),
    run(s) {
      log(s, s.flags.sadoAlive ? '근신 중인 세자를 두고 조정이 갈렸다. 세자와 세손을 감싸는 시파와, 영조의 엄한 처분을 옳다는 벽파다.' : '사도세자의 죽음을 두고 조정이 갈렸다. 세자를 동정하는 시파와 영조의 처분을 옳다는 벽파다.', 'history');
      s.tension = clamp(s.tension + 6, 0, 100);
      const p = P(s);
      if (alive(p) && p.status !== 'exiled' && inCourt(p)) pushEvent(s, 'later_sipa', {});
    },
  },
  {
    id: 'l_jeongjo',
    at: at(1776, 3),
    run: (s) => {
      if (s.flags.sadoAlive) {
        crownAlt(s, '장조', 'jangjo', s.t + randInt(s, 6, 15));
        if (s.flags.imo === 'save' && alive(P(s))) {
          fav(P(s), 20);
          notice(s, '목숨의 은인', '임오년에 목숨을 구해 준 당신을 새 임금이 잊지 않았다. (성심 +20)', 'personal');
        }
        return;
      }
      crown(s, '정조');
      imoPayback(s);
      daeriPayback(s);
      sipaTurn(s, 'jeongjo');
    },
  },
  { id: 'l_gyujang', at: at(1776, 9), window: 24, cond: (s) => kingNameNow(s) === '정조', run: L('정조가 규장각을 세우고 젊은 문신들을 길렀다.') },
  { id: 'l_seoeol_gyujang', at: at(1779, 3), run: (s) => (log(s, '정조가 박제가·유득공 등 서얼 출신을 규장각 검서관으로 썼다.', 'history'), setLaw(s, 'seoeol', true)) },
  // 신해통공: 시전 상인의 금난전권에 도성의 물가가 치솟고 영세 상인의 원성이 높을수록 일찍 논의된다
  windowed('l_tongong', [1790, 6], [1791, 12], {
    label: '통공 논의',
    pre: (s) => kingNameNow(s) === '정조' && !s.laws.tongong?.on,
    ripe: (s) => 0.05 + (s.regions.hanseong.minsim < 60 ? 0.05 : 0),
    omenAtStart: true,
    omen: { text: () => '도성의 시전 상인들이 금난전권을 내세워 난전을 쳐내니 물가가 치솟는다. 행상과 영세 상인의 원성이 높다.' },
    run: (s) => raiseAgenda(s, 'law_debate', { lawId: 'tongong', abolish: false, by: figure(s, 'chae_jegong')?.id ?? '' }),
  }),
  {
    id: 'l_hwaseong',
    at: at(1796, 9),
    run: Ldyn((s) => (figure(s, 'jeong_yakyong') ? `수원 화성이 완공되었다. ${figure(s, 'jeong_yakyong')!.name}의 거중기가 공기를 크게 줄였다.` : '수원 화성이 완공되었다. 거중기 같은 새 기계가 공기를 크게 줄였다.'), (s) => {
      s.regions.gyeonggi.defense.fort = Math.min(5, s.regions.gyeonggi.defense.fort + 2);
      s.realm.treasury -= 100;
      const p = P(s);
      if (s.flags.hwaseongBy === p.id && alive(p)) {
        pres(p, 3);
        s.player.deeds.push(`${yearOf(s.t)} 화성 축성의 감동을 맡아 완공함`);
        notice(s, '화성 완공', '감동을 맡았던 화성이 완공되었다. 『화성성역의궤』에 당신의 이름이 오른다. (명망 +3)', 'personal');
      } else if (alive(p) && s.player.lineage.some((a) => a.id === s.flags.hwaseongBy)) {
        // 감동을 맡았던 선친이 완공을 보지 못하고 세상을 떠났다
        pres(p, 2);
        notice(s, '화성 완공', '선친이 감동을 맡았던 화성이 완공되었다. 『화성성역의궤』에 선친의 이름이 오르고, 사람들이 그 공을 당신에게서 기억한다. (명망 +2)', 'personal');
      }
    }),
  },
  {
    id: 'l_sunjo',
    at: at(1800, 7),
    run(s) {
      crown(s, '순조');
      s.flags.suryeomUntil = tOf(1804, 1);
      sipaTurn(s, 'regency');
      log(s, '[수렴청정] 어린 임금을 대신해 대왕대비 정순왕후가 발을 드리우고 정사를 듣는다. 대비를 따르는 벽파가 조정을 쥔다.', 'history');
      if (s.factions.noron.active) kingLean(s, 'noron', 8);
      if (s.factions.nam.active) kingLean(s, 'nam', -10);
    },
  },
  {
    id: 'l_chinjeong',
    at: at(1804, 1),
    run(s) {
      log(s, '[친정] 대왕대비가 발을 거두고 순조가 친정(親政)을 시작했다.', 'history');
      kingMood(s, 6);
      const p = P(s);
      if (alive(p) && inCourt(p)) notice(s, '친정(親政)', `대왕대비가 수렴을 거두었다. 이제 임금이 몸소 정사를 본다. 다만 임금의 장인 ${figure(s, 'kim_josun')?.name ?? '안동 김씨'}의 집안이 그 곁을 지킨다.`, 'history');
    },
  },
  {
    id: 'l_sinyu',
    at: at(1801, 2),
    run(s) {
      const jy = figure(s, 'jeong_yakyong');
      const exiled = !!jy && !isP(s, jy) && jy.status !== 'exiled';
      log(s, `신유박해: 정순왕후의 사학 금압령으로 천주교를 믿는다는 죄를 쓴 남인 시파가 대거 처벌되었다. 정조가 기른 남인의 맥이 끊긴다.${exiled ? ` ${josa(jy!.name, '이/가')} 강진으로 유배되었다.` : ''}`, 'history');
      if (exiled) exile(s, jy!);
      const pool = members(s, 'nam').filter((c) => !isP(s, c) && inCourt(c));
      const acc = pool.length ? pick(s, pool) : undefined;
      if (acc) {
        startOksa(s, acc);
        if (s.oksa) s.oksa.harsh = true;
      }
    },
  },
  { id: 'l_sedo', at: at(1802, 10), run: Ldyn((s) => `${figure(s, 'kim_josun') ? `${figure(s, 'kim_josun')!.name}의 딸` : '안동 김씨 집안의 딸'}이 왕비가 되었다. 안동 김씨의 세도가 시작된다.`, (s) => kingLean(s, 'noron', 15)) },
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
  { id: 'l_hoetoe', at: at(1611, 3), cond: (s) => !!figure(s, 'jeong_inhong'), run: L('회퇴변척: 정인홍이 이언적·이황의 문묘 종사를 깎아내리자 성균관 유생들이 그의 이름을 유적(儒籍)에서 지웠다.', (s) => (s.tension = clamp(s.tension + 4, 0, 100))) },
  { id: 'l_seogung', at: at(1618, 1), run: L('인목대비가 서궁에 유폐되었다. 폐모를 반대한 이항복이 북청으로 귀양 갔다.', (s) => kingMood(s, -5)) },
  { ...lawAt('gunyeong', 1624, 7, '이괄의 난을 겪은 뒤 도성을 지킬 어영청을 두었다. 금위영·총융청·수어청이 뒤따른다.'), cond: (s) => !s.laws.gunyeong?.on && !!s.flags.banjeongDone },
  { ...lawAt('gunyeong', 1624, 7, '후금의 위협에 대비해 도성을 지킬 어영청을 두었다. 금위영·총융청·수어청이 뒤따른다.'), id: 'l_law_gunyeong_alt', cond: (s) => !s.laws.gunyeong?.on && !s.flags.banjeongDone },
  lawAt('yeongjeong', 1635, 6, '왜란과 호란 뒤 묵은 땅이 늘어 세수가 줄자, 영정법으로 전세를 풍흉에 관계없이 토지 1결에 4두로 정했다.'),
  playerAt('later_gangbin', 1646, 3, (s) => inCourt(P(s)) && !!s.flags.wonsonAt, '소현세자빈 강씨가 왕을 저주했다는 죄로 사사되었다.'),
  { id: 'l_hamel', at: at(1653, 8), run: L('제주에 표류한 네덜란드 사람 하멜 일행을 붙잡아 도성으로 올려 보냈다.') },
  { id: 'l_naseon1', at: at(1654, 4), run: L('1차 나선정벌: 변급이 이끈 조총군이 흑룡강에서 러시아군을 물리쳤다.', (s) => kingMood(s, 3)) },
  lawAt('ogajak', 1675, 9, '남인 정권이 오가작통법을 다시 엄히 시행했다.'),
  debateAt('hopo', 1677, 3, 'yun_hyu'),
  lawAt('sangpyeong', 1678, 1, '대동법으로 쌀과 베의 유통이 늘고 장시가 커지자, 상평통보를 찍어 온 나라에 쓰게 했다.'),
  { id: 'l_gumwi', at: at(1682, 3), run: L('금위영을 두어 오군영 체제가 갖추어졌다. 군영 대장 자리를 두고 당들의 다툼이 치열하다.') },
  { id: 'l_wonja', at: at(1688, 11), run: (s) => startGukbon(s, 'wonja', '희빈 장씨가 왕자를 낳자') },
  playerAt('later_ulleung', 1693, 6, (s) => inCourt(P(s)) && P(s).rank <= 5, '안용복이 일본에 건너가 울릉도와 독도가 조선 땅임을 따졌다.'),
  { id: 'l_baekdu', at: at(1712, 5), run: L('청과의 경계를 정하는 백두산정계비를 세웠다.') },
  debateAt('seowon', 1714, 6),
  { id: 'l_seje', at: at(1721, 8), run: (s) => startGukbon(s, 'seje', '왕이 병약하고 후사가 없자') },
  { id: 'l_apseul', at: at(1725, 10), window: 48, cond: (s) => kingNameNow(s) === '영조', run: L('영조가 무릎을 짓누르는 압슬형을 없앴다.', (s) => {
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
  { id: 'l_daeri_seson', at: at(1775, 11), cond: (s) => !s.flags.sadoAlive, run: (s) => startGukbon(s, 'daeri_seson', '여든을 넘긴 왕이 기력이 쇠하자') },
  { id: 'l_seungheon', at: at(1784, 3), run: L('이승훈이 북경에서 세례를 받고 돌아왔다. 남인 소장파 사이에 서학이 번진다.') },
  playerAt('later_jinsan', 1791, 11, (s) => inCourt(P(s)) && (P(s).faction === 'nam' || P(s).rank <= 3), '진산 사건: 윤지충이 어머니의 신주를 불사른 일로 처형되었다. 남인이 신서파와 공서파로 갈린다.'),
  { id: 'l_wonhaeng_legit', at: at(1795, 2), cond: (s) => kingNameNow(s) === '정조', run: (s) => shakeLegit(s, 5, s.flags.sadoAlive ? '아버지 장조의 능을 찾고 어머니의 회갑을 치러 효의 명분을 세웠다' : '사도세자의 원소를 화성으로 옮기고 어머니의 회갑을 치러 효의 명분을 세웠다') },
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
  { id: 'l_jeongsun', at: at(1805, 1), run: L('정순왕후가 세상을 떠났다. 벽파가 무너지고 안동 김씨의 시파가 조정을 쥔다.', (s) => ((s.tension = clamp(s.tension - 3, 0, 100)), sipaTurn(s, 'fall'))) },
  { id: 'l_gisa_famine', at: at(1809, 8), run: L('기사년 대기근: 팔도에 흉년이 들어 굶주린 백성이 길을 메웠다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 12, 0, 100);
    s.realm.treasury -= 60;
  }) },
  { id: 'l_gapsul_famine', at: at(1814, 8), run: L('갑술년에 다시 큰 흉년이 들었다. 삼정의 문란이 깊어 간다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 8, 0, 100);
  }) },
);

/* ───────── 역사의 세자 책봉: 국본이 일찍 선 왕대에는 책봉 논의가 일지 않는다 ───────── */

const heirAt = (y: number, m: number, name: string, cond?: (s: GameState) => boolean): Scheduled => ({
  id: `l_heir_${y}`,
  at: at(y, m),
  cond,
  run(s) {
    const k = heirKey(s);
    if (typeof s.flags[k] === 'number') return;
    s.flags[k] = s.t;
    log(s, `[국본] ${josa(name, '이/가')} 세자로 책봉되었다.`, 'history');
  },
});

LATER_SCHEDULE.push(
  heirAt(1608, 10, '왕자 이지', (s) => kingId(s) === 'gwanghae'),
  heirAt(1625, 1, '소현세자'),
  { ...heirAt(1649, 8, '현종', (s) => kingNameNow(s) === '효종'), window: 96 },
  heirAt(1667, 1, '숙종'),
  heirAt(1690, 6, '희빈 장씨의 아들(경종)'),
  { ...heirAt(1725, 3, '효장세자', (s) => kingNameNow(s) === '영조'), window: 48 },
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

/* ───────── 법전과 역법, 대기근, 문체반정 ───────── */
LATER_SCHEDULE.push(
  { id: 'l_siheon', at: at(1653, 1), run: L('서양 역법을 받아들인 시헌력(時憲曆)을 쓰기 시작했다.') },
  { id: 'l_eulbyeong', at: at(1695, 8), run: L('을병대기근: 해마다 흉년과 역병이 겹쳐 여러 해 동안 백성이 수없이 죽었다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim - 15, 0, 100);
    s.realm.treasury -= 80;
  }) },
  { id: 'l_soktaejeon', at: at(1746, 4), run: L('『경국대전』 이후의 법령을 모아 『속대전(續大典)』을 펴냈다.', (s) => (s.tension = clamp(s.tension - 3, 0, 100))) },
  { id: 'l_cheonui_legit', at: at(1755, 11), cond: (s) => kingNameNow(s) === '영조', run: (s) => shakeLegit(s, 8, '『천의소감』으로 즉위의 의리를 밝혔다') },
  { id: 'l_cheonui', at: at(1755, 11), run: L('영조가 신임옥사의 시비를 가린 『천의소감(闡義昭鑑)』을 펴내 노론의 의리를 인정했다.', (s) => {
    if (s.factions.noron.active) kingLean(s, 'noron', 5);
    if (s.factions.soron.active) kingLean(s, 'soron', -5);
  }) },
  { id: 'l_daejeon', at: at(1785, 9), run: L('『경국대전』과 『속대전』을 하나로 묶은 『대전통편(大典通編)』을 펴냈다.') },
  playerAt('later_munche', 1792, 10, (s) => inCourt(P(s)) && P(s).rank >= 3, '문체반정: 정조가 패관소품의 가벼운 문체를 금하고 순정한 고문(古文)으로 돌아가라 명했다.'),
);

/* ───────── 세도: 김조순의 비변사, 세도가의 인사 청탁 ───────── */
LATER_SCHEDULE.push({
  id: 'l_josun_bb',
  at: at(1802, 12),
  run(s) {
    const kj = figure(s, 'kim_josun');
    if (!kj) return;
    const k = (s.kyeom ??= {});
    const prev = k.bibyeon_je7 ? s.chars[k.bibyeon_je7.who] : undefined;
    k.bibyeon_je7 = { who: kj.id, since: s.t };
    s.flags.kyeomLife_bibyeon_je7 = kj.id;
    log(s, `[세도] 국구 ${josa(kj.name, '이/가')} 벼슬 없이도 비변사 제조를 겸해 국정을 쥔다. 그는 죽을 때까지 이 자리를 내놓지 않을 것이다.`, 'history');
    if (prev && isP(s, prev)) notice(s, '비변사에서 밀려남', `${josa(kj.name, '이/가')} 당신이 겸하던 비변사 제조 자리를 차지했다.`, 'danger');
  },
});

/** 세도기에 인사를 맡은 플레이어에게 세도가의 청탁이 들어온다 */
function rollSedoAsk(s: GameState) {
  if (yearOf(s.t) < 1803 || s.flags.kingStyle !== 'sedo') return;
  const p = P(s);
  if (!alive(p) || p.status !== 'active' || !['ijo', 'champan_ijo', 'jeonrang'].includes(p.office ?? '')) return;
  if (s.pending.length >= 2 || s.t - Number(s.flags.sedoAskAt ?? -999) < 18 || !chance(s, 0.06)) return;
  const pool = people(s).filter((c) => !isP(s, c) && inCourt(c) && c.faction === 'noron' && c.rank >= 3);
  if (!pool.length) return;
  const cand = pool.find((c) => c.clan.startsWith('안동 김')) ?? pick(s, pool);
  s.flags.sedoAskAt = s.t;
  pushEvent(s, 'later_sedo_ask', { who: cand.id });
}

/* ───────── 삼정의 문란: 관찰사에게 닥치는 환곡의 일 ───────── */
function rollHwangok(s: GameState) {
  if (s.flags.kingStyle !== 'sedo') return;
  const p = P(s);
  if (!alive(p) || p.status !== 'active' || !p.office?.startsWith('gamsa_')) return;
  if (s.pending.length >= 2 || s.t - Number(s.flags.hwangokAt ?? -999) < 12 || !chance(s, 0.08)) return;
  s.flags.hwangokAt = s.t;
  pushEvent(s, 'later_hwangok', { region: p.office.slice(6) });
}

/* ───────── 암행어사: 당하관이 왕명을 받아 몰래 고을을 살핀다 ───────── */
function rollAmhaeng(s: GameState) {
  if (yearOf(s.t) < 1700) return;
  const p = P(s);
  if (!alive(p) || p.status !== 'active' || p.rank < 4 || p.rank > 7 || s.player.abroadUntil > s.t) return;
  if (s.pending.length >= 2 || s.t - Number(s.flags.amhaengAt ?? -999) < 36 || !chance(s, 0.02)) return;
  s.flags.amhaengAt = s.t;
  const worst = Object.values(s.regions).filter((r) => r.id !== 'hanseong').sort((a, b) => a.minsim - b.minsim)[0];
  pushEvent(s, 'later_amhaeng', { region: worst.id });
}

/* ───────── 시파와 벽파: 한 번 선 자리가 세 번의 고비마다 따라온다 ───────── */
function sipaTurn(s: GameState, when: 'jeongjo' | 'regency' | 'fall') {
  const side = s.flags.sipa;
  const p = P(s);
  if ((side !== 'si' && side !== 'byeok') || !alive(p)) return;
  if (when === 'jeongjo') {
    if (side === 'si') {
      fav(p, 8);
      notice(s, '시파의 날', `정조가 즉위했다. ${s.flags.sadoAlive ? '세자와 세손을 감싸던' : '사도세자를 동정하던'} 시파인 당신을 새 임금이 가까이한다. (성심 +8)`, 'personal');
    } else {
      fav(p, -8);
      notice(s, '벽파의 겨울', '정조가 즉위했다. 영조의 처분을 옳다 하던 벽파인 당신을 새 임금이 멀리한다. (성심 -8)', 'danger');
    }
    return;
  }
  if (when === 'regency') {
    if (side === 'byeok') {
      fav(p, 8);
      notice(s, '벽파의 날', '정순왕후가 수렴청정을 시작했다. 대비는 벽파를 감싼다. (성심 +8)', 'personal');
    } else {
      fav(p, -8);
      notice(s, '시파의 겨울', '정순왕후가 수렴청정을 시작했다. 대비는 시파를 미워한다. (성심 -8)', 'danger');
    }
    return;
  }
  if (side === 'byeok') {
    fav(p, -10);
    if (p.status === 'active' && p.office && chance(s, 0.3)) {
      vacate(s, p);
      notice(s, '벽파의 몰락', '정순왕후가 세상을 떠나자 벽파가 줄줄이 쫓겨났다. 당신도 자리에서 밀려났다. (성심 -10)', 'danger');
    } else notice(s, '벽파의 몰락', '정순왕후가 세상을 떠나자 벽파가 줄줄이 쫓겨났다. 당신은 가까스로 자리를 지켰다. (성심 -10)', 'danger');
  } else {
    fav(p, 5);
    notice(s, '시파의 세상', '정순왕후가 세상을 떠나고 벽파가 무너졌다. 시파가 조정을 쥔다. (성심 +5)', 'personal');
  }
}

/* ───────── 북학(北學): 청의 문물을 배우자는 젊은 학자들 ───────── */
LATER_SCHEDULE.push(playerAt('later_bukhak', 1778, 9, (s) => inCourt(P(s)) && P(s).learning >= 5, '박제가가 연행에서 돌아와 『북학의』를 지었다. 청의 수레와 벽돌, 상업을 배우자는 북학론이 젊은 학자들 사이에 번진다.'));

/* ───────── 병자호란에 진 뒤: 삼학사, 환향녀, 김상헌 압송 ───────── */
const lostByeongja = (s: GameState) => s.flags.byeongjaHeld === false;
LATER_SCHEDULE.push(
  { id: 'l_sokhwan', at: at(1637, 6), cond: lostByeongja, run: horanAfter },
  { id: 'l_samhaksa', at: at(1637, 4), cond: lostByeongja, run: L('척화를 끝까지 주장한 홍익한·윤집·오달제가 심양으로 끌려가 죽었다. 사람들이 그들을 삼학사(三學士)라 부르며 기린다.', (s) => (s.tension = clamp(s.tension + 3, 0, 100))) },
  playerAt('later_hwanghyang', 1638, 3, (s) => lostByeongja(s) && inCourt(P(s)), '청에 끌려갔다 돌아온 부녀자들의 이혼 문제로 조정이 시끄러웠다. 왕은 이혼을 허락하지 않았다.'),
  { id: 'l_sangheon', at: at(1640, 11), cond: lostByeongja, run: (s) => {
    const kim = figure(s, 'kim_sangheon');
    log(s, kim ? `척화의 상징 ${josa(kim.name, '이/가')} 청의 요구로 심양에 끌려갔다. 그는 끝내 무릎을 꿇지 않았다.` : '청이 척화를 주장하던 대신들을 심양으로 끌고 갔다.', 'history');
    if (kim && !isP(s, kim) && kim.status === 'active') vacate(s, kim, 'retired');
    if (kim) pres(kim, 10);
  } },
);

/* ───────── 홍경래의 난: 대응을 고르고 정주성 함락으로 매듭짓는다 ───────── */
LATER_SCHEDULE.push(
  {
    ...playerAt('later_hong', 1812, 1, (s) => inCourt(P(s)) && P(s).rank <= 5, '홍경래의 군사가 정주성에 들어가 버틴다. 조정은 진압과 회유를 두고 갈렸다.'),
    // 관군이 곧바로 진압해 이미 끝났거나 이번 달에 끝나면 일어나지 않는다
    cond: (s) => s.war.active && s.war.zones.includes('pyeongan') && Number(s.flags.horanEnd ?? 0) > s.t,
  },
  {
    id: 'l_jeongju',
    at: at(1812, 4),
    // 관군이 곧바로 진압해 이미 끝났으면 일어나지 않는다
    cond: (s) => s.war.active && s.war.zones.includes('pyeongan'),
    run(s) {
      log(s, '관군이 정주성 밑으로 땅굴을 파고 화약을 터뜨려 성벽을 무너뜨렸다. 홍경래가 죽고 넉 달 만에 난이 끝났다.', 'war');
      if (s.war.active && s.war.zones.includes('pyeongan')) {
        s.war.active = false;
        s.war.zones = [];
        delete s.flags.horanEnd;
      }
      const pg = s.regions.pyeongan;
      pg.minsim = clamp(pg.minsim + (s.flags.hongAppease ? 8 : -4), 0, 100);
    },
  },
);

/* ───────── 이인좌의 난(무신란): 조정에 있으면 대응을 고른다 ───────── */
LATER_SCHEDULE.push({
  ...playerAt('later_injwa', 1728, 3, (s) => inCourt(P(s)) && P(s).rank <= 6),
  cond: (s) => s.war.active && s.war.zones.includes('chungcheong'),
});

/** 인조가 즉위한 뒤: 반정에 가담했는지, 빠졌는지, 고변했는지가 돌아온다 */
function banjeongReward(s: GameState) {
  const p = P(s);
  const v = s.flags.banjeongSide;
  if (!alive(p) || !v) return;
  if (v === 'join') {
    fav(p, 15);
    pres(p, 5);
    s.player.land += 3;
    s.player.deeds.push(`${yearOf(s.t)} 정사공신(靖社功臣) 녹훈`);
    log(s, `${josa(p.name, '이/가')} 반정에 가담한 공으로 정사공신에 녹훈되었다.`, 'player');
    notice(s, '정사공신', '반정이 성공했다. 거사에 함께한 당신은 정사공신에 녹훈되었다. (성심 +15, 명망 +5, 공신전 3결)', 'personal');
  } else if (v === 'refuse') {
    fav(p, -5);
    notice(s, '반정 뒤', '반정이 성공했다. 거사에서 빠졌던 당신을 새 임금과 공신들은 미덥지 않게 본다. 그래도 옛 임금을 저버리지 않았다는 말은 남았다. (성심 -5)', 'court');
  } else if (v === 'report') {
    fav(p, -20);
    if (p.faction !== 'none') swayFaction(s, p.faction, p.id, -20, '반정을 고변함', 0.03);
    if (p.status !== 'exiled' && chance(s, 0.5)) {
      exile(s, p);
      notice(s, '반정 뒤', '고변에도 반정은 성공했다. 거사를 밀고한 당신은 공신들의 손에 귀양을 갔다. (성심 -20)', 'danger');
    } else notice(s, '반정 뒤', '고변에도 반정은 성공했다. 거사를 밀고한 당신을 새 조정이 원수처럼 본다. (성심 -20)', 'danger');
  }
}

/* ───────── 숙종·영조·정조 대의 고비들 ───────── */
LATER_SCHEDULE.push(
  { id: 'l_daebodan', at: at(1704, 12), run: L('숙종이 창덕궁 후원에 대보단을 쌓아 임진년에 군사를 보낸 명 신종을 제사했다. 명이 망한 지 60년, 「조선이 중화를 잇는다」는 의리가 나라의 명분이 된다.', (s) => {
    if (s.factions.noron.active) kingLean(s, 'noron', 3);
  }) },
  { id: 'l_sado_daeri', at: at(1749, 1), run: L('영조가 열다섯 살 세자에게 대리청정을 맡겼다. 노론은 세자의 처결 하나하나를 영조에게 고해바치고, 부자 사이가 조금씩 벌어진다.', (s) => {
    s.tension = clamp(s.tension + 3, 0, 100);
  }) },
  { id: 'l_jeongyu', at: at(1777, 8), run: L('정유역변: 자객이 경희궁 존현각 지붕에 숨어들어 정조를 노렸다가 붙잡혔다. 배후로 홍상범 일가가 드러나 옥사가 일었다. 정조는 대궐을 지킬 숙위소를 두기로 한다.', (s) => {
    s.tension = clamp(s.tension + 5, 0, 100);
  }) },
);

/* ───────── 정조 초 홍국영의 권세와 몰락 ───────── */
LATER_SCHEDULE.push(
  {
    id: 'l_hgy_rise',
    at: at(1777, 11),
    cond: (s) => !!figure(s, 'hong_gugyeong'),
    run(s) {
      const h = figure(s, 'hong_gugyeong')!;
      log(s, `${josa(h.name, '이/가')} 숙위대장으로 대궐을 지키며 도승지를 겸해 왕명의 출납을 쥐었다. 대신들도 그의 집 앞에서 줄을 선다.`, 'history');
      h.favor = Math.max(h.favor, 80);
      h.prestige = Math.max(h.prestige, 50);
      h.rank = Math.min(h.rank, 3);
      if (!h.tags.includes('kingsman')) h.tags.push('kingsman');
    },
  },
  {
    id: 'l_hgy_fall',
    at: at(1779, 9),
    cond: (s) => !!figure(s, 'hong_gugyeong'),
    run(s) {
      const h = figure(s, 'hong_gugyeong')!;
      log(s, `누이 원빈이 죽은 뒤 후사를 엿보던 ${josa(h.name, '이/가')} 왕의 신임을 잃고 조정에서 물러났다. 세도는 3년을 넘기지 못했다.`, 'history');
      if (h.office) vacate(s, h, 'retired');
      // 방귀전리(放歸田里)되었다가 이태 뒤 강릉에서 죽었다
      exile(s, h, undefined, true);
      h.destiny = Math.min(h.destiny, 1781);
      h.favor = -40;
      h.tags = h.tags.filter((t) => t !== 'kingsman');
      const p = P(s);
      // 그에게 줄을 댔던 이들도 눈 밖에 난다
      if (alive(p) && p.tags.includes('inlawLink')) {
        fav(p, -6);
        notice(s, '홍국영의 몰락', '줄을 댔던 홍국영이 쫓겨났다. 당신도 왕의 눈 밖에 났다. (성심 -6)', 'danger');
      }
    },
  },
);

/* ───────── 병신처분(1716)과 정미환국(1727) ───────── */
LATER_SCHEDULE.push(
  {
    id: 'l_byeongsin',
    at: at(1716, 7),
    cond: (s) => s.factions.noron.active && s.factions.soron.active,
    run(s) {
      log(s, '병신처분: 숙종이 송시열과 윤증 사이의 회니시비(懷尼是非)를 가려 송시열의 손을 들었다. 윤증이 스승을 배반했다는 노론의 말이 옳다 하니 소론이 크게 꺾였다.', 'history');
      kingLean(s, 'noron', 10);
      kingLean(s, 'soron', -10);
      s.tension = clamp(s.tension + 4, 0, 100);
      const p = P(s);
      if (alive(p) && p.status !== 'exiled' && inCourt(p) && (p.faction === 'noron' || p.faction === 'soron')) pushEvent(s, 'later_byeongsin', {});
    },
  },
  // 정미환국: 을사환국 뒤 노론의 보복이 거셀수록(노론이 조정을 쥘수록) 일찍 터진다. 무신년(1728) 봄 전에 끝난다
  windowed('l_jeongmi', [1726, 6], [1728, 1], {
    label: '정미환국',
    cancellable: true,
    warn: ['noron'],
    omen: { text: () => '다시 조정을 쥔 노론이 신임옥사의 보복을 그치지 않는다. 탕평을 내세운 왕이 혀를 찬다.' },
    pre: (s) => s.factions.noron.active && s.factions.soron.active && kingNameNow(s) === '영조' && typeof s.flags.eulsaAt === 'number' && s.t - (s.flags.eulsaAt as number) >= 8,
    ripe: (s) => 0.03 + (shareOf(s, 'noron') >= 0.5 ? 0.06 : 0) + s.tension / 2500,
    run(s) {
      log(s, '정미환국: 노론 강경파가 소론에 대한 보복을 멈추지 않자, 영조가 그들을 내치고 소론 온건파를 불러들였다.', 'history');
      hwangukTop(s, 'noron');
      kingLean(s, 'soron', 8);
    },
  }),
);

/* ───────── 큰 사건 앞의 조짐: 계기와 까닭이 쌓여 터진다 ───────── */
const omenAt = (id: string, y: number, m: number, text: string | ((s: GameState) => string), cond?: (s: GameState) => boolean, fx?: (s: GameState) => void): Scheduled => ({
  id,
  at: at(y, m),
  cond,
  run: (s) => {
    log(s, `[조짐] ${typeof text === 'string' ? text : text(s)}`, 'history');
    fx?.(s);
  },
});
LATER_SCHEDULE.push(
  omenAt('o_famine1670', 1670, 4, '봄 가뭄이 길고 여름 들머리에 서리가 내렸다는 장계가 팔도에서 올라온다. 소에 돌림병이 돈다는 말도 들린다.'),
  omenAt('o_famine1695', 1695, 5, '두 해째 흉년이 들어 고을마다 환곡을 갚지 못한 백성이 떠돈다. 올여름에도 비가 오지 않는다.'),
  omenAt('o_famine1809', 1809, 5, '가뭄이 길어 모내기를 하지 못한 논이 많다. 환곡의 폐단에 지친 백성이 고향을 버린다는 장계가 잇따른다.'),
  omenAt('o_jang', 1686, 12, '역관 집안 출신 궁녀 장씨가 숙원(淑媛)에 봉해졌다. 왕의 총애가 깊다. 서인은 그 뒤에 남인과 역관들이 있다며 경계한다.', (s) => kingNameNow(s) === '숙종'),
  omenAt('o_mugo', 1701, 8, (s) => `인현왕후가 병으로 세상을 떠났다. ${happened(s, 'l_gapsul') ? '빈으로 내려앉은 ' : ''}희빈 장씨의 처소 서쪽에 신당을 차려 왕비를 저주했다는 말이 궁중에 돈다.`, (s) => kingNameNow(s) === '숙종'),
  { id: 'l_yangjehae', at: at(1813, 11), run: L('제주의 양제해가 수령과 토호의 수탈에 맞서 무리를 모아 관아를 치려다 발각되어 처형되었다. 바다 건너 고을까지 삼정의 문란이 깊다.', (s) => (s.regions.jeolla.minsim = clamp(s.regions.jeolla.minsim - 3, 0, 100))) },
  omenAt('o_dokdae', 1717, 7, '정유독대: 병석의 숙종이 사관도 물린 채 노론 영수 이이명을 홀로 불러 만났다. 곧이어 세자에게 대리청정을 명하자, 소론은 「세자의 허물을 잡아 연잉군으로 갈려는 노론의 계책」이라며 들끓는다.', (s) => kingNameNow(s) === '숙종' && s.factions.noron.active && s.factions.soron.active, (s) => {
    s.tension = clamp(s.tension + 5, 0, 100);
    s.flags.dokdae = true;
  }),
  omenAt('o_ohoe', 1800, 5, '오회연교(五晦筵敎): 정조가 오월 그믐의 경연에서 「지난 일의 의리를 바로 세우고, 따르지 않는 자는 용서하지 않겠다」고 하교했다. 벽파가 크게 긴장한다.', (s) => kingNameNow(s) === '정조', (s) => (s.tension = clamp(s.tension + 4, 0, 100))),
  { id: 'l_jeongjo_poison', at: at(1800, 9), cond: (s) => kingNameNow(s) === '순조' && !!s.flags.h_o_ohoe, run: L('오회연교 한 달 만에 정조가 종기를 앓다 갑자기 승하하자, 「벽파가 독을 썼다」는 말이 영남과 남인 사이에 퍼진다.', (s) => (s.tension = clamp(s.tension + 3, 0, 100))) },
  omenAt('o_jajeom', 1650, 3, (s) => `반정공신 김자점이 밀려나자, 그가 효종의 ${s.flags.samjeondo ? '북벌 계획' : '군비 확충'}과 송시열 등 산림의 등용을 청나라에 밀고했다는 말이 돈다. 청의 사신이 와서 조정을 캐묻는다.`, (s) => kingNameNow(s) === '효종', (s) => (s.tension = clamp(s.tension + 3, 0, 100))),
  { id: 'l_jajeom', at: at(1651, 12), cond: (s) => !!s.flags.h_o_jajeom, run: L('김자점의 옥: 김자점의 아들이 역모를 꾸민 것이 드러나 김자점이 처형되었다. 반정공신의 세력이 무너지고, 산림이 조정의 중심에 선다.', (s) => {
    s.tension = clamp(s.tension + 3, 0, 100);
    for (const f of ['seo', 'noron', 'soron'] as FactionId[]) if (s.factions[f].active) kingLean(s, f, 3);
  }) },
  { id: 'l_yeongnam_so', at: at(1666, 3), cond: (s) => kingNameNow(s) === '현종' && s.factions.nam.active, run: Ldyn((s) => `기해년 예송의 시비를 두고 영남 유생 천여 명이 연명 상소를 올려 ${figure(s, 'song_siyeol') ? `${figure(s, 'song_siyeol')!.name}의` : '서인의'} 예론을 공박했다. 선비들의 다툼이 조정 밖으로 번진다.`, (s) => (s.tension = clamp(s.tension + 3, 0, 100))) },
  { id: 'l_yuhyorip', at: at(1628, 1), cond: (s) => kingNameNow(s) === '인조' && !!s.flags.banjeongDone, run: Ldyn((s) => `유효립의 옥: 쫓겨난 ${String(s.flags.deposed ?? '광해군')}을 상왕으로 받들고 인성군을 세우려던 유효립의 역모가 드러나 무리가 처형되었다. ${s.flags.jeongmyoHeld === false ? '정묘년의 난리 끝에 민심이 흉흉하다.' : '정묘년 오랑캐를 막아 낸 뒤라 조정은 서둘러 무리를 다스렸다.'}`, (s) => {
    s.tension = clamp(s.tension + 3, 0, 100);
    shakeLegit(s, -2, '폐주를 다시 세우려는 역모가 일었다');
  }) },
  { id: 'l_imin', at: at(1722, 3), cond: (s) => kingNameNow(s) === '경종' && !!s.flags.h_l_sinim, run: L('임인옥사: 목호룡이 「노론이 임금을 시해하려 했다」고 고변했다. 노론 4대신이 사사되고 수십 명이 죽거나 귀양을 갔다. 신축년(1721)에 시작된 옥사가 임인년에 이르러 피바람이 되었다(신임옥사).', (s) => {
    s.tension = clamp(s.tension + 5, 0, 100);
    if (s.factions.noron.active) kingLean(s, 'noron', -8);
    const cj = figure(s, 'kim_changjip');
    if (cj && !isP(s, cj)) kill(s, cj, '임인옥사로 사사되었다');
  }) },
  { id: 'l_gapsin', at: at(1764, 2), cond: (s) => kingNameNow(s) === '영조' && !s.flags.sadoAlive, run: L('갑신처분: 영조가 세손을 일찍 죽은 효장세자의 후사로 입적시켰다. 「죄인의 아들」이라는 굴레를 덜어 주려는 뜻이지만, 세손에게는 아버지를 아버지라 부르지 못하는 한이 남는다.', (s) => {
    s.flags.gapsin = true;
  }) },
  { id: 'l_byeongin', at: at(1806, 2), cond: (s) => kingNameNow(s) === '순조' && !!s.flags.h_l_jeongsun, run: Ldyn((s) => `병인경화(丙寅更化): 정순왕후가 세상을 떠나자 ${figure(s, 'kim_josun') ? `${figure(s, 'kim_josun')!.name}을 중심으로 한 ` : ''}안동 김씨가 벽파의 김달순 등을 몰아냈다. 시파의 세도가 굳어지고, 이제 조정의 큰일은 외척의 사랑방에서 정해진다.`, (s) => {
    s.tension = clamp(s.tension - 3, 0, 100);
    bibyeonJump(s, 4, '세도가 비변사를 쥐었다.');
  }) },
  { id: 'l_hyeonryung', at: at(1789, 10), cond: (s) => kingNameNow(s) === '정조' && !s.flags.sadoAlive, run: L('현륭원 천봉: 정조가 양주 배봉산의 초라한 사도세자 묘를 수원 화산으로 옮기고 현륭원이라 불렀다. 원래 수원 읍치는 팔달산 아래로 옮긴다. 새 고을에 성을 쌓으려는 뜻이 보인다.', (s) => shakeLegit(s, 2, '선친의 묘를 높여 효의 명분을 세웠다')) },
  { id: 'l_imsul', at: at(1679, 1), window: 120, cond: (s) => kingNameNow(s) === '숙종' && typeof s.flags.gyeongsinAt === 'number' && s.t - (s.flags.gyeongsinAt as number) >= 12 && s.factions.seo.active && chance(s, 0.15), run: Ldyn((s) => `임술삼고변: ${josa(figure(s, 'kim_seokju') ? `외척 ${figure(s, 'kim_seokju')!.name}` : '외척 세력', '과/와')} 김익훈이 사람을 풀어 남인 잔당의 역모를 꾸며 고변했다. 서인의 젊은 관원들은 「공작으로 사람을 죽인다」며 들고일어나고, 원로들은 「역적을 다스린 것」이라 감싼다. 서인 안의 골이 깊어진다.`, (s) => (s.tension = clamp(s.tension + 6, 0, 100))) },
  { id: 'l_jahyul', at: at(1783, 11), cond: (s) => kingNameNow(s) === '정조', run: L('자휼전칙(字恤典則): 흉년에 길가에 버려진 아이들을 보다 못한 정조가, 고을마다 버려진 아이를 거두어 먹이고 입히게 하는 법을 반포했다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim + 2, 0, 100);
    s.realm.treasury -= 10;
  }) },
  omenAt('o_hideyoshi', 1590, 8, '도요토미 히데요시가 일본 전역을 평정했다. 그가 「명을 치겠다」고 큰소리친다는 소문이 대마도를 거쳐 들려온다.'),
  omenAt('o_waegwan', 1592, 1, '부산포 왜관에 머물던 왜인들이 하나둘 배를 타고 돌아가 왜관이 텅 비었다는 장계가 올라왔다.', (s) => !s.war.active),
  omenAt('o_jeongmyo', 1626, 10, (s) => `후금의 누르하치가 죽고 홍타이지가 섰다. ${s.flags.banjeongDone ? '반정으로 선 조정이 명을 받들고 후금을 배척하는 데다, ' : ''}명의 장수 모문룡이 가도에 진을 치고 후금의 뒤를 치니, 후금이 조선을 먼저 치려 한다는 말이 돈다.`),
  omenAt('o_banjeong', 1622, 6, '폐모와 오랑캐와의 화친에 분개한 서인들이 은밀히 모인다. 「이 임금을 받들 수 없다」는 말이 사랑방에서 오가고, 능양군의 집에 무인들이 드나든다.', (s) => slotVerdict(s) === 'coup'),
  omenAt('o_igwal', 1623, 7, '논공행상에서 2등 공신에 그친 이괄이 불만을 품었다. 평안 병사로 나가 있는 그가 군사를 기른다는 말이 돈다.', (s) => !!s.flags.banjeongDone),
  omenAt('o_cheong', 1636, 4, (s) => `후금의 홍타이지가 국호를 청으로 고치고 황제를 칭했다. ${s.flags.jeongmyoHeld === false ? '정묘년의 형제 맹약을 넘어 군신의 예를' : '조선에 신하의 예를'} 요구하는 사신을 조정이 척화를 외치며 돌려보냈다. 북쪽의 군사가 움직인다는 장계가 잇따른다.`, undefined, (s) => (s.tension = clamp(s.tension + 4, 0, 100))),
  omenAt('o_daeri_push', 1721, 10, '세제를 세운 노론이 내친김에 세제의 대리청정까지 청하자, 소론이 「병든 임금을 핍박한다」며 들고일어났다.', (s) => kingNameNow(s) === '경종' && !s.flags.sejeFailed, (s) => (s.tension = clamp(s.tension + 5, 0, 100))),
  omenAt('o_injwa', 1727, 10, '「경종은 독살되었고 지금 임금은 숙종의 아들이 아니다」라는 흉서가 삼남에 나돈다. 정권에서 밀려난 소론 강경파와 남인 일부가 은밀히 오간다.', (s) => kingNameNow(s) === '영조' && !s.flags.sejeFailed, (s) => shakeLegit(s, -4, '경종 독살설이 다시 번졌다')),
  omenAt('o_sado1', 1757, 11, '정성왕후와 인원왕후가 잇따라 세상을 떠난 뒤 세자의 화증이 깊어졌다. 내관과 나인을 해쳤다는 말이 돌고, 영조의 꾸지람이 잦아진다.'),
  omenAt('o_sado2', 1761, 4, '세자가 왕의 허락 없이 몰래 평양에 다녀왔다. 이를 안 영조가 크게 노했다.'),
  omenAt('o_sado3', 1762, 5, '나경언이 세자의 비행을 낱낱이 적은 글을 올렸다. 영조가 세자를 불러 크게 꾸짖었다. 궁중에 흉흉한 기운이 감돈다.'),
  omenAt('o_sedo', 1800, 5, (s) => `병석의 정조가 ${figure(s, 'kim_josun') ? `${figure(s, 'kim_josun')!.name}의 딸` : '안동 김씨 집안의 딸'}을 세자빈으로 점찍어 두고, 어린 세자의 앞날을 그에게 부탁했다는 말이 돈다.`, (s) => kingNameNow(s) === '정조'),
  omenAt('o_sinyu', 1800, 12, '어린 임금을 대신해 발을 드리운 정순왕후가 「사학(邪學)을 엄금하라」는 하교를 준비한다는 말이 돈다. 정조가 감싸던 남인 시파를 벽파가 노린다.', (s) => typeof s.flags.suryeomUntil === 'number' && s.t < (s.flags.suryeomUntil as number)),
  omenAt('o_hong', 1810, 10, '평안도 사람을 높은 벼슬에 쓰지 않는 차별에 원망이 깊다. 흉년 끝에 가산의 다복동에 장정과 광부들이 모여든다는 장계가 올라왔다.'),
);

/* ───────── 순조 대: 공노비 해방, 이양선, 효명세자의 가례 ───────── */
LATER_SCHEDULE.push(
  { id: 'l_gongnobi', at: at(1801, 1), run: L('내수사와 각 관청에 딸린 공노비 6만 6천여 명의 노비 문서를 돈화문 앞에서 불살랐다. 노비들이 양인이 되었다.', (s) => {
    for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim + 3, 0, 100);
    s.realm.treasury -= 25;
  }) },
  playerAt('later_iyangseon', 1816, 7, (s) => inCourt(P(s)) && P(s).rank <= 6, '영국 배 두 척이 충청도 마량진 앞바다에 나타났다가 돌아갔다. 사람들은 「이양선(異樣船)」이라 불렀다.'),
  { id: 'l_hyomyeong_garye', at: at(1819, 10), run: L('효명세자가 조만영의 딸을 세자빈으로 맞았다. 풍양 조씨가 안동 김씨의 세도를 견제할 새 외척으로 떠오른다.') },
);

/* ───────── 대기근의 구휼: 조정에 있으면 어떻게 살릴지를 고른다 ───────── */
const famineAt = (y: number, m: number, name: string): Scheduled => ({
  id: `l_famine_ev_${y}`,
  at: at(y, m),
  cond: (s) => {
    const p = P(s);
    return alive(p) && p.status !== 'exiled' && inCourt(p) && p.rank <= 5;
  },
  run: (s) => pushEvent(s, 'later_famine', { name }),
});
LATER_SCHEDULE.push(famineAt(1670, 8, '경신대기근'), famineAt(1695, 9, '을병대기근'), famineAt(1809, 9, '기사년 대기근'));

/* ───────── 화성 축성(1794~1796): 조정에 있으면 어떻게 거들지 고른다 ───────── */
LATER_SCHEDULE.push({
  ...playerAt('later_hwaseong', 1794, 1, (s) => kingNameNow(s) === '정조' && inCourt(P(s)) && P(s).rank <= 5, '정조가 수원에 새 성을 쌓기 시작했다. 아버지의 무덤을 지키고 장용영 외영을 둘 성이다.'),
  cond: (s) => kingNameNow(s) === '정조',
});

/** 매달: 인물 등장, 전란 종료, 늘그막의 처리 */
export function tickLater(s: GameState) {
  if (yearOf(s.t) < 1601) return;
  spawnFigures(s);
  tickLaterWar(s);
  tickSlot(s);
  tickAlt(s);
  rollSedoAsk(s);
  rollHwangok(s);
  rollAmhaeng(s);
}

/* ───────── 사건 ───────── */

export const LATER_EVENTS: Record<string, EventDef> = {
  later_banjeong: {
    build: (s) => ({
      title: '인조반정',
      kind: 'danger',
      text: `서인들이 군사를 일으켜 ${josa(String(s.flags.deposed ?? '광해군'), '을/를')} 몰아냈다. 대북의 요인들이 줄줄이 죽거나 귀양을 간다. 북인인 당신에게도 칼끝이 향한다.`,
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
    build: (s) => ({
      title: '노론과 소론',
      kind: 'court',
      text: `남인을 얼마나 엄히 다스릴 것인가를 두고 서인이 둘로 갈라섰다. ${josa(headOf(s, 'song_siyeol', 'noron'), '을/를')} 따르는 노론은 의리와 명분을, ${josa(headOf(s, 'yun_jeung', 'soron'), '을/를')} 따르는 소론은 온건함과 실리를 내세운다. 어느 쪽에 설 것인가.`,
      choices: [
        { key: 'noron', label: '노론에 선다', hint: `${headOf(s, 'song_siyeol', 'noron')}의 편. 강경하다` },
        { key: 'soron', label: '소론에 선다', hint: `${headOf(s, 'yun_jeung', 'soron')}의 편. 온건하다` },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      p.faction = key as FactionId;
      return `${FACTION_META[p.faction].name}에 섰다.`;
    },
  },
  horan_flight: {
    build(s, c) {
      const p = P(s);
      const jm = c.which === 'jeongmyo';
      const court = inCourt(p) && p.status === 'active';
      return {
        title: jm ? '정묘년의 피란' : '병자년 겨울',
        kind: 'war',
        text: jm
          ? `후금의 기병이 평양을 지나 내려온다. 왕이 강화도로 피란하고, 세자는 전주로 내려가 분조를 이끈다. ${court ? '조정의 신하들은 저마다 갈 곳을 정해야 한다.' : '고향에서도 피란 보따리를 싸는 소리가 들린다.'}`
          : `청군의 선봉이 엿새 만에 한성 서쪽에 닿았다. 강화도로 가는 길이 끊겨 왕이 남한산성으로 들어간다. 빈궁과 대군들, 종묘의 신주는 먼저 강화도로 떠났다. 강화도는 「물길이 막아 주니 안전하다」며 검찰사 김경징이 술판을 벌인다는 말이 들린다. ${court ? '' : '고향의 선비들 사이에서는 창의(倡義)하자는 말이 나온다.'}`,
        choices: [
          {
            key: 'follow',
            label: jm ? '어가를 따라 강화도로 간다' : '어가를 따라 남한산성으로 들어간다',
            hint: jm ? '성심 +4, 명망 +1' : '성심 +5. 성 안에서 척화와 주화 가운데 서게 된다',
            disabled: court ? undefined : '조정에 있어야 한다',
          },
          ...(jm
            ? []
            : [{ key: 'ganghwa', label: '빈궁과 대군을 모시고 강화도로 간다', hint: '강화도가 지켜지면(40%) 성심 +6·명망 +3. 함락되면 마지막 길을 골라야 한다' }]),
          { key: 'uibyeong', label: '고향에서 의병을 모은다', hint: '재산 −20, 정치력으로 판정(무략이 있으면 유리): 되면 명망 +5·이 도 민심 +4, 안 되면 명망 −1. 병을 얻을 수 있다' },
          { key: 'hide', label: '가족을 데리고 산속으로 피한다', hint: `명망 −3${court ? ', 성심 −4 (난리 때 임금을 버렸다는 말을 듣는다)' : ''}` },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const jm = c.which === 'jeongmyo';
      const court = inCourt(p) && p.status === 'active';
      if (key === 'follow' && court) {
        fav(p, jm ? 4 : 5);
        if (jm) {
          pres(p, 1);
          s.player.deeds.push(`${yearOf(s.t)} 정묘호란 때 강화도로 어가를 호종`);
          return '어가를 따라 강화도로 건너갔다. (성심 +4, 명망 +1)';
        }
        s.player.deeds.push(`${yearOf(s.t)} 병자호란 때 남한산성으로 어가를 호종`);
        s.flags.namhanP = true;
        pushEvent(s, 'horan_stance', {});
        return '어가를 따라 눈보라 속에 남한산성으로 들어갔다. 성 안의 군량은 한 달 반 치다. (성심 +5)';
      }
      if (key === 'ganghwa') {
        if (chance(s, 0.4)) {
          fav(p, 6);
          pres(p, 3);
          return '강화도의 물길을 지켜 빈궁과 대군을 무사히 모셨다. (성심 +6, 명망 +3)';
        }
        pushEvent(s, 'horan_ganghwa', {});
        return '강화도로 건너갔다.';
      }
      if (key === 'uibyeong') {
        p.wealth -= 20;
        if (chance(s, 0.15)) s.player.sick = true;
        const home = p.home as RegionId;
        if (d6(s) + p.politics + (p.traits.includes('martial') ? 2 : 0) >= 6) {
          pres(p, 5);
          s.regions[home].minsim = clamp(s.regions[home].minsim + 4, 0, 100);
          s.player.deeds.push(`${yearOf(s.t)} ${jm ? '정묘' : '병자'}호란 때 의병을 일으킴`);
          return `${REGION_META[home].short}에서 의병 수백을 모아 북으로 올라갔다. 싸움은 짧았지만 이름이 났다. (재산 −20, 명망 +5)`;
        }
        pres(p, -1);
        return '의병을 모았으나 오합지졸이었다. 길에서 강화 소식을 듣고 흩어졌다. (재산 −20, 명망 −1)';
      }
      pres(p, -3);
      if (court) fav(p, -4);
      return `가족을 데리고 산속으로 들어갔다.${court ? ' 난리 때 임금을 버렸다는 말이 돈다. (명망 −3, 성심 −4)' : ' (명망 −3)'}`;
    },
  },
  rebel_local: {
    build(s, c) {
      const p = P(s);
      const where = REGION_META[p.location as RegionId].short;
      return {
        title: `${c.name} — 내 고을`,
        kind: 'danger',
        text: `${c.name}의 무리가 ${where}의 고을들을 차례로 떨어뜨리고 있다. 이웃 고을의 수령은 인부(印符)를 버리고 달아났고, 어떤 고을의 좌수와 아전들은 문을 열어 무리를 맞았다는 말이 들린다. 성 안의 군사는 수백이 안 된다.${c.quick ? ' 감영의 군사가 곧 온다고는 한다.' : ''}`,
        choices: [
          { key: 'hold', label: '성문을 닫고 지킨다', hint: '정치력·무략으로 판정. 되면 명망 +5·성심 +4, 안 되면 성이 떨어져 사로잡혔다가 풀려난다(파직, 명망 −2)' },
          { key: 'flee', label: '인부를 챙겨 감영으로 물러난다', hint: '파직, 한 해 서용 금지, 명망 −6. 절반의 확률로 유배' },
          { key: 'talk', label: '무리의 우두머리에게 사람을 보내 고을만은 비켜 가 달라 한다', hint: '재산 −15. 60%로 고을이 무사하다. 뒤에 「적과 내통했다」는 탄핵이 올 수 있다(드러난 흠 30%)' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      if (p.status !== 'active') return '이미 고을을 떠난 뒤였다.';
      const where = REGION_META[p.location as RegionId].short;
      if (key === 'hold') {
        if (d6(s) + p.politics + (p.traits.includes('martial') ? 2 : 0) + (c.quick ? 1 : 0) >= 7) {
          pres(p, 5);
          fav(p, 4);
          s.player.deeds.push(`${yearOf(s.t)} ${c.name} 때 ${where}의 성을 지킴`);
          log(s, `${c.name} 때 ${josa(p.name, '이/가')} 성문을 닫고 끝내 고을을 지켰다.`, 'player');
          return '성 위에서 열흘을 버텼다. 무리가 물러갔다. (명망 +5, 성심 +4)';
        }
        vacate(s, p, 'idle');
        pres(p, -2);
        return '성이 떨어져 사로잡혔다가 관군이 오자 풀려났다. 성을 잃은 책임으로 파직되었다. (명망 −2)';
      }
      if (key === 'flee') {
        vacate(s, p, 'idle');
        p.banUntil = Math.max(p.banUntil ?? 0, s.t + 12);
        pres(p, -6);
        if (chance(s, 0.5)) {
          exile(s, p);
          return '성을 버리고 달아난 수령이라는 탄핵이 빗발쳐 유배되었다. (명망 −6)';
        }
        return '감영으로 물러났다. 성을 버렸다는 탄핵을 받고 파직되었다. (명망 −6)';
      }
      p.wealth -= 15;
      if (chance(s, 0.3)) addFlaw(s, p, '적과 내통', true);
      if (chance(s, 0.6)) return '무리가 고을을 비켜 갔다. 고을 사람들은 안도했지만 뒷말이 남는다. (재산 −15)';
      vacate(s, p, 'idle');
      return '보낸 사람이 돌아오지 않았다. 무리가 고을을 덮쳐 관아가 불탔고, 파직되었다. (재산 −15)';
    },
  },
  horan_ganghwa: {
    build: () => ({
      title: '강화도 함락',
      kind: 'danger',
      text: '청군이 작은 배들을 엮어 갑곶 나루를 건넜다. 검찰사 김경징은 배를 타고 먼저 달아났다. 성 안은 아수라장이다. 빈궁과 대군들이 사로잡히고, 사대부 집안의 부녀자들이 바다에 몸을 던진다. 늙은 대신 김상용은 남문루에 화약을 쌓았다.',
      choices: [
        { key: 'die', label: '남문루에 올라 함께 순절한다', hint: '이 대가 끝난다. 명망 +15가 가문에 남고, 다음 대가 잇는다' },
        { key: 'fight', label: '남은 군사를 모아 끝까지 맞서다 사로잡힌다', hint: '명망 +3. 심양에 끌려가 여덟 달 뒤 속환되어 돌아온다. 병을 얻을 수 있다' },
        { key: 'run', label: '작은 배를 얻어 홀로 달아난다', hint: '살아남는다. 명망 −8, 성심 −4, 드러난 흠 「강화도에서 달아남」' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'die') {
        pres(p, 15);
        s.player.deeds.push(`${yearOf(s.t)} 강화도가 함락되자 순절`);
        log(s, `강화도가 함락되자 ${josa(p.name, '이/가')} 김상용과 함께 남문루에서 순절했다.`, 'player');
        kill(s, p, '강화도에서 순절했다');
        return '남문루에 불길이 일었다. 사람들이 그 이름을 오래 기억할 것이다.';
      }
      if (key === 'fight') {
        pres(p, 3);
        s.player.abroadUntil = s.t + 8;
        if (chance(s, 0.3)) s.player.sick = true;
        s.player.deeds.push(`${yearOf(s.t)} 강화도에서 맞서다 사로잡혀 심양으로 끌려감`);
        return '마지막까지 칼을 들었으나 사로잡혔다. 심양으로 끌려가 여덟 달 뒤에 속환되어 돌아온다. (명망 +3)';
      }
      pres(p, -8);
      fav(p, -4);
      addFlaw(s, p, '강화도에서 달아남', true);
      return '작은 배를 얻어 홀로 달아났다. 빈궁과 대군이 사로잡혔다는 소식이 뒤따라온다. (명망 −8, 성심 −4, 드러난 흠)';
    },
  },
  horan_stance: {
    build: () => ({
      title: '남한산성 — 국서(國書)',
      kind: 'war',
      text: '포위된 지 한 달이 넘었다. 성 밖의 근왕병은 번번이 무너지고, 장졸들은 언 손으로 성첩을 지킨다. 최명길이 청에 보낼 항복의 국서를 지었다. 김상헌이 그것을 읽다가 찢어 버리고 통곡한다. 최명길은 찢긴 종이를 주워 모으며 「찢는 이도 있어야 하고 줍는 이도 있어야 한다」고 말한다.\n\n임금이 신하들을 둘러본다.',
      choices: [
        { key: 'cheok', label: '국서를 찢는 편에 선다 (척화)', hint: '명망 +6, 성심 −4. 전란 뒤 청이 척화신을 잡아가라 하면(35%) 심양에 끌려갔다가 돌아온다. 사림이 오래 기억한다' },
        { key: 'ju', label: '국서를 줍는 편에 선다 (주화)', hint: '성심 +6, 명망 −4. 드러난 흠 「주화(主和)」 — 뒷날 사림의 공격을 받는다' },
        { key: 'quiet', label: '눈을 감고 아무 말도 하지 않는다', hint: '명망 −1' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      s.flags.namhanStance = key;
      if (key === 'cheok') {
        pres(p, 6);
        fav(p, -4);
        s.player.deeds.push(`${yearOf(s.t)} 남한산성에서 척화를 주장`);
        log(s, `남한산성에서 ${josa(p.name, '이/가')} 끝까지 척화를 주장했다.`, 'player');
        return '「차라리 성을 베개 삼아 죽을지언정 오랑캐에게 무릎 꿇을 수는 없습니다.」 (명망 +6, 성심 −4)';
      }
      if (key === 'ju') {
        fav(p, 6);
        pres(p, -4);
        addFlaw(s, p, '주화(主和)', true);
        s.player.deeds.push(`${yearOf(s.t)} 남한산성에서 주화를 주장`);
        log(s, `남한산성에서 ${josa(p.name, '이/가')} 최명길과 함께 화친을 주장했다.`, 'player');
        return '「종사가 있고서야 의리도 있습니다. 성이 무너지면 무엇으로 의리를 지키겠습니까.」 임금이 고개를 끄덕였다. (성심 +6, 명망 −4)';
      }
      pres(p, -1);
      return '아무 말도 하지 않았다. (명망 −1)';
    },
  },
  horan_sokhwan: {
    build(s) {
      const cheok = s.flags.namhanStance === 'cheok';
      return {
        title: '속환(贖還)',
        kind: 'court',
        text: `청군이 물러가면서 수십만의 백성을 끌고 갔다. 심양의 포로 시장에서는 몸값을 치르면 사람을 돌려준다. 값은 사대부 집안일수록 비싸게 부른다. 돌아온 부녀자들을 두고는 「절개를 잃었으니 이혼을 허락해 달라」는 사대부들의 상소가 올라온다.${cheok ? '\n\n청은 남한산성에서 척화를 주장한 신하들을 보내라고 요구하고 있다.' : ''}`,
        choices: [
          { key: 'pay', label: '사재를 털어 고을 사람들을 속환해 온다', hint: '재산 −30, 명망 +4, 고향 민심 +5' },
          { key: 'defend', label: '「돌아온 이를 내치는 것은 두 번 죽이는 일」이라 상소한다', hint: '명망 +2, 성심 +1. 사대부 일부의 원망' },
          { key: 'none', label: '나랏일이니 조정에 맡긴다', hint: '아무 일도 없다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const out: string[] = [];
      if (key === 'pay') {
        p.wealth -= 30;
        pres(p, 4);
        const home = p.home as RegionId;
        s.regions[home].minsim = clamp(s.regions[home].minsim + 5, 0, 100);
        s.player.deeds.push(`${yearOf(s.t)} 사재로 포로를 속환`);
        out.push('심양에 사람을 보내 고을 사람 수십을 속환해 왔다. (재산 −30, 명망 +4)');
      } else if (key === 'defend') {
        pres(p, 2);
        fav(p, 1);
        if (p.faction !== 'none') swayFaction(s, p.faction, p.id, -2, '환향녀를 감쌈', 0.1);
        out.push('「돌아온 이를 내치는 것은 두 번 죽이는 일입니다.」 임금이 이혼을 허락하지 않았다. (명망 +2, 성심 +1)');
      } else out.push('조정에 맡겼다.');
      if (s.flags.namhanStance === 'cheok' && inCourt(p) && chance(s, 0.35)) {
        s.player.abroadUntil = s.t + 12;
        pres(p, 4);
        s.player.deeds.push(`${yearOf(s.t)} 척화신으로 심양에 끌려감`);
        log(s, `청의 요구로 척화를 주장한 ${josa(p.name, '이/가')} 심양으로 끌려갔다.`, 'player');
        out.push('청의 요구로 심양에 끌려간다. 한 해 동안 옥에 갇혔다가 돌아올 것이다. 사람들이 당신을 김상헌에 견준다. (명망 +4)');
      }
      return out.join(' ');
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
  later_munche: {
    build: (s) => {
      const p = P(s);
      return {
        title: '문체반정(文體反正)',
        kind: 'court',
        text: `정조가 "근래 선비들의 글이 패관소품(稗官小品)에 물들어 경박하다"며 순정한 고문으로 돌아가라 명했다. 박지원의 『열하일기』 같은 글이 화살을 맞고, 이름난 문신들에게 반성문을 지어 바치라는 명이 내렸다. 당신의 글도 도마에 올랐다.${p.traits.includes('writer') ? '\n\n문장가로 이름난 당신의 글은 특히 눈에 띈다.' : ''}`,
        choices: [
          { key: 'repent', label: '반성문을 지어 바친다', hint: '성심 +4, 명망 -2' },
          { key: 'gomun', label: '순정한 고문으로 글을 지어 올린다', hint: `주사위 + (내 학식 ${p.learning} - 임금 학식 9) ≥ 0. 되면 성심 +6, 명망 +2. 안 되면 성심 -3` },
          { key: 'defend', label: '글은 시대를 따라 변하는 것이라 아뢴다', hint: '명망 +4, 성심 -8' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      log(s, '문체반정: 정조가 패관소품의 가벼운 문체를 금하고 순정한 고문(古文)으로 돌아가라 명했다.', 'history');
      if (key === 'repent') {
        fav(p, 4);
        pres(p, -2);
        return '반성문을 지어 바쳤다. 임금이 "이제야 바른 길로 돌아왔다" 했다. (성심 +4, 명망 -2)';
      }
      if (key === 'gomun') {
        const r = d6(s) + p.learning - 9;
        if (r >= 0) {
          fav(p, 6);
          pres(p, 2);
          return `고문의 법도에 맞춘 글을 올리자 임금이 친히 비점을 찍었다. (판정 ${r}, 성심 +6, 명망 +2)`;
        }
        fav(p, -3);
        return `글을 올렸으나 임금이 "흉내만 냈을 뿐이다" 하고 물렸다. (판정 ${r} < 0, 성심 -3)`;
      }
      pres(p, 4);
      fav(p, -8);
      log(s, `${josa(p.name, '이/가')} 문체반정에 맞서 글은 시대를 따라 변한다고 아뢰었다.`, 'player');
      return '물러서지 않았다. 젊은 문인들이 당신을 우러르지만 임금의 낯빛이 차갑다. (명망 +4, 성심 -8)';
    },
  },
  later_sedo_ask: {
    build: (s, c) => {
      const who = s.chars[c.who];
      const kj = figure(s, 'kim_josun');
      return {
        title: '세도가의 청탁',
        kind: 'danger',
        text: `${kj ? `${kj.name}의 집` : '세도가'}에서 사람이 왔다. "이번 정사(政事)에 ${who.name} 대감을 좋은 자리에 올려 주시면, 대감의 앞길도 평탄할 것입니다."\n\n인사를 맡은 자리에 앉았으니 피할 수 없는 일이다. 거절하면 세도가의 눈 밖에 나고, 들어주면 이름에 흠이 남는다.`,
        choices: [
          { key: 'accept', label: `${josa(who.name, '을/를')} 의망에 올린다`, hint: `${who.name} 임용 점수 +8 (6달). 성심 +3, 명망 -2. 50% 확률로 숨은 흠결 「세도가의 청탁」` },
          { key: 'refuse', label: '공도(公道)를 들어 거절한다', hint: '명망 +2. 절반의 확률로 세도가가 보복한다 (성심 -6, 파직될 수 있다)' },
          { key: 'expose', label: '세도가의 인사 청탁을 들춰 상소한다', hint: '명망 +5, 성심 -8. 40% 확률로 세도가의 역공에 파직된다', disabled: inCourt(P(s)) ? undefined : '조정에 있어야 한다' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const who = s.chars[c.who];
      if (key === 'accept') {
        if (alive(who)) s.recs[who.id] = s.t + 6;
        fav(p, 3);
        pres(p, -2);
        if (s.factions.noron.active) kingLean(s, 'noron', 2);
        if (chance(s, 0.5)) addFlaw(s, p, '세도가의 청탁', false);
        return `${josa(who.name, '을/를')} 의망에 올렸다. 세도가에서 흡족해한다는 말이 들린다. (성심 +3, 명망 -2)`;
      }
      if (key === 'refuse') {
        pres(p, 2);
        if (chance(s, 0.5)) {
          fav(p, -6);
          if (p.office && chance(s, 0.25)) {
            vacate(s, p);
            return '청탁을 거절했다. 얼마 뒤 사소한 허물을 잡혀 자리에서 밀려났다. 세도가의 보복이다. (명망 +2, 성심 -6)';
          }
          return '청탁을 거절했다. 세도가에서 당신을 두고 「눈치 없는 자」라 한다는 말이 들린다. (명망 +2, 성심 -6)';
        }
        return '청탁을 거절했다. 다행히 별일은 없었다. (명망 +2)';
      }
      pres(p, 5);
      fav(p, -8);
      if (s.factions.noron.active) kingLean(s, 'noron', -3);
      log(s, `${josa(p.name, '이/가')} 세도가의 인사 청탁을 들춰 상소했다.`, 'player');
      if (p.office && chance(s, 0.4)) {
        vacate(s, p);
        return '상소를 올렸으나 세도가의 역공에 오히려 자리에서 밀려났다. 사림은 당신을 의기 있는 선비라 부른다. (명망 +5, 성심 -8)';
      }
      return '세도가의 청탁을 들춰냈다. 조정이 술렁였지만 세도가는 끄떡없다. (명망 +5, 성심 -8)';
    },
  },
  later_hwangok: {
    build: (s, c) => {
      const r = s.regions[c.region as RegionId];
      return {
        title: '환곡(還穀)의 문란',
        kind: 'danger',
        text: `${REGION_META[c.region as RegionId].short}의 고을을 돌아보니 환곡 장부가 엉망이다. 수령과 아전들이 곡식을 빌려주지도 않고 이자만 거두는 백징(白徵), 겨와 모래를 섞어 빌려주는 분석(分石)이 판을 친다. 굶주린 백성들이 감영 앞에 모여 있다. (민심 ${Math.round(r.minsim)})\n\n수령들 가운데 몇은 세도가에 줄이 닿아 있다.`,
        choices: [
          { key: 'purge', label: '장부를 뒤져 탐관오리를 파직한다', hint: '이 도 민심 +8, 명망 +4. 세도가의 눈 밖에 난다 (성심 -5)' },
          { key: 'relief', label: '감영 곡식을 풀어 백성부터 구한다', hint: '이 도 민심 +5, 국고 -20' },
          { key: 'cover', label: '조정에는 무사하다고 보고한다', hint: '성심 +2. 이 도 민심 -6. 30% 확률로 숨은 흠결 「환곡 문란 은폐」' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const r = s.regions[c.region as RegionId];
      if (key === 'purge') {
        r.minsim = clamp(r.minsim + 8, 0, 100);
        pres(p, 4);
        fav(p, -5);
        r.inspectUntil = s.t + 12;
        log(s, `${josa(p.name, '이/가')} ${REGION_META[c.region as RegionId].short}의 환곡을 농간한 수령들을 파직했다.`, 'player');
        return '탐관오리들을 파직하고 장부를 바로잡았다. 백성들이 감영 앞에서 절을 한다. 세도가에서는 불쾌해한다. (민심 +8, 명망 +4, 성심 -5)';
      }
      if (key === 'relief') {
        r.minsim = clamp(r.minsim + 5, 0, 100);
        s.realm.treasury -= 20;
        return '감영의 곡식을 풀어 굶주린 백성을 먹였다. (민심 +5, 국고 -20)';
      }
      r.minsim = clamp(r.minsim - 6, 0, 100);
      fav(p, 2);
      if (chance(s, 0.3)) addFlaw(s, p, '환곡 문란 은폐', false);
      return '조정에 무사하다고 보고했다. 백성의 원망이 깊어 간다. (민심 -6, 성심 +2)';
    },
  },
  later_amhaeng: {
    build: (s, c) => {
      const r = s.regions[c.region as RegionId];
      const p = P(s);
      return {
        title: '암행어사(暗行御史)',
        kind: 'personal',
        text: `밤중에 승지가 봉서(封書) 한 통과 마패를 건넨다. 성 밖에 나가서야 열어 보라는 왕명이다. 봉서를 뜯으니 「${REGION_META[c.region as RegionId].short}로 가서 수령들의 잘잘못을 살피라」 하였다. (민심 ${Math.round(r.minsim)})\n\n해어진 도포에 패랭이를 쓰고 길을 나서야 한다. 석 달 동안 조정을 비운다.`,
        choices: [
          { key: 'go', label: '봉서를 받들어 길을 떠난다', hint: `주사위 + 정치력 ${p.politics} ≥ 7. 되면 탐관을 봉고파직해 이 도 민심 +6, 은결 -3%p, 명망 +5, 성심 +4. 안 되면 명망 +1. 석 달 동안 조정을 비운다` },
          { key: 'bribe', label: '길을 떠나되 수령들의 뇌물을 받는다', hint: '재산 +40. 이 도 민심 -3. 숨은 흠결 「어사의 수뢰」. 석 달 동안 조정을 비운다' },
          { key: 'decline', label: '병을 핑계로 사양한다', hint: '성심 -3' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const rid = c.region as RegionId;
      const r = s.regions[rid];
      const where = REGION_META[rid].short;
      if (key === 'decline') {
        fav(p, -3);
        return '병을 핑계로 봉서를 돌려보냈다. 임금이 실망했다. (성심 -3)';
      }
      s.player.abroadUntil = s.t + 3;
      if (key === 'bribe') {
        p.wealth += 40;
        r.minsim = clamp(r.minsim - 3, 0, 100);
        addFlaw(s, p, '어사의 수뢰', false);
        return `${where}의 수령들이 바치는 것을 받고 눈감아 주었다. 백성의 원망은 그대로다. (재산 +40, 숨은 흠결)`;
      }
      const roll = d6(s) + p.politics;
      if (roll >= 7) {
        r.minsim = clamp(r.minsim + 6, 0, 100);
        r.hidden = Math.max(0, r.hidden - 0.03);
        r.inspectUntil = s.t + 12;
        pres(p, 5);
        fav(p, 4);
        s.player.deeds.push(`${yearOf(s.t)} 암행어사로 ${where}에 출도`);
        log(s, `암행어사 ${josa(p.name, '이/가')} ${where}에 출도해 탐관오리를 봉고파직했다.`, 'player');
        // 세도가에 줄이 닿은 수령을 친 뒤에는 뒤탈이 있다
        if (s.flags.kingStyle === 'sedo' && chance(s, 0.25)) {
          fav(p, -6);
          return `"암행어사 출도야!" 역졸들의 외침에 수령이 달아났다. 창고를 봉하고 탐관을 파직했다. 그런데 그 수령은 세도가의 사람이었다. 돌아오자 찬바람이 분다. (판정 ${roll}, 민심 +6, 명망 +5, 성심 -2)`;
        }
        return `"암행어사 출도야!" 역졸들의 외침에 수령이 달아났다. 창고를 봉하고 탐관을 파직했다. 백성들이 길에 나와 절한다. (판정 ${roll}, 민심 +6, 명망 +5, 성심 +4)`;
      }
      pres(p, 1);
      return `석 달을 돌았으나 수령들이 낌새를 채고 장부를 감추었다. 큰 허물은 잡지 못했다. (판정 ${roll} < 7, 명망 +1)`;
    },
  },
  later_sipa: {
    build: () => ({
      title: '시파(時派)와 벽파(僻派)',
      kind: 'court',
      text: '임오년의 일을 두고 조정이 둘로 갈렸다. 세자를 동정하고 세손을 받드는 시파와, 영조의 처분이 옳았다며 세손의 즉위를 경계하는 벽파다. 당색을 넘어 사람들이 어느 쪽인지를 묻는다. 세손이 즉위하면 시파가, 그 뒤 대비가 정사를 잡으면 벽파가 득세할 것이다.',
      choices: [
        { key: 'si', label: '시파에 선다', hint: '세손이 즉위하면 성심 +8. 훗날 대비의 수렴청정 아래에서는 성심 -8. 대비가 세상을 떠나면 성심 +5' },
        { key: 'byeok', label: '벽파에 선다', hint: '세손이 즉위하면 성심 -8. 대비의 수렴청정 아래에서는 성심 +8. 대비가 세상을 떠나면 성심 -10에 파직될 수 있다' },
        { key: 'none', label: '어느 쪽에도 서지 않는다', hint: '명망 -1. 아무 일도 없다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'none') {
        pres(p, -1);
        return '어느 쪽에도 서지 않았다. 줏대가 없다는 말을 들었다. (명망 -1)';
      }
      s.flags.sipa = key;
      return key === 'si' ? '시파에 섰다. 세손의 사람들이 당신을 반긴다.' : '벽파에 섰다. 영조의 처분을 받드는 이들이 당신을 반긴다.';
    },
  },
  later_bukhak: {
    build: () => ({
      title: '북학(北學)',
      kind: 'court',
      text: '연행에서 돌아온 박제가가 『북학의』를 지었다. "청은 오랑캐라도 그 법이 좋으면 배워야 한다. 수레를 쓰고, 벽돌을 굽고, 장사를 일으키자." 박지원·홍대용 같은 이들이 맞장구친다. 그러나 명에 대한 의리를 지켜 온 이들에게는 오랑캐를 스승으로 삼자는 말로 들린다. 정조는 이들을 규장각 검서관으로 아낀다.',
      choices: [
        { key: 'embrace', label: '북학을 받아들이자고 한다', hint: '학식 경험 +8, 명망 +3, 성심 +2. 의리를 중시하는 노론 강경파가 싫어한다 (그 당의 호감 -3)' },
        { key: 'uiri', label: '오랑캐를 배울 수 없다며 의리를 지킨다', hint: '명망 +1. 노론의 호감 +3' },
        { key: 'quiet', label: '쓸 만한 것만 조용히 익힌다', hint: '학식 경험 +4' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'embrace') {
        s.player.exp.learning += 8;
        pres(p, 3);
        fav(p, 2);
        if (s.factions.noron.active) swayFaction(s, 'noron', p.id, -3, '오랑캐를 배우자 함', 0.1);
        log(s, `${josa(p.name, '이/가')} 북학을 받아들이자고 했다.`, 'player');
        return '북학을 받아들이자고 했다. 젊은 학자들이 당신의 사랑방에 드나든다. (명망 +3, 성심 +2)';
      }
      if (key === 'uiri') {
        pres(p, 1);
        if (s.factions.noron.active) swayFaction(s, 'noron', p.id, 3, '대명의리를 지킴', 0.1);
        return '명에 대한 의리를 들어 북학을 물리쳤다. (명망 +1)';
      }
      s.player.exp.learning += 4;
      return '쓸 만한 것만 조용히 익혔다. (학식 경험 +4)';
    },
  },
  later_hwanghyang: {
    build: () => ({
      title: '환향녀(還鄕女)',
      kind: 'court',
      text: '청에 끌려갔다가 속환되어 돌아온 부녀자들을 두고 사대부 집안들이 이혼을 청한다. "절개를 잃었으니 조상의 제사를 받들 수 없다." 최명길은 "나라가 지키지 못해 끌려간 이들을 버린다면 누가 나라를 믿겠는가" 하며 이혼을 막자고 한다. 왕이 신하들의 뜻을 묻는다.',
      choices: [
        { key: 'forbid', label: '이혼을 허락해서는 안 된다고 아뢴다', hint: '성심 +3, 명망 +1. 예법을 중시하는 사족들이 수군거린다' },
        { key: 'allow', label: '예법을 지켜 이혼을 허락해야 한다고 아뢴다', hint: '명망 +2. 성심 -2' },
        { key: 'quiet', label: '말을 아낀다', hint: '아무 일도 없다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      log(s, '청에 끌려갔다 돌아온 부녀자들의 이혼 문제로 조정이 시끄러웠다. 왕은 이혼을 허락하지 않았다.', 'history');
      if (key === 'forbid') {
        fav(p, 3);
        pres(p, 1);
        return '나라가 지키지 못한 이들을 버릴 수 없다고 아뢰었다. 왕이 고개를 끄덕였다. (성심 +3, 명망 +1)';
      }
      if (key === 'allow') {
        pres(p, 2);
        fav(p, -2);
        return '예법을 들어 이혼을 허락하자고 했다. 사족들은 반겼으나 왕은 따르지 않았다. (명망 +2, 성심 -2)';
      }
      return '말을 아꼈다.';
    },
  },
  later_hong: {
    build: (s) => ({
      title: '홍경래의 난',
      kind: 'war',
      text: `평안도 가산에서 몰락 양반 홍경래가 「서북 사람을 차별하고 세도가가 나라를 어지럽힌다」며 군사를 일으켰다. 몇 고을이 순식간에 넘어갔고, 지금은 정주성에 들어가 버티고 있다. 성 안에는 농민과 광산 일꾼, 장사꾼들이 뒤섞여 있다. (평안 민심 ${Math.round(s.regions.pyeongan.minsim)})`,
      choices: [
        { key: 'crush', label: '역적이니 남김없이 쳐서 본보기를 보이자', hint: '성심 +3. 평안 민심 -8. 성이 떨어진 뒤 민심이 더 깎인다' },
        { key: 'appease', label: '서북의 원망부터 풀어 주자고 상소한다', hint: '명망 +4, 성심 -2. 평안 민심 +6, 성이 떨어진 뒤 민심이 오른다. 세도가가 언짢아한다' },
        { key: 'quiet', label: '조정의 처분을 기다린다', hint: '아무 일도 없다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      const pg = s.regions.pyeongan;
      if (key === 'crush') {
        fav(p, 3);
        pg.minsim = clamp(pg.minsim - 8, 0, 100);
        return '남김없이 치자고 아뢰었다. 관군이 정주성을 에워쌌다. (성심 +3)';
      }
      if (key === 'appease') {
        s.flags.hongAppease = true;
        pres(p, 4);
        fav(p, -2);
        pg.minsim = clamp(pg.minsim + 6, 0, 100);
        if (s.factions.noron.active) kingLean(s, 'noron', -1);
        log(s, `${josa(p.name, '이/가')} 서북 사람에 대한 차별을 거두자고 상소했다.`, 'player');
        return '서북의 원망을 풀어 주자고 상소했다. 서북 사람들 사이에 당신의 이름이 퍼진다. (명망 +4, 성심 -2)';
      }
      return '조정의 처분을 기다렸다.';
    },
  },
  later_injwa: {
    build: (s) => {
      const p = P(s);
      const stat = Math.round((p.politics + p.vigor) / 2) + (p.traits.includes('martial') ? 1 : 0);
      return {
        title: '이인좌의 난',
        kind: 'war',
        text: '소론 강경파와 남인 일부가 「경종이 독살되었고 지금 임금은 경종의 혈통이 아니다」라며 군사를 일으켰다. 이인좌가 청주성을 빼앗았고, 영남과 호남에서도 호응하는 무리가 있다. 왕은 소론 온건파 오명항을 도순무사로 삼아 토벌을 맡겼다. 조정 안에서는 「소론을 모두 쳐내야 한다」는 말이 터져 나온다.',
        choices: [
          { key: 'march', label: '종사관으로 자원해 토벌에 나선다', hint: `주사위 + 정치력·강건 ${stat} ≥ 8. 되면 명망 +6, 성심 +5, 공신의 반열. 안 되면 명망 -2` },
          { key: 'tang', label: '역적은 벌하되 소론 전체를 탓하지 말자고 아뢴다', hint: '붕당 간 긴장 -5, 소론의 호감 +5, 노론의 호감 -4, 성심 +2 (탕평의 뜻에 맞는다)' },
          { key: 'purge', label: '역적의 뿌리인 소론을 모두 쳐내자고 아뢴다', hint: '노론의 호감 +5, 소론의 호감 -8, 긴장 +6. 탕평을 내세우는 왕은 언짢아한다 (성심 -3)' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'march') {
        const r = d6(s) + Math.round((p.politics + p.vigor) / 2) + (p.traits.includes('martial') ? 1 : 0);
        if (r >= 8) {
          pres(p, 6);
          fav(p, 5);
          s.player.deeds.push(`${yearOf(s.t)} 무신란 토벌에 공을 세움`);
          log(s, `${josa(p.name, '이/가')} 종사관으로 이인좌의 난을 토벌하는 데 공을 세웠다.`, 'player');
          return `안성과 죽산에서 반군을 무찌르는 데 힘을 보탰다. 분무공신(奮武功臣)의 반열에 이름이 오른다. (판정 ${r}, 명망 +6, 성심 +5)`;
        }
        pres(p, -2);
        return `군중에서 큰 공을 세우지 못하고 돌아왔다. (판정 ${r} < 8, 명망 -2)`;
      }
      if (key === 'tang') {
        s.tension = clamp(s.tension - 5, 0, 100);
        fav(p, 2);
        if (s.factions.soron.active) swayFaction(s, 'soron', p.id, 5, '소론을 감쌈', 0.1);
        if (s.factions.noron.active) swayFaction(s, 'noron', p.id, -4, '역적의 당을 감쌈', 0.1);
        return '역적은 벌하되 소론 전체를 탓하지 말자고 아뢰었다. 왕이 「그 말이 과인의 뜻이다」 했다. (긴장 -5, 성심 +2)';
      }
      s.tension = clamp(s.tension + 6, 0, 100);
      fav(p, -3);
      if (s.factions.noron.active) swayFaction(s, 'noron', p.id, 5, '역당을 치자 함', 0.1);
      if (s.factions.soron.active) swayFaction(s, 'soron', p.id, -8, '소론을 모두 쳐내자 함', 0.1);
      return '소론을 모두 쳐내자고 아뢰었다. 노론은 반겼으나 왕의 낯빛이 굳었다. (긴장 +6, 성심 -3)';
    },
  },
  later_banjeong_invite: {
    build: (s) => {
      const kim = figure(s, 'kim_ryu');
      const k = s.chars[kingId(s)];
      const sins: string[] = [];
      // 임해군이 왕으로 승하했다면 광해군이 형을 죽인 것이 아니다
      if (k?.id === 'gwanghae' && s.chars.imhae?.status === 'dead' && !String(s.flags.reignsDone ?? '').includes('임해군')) sins.push('형을 죽이고');
      if (kingStyle(s) === 'volatile') sins.push('바른 말 하는 신하를 함부로 내쳤으며');
      sins.push('어머니를 서궁에 가두었으며');
      return {
        title: '반정의 밀약',
        kind: 'danger',
        text: `밤늦게 ${kim ? josa(kim.name, '이/가') : '서인의 중진이'} 사랑방 문을 닫고 말한다. "임금이 ${sins.join(' ')} 오랑캐에 붙어 명의 은혜를 저버렸소. 능양군을 받들어 거사하려 하니 그대도 함께하시오."\n\n발각되면 삼족이 멸한다. 성공하면 공신이 된다. 거사는 다음 달이다.`,
        choices: [
          { key: 'join', label: '거사에 가담한다', hint: '반정이 성공하면 정사공신: 성심 +15, 명망 +5, 공신전 3결' },
          { key: 'refuse', label: '신하가 임금을 몰아낼 수 없다며 빠진다', hint: '명망 +2. 반정 뒤 새 임금이 미덥지 않게 본다 (성심 -5)' },
          { key: 'report', label: `${kingNameNow(s)}에게 거사를 고변한다`, hint: '반정이 성공하면 새 조정이 원수로 본다: 성심 -20, 당의 깊은 원한, 절반의 확률로 귀양' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      s.flags.banjeongSide = key;
      if (key === 'join') return '거사에 이름을 올렸다. 이제 돌이킬 수 없다.';
      if (key === 'refuse') {
        pres(p, 2);
        return '거사에서 빠지겠다고 했다. 상대가 차갑게 웃었다. "그럼 오늘 일은 듣지 못한 것으로 하시오."';
      }
      log(s, `${josa(p.name, '이/가')} 반정 모의를 대궐에 고변했다. 그러나 ${josa(kingNameNow(s), '은/는')} 대수롭지 않게 여겼다.`, 'player');
      return '대궐에 고변했다. 그러나 왕은 「또 그런 말인가」 하고 흘려들었다.';
    },
  },
  later_byeongsin: {
    build: (s) => {
      const p = P(s);
      const intro = '왕이 송시열과 윤증 사이의 오랜 시비를 가려 노론의 손을 들었다. 소론이 받드는 윤선거의 문집 판목을 헐라는 명까지 내렸다.';
      if (p.faction === 'noron') {
        return {
          title: '병신처분',
          kind: 'court',
          text: `${intro}\n\n노론 안에서는 「이참에 소론의 뿌리를 뽑자」는 말이 나온다. 다른 이들은 처분을 받들되 일을 키우지 말자고 한다.`,
          choices: [
            { key: 'press', label: '소론을 끝까지 몰아치자고 한다', hint: '노론의 호감 +5, 소론의 호감 -6, 긴장 +3' },
            { key: 'calm', label: '처분을 받들되 일을 키우지 말자고 한다', hint: '성심 +2, 명망 +1. 노론 강경파는 조금 서운해한다 (노론 호감 -2)' },
          ],
        };
      }
      const stat = p.politics + (p.traits.includes('eloquent') ? 1 : 0);
      return {
        title: '병신처분',
        kind: 'danger',
        text: `${intro}\n\n소론의 선비들이 들끓는다. 「스승을 욕보이는 처분을 그대로 받들 수 없다」며 상소를 올리자는 이도, 지금은 몸을 낮추자는 이도 있다.`,
        choices: [
          { key: 'defend', label: '윤증 부자의 억울함을 상소한다', hint: `주사위 + 정치력 ${stat} ≥ 9면 왕이 노여움을 거둔다 (명망 +4). 아니면 성심 -6, 귀양 위험. 어느 쪽이든 소론의 호감 +8` },
          { key: 'bow', label: '처분을 받들고 몸을 낮춘다', hint: '성심 +2, 소론의 호감 -4' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'press') {
        s.tension = clamp(s.tension + 3, 0, 100);
        swayFaction(s, 'noron', p.id, 5, '소론을 몰아침', 0.1);
        swayFaction(s, 'soron', p.id, -6, '소론을 몰아침', 0.1);
        return '소론을 끝까지 몰아치자고 했다. 노론의 젊은 관원들이 박수를 쳤다. (긴장 +3)';
      }
      if (key === 'calm') {
        fav(p, 2);
        pres(p, 1);
        swayFaction(s, 'noron', p.id, -2, '처분을 키우지 않음', 0.1);
        return '처분을 받들되 일을 키우지 말자고 했다. 왕이 고개를 끄덕였다. (성심 +2, 명망 +1)';
      }
      if (key === 'bow') {
        fav(p, 2);
        swayFaction(s, 'soron', p.id, -4, '스승의 일에 침묵함', 0.1);
        return '처분을 받들고 입을 닫았다. 소론의 동료들이 등을 돌렸다. (성심 +2)';
      }
      swayFaction(s, 'soron', p.id, 8, '스승을 변호함', 0.1);
      const r = d6(s) + p.politics + (p.traits.includes('eloquent') ? 1 : 0);
      if (r >= 9) {
        pres(p, 4);
        return `상소의 글이 곧고 바르니 왕이 「그 뜻은 알겠다」며 죄를 묻지 않았다. 소론이 당신을 우러러본다. (판정 ${r}, 명망 +4)`;
      }
      fav(p, -6);
      if (chance(s, 0.3)) {
        exile(s, p);
        log(s, `${josa(p.name, '이/가')} 병신처분에 맞서는 상소를 올렸다가 귀양을 갔다.`, 'player');
        return `왕이 크게 노해 「처분을 거스르는 자」라며 귀양을 보냈다. (판정 ${r} < 9, 성심 -6)`;
      }
      return `왕이 상소를 물리치고 언짢아했다. (판정 ${r} < 9, 성심 -6)`;
    },
  },
  later_iyangseon: {
    build: () => {
      return {
        title: '이양선(異樣船)',
        kind: 'court',
        text: `충청 수사가 급히 장계를 올렸다. 돛대가 셋인 큰 배 두 척이 마량진 앞바다에 닻을 내렸고, 붉은 머리에 코가 높은 이들이 글로 무엇을 묻는데 알아볼 수 없다고 한다. 첨사가 배에 올라 보니 대포가 수십 문이요, 그들은 책 한 권을 건네고 물과 땔감을 청했다.\n\n조정에서 어찌할지 의논이 분분하다.`,
        choices: [
          { key: 'expel', label: '나라의 법대로 엄히 쫓아내자고 한다', hint: '성심 +2. 바닷가 고을이 잠시 술렁인다' },
          { key: 'supply', label: '물과 땔감을 주어 조용히 돌려보내자고 한다', hint: '명망 +1. 탈 없이 지나간다' },
          { key: 'study', label: '그들의 배와 책을 살펴 배우자고 한다', hint: '북학의 뜻. 학식 경험 +6. 척사의 무리가 「사학(邪學)에 물든 자」라 손가락질한다 (성심 -3)' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'expel') {
        fav(p, 2);
        s.regions.chungcheong.minsim = clamp(s.regions.chungcheong.minsim - 2, 0, 100);
        return '엄히 쫓아내자고 했다. 왕이 옳다 하였으나, 배는 이미 돛을 올려 떠난 뒤였다. (성심 +2)';
      }
      if (key === 'supply') {
        pres(p, 1);
        return '물과 땔감을 주어 돌려보내자고 했다. 배는 사흘 만에 남쪽으로 사라졌다. (명망 +1)';
      }
      s.player.exp.learning += 6;
      fav(p, -3);
      s.flags.iyangStudy = true;
      return '그들이 남긴 책과 배의 생김새를 적어 두자고 했다. 몇몇 젊은 선비가 몰래 찾아와 이야기를 청했지만, 조정에서는 「사학에 물든 자」라는 말이 돌았다. (학식 경험 +6, 성심 -3)';
    },
  },
  later_famine: {
    build: (s, ctx) => {
      const p = P(s);
      const home = REGION_META[p.home]?.name ?? '고향';
      return {
        title: `${ctx.name}의 구휼`,
        kind: 'danger',
        text: `${ctx.name}이 들었다. 길가에 굶어 죽은 이가 쌓이고, 살아남은 이들은 풀뿌리와 나무껍질을 벗겨 먹는다. 역병까지 돌아 고을이 텅 빈 곳도 있다.

조정이 구휼의 방도를 의논한다. 국고는 넉넉하지 않다. (국고 ${Math.round(s.realm.treasury)})`,
        choices: [
          { key: 'granary', label: '창고를 열고 세금을 덜어 주자고 한다', hint: '팔도 민심 +5, 국고 -60, 성심 +2' },
          { key: 'gongmyeong', label: '공명첩과 납속으로 재원을 마련하자고 한다', hint: '국고 +30, 팔도 민심 +2, 긴장 +2 (신분 질서가 흐트러진다는 반발), 명망 -1' },
          { key: 'self', label: `사재를 털어 ${home} 고을을 먼저 살린다 (재산 20)`, hint: `${home} 민심 +10, 명망 +5`, disabled: p.wealth >= 20 ? undefined : '재산 20이 필요하다' },
          { key: 'cut', label: '나라 살림부터 지켜야 한다며 구휼을 줄이자고 한다', hint: '국고 +20, 팔도 민심 -4, 명망 -3' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const all = (d: number) => {
        for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim + d, 0, 100);
      };
      if (key === 'granary') {
        all(5);
        s.realm.treasury -= 60;
        fav(p, 2);
        return '상평창과 각 고을 창고를 열고 전세와 대동미를 덜어 주었다. 굶주린 백성들이 죽을 받으려 줄을 섰다. (민심 +5, 국고 -60, 성심 +2)';
      }
      if (key === 'gongmyeong') {
        all(2);
        s.realm.treasury += 30;
        s.tension = clamp(s.tension + 2, 0, 100);
        pres(p, -1);
        return '공명첩을 팔고 곡식을 바친 이에게 벼슬 이름을 주어 구휼미를 모았다. 「상놈도 첨지가 된다」는 말에 양반들이 혀를 찬다. (국고 +30, 민심 +2, 명망 -1)';
      }
      if (key === 'self') {
        p.wealth -= 20;
        s.regions[p.home].minsim = clamp(s.regions[p.home].minsim + 10, 0, 100);
        pres(p, 5);
        s.player.deeds.push(`${yearOf(s.t)} 사재를 털어 고향의 기민을 구휼함`);
        log(s, `${josa(p.name, '이/가')} 사재를 털어 고향 고을의 굶주린 백성을 먹였다.`, 'player');
        return '집안의 곡식을 모두 풀어 고을 사람들에게 죽을 쑤어 먹였다. 고을 사람들이 송덕비를 세우자고 한다. (재산 -20, 명망 +5)';
      }
      all(-4);
      s.realm.treasury += 20;
      pres(p, -3);
      return '구휼을 줄이자고 했다. 국고는 지켰으나, 굶어 죽는 백성을 외면했다는 말이 돈다. (민심 -4, 국고 +20, 명망 -3)';
    },
  },
  later_omen_warn: {
    build: (s, ctx) => {
      const p = P(s);
      const fname = FACTION_META[ctx.faction as FactionId]?.name ?? '당';
      return {
        title: '환국의 기운',
        kind: 'danger',
        text: `${ctx.text}

판이 뒤집히면 ${fname}의 요인들이 한꺼번에 쫓겨난다. ${officeTitle(p)} 자리에 있는 당신도 무사하리라는 보장이 없다. 어떻게 할 것인가.`,
        choices: [
          { key: 'stand', label: '당과 함께 버틴다', hint: `${fname}의 호감 +5. 환국이 오면 그대로 맞는다` },
          { key: 'distance', label: '당론과 거리를 두고 몸을 낮춘다', hint: `한 해 동안 환국에 휩쓸릴 확률 -30%p. ${fname}의 호감 -4` },
          { key: 'retire', label: '병을 핑계로 미리 물러나 낙향한다', hint: '관직을 내려놓는다. 환국의 화를 피하고 기미를 안다는 평을 듣는다 (명망 +2)' },
          { key: 'king', label: '왕의 뜻을 살펴 당의 전횡을 먼저 비판한다', hint: `성심 +6, 한 해 동안 환국에 휩쓸릴 확률 -30%p. ${fname}의 깊은 원한 (호감 -12)` },
        ],
      };
    },
    resolve(s, ctx, key) {
      const p = P(s);
      const f = ctx.faction as FactionId;
      if (key === 'stand') {
        swayFaction(s, f, p.id, 5, '어려울 때 당과 함께함', 0.1);
        return '당과 함께 버티기로 했다. 동지들이 당신의 손을 굳게 잡았다.';
      }
      if (key === 'distance') {
        s.flags.distanced = s.t;
        swayFaction(s, f, p.id, -4, '당론과 거리를 둠', 0.1);
        return '당의 모임에 발길을 줄이고 말을 아꼈다. 동지들이 서운해한다.';
      }
      if (key === 'retire') {
        if (p.office) vacate(s, p, 'retired');
        p.status = 'retired';
        p.location = p.home;
        pres(p, 2);
        return '병을 핑계로 사직하고 고향으로 내려갔다. 「기미를 아는 사람」이라는 말이 남았다.';
      }
      s.flags.distanced = s.t;
      fav(p, 6);
      swayFaction(s, f, p.id, -12, '당을 등지고 왕에게 붙음', 0.15);
      return '당의 전횡을 비판하는 차자를 올렸다. 왕이 고개를 끄덕였으나, 동지들은 당신을 배신자라 부른다.';
    },
  },
  later_hwaseong: {
    build: (s) => ({
      title: '화성 축성',
      kind: 'court',
      text: `정조가 수원 팔달산 아래에 새 성을 쌓겠다고 한다. ${s.flags.sadoAlive ? '선왕인 아버지 장조의 능을' : '아버지 사도세자의 원소(현륭원)를'} 지키고, 장용영 외영을 두어 왕의 군대를 기를 성이다. 「백성을 억지로 부리지 말고 품삯을 주라」는 하교가 내려왔다. 벽파는 국고를 축내는 일이라며 수군거린다.`,
      choices: [
        { key: 'supervise', label: '감동(監董)을 자원해 공사를 맡는다', hint: '성심 +6, 명망 +3. 성이 완공되면 공을 인정받는다 (명망 +3)' },
        { key: 'wage', label: '품삯을 넉넉히 주어 백성의 원망을 사지 말자고 아뢴다', hint: '국고 -20, 경기 민심 +5, 성심 +3' },
        { key: 'oppose', label: '나라 살림을 축낸다며 반대한다', hint: '성심 -5. 벽파(노론)의 호감 +4' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'supervise') {
        fav(p, 6);
        pres(p, 3);
        s.flags.hwaseongBy = p.id;
        return `감동을 맡아 수원으로 내려갔다. ${figure(s, 'jeong_yakyong') ? `${figure(s, 'jeong_yakyong')!.name}이 고안한 ` : '새로 고안한 '}거중기와 녹로가 돌을 들어 올린다. (성심 +6, 명망 +3)`;
      }
      if (key === 'wage') {
        s.realm.treasury -= 20;
        s.regions.gyeonggi.minsim = clamp(s.regions.gyeonggi.minsim + 5, 0, 100);
        fav(p, 3);
        return '품삯을 넉넉히 주자고 아뢰었다. 일꾼들이 스스로 모여들어 공사가 빨라졌다. (국고 -20, 경기 민심 +5, 성심 +3)';
      }
      fav(p, -5);
      if (s.factions.noron.active) swayFaction(s, 'noron', p.id, 4, '화성 축성에 반대함', 0.1);
      return '국고를 축내는 일이라며 반대했다. 왕의 낯빛이 차가워졌다. (성심 -5)';
    },
  },
  later_imo: {
    build: (s) => ({
      title: '임오화변(壬午禍變)',
      kind: 'danger',
      text: '영조가 세자를 창경궁 휘령전 앞에 불러 뒤주에 들어가라 명했다. 대신들은 엎드려 떨고, 세손이 할아버지의 옷자락을 붙잡고 운다.',
      choices: [
        { key: 'save', label: '목숨을 걸고 세자를 구명한다', hint: `주사위 + 정치력/2 + 지위·명망 ${saveBonus(s)} ≥ 9면 왕이 노여움을 거둔다(역사가 바뀐다). 아니면 성심 -15, 명망 +8. 어느 쪽이든 세손이 기억할 것이다` },
        { key: 'silent', label: '엎드려 입을 다문다', hint: '아무 일도 없다' },
        { key: 'side', label: '세자의 비행은 사실이라 아뢴다', hint: '성심 +6, 명망 -6. 세손이 즉위하면 미움을 산다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      s.flags.imo = key;
      if (key === 'save') {
        const r = d6(s) + saveBonus(s);
        if (r >= 9) {
          s.flags.sadoAlive = true;
          pres(p, 10);
          fav(p, -8);
          log(s, `임오년의 위기: 영조가 세자를 뒤주에 가두려다 ${josa(p.name, '이/가')} 목숨을 걸고 간하자 노여움을 거두었다. 세자는 근신하라는 명을 받았다.`, 'history');
          return `머리를 찧어 피를 흘리며 간했다. 왕이 한참을 말없이 서 있다가 「물러가라」 하고 돌아섰다. 세자가 살았다. (판정 ${r} ≥ 9, 명망 +10, 성심 -8)`;
        }
        log(s, '임오화변: 영조가 세자를 뒤주에 가두었다. 여드레 만에 세자가 죽었다(사도세자).', 'history');
        fav(p, -15);
        pres(p, 8);
        return `세자를 구명하다 왕의 노여움을 샀다. 그러나 세손이 당신을 보았다. (판정 ${r} < 9)`;
      }
      log(s, '임오화변: 영조가 세자를 뒤주에 가두었다. 여드레 만에 세자가 죽었다(사도세자).', 'history');
      if (key === 'side') {
        fav(p, 6);
        pres(p, -6);
        return '세자의 비행을 아뢰었다.';
      }
      return '엎드려 입을 다물었다.';
    },
  },
};

/** 세자를 구명하는 판정의 보탬: 정치력의 절반, 대신이면 +2, 명망이 높으면 +1 */
function saveBonus(s: GameState) {
  const p = P(s);
  return Math.floor(p.politics / 2) + (p.rank <= 2 ? 2 : 0) + (p.prestige >= 60 ? 1 : 0);
}

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

