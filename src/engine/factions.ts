import type { Character, FactionId, GameState } from './types';
import { bibyeonWeight } from './kwanje';
import { OFFICE_MAP } from './data/offices';
import { FACTION_META, REGION_META } from './data/meta';
import { chance } from './rng';
import { isP, josa, log, P, people, pushEvent } from './state';
import { opinion } from './opinion';

export const MAIN_FACTIONS: FactionId[] = ['dong', 'seo', 'nam', 'buk', 'noron', 'soron'];

export const activeFactions = (s: GameState) => MAIN_FACTIONS.filter((f) => s.factions[f].active);
export const members = (s: GameState, f: FactionId) => people(s).filter((c) => c.faction === f);

export function officePower(s: GameState): Record<FactionId, number> {
  const p: Record<FactionId, number> = { dong: 0, seo: 0, nam: 0, buk: 0, noron: 0, soron: 0, none: 0 };
  for (const c of people(s)) {
    if (c.status !== 'active' || !c.office) continue;
    const o = OFFICE_MAP[c.office];
    if (o) p[c.faction] += o.weight * bibyeonWeight(s, o);
  }
  for (const [id, v] of Object.entries(s.kyeom ?? {})) {
    const c = s.chars[v.who];
    const o = OFFICE_MAP[id];
    if (c && o && (c.status === 'active' || c.status === 'idle')) p[c.faction] += o.weight * bibyeonWeight(s, o);
  }
  return p;
}

export function powerShare(s: GameState): Record<FactionId, number> {
  const p = officePower(s);
  const total = Object.values(p).reduce((a, b) => a + b, 0) || 1;
  return { dong: p.dong / total, seo: p.seo / total, nam: p.nam / total, buk: p.buk / total, noron: p.noron / total, soron: p.soron / total, none: p.none / total };
}

/** 당내 영향력. 가장 높은 인물이 영수가 된다. */
export function influence(s: GameState, c: Character): number {
  if (c.status === 'dead' || c.status === 'royal') return 0;
  const w = c.office ? (OFFICE_MAP[c.office]?.weight ?? 1) : 0;
  let v = w * 1.5 + c.prestige / 10 + c.politics + c.learning * 0.5;
  if (isP(s, c)) v += s.player.disciples * 0.5 + (Number(s.flags.leaderBoostUntil ?? 0) > s.t ? 6 : 0);
  if (c.founder) v += 4;
  if (c.status === 'exiled') v *= 0.4;
  else if (c.status === 'retired') v *= 0.7;
  return Math.round(v * 10) / 10;
}

export function updateLeaders(s: GameState) {
  for (const f of MAIN_FACTIONS) {
    const st = s.factions[f];
    if (!st.active) {
      st.leader = undefined;
      continue;
    }
    // 후계 다툼에서 이긴 영수는 정해진 동안 자리를 지킨다
    const cur = st.leader ? s.chars[st.leader] : undefined;
    if ((st.lockUntil ?? 0) > s.t && cur && cur.status !== 'dead' && cur.status !== 'exiled' && cur.faction === f) continue;
    let best: Character | undefined;
    let bv = -1;
    for (const c of members(s, f)) {
      const v = influence(s, c);
      if (v > bv) {
        bv = v;
        best = c;
      }
    }
    const prev = st.leader;
    st.leader = best?.id;
    if (best && prev && prev !== best.id && s.t > 0) {
      log(s, `${josa(best.name, '이/가')} ${FACTION_META[f].name}의 새 영수로 떠올랐다.`, 'faction');
    }
  }
}

/** 당내 평판: 같은 당 인물들이 플레이어를 보는 평균 호감 */
export function standing(s: GameState, f: FactionId): number {
  const p = P(s);
  const ms = members(s, f).filter((c) => c.id !== p.id && c.status !== 'exiled');
  if (!ms.length) return 0;
  return Math.round(ms.reduce((a, c) => a + opinion(s, c, p), 0) / ms.length);
}

export function checkSplit(s: GameState) {
  const dong = s.factions.dong;
  if (!dong.active || !s.flags.splitReady) return;
  const leader = dong.leader ? s.chars[dong.leader] : undefined;
  const li = leader ? influence(s, leader) : 0;
  if (dong.division > li) splitDong(s);
}

export function splitDong(s: GameState) {
  const p = P(s);
  const wasDong = p.faction === 'dong';
  for (const c of Object.values(s.chars)) {
    if (c.faction !== 'dong') continue;
    if (!c.lean) c.lean = c.school === 'toegye' ? 'nam' : c.school === 'none' ? (chance(s, 0.5) ? 'nam' : 'buk') : 'buk';
    c.faction = c.lean;
  }
  s.factions.dong.active = false;
  s.factions.nam.active = true;
  s.factions.buk.active = true;
  s.factions.dong.division = 0;

  const extra = [];
  for (const m of s.mods) {
    if (m.scope === 'faction' && m.holder === 'dong') {
      m.holder = 'nam';
      s.nextId += 1;
      extra.push({ ...m, id: `m${s.nextId}`, holder: 'buk' });
    }
  }
  s.mods.push(...extra);

  for (const r of Object.values(s.regions)) {
    const d = r.influence.dong ?? 0;
    const w = Object.fromEntries(REGION_META[r.id].schools);
    const t = w.toegye ?? 0;
    const b = (w.nammyeong ?? 0) + (w.hwadam ?? 0);
    const n = w.none ?? 0;
    const namShare = t + b + n > 0 ? (t + n * 0.5) / (t + b + n) : 0.5;
    r.influence.nam = Math.round(d * namShare);
    r.influence.buk = d - (r.influence.nam ?? 0);
    delete r.influence.dong;
  }
  log(s, '동인이 남인과 북인으로 갈라섰다. 정철의 처벌을 두고 온건론과 강경론이 맞선 끝이었다.', 'faction');
  updateLeaders(s);
  if (wasDong) pushEvent(s, 'dong_split', {});
}
