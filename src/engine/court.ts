import type { Character, GameState, RegionId, Status } from './types';
import { OFFICES, OFFICE_MAP, type OfficeDef } from './data/offices';
import { REGION_META } from './data/meta';
import { chance, rand, randInt, weighted } from './rng';
import { age, alive, isP, josa, log, notice, owe, P, people, pushEvent } from './state';
import { opinion, sway } from './opinion';
import { fulfill } from './relations';
import { powerShare } from './factions';
import { genChar } from './generate';
import { shortDate } from './calendar';
import { FACTION_META } from './data/meta';

export function holderMap(s: GameState): Record<string, Character> {
  const m: Record<string, Character> = {};
  for (const c of Object.values(s.chars)) {
    if (c.status === 'active' && c.office && OFFICE_MAP[c.office]) m[c.office] = c;
  }
  return m;
}

export const holderOf = (s: GameState, id: string): Character | undefined => holderMap(s)[id];

function noteLeft(s: GameState, c: Character) {
  if (!c.office || !OFFICE_MAP[c.office]) return;
  (c.leftOffices ??= {})[c.office] = s.t;
  const last = OFFICE_MAP[c.office];
  if (last.group === 'gamsa') c.leftOffices.gamsa = s.t;
}

export function vacate(s: GameState, c: Character, to: Status = 'idle') {
  noteLeft(s, c);
  c.office = undefined;
  c.tenure = 0;
  c.status = to;
  if (to === 'idle') c.location = 'hanseong';
  if (to === 'retired') c.location = c.home;
}

function notePeak(s: GameState, c: Character, rank: number, name: string) {
  if (!isP(s, c)) return;
  const pl = s.player;
  if (rank <= pl.peakRank) {
    pl.peakRank = rank;
    pl.peakOffice = name;
  }
  const lastPost = [...pl.deeds].reverse().find((d) => d.endsWith(' 제수') || d.endsWith(' 부임'));
  if (lastPost?.endsWith(` ${name} 제수`)) return;
  pl.deeds.push(`${shortDate(s.t)} ${name} 제수`);
}

export function appoint(s: GameState, c: Character, officeId: string, quiet = false) {
  const o = OFFICE_MAP[officeId];
  const prev = holderOf(s, officeId);
  if (prev && prev.id !== c.id) vacate(s, prev);
  noteLeft(s, c);
  c.office = officeId;
  c.status = 'active';
  c.tenure = 0;
  if (o.rank < c.rank) {
    c.rank = o.rank;
    c.promotedAt = s.t;
  }
  c.location = o.region ?? 'hanseong';
  c.exilePlace = undefined;
  notePeak(s, c, o.rank, o.name);
  if (c.want?.kind === 'office' && (s.player.cooldowns[`backed:${c.id}`] ?? 0) > s.t) fulfill(s, c, 'office');
  if (!quiet && (o.rank <= 3 || o.cheongyo || isP(s, c))) {
    log(s, `${josa(c.name, '이/가')} ${o.name}에 제수되었다. (${FACTION_META[c.faction].name})`, isP(s, c) ? 'player' : 'court');
  }
}

export function appointGeneric(s: GameState, c: Character, kind: 'nanggwan' | 'suryeong', region?: RegionId) {
  noteLeft(s, c);
  c.office = kind;
  c.status = 'active';
  c.tenure = 0;
  c.location = kind === 'suryeong' ? (region ?? 'gyeonggi') : 'hanseong';
  if (kind === 'nanggwan') c.rank = Math.min(c.rank, 9);
  if (kind === 'suryeong') c.rank = Math.min(c.rank, 6);
  if (isP(s, c)) {
    const name = kind === 'nanggwan' ? '낭관' : `${REGION_META[c.location].short} 수령`;
    s.player.deeds.push(`${shortDate(s.t)} ${name} 부임`);
  }
}

export const PROMOTION_GAP = 30;
/** 지금 자리에서 이만큼은 있어야 다른 자리로 옮길 수 있다 */
export const MIN_TENURE = 6;

