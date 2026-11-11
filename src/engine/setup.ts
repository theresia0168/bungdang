import { initDefense, initRealm } from './realm';
import { initLaws } from './laws';
import type { Character, FactionId, GameState, RegionId, SchoolId, TraitId } from './types';
import { ROSTER } from './data/roster';
import { OFFICES, OFFICE_MAP } from './data/offices';
import { REGIONS } from './data/meta';
import { fromRoster, genChar } from './generate';
import { holderMap } from './court';
import { updateLeaders } from './factions';
import { randInt, weighted } from './rng';
import { initRoyal } from './royal';
import { log, pushEvent } from './state';
import { refreshAp } from './actions';
import { seedWants } from './relations';

export interface CustomSpec {
  name: string;
  bon: string;
  ho: string;
  faction: FactionId;
  school: SchoolId;
  home: RegionId;
  background: 'sinjin' | 'sallim' | 'gamun';
  traits: TraitId[];
}

export type StartChoice = { kind: 'historical'; id: string } | { kind: 'custom'; spec: CustomSpec };

export const BACKGROUNDS: Record<CustomSpec['background'], { name: string; desc: string }> = {
  sinjin: { name: '신진 급제자', desc: '28세. 갓 급제한 낭관. 학식 4, 정치력 3, 강건 4.' },
  sallim: { name: '산림 처사', desc: '35세. 고향에서 학문을 닦는 선비. 학식 5, 정치력 2, 강건 4. 문인 2명으로 시작.' },
  gamun: { name: '명문가 자제', desc: '30세. 재산이 넉넉한 6품 낭관. 학식 3, 정치력 4, 강건 3. 재산 150.' },
};

function blankState(seed: number): GameState {
  return {
    version: 4,
    rng: seed | 0,
    t: 0,
    chars: {},
    marriages: [],
    mods: [],
    factions: {
      dong: { id: 'dong', active: true, division: 0 },
      seo: { id: 'seo', active: true, division: 0 },
      nam: { id: 'nam', active: false, division: 0 },
      buk: { id: 'buk', active: false, division: 0 },
      none: { id: 'none', active: true, division: 0 },
    },
    regions: Object.fromEntries(
      REGIONS.map((r) => [r.id, { id: r.id, influence: { ...r.influence }, minsim: 60, tags: [], defense: initDefense(r.id), hidden: r.id === 'hanseong' ? 0 : 0.06 }]),
    ) as unknown as GameState['regions'],
    player: {
      charId: '',
      focus: null,
      cooldowns: {},
      exp: { learning: 0, politics: 0 },
      children: 1,
      disciples: 0,
      deeds: [],
      peakRank: 10,
      stats: { exiled: 0, impeachWins: 0, impeachFails: 0, memorials: 0, marriages: 0, jojae: 0 },
      doctor: 0,
      sick: false,
      ap: 0,
      authorityUsed: false,
      hired: false,
      debts: {},
      scheme: null,
      intel: {},
      projects: {},
      built: [],
      goal: null,
      goalsDone: [],
      abroadUntil: 0,
      contacts: {},
      suspicion: 0,
      knownWants: [],
      bonds: [],
      proteges: [],
      retainers: 0,
      lowProfile: false,
      socialBonus: false,
      impeachAt: [],
      eventAt: {},
      lineage: [],
      guide: [],
      done: [],
      teach: 0,
      land: 2,
      hiddenLand: 0,
      loans: [],
      factionChanges: 0,
    },
    flags: {},
    tension: 22,
    war: { active: false, preparedness: 30, zones: [] },
    pending: [],
    log: [],
    recs: {},
    cases: [],
    plots: [],
    races: [],
    king: { mood: 10, lean: { seo: 5, dong: 5 } },
    line: { dong: 20, seo: 0 },
    situations: [],
    royal: initRoyal(),
    realm: initRealm(),
    laws: initLaws(),
    nextId: 100,
  };
}

