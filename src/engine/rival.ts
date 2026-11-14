import type { Character, GameState } from './types';
import { FACTION_META } from './data/meta';
import { chance, pick } from './rng';
import { age, alive, clamp, inCourt, isP, josa, log, notice, officeTitle, P, people } from './state';
import { opinion, sway, topOf } from './opinion';
import { startPlot } from './plots';
import { diffK } from './diff';

/* ───────── 숙적(宿敵) ─────────
 * 다른 당의 비슷한 연배·품계에서 수완 있는 이 하나가 플레이어를 눈엣가시로 여긴다.
 * 몇 해에 걸쳐 뒤를 캐고, 비방하고, 논핵을 꾸민다. 그가 몰락하거나 죽으면 결말이 난다.
 * 플레이어가 죽어도 살아 있으면 아들에게 원한이 이어진다.
 */

export const rivalOf = (s: GameState): Character | undefined => {
  const id = s.player.rival;
  const c = id ? s.chars[id] : undefined;
  return alive(c) ? c : undefined;
};

function pickRival(s: GameState): Character | undefined {
  const p = P(s);
  if (p.faction === 'none') return undefined;
  const pool = people(s).filter(
    (c) =>
      !isP(s, c) &&
      inCourt(c) &&
      c.faction !== 'none' &&
      topOf(c.faction) !== topOf(p.faction) &&
      c.politics >= 5 &&
      Math.abs(age(s, c) - age(s, p)) <= 15 &&
      Math.abs(c.rank - p.rank) <= 2 &&
      opinion(s, c, p) <= 0,
  );
  if (!pool.length) return undefined;
  pool.sort((a, b) => opinion(s, a, p) - a.politics * 3 - (opinion(s, b, p) - b.politics * 3));
  return pool[0];
}

/** 매달: 숙적을 정하고, 숙적이 움직이고, 결말을 낸다 */
export function tickRival(s: GameState) {
  const p = P(s);
  if (!alive(p)) return;
  const id = s.player.rival;
  const r = id ? s.chars[id] : undefined;

  // 결말: 죽었거나, 위리안치 이상으로 몰락했거나, 오래 낙향해 조정에서 잊혔다
  if (id && r) {
    const fallen = r.status === 'dead' || (r.status === 'exiled' && (r.exileLevel ?? 1) >= 2) || (r.status === 'retired' && !inCourt(r) && chance(s, 0.03));
    if (fallen) {
      const how =
        r.status === 'dead'
          ? `${josa(r.name, '이/가')} ${r.death?.cause ?? '세상을 떠났다'}`
          : r.status === 'exiled'
            ? `${josa(r.name, '이/가')} 먼 섬에 위리안치되었다`
            : `${josa(r.name, '이/가')} 조정을 떠나 다시 돌아오지 않는다`;
      p.prestige = clamp(p.prestige + 3, 0, 100);
      s.player.deeds.push(`숙적 ${r.name}과의 오랜 다툼이 끝남`);
      notice(s, '숙적의 끝', `${how}. 오랜 세월 당신을 노리던 숙적과의 다툼이 끝났다. 사람들은 끝까지 버틴 당신을 다시 본다. (명망 +3)`, 'personal');
      log(s, `${josa(p.name, '과/와')} ${r.name} 사이의 오랜 다툼이 끝났다.`, 'player');
      s.player.rival = undefined;
      s.flags.rivalEndAt = s.t;
      return;
    }
  }

  // 숙적을 정한다: 한 해에 한 번, 조정에 있을 때
  if (!id) {
    if (s.t % 12 !== 3 || !inCourt(p) || p.rank > 6) return;
    if (typeof s.flags.rivalEndAt === 'number' && s.t - (s.flags.rivalEndAt as number) < 36) return;
    if (!chance(s, 0.5)) return;
    const c = pickRival(s);
    if (!c) return;
    s.player.rival = c.id;
    if (!c.grudges.includes(p.id)) c.grudges.push(p.id);
    sway(s, p, c.id, -25, '숙적', { decay: 0.02 });
    notice(
      s,
      '숙적(宿敵)',
      `${c.name}(${FACTION_META[c.faction].name}, ${officeTitle(c)}, ${age(s, c)}세)${josa(c.name, '이/가').slice(c.name.length)} 당신을 눈엣가시로 여긴다는 말이 들린다. 같은 무렵 벼슬길에 올라 같은 자리를 바라보는 사이다.\n\n앞으로 그는 당신의 뒤를 캐고, 비방하고, 논핵을 꾸밀 것이다. 그가 몰락하거나 죽어야 다툼이 끝난다. 「이달의 정국」에서 그를 지켜볼 수 있다.`,
      'danger',
    );
    return;
  }
  if (!r || !inCourt(r) || r.status !== 'active') return;

  // 숙적이 움직인다: 다달이 4%
  if (!chance(s, 0.04 * diffK(s))) return;
  const hidden = p.flaws.filter((f) => !f.public && !f.knownBy.includes(r.id));
  if (hidden.length && chance(s, 0.5)) {
    const f = pick(s, hidden);
    f.knownBy.push(r.id);
    notice(s, '숙적의 뒷조사', `${josa(r.name, '이/가')} 사람을 풀어 당신의 뒤를 캔다는 말이 들린다. 숨겨 둔 일 하나가 그의 귀에 들어간 듯하다.`, 'danger');
    return;
  }
  if (p.status === 'active' && p.office && startPlot(s, r)) return;
  p.prestige = clamp(p.prestige - 2, 0, 100);
  notice(s, '숙적의 비방', `${josa(r.name, '이/가')} 사랑방마다 당신을 헐뜯고 다닌다. 「겉으로는 청렴한 척하나 속은 다르다」는 말이 돈다. (명망 -2)`, 'court');
}
