import type { Character, GameState, RegionId } from './types';
import { addPrep } from './realm';
import type { Choice } from './events/types';
import { FACTION_META } from './data/meta';
import { chance, d6 } from './rng';
import { addFlaw, alive, clamp, fav, josa, owe, P, pres } from './state';
import { sway, swayFaction, topOf } from './opinion';
import { activeFactions } from './factions';
import { kingLean, kingMood } from './king';

/* ───────── 장면(scene) ─────────
 * 지방관·직무 사건처럼 「선택지 → 수치 변화」로만 이루어진 사건을 데이터로 적는다.
 * 선택지의 힌트와 결과 문구의 수치는 효과(Fx)에서 자동으로 만들어지므로, 숫자를 두 번 적지 않는다.
 */

type Ctx = Record<string, any>;
type Num = number | ((s: GameState, c: Ctx) => number);

export interface Fx {
  /** 결과로 보이는 한 문장 */
  say: string;
  wealth?: Num;
  prestige?: number;
  favor?: number;
  /** 지금 있는 도(또는 minsimAt)의 민심 */
  minsim?: number;
  minsimAt?: RegionId;
  /** 팔도 전체의 민심 */
  minsimAll?: number;
  prep?: number;
  tension?: number;
  /** 용안 */
  mood?: number;
  /** 왕의 마음이 내 당으로 기우는 정도 (음수면 견제) */
  lean?: number;
  learnExp?: number;
  polExp?: number;
  /** 같은 당 호감 */
  party?: number;
  /** 다른 당 호감 */
  others?: number;
  /** 숨은 흠결이 생길 확률 */
  flaw?: { label: string; p: number; public?: boolean; whoKnows?: boolean };
  /** ctx.who가 신세를 진다 */
  owe?: boolean;
  /** ctx.who의 호감 (clan: 가문에 번지는 비율) */
  who?: { v: number; clan?: number };
  /** 병을 얻을 확률 */
  sick?: number;
  /** 수치로 적기 어려운 나머지 */
  run?(s: GameState, c: Ctx): string | void;
  /** 힌트에 덧붙일 말 (run이 하는 일 설명) */
  note?: string;
}

export interface Opt {
  key: string;
  label: string | ((s: GameState, c: Ctx) => string);
  /** 재산이 드는 선택지. 모자라면 고를 수 없다. */
  cost?: number;
  disabled?(s: GameState, c: Ctx): string | undefined;
  fx?: Fx;
  /** 주사위 판정 */
  roll?: { stat: 'politics' | 'learning' | 'mixed'; need: number; ok: Fx; fail: Fx };
  /** 운 */
  odds?: { p: number | ((s: GameState) => number); yes: Fx; no: Fx };
}

export interface Scene {
  id: string;
  title: string;
  text(s: GameState, c: Ctx): string;
  opts(s: GameState, c: Ctx): Opt[];
  when?(s: GameState, office?: string): boolean;
  weight?(s: GameState): number;
  /** 지방 사건이 일어나는 도 */
  regions?: RegionId[];
  setup?(s: GameState): Ctx | null;
  /** 결정을 내릴 때 상황이 바뀌었으면 그 사유 */
  stale?(s: GameState, c: Ctx): string | null;
}

const num = (s: GameState, c: Ctx, v: Num | undefined) => (typeof v === 'function' ? v(s, c) : (v ?? 0));
const sg = (v: number) => (v > 0 ? `+${v}` : `${v}`);
const who = (s: GameState, c: Ctx): Character | undefined => (c.who ? s.chars[c.who] : undefined);
// 전장의 판정(정치력+강건)에는 무재(武才)가 +1
const statOf = (p: Character, k: 'politics' | 'learning' | 'mixed') => (k === 'mixed' ? Math.round((p.politics + p.vigor) / 2) + (p.traits.includes('martial') ? 1 : 0) : p[k]);
const STAT_NAME = { politics: '정치력', learning: '학식', mixed: '정치력+강건' } as const;

/** 효과를 사람이 읽을 말로 */
export function describe(s: GameState, c: Ctx, fx: Fx): string {
  const out: string[] = [];
  const w = num(s, c, fx.wealth);
  if (w) out.push(`재산 ${sg(w)}`);
  if (fx.prestige) out.push(`명망 ${sg(fx.prestige)}`);
  if (fx.favor) out.push(`성심 ${sg(fx.favor)}`);
  if (fx.minsim) out.push(`민심 ${sg(fx.minsim)}`);
  if (fx.minsimAll) out.push(`팔도 민심 ${sg(fx.minsimAll)}`);
  if (fx.prep) out.push(`남쪽 방비 ${sg(fx.prep)}`);
  if (fx.tension) out.push(`긴장 ${sg(fx.tension)}`);
  if (fx.mood) out.push(fx.mood > 0 ? '용안이 밝아진다' : '용안이 어두워진다');
  if (fx.lean) out.push(fx.lean > 0 ? `왕의 마음이 우리 당으로 ${sg(fx.lean)}` : `왕의 견제 ${-fx.lean}`);
  if (fx.party) out.push(`같은 당 호감 ${sg(fx.party)}`);
  if (fx.others) out.push(`다른 당 호감 ${sg(fx.others)}`);
  if (fx.learnExp) out.push(`학식 경험 ${sg(fx.learnExp)}`);
  if (fx.polExp) out.push(`정치 경험 ${sg(fx.polExp)}`);
  const x = who(s, c);
  if (fx.who && x) out.push(`${x.name}${fx.who.clan ? '과 그 가문' : ''} 호감 ${sg(fx.who.v)}`);
  if (fx.owe && x) out.push(`${josa(x.name, '이/가')} 신세를 진다`);
  if (fx.flaw) out.push(`${fx.flaw.p >= 1 ? '' : `${Math.round(fx.flaw.p * 100)}% 확률로 `}「${fx.flaw.label}」 ${fx.flaw.public ? '흠결이 드러난다' : `흠결${fx.flaw.whoKnows ? '(그가 앎)' : ''}`}`);
  if (fx.sick) out.push(`${Math.round(fx.sick * 100)}% 확률로 병을 얻는다`);
  if (fx.note) out.push(fx.note);
  return out.join(', ');
}

