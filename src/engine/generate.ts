import type { Character, FactionId, GameState, RegionId, SchoolId, Status, TraitId } from './types';
import { CLAN_POOL, GIVEN_1, GIVEN_2 } from './data/names';
import { FLAW_POOL, REGIONS, REGION_META } from './data/meta';
import type { RosterEntry } from './data/roster';
import { chance, pick, randInt, weighted } from './rng';
import { clamp, uid } from './state';
import { yearOf } from './calendar';
import { activeFactions } from './factions';

/** 사라진 당에 들 사람을 살아 있는 당으로 돌린다 */
export function liveFaction(s: GameState, f: FactionId, c?: Character): FactionId {
  if (f === 'none' || s.factions[f]?.active) return f;
  if (f === 'dong') return liveFaction(s, c?.lean ?? (chance(s, 0.5) ? 'nam' : 'buk'), c);
  if (f === 'buk') return s.factions.nam.active ? 'nam' : 'none';
  if (f === 'seo') return s.factions.noron.active ? (chance(s, 0.6) ? 'noron' : 'soron') : 'none';
  return 'none';
}

export function regionFaction(s: GameState, r: RegionId): FactionId {
  const inf = s.regions[r].influence;
  const items: [FactionId, number][] = activeFactions(s).map((f) => [f, inf[f] ?? 0]);
  items.push(['none', 8]);
  return weighted(s, items) ?? 'none';
}

export function leanOf(s: GameState, school: SchoolId): 'nam' | 'buk' {
  if (school === 'toegye') return chance(s, 0.85) ? 'nam' : 'buk';
  if (school === 'nammyeong' || school === 'hwadam') return chance(s, 0.8) ? 'buk' : 'nam';
  return chance(s, 0.5) ? 'nam' : 'buk';
}

export function genName(s: GameState, forceSurname?: { bon: string; sur: string }) {
  const used = new Set(Object.values(s.chars).map((c) => c.name));
  for (let i = 0; i < 40; i++) {
    const [bon, sur] = forceSurname ? [forceSurname.bon, forceSurname.sur] : pick(s, CLAN_POOL);
    const g1 = pick(s, [...GIVEN_1]);
    let g2 = pick(s, [...GIVEN_2]);
    if (g2 === g1) g2 = pick(s, [...GIVEN_2]);
    const name = sur + g1 + g2;
    if (!used.has(name)) return { name, clan: `${bon} ${sur}씨` };
  }
  return { name: `무명${s.nextId}`, clan: '미상' };
}

const TRAIT_POOL: TraitId[] = ['upright', 'mild', 'radical', 'scholar', 'writer', 'schemer', 'clean', 'greedy', 'ambitious', 'eloquent', 'martial', 'cautious', 'loyal', 'timid', 'arrogant', 'sickly'];
const EXCLUSIVE: [TraitId, TraitId][] = [
  ['upright', 'greedy'],
  ['clean', 'greedy'],
  ['mild', 'radical'],
  ['timid', 'radical'],
  ['timid', 'upright'],
  ['cautious', 'radical'],
  ['arrogant', 'mediator'],
  ['arrogant', 'mild'],
  ['timid', 'arrogant'],
];

function randomTraits(s: GameState): TraitId[] {
  const n = weighted(s, [[0, 3], [1, 5], [2, 2]]) ?? 1;
  const out: TraitId[] = [];
  for (let i = 0; i < 6 && out.length < n; i++) {
    const t = pick(s, TRAIT_POOL);
    if (out.includes(t)) continue;
    if (EXCLUSIVE.some(([a, b]) => (t === a && out.includes(b)) || (t === b && out.includes(a)))) continue;
    out.push(t);
  }
  return out;
}

export function pickHome(s: GameState): RegionId {
  return weighted(s, REGIONS.map((r) => [r.id, r.weight] as [RegionId, number])) ?? 'hanseong';
}