/** 이 관직에 오르려면 갖춰야 할 최소 품계 */
export const minRankFor = (officeRank: number) => (officeRank <= 1 ? 2 : officeRank === 2 ? 3 : officeRank === 3 ? 5 : officeRank === 4 ? 6 : 9);

/** 품계가 오른 뒤에는 그보다 낮은 자리에 앉지 않는다. 참하관(6품 이하)은 따지지 않는다. */
export const lowestOfficeFor = (rank: number) => (rank <= 5 ? rank : 9);

/** 같은 자리로 곧바로 돌아가지 않는다 */
export function cooldownLeft(s: GameState, c: Character, o: OfficeDef): number {
  const left = c.leftOffices;
  if (!left) return 0;
  let until = 0;
  if (left[o.id] !== undefined) until = left[o.id] + (o.rank === 1 ? 12 : o.group === 'gamsa' ? 48 : 24);
  if (o.group === 'gamsa' && left.gamsa !== undefined) until = Math.max(until, left.gamsa + 12);
  return Math.max(0, until - s.t);
}

export function eligible(s: GameState, c: Character, o: OfficeDef): boolean {
  if (c.status !== 'active' && c.status !== 'idle') return false;
  if (c.traits.includes('seoeol') && !s.flags.seoeolOpen) return false;
  if ((c.banUntil ?? 0) > s.t) return false;
  if (age(s, c) < 20) return false;
  if (c.office === o.id) return false;
  const cur = c.office ? OFFICE_MAP[c.office] : undefined;
  if (cur && cur.rank <= o.rank) return false;
  // 자리에 앉자마자 다른 자리로 옮기지 않는다
  if (c.office && c.status === 'active' && c.tenure < MIN_TENURE) return false;
  if (o.rank > lowestOfficeFor(c.rank)) return false;
  if (cooldownLeft(s, c, o) > 0) return false;
  if (c.rank > minRankFor(o.rank)) return false;
  if (c.rank > o.rank && s.t - c.promotedAt < PROMOTION_GAP) return false;
  if (o.rank === 1 && age(s, c) < 45) return false;
  if (isP(s, c)) {
    const d = s.flags[`declined_${o.id}`];
    if (typeof d === 'number' && d > s.t) return false;
    if (s.pending.some((e) => e.def === 'appointment_offer')) return false;
  }
  return true;
}

export interface ScorePart {
  label: string;
  value: number;
}

