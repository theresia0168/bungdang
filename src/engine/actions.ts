import type { Character, FocusKind, GameState, MemorialTopic, ProjectKind } from './types';
import { OFFICE_MAP } from './data/offices';
import { REGION_META } from './data/meta';
import { chance, randInt } from './rng';
import { addFlaw, alive, clamp, collect, inCourt, josa, log, notice, owe, P, pushEvent } from './state';
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
  | 'bribe';

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

export const isAbroad = (s: GameState) => s.player.abroadUntil > s.t;
/** 시묘가 끝나기까지 남은 달 */
export const mourningLeft = (s: GameState) => Math.max(0, Number(s.flags.mournUntil ?? 0) - s.t);

export function apParts(s: GameState): { label: string; value: number }[] {
  const p = P(s);
  if (p.status === 'exiled') return [{ label: '유배 중 (서신만)', value: 1 }];
  if (isAbroad(s)) return [{ label: '연행 중 (서신만)', value: 1 }];
  const parts = [{ label: '기본', value: 2 }];
  if (p.politics >= 5) parts.push({ label: '정치력 5 이상', value: 1 });
  if (p.politics >= 7) parts.push({ label: '정치력 7 이상', value: 1 });
  if (s.player.disciples >= 4) parts.push({ label: '문인 4명 이상', value: 1 });
  if (s.player.focus?.kind === 'social') parts.push({ label: '교유에 힘씀', value: 1 });
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
  s.player.socialBonus = s.player.focus?.kind === 'social';
}

/** 멀리 있어도 할 수 있는 행동 */
const BY_LETTER: TargetActionId[] = ['letter', 'plead', 'secret'];

/** 행동 고유의 조건과 행동력·직권을 모두 따진다. 할 수 있으면 null. */
export function actionError(s: GameState, a: TargetAction, t: Character): string | null {
  const err = a.check(s, t);
  if (err) return err;
  if (P(s).status === 'exiled' && !BY_LETTER.includes(a.id)) return '유배 중에는 서신만 보낼 수 있다';
  if (isAbroad(s) && !BY_LETTER.includes(a.id)) return '연행 중에는 서신만 보낼 수 있다';
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
    desc: `재산 ${INVESTIGATE_COST}을 들여 겸인에게 몇 달 동안 그의 뒤를 캐게 한다. 이번 달의 일과 따로 진행된다. 한 번에 한 사람만.`,
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
        (heldFlaws(s, t).some((f) => !f.fake) ? null : '쥐고 있는 그의 약점이 없다 (탐문·뒷조사로 찾는다)') ??
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
      if (!inCourt(p) || p.location !== 'hanseong') return '한성에 있어야 한다';
      if (!isSamsa(p) && p.politics < 3) return '삼사 언관이 아니면 정치력 3 이상이 필요하다';
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
      return focusCheck(s, 'memorial');
    },
    run(s, t) {
      const was = s.player.focus;
      s.player.focus = { kind: 'memorial', topic: 'recall', targetId: t.id, progress: 0, required: 2, cosigners: [] };
      const stop = was ? ` (하던 「${FOCUS_INFO[was.kind].name}」은 멈췄다${was.kind === 'seowon' || was.kind === 'munjip' ? '. 진척은 남는다' : ''})` : '';
      return `${t.name}의 신원을 청하는 상소를 짓기 시작했다.${stop}`;
    },
  },
  {
    id: 'pact',
    name: '맹약 제안',
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
];

export function runTargetAction(s: GameState, id: TargetActionId, targetId: string): string {
  const a = TARGET_ACTIONS.find((x) => x.id === id)!;
  const t = s.chars[targetId];
  const err = actionError(s, a, t);
  if (err) return err;
  const cost = a.cost(s);
  if (cost === 'authority') s.player.authorityUsed = true;
  else s.player.ap -= cost;
  return a.run(s, t);
}

export const PROJECTS: Record<ProjectKind, { months: number; cost: number }> = {
  seowon: { months: 8, cost: 10 },
  munjip: { months: 10, cost: 3 },
};