export function pickSchool(s: GameState, home: RegionId): SchoolId {
  return weighted(s, REGION_META[home].schools) ?? 'none';
}

export interface GenOpts {
  rank: number;
  age: number;
  status: Status;
  office?: string;
  faction?: FactionId;
  home?: RegionId;
  school?: SchoolId;
  location?: RegionId;
  teacher?: string;
  learning?: number;
  name?: string;
  clan?: string;
}

export function genChar(s: GameState, o: GenOpts): Character {
  const year = yearOf(s.t);
  const home = o.home ?? pickHome(s);
  const school = o.school ?? pickSchool(s, home);
  let faction = o.faction ?? regionFaction(s, home);
  const lean = leanOf(s, school);
  if (faction === 'dong' && !s.factions.dong.active) faction = lean;
  faction = liveFaction(s, faction);
  const nm = o.name && o.clan ? { name: o.name, clan: o.clan } : genName(s);
  const born = year - o.age;
  let destiny = born + randInt(s, 55, 78);
  if (destiny <= year) destiny = year + randInt(s, 1, 8);
  const high = o.rank <= 3 ? 1 : 0;
  const c: Character = {
    id: uid(s, 'c'),
    name: nm.name,
    clan: nm.clan,
    born,
    destiny,
    checkMonth: randInt(s, 1, 12),
    faction,
    lean,
    school,
    home,
    location: o.location ?? (o.status === 'retired' ? home : 'hanseong'),
    status: o.status,
    office: o.office,
    rank: o.rank,
    promotedAt: s.t - randInt(s, 0, 36),
    tenure: randInt(s, 0, 24),
    learning: o.learning ?? clamp(randInt(s, 2, 5) + high, 1, 7),
    politics: clamp(randInt(s, 1, 4) + high + (o.rank <= 1 ? 1 : 0), 1, 7),
    vigor: randInt(s, 2, 5),
    prestige: clamp((10 - Math.min(o.rank, 9)) * 4 + randInt(s, 0, 15), 0, 100),
    wealth: randInt(s, 20, 80) + (10 - Math.min(o.rank, 10)) * 8,
    favor: randInt(s, -5, 15),
    traits: randomTraits(s),
    flaws: [],
    grudges: [],
    teacher: o.teacher,
    historical: false,
    tags: [],
  };
  if (chance(s, c.traits.includes('greedy') ? 0.7 : c.traits.includes('clean') ? 0.1 : 0.35)) {
    s.nextId += 1;
    c.flaws.push({ id: `f${s.nextId}`, label: pick(s, FLAW_POOL), public: false, knownBy: [], t: s.t });
  }
  s.chars[c.id] = c;
  if (c.traits.includes('sickly') && c.destiny > year + 3) c.destiny = Math.max(year + 3, c.destiny - randInt(s, 6, 14));
  return c;
}

export function fromRoster(s: GameState, r: RosterEntry): Character {
  const c: Character = {
    id: r.id,
    name: r.name,
    ho: r.ho,
    clan: r.clan,
    born: r.born,
    destiny: r.destiny,
    checkMonth: randInt(s, 1, 12),
    faction: r.faction,
    lean: r.lean,
    school: r.school,
    home: r.home,
    location: r.status === 'retired' ? r.home : 'hanseong',
    status: r.status,
    office: r.office,
    rank: r.rank,
    promotedAt: s.t - randInt(s, 6, 30),
    tenure: randInt(s, 3, 24),
    learning: r.learning,
    politics: r.politics,
    vigor: r.vigor,
    prestige: r.prestige,
    wealth: r.wealth,
    favor: r.favor,
    traits: [...r.traits],
    flaws: [],
    grudges: [],
    historical: true,
    bio: r.bio,
    founder: r.founder,
    tags: [...(r.tags ?? [])],
  };
  if (c.faction === 'dong' && !s.factions.dong.active) c.faction = c.lean ?? 'nam';
  s.chars[c.id] = c;
  return c;
}