/** 임용 점수. 이조판서와 이조전랑의 호감이 크게 작용한다. */
export function appointParts(s: GameState, c: Character, o: OfficeDef, hm = holderMap(s)): ScorePart[] {
  const parts: ScorePart[] = [];
  parts.push({ label: '정치력', value: c.politics * 2 });
  parts.push({ label: '학식', value: c.learning * (o.literary ? 3 : o.samsa || o.cheongyo ? 2 : 1) });
  parts.push({ label: '명망', value: c.prestige / 12 });
  parts.push({ label: '성심', value: c.favor / (o.rank === 1 ? 6 : 12) });
  parts.push({ label: '경력', value: Math.min(3, c.tenure / 12) });
  const gap = Math.max(0, c.rank - o.rank);
  if (gap) parts.push({ label: '품계 차이', value: -gap * 1.2 });
  if (o.literary && c.learning < 5) parts.push({ label: '문형에 못 미치는 학식', value: -4 });
  const ijo = hm['ijo'];
  if (ijo && ijo.id !== c.id) parts.push({ label: `이조판서 ${ijo.name}의 호감`, value: opinion(s, ijo, c) / 15 });
  if (o.samsa || o.cheongyo) {
    const jr = hm['jeonrang'];
    if (jr && jr.id !== c.id) parts.push({ label: `이조전랑 ${jr.name}의 통청`, value: opinion(s, jr, c) / 12 });
  }
  if (c.faction !== 'none') {
    const share = powerShare(s)[c.faction] ?? 0;
    if (share < 0.3) parts.push({ label: '왕의 안배', value: 2 });
  }
  if (c.faction !== 'none' && s.flags.ijoBias === c.faction && Number(s.flags.ijoBiasUntil ?? 0) > s.t) parts.push({ label: '이조의 안배', value: 3 });
  if (c.faction !== 'none') {
    const lean = Math.round((s.king?.lean[c.faction] ?? 0) / 8);
    if (lean) parts.push({ label: '왕의 의중', value: lean });
  }
  const race = s.races?.find((r) => r.office === o.id);
  const backers = race?.backers[c.id];
  if (backers?.length) {
    const v = backers.reduce((a, id) => a + (id === s.player.charId ? 2 + s.chars[id].politics / 2 : 2), 0);
    parts.push({ label: '자리 경쟁의 지지', value: Math.round(v * 10) / 10 });
  }
  if ((s.recs[c.id] ?? -1) > s.t) parts.push({ label: '천거', value: 8 });
  if (c.traits.includes('recluse')) parts.push({ label: '은일', value: -5 });
  if (c.home === 'jeolla' && s.regions.jeolla.tags.includes('banyeok')) parts.push({ label: '반역향 출신', value: -2 });
  for (const x of s.situations ?? []) {
    if (x.kind === 'scandal' && c.faction !== 'none' && x.data.faction === c.faction) parts.push({ label: '추문의 여파', value: -2 });
    if (x.kind === 'inlaw' && c.tags.includes('inlawLink')) parts.push({ label: '외척의 입김', value: 3 });
  }
  if (isP(s, c) && s.heir && s.royal?.backing === s.heir) parts.push({ label: '세자의 사람', value: 2 });
  const pub = c.flaws.filter((f) => f.public).length;
  if (pub) parts.push({ label: '드러난 흠결', value: -pub * 1.5 });
  return parts;
}

export function appointScore(s: GameState, c: Character, o: OfficeDef, hm = holderMap(s)): number {
  return appointParts(s, c, o, hm).reduce((a, p) => a + p.value, 0) + rand(s) * 5;
}

function fallbackFor(s: GameState, o: OfficeDef): Character {
  const ageBy = o.rank <= 1 ? randInt(s, 58, 68) : o.rank <= 2 ? randInt(s, 46, 60) : o.rank <= 3 ? randInt(s, 40, 52) : randInt(s, 28, 38);
  return genChar(s, { rank: o.rank + 1, age: ageBy, status: 'idle' });
}

export function fillVacancies(s: GameState, max = 6) {
  let hm = holderMap(s);
  const vac = OFFICES.filter((o) => !hm[o.id] && !s.flags[`reserve_${o.id}`]).sort((a, b) => a.rank - b.rank);
  let filled = 0;
  for (const o of vac) {
    if (filled >= max) break;
    let best: Character | undefined;
    let bs = -Infinity;
    for (const c of people(s)) {
      if (!eligible(s, c, o)) continue;
      const sc = appointScore(s, c, o, hm);
      if (sc > bs) {
        bs = sc;
        best = c;
      }
    }
    if (!best) best = fallbackFor(s, o);
    if (isP(s, best)) {
      s.flags[`reserve_${o.id}`] = true;
      pushEvent(s, 'appointment_offer', { office: o.id });
    } else {
      appoint(s, best, o.id);
    }
    filled++;
    hm = holderMap(s);
  }
}

