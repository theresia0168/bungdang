import type { Character, FactionId, GameState, MemorialTopic, ProjectKind, TraitId } from './types';
import { addPrep } from './realm';
import { OFFICE_MAP } from './data/offices';
import { REGION_META } from './data/meta';
import { chance, randInt } from './rng';
import { addFlaw, alive, atSeat, clamp, collect, impeachEtiquette, inCourt, josa, log, monthsSince, notice, owe, P, pres, pushEvent, seat, seatName } from './state';
import { LAW_MAP, lawCooldown } from './laws';
import { startOksa, tongmun, tongmunError } from './strife';
import { exile } from './conflict';
import { FACTION_META } from './data/meta';
import { powerShare, standing } from './factions';
import { lawStance } from './laws';
import { inLaws, opinion, sway, swayFaction, topOf } from './opinion';
import { memorial, TOPIC_LABEL } from './conflict';
import { vacate } from './court';
import { caseOn, openCase, sideOf, withdraw } from './cases';
import { shortDate } from './calendar';
import { addBond, betray, bondCount, bondWith, contactMult, fulfill, learnWant, MAX_BONDS, noteContact } from './relations';
import { humbleEffects } from './plots';

export type TargetActionId =
  | 'letter'
  | 'visit'
  | 'gift'
  | 'marriage'
  | 'probe'
  | 'investigate'
  | 'blackmail'
  | 'impeach'
  | 'recommend'
  | 'ask_recommend'
  | 'cosign'
  | 'plead'
  | 'recall'
  | 'pact'
  | 'secret'
  | 'reconcile'
  | 'hush'
  | 'sponsor'
  | 'bribe'
  | 'recruit'
  | 'persuade'
  | 'disinfo'
  | 'alienate'
  | 'placard';

/** 행동력 수치, 또는 관직의 권한으로 한 달에 한 번 하는 '직권' */
export type ActionCost = number | 'authority';

export interface TargetAction {
  id: TargetActionId;
  name: string;
  desc: string;
  cost(s: GameState): ActionCost;
  check(s: GameState, t: Character): string | null;
  run(s: GameState, t: Character): string;
}

export const HIRE_COST = 15;
export const INVESTIGATE_COST = 10;
export const IMPEACH_COOLDOWN = 8;
/** 한평생 당을 바꿀 수 있는 횟수 */
export const MAX_SWITCHES = 2;

export const isAbroad = (s: GameState) => s.player.abroadUntil > s.t;
/** 시묘가 끝나기까지 남은 달 */
export const mourningLeft = (s: GameState) => Math.max(0, Number(s.flags.mournUntil ?? 0) - s.t);

export function apParts(s: GameState): { label: string; value: number }[] {
  const p = P(s);
  if (p.status === 'exiled') return [{ label: '유배 중 (서신만)', value: 1 }];
  if (isAbroad(s)) return [{ label: '사행 중 (서신만)', value: 1 }];
  const parts = [{ label: '기본', value: 3 }];
  if (p.politics >= 5) parts.push({ label: '정치력 5 이상', value: 1 });
  if (p.politics >= 7) parts.push({ label: '정치력 7 이상', value: 1 });
  if (s.player.disciples >= 4) parts.push({ label: '문인 4명 이상', value: 1 });
  if (s.player.retainers >= 2) parts.push({ label: '식객', value: 1 });
  if (p.status === 'retired') parts.push({ label: '낙향 중', value: -1 });
  if (s.player.sick) parts.push({ label: '병중', value: -1 });
  return parts;
}

/** 직권 행동(즉시 탄핵, 천거)을 쓸 수 있는 자리인가 */
export const hasAuthority = (s: GameState) => {
  const p = P(s);
  return p.status === 'active' && (isSamsa(p) || p.office === 'ijo' || p.office === 'jeonrang');
};

export const apMax = (s: GameState) => Math.max(1, apParts(s).reduce((a, x) => a + x.value, 0));

export function refreshAp(s: GameState) {
  s.player.ap = apMax(s);
  s.player.authorityUsed = false;
  s.player.hired = false;
  s.player.lowProfile = false;
  s.player.socialBonus = false;
  s.player.done = [];
}

/** 멀리 있어도 할 수 있는 행동 */
const BY_LETTER: TargetActionId[] = ['visit', 'pact', 'cosign'];

/** 행동 고유의 조건과 행동력·직권을 모두 따진다. 할 수 있으면 null. */
export function actionError(s: GameState, a: TargetAction, t: Character): string | null {
  const err = a.check(s, t);
  if (err) return err;
  if (P(s).status === 'exiled' && !BY_LETTER.includes(a.id)) return '유배 중에는 서신만 보낼 수 있다';
  if (isAbroad(s) && !BY_LETTER.includes(a.id)) return '사행 중에는 서신만 보낼 수 있다';
  const cost = a.cost(s);
  if (cost === 'authority') return s.player.authorityUsed ? '이번 달 직권을 이미 썼다' : null;
  if (cost > s.player.ap) return `행동력이 부족하다 (필요 ${cost}, 남은 ${s.player.ap})`;
  return null;
}

const cdLeft = (s: GameState, key: string) => {
  const v = s.player.cooldowns[key];
  return v && v > s.t ? v - s.t : 0;
};
const setCd = (s: GameState, key: string, months: number) => {
  s.player.cooldowns[key] = s.t + months;
};
const cdMsg = (s: GameState, key: string) => {
  const n = cdLeft(s, key);
  return n ? `${n}개월 뒤에 다시 할 수 있다` : null;
};

function basic(s: GameState, t: Character): string | null {
  const p = P(s);
  if (t.id === p.id) return '자기 자신이다';
  if (t.status === 'dead') return '이미 세상을 떠났다';
  if (t.status === 'royal') return '왕실 인물에게는 할 수 없다';
  return null;
}

const isSamsa = (c: Character) => !!(c.office && OFFICE_MAP[c.office]?.samsa);
const joined = (xs: string[]) => (xs.length ? ` (${xs.join(', ')})` : '');
const schemer = (c: Character) => c.traits.includes('schemer');
/** 내가 쥐고 있는, 그의 숨은 흠결 */
export const heldFlaws = (s: GameState, t: Character) => t.flaws.filter((f) => !f.public && f.knownBy.includes(s.player.charId));
/** 내가 공격하는 논핵 */
const myAttack = (s: GameState) => s.cases.find((c) => c.attacker === s.player.charId);

/** 두 가문을 혼인으로 잇는다 */
export function marry(s: GameState, t: Character, cost: number): string {
  const p = P(s);
  s.marriages.push({ a: p.clan, b: t.clan, t: s.t });
  s.player.children--;
  p.wealth -= cost;
  s.player.stats.marriages++;
  const fx = sway(s, t, p.id, 10, '사돈의 정', { decay: 0.05 });
  let extra = '';
  if (p.faction !== 'none' && t.faction !== 'none' && topOf(p.faction) !== topOf(t.faction)) {
    fx.push(swayFaction(s, p.faction, p.id, -8, '당색을 넘은 혼인', 0.05));
    s.tension = clamp(s.tension - 3, 0, 100);
    extra = ' 당색을 넘은 혼인에 당내에서 말이 많다.';
  } else if (p.faction !== 'none') {
    fx.push(swayFaction(s, p.faction, p.id, 3, '당내 결속', 0.05));
  }
  s.player.deeds.push(`${shortDate(s.t)} ${josa(t.clan, "과/와")} 혼인`);
  log(s, `${josa(p.clan, '과/와')} ${josa(t.clan, "이/가")} 혼인으로 맺어졌다.`, 'player');
  const wish = fulfill(s, t, 'match');
  return `${josa(t.clan, "과/와")} 혼맥을 맺었다.${joined(fx.filter(Boolean))}${extra}${wish ? ` ${wish}` : ''}`;
}