export const FOCUS_INFO: Record<FocusKind, { name: string; desc: string }> = {
  duty: {
    name: '직무에 매진',
    desc: '관직에 있으면 직무는 저절로 돌아간다(성심 +0.25, 정치 경험 +1). 매진하면 성심 +0.75(60까지)와 정치 경험 +3. 관찰사는 민심이, 병조판서는 국방 대비가 오른다.',
  },
  study: { name: '학문 수양', desc: '학식 경험 +3과 약간의 명망을 얻는다.' },
  social: { name: '교유에 힘씀', desc: '사람을 만나고 편지를 쓰는 데 힘을 쏟는다. 이 일을 하는 동안 행동력 +1.' },
  teach: { name: '강학', desc: '낙향 중에 후학을 기른다. 문인이 생기고 그 지역의 당세가 오른다. 문인은 식년시에 응시한다.' },
  estate: { name: '가산 경영', desc: '재산을 불린다. 은결이 생겨 흠결이 될 수 있다.' },
  rest: { name: '요양', desc: '병을 다스린다.' },
  seowon: {
    name: '서원 건립',
    desc: `고향에 서원을 세운다. 매달 재산 ${PROJECTS.seowon.cost}, ${PROJECTS.seowon.months}개월. 완성하면 명망 +8, 고향의 당세 +5, 문인 +1, 강학이 빨라진다. 중단해도 진척은 남는다.`,
  },
  munjip: {
    name: '문집 편찬',
    desc: `평생의 글을 모아 문집을 펴낸다. 학식 4 이상. 매달 재산 ${PROJECTS.munjip.cost}, ${PROJECTS.munjip.months}개월. 완성하면 명망 +6, 학식 경험 +15. 중단해도 진척은 남는다.`,
  },
  memorial: { name: '상소 준비', desc: '상소를 짓고 연명을 모은다.' },
};

export function focusCheck(s: GameState, kind: FocusKind): string | null {
  const p = P(s);
  switch (kind) {
    case 'duty':
      return p.status === 'active' && p.office ? null : '관직에 있어야 한다';
    case 'teach':
      return p.status === 'retired' || (p.status === 'idle' && p.home === p.location) ? null : '낙향해 있어야 한다';
    case 'social':
    case 'estate':
    case 'memorial':
      return p.status === 'exiled' ? '유배 중이다' : null;
    case 'seowon':
      if (s.player.built.includes('seowon')) return '이미 서원을 세웠다';
      if (p.status === 'exiled') return '유배 중이다';
      return p.wealth < PROJECTS.seowon.cost ? `매달 재산 ${PROJECTS.seowon.cost}이 든다` : null;
    case 'munjip':
      if (s.player.built.includes('munjip')) return '이미 문집을 펴냈다';
      if (p.learning < 4) return '학식 4 이상이어야 한다';
      return p.wealth < PROJECTS.munjip.cost ? `매달 재산 ${PROJECTS.munjip.cost}이 든다` : null;
    default:
      return null;
  }
}

export function setFocus(s: GameState, kind: FocusKind, topic?: MemorialTopic): string {
  const err = focusCheck(s, kind);
  if (err) return err;
  const was = s.player.focus?.kind;
  if (was === kind && kind !== 'memorial') return `이미 ${FOCUS_INFO[kind].name}에 힘쓰고 있다.`;
  if (kind === 'memorial') {
    s.player.focus = { kind, topic, progress: 0, required: 2, cosigners: [] };
    return `${josa(TOPIC_LABEL[topic ?? 'sipye'], '을/를')} 짓기 시작했다. 그동안 연명을 모으자.`;
  }
  s.player.focus = { kind, progress: 0, required: 0, cosigners: [] };
  // 교유의 행동력 +1은 한 달에 한 번만 받는다. 껐다 켜서 다시 받을 수 없다.
  if (kind === 'social' && !s.player.socialBonus) {
    s.player.ap += 1;
    s.player.socialBonus = true;
  }
  return `${FOCUS_INFO[kind].name}에 힘쓰기로 했다.`;
}