/** 임기 교체, 낭관 승품, 수령 귀경, 대기 인물 보직 */
export function turnover(s: GameState) {
  for (const c of people(s)) {
    if (c.status === 'idle' && !c.office) {
      c.tenure = 0;
      if (c.rank >= 6 && (c.banUntil ?? 0) <= s.t && chance(s, isP(s, c) ? 0.04 : 0.06)) {
        appointGeneric(s, c, 'nanggwan');
        if (isP(s, c)) notice(s, '보직', '이조에서 당신을 낭관으로 임명했다. 작은 자리지만 경력을 쌓을 수 있다.');
      }
      continue;
    }
    if (c.status !== 'active' || !c.office) continue;
    c.tenure++;
    const o = OFFICE_MAP[c.office];
    if (!o) {
      if (c.office === 'nanggwan' && c.rank > 6 && chance(s, 1 / 22)) c.rank--;
      if (c.office === 'suryeong' && c.tenure > 12 && chance(s, 1 / 30)) {
        vacate(s, c);
        if (isP(s, c)) notice(s, '귀경', '수령의 임기를 마치고 한성으로 돌아왔다.');
      }
      continue;
    }
    let p: number;
    if (o.fixedTerm) p = c.tenure >= o.term + 2 ? 1 : c.tenure >= o.term ? 0.6 : 0;
    else {
      const half = Math.max(4, Math.round(o.term / 2));
      p = c.tenure < half ? 0 : 1 / half;
      if (isP(s, c)) p *= 0.75;
    }
    if (s.races.some((r) => r.office === o.id)) continue;
    if (chance(s, p)) {
      if (RACE_OFFICES.includes(o.id) && startRace(s, o, c)) continue;
      vacate(s, c);
      if (isP(s, c)) {
        const next = c.rank === 1 ? ' 원임대신(原任大臣)으로서 정승 자리가 다시 나기를 기다린다.' : ' 한성에서 다음 보직을 기다린다.';
        notice(s, '체직', `${o.name}의 임기를 마치고 물러났다.${next}`);
      }
    }
  }
}

/* ───────── 자리 경쟁 ───────── */

/** 물러나기 두 달 전부터 후임 다툼이 벌어지는 요직 */
export const RACE_OFFICES = ['yeonguijeong', 'jwauijeong', 'uuijeong', 'ijo', 'hojo', 'byeongjo', 'yejo', 'daesaheon', 'daesagan', 'daejehak', 'doseungji', 'bujehak', 'jeonrang'];

export const raceFor = (s: GameState, officeId: string) => s.races.find((r) => r.office === officeId);

