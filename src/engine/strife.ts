import type { Case, Character, FactionId, GameState } from './types';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP, OFFICES } from './data/offices';
import { officeOpen } from './kwanje';
import { yearOf } from './calendar';
import { chance, d6, pick, rand, randInt } from './rng';
import { addFlaw, alive, atSeat, clamp, fav, inCourt, isP, josa, log, monthsSince, notice, officeTitle, owe, P, people, pres, pushEvent } from './state';
import { opinion, sway, swayFaction, topOf } from './opinion';
import { activeFactions, influence, members, powerShare } from './factions';
import { kingLean, kingMood } from './king';
import { appoint, appointParts, eligible, holderMap, vacate } from './court';
import { exile, kill } from './conflict';
import { openCase } from './cases';

/* ═════════════ 1. 당내 계파와 영수 승계 ═════════════
 * 당 안에는 원로들의 노장파와 젊은 언관들의 소장파가 있다. 소장파가 힘을 얻으면 당론이 강경해진다.
 * 영수가 죽거나 쫓겨나면 두 사람이 후계를 다투고, 이긴 이가 3년 동안 영수 자리를 지킨다.
 */

export type Wing = 'elder' | 'young';
export const WING_NAME: Record<Wing, string> = { elder: '노장파', young: '소장파' };

export function wingOf(s: GameState, c: Character): Wing {
  return yearOf(s.t) - c.born >= 50 || c.rank <= 2 ? 'elder' : 'young';
}

/** 계파별 당내 영향력의 몫 */
export function wingShare(s: GameState, f: FactionId): Record<Wing, number> {
  const v: Record<Wing, number> = { elder: 0, young: 0 };
  for (const c of members(s, f)) if (c.status !== 'exiled') v[wingOf(s, c)] += influence(s, c);
  const t = v.elder + v.young || 1;
  return { elder: v.elder / t, young: v.young / t };
}

export function wingHead(s: GameState, f: FactionId, w: Wing): Character | undefined {
  return members(s, f)
    .filter((c) => c.status !== 'exiled' && wingOf(s, c) === w)
    .sort((a, b) => influence(s, b) - influence(s, a))[0];
}

/** 매달: 소장파가 우세하면 당론이 강경해지고 노장파가 우세하면 누그러진다 */
function tickWings(s: GameState) {
  for (const f of activeFactions(s)) {
    const w = wingShare(s, f);
    s.line[f] = clamp((s.line[f] ?? 0) + (w.young - 0.5) * 1.2, -60, 60);
  }
}

/** 영수가 사라졌으면 후계 다툼을 연다. updateLeaders보다 먼저 돈다. */
function checkSuccession(s: GameState) {
  for (const f of activeFactions(s)) {
    const st = s.factions[f];
    if (st.contest) {
      if (s.t >= st.contest.due) settleContest(s, f);
      continue;
    }
    const lead = st.leader ? s.chars[st.leader] : undefined;
    const gone = !lead || !alive(lead) || lead.status === 'exiled' || lead.faction !== f;
    if (!gone || s.t === 0) continue;
    const cands = members(s, f)
      .filter((c) => c.status !== 'exiled' && inCourt(c))
      .sort((a, b) => influence(s, b) - influence(s, a))
      .slice(0, 2);
    if (cands.length < 2) continue;
    st.contest = { cands: cands.map((c) => c.id), due: s.t + 3, backers: { [cands[0].id]: [], [cands[1].id]: [] } };
    st.lockUntil = s.t + 3;
    st.leader = cands[0].id;
    // 당원들이 줄을 선다
    for (const c of members(s, f)) {
      if (isP(s, c) || cands.some((x) => x.id === c.id)) continue;
      const pickc = opinion(s, c, cands[0]) + (wingOf(s, c) === wingOf(s, cands[0]) ? 15 : 0) >= opinion(s, c, cands[1]) + (wingOf(s, c) === wingOf(s, cands[1]) ? 15 : 0) ? cands[0] : cands[1];
      st.contest.backers[pickc.id].push(c.id);
    }
    log(s, `[당론] ${FACTION_META[f].name}의 영수 자리가 비었다. ${cands.map((c) => `${c.name}(${WING_NAME[wingOf(s, c)]})`).join('과 ')}이 후계를 다툰다.`, 'faction');
    const p = P(s);
    if (p.faction === f && p.status !== 'exiled') pushEvent(s, 'succession_contest', { faction: f });
  }
}

function settleContest(s: GameState, f: FactionId) {
  const st = s.factions[f];
  const c = st.contest!;
  st.contest = undefined;
  const [a, b] = c.cands.map((id) => s.chars[id]);
  const score = (x: Character | undefined) => (alive(x) && x.faction === f ? influence(s, x) + (c.backers[x.id]?.length ?? 0) * 1.5 + d6(s) * 2 : -99);
  const sa = score(a);
  const sb = score(b);
  const w = sa >= sb ? a : b;
  const l = w === a ? b : a;
  if (!alive(w)) return;
  st.leader = w.id;
  st.lockUntil = s.t + 36;
  if (alive(l) && l.faction === f) {
    if (!l.grudges.includes(w.id)) l.grudges.push(w.id);
    st.division += 4;
    // 진 쪽 계파가 강경해지거나 떨어져 나갈 기운이 생긴다
    if (wingOf(s, l) !== wingOf(s, w)) s.line[f] = clamp((s.line[f] ?? 0) + (wingOf(s, l) === 'young' ? 8 : -8), -60, 60);
  }
  log(s, `[당론] ${josa(w.name, '이/가')} ${FACTION_META[f].name}의 영수가 되었다.${alive(l) ? ` ${josa(l.name, '은/는')} 이를 갈며 물러섰다.` : ''}`, 'faction');
  const p = P(s);
  if (p.faction !== f) return;
  if (isP(s, w)) {
    pres(p, 4);
    notice(s, '영수가 되다', `${FACTION_META[f].name}의 영수가 되었다. 3년 동안 그 자리를 지킨다. (명망 +4)`, 'personal');
    return;
  }
  const mine = Object.entries(c.backers).find(([, ids]) => ids.includes(p.id))?.[0];
  if (mine === w.id) {
    owe(s, w.id);
    notice(s, '영수의 승계', `당신이 민 ${josa(w.name, '이/가')} 영수가 되었다. 그가 신세를 졌다.`, 'court');
  } else if (mine) {
    sway(s, w, p.id, -10, '후계 다툼에서 맞섬', { decay: 0.08 });
    notice(s, '영수의 승계', `당신이 밀지 않은 ${josa(w.name, '이/가')} 영수가 되었다. 그가 당신을 기억할 것이다.`, 'court');
  }
}

