import type { Character, GameState, TraitId } from './types';
import type { EventDef } from './events/types';
import { FACTION_META, REGION_META } from './data/meta';
import { formatDate, shortDate, yearOf } from './calendar';
import { randInt } from './rng';
import { age, clamp, josa, log, P, uid } from './state';
import { addMod } from './opinion';
import { genChar, genName } from './generate';
import { ANCESTOR_WEIGHT, ownScore } from './ending';

/* ───────── 가문 계승 ─────────
 * 플레이어가 1821년 전에 죽으면 맏아들이 가문을 잇는다. 맏아들은 음서로 나서며, 과거에 급제해야 굴레를 벗는다.
 * 가문의 은원(恩怨)은 절반쯤 물려받고, 선대의 업적은 결말 점수에 반영된다.
 */

/** 아들이 상주로서 낙향해 있는 기간 */
const HEIR_MOURNING = 12;

const INHERITABLE: TraitId[] = ['upright', 'mild', 'radical', 'scholar', 'writer', 'schemer', 'clean', 'greedy', 'ambitious', 'mediator'];

/** 죽은 달이 끝나면 다른 사건을 모두 접고 계승 여부를 묻는다 */
export function checkSuccession(s: GameState) {
  const cause = s.flags.succession;
  if (typeof cause !== 'string' || s.pending.some((e) => e.def === 'succession')) return;
  const p = P(s);
  const heir = makeHeir(s, p);
  s.pending = [{ id: uid(s, 'ev'), def: 'succession', ctx: { cause, heir: heir.id } }];
}

function makeHeir(s: GameState, f: Character): Character {
  const [bon, sur] = [f.clan.split(' ')[0], f.name.slice(0, 1)];
  const nm = genName(s, { bon, sur });
  const a = clamp(age(s, f) - randInt(s, 24, 30), 18, 40);
  // 음서: 선친이 정승이면 6품, 판서면 7품, 당상관이면 8품에서 벼슬길을 연다
  const peak = s.player.peakRank;
  const rank = peak <= 1 ? 6 : peak <= 2 ? 7 : peak <= 3 ? 8 : 9;
  const c = genChar(s, {
    rank,
    age: a,
    status: 'retired',
    faction: f.faction,
    home: f.home,
    school: f.school,
    location: f.home,
    name: nm.name,
    clan: f.clan,
    learning: clamp(randInt(s, 3, 4) + (f.learning >= 6 ? 1 : 0), 1, 7),
  });
  c.politics = clamp(randInt(s, 2, 3) + (f.politics >= 6 ? 1 : 0), 1, 7);
  c.vigor = randInt(s, 3, 5);
  c.prestige = Math.round(10 + f.prestige * 0.3 + (rank <= 7 ? 5 : 0));
  // 재산과 전장은 아우들에게도 나누어 준다(분재)
  c.wealth = Math.round(Math.min(f.wealth, 400) * 0.5 + Math.max(0, f.wealth - 400) * 0.2);
  c.favor = Math.round(Math.max(0, f.favor) * 0.3);
  c.lean = f.lean;
  c.flaws = [];
  const passed = f.traits.filter((t) => INHERITABLE.includes(t));
  c.traits = [...new Set([...(passed.length ? [passed[randInt(s, 0, passed.length - 1)]] : []), ...c.traits])].slice(0, 2);
  c.destiny = Math.max(c.destiny, c.born + randInt(s, 60, 74));
  c.bio = `${f.name}의 맏아들. 선친의 뒤를 이어 ${f.clan}의 가장이 되었다.`;
  c.tags.push('heir');
  c.eumseo = true;
  return c;
}

