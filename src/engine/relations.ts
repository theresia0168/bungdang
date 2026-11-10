import type { Bond, Character, GameState, Want, WantKind } from './types';
import { chance, weighted } from './rng';
import { monthsSince, alive, clamp, inCourt, isP, josa, notice, owe, P, people, pushEvent } from './state';
import { addMod, opinion, sway, topOf } from './opinion';

/* ───────── 바람(願) ───────── */

export const WANT_META: Record<WantKind, { name: (s: GameState, w: Want) => string; how: string }> = {
  office: { name: () => '더 높은 자리', how: '천거하거나, 자리 경쟁에서 지지하거나, 문인이면 밀어주어 그가 승차하면 이루어진다.' },
  wealth: { name: () => '재물', how: '선물이 크게 통하고, 돈을 빌려 달라는 청을 들어주면 이루어진다.' },
  match: { name: () => '자녀의 좋은 혼처', how: '그의 가문과 혼담을 맺으면 이루어진다.' },
  revenge: { name: (s, w) => `${s.chars[w.about!]?.name ?? '원수'}의 몰락`, how: '그 원수를 겨눈 논핵을 이끌거나 동조해 이기면 이루어진다.' },
  recall: { name: (s, w) => `${s.chars[w.about!]?.name ?? '동지'}의 해배`, how: '신원 상소를 올리거나 사면에 찬성해 그가 풀려나면 이루어진다.' },
  learning: { name: () => '학문의 인정', how: '학식이 그 이상인 당신이 찾아가 학문을 논하면 이루어진다.' },
  peace: { name: () => '붕당의 화합', how: '당신의 조제보합 상소가 받아들여지면 이루어진다.' },
};

export const wantName = (s: GameState, c: Character) => (c.want ? WANT_META[c.want.kind].name(s, c.want) : '');
export const knowsWant = (s: GameState, c: Character) => !!c.want && s.player.knownWants.includes(c.id);

function rollWant(s: GameState, c: Character): Want | undefined {
  const opts: [Want, number][] = [];
  const t = c.traits;
  if (t.includes('greedy')) opts.push([{ kind: 'wealth', since: s.t }, 3]);
  else opts.push([{ kind: 'wealth', since: s.t }, 0.6]);
  if (inCourt(c) && c.rank >= 2) opts.push([{ kind: 'office', since: s.t }, t.includes('ambitious') ? 3 : 1.5]);
  const foe = c.grudges.find((id) => alive(s.chars[id]) && inCourt(s.chars[id]));
  if (foe) opts.push([{ kind: 'revenge', about: foe, since: s.t }, 2.5]);
  const exiled = people(s).find((x) => x.status === 'exiled' && x.id !== c.id && (x.clan === c.clan || x.id === c.teacher || (x.faction === c.faction && c.faction !== 'none' && x.prestige >= 50)));
  if (exiled && !isP(s, exiled)) opts.push([{ kind: 'recall', about: exiled.id, since: s.t }, 2]);
  if (t.includes('scholar') || t.includes('writer') || c.learning >= 6) opts.push([{ kind: 'learning', since: s.t }, 2]);
  if (t.includes('mediator')) opts.push([{ kind: 'peace', since: s.t }, 3]);
  if (c.born <= 1545) opts.push([{ kind: 'match', since: s.t }, 0.8]);
  return weighted(s, opts);
}

function wantValid(s: GameState, c: Character): boolean {
  const w = c.want;
  if (!w) return false;
  if (s.t - w.since > 48) return false;
  if (w.kind === 'revenge') {
    const x = s.chars[w.about!];
    return alive(x) && inCourt(x);
  }
  if (w.kind === 'recall') return s.chars[w.about!]?.status === 'exiled';
  if (w.kind === 'office') return inCourt(c);
  return true;
}

export function tickWants(s: GameState) {
  for (const c of people(s)) {
    if (isP(s, c) || c.status === 'exiled') continue;
    if (c.want && !wantValid(s, c)) {
      c.want = undefined;
      s.player.knownWants = s.player.knownWants.filter((id) => id !== c.id);
    }
    if (!c.want && chance(s, 0.08)) c.want = rollWant(s, c);
  }
}

export function seedWants(s: GameState) {
  for (const c of people(s)) if (!isP(s, c) && chance(s, 0.7)) c.want = rollWant(s, c);
}

