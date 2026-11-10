import type { Character, GameState, Situation, SituationKind } from './types';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { monthOf, tOf, yearOf } from './calendar';
import { chance, d6, pick, randInt } from './rng';
import { addFlaw, age, alive, clamp, hiddenFlaws, inCourt, isP, josa, log, notice, officeTitle, owe, P, people, pushEvent, uid } from './state';
import { sway, swayFaction, topOf } from './opinion';
import { activeFactions } from './factions';
import { vacate } from './court';
import { caseOn, joinCase, joinError, openCase } from './cases';
import { kingLean, kingMood } from './king';
import { consortOf, heirSit, startDebate } from './royal';

/* ───────── 정국 상황 ───────── */

export const SIT_META: Record<SituationKind, { name: string; effect: string }> = {
  heir: { name: '국본 논의', effect: '세자 책봉을 두고 당마다 미는 왕자가 갈린다. 긴장이 쌓이고 용안이 어두워진다. 왕실 탭에서 줄을 설 수 있다.' },
  scandal: { name: '추문', effect: '추문에 휘말린 당의 사람들은 임용 점수 -2.' },
  omen: { name: '천변과 구언', effect: '왕이 바른말을 구한다. 상소 판정 +1.' },
  illness: { name: '왕의 환후', effect: '용안이 어둡고 상소 판정 -1. 국본 논의가 일기 쉽다.' },
  inlaw: { name: '외척의 발호', effect: '외척에 줄을 댄 이들은 임용 점수 +3. 끝날 때 사림의 역풍이 불 수 있다.' },
};

export const activeSit = (s: GameState, k: SituationKind) => s.situations.find((x) => x.kind === k);

export function sitLine(s: GameState, x: Situation): string {
  const left = Math.max(0, x.until - s.t);
  const d = x.data;
  const head =
    x.kind === 'scandal'
      ? `${s.chars[d.who]?.name ?? ''}의 「${d.label}」`
      : x.kind === 'omen'
        ? `${d.sign}`
        : x.kind === 'inlaw'
          ? `${d.kin}의 전횡`
          : x.kind === 'heir'
            ? '세자 책봉을 두고 조정이 갈렸다'
            : '왕이 자리에 누웠다';
  return `${head} · 약 ${left || 1}달 남음`;
}

const begin = (s: GameState, kind: SituationKind, months: number, data: Record<string, any>) => {
  const x: Situation = { id: uid(s, 'sit'), kind, since: s.t, until: s.t + months, data };
  s.situations.push(x);
  s.flags[`sitAt_${kind}`] = s.t;
  return x;
};
const since = (s: GameState, kind: SituationKind) => s.t - (typeof s.flags[`sitAt_${kind}`] === 'number' ? (s.flags[`sitAt_${kind}`] as number) : -99);

const SCANDALS = ['첩실의 투기 소동', '과거 시권(試券) 바꿔치기 연루', '노비 송사 비리', '뇌물 장부', '상중(喪中) 연회', '처가의 고리대'];
const SIGNS = ['해가 이지러지는 일식', '서쪽 하늘에 꼬리별(혜성)', '도성을 흔든 지진', '봄부터 이어진 큰 가뭄', '한여름의 우박'];

function startScandal(s: GameState) {
  const p = P(s);
  const pool = people(s).filter((c) => c.status === 'active' && c.office && OFFICE_MAP[c.office] && c.rank <= 3 && c.faction !== 'none' && !caseOn(s, c.id));
  const meHit = !!p.office && p.status === 'active' && p.rank <= 4 && hiddenFlaws(p).length > 0 && chance(s, 0.15);
  const who = meHit ? p : pick(s, pool.filter((c) => !isP(s, c)));
  if (!who) return;
  const hidden = hiddenFlaws(who);
  let label: string;
  if (hidden.length && chance(s, 0.6)) {
    const f = hidden[randInt(s, 0, hidden.length - 1)];
    f.public = true;
    label = f.label;
  } else {
    label = pick(s, SCANDALS);
    addFlaw(s, who, label, true);
  }
  begin(s, 'scandal', randInt(s, 4, 6), { who: who.id, faction: who.faction, label });
  s.tension = clamp(s.tension + 4, 0, 100);
  kingLean(s, who.faction, -6);
  kingMood(s, -5);
  log(s, `[추문] ${officeTitle(who)} ${who.name}의 「${label}」이 도성에 파다하다. ${FACTION_META[who.faction].name}이 곤욕을 치른다.`, 'court');
  if (meHit) return pushEvent(s, 'scandal_me');
  const atk = people(s)
    .filter((c) => !isP(s, c) && c.status === 'active' && c.office && OFFICE_MAP[c.office]?.samsa && c.faction !== 'none' && topOf(c.faction) !== topOf(who.faction))
    .sort((a, b) => b.politics - a.politics)[0];
  if (atk) openCase(s, atk, who, { bonus: 2 });
  if (inCourt(p) && p.status !== 'exiled' && s.pending.length < 2) pushEvent(s, 'scandal_break');
}

