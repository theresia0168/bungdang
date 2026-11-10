import type { Character, Flaw, GameState, LogKind } from './types';
import { OFFICE_MAP, rankLabel } from './data/offices';
import { REGION_META } from './data/meta';
import { yearOf } from './calendar';

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const P = (s: GameState) => s.chars[s.player.charId];
export const isP = (s: GameState, c: Character | undefined) => !!c && c.id === s.player.charId;
export const C = (s: GameState, id: string | undefined): Character | undefined => (id ? s.chars[id] : undefined);
export const alive = (c: Character | undefined): c is Character => !!c && c.status !== 'dead';
export const inCourt = (c: Character) => c.status === 'active' || c.status === 'idle';

export function people(s: GameState) {
  return Object.values(s.chars).filter((c) => c.status !== 'dead' && c.status !== 'royal');
}

export const age = (s: GameState, c: Character) => yearOf(s.t) - c.born;

export function uid(s: GameState, prefix: string) {
  s.nextId += 1;
  return `${prefix}${s.nextId}`;
}

export function log(s: GameState, text: string, kind: LogKind = 'court') {
  s.log.push({ t: s.t, text, kind });
  // 역사·나·붕당 기록은 남기고, 조정 소식·부고 같은 잦은 기록부터 지운다
  while (s.log.length > LOG_CAP) {
    const i = s.log.findIndex((e) => !KEEP_LOG.includes(e.kind));
    s.log.splice(i < 0 ? 0 : i, 1);
  }
}

const LOG_CAP = 1000;
const KEEP_LOG: LogKind[] = ['history', 'player', 'faction'];

/** 명망을 더한다 (0~100) */
export const pres = (c: Character, v: number) => (c.prestige = clamp(c.prestige + v, 0, 100));
/** 성심을 더한다 (-100~100) */
export const fav = (c: Character, v: number) => (c.favor = clamp(c.favor + v, -100, 100));

/** flags[key]에 적어 둔 달로부터 몇 달이 지났는가. 적힌 적이 없으면 아주 오래전으로 본다. */
export const monthsSince = (s: GameState, key: string) => s.t - (typeof s.flags[key] === 'number' ? (s.flags[key] as number) : -999);

export function pushEvent(s: GameState, def: string, ctx: Record<string, any> = {}) {
  s.pending.push({ id: uid(s, 'ev'), def, ctx });
}

export function notice(s: GameState, title: string, text: string, kind = 'notice') {
  pushEvent(s, 'notice', { title, text, kind });
}

export function addFlaw(s: GameState, c: Character, label: string, pub = false, knownBy: string[] = []): Flaw {
  const f: Flaw = { id: uid(s, 'f'), label, public: pub, knownBy: [...knownBy], t: s.t };
  c.flaws.push(f);
  return f;
}

/** id가 플레이어에게 신세를 n번 진다 */
export function owe(s: GameState, id: string, n = 1) {
  if (id === s.player.charId) return;
  const d = s.player.debts;
  d[id] = Math.min(3, (d[id] ?? 0) + n);
}

/** 신세를 하나 갚게 한다. 진 신세가 없으면 false */
export function collect(s: GameState, id: string): boolean {
  const d = s.player.debts;
  if (!d[id]) return false;
  d[id]--;
  if (!d[id]) delete d[id];
  return true;
}

export const knownFlaws = (c: Character, viewer: string) => c.flaws.filter((f) => f.public || f.knownBy.includes(viewer));
export const hiddenFlaws = (c: Character) => c.flaws.filter((f) => !f.public);

export function officeTitle(c: Character): string {
  if (!c.office) return c.status === 'royal' ? '왕실' : c.status === 'idle' ? (c.rank === 1 ? '원임대신' : '보직 대기') : c.status === 'retired' ? '낙향' : '무직';
  if (c.office === 'nanggwan') return `낭관 (${rankLabel(c.rank)})`;
  if (c.office === 'suryeong') return `${REGION_META[c.location].short} 수령`;
  return OFFICE_MAP[c.office]?.name ?? c.office;
}

export function statusLabel(c: Character): string {
  switch (c.status) {
    case 'active':
      return '재직';
    case 'idle':
      return '대기';
    case 'retired':
      return '낙향';
    case 'exiled':
      return c.exilePlace ? `유배 (${c.exilePlace})` : '유배';
    case 'dead':
      return '졸';
    case 'royal':
      return '왕실';
  }
}

/** 받침에 따라 조사를 붙인다. pair 예: '이/가', '은/는', '을/를', '과/와', '으로/로' */
export function josa(word: string, pair: string): string {
  const [a, b] = pair.split('/');
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return word + b;
  const jong = code % 28;
  if (a === '으로') return word + (jong === 0 || jong === 8 ? '로' : '으로');
  return word + (jong ? a : b);
}