export const TARGET_ACTIONS: TargetAction[] = [
  {
    id: 'letter',
    name: '서신',
    cost: () => 1,
    desc: '안부 서신을 보낸다. 어디에 있든 보낼 수 있다.',
    check: (s, t) => basic(s, t) ?? cdMsg(s, `letter:${t.id}`),
    run(s, t) {
      const p = P(s);
      const m = contactMult(s, t);
      const v = (3 + p.politics + (p.traits.includes('mild') ? 2 : 0) + randInt(s, 0, 3)) * m;
      const fx = sway(s, t, p.id, v, '서신 왕래', { decay: 0.25, cap: 15 });
      setCd(s, `letter:${t.id}`, 3);
      const talk = noteContact(s, t, 'letter');
      return `${t.name}에게 서신을 보냈다.${joined(fx)}${m < 1 ? ' 거듭된 서신이라 감흥이 덜하다.' : ''}${talk}`;
    },
  },
  {
    id: 'visit',
    name: '방문',
    cost: () => 1,
    desc: '직접 찾아가 교유한다. 같은 지역에 있어야 하며, 그 가문 전체에 인상을 남긴다.',
    check(s, t) {
      const p = P(s);
      return (
        basic(s, t) ??
        (p.status === 'exiled' ? '유배 중이다' : null) ??
        (t.status === 'exiled' ? '유배 중인 사람을 찾아갈 수는 없다' : null) ??
        (p.location !== t.location ? '같은 지역에 있어야 한다' : null) ??
        cdMsg(s, `visit:${t.id}`)
      );
    },
    run(s, t) {
      const p = P(s);
      const m = contactMult(s, t);
      const v = (7 + p.politics + (p.traits.includes('mild') ? 2 : 0) + randInt(s, 0, 4)) * m;
      const fx = sway(s, t, p.id, v, '교유', { clan: 0.3, decay: 0.25, cap: 25 });
      setCd(s, `visit:${t.id}`, 4);
      const talk = noteContact(s, t, 'visit');
      let extra = '';
      if (t.want?.kind === 'learning' && p.learning >= t.learning) extra = ` 밤늦도록 학문을 논했다. ${fulfill(s, t, 'learning')}`;
      else if (opinion(s, t, p) >= 20 && chance(s, 0.5)) extra = learnWant(s, t);
      return `${josa(t.name, '을/를')} 찾아가 담소를 나누었다.${joined(fx)}${m < 1 ? ' 자주 찾아오니 반가움이 덜하다.' : ''}${talk}${extra}`;
    },
  },
  {
    id: 'gift',
    name: '선물',
    cost: () => 1,
    desc: '재산 20을 들여 선물을 보낸다. 사람마다 받는 법이 다르다. 탐욕스러운 이는 크게 기뻐하지만 약점이 되기 쉽고, 청렴한 이는 부담스러워하며, 강직한 이는 돌려보낸다. 학자에게는 서책을 보낸다.',
    check(s, t) {
      return basic(s, t) ?? (P(s).wealth < 20 ? '재산이 20 이상 있어야 한다' : null) ?? cdMsg(s, `gift:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= 20;
      setCd(s, `gift:${t.id}`, 6);
      if (t.traits.includes('upright') && t.clan !== p.clan) {
        const fx = sway(s, t, p.id, -6, '뇌물로 여김', {});
        p.prestige = clamp(p.prestige - 1, 0, 100);
        return `${josa(t.name, '이/가')} 선물을 돌려보냈다. 뇌물로 여긴 듯하다.${joined(fx)}`;
      }
      const talk = noteContact(s, t, 'gift');
      if (t.want?.kind === 'wealth') {
        const fx = sway(s, t, p.id, 15, '선물', { clan: 0.25, decay: 0.2, cap: 25 });
        return `${t.name}에게 넉넉히 선물을 보냈다.${joined(fx)}${talk} ${fulfill(s, t, 'wealth')}`;
      }
      const greedy = t.traits.includes('greedy');
      const clean = t.traits.includes('clean');
      const bookish = t.traits.includes('scholar') || t.traits.includes('writer');
      const v = (greedy ? 25 : clean ? 6 : bookish ? 18 : 15) * contactMult(s, t);
      const fx = sway(s, t, p.id, v, bookish ? '서책 선물' : '선물', { clan: 0.25, decay: 0.2, cap: greedy ? 35 : 25 });
      let extra = clean ? ' 그는 고마워하면서도 부담스러운 기색이었다.' : bookish ? ' 귀한 서책을 받고 반가워했다.' : '';
      if (!bookish && chance(s, greedy ? 0.35 : clean ? 0.05 : 0.2)) {
        addFlaw(s, t, '뇌물 수수', false, [p.id]);
        addFlaw(s, p, '청탁성 증여', false, [t.id]);
        extra += ' 그가 선물을 받은 사실은 약점이 되었다. 물론 그도 당신이 건넨 사실을 안다.';
      }
      return `${t.name}에게 선물을 보냈다.${joined(fx)}${extra}${talk}`;
    },
  },
  {
    id: 'marriage',
    name: '혼담',
    cost: () => 2,
    desc: '자녀를 그 가문과 혼인시킨다(재산 40). 두 가문의 모든 사람이 서로 호감을 갖는다. 당색을 넘으면 당내 반발이 있다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (s.player.children <= 0) return '혼기에 이른 자녀가 없다';
      if (p.wealth < 40) return '혼수 비용 40이 부족하다';
      if (t.clan === p.clan) return '같은 가문이다';
      if (inLaws(s, p.clan, t.clan)) return '이미 혼맥이 있다';
      const op = opinion(s, t, p);
      if (op < 25) return `상대의 호감이 25 이상이어야 한다 (현재 ${op})`;
      return null;
    },
    run: (s, t) => marry(s, t, 40),
  },
  {
    id: 'probe',
    name: '탐문',
    cost: () => 1,
    desc: '겸인을 풀어 그의 행실을 알아본다. 숨기는 것이 있는지, 무엇을 바라는지 알 수 있고, 운이 좋으면 약점을 바로 잡는다.',
    check: (s, t) => basic(s, t) ?? cdMsg(s, `probe:${t.id}`),
    run(s, t) {
      const p = P(s);
      setCd(s, `probe:${t.id}`, 6);
      const hidden = t.flaws.filter((f) => !f.public && !f.knownBy.includes(p.id));
      const sc = (schemer(p) ? 0.1 : 0) + s.player.retainers * 0.05;
      let text: string;
      if (hidden.length && chance(s, clamp(0.25 + (p.politics - t.politics) * 0.05 + sc, 0.08, 0.55))) {
        hidden[0].knownBy.push(p.id);
        s.player.intel[t.id] = { t: s.t, dirty: hidden.length > 1 };
        text = `탐문 중에 ${t.name}의 약점을 잡았다: 「${hidden[0].label}」.`;
      } else {
        const right = chance(s, 0.8 + sc);
        const dirty = right ? hidden.length > 0 : hidden.length === 0;
        s.player.intel[t.id] = { t: s.t, dirty };
        text = dirty
          ? `${t.name}에게는 뭔가 숨기는 구석이 있는 듯하다. 뒷조사를 해 볼 만하다.`
          : `${josa(t.name, '은/는')} 깨끗한 편으로 보인다. 캐 봐야 나올 것이 없을지 모른다.`;
      }
      text += learnWant(s, t);
      if (chance(s, 0.06)) {
        const fx = sway(s, t, p.id, -8, '뒤를 캠', { decay: 0.2 });
        text += ` 그런데 그가 낌새를 챘다.${joined(fx)}`;
      }
      return text;
    },
  },
  {
    id: 'investigate',
    name: '뒷조사',
    cost: () => 1,
    desc: `재산 ${INVESTIGATE_COST}을 들여 겸인에게 몇 달 동안 그의 뒤를 캐게 한다. 다른 행동과 따로 진행된다. 한 번에 한 사람만.`,
    check(s, t) {
      const p = P(s);
      const sc = s.player.scheme;
      return (
        basic(s, t) ??
        (sc?.targetId === t.id ? '이미 진행 중이다' : null) ??
        (sc ? `${s.chars[sc.targetId]?.name}의 뒷조사가 진행 중이다` : null) ??
        (p.wealth < INVESTIGATE_COST ? `재산이 ${INVESTIGATE_COST} 이상 있어야 한다` : null)
      );
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= INVESTIGATE_COST;
      const req = schemer(p) ? 1 : 2;
      s.player.scheme = { kind: 'investigate', targetId: t.id, progress: 0, required: req };
      return `겸인들에게 ${t.name}의 뒤를 캐게 했다. (${req}개월)`;
    },
  },
  {
    id: 'blackmail',
    name: '협박',
    cost: () => 1,
    desc: '쥐고 있는 약점으로 그를 옭아맨다. 그는 신세를 진 것처럼 당신 편에 서지만 앙심을 품는다. 강직한 이는 굴하지 않는다.',
    check(s, t) {
      return (
        basic(s, t) ??
        traitForbids(P(s), 'deceit') ??
        traitForbids(P(s), 'cruel') ??
        (heldFlaws(s, t).some((f) => !f.fake) ? null : '쥐고 있는 그의 약점이 없다 (뒷조사로 찾는다)') ??
        cdMsg(s, `blackmail:${t.id}`)
      );
    },
    run(s, t) {
      const p = P(s);
      setCd(s, `blackmail:${t.id}`, 12);
      const f = heldFlaws(s, t).find((x) => !x.fake)!;
      if (t.traits.includes('upright')) {
        const fx = sway(s, t, p.id, -20, '협박', { clan: 0.3, decay: 0.1 });
        let extra = '';
        if (chance(s, 0.4)) {
          addFlaw(s, p, '협박', false, [t.id]);
          extra = ' 그는 당신이 협박했다는 사실을 기억해 둘 것이다.';
        }
        return `${josa(t.name, '은/는')} 「${f.label}」 이야기에도 눈 하나 깜짝하지 않았다.${joined(fx)}${extra}`;
      }
      owe(s, t.id);
      const fx = sway(s, t, p.id, -15, '협박', { decay: 0.1 });
      return `「${f.label}」 건을 넌지시 꺼내자 ${t.name}의 낯빛이 변했다. 그는 당신의 뜻을 따를 것이다.${joined(fx)}`;
    },
  },
  {
    id: 'impeach',
    name: '탄핵',
    cost: (s) => (isSamsa(P(s)) ? 'authority' : 1),
    desc: `논핵을 시작한다. 2개월 동안 양쪽이 동조자와 구원자를 모은 뒤 판정한다. 삼사 언관이면 직권으로, 아니면 상소로(-1) 한다. 알고 있는 흠결 1개당 +1. 한 번 하면 ${IMPEACH_COOLDOWN}개월 쉬어야 하고, 2년 안에 세 번째부터는 공격이 1씩 약해진다(최대 -2).`,
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (t.status !== 'active' || !t.office) return '관직에 있지 않다';
      if (!inCourt(p) || !atSeat(s, p)) return `${seatName(s)}에 있어야 한다`;
      if (!isSamsa(p) && p.politics < 3) return '삼사 언관이 아니면 정치력 3 이상이 필요하다';
      const etq = impeachEtiquette(p, t, isSamsa(p));
      if (etq) return etq;
      if (caseOn(s, t.id)) return '이미 논핵이 벌어지고 있다. 조정 공방에서 동조할 수 있다';
      if (myAttack(s)) return '이미 다른 논핵을 이끌고 있다';
      return cdMsg(s, 'impeach');
    },
    run(s, t) {
      const p = P(s);
      const broke = betray(s, t);
      openCase(s, p, t, { byMemorial: !isSamsa(p) });
      setCd(s, 'impeach', IMPEACH_COOLDOWN);
      s.player.impeachAt = [...s.player.impeachAt.filter((x) => s.t - x <= 24), s.t];
      return `${josa(t.name, '을/를')} 논핵하기 시작했다. 2개월 동안 '연명 요청'으로 동조자를 모으라.${broke}`;
    },
  },
  {
    id: 'recommend',
    name: '천거',
    cost: () => 'authority',
    desc: '이조판서나 이조전랑만 할 수 있다. 6개월간 임용 점수 +8. 당사자와 가문, 당이 은혜로 여기고 그가 신세를 진다.',
    check(s, t) {
      const p = P(s);
      if (p.office !== 'ijo' && p.office !== 'jeonrang') return '이조판서나 이조전랑이어야 한다';
      if (basic(s, t)) return basic(s, t);
      if (!inCourt(t)) return '조정에 있는 사람만 천거할 수 있다';
      if (t.traits.includes('seoeol')) return '서얼은 천거할 수 없다';
      return cdMsg(s, 'recommend') ?? cdMsg(s, `recommend:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      s.recs[t.id] = s.t + 6;
      setCd(s, 'recommend', 2);
      setCd(s, `recommend:${t.id}`, 8);
      setCd(s, `backed:${t.id}`, 6);
      owe(s, t.id);
      const fx = sway(s, t, p.id, 18, '천거의 은혜', { clan: 0.3, faction: 0.1, decay: 0.15, cap: 30 });
      return `${josa(t.name, '을/를')} 천거했다. 그가 당신에게 신세를 졌다.${joined(fx)}`;
    },
  },
  {
    id: 'ask_recommend',
    name: '천거 청탁',
    cost: () => 1,
    desc: '이조판서나 이조전랑에게 나를 천거해 달라고 부탁한다. 6개월간 임용 점수 +8. 호감이 30은 넘어야 하고, 신세를 진 사이면 반드시 들어준다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (t.status !== 'active' || (t.office !== 'ijo' && t.office !== 'jeonrang')) return '이조판서나 이조전랑이어야 한다';
      if (!inCourt(p)) return '조정에 있어야 한다';
      if ((s.recs[p.id] ?? -1) > s.t) return '이미 천거를 받아 두었다';
      return cdMsg(s, `ask_rec:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      setCd(s, `ask_rec:${t.id}`, 12);
      if (collect(s, t.id)) {
        s.recs[p.id] = s.t + 6;
        return `${josa(t.name, '이/가')} 지난 신세를 갚겠다며 당신을 천거하기로 했다. (6개월간 임용 점수 +8)`;
      }
      const op = opinion(s, t, p);
      if (chance(s, clamp(0.5 + (op - 30) / 30, 0.05, 0.95))) {
        s.recs[p.id] = s.t + 6;
        return `${josa(t.name, '이/가')} 당신을 천거하기로 했다. (6개월간 임용 점수 +8)`;
      }
      const fx = sway(s, t, p.id, -4, '무리한 청탁', { decay: 0.3 });
      return `${josa(t.name, '이/가')} 난처한 기색으로 거절했다. (호감 ${op})${joined(fx)}`;
    },
  },
  {
    id: 'cosign',
    name: '연명 요청',
    cost: () => 1,
    desc: '내가 이끄는 논핵에 동조하거나, 준비 중인 상소에 이름을 올려 달라고 청한다. 1인당 +1 (최대 +3). 신세를 진 이는 반드시 응한다.',
    check(s, t) {
      const f = s.player.focus;
      const cs = myAttack(s);
      if (!cs && f?.kind !== 'memorial') return '이끄는 논핵이나 준비 중인 상소가 없다';
      if (basic(s, t)) return basic(s, t);
      if (t.status === 'exiled') return '유배 중이다';
      if (cs) {
        if (sideOf(cs, t.id)) return '이미 공방에 얽혀 있다';
      } else {
        if (f!.cosigners.includes(t.id)) return '이미 연명했다';
        if (f!.targetId === t.id) return '상소의 당사자다';
      }
      return cdMsg(s, `cosign:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      const cs = myAttack(s);
      setCd(s, `cosign:${t.id}`, 6);
      const op = opinion(s, t, p);
      if (cs) {
        const tgt = s.chars[cs.target];
        if (collect(s, t.id)) {
          cs.pros.push(t.id);
          return `${josa(t.name, '이/가')} 신세를 갚겠다며 논핵에 가세했다. (동조 ${cs.pros.length}인)`;
        }
        const need = 25 + (tgt.faction === t.faction && t.faction !== 'none' ? 30 : 0) - (opinion(s, t, tgt) < -20 ? 15 : 0);
        if (chance(s, clamp(0.5 + (op - need) / 40, 0.05, 0.95))) {
          cs.pros.push(t.id);
          return `${josa(t.name, '이/가')} 논핵에 가세했다. (동조 ${cs.pros.length}인)`;
        }
        return `${josa(t.name, '이/가')} 가세를 거절했다. (호감 ${op}, 필요 ${need} 안팎)`;
      }
      const f = s.player.focus!;
      if (collect(s, t.id)) {
        f.cosigners.push(t.id);
        return `${josa(t.name, '이/가')} 신세를 갚겠다며 연명했다. (연명 ${f.cosigners.length}인)`;
      }
      let need = f.topic === 'sipye' ? 10 : 20;
      if (f.topic === 'law' && f.lawId && LAW_MAP[f.lawId]) {
        // 그의 당이 이 법을 어떻게 보느냐가 크게 작용한다
        const st = lawStance(LAW_MAP[f.lawId], t.faction, !f.abolish);
        need = Math.round(20 - st * 25);
      }
      const tgt = f.targetId ? s.chars[f.targetId] : undefined;
      if (f.topic === 'recall' && tgt && tgt.faction === t.faction) need -= 10;
      if (chance(s, clamp(0.5 + (op - need) / 40, 0.05, 0.95))) {
        f.cosigners.push(t.id);
        return `${josa(t.name, '이/가')} 연명에 동참했다. (연명 ${f.cosigners.length}인)`;
      }
      return `${josa(t.name, '이/가')} 연명을 거절했다. (호감 ${op}, 필요 ${need} 안팎)`;
    },
  },
  {
    id: 'plead',
    name: '구원 요청',
    cost: () => 1,
    desc: '나를 겨눈 논핵에서 편을 들어 달라고 청한다. 1인당 방어 +1 (최대 +3). 신세를 진 이는 반드시 응한다. 유배 중에도 서신으로 할 수 있다.',
    check(s, t) {
      const p = P(s);
      const cs = caseOn(s, p.id);
      if (!cs) return '나를 겨눈 논핵이 없다';
      if (basic(s, t)) return basic(s, t);
      if (sideOf(cs, t.id)) return '이미 공방에 얽혀 있다';
      if (!inCourt(t)) return '조정에 있는 사람이어야 한다';
      return cdMsg(s, `plead:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      const cs = caseOn(s, p.id)!;
      setCd(s, `plead:${t.id}`, 6);
      if (collect(s, t.id)) {
        cs.cons.push(t.id);
        return `${josa(t.name, '이/가')} 신세를 갚겠다며 구원에 나섰다. (구원 ${cs.cons.length}인)`;
      }
      const atk = s.chars[cs.attacker];
      const op = opinion(s, t, p);
      const need = 20 + (atk.faction === t.faction && t.faction !== 'none' ? 30 : 0);
      if (chance(s, clamp(0.5 + (op - need) / 40, 0.05, 0.95))) {
        cs.cons.push(t.id);
        return `${josa(t.name, '이/가')} 구원 상소에 이름을 올렸다. (구원 ${cs.cons.length}인)`;
      }
      return `${josa(t.name, '이/가')} 몸을 사렸다. (호감 ${op}, 필요 ${need} 안팎)`;
    },
  },
  {
    id: 'recall',
    name: '신원 상소',
    cost: () => 0,
    desc: '유배된 이를 풀어 달라는 상소를 준비한다. 성공하면 큰 은혜가 되고 그가 두 번 신세를 진다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (t.status !== 'exiled') return '유배 중인 사람이 아니다';
      if (p.status === 'exiled') return '당신도 유배 중이다';
      const f = s.player.focus;
      if (f?.kind === 'memorial') return f.topic === 'recall' && f.targetId === t.id ? '이미 그의 신원 상소를 짓고 있다' : '이미 다른 상소를 짓고 있다';
      return memorialError(s);
    },
    run(s, t) {
      s.player.focus = { kind: 'memorial', topic: 'recall', targetId: t.id, progress: 0, required: 2, cosigners: [] };
      return `${t.name}의 신원을 청하는 상소를 짓기 시작했다. 두 달 동안 연명을 모으자.`;
    },
  },
  {
    id: 'pact',
    name: '맹약',
    cost: () => 1,
    desc: `같은 당 사람과 뜻을 함께하기로 약속한다. 맹약을 맺은 이는 당신의 논핵에 동조하고, 당신이 논핵당하면 구원하며, 당신을 노리는 음모를 귀띔해 준다. 최대 ${MAX_BONDS}명. 그를 공격하면 배신이 된다.`,
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (bondWith(s, t.id)) return '이미 맹약을 맺었다';
      if (bondCount(s) >= MAX_BONDS) return `맹약은 ${MAX_BONDS}명까지다`;
      if (!inCourt(t)) return '조정에 있는 사람이어야 한다';
      if (p.faction === 'none' || topOf(p.faction) !== topOf(t.faction)) return '같은 당 사람이어야 한다 (다른 당과는 밀서로)';
      if (opinion(s, t, p) < 50 && !(s.player.debts[t.id] > 0)) return '호감 50 이상이거나 신세를 진 사람이어야 한다';
      return cdMsg(s, `pact:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      setCd(s, `pact:${t.id}`, 6);
      const op = opinion(s, t, p);
      if (collect(s, t.id) || chance(s, clamp(0.55 + (op - 50) / 50, 0.2, 0.95))) {
        addBond(s, t);
        log(s, `${josa(p.name, '과/와')} ${josa(t.name, '이/가')} 맹약을 맺었다.`, 'player');
        return `${josa(t.name, '과/와')} 맹약을 맺었다. 이제 공방이 열리면 그가 당신 편에 선다.`;
      }
      const fx = sway(s, t, p.id, -3, '부담스러운 제안', { decay: 0.3 });
      return `${josa(t.name, '은/는')} 아직 그럴 사이는 아니라며 웃어넘겼다.${joined(fx)}`;
    },
  },
  {
    id: 'secret',
    name: '밀서',
    cost: () => 1,
    desc: '재산 5를 들여 은밀한 편지로 맹약을 청한다. 다른 당 사람과도 몰래 손잡을 수 있다. 다만 편지가 중간에 가로채이면 큰 낭패를 본다. 유배 중에도 보낼 수 있다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (bondWith(s, t.id)) return '이미 맹약을 맺었다';
      if (bondCount(s) >= MAX_BONDS) return `맹약은 ${MAX_BONDS}명까지다`;
      if (t.status === 'exiled') return '유배 중인 사람과는 맺을 수 없다';
      if (p.wealth < 5) return '재산이 5 이상 있어야 한다';
      if (opinion(s, t, p) < 40 && !(s.player.debts[t.id] > 0)) return '호감 40 이상이거나 신세를 진 사람이어야 한다';
      return cdMsg(s, `pact:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= 5;
      setCd(s, `pact:${t.id}`, 6);
      const cross = p.faction !== 'none' && t.faction !== 'none' && topOf(p.faction) !== topOf(t.faction);
      const risk = 0.08 + (cross ? 0.1 : 0) - (schemer(p) ? 0.05 : 0) - s.player.retainers * 0.01;
      if (chance(s, risk)) {
        pushEvent(s, 'letter_intercepted', { with: t.id, cross });
        return `${t.name}에게 보낸 밀서가 돌아오지 않는다…`;
      }
      const op = opinion(s, t, p);
      if (collect(s, t.id) || chance(s, clamp(0.5 + (op - 40) / 40, 0.15, 0.9))) {
        addBond(s, t, cross);
        return cross
          ? `${josa(t.name, '과/와')} 몰래 맹약을 맺었다. 당색이 달라 세상에는 비밀이다. 그가 저쪽 당의 음모를 귀띔해 줄 것이다.`
          : `${josa(t.name, '과/와')} 은밀히 맹약을 맺었다.`;
      }
      return `${josa(t.name, '은/는')} 답장을 보내지 않았다.`;
    },
  },
  {
    id: 'reconcile',
    name: '화해 청함',
    cost: () => 1,
    desc: '재산 10으로 예물을 갖추어 사람을 보내 묵은 감정을 풀자고 청한다. 성공하면 그가 꾸미던 일을 거둔다. 너그러운 이일수록, 미움이 얕을수록 잘 통한다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      const plotting = s.plots.some((x) => x.by === t.id && x.known);
      if (!plotting && opinion(s, t, p) > -15) return '사이가 나쁘거나(호감 -15 이하) 나를 노리는 사람이어야 한다';
      if (p.wealth < 10) return '재산이 10 이상 있어야 한다';
      return cdMsg(s, `reconcile:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= 10;
      setCd(s, `reconcile:${t.id}`, 12);
      const op = opinion(s, t, p);
      const grudge = t.grudges.includes(p.id);
      const ch = clamp(0.45 + op / 100 + (t.traits.includes('mild') || t.traits.includes('mediator') ? 0.2 : 0) - (t.traits.includes('ambitious') ? 0.15 : 0) - (grudge ? 0.25 : 0) + (p.traits.includes('mild') ? 0.1 : 0), 0.05, 0.9);
      if (chance(s, ch)) {
        const had = s.plots.some((x) => x.by === t.id);
        s.plots = s.plots.filter((x) => x.by !== t.id);
        t.grudges = t.grudges.filter((id) => id !== p.id);
        const fx = sway(s, t, p.id, 22, '화해', { clan: 0.3, decay: 0.1, cap: 30 });
        return `${josa(t.name, '이/가')} 예물을 받고 손을 맞잡았다.${had ? ' 꾸미던 일을 거두기로 했다.' : ''}${joined(fx)}`;
      }
      const fx = sway(s, t, p.id, -4, '얕은 수작', { decay: 0.3 });
      return `${josa(t.name, '은/는')} 예물을 돌려보냈다. (성공 확률 ${Math.round(ch * 100)}%)${joined(fx)}`;
    },
  },
  {
    id: 'hush',
    name: '흠결 무마',
    cost: () => 1,
    desc: '내 숨은 흠결을 쥔 사람에게 재산 25를 건네 입을 막는다. 탐욕스러운 이는 쉽게 넘어오지만, 강직한 이에게 잘못 건네면 흠결이 세상에 드러난다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      const no = traitForbids(p, 'deceit');
      if (no) return no;
      if (!p.flaws.some((f) => !f.public && f.knownBy.includes(t.id))) return '그는 나의 숨은 흠결을 쥐고 있지 않다';
      if (p.wealth < 25) return '재산이 25 이상 있어야 한다';
      return cdMsg(s, `hush:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= 25;
      setCd(s, `hush:${t.id}`, 6);
      const f = p.flaws.find((x) => !x.public && x.knownBy.includes(t.id))!;
      const upright = t.traits.includes('upright');
      const ch = t.traits.includes('greedy') ? 0.9 : upright ? 0.15 : t.traits.includes('clean') ? 0.35 : 0.6;
      if (collect(s, t.id) || chance(s, clamp(ch + opinion(s, t, p) / 200, 0.05, 0.95))) {
        f.knownBy = f.knownBy.filter((id) => id !== t.id);
        s.plots = s.plots.filter((x) => x.by !== t.id || !x.known);
        return `${josa(t.name, '이/가')} '${f.label}'에 대해 입을 다물기로 했다.`;
      }
      if (upright || chance(s, 0.25)) {
        f.public = true;
        p.prestige = clamp(p.prestige - 3, 0, 100);
        log(s, `${josa(t.name, '이/가')} ${p.name}의 입막음을 거절하고 '${f.label}'을 세상에 알렸다.`, 'player');
        return `${josa(t.name, '이/가')} 노하여 '${f.label}'을 세상에 알렸다! (명망 -3, 흠결 공개)`;
      }
      const fx = sway(s, t, p.id, -5, '입막음 시도', { decay: 0.2 });
      return `${josa(t.name, '은/는')} 재물만 받고 확답을 주지 않았다.${joined(fx)}`;
    },
  },
  {
    id: 'sponsor',
    name: '문인 밀어주기',
    cost: () => 1,
    desc: '재산 10으로 당신의 문인을 요로에 소개한다. 6개월 동안 그의 인사 평가가 크게 오르고, 그가 승차하면 신세를 진다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (t.teacher !== p.id) return '나의 문인이 아니다';
      if (!inCourt(t)) return '조정에 있는 문인이어야 한다';
      if (p.wealth < 10) return '재산이 10 이상 있어야 한다';
      return cdMsg(s, `sponsor:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= 10;
      setCd(s, `sponsor:${t.id}`, 8);
      setCd(s, `backed:${t.id}`, 6);
      s.recs[t.id] = s.t + 6;
      const fx = sway(s, t, p.id, 8, '스승의 후원', { decay: 0.1, cap: 20 });
      return `문인 ${josa(t.name, '을/를')} 요로에 소개했다. 반년 동안 인사에서 유리하다.${joined(fx)}`;
    },
  },
  {
    id: 'bribe',
    name: '뇌물',
    cost: () => 1,
    desc: '이조판서나 전랑에게 재산 30을 건네 반년 동안 당신의 인사를 밀어 달라고 한다. 서로의 숨은 흠결이 생기고, 강직한 이는 거절하며 소문을 낼 수 있다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (t.status !== 'active' || (t.office !== 'ijo' && t.office !== 'jeonrang')) return '이조판서나 이조전랑이어야 한다';
      const no = traitForbids(p, 'greed');
      if (no) return no;
      if (!inCourt(p)) return '조정에 있어야 한다';
      if (p.wealth < 30) return '재산이 30 이상 있어야 한다';
      return cdMsg(s, 'bribe');
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= 30;
      setCd(s, 'bribe', 12);
      if (t.traits.includes('upright') || (t.traits.includes('clean') && chance(s, 0.6))) {
        const fx = sway(s, t, p.id, -12, '뇌물을 내밂', { decay: 0.1 });
        if (chance(s, 0.5)) {
          addFlaw(s, p, '청탁 뇌물', true);
          p.prestige = clamp(p.prestige - 4, 0, 100);
          return `${josa(t.name, '이/가')} 크게 꾸짖으며 뇌물을 물리쳤고, 소문이 퍼졌다. (흠결 공개, 명망 -4)${joined(fx)}`;
        }
        return `${josa(t.name, '이/가')} 뇌물을 물리쳤다.${joined(fx)}`;
      }
      s.recs[p.id] = s.t + 6;
      addFlaw(s, p, '청탁 뇌물', false, [t.id]);
      addFlaw(s, t, '뇌물 수수', false, [p.id]);
      const fx = sway(s, t, p.id, t.traits.includes('greedy') ? 12 : 5, '두둑한 예물', { decay: 0.2 });
      const wish = fulfill(s, t, 'wealth');
      return `${josa(t.name, '이/가')} 은밀히 재물을 받았다. 반년 동안 당신의 인사가 유리하다. 서로가 서로의 약점을 쥐었다.${joined(fx)}${wish ? ` ${wish}` : ''}`;
    },
  },
  {
    id: 'recruit',
    name: '포섭',
    cost: () => 2,
    desc: `당색이 없는 이를 우리 당으로 끌어들인다. 호감이 높거나 신세를 진 사이여야 하고, 한평생 당적을 바꾸는 일은 ${MAX_SWITCHES}번을 넘지 못한다. 당이 기울어 있으면 잘 넘어오지 않는다.`,
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (p.faction === 'none') return '당신부터 당에 들어야 한다';
      if (t.faction !== 'none') return '이미 당색이 있다';
      if (t.status === 'exiled') return '유배 중이다';
      if (!inCourt(t) && t.status !== 'retired') return '조정이나 향리에 있는 사람이어야 한다';
      if ((t.switched ?? 0) >= MAX_SWITCHES) return '이미 몇 번 당을 오간 사람이라 더는 움직이지 않는다';
      if (t.traits.includes('mediator') && opinion(s, t, p) < 60) return '조제를 소신으로 여기는 사람이다 (호감 60 이상 필요)';
      if (opinion(s, t, p) < 30 && !(s.player.debts[t.id] > 0)) return '호감 30 이상이거나 신세를 진 사이여야 한다';
      return cdMsg(s, `recruit:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      setCd(s, `recruit:${t.id}`, 12);
      const op = opinion(s, t, p);
      const share = powerShare(s)[p.faction] ?? 0;
      const ch = clamp(0.25 + (op - 30) / 80 + p.politics * 0.03 + (share < 0.35 ? -0.1 : 0) + (t.traits.includes('ambitious') ? 0.1 : 0) - (t.traits.includes('recluse') ? 0.15 : 0), 0.05, 0.85);
      if (collect(s, t.id) || chance(s, ch)) {
        t.faction = p.faction;
        t.switched = (t.switched ?? 0) + 1;
        const fx = swayFaction(s, p.faction, p.id, 4, '동지를 끌어들임', 0.06);
        log(s, `${josa(t.name, '이/가')} ${josa(p.name, '의')} 권유로 ${FACTION_META[p.faction].name}에 들었다.`, 'player');
        return `${josa(t.name, '이/가')} 당신의 권유를 받아들여 ${FACTION_META[p.faction].name}에 들었다.${fx ? ` (${fx})` : ''}`;
      }
      const fx = sway(s, t, p.id, -5, '당파로 끌어들이려 함', { decay: 0.2 });
      return `${josa(t.name, '은/는')} 어느 당에도 매이고 싶지 않다며 사양했다. (확률 ${Math.round(ch * 100)}%)${joined(fx)}`;
    },
  },
];

/** 나를 겨눈 논핵의 동조자를 회유해 빠지게 한다 */
TARGET_ACTIONS.push({
  id: 'persuade',
  name: '회유',
  cost: () => 1,
  desc: '나를 논핵하는 데 이름을 올린 이에게 재산 15를 들여 사람을 보내 빠지게 한다. 탐욕스러운 이는 쉽게 넘어오고, 강직한 이는 오히려 노한다.',
  check(s, t) {
    const p = P(s);
    if (basic(s, t)) return basic(s, t);
    const cs = caseOn(s, p.id);
    if (!cs || !cs.pros.includes(t.id)) return '나를 겨눈 논핵에 동조한 사람이 아니다';
    if (p.wealth < 15) return '재산이 15 이상 있어야 한다';
    return cdMsg(s, `persuade:${t.id}`);
  },
  run(s, t) {
    const p = P(s);
    const cs = caseOn(s, p.id)!;
    p.wealth -= 15;
    setCd(s, `persuade:${t.id}`, 12);
    const ch = clamp((t.traits.includes('greedy') ? 0.85 : t.traits.includes('upright') ? 0.1 : 0.45) + opinion(s, t, p) / 150, 0.05, 0.95);
    if (collect(s, t.id) || chance(s, ch)) {
      cs.pros = cs.pros.filter((id) => id !== t.id);
      return `${josa(t.name, '이/가')} 슬그머니 연명에서 이름을 뺐다. (동조 ${cs.pros.length}인)`;
    }
    if (t.traits.includes('upright') && chance(s, 0.5)) {
      cs.bonus += 1;
      return `${josa(t.name, '이/가')} 회유하러 온 사람을 내쫓고 그 일을 조정에 알렸다. 논핵의 기세가 오히려 거세졌다. (공격 +1)`;
    }
    return `${josa(t.name, '은/는')} 뜻을 굽히지 않았다. (확률 ${Math.round(ch * 100)}%)`;
  },
});

/* ───────── 정치 공작 ───────── */

TARGET_ACTIONS.push(
  {
    id: 'disinfo',
    name: '역정보',
    cost: () => 1,
    desc: '재산 10으로 겸인을 시켜, 다른 당 사람이 몰래 우리 쪽과 내통한다는 말을 그의 당에 흘린다. 그의 당내 입지가 흔들린다. 들키면 흠결이 생긴다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (p.faction === 'none' || t.faction === 'none' || topOf(t.faction) === topOf(p.faction)) return '다른 당 사람이어야 한다';
      if (p.wealth < 10) return '재산이 10 이상 있어야 한다';
      return traitForbids(p, 'deceit') ?? cdMsg(s, `disinfo:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= 10;
      setCd(s, `disinfo:${t.id}`, 12);
      const ch = clamp(0.5 + (p.politics - t.politics) * 0.06 + (schemer(p) ? 0.15 : 0) + s.player.retainers * 0.03, 0.1, 0.9);
      if (chance(s, ch)) {
        const fx = swayFaction(s, t.faction, t.id, -10, '내통한다는 소문', 0.06);
        if (s.factions[t.faction]?.leader === t.id) s.factions[t.faction].division += 3;
        return `${t.name}이 우리 쪽과 통한다는 말이 그의 당에 퍼졌다. (${fx})`;
      }
      if (chance(s, 0.4)) {
        addFlaw(s, p, '역정보 유포', false, [t.id]);
        const fx = sway(s, t, p.id, -15, '거짓 소문을 퍼뜨림', { clan: 0.3, decay: 0.1 });
        return `소문의 출처가 당신이라는 것이 그에게 알려졌다.${joined(fx)}`;
      }
      return `소문이 퍼지지 않았다. (확률 ${Math.round(ch * 100)}%)`;
    },
  },
  {
    id: 'alienate',
    name: '이간',
    cost: () => 1,
    desc: '나를 믿는 사람(호감 20 이상이거나 사돈)에게 그가 가장 가까이하는 동료의 험담을 흘려 둘 사이를 벌린다. 둘의 호감이 크게 떨어진다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (opinion(s, t, p) < 20 && !inLaws(s, p.clan, t.clan)) return '호감 20 이상이거나 사돈이어야 한다';
      if (!closestAlly(s, t)) return '그와 가까운 동료가 없다';
      return traitForbids(p, 'deceit') ?? cdMsg(s, `alienate:${t.id}`);
    },
    run(s, t) {
      const p = P(s);
      setCd(s, `alienate:${t.id}`, 12);
      const a = closestAlly(s, t)!;
      const ch = clamp(0.45 + (p.politics - a.politics) * 0.05 + (schemer(p) ? 0.15 : 0), 0.1, 0.85);
      if (chance(s, ch)) {
        sway(s, t, a.id, -20, '험담을 전해 들음', { decay: 0.06 });
        sway(s, a, t.id, -12, '사이가 벌어짐', { decay: 0.06 });
        return `${josa(t.name, '과/와')} ${a.name} 사이가 벌어졌다.`;
      }
      const fx = sway(s, t, p.id, -10, '이간질', { decay: 0.1 });
      return `${josa(t.name, '은/는')} 당신의 말을 믿지 않았다.${joined(fx)}`;
    },
  },
  {
    id: 'placard',
    name: '괘서',
    cost: () => 2,
    desc: '재산 20을 들여 그가 역모를 꾀한다는 익명서를 도성에 붙인다. 통하면 국청이 열려 그와 그의 당이 쑥대밭이 된다. 위관이 진위를 캐거나 운이 나쁘면 무고가 드러나 당신이 위리안치된다. 가장 위험한 공작이다.',
    check(s, t) {
      const p = P(s);
      if (basic(s, t)) return basic(s, t);
      if (s.oksa) return '이미 국청이 열려 있다';
      if (t.faction === 'none' || topOf(t.faction) === topOf(p.faction)) return '다른 당 사람이어야 한다';
      if (p.wealth < 20) return '재산이 20 이상 있어야 한다';
      if (!inCourt(p)) return '조정에 있어야 한다';
      return traitForbids(p, 'deceit') ?? traitForbids(p, 'cruel') ?? cdMsg(s, 'placard');
    },
    run(s, t) {
      const p = P(s);
      p.wealth -= 20;
      setCd(s, 'placard', 24);
      const ch = clamp(0.4 + p.politics * 0.03 + (schemer(p) ? 0.15 : 0) - t.favor / 300, 0.1, 0.8);
      if (chance(s, ch)) {
        startOksa(s, t, p.id, true);
        return `도성 곳곳에 붙은 괘서가 왕에게 들어갔다. ${t.name}을 두고 국청이 열린다.`;
      }
      if (chance(s, 0.35)) {
        addFlaw(s, p, '괘서 무고', true);
        exile(s, p);
        return '괘서를 붙이다 겸인이 붙잡혔다. 배후가 드러나 당신이 유배되었다.';
      }
      return `괘서가 금세 뜯겨 나갔다. 아무 일도 일어나지 않았다. (확률 ${Math.round(ch * 100)}%)`;
    },
  },
);