function buildCustom(s: GameState, spec: CustomSpec): Character {
  const bg = spec.background;
  const ageBy = bg === 'sinjin' ? 28 : bg === 'sallim' ? 35 : 30;
  const sur = spec.name.slice(0, 1);
  const c = genChar(s, {
    rank: bg === 'sinjin' ? 7 : bg === 'gamun' ? 6 : 10,
    age: ageBy,
    status: bg === 'sallim' ? 'retired' : 'active',
    office: bg === 'sallim' ? undefined : 'nanggwan',
    faction: spec.faction,
    home: spec.home,
    school: spec.school,
    name: spec.name,
    clan: `${spec.bon} ${sur}씨`,
  });
  c.ho = spec.ho || undefined;
  c.learning = bg === 'sallim' ? 5 : bg === 'sinjin' ? 4 : 3;
  c.politics = bg === 'gamun' ? 4 : bg === 'sinjin' ? 3 : 2;
  c.vigor = bg === 'gamun' ? 3 : 4;
  c.prestige = bg === 'sallim' ? 30 : 15;
  c.wealth = bg === 'gamun' ? 150 : bg === 'sallim' ? 50 : 40;
  c.favor = bg === 'gamun' ? 10 : 0;
  c.traits = [...spec.traits];
  c.flaws = [];
  c.destiny = c.born + randInt(s, 60, 70);
  c.bio = `${spec.bon} ${sur}씨 가문의 ${BACKGROUNDS[bg].name}.`;
  if (bg === 'sallim') s.player.disciples = 2;
  return c;
}

export function newGame(choice: StartChoice, seed = Date.now()): GameState {
  const s = blankState(seed);
  for (const r of ROSTER) if (!r.arrive) fromRoster(s, r);

  const player = choice.kind === 'historical' ? s.chars[choice.id] : buildCustom(s, choice.spec);
  s.player.charId = player.id;
  s.player.peakRank = player.office ? player.rank : 10;

  const hm = holderMap(s);
  for (const o of OFFICES) {
    if (hm[o.id]) continue;
    const ageBy = o.rank <= 1 ? randInt(s, 58, 68) : o.rank <= 2 ? randInt(s, 46, 60) : o.rank <= 3 ? randInt(s, 40, 52) : randInt(s, 28, 38);
    const faction = weighted<FactionId>(s, o.rank <= 2 ? [['dong', 35], ['seo', 35], ['none', 30]] : [['dong', 55], ['seo', 40], ['none', 5]]);
    genChar(s, { rank: o.rank, age: ageBy, status: 'active', office: o.id, faction, location: o.region ?? 'hanseong' });
  }
  for (let i = 0; i < 14; i++) genChar(s, { rank: randInt(s, 6, 9), age: randInt(s, 25, 40), status: 'active', office: 'nanggwan' });
  for (let i = 0; i < 4; i++) genChar(s, { rank: randInt(s, 3, 5), age: randInt(s, 38, 55), status: 'idle' });
  for (let i = 0; i < 3; i++) genChar(s, { rank: 2, age: randInt(s, 50, 62), status: 'idle' });
  for (const c of Object.values(holderMap(s))) {
    const o = OFFICE_MAP[c.office!];
    if (o.fixedTerm) c.tenure = randInt(s, 0, o.term - 1);
  }
  for (let i = 0; i < 6; i++) genChar(s, { rank: randInt(s, 9, 10), age: randInt(s, 30, 60), status: 'retired' });

  if (player.office) {
    const o = OFFICES.find((x) => x.id === player.office);
    if (o) s.player.peakOffice = o.name;
  }
  updateLeaders(s);
  seedWants(s);
  refreshAp(s);
  log(s, '선조 8년 을해년이 밝았다.', 'history');
  pushEvent(s, 'intro');
  pushEvent(s, 'goal_pick');
  return s;
}

export const PLAYABLE = ROSTER.filter((r) => r.playable);

/** 예전 저장본에 새로 생긴 항목을 채운다 */
export function upgrade(s: GameState): GameState {
  if (s.version >= 4) return s;
  const pl = s.player;
  pl.done ??= [];
  pl.teach ??= 0;
  pl.land ??= 2;
  pl.hiddenLand ??= 0;
  pl.loans ??= [];
  pl.factionChanges ??= 0;
  if (pl.focus && pl.focus.kind !== 'memorial') pl.focus = null;
  for (const r of Object.values(s.regions)) {
    r.defense ??= initDefense(r.id);
    r.hidden ??= r.id === 'hanseong' ? 0 : 0.06;
  }
  s.realm ??= initRealm();
  s.laws ??= initLaws();
  if (s.flags.seoeolOpen) s.laws.seoeol = { on: true, since: s.t };
  s.version = 4;
  return s;
}