/** 그의 바람을 알아낸다. 새로 알았으면 설명을 돌려준다. */
export function learnWant(s: GameState, c: Character): string {
  if (!c.want || s.player.knownWants.includes(c.id)) return '';
  s.player.knownWants.push(c.id);
  return ` ${josa(c.name, '은/는')} 「${wantName(s, c)}」을 바란다. ${WANT_META[c.want.kind].how}`;
}

/** 바람을 들어주었다 */
export function fulfill(s: GameState, c: Character | undefined, kind: WantKind, about?: string): string {
  if (!alive(c) || !c.want || c.want.kind !== kind) return '';
  if (about && c.want.about !== about) return '';
  const name = wantName(s, c);
  c.want = undefined;
  s.player.knownWants = s.player.knownWants.filter((id) => id !== c.id);
  const fx = sway(s, c, P(s).id, 25, '소원을 들어줌', { clan: 0.3, decay: 0.08, cap: 40 });
  owe(s, c.id, 2);
  notice(s, '바람을 이루어 주다', `${c.name}의 오랜 바람, 「${name}」이 당신 덕에 이루어졌다. 그가 크게 고마워하며 두 번 신세를 졌다.\n\n${fx.join(', ')}`, 'personal');
  return `${c.name}의 바람이 이루어졌다.`;
}

/** 원수 x가 몰락했다. 그 몰락에 힘을 보탰다면, x의 몰락을 바라던 이들이 고마워한다. */
export function fulfillAgainst(s: GameState, kind: 'revenge' | 'recall', aboutId: string) {
  for (const c of people(s)) if (c.want?.kind === kind && c.want.about === aboutId) fulfill(s, c, kind, aboutId);
}

export function fulfillAll(s: GameState, kind: WantKind) {
  for (const c of people(s)) if (c.want?.kind === kind && inCourt(c)) fulfill(s, c, kind);
}

/* ───────── 교유의 체감과 보는 눈 ───────── */

const recentContacts = (s: GameState, id: string) => (s.player.contacts[id] ?? []).filter((m) => s.t - m < 12).length;

/** 최근 1년 사이 같은 사람에게 거듭 교유할수록 효과가 준다 */
export const contactMult = (s: GameState, t: Character) => 1 / (1 + 0.5 * recentContacts(s, t.id));

const CONTACT_SUSPICION = { letter: 3, visit: 6, gift: 8 } as const;

/** 교유를 기록하고 그 뒷말(아첨, 내통 의심)을 돌려준다 */
export function noteContact(s: GameState, t: Character, kind: keyof typeof CONTACT_SUSPICION): string {
  const p = P(s);
  const pl = s.player;
  const n = recentContacts(s, t.id);
  pl.contacts[t.id] = [...(pl.contacts[t.id] ?? []).filter((m) => s.t - m < 12), s.t];
  const out: string[] = [];
  if (n >= 2 && t.rank <= 2 && p.rank >= t.rank + 2 && t.status === 'active' && chance(s, 0.4)) {
    p.prestige = clamp(p.prestige - 1, 0, 100);
    out.push('권문(權門)에 드나든다는 뒷말이 돈다 (명망 -1)');
  }
  if (p.faction !== 'none' && t.faction !== 'none' && topOf(p.faction) !== topOf(t.faction)) {
    const close = t.clan === p.clan || t.teacher === p.id || p.teacher === t.id;
    let v = CONTACT_SUSPICION[kind] * (p.traits.includes('mediator') ? 0.5 : 1) * (close ? 0.3 : 1);
    v = Math.round(v);
    if (v) {
      pl.suspicion = clamp(pl.suspicion + v, 0, 100);
      out.push(`당내 내통 의심 +${v}`);
    }
  }
  return out.length ? ` ${out.join('. ')}.` : '';
}

