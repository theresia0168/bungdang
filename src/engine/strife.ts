import type { Case, Character, FactionId, GameState } from './types';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP, OFFICES } from './data/offices';
import { yearOf } from './calendar';
import { chance, d6, pick } from './rng';
import { alive, atSeat, clamp, fav, inCourt, isP, josa, log, monthsSince, notice, officeTitle, owe, P, people, pres, pushEvent } from './state';
import { opinion, sway, swayFaction, topOf } from './opinion';
import { activeFactions, influence, members, powerShare } from './factions';
import { kingLean, kingMood } from './king';
import { appoint, appointParts, eligible, holderMap, vacate } from './court';
import { exile, kill } from './conflict';

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
    if (!isCheongyo(o.id)) continue;
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

export function startOksa(s: GameState, accused: Character, by?: string, fabricated = false) {
  if (s.oksa || !alive(accused)) return;
  s.flags.oksaAt = s.t;
  const f = accused.faction;
  // 위관: 정승 가운데, 조정을 쥔 당 사람이 맡는다
  const share = powerShare(s);
  const judges = people(s)
    .filter((c) => c.status === 'active' && c.office && (OFFICE_MAP[c.office]?.rank === 1 || c.office === 'hyeongjo') && c.id !== accused.id)
    .sort((a, b) => (share[b.faction] ?? 0) - (share[a.faction] ?? 0));
  const p = P(s);
  s.oksa = { accused: accused.id, faction: f, due: s.t + 2, by, fabricated, judge: judges.find((c) => !isP(s, c))?.id };
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
  s.oksa = undefined;
  const acc = s.chars[o.accused];
  const judge = o.judge ? s.chars[o.judge] : undefined;
  const p = P(s);
  if (o.fabricated && chance(s, o.cleared ? 0.9 : 0.25)) {
    // 무고가 드러난다
    log(s, `[옥사] ${acc?.name ?? ''}의 역모는 꾸며 낸 괘서에서 비롯된 무고로 드러났다.`, 'history');
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
  const harsh = o.harsh ?? (!!judge && topOf(judge.faction) !== topOf(o.faction) && !judge.traits.includes('mild'));
  if (alive(acc)) {
    if (isP(s, acc)) {
      const r = d6(s) + acc.politics + (acc.favor >= 40 ? 2 : 0) - (harsh ? 3 : 0);
      if (r >= 8) notice(s, '옥사를 벗어나다', `국문 끝에 혐의를 벗었다. (판정 ${r})`, 'personal');
      else {
        exile(s, acc);
        acc.exileLevel = 2;
        notice(s, '역모로 몰리다', `역모의 수괴로 몰려 위리안치되었다. (판정 ${r})`, 'danger');
      }
    } else kill(s, acc, '역모의 수괴로 몰려 국문 끝에 죽었다');
  }
  const caught: string[] = [];
  if (harsh) {
    const pool = members(s, o.faction).filter((c) => c.id !== o.accused && c.status !== 'exiled' && inCourt(c));
    const n = Math.min(pool.length, 2 + Math.floor(s.tension / 30));
    for (const c of pool.sort((a, b) => (judge ? opinion(s, judge, a) - opinion(s, judge, b) : 0)).slice(0, n)) {
      if (isP(s, c)) {
        pushEvent(s, 'oksa_implicated', { judge: judge?.id });
        continue;
      }
      exile(s, c, judge?.id);
      caught.push(c.name);
    }
    kingLean(s, o.faction, -20);
    s.tension = clamp(s.tension + 10, 0, 100);
    if (judge && o.faction !== 'none') swayFaction(s, o.faction, judge.id, -20, '옥사의 원한', 0.03);
  }
  log(s, `[옥사] 국청이 끝났다.${caught.length ? ` 위관 ${judge?.name ?? ''}의 손에 ${caught.join('·')} 등 ${FACTION_META[o.faction].name} 사람들이 연루되어 유배되었다.` : ' 수괴 외에 크게 연루된 이는 없었다.'}`, 'history');
  if (judge && isP(s, judge)) pres(p, harsh ? -3 : 3);
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
      text: '당신이 역모를 꾀했다는 고변이 들어와 국청이 열렸다. 두 달 뒤 국문을 받는다. 정치력과 성심이 당신을 지킨다. 위관이 다른 당 사람이면 더 위험하다.',
      choices: [{ key: 'ok', label: '결백을 호소하며 기다린다' }],
    }),
    resolve() {},
  },

  oksa_implicated: {
    build: (s, c) => ({
      title: '옥사에 연루되다',
      kind: 'danger',
      text: `국청에서 당신의 이름이 나왔다. ${c.judge && s.chars[c.judge] ? `위관 ${josa(s.chars[c.judge].name, '은/는')} 당신과 사이가 좋지 않다.` : ''}`,
      choices: [
        { key: 'plead', label: '결백을 밝히는 공초를 올린다', hint: '주사위 + 정치력 + (성심 40 이상이면 2) ≥ 9. 실패하면 유배' },
        { key: 'beg', label: '왕에게 직접 매달린다', hint: '성심이 높으면 살아남는다 (성심 + 주사위×10 ≥ 60). 실패하면 위리안치' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'plead') {
        const r = d6(s) + p.politics + (p.favor >= 40 ? 2 : 0);
        if (r >= 9) return `공초가 받아들여져 풀려났다. (판정 ${r})`;
        exile(s, p);
        return `연루되어 유배되었다. (판정 ${r})`;
      }
      const r = p.favor + d6(s) * 10;
      if (r >= 60) {
        fav(p, -5);
        return `왕이 당신을 살려 주었다. (판정 ${r}, 성심 -5)`;
      }
      exile(s, p);
      p.exileLevel = 2;
      return `왕이 외면했다. 위리안치되었다. (판정 ${r})`;
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