/** 아들을 새 플레이어로 삼는다 */
function takeOver(s: GameState, heirId: string, cause: string) {
  const f = P(s);
  const h = s.chars[heirId];
  const pl = s.player;
  // 선대가 이룬 것은 그 사람 자신의 업적만 적는다 (윗대의 몫까지 거듭 쌓이지 않게)
  const score = ownScore(s);
  pl.lineage.push({ id: f.id, name: f.name, died: s.t, cause, score, peakOffice: pl.peakOffice });

  // 가문의 은원을 절반 물려받는다
  const inherited = s.mods.filter((m) => m.about === f.id && Math.abs(m.value) >= 4);
  for (const m of inherited) addMod(s, m.scope, m.holder, h.id, `선친과의 ${m.value > 0 ? '인연' : '악연'}`, m.value * 0.5, Math.max(0.05, m.decay), 30);
  for (const c of Object.values(s.chars)) {
    if (c.teacher === f.id && c.status !== 'dead') addMod(s, 'char', c.id, h.id, '선사(先師)의 아들', 15, 0.05, 20);
    if (c.grudges.includes(f.id)) c.grudges = c.grudges.filter((x) => x !== f.id);
  }

  const debts = Object.fromEntries(
    Object.entries(pl.debts)
      .map(([id, n]) => [id, Math.floor(n / 2)] as const)
      .filter(([, n]) => n > 0),
  );
  pl.charId = h.id;
  pl.land = Math.max(2, Math.round(pl.land * 0.6));
  pl.hiddenLand = Math.min(pl.hiddenLand, pl.land);
  pl.examPrep = 0;
  pl.focus = null;
  pl.cooldowns = {};
  pl.exp = { learning: 0, politics: 0 };
  pl.children = 1;
  pl.disciples = Math.floor(pl.disciples / 2);
  pl.deeds.push(`${shortDate(s.t)} ── ${josa(h.name, '이/가')} 가문을 잇다 ──`);
  pl.peakRank = 10;
  pl.peakOffice = undefined;
  pl.stats = { exiled: 0, impeachWins: 0, impeachFails: 0, memorials: 0, marriages: 0, jojae: 0 };
  pl.doctor = 0;
  pl.sick = false;
  pl.debts = debts;
  pl.scheme = null;
  pl.intel = {};
  pl.projects = {};
  pl.goal = null;
  pl.goalsDone = [];
  pl.abroadUntil = 0;
  pl.contacts = {};
  pl.suspicion = 0;
  pl.knownWants = [];
  pl.bonds = [];
  pl.proteges = [];
  pl.lowProfile = false;
  pl.impeachAt = [];
  pl.eventAt = {};
  s.plots = [];
  s.royal.backing = undefined;
  s.royal.backingPublic = undefined;
  s.flags.mourned = true;
  s.flags.mournUntil = s.t + HEIR_MOURNING;
  h.banUntil = s.t + HEIR_MOURNING;
  delete s.flags.succession;
  log(s, `${f.name}의 맏아들 ${josa(h.name, '이/가')} 가문을 이었다.`, 'player');
}

export const SUCCESSION_EVENTS: Record<string, EventDef> = {
  succession: {
    build(s, c) {
      const f = P(s);
      const h = s.chars[c.heir];
      const left = 1821 - yearOf(s.t);
      return {
        title: '가문을 잇다',
        kind: 'personal',
        text:
          `${formatDate(s.t)}, ${josa(f.name, '이/가')} ${c.cause}.\n\n` +
          `${REGION_META[f.home].short}의 본가에서 맏아들 ${h.name}(${age(s, h)}세)${josa(h.name, '이/가').slice(h.name.length)} 상주가 되어 빈소를 지킨다. ` +
          `${f.faction !== 'none' ? `${FACTION_META[f.faction].name} 사람들은 그가 아버지의 뒤를 이을지 지켜본다. ` : ''}` +
          `1821년까지는 ${left}년이 남았다. 맏아들은 선친의 음덕으로 벼슬길에 나서지만(음서) 청요직에 오르지 못하고 승진이 더디다. 과거에 급제하면 그 굴레를 벗는다.\n\n` +
          `아들은 학식 ${h.learning}, 정치력 ${h.politics}, 명망 ${h.prestige}, 재산 ${h.wealth}로 시작한다. 선친이 맺은 은혜와 원한은 절반쯤 물려받고, 신세를 진 이들 가운데 일부는 아들에게도 갚으려 한다. ` +
          `${HEIR_MOURNING}개월 상을 치른 뒤 상경할 수 있다.\n\n선대의 업적은 결말 점수에 ${Math.round(ANCESTOR_WEIGHT * 100)}%로 더해진다.`,
        choices: [
          { key: 'continue', label: `${josa(h.name, '이/가')} 가문을 잇는다`, hint: '아들로 이어서 플레이한다.' },
          { key: 'end', label: '여기서 붓을 놓는다', hint: '졸기(卒記)를 보고 게임을 마친다.' },
        ],
      };
    },
    resolve(s, c, key) {
      const cause = String(c.cause);
      if (key === 'end') {
        const h = s.chars[c.heir];
        if (h) delete s.chars[h.id];
        delete s.flags.succession;
        s.over = { reason: cause, t: s.t };
        return;
      }
      takeOver(s, c.heir, cause);
      return `${josa(P(s).name, '이/가')} 가문을 이었다. 상을 마치면 「상경」으로 벼슬길에 나서라.`;
    },
  },
};