/* ───────── 행동 통폐합 ─────────
 * 비슷한 행동을 하나로 묶는다. 옛 행동의 처리는 그대로 두고, 상황에 따라 알맞은 쪽으로 나뉜다.
 */
{
  const take = (id: TargetActionId): TargetAction => {
    const i = TARGET_ACTIONS.findIndex((a) => a.id === id);
    return TARGET_ACTIONS.splice(i, 1)[0];
  };
  const get = (id: TargetActionId) => TARGET_ACTIONS.find((a) => a.id === id)!;
  const letter = take('letter');
  const probe = take('probe');
  const secret = take('secret');
  const bribe = take('bribe');
  const plead = take('plead');
  const disinfo = take('disinfo');
  take('recommend');
  void probe;

  // 교유: 같은 곳에 있으면 찾아가고, 멀리 있으면 서신을 보낸다
  const visit = get('visit');
  const v0 = { check: visit.check, run: visit.run };
  const far = (s: GameState, t: Character) => {
    const p = P(s);
    return p.status === 'exiled' || isAbroad(s) || t.status === 'exiled' || p.location !== t.location;
  };
  visit.name = '교유';
  visit.desc = '사람을 사귄다. 같은 곳에 있으면 직접 찾아가 그 가문 전체에 인상을 남기고(쿨다운 4달), 멀리 있으면 서신을 보낸다(쿨다운 3달). 유배 중에도 서신은 보낼 수 있다.';
  visit.check = (s, t) => (far(s, t) ? letter.check(s, t) : v0.check(s, t));
  visit.run = (s, t) => (far(s, t) ? letter.run(s, t) : v0.run(s, t));

  // 뒷조사: 탐문을 겸한다 (그가 바라는 것도 알아 온다)
  const inv = get('investigate');
  const i0 = inv.run;
  inv.desc = `재산 ${INVESTIGATE_COST}을 들여 겸인에게 몇 달 동안 그의 뒤를 캐게 한다. 곧바로 그가 바라는 것을 알아 오고, 끝나면 숨긴 흠결을 잡을 수 있다. 한 번에 한 사람만.`;
  inv.run = (s, t) => `${i0(s, t)}${learnWant(s, t)}`;

  // 맹약: 같은 당이면 드러내 놓고, 다른 당이거나 유배 중이면 밀서로
  const pact = get('pact');
  const p0 = { check: pact.check, run: pact.run };
  const secretMode = (s: GameState, t: Character) => {
    const p = P(s);
    return p.status === 'exiled' || p.faction === 'none' || topOf(p.faction) !== topOf(t.faction);
  };
  pact.desc = `뜻을 함께하기로 약속한다. 같은 당이면 드러내 놓고(호감 50), 다른 당이거나 유배 중이면 재산 5를 들여 밀서로(호감 40) 몰래 맺는다. 밀서는 가로채일 수 있다. 맹약한 이는 공방에서 당신 편에 서고 음모를 귀띔한다. 최대 ${MAX_BONDS}명.`;
  pact.check = (s, t) => (secretMode(s, t) ? secret.check(s, t) : p0.check(s, t));
  pact.run = (s, t) => (secretMode(s, t) ? secret.run(s, t) : p0.run(s, t));

  // 청탁: 신세와 호감으로 부탁하고, 안 되면 예물을 곁들인다
  const ask = get('ask_recommend');
  const a0 = ask.run;
  ask.name = '청탁';
  ask.desc = '이조판서나 이조전랑에게 나를 천거해 달라고 부탁한다(6개월간 임용 점수 +8). 신세를 진 사이면 반드시, 호감이 높을수록 잘 들어준다. 거절당하면 재산 30으로 예물을 곁들여 다시 청한다 — 서로의 숨은 흠결이 생기고, 강직한 이는 노한다. 청렴·강직한 성품은 예물을 쓰지 않는다.';
  ask.run = (s, t) => {
    const p = P(s);
    const r = a0(s, t);
    if ((s.recs[p.id] ?? -1) > s.t) return r;
    if (p.wealth < 30 || traitForbids(p, 'greed') || cdLeft(s, 'bribe')) return r;
    return `${r} 예물을 곁들여 다시 청했다. ${bribe.run(s, t)}`;
  };

  // 연명·구원 요청: 내가 논핵당하고 있으면 구원을, 아니면 연명을 청한다
  const co = get('cosign');
  const c0 = { check: co.check, run: co.run };
  const defending = (s: GameState) => !!caseOn(s, P(s).id);
  co.name = '연명·구원 요청';
  co.desc = '내가 이끄는 논핵이나 준비 중인 상소에 이름을 올려 달라고 청한다. 내가 논핵을 당하고 있으면 구원을 청한다(유배 중에도 서신으로). 신세를 진 이는 반드시 응한다.';
  co.check = (s, t) => {
    if (defending(s)) return plead.check(s, t);
    if (P(s).status === 'exiled') return '유배 중이다';
    return c0.check(s, t);
  };
  co.run = (s, t) => (defending(s) ? plead.run(s, t) : c0.run(s, t));

  // 이간: 다른 당 사람이면 그의 당에 역정보를, 나를 믿는 이에게는 동료의 험담을
  const al = get('alienate');
  const al0 = { check: al.check, run: al.run };
  const enemy = (s: GameState, t: Character) => {
    const p = P(s);
    return p.faction !== 'none' && t.faction !== 'none' && topOf(t.faction) !== topOf(p.faction);
  };
  al.desc = '다른 당 사람이면 재산 10을 들여 그가 우리 쪽과 내통한다는 소문을 그의 당에 흘린다. 나를 믿는 사람(호감 20 이상이거나 사돈)이면 그와 가장 가까운 동료의 험담을 흘려 둘 사이를 벌린다.';
  al.check = (s, t) => (enemy(s, t) ? disinfo.check(s, t) : al0.check(s, t));
  al.run = (s, t) => (enemy(s, t) ? disinfo.run(s, t) : al0.run(s, t));
}

