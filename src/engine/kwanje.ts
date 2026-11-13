import type { Character, GameState, RegionId } from './types';
import type { EventDef } from './events/types';
import { DEPT_MAP, OFFICE_MAP, OFFICES, type OfficeDef } from './data/offices';
import { REGION_META } from './data/meta';
import { FACTION_META } from './data/meta';
import { tOf, yearOf } from './calendar';
import { chance, d6, pick } from './rng';
import { addFlaw, alive, clamp, fav, isP, josa, log, monthsSince, notice, P, people, pres, pushEvent } from './state';
import { opinion, sway, topOf } from './opinion';
import { lawOn } from './laws';
import { appointScore, holderMap, vacate } from './court';

/* ───────── 관제(官制): 관서의 신설과 혁파, 겸직, 전시의 직책 ─────────
 * 훈련도감·어영청·금위영·규장각·장용영 같은 관서는 시기와 법에 따라 생기고 없어진다.
 * 비변사·선혜청의 당상과 도체찰사는 현직 대신이 겸한다. 본직을 잃으면 겸직도 내려놓는다.
 * 전란이나 변란이 일면 도원수와 도체찰사를 두고, 난이 끝나면 거둔다.
 */

/** 지금 이 자리가 있는가 */
export function officeOpen(s: GameState, o: OfficeDef): boolean {
  if (o.from && s.t < tOf(o.from[0], o.from[1])) return false;
  if (o.to && s.t >= tOf(o.to[0], o.to[1])) return false;
  if (o.law && !lawOn(s, o.law)) return false;
  if (o.war && !s.war.active) return false;
  return true;
}

/** 지금 있는 실직(겸직 아닌 자리) */
export const openOffices = (s: GameState) => OFFICES.filter((o) => !o.concurrent && officeOpen(s, o));
/** 지금 있는 겸직 */
export const openKyeom = (s: GameState) => OFFICES.filter((o) => o.concurrent && officeOpen(s, o));

const kyeomOf = (s: GameState) => (s.kyeom ??= {});

/** 이 겸직을 맡은 사람 */
export function kyeomHolder(s: GameState, id: string): Character | undefined {
  const k = kyeomOf(s)[id];
  return k ? s.chars[k.who] : undefined;
}

/** 이 사람이 겸한 자리들 */
export const kyeomsOf = (s: GameState, c: Character) =>
  Object.entries(kyeomOf(s))
    .filter(([, v]) => v.who === c.id)
    .map(([id]) => OFFICE_MAP[id])
    .filter(Boolean);

/** 겸직을 맡을 수 있는가: 한성에서 그만한 실직에 있어야 한다 */
function canKyeom(s: GameState, c: Character, o: OfficeDef): boolean {
  if (!alive(c) || c.status !== 'active' || !c.office) return false;
  const main = OFFICE_MAP[c.office];
  if (!main || main.group === 'gamsa' || main.concurrent) return false;
  return main.rank <= (o.concurrent ?? 2);
}