/* ═════════════ 2. 청요직 장악전 ═════════════ */

export const isCheongyo = (id: string) => !!(OFFICE_MAP[id]?.samsa || OFFICE_MAP[id]?.cheongyo);

/** 당마다 쥐고 있는 삼사·청요직 수 */
export function cheongyoHeld(s: GameState): Partial<Record<FactionId, number>> & { total: number } {
  const hm = holderMap(s);
  const out: Partial<Record<FactionId, number>> & { total: number } = { total: 0 };
  for (const o of OFFICES) {
    if (!isCheongyo(o.id) || o.concurrent || !officeOpen(s, o)) continue;
    out.total++;
    const h = hm[o.id];
    if (h) out[h.faction] = (out[h.faction] ?? 0) + 1;
  }
  return out;
}

/** 이 당이 언로(삼사·청요직)의 절반 이상을 쥐었는가 */
export function controlsCheongyo(s: GameState, f: FactionId): boolean {
  if (f === 'none') return false;
  const h = cheongyoHeld(s);
  return (h[f] ?? 0) * 2 >= h.total;
}

/** 자대제(自代制): 물러나는 이조전랑이 후임을 스스로 고른다 */
export function jadaePick(s: GameState, outgoing: Character): string | undefined {
  const o = OFFICE_MAP.jeonrang;
  const hm = holderMap(s);
  const pool = people(s).filter((c) => c.id !== outgoing.id && eligible(s, c, o));
  if (isP(s, outgoing)) {
    const cands = pool
      .map((c) => [c, appointParts(s, c, o, hm).reduce((a, x) => a + x.value, 0)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([c]) => c.id);
    if (cands.length) pushEvent(s, 'jadae', { cands });
    s.flags.reserve_jeonrang = true;
    return undefined;
  }
  const best = pool
    .map((c) => [c, appointParts(s, c, o, hm).reduce((a, x) => a + x.value, 0) + (c.faction === outgoing.faction && c.faction !== 'none' ? 6 : 0) + opinion(s, outgoing, c) / 10] as const)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  return best?.id;
}

/* ═════════════ 3. 공론 형성 ═════════════
 * 재야의 명망가와 서원, 성균관 유생들의 목소리가 각 당의 공론이 된다.
 */

export function gongronOf(s: GameState): Partial<Record<FactionId, number>> {
  const v: Partial<Record<FactionId, number>> = {};
  for (const c of people(s)) {
    if (c.faction === 'none') continue;
    let w = c.prestige / 20;
    if (c.status === 'retired' || c.traits.includes('scholar') || c.traits.includes('recluse')) w *= 1.8;
    v[c.faction] = (v[c.faction] ?? 0) + w;
  }
  const p = P(s);
  if (p.faction !== 'none' && s.player.built.includes('seowon')) v[p.faction] = (v[p.faction] ?? 0) + 6;
  if (p.faction !== 'none') v[p.faction] = (v[p.faction] ?? 0) + s.player.disciples * 0.5;
  const t = Object.values(v).reduce((a, x) => a + (x ?? 0), 0) || 1;
  for (const k of Object.keys(v) as FactionId[]) v[k] = (v[k] ?? 0) / t;
  return v;
}

/** 큰 공방에 성균관 유생들이 상소로 끼어든다 */
function tickYusaeng(s: GameState) {
  if (!chance(s, 0.05)) return;
  const cs = s.cases.filter((c) => c.kind === 'impeach' && !c.yusaeng && (s.chars[c.target]?.prestige ?? 0) + (s.chars[c.attacker]?.prestige ?? 0) >= 60);
  const c = cs.length ? pick(s, cs) : undefined;
  if (!c) return;
  const atk = s.chars[c.attacker];
  const tgt = s.chars[c.target];
  const g = gongronOf(s);
  const forAtk = (g[atk.faction] ?? 0) >= (g[tgt.faction] ?? 0);
  c.yusaeng = true;
  const p = P(s);
  if (p.status === 'active' && p.office === 'daesaseong') {
    pushEvent(s, 'yusaeng', { caseId: c.id, forAtk });
    return;
  }
  c.bonus += forAtk ? 1 : -1;
  log(s, `[공론] 성균관 유생 수백 명이 대궐 앞에 엎드려 ${forAtk ? `${tgt.name}를 벌하라` : `${tgt.name}의 억울함을 풀라`}고 상소했다.`, c.attacker === p.id || c.target === p.id ? 'player' : 'court');
}

/* ═════════════ 5. 옥사(獄事) ═════════════
 * 역모 고변이 들어오면 위관(委官)이 옥사를 다스린다. 위관을 쥔 당은 상대 당 사람들을 엮어 넣는다.
 */

/** 위관이 될 만한 이: 현직 정승(중추부의 허직은 빼고)이나 형조판서 가운데, 조정을 쥔 당 사람 */
function judgePool(s: GameState, exclude: Set<string>): Character[] {
  const share = powerShare(s);
  return people(s)
    .filter((c) => c.status === 'active' && c.office && !exclude.has(c.id) && !OFFICE_MAP[c.office]?.sinecure && (OFFICE_MAP[c.office]?.rank === 1 || c.office === 'hyeongjo'))
    .sort((a, b) => (share[b.faction] ?? 0) - (share[a.faction] ?? 0));
}

export function startOksa(s: GameState, accused: Character, by?: string, fabricated = false) {
  if (s.oksa || !alive(accused)) return;
  s.flags.oksaAt = s.t;
  const f = accused.faction;
  // 위관: 정승 가운데, 조정을 쥔 당 사람이 맡는다
  const judges = judgePool(s, new Set([accused.id]));
  const p = P(s);
  s.oksa = { accused: accused.id, faction: f, due: s.t + 1, by, fabricated, judge: judges.find((c) => !isP(s, c))?.id };
  log(s, `[옥사] ${FACTION_META[f].name} ${josa(accused.name, '이/가')} 역모를 꾀했다는 고변이 들어왔다. 도성에 국청(鞫廳)이 열렸다.`, 'history');
  s.tension = clamp(s.tension + 8, 0, 100);
  if (judges.some((c) => isP(s, c)) && !isP(s, accused)) pushEvent(s, 'oksa_judge', {});
  else if (isP(s, accused)) pushEvent(s, 'oksa_accused', {});
}

function tickOksa(s: GameState) {
  // 긴장이 높고 왕이 한 당을 몹시 꺼리면, 그 당에서 역모 고변이 나오기도 한다
  if (!s.oksa && s.t >= 24 && s.tension >= 35 && monthsSince(s, 'oksaAt') >= 72 && chance(s, 0.004 + (s.tension - 35) / 2500)) {
    const f = activeFactions(s).sort((a, b) => (s.king.lean[a] ?? 0) - (s.king.lean[b] ?? 0))[0];
    const pool = f ? members(s, f).filter((c) => !isP(s, c) && (c.status === 'retired' || c.traits.includes('radical'))) : [];
    const a = pool.length ? pick(s, pool) : undefined;
    if (a) {
      s.flags.oksaAt = s.t;
      startOksa(s, a);
    }
  }
  const o = s.oksa;
  if (!o || s.t < o.due) return;
  const acc = s.chars[o.accused];
  // 위관이 죽거나, 귀양 가거나, 자리에서 물러나거나, 옥사에 연루되면 다른 대신이 위관을 이어받는다
  const busy = new Set([o.accused, ...(o.queue ?? []).map((q) => q.id), ...Object.keys(o.done ?? {})]);
  const cur = o.judge ? s.chars[o.judge] : undefined;
  if (o.judge && (!alive(cur) || cur.status !== 'active' || busy.has(o.judge))) {
    const next = judgePool(s, busy).find((c) => !isP(s, c));
    const why = !alive(cur) ? '세상을 떠나' : cur.status === 'exiled' ? '귀양을 가서' : busy.has(o.judge) ? '옥사에 연루되어' : '자리에서 물러나';
    o.judge = next?.id;
    log(s, `[옥사] 위관 ${josa(cur?.name ?? '', '이/가')} ${why} ${next ? `${josa(next.name, '이/가')} 위관을 이어받았다` : '국청을 맡을 대신이 없다'}.`, 'history');
    if (cur && isP(s, cur) && alive(cur)) notice(s, '위관에서 물러남', '더는 국청을 맡지 못하게 되었다. 다른 대신이 위관을 이어받는다.', 'court');
  }
  const judge = o.judge ? s.chars[o.judge] : undefined;
  // 첫 국문 전에: 꾸며 낸 고변이면 무고가 드러나기도 한다
  if (!o.queue) {
    if (o.fabricated && chance(s, o.cleared ? 0.9 : 0.25)) {
      s.oksa = undefined;
      log(s, `[옥사] ${acc?.name ?? ''}의 역모는 꾸며 낸 괘서에서 비롯된 무고로 드러났다. 국청이 끝났다.`, 'history');
      if (o.by && s.chars[o.by]) {
        const framer = s.chars[o.by];
        if (isP(s, framer)) {
          exile(s, framer);
          framer.exileLevel = 2;
          notice(s, '무고가 드러나다', '당신이 붙인 괘서가 무고로 드러났다. 위리안치되었다.', 'danger');
        } else exile(s, framer);
      }
      return;
    }
    // 옥사의 강도: 위관이 넓히기로 했으면 3, 수괴만 다스리기로 했으면 1, 그 밖에는 위관의 당색과 긴장이 정한다
    let sev = o.harsh === true ? 3 : o.harsh === false ? 1 : judge && topOf(judge.faction) !== topOf(o.faction) && !judge.traits.includes('mild') ? 2 : 1;
    if (o.harsh === undefined && s.tension >= 70) sev = Math.min(3, sev + 1);
    o.sev = sev;
    o.queue = [{ id: o.accused, depth: 0 }];
    o.done = {};
    o.month = 0;
    log(s, `[옥사] 국문이 시작되었다. ${['', '수괴만 다스리려는 기색이다.', '위관이 연루자를 캐려 한다.', '위관이 역당의 뿌리를 뽑으려 한다. 피바람이 불 것이다.'][sev]}`, 'history');
  }
  const sev = o.sev ?? 1;
  o.month = (o.month ?? 0) + 1;
  const lines: string[] = [];
  const cap = [0, 4, 9, 15][sev];
  const maxDepth = sev;
  const taken = () => Object.keys(o.done ?? {}).length + (o.queue?.length ?? 0);
  const n = Math.min(o.queue!.length, 1 + sev);
  const batch = o.queue!.splice(0, n);
  for (const item of batch) {
    const c = s.chars[item.id];
    if (!alive(c) || c.status === 'exiled') {
      o.done![item.id] = '빠짐';
      continue;
    }
    // 플레이어는 스스로 공초를 올린다
    if (isP(s, c)) {
      o.done![c.id] = '플레이어';
      pushEvent(s, 'oksa_implicated', { judge: judge?.id, sev, by: item.by });
      continue;
    }
    const foeJudge = judge && topOf(judge.faction) !== topOf(c.faction) ? 1 : 0;
    const plead = o.pleaded?.includes(c.id) ? 2 : 0;
    const roll =
      d6(s) + Math.floor(c.politics / 2) + (c.traits.includes('clean') ? 1 : 0) + (c.traits.includes('loyal') ? 1 : 0) + (c.traits.includes('cautious') ? 1 : 0) - (c.traits.includes('timid') ? 1 : 0) - (sev - 1) - foeJudge + plead + (c.historical ? 2 : 0);
    const head = item.depth === 0;
    // 국문을 이기지 못하면 이름을 분다
    const names = (k: number): string[] => {
      if (item.depth >= maxDepth || taken() >= cap) return [];
      // 이번 달 국문 차례를 기다리는 이도 이미 끌려온 사람이다
      const queued = new Set([...(o.queue ?? []).map((x) => x.id), ...batch.map((x) => x.id), ...Object.keys(o.done ?? {})]);
      const pool = people(s).filter((x) => !queued.has(x.id) && x.id !== c.id && x.id !== o.judge && x.status !== 'exiled' && x.status !== 'royal' && (topOf(x.faction) === topOf(c.faction) || x.clan === c.clan));
      const out: string[] = [];
      for (let i = 0; i < k && pool.length && taken() < cap; i++) {
        const w = pool.map((x) => [x, Math.max(0.5, 10 + opinion(s, c, x) / 5 + (x.clan === c.clan ? 8 : 0) + (judge ? -opinion(s, judge, x) / 10 : 0) + (x.rank <= 3 ? 3 : 0))] as [Character, number]);
        const total = w.reduce((a, [, v]) => a + v, 0);
        let r = rand(s) * total;
        let got = w[0][0];
        for (const [x, v] of w) {
          r -= v;
          if (r <= 0) {
            got = x;
            break;
          }
        }
        pool.splice(pool.indexOf(got), 1);
        o.queue!.push({ id: got.id, depth: item.depth + 1, by: c.id });
        out.push(got.name);
      }
      return out;
    };
    if (!head && roll <= sev - 2) {
      const told = sev >= 2 && chance(s, 0.5) ? names(1) : [];
      kill(s, c, '국문을 받다가 형장 아래 물고(物故)되었다');
      o.done![c.id] = '물고';
      lines.push(`${c.name}${told.length ? `(${josa(told.join('·'), '을/를')} 불고)` : ''} 물고`);
    } else if (roll <= 4 || head) {
      // 수괴는 강도만큼, 버티지 못한 연루자는 1~강도만큼 분다
      const told = names(head ? sev : randInt(s, 1, sev));
      if (head || (sev >= 3 && chance(s, 0.2))) {
        kill(s, c, head ? '역모의 수괴로 몰려 복주(伏誅)되었다' : '역모에 연루되어 사사되었다');
        o.done![c.id] = '사형';
        lines.push(told.length ? `${josa(c.name, '이/가')} ${josa(told.join('·'), '을/를')} 불고 ${head ? '복주' : '사사'}` : `${c.name} ${head ? '복주' : '사사'}`);
      } else {
        exile(s, c, judge?.id);
        o.done![c.id] = '유배';
        lines.push(told.length ? `${josa(c.name, '이/가')} ${josa(told.join('·'), '을/를')} 불고 유배` : `${c.name} 유배`);
      }
    } else if (roll <= 6) {
      exile(s, c, judge?.id);
      o.done![c.id] = '유배';
      lines.push(`${josa(c.name, '은/는')} 끝내 불지 않았으나 유배`);
    } else {
      o.done![c.id] = '방면';
      lines.push(`${josa(c.name, '은/는')} 혐의를 벗고 방면`);
    }
  }
  if (lines.length) log(s, `[옥사] 국문 ${o.month}달째: ${lines.join(', ')}.`, 'history');

  // 플레이어와 가까운 이가 끌려오면 구명할지 묻는다
  const p = P(s);
  const friend = (o.queue ?? []).map((x) => s.chars[x.id]).find((x) => x && !isP(s, x) && !o.pleaded?.includes(x.id) && opinion(s, x, p) >= 20);
  if (friend && alive(p) && p.status !== 'exiled' && inCourt(p) && s.pending.length < 2) pushEvent(s, 'oksa_friend', { who: friend.id });
  // 위관인 플레이어는 옥사가 번질 때 더 캘지 정한다
  if (judge && isP(s, judge) && o.month === 2 && (o.queue?.length ?? 0) > 0 && s.pending.length < 2) pushEvent(s, 'oksa_widen', {});

  if ((o.queue?.length ?? 0) > 0 && o.month < 8) {
    o.due = s.t + 1;
    return;
  }
  // 국청이 끝난다
  s.oksa = undefined;
  const done = Object.values(o.done ?? {});
  const dead = done.filter((x) => x === '물고' || x === '사형').length;
  const exiled = done.filter((x) => x === '유배').length;
  const freed = done.filter((x) => x === '방면').length;
  kingLean(s, o.faction, -5 * sev);
  s.tension = clamp(s.tension + 3 * sev, 0, 100);
  if (judge && o.faction !== 'none' && sev >= 2) swayFaction(s, o.faction, judge.id, -8 * sev, '옥사의 원한', 0.03);
  log(s, `[옥사] 국청이 끝났다. ${o.month}달 동안 ${done.length}명이 국문을 받아 ${dead}명이 죽고 ${exiled}명이 유배되었으며 ${freed}명이 풀려났다.${judge ? ` (위관 ${judge.name})` : ''}`, 'history');
  if (judge && isP(s, judge)) pres(p, sev >= 3 ? -3 : sev <= 1 ? 3 : 0);
}


/* ═════════════ 환국의 여파: 쫓겨난 당을 석 달 동안 몰아친다 ═════════════ */
function tickHwangukAfter(s: GameState) {
  const v = s.flags.hwangukAfter;
  if (typeof v !== 'string') return;
  const [f, at] = v.split(':') as [FactionId, string];
  const m = s.t - Number(at);
  if (m < 1) return;
  if (m > 3 || !s.factions[f]?.active) {
    delete s.flags.hwangukAfter;
    return;
  }
  const fname = FACTION_META[f].name;
  const p = P(s);
  const left = members(s, f).filter((c) => c.status === 'active' && c.office && OFFICE_MAP[c.office] && !OFFICE_MAP[c.office].sinecure).sort((a, b) => OFFICE_MAP[a.office!].rank - OFFICE_MAP[b.office!].rank);
  if (m === 1) {
    // 새로 들어온 삼사가 잔당을 논핵한다
    const tgt = left.find((c) => !isP(s, c));
    const atk = people(s).find((c) => c.status === 'active' && c.office && OFFICE_MAP[c.office]?.samsa && topOf(c.faction) !== topOf(f) && !isP(s, c));
    if (tgt && atk) {
      openCase(s, atk, tgt, { bonus: 2 });
      log(s, `[환국] 여파: 새로 들어온 삼사가 ${fname}의 잔당 ${josa(tgt.name, '을/를')} 논핵하기 시작했다.`, 'history');
    }
    return;
  }
  if (m === 2) {
    // 남은 자리에서도 물러난다
    const out: string[] = [];
    for (const c of left.slice(0, 2)) {
      if (isP(s, c)) {
        if (chance(s, 0.3)) {
          vacate(s, c);
          notice(s, '환국의 여파', `${fname}을 몰아내는 바람이 당신에게도 닿았다. 자리에서 물러났다.`, 'danger');
          out.push(c.name);
        }
        continue;
      }
      vacate(s, c);
      out.push(c.name);
    }
    if (out.length) log(s, `[환국] 여파: ${fname}의 ${out.join('·')} 등이 남은 자리에서마저 물러났다.`, 'history');
    return;
  }
  // 석 달째: 영수를 처분하고, 긴장이 높으면 옥사로 번진다
  const lead = s.chars[s.factions[f].leader ?? ''];
  if (lead && alive(lead) && !isP(s, lead) && lead.status !== 'exiled' && chance(s, 0.4)) {
    exile(s, lead);
    log(s, `[환국] 여파: ${fname}의 영수 ${josa(lead.name, '이/가')} 귀양을 갔다.`, 'history');
  }
  if (!s.oksa && s.tension >= 55 && chance(s, 0.3)) {
    const pool = members(s, f).filter((c) => !isP(s, c) && alive(c) && c.status !== 'exiled');
    if (pool.length) {
      log(s, `[환국] 여파: ${fname}을 노리는 역모 고변이 들어왔다.`, 'history');
      startOksa(s, pick(s, pool));
    }
  }
  delete s.flags.hwangukAfter;
}

/* ═════════════ 6. 왕의 탕평과 견제 ═════════════ */

function tickTangpyeong(s: GameState) {
  const share = powerShare(s);
  const f = activeFactions(s).find((x) => (share[x] ?? 0) > 0.55);
  if (!f || monthsSince(s, 'tangpyeongAt') < 18 || !chance(s, 0.06)) return;
  s.flags.tangpyeongAt = s.t;
  const p = P(s);
  const lead = s.chars[s.factions[f].leader ?? ''];
  if (alive(lead) && isP(s, lead) && inCourt(p)) {
    pushEvent(s, 'king_warning', { faction: f });
    return;
  }
  // 탕평 인사: 그 당의 판서 하나를 갈고 소수당 사람을 앉힌다
  const hm = holderMap(s);
  const seats = OFFICES.filter((o) => o.rank === 2 && hm[o.id]?.faction === f);
  const seatO = seats.length ? seats.sort((a, b) => (hm[a.id].favor ?? 0) - (hm[b.id].favor ?? 0))[0] : undefined;
  if (!seatO) return;
  const out = hm[seatO.id];
  const minority = activeFactions(s).filter((x) => x !== f).sort((a, b) => (share[a] ?? 0) - (share[b] ?? 0))[0];
  const cand = people(s)
    .filter((c) => c.faction === minority && !isP(s, c) && eligible(s, c, seatO))
    .sort((a, b) => appointParts(s, b, seatO, hm).reduce((x, y) => x + y.value, 0) - appointParts(s, a, seatO, hm).reduce((x, y) => x + y.value, 0))[0];
  if (!cand) return;
  if (isP(s, out) && out.favor >= 60) return;
  vacate(s, out);
  appoint(s, cand, seatO.id, true);
  kingLean(s, minority, 6);
  log(s, `[탕평] 왕이 ${FACTION_META[f].name}의 독주를 누르려 ${seatO.name} ${josa(out.name, '을/를')} 갈고 ${FACTION_META[minority].name} ${josa(cand.name, '을/를')} 앉혔다.`, isP(s, out) ? 'player' : 'court');
  if (isP(s, out)) notice(s, '탕평 인사', `왕이 ${FACTION_META[f].name}의 독주를 누르려 당신을 ${seatO.name}에서 갈았다.`, 'danger');
}

export function tickStrife(s: GameState) {
  tickHwangukAfter(s);
  checkSuccession(s);
  tickWings(s);
  tickYusaeng(s);
  tickOksa(s);
  tickTangpyeong(s);
}

/** 영수 자리가 잠겨 있으면 updateLeaders가 바꾸지 못한다 */
export const leaderLocked = (s: GameState, f: FactionId) => {
  const st = s.factions[f];
  const l = st.leader ? s.chars[st.leader] : undefined;
  return (st.lockUntil ?? 0) > s.t && alive(l) && l.faction === f && l.status !== 'exiled';
};

/* ═════════════ 사건 ═════════════ */

export const STRIFE_EVENTS: Record<string, EventDef> = {
  succession_contest: {
    build(s, c) {
      const st = s.factions[c.faction as FactionId];
      const ct = st.contest;
      const p = P(s);
      if (!ct) return { title: '영수 승계', text: '다툼은 이미 끝났다.', choices: [{ key: 'ok', label: '확인' }] };
      const cands = ct.cands.map((id) => s.chars[id]);
      const self = cands.some((x) => isP(s, x));
      return {
        title: `${FACTION_META[c.faction as FactionId].name}의 후계 다툼`,
        kind: 'court',
        text: `영수 자리를 두고 ${cands.map((x) => `${x.name}(${WING_NAME[wingOf(s, x)]}, 영향력 ${influence(s, x)}, 지지 ${ct.backers[x.id]?.length ?? 0}명)`).join('과 ')}이 맞섰다. 석 달 뒤에 판가름 난다.${self ? '\n\n당신도 후보다. 당원들을 찾아다니며 지지를 모으라.' : ''}`,
        choices: self
          ? [
              { key: 'campaign', label: '당원들을 찾아다닌다', hint: '행동력과 별개로 정치력 판정. 성공하면 지지 +3' },
              { key: 'yield', label: '자리를 양보한다', hint: '상대가 영수가 되고 그가 신세를 진다. 명망 +2' },
            ]
          : cands.map((x) => ({ key: x.id, label: `${josa(x.name, '을/를')} 민다`, hint: `${WING_NAME[wingOf(s, x)]}. 그가 이기면 신세를 지고, 지면 이긴 쪽의 미움을 산다.` })),
      };
    },
    resolve(s, c, key) {
      const f = c.faction as FactionId;
      const ct = s.factions[f].contest;
      const p = P(s);
      if (!ct) return;
      if (key === 'campaign') {
        const r = d6(s) + p.politics;
        if (r >= 8) {
          const mine = ct.backers[p.id] ?? (ct.backers[p.id] = []);
          const others = ct.cands.find((id) => id !== p.id)!;
          const flip = (ct.backers[others] ?? []).splice(0, 3);
          mine.push(...flip);
          return `당원들을 설득했다. (판정 ${r}, 지지 +${flip.length})`;
        }
        return `발품만 팔았다. (판정 ${r})`;
      }
      if (key === 'yield') {
        const other = ct.cands.find((id) => id !== p.id)!;
        ct.cands = [other, other];
        owe(s, other);
        pres(p, 2);
        return `${s.chars[other].name}에게 영수 자리를 양보했다. 그가 신세를 졌다.`;
      }
      if (!ct.backers[key]) return;
      ct.backers[key].push(p.id);
      return `${josa(s.chars[key].name, '을/를')} 밀기로 했다.`;
    },
  },

  jadae: {
    build(s, c) {
      const cands = (c.cands as string[]).map((id) => s.chars[id]).filter(Boolean);
      return {
        title: '자대(自代) — 후임 전랑',
        kind: 'court',
        text: '이조전랑에서 물러나며 후임을 스스로 천거하는 것이 관례다(자대제). 누구를 앉히느냐에 따라 앞으로 몇 해 동안 청요직의 판이 정해진다.',
        choices: cands.map((x) => ({ key: x.id, label: `${x.name} (${FACTION_META[x.faction].name}, 정치력 ${x.politics} · 학식 ${x.learning})`, hint: '그가 전랑에 오르고 당신에게 신세를 진다. 같은 당이면 당내 호감이 오른다.' })),
      };
    },
    resolve(s, _c, key) {
      delete s.flags.reserve_jeonrang;
      const x = s.chars[key];
      const p = P(s);
      if (!alive(x) || !eligible(s, x, OFFICE_MAP.jeonrang)) return '그는 이제 그 자리에 오를 수 없다.';
      appoint(s, x, 'jeonrang');
      owe(s, x.id);
      if (x.faction === p.faction && p.faction !== 'none') swayFaction(s, p.faction, p.id, 3, '청요직을 지킴', 0.1);
      return `${josa(x.name, '이/가')} 당신의 자대로 이조전랑이 되었다. 그가 신세를 졌다.`;
    },
  },

  yusaeng: {
    build(s, c) {
      const cs = s.cases.find((x) => x.id === c.caseId);
      const tgt = cs ? s.chars[cs.target] : undefined;
      return {
        title: '성균관 유생의 상소',
        kind: 'court',
        text: `성균관 유생 수백 명이 ${tgt?.name ?? ''}의 일로 들고일어나 대궐 앞에 엎드리려 한다. 대사성인 당신이 그들을 다독일 수도, 오히려 앞세울 수도 있다.`,
        choices: [
          { key: 'atk', label: '유생들이 탄핵 편에 서게 둔다', hint: '논핵 공격 +2' },
          { key: 'def', label: '유생들이 구원 편에 서게 이끈다', hint: '논핵 방어 +2' },
          { key: 'calm', label: '학문에 힘쓰라며 다독인다', hint: '아무 일도 없다. 성심 +2' },
        ],
      };
    },
    resolve(s, c, key) {
      const cs = s.cases.find((x) => x.id === c.caseId);
      if (key === 'calm' || !cs) {
        fav(P(s), 2);
        return '유생들을 다독여 돌려보냈다.';
      }
      cs.bonus += key === 'atk' ? 2 : -2;
      return `유생들이 대궐 앞에 엎드렸다. (논핵 ${key === 'atk' ? '공격' : '방어'} +2)`;
    },
  },

  oksa_judge: {
    build(s) {
      const o = s.oksa;
      const acc = o ? s.chars[o.accused] : undefined;
      return {
        title: '국청의 위관',
        kind: 'history',
        text: `${FACTION_META[o?.faction ?? 'none'].name} ${acc?.name ?? ''}의 역모 고변으로 국청이 열렸다. 대신으로서 당신이 위관을 맡게 되었다. 이 옥사를 어디까지 넓힐지는 당신의 붓끝에 달렸다.`,
        choices: [
          { key: 'harsh', label: '역당의 뿌리를 뽑는다', hint: '그 당 사람 여럿을 엮어 넣는다. 같은 당 호감 +, 그 당의 깊은 원한, 명망 -3, 긴장 크게 상승' },
          { key: 'narrow', label: '수괴만 다스린다', hint: '명망 +3. 같은 당 강경파가 실망한다' },
          { key: 'probe', label: '고변의 진위부터 캔다', hint: '정치력 판정. 꾸며 낸 고변이면 무고가 드러난다. 진짜면 수괴만 다스린다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const o = s.oksa;
      const p = P(s);
      if (!o) return '';
      o.judge = p.id;
      if (key === 'harsh') {
        o.harsh = true;
        if (p.faction !== 'none' && topOf(p.faction) !== topOf(o.faction)) swayFaction(s, p.faction, p.id, 6, '역당을 다스림', 0.1);
        return '역당의 뿌리를 뽑기로 했다. 국청에 끌려오는 이가 늘어난다.';
      }
      o.harsh = false;
      if (key === 'probe') {
        const r = d6(s) + p.politics;
        if (r >= 8) o.cleared = true;
        if (o.fabricated && r >= 8) return `고변을 캐 보니 수상한 데가 있다. (판정 ${r})`;
        return `고변을 캐 보았다. (판정 ${r})`;
      }
      return '수괴만 다스리기로 했다.';
    },
  },

  oksa_accused: {
    build: () => ({
      title: '역모의 고변',
      kind: 'danger',
      text: '당신이 역모를 꾀했다는 고변이 들어와 국청이 열렸다. 다음 달 국문을 받는다. 정치력과 성심이 당신을 지킨다. 위관이 다른 당 사람이면 더 위험하다.',
      choices: [{ key: 'ok', label: '결백을 호소하며 기다린다' }],
    }),
    resolve() {},
  },

  oksa_implicated: {
    build: (s, c) => {
      const sev = Number(c.sev ?? 2);
      const by = c.by ? s.chars[c.by] : undefined;
      return {
        title: '옥사에 연루되다',
        kind: 'danger',
        text: `국청에서 당신의 이름이 나왔다.${by ? ` 형장을 이기지 못한 ${josa(by.name, '이/가')} 당신을 불었다.` : ''} ${c.judge && s.chars[c.judge] ? `위관은 ${s.chars[c.judge].name}이다.` : ''}\n\n옥사의 기세: ${['', '수괴만 다스리려 한다', '연루자를 캐고 있다', '역당의 뿌리를 뽑으려 한다'][sev] ?? ''}.`,
        choices: [
          { key: 'plead', label: '결백을 밝히는 공초를 올린다', hint: `주사위 + 정치력 + (성심 40 이상이면 2) ≥ ${8 + sev}. 실패하면 유배` },
          { key: 'beg', label: '왕에게 직접 매달린다', hint: `성심 + 주사위×10 ≥ ${50 + sev * 10}이면 살아남는다. 실패하면 위리안치` },
          { key: 'name', label: '살기 위해 동지의 이름을 분다', hint: '70% 확률로 풀려난다. 같은 당이 등을 돌리고(호감 -12) 「동지를 밀고」가 드러난다. 옥사가 더 번진다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const sev = Number(_c.sev ?? 2);
      if (key === 'name') {
        const o = s.oksa;
        const pool = members(s, p.faction).filter((x) => !isP(s, x) && x.status !== 'exiled' && inCourt(x) && !(o?.done?.[x.id]) && !(o?.queue ?? []).some((q) => q.id === x.id));
        const v = pool.length ? pick(s, pool) : undefined;
        if (v && o?.queue) o.queue.push({ id: v.id, depth: 1, by: p.id });
        if (p.faction !== 'none') swayFaction(s, p.faction, p.id, -12, '동지를 불다', 0.05);
        addFlaw(s, p, '동지를 밀고', true);
        if (chance(s, 0.7)) return `${v ? `${josa(v.name, '을/를')} 불었다. ` : ''}풀려났다. 그러나 동지들의 눈빛이 싸늘하다.`;
        exile(s, p);
        return `${v ? `${josa(v.name, '을/를')} 불었지만 ` : ''}끝내 유배를 면하지 못했다.`;
      }
      if (key === 'plead') {
        const r = d6(s) + p.politics + (p.favor >= 40 ? 2 : 0);
        if (r >= 8 + sev) return `공초가 받아들여져 풀려났다. (판정 ${r})`;
        exile(s, p);
        return `연루되어 유배되었다. (판정 ${r} < ${8 + sev})`;
      }
      const r = p.favor + d6(s) * 10;
      if (r >= 50 + sev * 10) {
        fav(p, -5);
        return `왕이 당신을 살려 주었다. (판정 ${r}, 성심 -5)`;
      }
      exile(s, p);
      p.exileLevel = 2;
      return `왕이 외면했다. 위리안치되었다. (판정 ${r})`;
    },
  },

  oksa_friend: {
    build: (s, c) => {
      const f = s.chars[c.who];
      return {
        title: '국청에 끌려온 벗',
        kind: 'danger',
        text: `${josa(f.name, '이/가')} 국청에 끌려왔다. 당신과 가까운 사이다. 다음 국문에서 그가 버티지 못하면 죽거나 귀양을 간다. 그가 당신의 이름을 부를 수도 있다.`,
        choices: [
          { key: 'plead', label: '구명하는 상소를 올린다', hint: `${f.name}의 국문 판정 +2, 그의 호감 +12. 성심 -3. 옥사의 기세가 세면 당신도 엮일 수 있다` },
          { key: 'silent', label: '몸을 사린다', hint: `${f.name}의 호감 -8` },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const f = s.chars[c.who];
      const o = s.oksa;
      if (!o || !alive(f)) return '국청이 이미 끝났다.';
      if (key === 'silent') {
        sway(s, f, p.id, -8, '구명하지 않음', { decay: 0.1 });
        return '몸을 사렸다.';
      }
      (o.pleaded ??= []).push(f.id);
      fav(p, -3);
      sway(s, f, p.id, 12, '국청의 구명', { decay: 0.05 });
      if ((o.sev ?? 1) >= 2 && chance(s, 0.25) && !(o.queue ?? []).some((q) => q.id === p.id) && !o.done?.[p.id]) {
        o.queue?.push({ id: p.id, depth: 1, by: f.id });
        return `${josa(f.name, '을/를')} 구명하는 상소를 올렸다. 그런데 위관이 「역적을 감싸는 자」라며 당신의 이름을 적었다.`;
      }
      return `${josa(f.name, '을/를')} 구명하는 상소를 올렸다. (성심 -3)`;
    },
  },

  oksa_widen: {
    build: (s) => {
      const o = s.oksa!;
      return {
        title: '국청의 갈림길',
        kind: 'history',
        text: `국문이 두 달째다. 지금까지 ${Object.keys(o.done ?? {}).length}명이 국문을 받았고, ${o.queue?.length ?? 0}명이 더 끌려와 있다. 위관인 당신이 정해야 한다. 더 캘 것인가, 이쯤에서 마무리할 것인가.`,
        choices: [
          { key: 'widen', label: '끝까지 캐어 역당을 뿌리 뽑는다', hint: '옥사의 기세가 세진다. 같은 당 호감 +, 맞은 당의 깊은 원한, 명망 -2' },
          { key: 'close', label: '이쯤에서 마무리한다', hint: '이미 끌려온 이들만 다스린다. 명망 +2' },
        ],
      };
    },
    resolve(s, _c, key) {
      const o = s.oksa;
      const p = P(s);
      if (!o) return '국청이 이미 끝났다.';
      if (key === 'widen') {
        o.sev = Math.min(3, (o.sev ?? 1) + 1);
        pres(p, -2);
        if (p.faction !== 'none') swayFaction(s, p.faction, p.id, 4, '역당을 다스림', 0.1);
        return '더 캐기로 했다. 국청 앞에 끌려오는 이들의 줄이 길어진다.';
      }
      o.sev = Math.max(1, (o.sev ?? 1) - 1);
      o.queue = (o.queue ?? []).filter((q) => q.depth <= 1);
      pres(p, 2);
      return '이쯤에서 마무리하기로 했다.';
    },
  },

  king_warning: {
    build: (s, c) => ({
      title: '왕의 부름',
      kind: 'court',
      text: `왕이 ${FACTION_META[c.faction as FactionId].name}의 영수인 당신을 따로 불렀다. "요즘 조정이 한쪽으로 쏠렸다는 말이 많다. 경의 당은 어찌 생각하는가." 말끝에 날이 서 있다.`,
      choices: [
        { key: 'yield', label: '당을 다독여 다른 당 사람도 쓰겠다고 아뢴다', hint: '당론 -20, 왕의 마음 +10, 같은 당 호감 -6' },
        { key: 'stand', label: '조정은 바른 사람이 맡아야 한다고 버틴다', hint: '왕의 마음 -12, 같은 당 호감 +5. 환국 위험이 커진다' },
      ],
    }),
    resolve(s, c, key) {
      const f = c.faction as FactionId;
      const p = P(s);
      if (key === 'yield') {
        s.line[f] = clamp((s.line[f] ?? 0) - 20, -60, 60);
        kingLean(s, f, 10);
        kingMood(s, 4);
        return `당을 다독이겠다고 아뢰었다. 왕이 고개를 끄덕였다. (${swayFaction(s, f, p.id, -6, '왕에게 굽힘', 0.1)})`;
      }
      kingLean(s, f, -12);
      return `물러서지 않았다. 왕이 말없이 붓을 내려놓았다. (${swayFaction(s, f, p.id, 5, '당을 지킴', 0.1)})`;
    },
  },
};

/** 플레이어가 공방에서 통문을 돌린다 */
export function tongmunError(s: GameState): string | null {
  const p = P(s);
  const cs = s.cases.find((c) => c.attacker === p.id || c.target === p.id || c.pros.includes(p.id) || c.cons.includes(p.id));
  if (!cs) return '얽혀 있는 공방이 없다';
  if (cs.tongmun) return '이 공방에는 이미 통문을 돌렸다';
  if (!s.player.built.includes('seowon') && s.player.disciples < 3 && p.prestige < 60) return '서원이 있거나, 문인이 셋 이상이거나, 명망이 60 이상이어야 한다';
  if (s.player.ap < 1) return '행동력이 부족하다';
  return null;
}

export function tongmun(s: GameState): string {
  const err = tongmunError(s);
  if (err) return err;
  const p = P(s);
  const cs = s.cases.find((c) => c.attacker === p.id || c.target === p.id || c.pros.includes(p.id) || c.cons.includes(p.id))! as Case;
  s.player.ap -= 1;
  cs.tongmun = true;
  const attacking = cs.attacker === p.id || cs.pros.includes(p.id);
  cs.bonus += attacking ? 1 : -1;
  return `서원과 향교에 통문을 돌려 사림의 공론을 모았다. (논핵 ${attacking ? '공격' : '방어'} +1)`;
}

