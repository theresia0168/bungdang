import type { Character, GameState, TraitId } from './types';
import type { EventDef } from './events/types';
import { FACTION_META, REGION_META, TRAIT_META } from './data/meta';
import { formatDate, shortDate, yearOf } from './calendar';
import { chance, randInt } from './rng';
import { age, clamp, josa, log, P, uid, pushEvent } from './state';
import { addMod } from './opinion';
import { genChar, genName } from './generate';
import { ANCESTOR_WEIGHT, ownScore, PATH_DESC, PATH_NAME } from './ending';

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
  // 아들이 하나뿐이지는 않다. 둘째가 더 나을 수도 있고, 서얼 아들만 있거나 아들이 없을 수도 있다
  const heirs: string[] = [];
  const noSon = chance(s, 0.1);
  if (!noSon) heirs.push(makeHeir(s, p, 'eldest').id);
  if (!noSon && chance(s, 0.5)) heirs.push(makeHeir(s, p, 'second').id);
  if (chance(s, noSon ? 0.5 : 0.2)) heirs.push(makeHeir(s, p, 'seoeol').id);
  if (noSon) heirs.push(makeHeir(s, p, 'adopted').id);
  s.pending = [{ id: uid(s, 'ev'), def: 'succession', ctx: { cause, heir: heirs[0], heirs } }];
}

export type HeirKind = 'eldest' | 'second' | 'seoeol' | 'adopted';
export const HEIR_LABEL: Record<HeirKind, string> = { eldest: '맏아들(적장자)', second: '둘째 아들', seoeol: '서얼 아들', adopted: '양자(입후)' };

function makeHeir(s: GameState, f: Character, kind: HeirKind = 'eldest'): Character {
  const [bon, sur] = [f.clan.split(' ')[0], f.name.slice(0, 1)];
  const nm = genName(s, { bon, sur });
  const a = clamp(age(s, f) - randInt(s, 24, 30) - (kind === 'second' ? randInt(s, 2, 5) : kind === 'seoeol' ? randInt(s, 0, 6) : 0), 18, 40);
  // 음서: 선친이 정승이면 6품, 판서면 7품, 당상관이면 8품에서 벼슬길을 연다
  const peak = s.player.peakRank;
  // 둘째는 음서의 혜택이 한 단계 낮고, 양자는 가장 낮다. 서얼은 음서를 받지 못한다
  const rank = Math.min(9, (peak <= 1 ? 6 : peak <= 2 ? 7 : peak <= 3 ? 8 : 9) + (kind === 'second' ? 1 : kind === 'adopted' ? 2 : kind === 'seoeol' ? 3 : 0));
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
  const jongga = !!s.player.house?.jongga;
  c.wealth = Math.round(Math.min(f.wealth, 400) * (jongga ? 0.65 : 0.5) + Math.max(0, f.wealth - 400) * (jongga ? 0.35 : 0.2));
  // 스승을 모셔 가르친 아들은 학식이 한 단계 높다
  if (s.player.house?.eduGen === s.player.lineage.length) c.learning = clamp(c.learning + 1, 1, 8);
  c.favor = Math.round(Math.max(0, f.favor) * 0.3);
  c.lean = f.lean;
  c.flaws = [];
  const passed = f.traits.filter((t) => INHERITABLE.includes(t));
  c.traits = [...new Set([...(passed.length ? [passed[randInt(s, 0, passed.length - 1)]] : []), ...c.traits])].slice(0, 2);
  c.destiny = Math.max(c.destiny, c.born + randInt(s, 60, 74));
  // 아들마다 재능이 다르다
  if (kind !== 'eldest') {
    c.learning = clamp(randInt(s, 2, 6), 1, 7);
    c.politics = clamp(randInt(s, 2, kind === 'seoeol' ? 6 : 5), 1, 7);
    if (s.player.house?.eduGen === s.player.lineage.length) c.learning = clamp(c.learning + 1, 1, 8);
  }
  if (kind === 'seoeol') c.traits = [...new Set(['seoeol' as TraitId, ...c.traits])].slice(0, 2);
  if (kind === 'adopted') c.prestige = Math.max(5, c.prestige - 5);
  c.tags.push(`heirKind:${kind}`);
  c.bio =
    kind === 'eldest'
      ? `${f.name}의 맏아들. 선친의 뒤를 이어 ${f.clan}의 가장이 되었다.`
      : kind === 'second'
        ? `${f.name}의 둘째 아들.`
        : kind === 'seoeol'
          ? `${f.name}의 서얼 아들. 첩의 소생이라 벼슬길이 막혀 있다.`
          : `${f.name}의 양자. 아들이 없어 일가에서 들였다.`;
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
  // 전장은 종손에게 대부분 남는다 (종가를 중건했으면 더)
  pl.land = Math.max(2, Math.round(pl.land * (pl.house?.jongga ? 0.95 : 0.85)));
  pl.hiddenLand = Math.min(pl.hiddenLand, pl.land);
  pl.examPrep = 0;
  pl.books = 0;
  pl.exileWork = 0;
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
  log(s, `${f.name}의 아들 ${josa(h.name, '이/가')} 가문을 이었다.`, 'player');
}