/** 그가 가장 가까이하는 같은 당 동료 */
function closestAlly(s: GameState, t: Character): Character | undefined {
  return Object.values(s.chars)
    .filter((c) => alive(c) && c.status !== 'royal' && c.id !== t.id && c.id !== s.player.charId && c.faction === t.faction && c.faction !== 'none')
    .sort((a, b) => opinion(s, t, b) - opinion(s, t, a))[0];
}

/* ───────── 당적(黨籍) ───────── */

export function joinError(s: GameState, f: FactionId): string | null {
  const p = P(s);
  if (f === 'none' || !s.factions[f]?.active) return '그런 당이 없다';
  if (p.faction === f) return '이미 그 당 사람이다';
  if (p.status === 'exiled') return '유배 중이다';
  if (s.player.factionChanges >= MAX_SWITCHES) return `한평생 당적을 바꾸는 일은 ${MAX_SWITCHES}번까지다`;
  if (p.faction !== 'none' && topOf(p.faction) === topOf(f)) return '갈라선 같은 뿌리의 당으로는 옮길 수 없다';
  const st = standing(s, f);
  const need = p.faction === 'none' ? 5 : 25;
  if (st < need) return `그 당 사람들의 평균 호감이 ${need} 이상이어야 한다 (현재 ${st})`;
  return cdMsg(s, 'joinFaction');
}