/** 다른 당 사람과 가까이 지내면 당에서 의심한다 */
export function tickSuspicion(s: GameState) {
  const p = P(s);
  const pl = s.player;
  pl.suspicion = Math.max(0, pl.suspicion - 2);
  const v = p.faction === 'none' ? 0 : -Math.round(pl.suspicion / 4);
  for (const m of s.mods) if (m.scope === 'faction' && m.label === '내통 의심' && m.about === p.id) m.value = m.holder === p.faction ? v : 0;
  if (v && !s.mods.some((m) => m.scope === 'faction' && m.holder === p.faction && m.label === '내통 의심' && m.about === p.id)) {
    addMod(s, 'faction', p.faction, p.id, '내통 의심', v, 0, 100);
  }
  if (p.faction === 'none') return;
  if (pl.suspicion >= 45 && monthsSince(s, 'confrontAt') >= 12 && chance(s, 0.2) && !s.pending.some((e) => e.def === 'suspicion_confront')) {
    s.flags.confrontAt = s.t;
    pushEvent(s, 'suspicion_confront');
  }
}

/* ───────── 맹약 ─────────
 * 예전의 지기(知己)와 맹약을 하나로 합쳤다. 청해서 맺거나(맹약 제안·밀서), 오래 가까이 지내면 저절로 맺어진다.
 */

export const BOND = {
  name: '맹약(盟約)',
  desc: '뜻을 함께하기로 한 사이. 당신의 논핵에 동조하고, 당신이 논핵당하면 구원하며, 당신을 노리는 음모를 귀띔해 준다. 그를 공격하면 배신이 된다.',
};

export const MAX_BONDS = 4;

export const bondWith = (s: GameState, id: string): Bond | undefined => s.player.bonds.find((b) => b.with === id);

export const bondCount = (s: GameState) => s.player.bonds.filter((b) => alive(s.chars[b.with])).length;

export function addBond(s: GameState, c: Character, secret = false) {
  if (bondWith(s, c.id)) return;
  s.player.bonds.push({ with: c.id, since: s.t, secret });
  addMod(s, 'char', c.id, P(s).id, BOND.name, 10, 0, 20);
}

/** 맹약을 맺은 이를 공격했다 */
export function betray(s: GameState, c: Character): string {
  const b = bondWith(s, c.id);
  if (!b) return '';
  const p = P(s);
  s.player.bonds = s.player.bonds.filter((x) => x.with !== c.id);
  for (const m of s.mods) if (m.scope === 'char' && m.holder === c.id && m.about === p.id && m.label === BOND.name) m.value = 0;
  const fx = sway(s, c, p.id, -40, '배신', { clan: 0.4, decay: 0.05 });
  if (!c.grudges.includes(p.id)) c.grudges.push(p.id);
  p.prestige = clamp(p.prestige - 6, 0, 100);
  notice(s, '배신', `맹약을 맺은 ${josa(c.name, '을/를')} 등졌다. 선비 사회가 당신의 신의를 의심한다.

명망 -6, ${fx.join(', ')}`, 'danger');
  return ' 배신이다.';
}

/** 오래 가까이 지내며 서로 아끼면 저절로 맹약이 맺어진다 */
export function tickBonds(s: GameState) {
  const p = P(s);
  s.player.bonds = s.player.bonds.filter((b) => alive(s.chars[b.with]));
  if (bondCount(s) >= MAX_BONDS || !chance(s, 0.3)) return;
  const c = people(s).find(
    (x) =>
      !isP(s, x) &&
      !bondWith(s, x.id) &&
      x.status !== 'exiled' &&
      recentContacts(s, x.id) >= 2 &&
      opinion(s, x, p) >= 60 &&
      opinion(s, p, x) >= 30,
  );
  if (!c) return;
  const cross = p.faction !== 'none' && c.faction !== 'none' && topOf(p.faction) !== topOf(c.faction);
  addBond(s, c, cross);
  notice(s, '뜻을 같이하다', `${josa(c.name, '과/와')} 오가는 사이 서로를 알아보게 되었다. 이제 둘은 맹약을 맺은 사이다.${cross ? ' 당색이 달라 세상에는 비밀이다.' : ''}

${BOND.desc}`, 'personal');
}

/** 공방이 열리면 저절로 플레이어 편에 서는 이들: 맹약을 맺은 이와 문인 */
export function sworn(s: GameState, side: 'pro' | 'con'): Character[] {
  const p = P(s);
  const ids = new Set<string>();
  for (const b of s.player.bonds) ids.add(b.with);
  for (const c of people(s)) if (c.teacher === p.id) ids.add(c.id);
  return [...ids].map((id) => s.chars[id]).filter((c): c is Character => alive(c) && inCourt(c));
}