/** 관서에 같이 있는 사람들 (실직과 겸직) */
export function deptMembers(s: GameState, dept: string): Character[] {
  const hm = holderMap(s);
  const out: Character[] = [];
  for (const o of OFFICES) {
    if (o.dept !== dept) continue;
    const h = o.concurrent ? kyeomHolder(s, o.id) : hm[o.id];
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** 이 사람이 속한 관서들 */
export function deptsOf(s: GameState, c: Character): string[] {
  const out = new Set<string>();
  if (c.status === 'active' && c.office && OFFICE_MAP[c.office]?.dept) out.add(OFFICE_MAP[c.office].dept!);
  for (const o of kyeomsOf(s, c)) if (o.dept) out.add(o.dept);
  return [...out];
}

/* ───────── 매달 ───────── */

export function tickKwanje(s: GameState) {
  const open = (s.flags.openOffices as string | undefined)?.split(',') ?? null;
  const now = OFFICES.filter((o) => officeOpen(s, o)).map((o) => o.id);
  if (open) {
    const was = new Set(open);
    const is = new Set(now);
    const born = now.filter((id) => !was.has(id));
    const gone = open.filter((id) => !is.has(id) && OFFICE_MAP[id]);
    if (born.length) announce(s, born, true);
    if (gone.length) {
      announce(s, gone, false);
      for (const id of gone) closeOffice(s, OFFICE_MAP[id]);
    }
  }
  s.flags.openOffices = now.join(',');
  tickKyeom(s);
  tickBibyeon(s);
}

/** 관서가 생기거나 없어졌음을 알린다 (관서 단위로 묶어서) */
function announce(s: GameState, ids: string[], born: boolean) {
  const depts = [...new Set(ids.map((id) => OFFICE_MAP[id].dept).filter(Boolean))] as string[];
  for (const d of depts) {
    const names = [...new Set(ids.filter((id) => OFFICE_MAP[id].dept === d).map((id) => OFFICE_MAP[id].name))];
    const dn = DEPT_MAP[d]?.name ?? d;
    if (d === 'wonsu') {
      log(s, born ? `[관제] 변란이 일자 ${names.join('·')}를 두어 군사를 맡겼다.` : `[관제] 난이 가라앉아 ${names.join('·')}를 거두었다.`, 'war');
      continue;
    }
    log(s, born ? `[관제] ${josa(dn, '을/를')} 새로 두었다. ${names.join('·')} 자리가 생겼다.` : `[관제] ${josa(dn, '이/가')} 혁파되었다. ${names.join('·')} 자리가 없어졌다.`, 'history');
  }
}

/** 없어진 자리의 사람을 내보낸다 */
function closeOffice(s: GameState, o: OfficeDef) {
  if (o.concurrent) {
    const h = kyeomHolder(s, o.id);
    delete kyeomOf(s)[o.id];
    if (h && o.war) warMerit(s, h, o);
    if (h && isP(s, h)) notice(s, '겸직을 내려놓음', `${o.name} 자리가 없어져 겸직을 내려놓았다.`, 'court');
    return;
  }
  const h = holderMap(s)[o.id];
  if (!h) return;
  if (o.war) warMerit(s, h, o);
  vacate(s, h);
  if (isP(s, h)) notice(s, '자리가 없어짐', `${o.name} 자리가 없어졌다. 한성에서 다음 보직을 기다린다.`, 'court');
}

/** 전란이 끝나 지휘를 거둔 이에게 공을 매긴다 */
function warMerit(s: GameState, c: Character, o: OfficeDef) {
  const good = (c.politics ?? 0) >= 6;
  pres(c, good ? 5 : 1);
  log(s, `${o.name} ${josa(c.name, '이/가')} 군사를 거두고 돌아왔다.${good ? ' 그의 지휘를 두고 칭송이 자자하다.' : ''}`, isP(s, c) ? 'player' : 'court');
  if (isP(s, c)) {
    s.player.deeds.push(`${yearOf(s.t)} ${o.name}로서 변란을 수습`);
    notice(s, '군사를 거둠', `${o.name}의 소임을 마쳤다. (명망 +${good ? 5 : 1})`, 'personal');
  }
}

/** 겸직: 자격을 잃은 이는 내려놓고, 빈 겸직은 채운다 */
function tickKyeom(s: GameState) {
  const k = kyeomOf(s);
  // 예전 저장: 김조순의 종신 자리를 임명 제조로 옮긴다
  for (const old of ['bibyeon_je1', 'bibyeon_je3']) {
    if (typeof s.flags[`kyeomLife_${old}`] !== 'string') continue;
    const who = s.flags[`kyeomLife_${old}`] as string;
    delete s.flags[`kyeomLife_${old}`];
    s.flags.kyeomLife_bibyeon_je7 = who;
    k.bibyeon_je7 = { who, since: k[old]?.since ?? s.t };
    delete k[old];
  }
  // 당연직: 그 자리에 앉은 이가 저절로 겸한다
  const hmEx = holderMap(s);
  for (const o of OFFICES) {
    if (!o.exOfficio) continue;
    const h = officeOpen(s, o) && officeOpen(s, OFFICE_MAP[o.exOfficio]) ? hmEx[o.exOfficio] : undefined;
    const cur = k[o.id];
    if (!h) {
      if (cur) delete k[o.id];
      continue;
    }
    if (cur?.who === h.id) continue;
    k[o.id] = { who: h.id, since: s.t };
    if (isP(s, h)) notice(s, '당연직 겸직', `${OFFICE_MAP[o.exOfficio].name}로서 ${josa(o.name, '을/를')} 겸한다. ${o.desc}`, 'court');
  }
  for (const [id, v] of Object.entries(k)) {
    if (OFFICE_MAP[id]?.exOfficio) continue;
    const o = OFFICE_MAP[id];
    const c = s.chars[v.who];
    if (!o || !officeOpen(s, o)) {
      delete k[id];
      continue;
    }
    const life = s.flags[`kyeomLife_${id}`];
    if (life && life === v.who) {
      if (c && alive(c) && c.status !== 'exiled') continue;
      delete s.flags[`kyeomLife_${id}`];
    }
    const expired = s.t - v.since >= o.term && chance(s, 0.08);
    const doubled = Object.entries(k).some(([x, w]) => x !== id && w.who === v.who && OFFICE_MAP[x]?.exOfficio && OFFICE_MAP[x]?.dept === o.dept);
    if (!c || !canKyeom(s, c, o) || expired || doubled) {
      delete k[id];
      if (c && isP(s, c) && alive(c)) notice(s, '겸직을 내려놓음', `${o.name} 겸직을 내려놓았다.`, 'court');
    }
  }
  const hm = holderMap(s);
  for (const o of openKyeom(s)) {
    if (k[o.id] || o.exOfficio) continue;
    // 당연직은 다른 겸직을 막지 않는다 (정승이 도제조이면서 도체찰사를 겸할 수 있다)
    // 다만 비변사 안에서는 한 사람이 두 자리를 겸하지 않는다
    const taken = new Set(Object.entries(k).filter(([id]) => !OFFICE_MAP[id]?.exOfficio || OFFICE_MAP[id]?.dept === o.dept).map(([, v]) => v.who));
    let best: Character | undefined;
    let bs = -Infinity;
    for (const c of people(s)) {
      if (taken.has(c.id) || !canKyeom(s, c, o)) continue;
      let sc = appointScore(s, c, o, hm);
      // 도체찰사는 전란의 일에 밝은 이를, 비변사는 병조·호조를 지낸 이를 쓴다
      if (o.dept === 'bibyeonsa' && (c.office === 'byeongjo' || c.office === 'hojo')) sc += 4;
      if (o.dept === 'seonhyecheong' && c.office === 'hojo') sc += 6;
      if (sc > bs) {
        bs = sc;
        best = c;
      }
    }
    if (!best) continue;
    k[o.id] = { who: best.id, since: s.t };
    if (isP(s, best)) {
      s.player.deeds.push(`${yearOf(s.t)} ${o.name} 겸직`);
      notice(s, '겸직', `${josa(o.name, '을/를')} 겸하게 되었다. ${o.desc}`, 'court');
      log(s, `${josa(best.name, '이/가')} ${josa(o.name, '을/를')} 겸했다.`, 'player');
    } else if (o.war || o.rank <= 1) log(s, `${josa(best.name, '이/가')} ${josa(o.name, '을/를')} 겸했다. (${FACTION_META[best.faction].name})`, 'court');
  }
}

/* ───────── 군문과 반정, 도원수와 전황 ───────── */

const GUNMUN = ['hullyeon_dj', 'eoyeong_dj', 'geumwi_dj', 'jangyong_dj'];

/** 반정이 일었을 때 도성 군영 대장들의 향배: [반정 쪽, 왕실 쪽] */
export function gunmunSway(s: GameState, coupFaction: Character['faction']): [number, number] {
  const hm = holderMap(s);
  let atk = 0;
  let def = 0;
  for (const id of GUNMUN) {
    const h = hm[id];
    if (!h) continue;
    if (topOf(h.faction) === topOf(coupFaction)) atk++;
    else def++;
  }
  return [atk, def];
}

/** 도원수의 지휘: 정치력이 높으면 난이 빨리 가라앉는다 */
export function wonsuBonus(s: GameState): number {
  const h = holderMap(s).dowonsu;
  if (!h) return 0;
  const v = (h.politics >= 7 ? 1 : h.politics <= 3 ? -1 : 0) + (h.traits.includes('martial') ? 1 : 0);
  return Math.max(-1, Math.min(2, v));
}

/* ───────── 같은 관서 안의 다툼과 협력 ───────── */

export function tickDept(s: GameState) {
  // NPC끼리: 다른 당의 판서와 참판이 부딪친다
  if (chance(s, 0.03)) {
    const hm = holderMap(s);
    const pairs: [Character, Character, string][] = [];
    for (const d of ['ijo', 'hojo', 'yejo', 'byeongjo', 'hyeongjo', 'gongjo']) {
      const a = hm[d];
      const b = hm[`champan_${d}`];
      if (a && b && !isP(s, a) && !isP(s, b) && topOf(a.faction) !== topOf(b.faction) && a.faction !== 'none' && b.faction !== 'none') pairs.push([a, b, d]);
    }
    if (pairs.length) {
      const [a, b, d] = pick(s, pairs);
      sway(s, a, b.id, -8, '관서 안의 다툼', { decay: 0.1 });
      sway(s, b, a.id, -8, '관서 안의 다툼', { decay: 0.1 });
      log(s, `[관서] ${DEPT_MAP[d].name}에서 판서 ${josa(a.name, '과/와')} 참판 ${josa(b.name, '이/가')} 당색을 달리해 사사건건 부딪친다.`, 'court');
    }
  }
  const p = P(s);
  if (!alive(p) || p.status !== 'active' || s.pending.length >= 2 || monthsSince(s, 'deptEvAt') < 8) return;
  const mates: Character[] = [];
  // 실권 없는 중추부에서는 다툴 일도, 함께 세울 공도 없다
  for (const d of deptsOf(s, p)) if (d !== 'jungchubu') for (const c of deptMembers(s, d)) if (c.id !== p.id && !mates.includes(c)) mates.push(c);
  if (!mates.length || !chance(s, 0.035)) return;
  const c = pick(s, mates);
  const op = opinion(s, c, p);
  const rival = (c.faction !== 'none' && p.faction !== 'none' && topOf(c.faction) !== topOf(p.faction)) || op < -10;
  const friend = op > 15 || (c.faction === p.faction && p.faction !== 'none');
  const kind = rival && (!friend || chance(s, 0.5)) ? 'dept_clash' : friend ? 'dept_coop' : chance(s, 0.5) ? 'dept_clash' : 'dept_coop';
  s.flags.deptEvAt = s.t;
  const shared = deptsOf(s, p).find((d) => deptsOf(s, c).includes(d))!;
  pushEvent(s, kind, { who: c.id, dept: shared });
}

/** 그가 나보다 윗사람인가, 아랫사람인가 */
function standing(s: GameState, c: Character): string {
  const p = P(s);
  return c.rank < p.rank ? '윗사람' : c.rank > p.rank ? '아랫사람' : '동료';
}

const CLASH_TEXT: Record<string, (c: string, rel: string) => string> = {
  ijo: (c, rel) => `이조의 ${rel} ${josa(c, '이/가')} 당신이 올린 의망 명단을 뒤집으려 한다. 자기 당 사람을 끼워 넣겠다는 것이다.`,
  hojo: (c, rel) => `호조의 ${rel} ${josa(c, '이/가')} 당신이 짠 경비 지출을 두고 "근거 없는 낭비"라며 결재를 미룬다.`,
  byeongjo: (c, rel) => `병조의 ${rel} ${josa(c, '이/가')} 무관 인사를 두고 당신과 다른 사람을 민다. 군문의 줄이 걸린 일이다.`,
  yejo: (c, rel) => `예조의 ${rel} ${josa(c, '이/가')} 제례의 절차를 두고 당신의 해석이 예법에 어긋난다고 공박한다.`,
  hyeongjo: (c, rel) => `형조의 ${rel} ${josa(c, '이/가')} 당신이 맡은 옥사의 판결을 뒤집자고 한다.`,
  gongjo: (c, rel) => `공조의 ${rel} ${josa(c, '이/가')} 당신이 맡은 공역의 장부에 흠이 있다고 트집을 잡는다.`,
  bibyeonsa: (c, rel) => `비변사 회의에서 ${rel} ${josa(c, '이/가')} 당신의 방략을 "탁상공론"이라며 정면으로 반박한다.`,
};

const COOP_TEXT: Record<string, (c: string, rel: string) => string> = {
  hojo: (c, rel) => `호조의 ${rel} ${josa(c, '과/와')} 함께 묵은 장부를 뒤져 새는 곡식을 찾아냈다.`,
  byeongjo: (c, rel) => `병조의 ${rel} ${josa(c, '과/와')} 함께 군적의 허수를 바로잡았다.`,
  ijo: (c, rel) => `이조의 ${rel} ${josa(c, '과/와')} 뜻을 모아 묻혀 있던 인재를 천거했다.`,
  bibyeonsa: (c, rel) => `비변사에서 ${rel} ${josa(c, '과/와')} 함께 올린 방략이 왕의 칭찬을 받았다.`,
};

function deptLabel(d: string) {
  return DEPT_MAP[d]?.name ?? '관서';
}

export const KWANJE_EVENTS: Record<string, EventDef> = {
  dept_clash: {
    build(s, x) {
      const c = s.chars[x.who];
      const rel = standing(s, c);
      const text = CLASH_TEXT[x.dept]?.(c.name, rel) ?? `${deptLabel(x.dept)}의 ${rel} ${josa(c.name, '이/가')} 일마다 당신과 어긋난다. 아전들까지 눈치를 본다.`;
      return {
        title: `${deptLabel(x.dept)} 안의 다툼`,
        kind: 'court',
        text: `${text}\n\n${c.name} (${FACTION_META[c.faction].name}, 정치력 ${c.politics} · 명망 ${Math.round(c.prestige)})`,
        choices: [
          { key: 'stand', label: '정면으로 맞선다', hint: `주사위 + 정치력 대결 (당신 ${P(s).politics} : ${c.politics}). 이기면 명망 +3, 지면 명망 -2. 그와 사이가 틀어진다` },
          { key: 'yield', label: '한발 물러선다', hint: '그의 호감 +6, 명망 -1' },
          { key: 'report', label: '대신에게 아뢰어 시비를 가린다', hint: '성심이 그보다 높으면 성심 +2, 낮으면 -2. 그의 호감 -12' },
        ],
      };
    },
    resolve(s, x, key) {
      const p = P(s);
      const c = s.chars[x.who];
      if (!alive(c)) return '그는 이미 자리를 떴다.';
      if (key === 'yield') {
        sway(s, c, p.id, 6, '한발 물러섬', { decay: 0.15 });
        pres(p, -1);
        return `${c.name}에게 양보했다. 일은 매끄러워졌지만 만만하게 보인다. (명망 -1)`;
      }
      if (key === 'report') {
        const win = p.favor >= c.favor;
        fav(p, win ? 2 : -2);
        sway(s, c, p.id, -12, '윗선에 고자질', { decay: 0.1 });
        return win ? '대신이 당신 손을 들어 주었다. (성심 +2)' : '대신이 오히려 그의 편을 들었다. (성심 -2)';
      }
      const a = d6(s) + p.politics;
      const b = d6(s) + c.politics;
      sway(s, c, p.id, -10, '관서 안의 다툼', { decay: 0.1 });
      if (a >= b) {
        pres(p, 3);
        pres(c, -2);
        return `맞서서 이겼다. (${a} : ${b}) 아전들이 당신 쪽으로 기운다. (명망 +3)`;
      }
      pres(p, -2);
      return `맞섰지만 밀렸다. (${a} : ${b}) (명망 -2)`;
    },
  },
  dept_coop: {
    build(s, x) {
      const c = s.chars[x.who];
      const rel = standing(s, c);
      const text = COOP_TEXT[x.dept]?.(c.name, rel) ?? `${deptLabel(x.dept)}의 ${rel} ${josa(c.name, '과/와')} 손발이 맞아 밀린 일을 깔끔히 처리했다.`;
      const cross = c.faction !== p0(s).faction && c.faction !== 'none' && p0(s).faction !== 'none';
      return {
        title: `${deptLabel(x.dept)}의 공(功)`,
        kind: 'court',
        text: `${text} 위에서 누구의 공인지 묻는다.${cross ? `\n\n그는 ${FACTION_META[c.faction].name}이다. 당은 달라도 일은 함께 할 수 있다.` : ''}`,
        choices: [
          { key: 'share', label: '공을 함께 나눈다', hint: '명망 +2, 그의 명망 +2, 그의 호감 +10' },
          { key: 'take', label: '공을 내 것으로 아뢴다', hint: '명망 +4. 그의 호감 -15. 30% 확률로 「공을 가로챔」 흠결이 드러난다' },
          ...(cross ? [{ key: 'bond', label: '이 기회에 그와 교분을 맺는다', hint: '그의 호감 +18. 당 안에서 곱지 않게 본다 (당 호감 -2)' }] : []),
        ],
      };
    },
    resolve(s, x, key) {
      const p = P(s);
      const c = s.chars[x.who];
      if (!alive(c)) return '그는 이미 자리를 떴다.';
      if (key === 'take') {
        pres(p, 4);
        sway(s, c, p.id, -15, '공을 가로챔', { decay: 0.1 });
        if (chance(s, 0.3)) addFlaw(s, p, '공을 가로챔', true);
        return '공을 내 것으로 아뢰었다. (명망 +4)';
      }
      if (key === 'bond') {
        sway(s, c, p.id, 18, '함께 일한 정', { decay: 0.08 });
        for (const m of people(s)) if (m.faction === p.faction && m.id !== p.id && chance(s, 0.3)) sway(s, m, p.id, -2, '다른 당과 어울림', { decay: 0.2 });
        return `${josa(c.name, '과/와')} 교분을 맺었다. 당 안에서 수군거리는 소리가 난다.`;
      }
      pres(p, 2);
      pres(c, 2);
      sway(s, c, p.id, 10, '공을 나눔', { decay: 0.1 });
      return `${josa(c.name, '과/와')} 공을 나누었다. (명망 +2)`;
    },
  },
  bibyeon_meet: {
    build(s) {
      return {
        title: '비변사 회의',
        kind: 'court',
        text: '해가 바뀌어 비변사 당상들이 모였다. 올해 방비의 큰 줄기를 어디에 둘지 정해야 한다. 제조인 당신의 말에 무게가 실린다.',
        choices: [
          { key: 'north', label: '북방을 굳히자 (평안·함경)', hint: '국고 -20. 평안·함경 조련 +8' },
          { key: 'south', label: '남쪽 바다를 지키자 (경상·전라)', hint: '국고 -20. 경상·전라 조련 +8' },
          { key: 'capital', label: '도성과 경기를 먼저 지키자', hint: '국고 -15. 경기·도성 조련 +8' },
          { key: 'save', label: '군비를 아껴 백성의 짐을 덜자', hint: '국고 +10. 팔도 민심 +2. 조련은 그대로' },
        ],
      };
    },
    resolve(s, _x, key) {
      const p = P(s);
      const drill = (rs: RegionId[], v: number) => {
        for (const r of rs) s.regions[r].defense.drill = clamp(s.regions[r].defense.drill + v, 0, 100);
      };
      if (key === 'save') {
        s.realm.treasury += 10;
        for (const r of Object.values(s.regions)) r.minsim = clamp(r.minsim + 2, 0, 100);
        pres(p, 1);
        return '군비를 아끼자고 했다. 백성의 짐이 조금 가벼워졌다.';
      }
      const rs: RegionId[] = key === 'north' ? ['pyeongan', 'hamgyeong'] : key === 'south' ? ['gyeongsang', 'jeolla'] : ['gyeonggi', 'hanseong'];
      s.realm.treasury -= key === 'capital' ? 15 : 20;
      drill(rs, 8);
      fav(p, 1);
      log(s, `[비변사] 올해 방비를 ${rs.map((r) => REGION_META[r].short).join('·')}에 두기로 했다.`, 'court');
      return `${rs.map((r) => REGION_META[r].short).join('·')}의 방비를 다지기로 했다.`;
    },
  },
};

const p0 = (s: GameState) => P(s);

/** 해마다 정월: 비변사 당상인 플레이어에게 회의가 열린다 */
export function rollBibyeon(s: GameState) {
  if (s.t % 12 !== 0) return;
  const p = P(s);
  if (!alive(p) || p.status !== 'active') return;
  if (!kyeomsOf(s, p).some((o) => o.dept === 'bibyeonsa')) return;
  if (s.pending.length >= 2) return;
  pushEvent(s, 'bibyeon_meet', {});
}

/* ───────── 국정의 중심: 의정부에서 비변사로 ─────────
 * 학계의 통설(이재호 「조선비변사고」 1971, 반윤홍 『조선시대 비변사 연구』 2003, 『신편 한국사』 30):
 *  · 비변사는 중종 대 왜변에 대비한 임시 기구로 출발해 16세기 중엽 상설 1품 아문이 되었다.
 *  · 임진왜란을 치르며 군사뿐 아니라 외교·재정·인사·지방행정까지 맡는 국정 최고 기관이 되었고,
 *    관제상 최고 기구인 의정부와 육조의 체계는 형식만 남았다. 소수의 제조당상이 인사와 정무를 쥐었다.
 *  · 전란과 변란이 거듭될수록 커졌고, 순조 이후 세도기에는 척신이 비변사 요직과 인사·정무를 독점해
 *    국왕은 비변사의 결정을 형식적으로 따르는 처지가 되었다.
 *  · 1864~65년 흥선대원군이 정무는 의정부로, 군무는 삼군부로 돌리고 비변사를 혁파했다.
 * 비변사의 확대를 왕권 강화의 수단으로 본 시각(중종이 폐지론을 묵살)과 집권층 권한 증대로 본 시각이 함께 있으나,
 * 조선 후기로 갈수록 의정부가 허구화되고 왕권이 비변사·척신에 제약되었다는 데에는 이견이 적다.
 *
 * 게임에서는 「비변사의 위상」 0~100으로 나타낸다.
 *  · 전란·변란 중에는 크게, 평시에도 조금씩 오른다. 탕평군주는 조금씩 되돌리고, 세도 아래에서는 빠르게 오른다.
 *  · 「의정부 서사제 복구」 법이 시행되면 되돌아간다 (역사에서는 1864년에야 이루어졌다).
 *  · 위상이 높을수록: 정승 자리의 세력 비중이 줄고 비변사 당상의 비중이 커진다.
 *    왕의 용안이 돌아가는 바탕이 낮아진다 (왕권 하락). 비변사 도제조의 호감이 임용에 끼어든다.
 */

export const bibyeonPower = (s: GameState) => (typeof s.flags.bibyeon === 'number' ? (s.flags.bibyeon as number) : 25);

export function bibyeonStage(v: number): { name: string; text: string } {
  if (v < 35) return { name: '의정부 중심', text: '삼정승이 백관을 거느리고, 비변사는 변방의 일만 의논한다.' };
  if (v < 55) return { name: '비변사 확대', text: '비변사가 군사를 넘어 재정과 외교까지 의논하기 시작했다. 의정부의 일이 줄어든다.' };
  if (v < 75) return { name: '비변사 중심', text: '국정의 큰일이 모두 비변사 회의에서 정해진다. 의정부와 육조는 형식만 남았고, 왕도 비변사의 뜻을 거스르기 어렵다.' };
  return { name: '척신의 비변사', text: '비변사 당상들이 서로를 천거해 요직과 인사를 독점한다. 왕은 비변사가 정한 일을 형식적으로 따를 뿐이다.' };
}

/** 위상에 따라 왕의 용안이 돌아가는 바탕 (왕권) */
export function authorityBase(s: GameState): number {
  const v = bibyeonPower(s);
  let base = -Math.max(0, v - 35) * 0.4;
  if (s.flags.kingStyle === 'tangpyeong') base += 6;
  // 수렴청정 아래에서는 임금의 권위가 더 낮다
  if (typeof s.flags.suryeomUntil === 'number' && s.t < (s.flags.suryeomUntil as number)) base -= 6;
  return Math.round(base * 10) / 10;
}

/** 정승 자리와 비변사 당상의 세력 비중 배율 */
export function bibyeonWeight(s: GameState, o: OfficeDef): number {
  const v = bibyeonPower(s) / 100;
  if (o.dept === 'uijeongbu') return 1 - 0.5 * Math.max(0, v - 0.25);
  if (o.dept === 'bibyeonsa') return 1 + 2.5 * Math.max(0, v - 0.25);
  return 1;
}

export function tickBibyeon(s: GameState) {
  let v = bibyeonPower(s);
  const style = s.flags.kingStyle;
  if (s.war.active) v += 0.12;
  else v += 0.006;
  if (style === 'tangpyeong') v -= 0.015;
  if (style === 'sedo') v += 0.06;
  if (lawOn(s, 'seosa')) v -= 0.3;
  v = clamp(v, 10, 95);
  const before = bibyeonStage(bibyeonPower(s)).name;
  s.flags.bibyeon = v;
  const after = bibyeonStage(v).name;
  if (before !== after) log(s, `[관제] 국정의 중심이 바뀌었다: 「${after}」. ${bibyeonStage(v).text}`, 'history');
}

/** 역사의 고비에 비변사가 한꺼번에 커진다 */
export function bibyeonJump(s: GameState, dv: number, text: string) {
  const before = bibyeonStage(bibyeonPower(s)).name;
  s.flags.bibyeon = clamp(bibyeonPower(s) + dv, 10, 95);
  const st = bibyeonStage(bibyeonPower(s));
  log(s, `[비변사] ${text}${st.name !== before ? ` 국정의 중심이 바뀌었다: 「${st.name}」.` : ''}`, 'history');
}