/** 당에 든다. 이미 당이 있으면 갈아타는 것이라 옛 당의 원한을 산다. */
export function joinFaction(s: GameState, f: FactionId): string {
  const err = joinError(s, f);
  if (err) return err;
  const p = P(s);
  setCd(s, 'joinFaction', 12);
  const st = standing(s, f);
  const lead = s.chars[s.factions[f].leader ?? ''];
  const lop = lead && alive(lead) && lead.id !== p.id ? opinion(s, lead, p) : st;
  const ch = clamp(0.35 + (st - 5) / 60 + (lop - 20) / 120 + p.prestige / 200, 0.1, 0.9);
  if (!chance(s, ch)) {
    const fx = swayFaction(s, f, p.id, -3, '어정쩡한 귀순', 0.1);
    return `${FACTION_META[f].name}의 원로들이 아직 당신을 믿지 못한다며 받아들이지 않았다. (확률 ${Math.round(ch * 100)}%)${fx ? ` (${fx})` : ''}`;
  }
  const old = p.faction;
  p.faction = f;
  s.player.factionChanges++;
  s.player.suspicion = 0;
  const fx: string[] = [swayFaction(s, f, p.id, 8, '새 동지', 0.05)];
  if (old !== 'none') {
    fx.push(swayFaction(s, old, p.id, -30, '당을 배신함', 0.03));
    p.prestige = clamp(p.prestige - 5, 0, 100);
    p.favor = clamp(p.favor - 3, -100, 100);
    s.player.bonds = s.player.bonds.filter((b) => s.chars[b.with]?.faction !== old || b.secret);
    s.player.deeds.push(`${shortDate(s.t)} ${FACTION_META[old].name}에서 ${FACTION_META[f].name}으로 전향`);
    log(s, `${josa(p.name, '이/가')} ${FACTION_META[old].name}을 떠나 ${FACTION_META[f].name}에 들었다. 옛 동지들이 이를 간다.`, 'player');
    return `${FACTION_META[f].name}에 들었다. ${FACTION_META[old].name}은 당신을 배신자로 여긴다. (명망 -5, 성심 -3, ${fx.filter(Boolean).join(', ')})`;
  }
  s.player.deeds.push(`${shortDate(s.t)} ${FACTION_META[f].name}에 듦`);
  log(s, `${josa(p.name, '이/가')} ${FACTION_META[f].name}에 들었다.`, 'player');
  return `${FACTION_META[f].name}과 뜻을 같이하기로 했다. (${fx.filter(Boolean).join(', ')})`;
}

