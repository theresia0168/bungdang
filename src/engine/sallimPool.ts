import type { Character, GameState, RegionId } from './types';
import type { OfficeDef } from './data/offices';
import { REGIONS, REGION_META } from './data/meta';
import { chance, randInt } from './rng';
import { alive, josa, log, seat } from './state';
import { genChar, regionFaction } from './generate';

/* ───────── 지방의 산림(山林) ─────────
 * 팔도의 고을마다 벼슬하지 않고 학문으로 이름난 선비들이 있다. 사람이 많이 죽거나 쫓겨나 조정이 비면
 * 허공에서 사람을 만들어 내기 전에 먼저 이들을 불러 올린다(징소 徵召). 학문이 깊은 산림은 언관·청요직에 어울린다.
 * 해마다 도마다 모자란 만큼 새 산림이 이름을 얻는다.
 */

/** 도마다 머무는 산림의 수 (선비가 많은 삼남은 셋) */
const QUOTA: Partial<Record<RegionId, number>> = { gyeongsang: 3, chungcheong: 3, jeolla: 3, gyeonggi: 2, gangwon: 2, hwanghae: 1, pyeongan: 1, hamgyeong: 1 };

export const isSallim = (c: Character) => c.tags.includes('sallim') && c.status === 'retired' && alive(c);
export const sallimOf = (s: GameState, r?: RegionId) => Object.values(s.chars).filter((c) => isSallim(c) && (!r || c.home === r));

/** 해마다 한 번: 도마다 모자란 산림을 채운다 */
export function tickSallimPool(s: GameState) {
  if (s.t % 12 !== 2) return;
  for (const r of REGIONS) {
    const want = QUOTA[r.id] ?? 0;
    if (!want || sallimOf(s, r.id).length >= want) continue;
    spawn(s, r.id);
  }
}

/** 게임을 시작할 때 팔도의 산림을 채워 둔다 */
export function seedSallim(s: GameState) {
  for (const r of REGIONS) for (let i = sallimOf(s, r.id).length; i < (QUOTA[r.id] ?? 0); i++) spawn(s, r.id);
}

function spawn(s: GameState, home: RegionId): Character {
  const c = genChar(s, {
    rank: 9,
    age: randInt(s, 34, 58),
    status: 'retired',
    faction: regionFaction(s, home),
    home,
    location: home,
    learning: randInt(s, 5, 8),
  });
  c.politics = randInt(s, 1, 3);
  c.prestige = randInt(s, 30, 55);
  c.tags.push('sallim');
  // 절반은 은일(隱逸)이라 좀처럼 벼슬에 나서지 않는다
  if (chance(s, 0.5) && !c.traits.includes('recluse')) c.traits = ['recluse' as Character['traits'][number], ...c.traits].slice(0, 2);
  c.bio = `${REGION_META[home].short}에 머무는 산림. 벼슬보다 학문으로 이름이 났다.`;
  return c;
}

/** 빈자리를 채울 사람이 없을 때 먼저 산림을 불러 올린다. 없으면 undefined */
export function summonSallim(s: GameState, o: OfficeDef): Character | undefined {
  // 산림은 언관·청요직·문형, 그리고 당상관의 빈자리에 불려 간다
  if (!(o.samsa || o.cheongyo || o.literary || o.rank <= 3)) return undefined;
  if (!chance(s, 0.6)) return undefined;
  const pool = sallimOf(s)
    .filter((c) => !c.traits.includes('seoeol'))
    .sort((a, b) => b.learning * 3 + b.prestige / 10 - (b.traits.includes('recluse') ? 4 : 0) - (a.learning * 3 + a.prestige / 10 - (a.traits.includes('recluse') ? 4 : 0)));
  const c = pool[0];
  if (!c) return undefined;
  c.status = 'idle';
  c.location = seat(s);
  c.rank = Math.min(c.rank, o.rank + 1);
  c.tags = c.tags.filter((t) => t !== 'sallim');
  c.tags.push('wasSallim');
  log(s, `[징소] 조정이 비자 왕이 ${REGION_META[c.home].short}의 산림 ${josa(c.name, '을/를')} 불러 올렸다.`, 'court');
  return c;
}