function startOmen(s: GameState) {
  const sign = pick(s, SIGNS);
  begin(s, 'omen', 3, { sign });
  kingMood(s, -10);
  if (sign.includes('가뭄')) {
    const y = yearOf(s.t) + (monthOf(s.t) > 9 ? 1 : 0);
    s.flags.droughtUntil = tOf(y, 9);
  }
  const top = people(s).filter((c) => c.status === 'active' && c.office && OFFICE_MAP[c.office]?.rank === 1 && !isP(s, c));
  const quit = top.length && chance(s, 0.4) ? top.sort((a, b) => a.favor - b.favor)[0] : undefined;
  if (quit) vacate(s, quit);
  log(s, `[천변] ${sign}. 왕이 하늘의 꾸짖음이라며 반찬을 줄이고 신하들에게 바른말을 구하는 교지(求言敎)를 내렸다.${quit ? ` ${josa(quit.name, '이/가')} 재변의 책임을 지고 물러났다.` : ''}`, 'history');
  if (P(s).status !== 'exiled' && s.pending.length < 2) pushEvent(s, 'omen_call', { sign });
}

function startIllness(s: GameState) {
  begin(s, 'illness', randInt(s, 2, 5), {});
  kingMood(s, -15);
  log(s, '[환후] 왕이 병으로 자리에 누웠다. 경연이 멈추고 대신들이 대궐에서 숙직한다.', 'history');
  if (inCourt(P(s)) && s.pending.length < 2) pushEvent(s, 'king_ill');
}

function startInlaw(s: GameState) {
  const inbin = consortOf(s, 'inbin');
  const kin = inbin?.kin ?? '외척';
  const x = begin(s, 'inlaw', randInt(s, 6, 10), { kin });
  const pool = people(s).filter((c) => !isP(s, c) && c.status === 'active' && c.rank >= 3 && (c.traits.includes('schemer') || c.prestige < 30));
  const linked: string[] = [];
  for (let i = 0; i < 2 && pool.length; i++) {
    const c = pool.splice(randInt(s, 0, pool.length - 1), 1)[0];
    if (!c.tags.includes('inlawLink')) c.tags.push('inlawLink');
    linked.push(c.id);
  }
  x.data.linked = linked;
  s.tension = clamp(s.tension + 2, 0, 100);
  log(s, `[외척] 인빈의 오라비 ${josa(kin, '이/가')} 궁중을 등에 업고 벼슬길에 입김을 넣는다. 그의 집 앞에 청탁하는 이들의 발길이 끊이지 않는다.`, 'court');
  if (inCourt(P(s)) && s.pending.length < 2) pushEvent(s, 'inlaw_rise', { kin });
}

function endSit(s: GameState, x: Situation) {
  s.situations = s.situations.filter((y) => y !== x);
  if (x.kind === 'scandal') log(s, `[추문] ${s.chars[x.data.who]?.name ?? ''}의 추문이 잦아들었다.`, 'court');
  if (x.kind === 'omen') log(s, '[천변] 재변이 그치자 왕이 다시 수라상을 받았다.', 'court');
  if (x.kind === 'illness') {
    kingMood(s, 10);
    log(s, '[환후] 왕이 병석에서 일어났다.', 'court');
  }
  if (x.kind === 'inlaw') {
    const linked = people(s).filter((c) => c.tags.includes('inlawLink'));
    const backlash = chance(s, 0.5);
    for (const c of linked) {
      c.tags = c.tags.filter((t) => t !== 'inlawLink');
      if (!backlash) continue;
      c.prestige = clamp(c.prestige - 5, 0, 100);
      addFlaw(s, c, '외척에 붙음', true);
    }
    log(s, backlash ? `[외척] 사림이 들고일어나 ${x.data.kin}의 전횡을 성토했다. 그에게 줄을 댄 이들이 망신을 당했다.` : `[외척] ${x.data.kin}의 기세가 한풀 꺾였다.`, 'court');
    if (isP(s, linked.find((c) => isP(s, c)))) notice(s, '외척의 몰락', backlash ? '외척에게 줄을 댔던 일이 드러났다. (명망 -5, 드러난 흠결 「외척에 붙음」)' : '외척의 기세가 꺾였다. 줄을 댔던 일은 조용히 묻혔다.', backlash ? 'danger' : 'court');
  }
}