export function leaveError(s: GameState): string | null {
  const p = P(s);
  if (p.faction === 'none') return '당색이 없다';
  if (s.player.factionChanges >= MAX_SWITCHES) return `한평생 당적을 바꾸는 일은 ${MAX_SWITCHES}번까지다`;
  if (s.factions[p.faction]?.leader === p.id) return '당의 영수는 당을 떠날 수 없다';
  return cdMsg(s, 'joinFaction');
}

/** 당을 떠나 어느 편에도 서지 않는다 */
export function leaveFaction(s: GameState): string {
  const err = leaveError(s);
  if (err) return err;
  const p = P(s);
  const old = p.faction;
  setCd(s, 'joinFaction', 12);
  p.faction = 'none';
  s.player.factionChanges++;
  const fx = swayFaction(s, old, p.id, -18, '당을 등짐', 0.04);
  s.tension = clamp(s.tension - 1, 0, 100);
  p.prestige = clamp(p.prestige + (p.traits.includes('mediator') ? 3 : -2), 0, 100);
  s.player.deeds.push(`${shortDate(s.t)} ${FACTION_META[old].name}을 떠남`);
  log(s, `${josa(p.name, '이/가')} ${FACTION_META[old].name}을 떠나 당론과 인연을 끊었다.`, 'player');
  return `${FACTION_META[old].name}을 떠났다. 이제 어느 당에도 매이지 않는다.${fx ? ` (${fx})` : ''}`;
}

export function runTargetAction(s: GameState, id: TargetActionId, targetId: string): string {
  const a = TARGET_ACTIONS.find((x) => x.id === id)!;
  const t = s.chars[targetId];
  const err = actionError(s, a, t);
  if (err) return err;
  const cost = a.cost(s);
  if (cost === 'authority') s.player.authorityUsed = true;
  else s.player.ap -= cost;
  // 사람을 움직이는 일은 처세를 익히는 일이다
  if (POLITICKING.includes(id)) s.player.exp.politics += 1;
  return a.run(s, t);
}

const POLITICKING: TargetActionId[] = ['impeach', 'cosign', 'plead', 'pact', 'secret', 'recommend', 'ask_recommend', 'bribe', 'blackmail', 'recruit', 'reconcile', 'hush'];

export const PROJECTS: Record<ProjectKind, { months: number; cost: number }> = {
  seowon: { months: 8, cost: 10 },
  munjip: { months: 10, cost: 3 },
};

/* ───────── 이달의 행동 ─────────
 * 행동력을 들여 하는 일. 한 달에 같은 일은 한 번만 한다.
 */

export type MonthlyId = 'work' | 'study' | 'teach' | 'rest' | 'seowon' | 'munjip' | 'buy_land' | 'sell_land' | 'usury' | 'hide_land';

export interface MonthlyAction {
  id: MonthlyId;
  name: string;
  /** 가산을 다루는 일인가 */
  estate?: boolean;
  cost: number;
  desc: string;
  check(s: GameState): string | null;
  run(s: GameState): string;
}

/** 성품이 허락하지 않는 일 */
export function traitForbids(c: Character, kind: 'greed' | 'cruel' | 'deceit' | 'stingy'): string | null {
  const has = (t: TraitId) => c.traits.includes(t);
  if (kind === 'greed') {
    if (has('clean')) return '청렴한 성품이 허락하지 않는다';
    if (has('upright')) return '강직한 성품이 허락하지 않는다';
  }
  if (kind === 'cruel' && has('mild')) return '온건한 성품이 허락하지 않는다';
  if (kind === 'deceit' && has('upright')) return '강직한 성품이 허락하지 않는다';
  if (kind === 'stingy' && has('greedy')) return '재물을 내놓기가 아까워 차마 못 하겠다';
  return null;
}

export const LAND_PRICE = 25;
export const LOAN_SIZE = 20;

export const MONTHLY: MonthlyAction[] = [
  {
    id: 'work',
    name: '업무 집중',
    cost: 2,
    desc: '맡은 일에 온 힘을 쏟는다. 성심 +2 (70까지)와 정치 경험 +3. 이번 달 왕의 눈에 띄어 독대·직무 사건이 잦아진다. 관찰사는 도의 민심과 조련이, 병조판서는 남쪽 방비가, 호조판서는 국고가 오른다. 석 달 넘게 손을 놓으면 성심이 조금씩 식는다.',
    check: (s) => (P(s).status === 'active' && P(s).office ? (isAbroad(s) ? '사행 중이다' : null) : '관직에 있어야 한다'),
    run(s) {
      const p = P(s);
      const pl = s.player;
      s.flags.workAt = s.t;
      const gain = p.traits.includes('ambitious') ? 2.5 : 2;
      if (p.favor < 70) p.favor = Math.min(70, p.favor + gain);
      pl.exp.politics += 3;
      pres(p, 0.3);
      const extra: string[] = [];
      if (p.office?.startsWith('gamsa_')) {
        const r = s.regions[p.location];
        r.minsim = clamp(r.minsim + 1.5, 0, 100);
        r.defense.drill = clamp(r.defense.drill + 2, 0, 100);
        extra.push('도의 민심 +1.5, 조련 +2');
      } else if (p.office === 'suryeong') {
        const r = s.regions[p.location];
        r.minsim = clamp(r.minsim + 0.7, 0, 100);
        extra.push('고을 민심 +0.7');
      } else if (p.office === 'byeongjo') {
        addPrep(s, 1.5);
        extra.push('남쪽 방비 +1.5');
      } else if (p.office === 'hojo') {
        s.realm.treasury += 6;
        extra.push('국고 +6');
      } else if (p.office === 'gongjo' && s.realm.projects.length) {
        const x = s.realm.projects.find((y) => y.left > 1);
        if (x && chance(s, 0.4)) {
          x.left--;
          extra.push('공역이 한 달 앞당겨짐');
        }
      }
      return `맡은 일에 힘을 쏟았다. (성심 +${gain}, 정치 경험 +3${extra.length ? `, ${extra.join(', ')}` : ''})`;
    },
  },
  {
    id: 'study',
    name: '학문 수양',
    cost: 1,
    desc: '경전을 읽고 글을 다듬는다. 학식 경험 +2 (학자 +3), 명망 조금. 오래 손을 놓으면 학식이 녹슨다.',
    check: () => null,
    run(s) {
      const p = P(s);
      const v = p.traits.includes('scholar') ? 3 : 2;
      s.player.exp.learning += v;
      s.flags.studyAt = s.t;
      s.player.examPrep = Math.min(12, (s.player.examPrep ?? 0) + 1);
      pres(p, 0.15);
      return `책을 펴고 학문을 닦았다. (학식 경험 +${v})`;
    },
  },
  {
    id: 'teach',
    name: '강학',
    cost: 1,
    desc: '고향에서 후학을 기른다. 여섯 번 쌓이면 문인이 생기고 그 지역의 당세가 오른다 (학자·서원이면 빨라진다). 문인은 식년시에 응시한다.',
    check: (s) => {
      const p = P(s);
      return p.status === 'retired' || (p.status === 'idle' && p.home === p.location) ? null : '낙향해 있어야 한다';
    },
    run(s) {
      const p = P(s);
      const pl = s.player;
      pl.teach += (p.traits.includes('scholar') ? 2 : 1) + (pl.built.includes('seowon') ? 1 : 0);
      pl.exp.learning += 1;
      s.flags.studyAt = s.t;
      s.flags.teachAt = s.t;
      if (pl.teach < 6) return `후학들에게 경전을 강론했다. (강학 ${pl.teach}/6)`;
      pl.teach = 0;
      pl.disciples++;
      pres(p, 2);
      if (p.faction !== 'none') {
        const r = s.regions[p.location];
        r.influence[p.faction] = (r.influence[p.faction] ?? 0) + 2;
      }
      log(s, `${p.name}의 문하에 새 제자가 들어왔다. (문인 ${pl.disciples}명)`, 'player');
      return `새 제자가 문하에 들어왔다. (문인 ${pl.disciples}명, 명망 +2)`;
    },
  },
  {
    id: 'rest',
    name: '요양',
    cost: 1,
    desc: '몸을 돌본다. 병중이면 40% 확률로 낫는다.',
    check: (s) => (s.player.sick ? null : '병중이 아니다'),
    run(s) {
      if (chance(s, 0.4)) {
        s.player.sick = false;
        return '몸을 돌보았다. 병이 나았다.';
      }
      return '몸을 돌보았지만 아직 낫지 않았다.';
    },
  },
  {
    id: 'seowon',
    name: '서원 건립',
    cost: 1,
    desc: `고향에 서원을 세운다. 한 번에 재산 ${PROJECTS.seowon.cost}, ${PROJECTS.seowon.months}번 쌓아야 완성된다. 완성하면 명망 +8, 고향의 당세 +5, 문인 +1, 강학이 빨라진다.`,
    check(s) {
      const p = P(s);
      if (s.player.built.includes('seowon')) return '이미 서원을 세웠다';
      return p.wealth < PROJECTS.seowon.cost ? `재산 ${PROJECTS.seowon.cost}이 든다` : null;
    },
    run: (s) => buildStep(s, 'seowon'),
  },
  {
    id: 'munjip',
    name: '문집 편찬',
    cost: 1,
    desc: `평생의 글을 모아 문집을 펴낸다. 학식 4 이상. 한 번에 재산 ${PROJECTS.munjip.cost}, ${PROJECTS.munjip.months}번 쌓아야 한다. 완성하면 명망 +6, 학식 경험 +15.`,
    check(s) {
      const p = P(s);
      if (s.player.built.includes('munjip')) return '이미 문집을 펴냈다';
      if (p.learning < 4) return '학식 4 이상이어야 한다';
      return p.wealth < PROJECTS.munjip.cost ? `재산 ${PROJECTS.munjip.cost}이 든다` : null;
    },
    run: (s) => buildStep(s, 'munjip'),
  },
  {
    id: 'buy_land',
    name: '전장 매입',
    estate: true,
    cost: 1,
    desc: `재산 ${LAND_PRICE}으로 고향에 땅 1결을 사서 소작을 준다. 해마다 가을에 결마다 소작료 4쯤이 들어온다 (작황을 탄다).`,
    check: (s) => (P(s).wealth < LAND_PRICE ? `재산 ${LAND_PRICE}이 있어야 한다` : s.player.land >= 12 ? '땅이 이미 넉넉하다' : null),
    run(s) {
      const p = P(s);
      p.wealth -= LAND_PRICE;
      s.player.land++;
      return `${REGION_META[p.home].short}에 땅을 사들여 소작을 주었다. (전장 ${s.player.land}결)`;
    },
  },
  {
    id: 'sell_land',
    name: '전장 처분',
    estate: true,
    cost: 1,
    desc: '급히 돈이 필요할 때 땅 1결을 판다. 재산 +18. 은결부터 판다.',
    check: (s) => (s.player.land > 0 ? null : '팔 땅이 없다'),
    run(s) {
      const pl = s.player;
      P(s).wealth += 18;
      pl.land--;
      if (pl.hiddenLand > 0) pl.hiddenLand--;
      return `땅 1결을 팔았다. (재산 +18, 전장 ${pl.land}결)`;
    },
  },
  {
    id: 'usury',
    name: '장리(長利) 놓기',
    estate: true,
    cost: 1,
    desc: `재산 ${LOAN_SIZE}을 고향 백성에게 꾸어 준다. 반년 뒤 절반의 이자를 붙여 돌려받지만, 흉년이면 떼이기 쉽고 고향 민심이 깎인다. 고리대라는 흠결이 남을 수 있다.`,
    check: (s) => {
      const p = P(s);
      return (
        traitForbids(p, 'greed') ??
        (p.wealth < LOAN_SIZE ? `재산 ${LOAN_SIZE}이 있어야 한다` : null) ??
        (s.player.loans.length >= 3 ? '이미 놓은 장리가 많다' : null)
      );
    },
    run(s) {
      const p = P(s);
      p.wealth -= LOAN_SIZE;
      s.player.loans.push({ amount: LOAN_SIZE, due: s.t + 6 });
      const r = s.regions[p.home];
      r.minsim = clamp(r.minsim - 1, 0, 100);
      let extra = '';
      if (chance(s, 0.12) && !p.flaws.some((f) => f.label === '고리대')) {
        addFlaw(s, p, '고리대');
        extra = ' 고을에 원성이 돌기 시작했다.';
      }
      return `고향 백성에게 장리를 놓았다. 반년 뒤 ${Math.round(LOAN_SIZE * 1.5)}을 돌려받을 셈이다.${extra}`;
    },
  },
  {
    id: 'hide_land',
    name: '은결 만들기',
    estate: true,
    cost: 1,
    desc: '아전과 짜고 전장 1결을 양안(量案)에서 뺀다. 세를 내지 않으니 가을 소출이 더 남지만, 그만큼 나라의 세가 줄고 양전을 하면 드러난다.',
    check: (s) => {
      const p = P(s);
      return traitForbids(p, 'greed') ?? (p.home === 'hanseong' ? '도성에는 숨길 땅이 없다' : null) ?? (s.player.hiddenLand >= s.player.land ? '장부에서 뺄 땅이 없다 (전장을 먼저 사라)' : null);
    },
    run(s) {
      const p = P(s);
      s.player.hiddenLand++;
      const r = s.regions[p.home];
      r.hidden = clamp(r.hidden + 0.01, 0, 0.5);
      let extra = '';
      if (chance(s, 0.2) && !p.flaws.some((f) => f.label === '은결 은닉')) {
        addFlaw(s, p, '은결 은닉');
        extra = ' 아전 하나가 이 일을 알고 있다.';
      }
      return `전장 1결을 장부에서 뺐다. (은결 ${s.player.hiddenLand}결)${extra}`;
    },
  },
];