function levelUp(s: GameState) {
  const p = P(s);
  const ex = s.player.exp;
  if (ex.politics >= 20 + p.politics * 6 && p.politics < 8) {
    ex.politics = 0;
    p.politics++;
    notice(s, '성장', `경험이 쌓여 정치력이 올랐다. (정치력 ${p.politics})`);
  }
  if (ex.learning >= 20 + p.learning * 6 && p.learning < 8) {
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
  const r = memorial(s, p, f.topic ?? 'sipye', f.cosigners, f.targetId);
  pushEvent(s, 'memorial_report', { result: r, topic: f.topic });
}

function completeProject(s: GameState, kind: ProjectKind) {
  const p = P(s);
  const pl = s.player;
  pl.built.push(kind);
  pl.focus = null;
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

/** 관직에 있으면 직무는 저절로 돌아간다 */
function baseDuty(s: GameState, keen: boolean) {
  const p = P(s);
  const pl = s.player;
  if (keen) {
    if (p.favor < 60) p.favor = Math.min(60, p.favor + 0.75);
    pl.exp.politics += p.traits.includes('ambitious') ? 4 : 3;
    p.prestige = clamp(p.prestige + 0.1, 0, 100);
  } else {
    if (p.favor < 40) p.favor = Math.min(40, p.favor + 0.25);
    pl.exp.politics += 1;
  }
  const k = keen ? 1 : 0.4;
  if (p.office?.startsWith('gamsa_')) s.regions[p.location].minsim = clamp(s.regions[p.location].minsim + 0.5 * k, 0, 100);
  if (p.office === 'byeongjo') s.war.preparedness = clamp(s.war.preparedness + 0.6 * k, 0, 100);
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

export function tickFocus(s: GameState) {
  const p = P(s);
  const pl = s.player;
  let f = pl.focus;
  if (f && p.status === 'exiled' && !['study', 'rest', 'munjip'].includes(f.kind)) {
    pl.focus = null;
    f = null;
  }
  if (f && (f.kind === 'duty' || f.kind === 'teach') && focusCheck(s, f.kind)) {
    pl.focus = null;
    f = null;
  }
  if (p.status === 'active' && p.office && !isAbroad(s)) baseDuty(s, f?.kind === 'duty');
  if (!f) {
    levelUp(s);
    return;
  }
  switch (f.kind) {
    case 'study':
      pl.exp.learning += p.traits.includes('scholar') ? 4 : 3;
      p.prestige = clamp(p.prestige + 0.15, 0, 100);
      break;
    case 'social':
      pl.exp.politics += 1;
      break;
    case 'teach': {
      f.progress += (p.traits.includes('scholar') ? 2 : 1) + (pl.built.includes('seowon') ? 1 : 0);
      pl.exp.learning += 1;
      if (f.progress >= 6) {
        f.progress = 0;
        pl.disciples++;
        p.prestige = clamp(p.prestige + 2, 0, 100);
        if (p.faction !== 'none') {
          const r = s.regions[p.location];
          r.influence[p.faction] = (r.influence[p.faction] ?? 0) + 2;
        }
        log(s, `${p.name}의 문하에 새 제자가 들어왔다. (문인 ${pl.disciples}명)`, 'player');
      }
      break;
    }
    case 'estate': {
      p.wealth += 4 + (p.traits.includes('greedy') ? 3 : 0) - (p.traits.includes('clean') ? 2 : 0);
      const fp = p.traits.includes('clean') ? 0.02 : p.traits.includes('greedy') ? 0.1 : 0.06;
      if (chance(s, fp)) addFlaw(s, p, '은결(隱結) 은닉');
      const r = s.regions[p.home];
      r.minsim = clamp(r.minsim - 0.3, 0, 100);
      break;
    }
    case 'rest':
      if (pl.sick && chance(s, 0.35)) {
        pl.sick = false;
        notice(s, '쾌차', '병이 나았다.');
      }
      break;
    case 'seowon':
    case 'munjip': {
      const spec = PROJECTS[f.kind];
      if (p.wealth < spec.cost) {
        notice(s, FOCUS_INFO[f.kind].name, `재물이 모자라 일을 멈추었다. 진척은 그대로 남아 있다. (${pl.projects[f.kind] ?? 0}/${spec.months}개월)`);
        pl.focus = null;
        break;
      }
      p.wealth -= spec.cost;
      const prog = (pl.projects[f.kind] ?? 0) + 1;
      pl.projects[f.kind] = prog;
      if (f.kind === 'munjip') pl.exp.learning += 1;
      if (prog >= spec.months) completeProject(s, f.kind);
      break;
    }
    case 'memorial':
      f.progress++;
      if (f.progress >= f.required) resolveMemorialFocus(s);
      break;
  }
  levelUp(s);
}

export type SelfActionId = 'hire' | 'resign' | 'capital' | 'doctor' | 'humble' | 'distance' | 'retain' | 'dismiss' | 'donate';

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
      p.location = 'hanseong';
      p.wealth = Math.max(0, p.wealth - 5);
      if (s.player.focus?.kind === 'teach') s.player.focus = null;
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
    desc: `재산 15로 식객을 들인다 (최대 ${MAX_RETAINERS}명, 매달 1명당 재산 ${RETAINER_UPKEEP}). 식객이 많을수록 나를 노리는 음모를 일찍 알아채고, 탐문이 잘 되며, 밀서가 덜 새어 나간다. 2명 이상이면 매달 행동력 +1.`,
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
    desc: '재산 30을 내어 굶주린 백성을 구한다. 고향(전란 중이면 전장) 민심 +8, 명망 +3. 전란 중이면 성심 +4, 국방 대비 +3.',
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
        s.war.preparedness = clamp(s.war.preparedness + 3, 0, 100);
      }
      return `${REGION_META[r].short}의 굶주린 백성에게 곡식을 풀었다. (민심 +8, 명망 +3${war ? ', 성심 +4, 국방 대비 +3' : ''})`;
    },
  },
];

export function runSelfAction(s: GameState, id: SelfActionId): string {
  const a = SELF_ACTIONS.find((x) => x.id === id)!;
  const err = a.check(s);
  if (err) return err;
  return a.run(s);
}