/** 매달: 상황이 흘러가고, 새 상황이 일어난다 */
export function tickSituations(s: GameState) {
  for (const x of [...s.situations]) {
    if (x.kind === 'heir') continue;
    if (x.kind === 'scandal' && !alive(s.chars[x.data.who])) x.until = s.t;
    if (x.kind === 'illness') kingMood(s, -2);
    if (x.kind === 'inlaw') s.tension = clamp(s.tension + 0.2, 0, 100);
    if (s.t >= x.until) endSit(s, x);
  }
  const busy = s.situations.filter((x) => x.kind !== 'heir').length;
  if (busy >= 2) return;
  const king = s.chars.seonjo;
  const has = (k: SituationKind) => !!activeSit(s, k);
  if (!has('scandal') && since(s, 'scandal') >= 12 && chance(s, 0.025)) return startScandal(s);
  if (!has('omen') && since(s, 'omen') >= 24 && chance(s, 0.012 + (s.tension > 60 ? 0.008 : 0))) return startOmen(s);
  if (!has('illness') && since(s, 'illness') >= 24 && king && chance(s, 0.006 + Math.max(0, age(s, king) - 30) * 0.0008)) return startIllness(s);
  const inbin = consortOf(s, 'inbin');
  if (!has('inlaw') && since(s, 'inlaw') >= 36 && s.t >= tOf(1580, 1) && inbin?.alive && inbin.love >= 60 && chance(s, 0.01)) return startInlaw(s);
}

/** 디버그·시뮬레이션용 */
export function forceSituation(s: GameState, k: SituationKind) {
  if (k === 'scandal') startScandal(s);
  else if (k === 'omen') startOmen(s);
  else if (k === 'illness') startIllness(s);
  else if (k === 'inlaw') startInlaw(s);
  else startDebate(s, '대신들의 청으로');
}

/* ───────── 이벤트 ───────── */

const pres = (c: Character, v: number) => (c.prestige = clamp(c.prestige + v, 0, 100));
const fav = (c: Character, v: number) => (c.favor = clamp(c.favor + v, -100, 100));
const freeJoin = (s: GameState, who: string, side: 'pro' | 'con') => {
  const cs = caseOn(s, who);
  if (!cs) return null;
  s.player.ap += 1;
  if (joinError(s, cs, side)) {
    s.player.ap -= 1;
    return null;
  }
  return joinCase(s, cs.id, side);
};

