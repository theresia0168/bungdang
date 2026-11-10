import type { Character, FactionId, GameState, ModScope } from './types';
import { FACTION_META } from './data/meta';
import { clamp } from './state';

export const topOf = (f: FactionId): FactionId => (f === 'nam' || f === 'buk' ? 'dong' : f);

export interface OpLine {
  label: string;
  value: number;
}

export const fmt = (v: number) => (v > 0 ? `+${v}` : `${v}`);

export function inLaws(s: GameState, a: string, b: string) {
  return s.marriages.some((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
}

/** a가 b를 어떻게 생각하는지, 이유별로 */
export function opinionLines(s: GameState, a: Character, b: Character): OpLine[] {
  const L: OpLine[] = [];
  if (a.id === b.id) return L;
  if (a.clan === b.clan) L.push({ label: '같은 가문', value: 30 });
  else if (inLaws(s, a.clan, b.clan)) L.push({ label: '혼맥', value: 15 });
  if (a.teacher === b.id) L.push({ label: '스승', value: 35 });
  if (b.teacher === a.id) L.push({ label: '문인', value: 25 });
  if (a.school === b.school && a.school !== 'none') L.push({ label: '같은 학통', value: 5 });
  if (a.faction !== 'none' && b.faction !== 'none') {
    if (a.faction === b.faction) L.push({ label: '같은 붕당', value: 15 });
    else if (topOf(a.faction) === topOf(b.faction)) L.push({ label: '남북 대립', value: -10 });
    else L.push({ label: '붕당 대립', value: -Math.round(5 + s.tension / 5) });
  }
  const at = a.traits;
  const bt = b.traits;
  if (bt.includes('inlaw') && !at.includes('inlaw')) L.push({ label: '외척 경계', value: -10 });
  if (bt.includes('mediator')) L.push({ label: '조제의 인품', value: 5 });
  if (bt.includes('schemer')) L.push({ label: '권모술수', value: -5 });
  if (bt.includes('radical') && a.faction !== b.faction) L.push({ label: '과격한 언행', value: -5 });
  if (at.includes('upright') && bt.includes('greedy')) L.push({ label: '탐욕을 경멸', value: -10 });
  if (bt.includes('clean')) L.push({ label: '청렴', value: 3 });
  const pub = b.flaws.filter((f) => f.public).length;
  if (pub) L.push({ label: '드러난 흠결', value: -pub * (at.includes('upright') ? 5 : 2) });
  if (a.grudges.includes(b.id)) L.push({ label: '설욕의 원한', value: -40 });

  for (const m of s.mods) {
    if (m.about !== b.id) continue;
    if (m.scope === 'char' && m.holder === a.id) L.push({ label: m.label, value: Math.round(m.value) });
    else if (m.scope === 'clan' && m.holder === a.clan) L.push({ label: `${m.label} (가문)`, value: Math.round(m.value) });
    else if (m.scope === 'faction' && m.holder === a.faction) L.push({ label: `${m.label} (당)`, value: Math.round(m.value) });
  }
  return L.filter((l) => l.value !== 0);
}

export function opinion(s: GameState, a: Character, b: Character): number {
  return clamp(Math.round(opinionLines(s, a, b).reduce((x, l) => x + l.value, 0)), -100, 100);
}

export function addMod(
  s: GameState,
  scope: ModScope,
  holder: string,
  about: string,
  label: string,
  value: number,
  decay = 0.3,
  cap = 60,
) {
  const ex = s.mods.find((m) => m.scope === scope && m.holder === holder && m.about === about && m.label === label);
  if (ex) {
    ex.value = clamp(ex.value + value, -cap, cap);
    ex.decay = decay;
  } else {
    s.nextId += 1;
    s.mods.push({ id: `m${s.nextId}`, scope, holder, about, label, value: clamp(value, -cap, cap), decay });
  }
}

/**
 * 한 인물에게 준 영향이 그 가문과 붕당에도 번진다.
 * clan/faction은 인물에게 준 값 대비 비율.
 */
export function sway(
  s: GameState,
  target: Character,
  aboutId: string,
  value: number,
  label: string,
  opt: { clan?: number; faction?: number; decay?: number; cap?: number } = {},
): string[] {
  const out: string[] = [];
  const decay = opt.decay ?? 0.3;
  const cap = opt.cap ?? 60;
  const v = Math.round(value);
  if (v !== 0 && target.id !== aboutId) {
    addMod(s, 'char', target.id, aboutId, label, v, decay, cap);
    out.push(`${target.name} ${fmt(v)}`);
  }
  if (opt.clan && target.clan !== '왕실') {
    const cv = Math.round(value * opt.clan);
    if (cv) {
      addMod(s, 'clan', target.clan, aboutId, label, cv, decay * 0.6, Math.round(cap * 0.5));
      out.push(`${target.clan} ${fmt(cv)}`);
    }
  }
  if (opt.faction && target.faction !== 'none') {
    const fv = Math.round(value * opt.faction);
    if (fv) {
      addMod(s, 'faction', target.faction, aboutId, label, fv, decay * 0.5, Math.round(cap * 0.4));
      out.push(`${FACTION_META[target.faction].name} ${fmt(fv)}`);
    }
  }
  return out;
}

export function swayFaction(s: GameState, f: FactionId, aboutId: string, value: number, label: string, decay = 0.15): string {
  if (f === 'none' || !value) return '';
  addMod(s, 'faction', f, aboutId, label, value, decay);
  return `${FACTION_META[f].name} ${fmt(value)}`;
}

export function decayMods(s: GameState) {
  for (const m of s.mods) {
    if (m.decay <= 0) continue;
    if (m.value > 0) m.value = Math.max(0, m.value - m.decay);
    else m.value = Math.min(0, m.value + m.decay);
  }
  s.mods = s.mods.filter((m) => Math.abs(m.value) >= 0.5 && s.chars[m.about]?.status !== 'dead');
}