function hintOf(s: GameState, c: Ctx, o: Opt): string {
  const p = P(s);
  if (o.roll) {
    const r = o.roll;
    const ok = describe(s, c, r.ok);
    const bad = describe(s, c, r.fail);
    return `${STAT_NAME[r.stat]} 판정 (주사위 + ${statOf(p, r.stat)} ≥ ${r.need}). 성공: ${ok || '무사'}. 실패: ${bad || '별일 없음'}.`;
  }
  if (o.odds) {
    const pr = Math.round((typeof o.odds.p === 'function' ? o.odds.p(s) : o.odds.p) * 100);
    return `${pr}%: ${describe(s, c, o.odds.yes) || '무사'} / 아니면: ${describe(s, c, o.odds.no) || '별일 없음'}`;
  }
  return o.fx ? describe(s, c, o.fx) || '아무 일도 없다' : '';
}

export function choicesOf(s: GameState, c: Ctx, sc: Scene): Choice[] {
  const p = P(s);
  return sc.opts(s, c).map((o) => {
    const label = typeof o.label === 'function' ? o.label(s, c) : o.label;
    const dis = o.disabled?.(s, c) ?? (o.cost && p.wealth < o.cost ? '재산이 모자란다' : undefined);
    return { key: o.key, label: o.cost ? `${label} (재산 ${o.cost})` : label, hint: hintOf(s, c, o), disabled: dis };
  });
}

function apply(s: GameState, c: Ctx, fx: Fx, here: RegionId): string {
  const p = P(s);
  const sum = describe(s, c, { ...fx, flaw: undefined, sick: undefined, note: undefined });
  const w = num(s, c, fx.wealth);
  if (w) p.wealth += w;
  if (fx.prestige) pres(p, fx.prestige);
  if (fx.favor) fav(p, fx.favor);
  if (fx.minsim) {
    const r = s.regions[fx.minsimAt ?? here];
    r.minsim = clamp(r.minsim + fx.minsim, 0, 100);
  }
  if (fx.minsimAll) for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim + fx.minsimAll, 0, 100);
  if (fx.prep) addPrep(s, fx.prep);
  if (fx.tension) s.tension = clamp(s.tension + fx.tension, 0, 100);
  if (fx.mood) kingMood(s, fx.mood);
  if (fx.lean && p.faction !== 'none') kingLean(s, p.faction, fx.lean);
  if (fx.learnExp) s.player.exp.learning += fx.learnExp;
  if (fx.polExp) s.player.exp.politics += fx.polExp;
  if (fx.party && p.faction !== 'none') swayFaction(s, p.faction, p.id, fx.party, fx.say.slice(0, 12), 0.1);
  if (fx.others) for (const f of activeFactions(s)) if (f !== p.faction && topOf(f) !== topOf(p.faction)) swayFaction(s, f, p.id, fx.others, fx.say.slice(0, 12), 0.1);
  const x = who(s, c);
  if (x && alive(x)) {
    if (fx.who) sway(s, x, p.id, fx.who.v, fx.say.slice(0, 12), { clan: fx.who.clan, decay: 0.1 });
    if (fx.owe) owe(s, x.id);
  }
  const extra: string[] = [];
  if (fx.flaw && chance(s, fx.flaw.p)) {
    addFlaw(s, p, fx.flaw.label, !!fx.flaw.public, fx.flaw.whoKnows && x ? [x.id] : []);
    if (fx.flaw.public) extra.push(`「${fx.flaw.label}」이 소문났다`);
  }
  if (fx.sick && chance(s, fx.sick)) {
    s.player.sick = true;
    extra.push('병을 얻었다');
  }
  const more = fx.run?.(s, c);
  const tail = [sum, ...extra].filter(Boolean).join(', ');
  return `${fx.say}${more ? ` ${more}` : ''}${tail ? ` (${tail})` : ''}`;
}

/** 고른 선택지를 처리하고 결과 문구를 돌려준다 */
export function resolveScene(s: GameState, sc: Scene, c: Ctx, key: string, here: RegionId): string {
  const stale = sc.stale?.(s, c);
  if (stale) return stale;
  const o = sc.opts(s, c).find((x) => x.key === key);
  if (!o) return '';
  const p = P(s);
  if (o.cost) p.wealth -= o.cost;
  if (o.roll) {
    const r = d6(s) + statOf(p, o.roll.stat);
    const res = apply(s, c, r >= o.roll.need ? o.roll.ok : o.roll.fail, here);
    return `${res} [판정 ${r}]`;
  }
  if (o.odds) {
    const pr = typeof o.odds.p === 'function' ? o.odds.p(s) : o.odds.p;
    return apply(s, c, chance(s, pr) ? o.odds.yes : o.odds.no, here);
  }
  return o.fx ? apply(s, c, o.fx, here) : '';
}

/** 「같은 당」 말이 붙는 선택지의 꼬리 */
export const partyName = (s: GameState) => (P(s).faction !== 'none' ? FACTION_META[P(s).faction].name : '');