export const SITUATION_EVENTS: Record<string, EventDef> = {
  scandal_break: {
    build(s) {
      const x = activeSit(s, 'scandal')!;
      const w = s.chars[x.data.who];
      const same = topOf(w.faction) === topOf(P(s).faction);
      return {
        title: '추문이 터지다',
        kind: 'court',
        text: `${officeTitle(w)} ${w.name}의 「${x.data.label}」 이야기가 저잣거리까지 퍼졌다. 대간이 그를 논핵하려 하고, ${FACTION_META[w.faction].name}은 몸을 사린다.\n\n${same ? '같은 편 사람의 추문이다. 감싸면 의리를 얻고, 등을 돌리면 살길을 얻는다.' : '상대 편의 추문이다. 몰아붙이기 좋은 때다.'}`,
        choices: [
          { key: 'attack', label: '앞장서 규탄한다', hint: `논핵에 가담한다 (행동력 없이). ${w.name} 호감 크게 하락.${same ? ' 같은 당이 등을 돌린다.' : ''}` },
          { key: 'defend', label: '그를 감싼다', hint: `구원 상소를 올린다 (행동력 없이). ${w.name}이 신세를 진다. 명망 -1.` },
          { key: 'watch', label: '지켜본다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const x = activeSit(s, 'scandal');
      if (!x || key === 'watch') return '말을 아꼈다.';
      const w = s.chars[x.data.who];
      if (!alive(w)) return;
      if (key === 'attack') {
        const r = freeJoin(s, w.id, 'pro');
        if (r) return r;
        const fx = sway(s, w, P(s).id, -10, '추문을 들춤', { clan: 0.3, decay: 0.1 });
        return `${josa(w.name, '을/를')} 규탄했다. (${fx.join(', ')})`;
      }
      pres(P(s), -1);
      const r = freeJoin(s, w.id, 'con');
      if (r) return `${r} (명망 -1)`;
      owe(s, w.id);
      const fx = sway(s, w, P(s).id, 10, '추문 속에 감쌈', { decay: 0.1 });
      return `${josa(w.name, '을/를')} 감쌌다. 그가 신세를 졌다. (${fx.join(', ')}, 명망 -1)`;
    },
  },

  scandal_me: {
    build(s) {
      const x = activeSit(s, 'scandal')!;
      const p = P(s);
      return {
        title: '나의 추문',
        kind: 'danger',
        text: `당신의 「${x.data.label}」 이야기가 도성에 퍼졌다. 누가 흘렸는지는 모르나, 대간이 붓을 들기 전에 손을 써야 한다.`,
        choices: [
          { key: 'explain', label: '상소를 올려 해명한다', hint: `정치력 판정 (주사위 + ${p.politics} ≥ 8). 성공하면 명망 -1, 실패하면 명망 -5, 성심 -5.` },
          { key: 'humble', label: '대문을 닫고 근신한다', hint: '명망 -3. 말이 빨리 잦아든다.' },
          { key: 'resign', label: '사직하고 물러난다', hint: '관직을 내놓는다. 명망 +1, 성심 +2.' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const x = activeSit(s, 'scandal');
      if (key === 'explain') {
        const r = d6(s) + p.politics;
        if (r >= 8) {
          pres(p, -1);
          if (x) x.until = s.t + 1;
          return `조리 있게 해명하자 말이 잦아들었다. (판정 ${r}, 명망 -1)`;
        }
        pres(p, -5);
        fav(p, -5);
        return `해명이 오히려 불을 붙였다. (판정 ${r}, 명망 -5, 성심 -5)`;
      }
      if (key === 'humble') {
        pres(p, -3);
        if (x) x.until = Math.min(x.until, s.t + 2);
        return '근신했다. 사람들의 입이 조금씩 닫힌다. (명망 -3)';
      }
      if (p.office) vacate(s, p);
      pres(p, 1);
      fav(p, 2);
      if (x) x.until = s.t + 1;
      return '사직소를 올리고 물러났다. (명망 +1, 성심 +2)';
    },
  },

  omen_call: {
    build(s, c) {
      const p = P(s);
      return {
        title: '구언(求言)',
        kind: 'history',
        text: `${c.sign}. 왕이 "과인의 부덕 때문이니 바른말을 아끼지 말라"는 교지를 내렸다. 조정 안팎의 선비들이 앞다투어 상소를 쓴다.\n\n구언에 응한 상소는 죄주지 않는 것이 법도지만, 왕의 마음이 언제까지 너그러울지는 모른다.${p.status === 'retired' ? '\n\n낙향한 몸이지만 산림에서도 상소는 올릴 수 있다.' : ''}`,
        choices: [
          { key: 'king', label: '왕의 허물을 곧게 아뢴다', hint: '명망 +4. 용안에 따라 성심 +3 또는 -5.' },
          { key: 'sipye', label: '백성의 폐단을 논한다', hint: '명망 +2, 성심 +1' },
          { key: 'blame', label: '재변이 상대 당의 전횡 탓이라 아뢴다', hint: '같은 당 호감 +4, 다른 당 -4, 긴장 +4, 명망 -1', disabled: p.faction === 'none' ? '당이 없다' : undefined },
          { key: 'none', label: '붓을 들지 않는다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'none') return '조용히 지나갔다.';
      if (key === 'king') {
        pres(p, 4 + (p.traits.includes('upright') ? 1 : 0));
        if (d6(s) + s.king.mood / 20 + p.favor / 40 >= 4) {
          fav(p, 3);
          return '왕이 상소를 읽고 "경의 말이 옳다"며 비답을 내렸다. (명망 +4, 성심 +3)';
        }
        fav(p, -5);
        return '왕이 상소를 덮고 한동안 말이 없었다고 한다. (명망 +4, 성심 -5)';
      }
      if (key === 'sipye') {
        pres(p, 2);
        fav(p, 1);
        return '백성의 폐단을 조목조목 아뢰었다. (명망 +2, 성심 +1)';
      }
      pres(p, -1);
      s.tension = clamp(s.tension + 4, 0, 100);
      const fx = [swayFaction(s, p.faction, p.id, 4, '구언 상소', 0.1)];
      for (const f of activeFactions(s)) if (topOf(f) !== topOf(p.faction)) fx.push(swayFaction(s, f, p.id, -4, '재변을 당쟁에 씀', 0.1));
      return `하늘의 꾸짖음을 상대 당에 돌렸다. (${fx.filter(Boolean).join(', ')})`;
    },
  },

  king_ill: {
    build(s) {
      const p = P(s);
      const debate = !!heirSit(s) || !!s.heir;
      return {
        title: '왕의 환후',
        kind: 'court',
        text: '왕이 열이 올라 며칠째 정사를 보지 못한다. 내의원이 분주하고, 대신들은 대궐 밖을 떠나지 못한다. 저마다 속으로는 같은 걱정을 한다 — 만일의 일이 생기면 누가 뒤를 잇는가.',
        choices: [
          { key: 'visit', label: '날마다 문안을 드린다', hint: '성심 +2' },
          { key: 'doctor', label: '이름난 의원을 천거한다 (재산 10)', hint: '반반의 확률로 성심 +6 또는 -3', disabled: p.wealth < 10 ? '재산이 모자란다' : undefined },
          { key: 'heir', label: '서둘러 국본을 정해야 한다고 아뢴다', hint: '명망 +2, 성심 -4. 국본 논의가 바로 시작된다.', disabled: debate ? '이미 논의 중이거나 세자가 있다' : undefined },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'visit') {
        fav(p, 2);
        return '날마다 문안을 드렸다. (성심 +2)';
      }
      if (key === 'doctor') {
        p.wealth -= 10;
        if (chance(s, 0.5)) {
          fav(p, 6);
          const x = activeSit(s, 'illness');
          if (x) x.until = Math.min(x.until, s.t + 1);
          return '천거한 의원의 처방에 왕의 열이 내렸다. (성심 +6)';
        }
        fav(p, -3);
        return '천거한 의원의 약이 듣지 않았다. (성심 -3)';
      }
      pres(p, 2);
      fav(p, -4);
      startDebate(s, '왕이 병석에 눕자');
      return '국본을 정하자고 아뢰었다. 왕이 눈을 감은 채 대답하지 않았다. (명망 +2, 성심 -4)';
    },
  },

  inlaw_rise: {
    build(s, c) {
      const p = P(s);
      return {
        title: '외척의 발호',
        kind: 'court',
        text: `인빈 김씨의 오라비 ${josa(c.kin, '이/가')} 궁중을 등에 업고 인사에 입김을 넣는다. 그에게 줄을 대면 벼슬길이 열리고, 맞서면 왕의 총애하는 후궁과 척을 진다.`,
        choices: [
          { key: 'link', label: '줄을 댄다 (재산 20)', hint: '외척의 발호가 끝날 때까지 임용 점수 +3. 끝날 때 50% 확률로 명망 -5와 드러난 흠결.', disabled: p.wealth < 20 ? '재산이 모자란다' : undefined },
          { key: 'impeach', label: '외척의 전횡을 탄핵한다', hint: `판정 (주사위 + 정치력 ${p.politics} + 명망/25 ≥ 9). 성공하면 명망 +5, 외척이 물러난다. 실패하면 성심 -8.` },
          { key: 'none', label: '얽히지 않는다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const x = activeSit(s, 'inlaw');
      if (!x || key === 'none') return '얽히지 않았다.';
      if (key === 'link') {
        p.wealth -= 20;
        if (!p.tags.includes('inlawLink')) p.tags.push('inlawLink');
        return `${x.data.kin}에게 인삼 몇 근을 보냈다. (재산 -20, 임용 점수 +3)`;
      }
      const r = d6(s) + p.politics + Math.floor(p.prestige / 25);
      if (r >= 9) {
        pres(p, 5);
        fav(p, -2);
        const inbin = consortOf(s, 'inbin');
        if (inbin) inbin.love = clamp(inbin.love - 8, 0, 100);
        x.until = s.t;
        return `상소가 공론을 얻었다. 왕도 ${josa(x.data.kin, '을/를')} 멀리하라 명했다. (판정 ${r}, 명망 +5, 성심 -2)`;
      }
      fav(p, -8);
      pres(p, 1);
      return `왕이 "후궁의 일가를 모함한다"며 상소를 물리쳤다. (판정 ${r}, 성심 -8, 명망 +1)`;
    },
  },
};