export function monthlyError(s: GameState, a: MonthlyAction): string | null {
  const p = P(s);
  if (s.player.done.includes(a.id)) return '이번 달에 이미 했다';
  if (p.status === 'exiled' && !['study', 'rest', 'munjip'].includes(a.id)) return '유배 중이다';
  const err = a.check(s);
  if (err) return err;
  if (a.cost > s.player.ap) return `행동력이 부족하다 (필요 ${a.cost}, 남은 ${s.player.ap})`;
  return null;
}

export function runMonthly(s: GameState, id: MonthlyId): string {
  const a = MONTHLY.find((x) => x.id === id)!;
  const err = monthlyError(s, a);
  if (err) return err;
  s.player.ap -= a.cost;
  s.player.done.push(a.id);
  const msg = a.run(s);
  levelUp(s);
  return msg;
}

function buildStep(s: GameState, kind: ProjectKind): string {
  const p = P(s);
  const pl = s.player;
  const spec = PROJECTS[kind];
  p.wealth -= spec.cost;
  const prog = (pl.projects[kind] ?? 0) + 1;
  pl.projects[kind] = prog;
  if (kind === 'munjip') pl.exp.learning += 1;
  if (prog >= spec.months) {
    completeProject(s, kind);
    return kind === 'seowon' ? '서원이 완성되었다!' : '문집이 간행되었다!';
  }
  return `${kind === 'seowon' ? '서원 공사' : '문집 편찬'}가 진척되었다. (${prog}/${spec.months})`;
}

/* ───────── 상소 ───────── */

export const MEMORIAL_INFO: Record<'law' | 'jojae', { name: string; desc: string }> = {
  law: { name: '변법(變法) 상소', desc: '법을 새로 세우거나 있는 법을 없애자고 청한다. 왕의 마음과 조정 세력이 그 법을 어떻게 보느냐에 따라 어려움이 다르다. 2개월 동안 짓고 연명을 모은다.' },
  jojae: { name: '조제 상소', desc: '붕당의 화합을 청한다. 받아들여지면 긴장도가 크게 내리지만 당내에서 미온적이라는 말을 듣는다. 2개월.' },
};

export function memorialError(s: GameState): string | null {
  const p = P(s);
  if (p.status === 'exiled') return '유배 중이다';
  if (s.player.focus?.kind === 'memorial') return '이미 상소를 짓고 있다';
  return null;
}

export function startMemorial(s: GameState, topic: MemorialTopic, opt: { lawId?: string; abolish?: boolean; targetId?: string } = {}): string {
  const err = memorialError(s) ?? (topic === 'law' && opt.lawId ? lawMemorialError(s, opt.lawId) : null);
  if (err) return err;
  s.player.focus = { kind: 'memorial', topic, progress: 0, required: 2, cosigners: [], ...opt };
  const what = topic === 'law' && opt.lawId ? `${LAW_MAP[opt.lawId]?.name ?? ''} ${opt.abolish ? '폐지' : '시행'}을 청하는 상소` : TOPIC_LABEL[topic];
  return `${josa(what, '을/를')} 짓기 시작했다. 두 달 동안 연명을 모으자.`;
}

/** 막 바뀌었거나 부결된 법은 한동안 다시 올리지 못한다 */
export function lawMemorialError(s: GameState, lawId: string): string | null {
  const n = lawCooldown(s, lawId);
  return n ? `최근에 다룬 법이라 ${n}개월 뒤에 다시 올릴 수 있다` : null;
}

export function dropMemorial(s: GameState): string {
  if (s.player.focus?.kind !== 'memorial') return '';
  s.player.focus = null;
  return '쓰던 상소를 거두었다.';
}

/** 정치력·학식 경험이 이만큼 차야 오른다. 오를수록 어렵고, 6을 넘어서면 더 가파르다. */
export const expNeed = (v: number) => 30 + v * 12 + Math.max(0, v - 5) * 25;

function levelUp(s: GameState) {
  const p = P(s);
  const ex = s.player.exp;
  if (ex.politics >= expNeed(p.politics) && p.politics < 8) {
    ex.politics = 0;
    p.politics++;
    notice(s, '성장', `경험이 쌓여 정치력이 올랐다. (정치력 ${p.politics})`);
  }
  if (ex.learning >= expNeed(p.learning) && p.learning < 8) {
    ex.learning = 0;
    p.learning++;
    notice(s, '성장', `학문이 깊어져 학식이 올랐다. (학식 ${p.learning})`);
  }
}

function resolveInvestigation(s: GameState, t: Character | undefined) {
  const p = P(s);
  s.player.scheme = null;
  if (!alive(t)) return;
  const hidden = t.flaws.filter((f) => !f.public && !f.knownBy.includes(p.id));
  const intel = s.player.intel[t.id];
  const tip = intel && intel.dirty && s.t - intel.t <= 12 ? 0.1 : 0;
  const success = chance(s, clamp(0.6 + (p.politics - t.politics) * 0.1 + (schemer(p) ? 0.15 : 0) + tip, 0.2, 0.95));
  let text: string;
  if (success && hidden.length) {
    hidden[0].knownBy.push(p.id);
    text = `${t.name}의 약점을 잡았다: 「${hidden[0].label}」. 탄핵할 때 +1이 되고, 협박에 쓸 수도 있다.`;
  } else if (success) {
    pushEvent(s, 'investigate_empty', { targetId: t.id });
    text = '';
  } else {
    text = `${t.name}의 뒤를 캤지만 쓸 만한 것을 찾지 못했다.`;
  }
  const detect = clamp(0.12 + (t.politics - p.politics) * 0.05 - (schemer(p) ? 0.08 : 0), 0.03, 0.5);
  if (chance(s, detect)) {
    const fx = sway(s, t, p.id, -25, '뒷조사 발각', { clan: 0.3, decay: 0.15 });
    text += `${text ? '\n\n' : ''}그런데 ${josa(t.name, '이/가')} 낌새를 챘다. (${fx.join(', ')})`;
  }
  if (text) notice(s, '뒷조사', text);
}

function resolveMemorialFocus(s: GameState) {
  const p = P(s);
  const f = s.player.focus!;
  s.player.focus = null;
  const r = memorial(s, p, f.topic ?? 'sipye', f.cosigners, f.targetId, { lawId: f.lawId, abolish: f.abolish });
  pushEvent(s, 'memorial_report', { result: r, topic: f.topic });
}

function completeProject(s: GameState, kind: ProjectKind) {
  const p = P(s);
  const pl = s.player;
  pl.built.push(kind);
  if (kind === 'seowon') {
    const name = `${p.ho ?? REGION_META[p.home].short} 서원`;
    p.prestige = clamp(p.prestige + 8, 0, 100);
    pl.disciples++;
    if (p.faction !== 'none') {
      const r = s.regions[p.home];
      r.influence[p.faction] = (r.influence[p.faction] ?? 0) + 5;
    }
    pl.deeds.push(`${shortDate(s.t)} ${name} 건립`);
    log(s, `${p.name}의 뜻을 따르는 선비들이 ${REGION_META[p.home].short}에 ${josa(name, '을/를')} 세웠다.`, 'player');
    notice(s, '서원 낙성', `${josa(name, '이/가')} 문을 열었다. 고을의 선비들이 모여든다.\n\n명망 +8, 문인 +1, 고향의 당세 +5. 앞으로 강학이 빨라진다.`, 'personal');
  } else {
    p.prestige = clamp(p.prestige + 6 + (p.traits.includes('writer') ? 3 : 0), 0, 100);
    pl.exp.learning += 15;
    pl.deeds.push(`${shortDate(s.t)} 문집 간행`);
    log(s, `${p.name}의 문집이 간행되었다.`, 'player');
    notice(s, '문집 간행', `평생의 글을 모은 문집이 판각되어 세상에 나왔다. 사림이 돌려 읽는다.\n\n명망 +${6 + (p.traits.includes('writer') ? 3 : 0)}, 학식 경험 +15`, 'personal');
  }
}