function startRace(s: GameState, o: OfficeDef, holder: Character): boolean {
  const hm = holderMap(s);
  const pool = people(s)
    .filter((c) => c.id !== holder.id && eligible(s, c, o))
    .map((c) => [c, appointParts(s, c, o, hm).reduce((a, x) => a + x.value, 0)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([c]) => c);
  if (pool.length < 2) return false;
  const backers: Record<string, string[]> = {};
  for (const c of pool) backers[c.id] = [];
  const seen = new Set<string>();
  for (const c of pool) {
    if (c.faction === 'none' || seen.has(c.faction)) continue;
    seen.add(c.faction);
    const lead = s.chars[s.factions[c.faction]?.leader ?? ''];
    if (alive(lead) && !isP(s, lead) && lead.id !== c.id && inCourtNow(lead)) backers[c.id].push(lead.id);
  }
  s.races.push({ office: o.id, due: s.t + 2, candidates: pool.map((c) => c.id), backers });
  // 연대기를 덮지 않도록 정승 자리와 내가 얽힌 경쟁만 기록한다
  if (o.rank === 1 || isP(s, holder) || pool.some((c) => isP(s, c)))
    log(s, `[인사] ${o.name} ${josa(holder.name, '이/가')} 곧 물러난다는 말이 돈다. 후임으로 ${pool.map((c) => c.name).join(', ')} 등이 거론된다.`, 'court');
  if (isP(s, holder)) notice(s, '물러날 때', `${o.name}의 임기가 끝나 간다. 두 달 뒤면 물러나게 된다. 후임으로 ${pool.map((c) => c.name).join(', ')} 등이 거론된다.`);
  if (pool.some((c) => isP(s, c)))
    notice(
      s,
      '자리 경쟁',
      `${o.name} ${josa(holder.name, '이/가')} 두 달 뒤 물러난다. 후임으로 당신과 ${pool.filter((c) => !isP(s, c)).map((c) => c.name).join(', ')}이 거론된다.\n\n이조판서·전랑의 호감, 천거, 왕의 의중, 그리고 누가 누구를 미느냐가 승부를 가른다. 이조의 인물에게 「천거 부탁」을 하거나 뇌물을 쓸 수도 있다.`,
      'court',
    );
  return true;
}

const inCourtNow = (c: Character) => c.status === 'active' || c.status === 'idle';

/** 플레이어가 후보 하나를 민다 */
export function raceBackError(s: GameState, officeId: string, candId: string): string | null {
  const r = raceFor(s, officeId);
  const p = P(s);
  if (!r || !r.candidates.includes(candId)) return '그런 경쟁이 없다';
  if (!inCourtNow(p) || p.status === 'exiled') return '조정에 있어야 한다';
  if (candId === p.id) return '자기 자신은 밀 수 없다';
  if (Object.values(r.backers).some((xs) => xs.includes(p.id))) return '이미 한 사람을 밀고 있다';
  if (s.player.ap < 1) return '행동력이 부족하다';
  return null;
}

export function backCandidate(s: GameState, officeId: string, candId: string): string {
  const err = raceBackError(s, officeId, candId);
  if (err) return err;
  const r = raceFor(s, officeId)!;
  const p = P(s);
  const c = s.chars[candId];
  s.player.ap -= 1;
  r.backers[candId].push(p.id);
  s.player.cooldowns[`backed:${candId}`] = r.due + 1;
  const fx = sway(s, c, p.id, 8, '자리 경쟁에서 지지', { decay: 0.1, cap: 16 });
  for (const id of r.candidates) if (id !== candId && alive(s.chars[id])) sway(s, s.chars[id], p.id, -6, '경쟁자를 밂', { decay: 0.1, cap: 12 });
  return `${OFFICE_MAP[officeId].name} 자리를 두고 ${josa(c.name, '을/를')} 밀기로 했다. 그가 오르면 신세를 진다. (${fx.join(', ')})`;
}

/** 기한이 된 경쟁: 현직을 물린다 */
export function tickRaces(s: GameState) {
  for (const r of s.races) {
    if (s.t < r.due) continue;
    const h = holderOf(s, r.office);
    if (!h) continue;
    vacate(s, h);
    if (isP(s, h)) notice(s, '체직', `${OFFICE_MAP[r.office].name}의 임기를 마치고 물러났다.`);
  }
}

/** 빈자리가 채워진 뒤: 결과를 알리고 경쟁을 닫는다 */
export function settleRaces(s: GameState) {
  const p = P(s);
  for (const r of [...s.races]) {
    if (s.t < r.due) continue;
    const w = holderOf(s, r.office);
    if (!w && s.t < r.due + 3) continue;
    s.races = s.races.filter((x) => x !== r);
    const mine = r.candidates.find((id) => r.backers[id]?.includes(p.id));
    if (!mine || !w) continue;
    const o = OFFICE_MAP[r.office];
    if (w.id === mine) {
      owe(s, w.id);
      notice(s, '지지한 이가 오르다', `당신이 밀던 ${josa(w.name, '이/가')} ${o.name}에 올랐다. 그가 신세를 졌다.`, 'personal');
    } else {
      notice(s, '자리 경쟁에서 지다', `당신이 밀던 ${s.chars[mine]?.name ?? '후보'} 대신 ${josa(w.name, '이/가')} ${o.name}에 올랐다.`, 'personal');
    }
  }
}

export function sendOut(s: GameState, c: Character, region: RegionId) {
  if (c.office && OFFICE_MAP[c.office]) vacate(s, c);
  appointGeneric(s, c, 'suryeong', region);
}

export function exileSpot(s: GameState): [RegionId, string] {
  const r = weighted(s, [
    ['hamgyeong', 3],
    ['pyeongan', 2],
    ['jeolla', 2],
    ['gyeongsang', 2],
    ['gangwon', 1],
  ] as [RegionId, number][]) as RegionId;
  const spots = REGION_META[r].exile ?? [REGION_META[r].short];
  return [r, spots[Math.floor(rand(s) * spots.length)]];
}