export const SUCCESSION_EVENTS: Record<string, EventDef> = {
  house_path: {
    build(s) {
      const p = P(s);
      const anc = s.player.lineage[s.player.lineage.length - 1];
      return {
        title: '가문의 길',
        kind: 'personal',
        text: `${anc ? `상복을 입은 ${josa(p.name, '이/가')}` : josa(p.name, '이/가')} 사랑방에 앉아 앞날을 헤아린다. ${anc?.peakOffice ? `선친은 ${anc.peakOffice}까지 올랐다. 같은 길을 걸을 것인가, 다른 길로 가문을 세울 것인가.` : '어떤 길로 가문을 세울 것인가.'}\n\n고른 길을 얼마나 이루었는지가 결말 점수에 「가문의 뜻」으로 더해진다. 길은 이 대에만 해당하고, 다음 대가 다시 고른다.`,
        choices: (['office', 'sallim', 'wealth'] as const).map((k) => ({ key: k, label: `${josa(PATH_NAME[k], '을/를')} 걷는다`, hint: PATH_DESC[k] })),
      };
    },
    resolve(s, _c, key) {
      s.player.path = key as 'office' | 'sallim' | 'wealth';
      s.player.deeds.push(`${shortDate(s.t)} ${josa(PATH_NAME[s.player.path], '을/를')} 가문의 길로 삼다`);
      return `${josa(PATH_NAME[s.player.path], '을/를')} 가문의 길로 삼았다.`;
    },
  },
  succession: {
    build(s, c) {
      const f = P(s);
      const h = s.chars[c.heir];
      const heirs: Character[] = ((c.heirs as string[]) ?? [c.heir]).map((id) => s.chars[id]).filter(Boolean);
      const kindOf = (x: Character) => (x.tags.find((t) => t.startsWith('heirKind:'))?.slice(9) ?? 'eldest') as HeirKind;
      const left = 1821 - yearOf(s.t);
      const hasEldest = heirs.some((x) => kindOf(x) === 'eldest');
      const penalty = (x: Character) =>
        kindOf(x) === 'second' && hasEldest
          ? '적장자를 제치니 명망 −3, 일가의 호감 −6, 맏아들의 원한'
          : kindOf(x) === 'seoeol'
            ? `서얼이라 ${s.flags.seoeolOpen ? '허통되었어도 사람들이 꺼린다. 명망 −3' : '서얼허통 전에는 관직에 나아갈 수 없다. 명망 −5'}`
            : kindOf(x) === 'adopted'
              ? '예조에 입후를 청한다. 일가의 호감 +4'
              : '적장자로 잇는다';
      const pick = heirs.map((x) => ({
        key: `heir:${x.id}`,
        label: `${HEIR_LABEL[kindOf(x)]} ${josa(x.name, '이/가')} 잇는다`,
        hint: `${age(s, x)}세 · 학식 ${x.learning} · 정치력 ${x.politics} · ${x.traits.length ? x.traits.map((t) => TRAIT_META[t].name).join('·') : '무난한 성품'} · ${penalty(x)}`,
      }));
      return {
        title: '가문을 잇다',
        kind: 'personal',
        text:
          `${formatDate(s.t)}, ${josa(f.name, '이/가')} ${c.cause}.\n\n` +
          `${REGION_META[f.home].short}의 본가에서 ${heirs.length > 1 ? `아들들이 빈소를 지킨다. 누구로 가문을 이을지 정해야 한다: ${heirs.map((x) => `${HEIR_LABEL[kindOf(x)]} ${x.name}(${age(s, x)}세)`).join(', ')}. ` : `${HEIR_LABEL[kindOf(h)]} ${h.name}(${age(s, h)}세)${josa(h.name, '이/가').slice(h.name.length)} 상주가 되어 빈소를 지킨다. `}` +
          `${f.faction !== 'none' ? `${FACTION_META[f.faction].name} 사람들은 그가 아버지의 뒤를 이을지 지켜본다. ` : ''}` +
          `1821년까지는 ${left}년이 남았다. 맏아들은 선친의 음덕으로 벼슬길에 나서지만(음서) 청요직에 오르지 못하고 승진이 더디다. 과거에 급제하면 그 굴레를 벗는다.\n\n` +
          `${heirs.length > 1 ? '' : `아들은 학식 ${h.learning}, 정치력 ${h.politics}, 명망 ${h.prestige}, 재산 ${h.wealth}로 시작한다. `}선친이 맺은 은혜와 원한은 절반쯤 물려받고, 신세를 진 이들 가운데 일부는 아들에게도 갚으려 한다. ` +
          `${HEIR_MOURNING}개월 상을 치른 뒤 상경할 수 있다.\n\n선대의 업적은 결말 점수에 ${Math.round(ANCESTOR_WEIGHT * 100)}%로 더해진다.`,
        choices: [...pick, { key: 'end', label: '여기서 붓을 놓는다', hint: '졸기(卒記)를 보고 게임을 마친다.' }],
      };
    },
    resolve(s, c, key) {
      const cause = String(c.cause);
      const heirs: string[] = (c.heirs as string[]) ?? [c.heir];
      if (key === 'end') {
        for (const id of heirs) delete s.chars[id];
        delete s.flags.succession;
        s.over = { reason: cause, t: s.t };
        return;
      }
      const chosen = key.startsWith('heir:') ? key.slice(5) : c.heir;
      const h = s.chars[chosen];
      const kind = (h.tags.find((t) => t.startsWith('heirKind:'))?.slice(9) ?? 'eldest') as HeirKind;
      const eldest = heirs.map((id) => s.chars[id]).find((x) => x && x.id !== chosen && x.tags.includes('heirKind:eldest'));
      const f = P(s);
      takeOver(s, chosen, cause);
      const p = P(s);
      const kin = (v: number, why: string) => {
        for (const x of Object.values(s.chars)) if (x.clan === p.clan && x.id !== p.id && x.status !== 'dead') addMod(s, 'char', x.id, p.id, why, v, 0.05, 20);
      };
      if (kind === 'second' && eldest) {
        p.prestige = clamp(p.prestige - 3, 0, 100);
        kin(-6, '적장자를 제침');
        addMod(s, 'char', eldest.id, p.id, '가문을 빼앗김', -30, 0.02, 40);
        if (!eldest.grudges.includes(p.id)) eldest.grudges.push(p.id);
        s.player.deeds.push(`${shortDate(s.t)} 적장자 ${eldest.name}을 제치고 가문을 이음`);
      } else if (kind === 'seoeol') p.prestige = clamp(p.prestige - (s.flags.seoeolOpen ? 3 : 5), 0, 100);
      else if (kind === 'adopted') kin(4, '입후');
      // 잇지 못한 아들들은 일가로 남는다
      for (const id of heirs) {
        const x = s.chars[id];
        if (!x || id === chosen) continue;
        x.bio = `${f.name}의 ${HEIR_LABEL[(x.tags.find((t) => t.startsWith('heirKind:'))?.slice(9) ?? 'eldest') as HeirKind]}. 가문을 잇지 못하고 일가로 남았다.`;
      }
      pushEvent(s, 'house_path', {});
      return `${josa(P(s).name, '이/가')} 가문을 이었다. 상을 마치면 「상경」으로 벼슬길에 나서라.`;
    },
  },
};