export function tickScheme(s: GameState) {
  const sc = s.player.scheme;
  if (!sc) return;
  if (P(s).status === 'exiled') {
    s.player.scheme = null;
    return;
  }
  sc.progress++;
  if (sc.progress >= sc.required) resolveInvestigation(s, s.chars[sc.targetId]);
}

/** 달이 바뀔 때: 상소의 진척, 장리의 회수, 직무를 놓은 대가 */
export function tickFocus(s: GameState) {
  const p = P(s);
  const pl = s.player;
  const f = pl.focus;
  if (f && f.kind !== 'memorial') pl.focus = null;
  if (f?.kind === 'memorial') {
    if (p.status === 'exiled') pl.focus = null;
    else {
      f.progress++;
      if (f.progress >= f.required) resolveMemorialFocus(s);
    }
  }
  // 관직에 있으면서 석 달 넘게 업무를 돌보지 않으면 성심이 식는다
  if (p.status === 'active' && p.office && !isAbroad(s)) {
    pl.exp.politics += 0.5;
    if (monthsSince(s, 'workAt') > 3 && p.favor > 0) p.favor = Math.max(0, p.favor - 0.4);
  }
  // 장리 회수
  const back: string[] = [];
  for (const l of [...pl.loans]) {
    if (l.due > s.t) continue;
    pl.loans = pl.loans.filter((x) => x !== l);
    const h = s.regions[p.home].harvest ?? 0;
    if (chance(s, h < 0 ? 0.4 : 0.12)) back.push(`떼임 (원금 ${l.amount})`);
    else {
      const v = Math.round(l.amount * 1.5);
      p.wealth += v;
      back.push(`+${v}`);
      const r = s.regions[p.home];
      r.minsim = clamp(r.minsim - 1, 0, 100);
    }
  }
  if (back.length) log(s, `놓았던 장리를 거두었다: ${back.join(', ')}.`, 'player');
  levelUp(s);
}

export type SelfActionId = 'hire' | 'resign' | 'capital' | 'doctor' | 'humble' | 'distance' | 'retain' | 'dismiss' | 'donate' | 'tongmun';

export const RETAINER_UPKEEP = 3;
export const MAX_RETAINERS = 3;

export const SELF_ACTIONS: { id: SelfActionId; name: string; desc: string; check(s: GameState): string | null; run(s: GameState): string }[] = [
  {
    id: 'hire',
    name: '겸인 부리기',
    desc: `재산 ${HIRE_COST}으로 겸인(傔人)을 부려 이번 달 행동력 +1. 한 달에 한 번.`,
    check: (s) =>
      P(s).status === 'exiled'
        ? '유배 중이다'
        : s.player.hired
          ? '이번 달에 이미 겸인을 부렸다'
          : P(s).wealth < HIRE_COST
            ? `재산이 ${HIRE_COST} 이상 있어야 한다`
            : null,
    run(s) {
      P(s).wealth -= HIRE_COST;
      s.player.ap += 1;
      s.player.hired = true;
      return `겸인에게 재물을 주어 심부름을 맡겼다. (행동력 +1, 재산 -${HIRE_COST})`;
    },
  },
  {
    id: 'resign',
    name: '사직하고 낙향',
    desc: '관직을 내려놓고 고향으로 돌아간다. 명분을 얻고 강학할 수 있다.',
    check: (s) => (P(s).status === 'active' && P(s).office ? null : '관직에 있지 않다'),
    run(s) {
      const p = P(s);
      const cs = caseOn(s, p.id);
      if (cs) {
        withdraw(s, cs);
        return '논핵을 받는 몸으로 사직소를 올렸다. 공방은 거두어졌지만 탄핵을 시인한 셈이라 반년 동안 서용되지 않는다. (성심 -3)';
      }
      vacate(s, p, 'retired');
      p.prestige = clamp(p.prestige + 2, 0, 100);
      p.favor = clamp(p.favor - 3, -100, 100);
      s.player.deeds.push(`${shortDate(s.t)} 사직하고 낙향`);
      log(s, `${josa(p.name, '이/가')} 사직하고 고향으로 내려갔다.`, 'player');
      return '사직소를 올리고 고향으로 내려왔다.';
    },
  },
  {
    id: 'capital',
    name: '상경',
    desc: '한성으로 올라가 보직을 기다린다. (재산 5) 삭탈관작이나 사직 처분이 남아 있으면 그 기간이 지나야 임용된다. 시묘 중에는 올라갈 수 없다.',
    check(s) {
      if (P(s).status !== 'retired') return '낙향 중일 때만 할 수 있다';
      const m = mourningLeft(s);
      return m > 0 ? `시묘 중이다 (${m}개월 남음)` : null;
    },
    run(s) {
      const p = P(s);
      p.status = 'idle';
      p.location = seat(s);
      p.wealth = Math.max(0, p.wealth - 5);
      const ban = (p.banUntil ?? 0) - s.t;
      return ban > 0 ? `한성으로 올라왔다. 다만 서용되지 못하는 처분이 ${ban}개월 더 남아 있다.` : '한성으로 올라왔다. 이제 관직에 임용될 수 있다.';
    },
  },
  {
    id: 'doctor',
    name: '명의 초빙',
    desc: '재산 40으로 명의를 불러 몸을 돌본다. 병이 낫고 다음 천명 판정 +1 (최대 +2).',
    check: (s) => (P(s).wealth < 40 ? '재산이 40 이상 있어야 한다' : s.player.doctor >= 2 ? '이미 충분히 보양했다' : null),
    run(s) {
      const p = P(s);
      p.wealth -= 40;
      s.player.doctor++;
      s.player.sick = false;
      return '내의원의 명의를 불러 몸을 보살폈다.';
    },
  },
  {
    id: 'humble',
    name: '근신(謹愼)',
    desc: '문을 닫아걸고 몸을 낮춘다. 이번 달 남은 행동력을 모두 쓰는 대신, 나를 노리는 것으로 알려진 음모의 공격이 크게 약해지고(-3), 이미 열린 논핵에서는 방어 +1.',
    check(s) {
      const p = P(s);
      if (p.status !== 'active' && p.status !== 'idle') return '조정에 있을 때만 할 수 있다';
      if (s.player.lowProfile) return '이번 달에 이미 근신하고 있다';
      if (s.player.ap < 1) return '행동력이 남아 있어야 한다';
      if (!s.plots.some((x) => x.known && !x.softened) && !caseOn(s, p.id)) return '나를 노리는 것으로 알려진 음모나 논핵이 없다';
      return null;
    },
    run(s) {
      const p = P(s);
      s.player.ap = 0;
      s.player.lowProfile = true;
      const n = humbleEffects(s);
      const cs = caseOn(s, p.id);
      let extra = '';
      if (cs && !s.flags[`humble_${cs.id}`]) {
        s.flags[`humble_${cs.id}`] = true;
        cs.bonus -= 1;
        extra = ' 논핵의 기세가 한풀 꺾였다.';
      }
      return `문을 닫아걸고 근신했다.${n ? ` 당신을 노리던 ${n}건의 음모가 힘을 잃었다.` : ''}${extra}`;
    },
  },
  {
    id: 'distance',
    name: '당론과 거리 두기',
    desc: '당의 강경론에 휩쓸리지 않겠다는 뜻을 밝힌다. 1년 동안 환국이 일어나도 화를 입을 확률이 크게 준다(-30%p). 같은 당 호감 -8.',
    check(s) {
      const p = P(s);
      if (p.faction === 'none') return '당색이 없다';
      if (!inCourt(p)) return '조정에 있을 때만 할 수 있다';
      return cdMsg(s, 'distance');
    },
    run(s) {
      const p = P(s);
      s.flags.distanced = s.t;
      setCd(s, 'distance', 12);
      s.tension = clamp(s.tension - 1, 0, 100);
      const fx = swayFaction(s, p.faction, p.id, -8, '당론을 멀리함', 0.06);
      return `당론과 거리를 두겠다고 밝혔다. 1년 동안 환국의 화를 덜 입는다.${fx ? ` (${fx})` : ''}`;
    },
  },
  {
    id: 'retain',
    name: '식객 들이기',
    desc: `재산 15로 식객을 들인다 (최대 ${MAX_RETAINERS}명, 매달 1명당 재산 ${RETAINER_UPKEEP}). 식객이 많을수록 나를 노리는 음모를 일찍 알아채고, 이간이 잘 되며, 밀서가 덜 새어 나간다. 2명 이상이면 매달 행동력 +1.`,
    check(s) {
      const p = P(s);
      if (p.status === 'exiled') return '유배 중이다';
      if (s.player.retainers >= MAX_RETAINERS) return `식객은 ${MAX_RETAINERS}명까지다`;
      if (p.wealth < 15) return '재산이 15 이상 있어야 한다';
      return null;
    },
    run(s) {
      P(s).wealth -= 15;
      s.player.retainers++;
      return `식객을 들였다. (식객 ${s.player.retainers}명, 매달 재산 -${s.player.retainers * RETAINER_UPKEEP})`;
    },
  },
  {
    id: 'dismiss',
    name: '식객 내보내기',
    desc: '식객 한 명을 내보내 살림을 줄인다.',
    check: (s) => (s.player.retainers > 0 ? null : '식객이 없다'),
    run(s) {
      s.player.retainers--;
      return `식객 하나를 내보냈다. (식객 ${s.player.retainers}명)`;
    },
  },
  {
    id: 'donate',
    name: '진휼에 재물을 내놓다',
    desc: '재산 30을 내어 굶주린 백성을 구한다. 고향(전란 중이면 전장) 민심 +8, 명망 +3. 전란 중이면 성심 +4, 남쪽 방비 +3.',
    check(s) {
      if (P(s).wealth < 30) return '재산이 30 이상 있어야 한다';
      return cdMsg(s, 'donate');
    },
    run(s) {
      const p = P(s);
      p.wealth -= 30;
      setCd(s, 'donate', 6);
      const war = s.war.active && s.war.zones.length;
      const r = war ? s.war.zones[0] : p.home;
      s.regions[r].minsim = clamp(s.regions[r].minsim + 8, 0, 100);
      p.prestige = clamp(p.prestige + 3, 0, 100);
      if (war) {
        p.favor = clamp(p.favor + 4, -100, 100);
        addPrep(s, 3);
      }
      return `${REGION_META[r].short}의 굶주린 백성에게 곡식을 풀었다. (민심 +8, 명망 +3${war ? ', 성심 +4, 남쪽 방비 +3' : ''})`;
    },
  },
];

SELF_ACTIONS.push({
  id: 'tongmun',
  name: '통문 돌리기',
  desc: '얽혀 있는 공방에서 서원과 향교에 통문을 돌려 사림의 공론을 모은다. 행동력 1. 내 편 +1. 서원이 있거나 문인이 셋 이상이거나 명망 60 이상이어야 한다. 공방마다 한 번.',
  check: (s) => tongmunError(s),
  run: (s) => tongmun(s),
});

export function runSelfAction(s: GameState, id: SelfActionId): string {
  const a = SELF_ACTIONS.find((x) => x.id === id)!;
  const err = a.check(s);
  if (err) return err;
  return a.run(s);
}
