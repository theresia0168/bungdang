import { appealBoost } from './exile';
import type { Character, FactionId, GameState } from './types';
import { OFFICE_MAP } from './data/offices';
import { FLAW_POOL } from './data/meta';
import { chance, pick, weighted } from './rng';
import { addFlaw, alive, atSeat, chargeable, clamp, hiddenFlaws, impeachEtiquette, inCourt, isP, josa, log, monthsSince, notice, P, people, pushEvent, seat } from './state';
import { yearOf } from './calendar';
import { LAW_MAP, lawJosa, lawToPush } from './laws';
import { openLawDebate } from './agenda';
import { FACTION_META } from './data/meta';
import { inLaws, opinion, topOf } from './opinion';
import { activeFactions, members } from './factions';
import { memorial, recall } from './conflict';
import { holderOf } from './court';
import { caseOn, openCase, sideOf, openByProxy, proxyFor, usesProxy } from './cases';
import { bondWith } from './relations';
import { startPlot } from './plots';

const samsa = (c: Character) => !!(c.office && OFFICE_MAP[c.office]?.samsa);

function pickAttacker(s: GameState, f: FactionId): Character | undefined {
  const pool = members(s, f).filter(
    (c) => (c.status === 'active' || c.status === 'idle') && atSeat(s, c) && c.politics >= 2 && !isP(s, c),
  );
  return weighted(
    s,
    pool.map((c) => [c, (samsa(c) ? 3 : 1) + (c.traits.includes('radical') ? 1.5 : 0) - (c.traits.includes('mild') ? 0.5 : 0)] as [Character, number]),
  );
}

function pickTarget(s: GameState, atk: Character, sameFaction: boolean): Character | undefined {
  const p = P(s);
  const pool = people(s).filter((c) => {
    if (c.status !== 'active' || !c.office || !OFFICE_MAP[c.office] || c.id === atk.id) return false;
    if (impeachEtiquette(atk, c, samsa(atk))) return false;
    if (c.id === p.id && (bondWith(s, atk.id) || s.plots.some((x) => x.by === atk.id))) return false;
    if (sameFaction) return c.faction === atk.faction && c.lean !== atk.lean;
    return c.faction !== atk.faction && !(topOf(c.faction) === topOf(atk.faction) && s.factions.dong.active);
  });
  return weighted(
    s,
    pool
      .filter((c) => !caseOn(s, c.id))
      .map((c) => {
        const known = chargeable(s, c, atk.id).length;
        let w = OFFICE_MAP[c.office!].weight + known * 3;
        // 얼마 전에 논핵을 치른 사람은 한동안 건드리지 않는다
        if (monthsSince(s, `caseOn_${c.id}`) < 12) w *= 0.3;
        if (atk.grudges.includes(c.id)) w += 8;
        const op = opinion(s, atk, c);
        if (op < -30) w += 3;
        if (c.id === p.id && op < -30) w += 4;
        if (c.faction === 'none') w -= 1;
        // 이길 만한 상대를 고른다
        const edge = atk.politics + known + (samsa(atk) ? 1 : 0) - c.politics - Math.floor(c.prestige / 25) - (c.favor >= 20 ? 1 : 0);
        const odds = edge >= 0 ? 1 : edge >= -2 ? 0.3 : 0.05;
        return [c, Math.max(0.5, w) * odds] as [Character, number];
      }),
  );
}

/** NPC가 논핵을 연다. 대신이면 같은 당 대간을 시키고, 그 대간이 플레이어면 부탁해 온다 */
export function npcOpen(s: GameState, atk: Character, tgt: Character, opt: { bonus?: number } = {}) {
  if (!usesProxy(atk)) return openCase(s, atk, tgt, opt);
  const proxy = proxyFor(s, atk, tgt, true);
  if (!proxy) return impeachEtiquette(atk, tgt, false) ? undefined : openCase(s, atk, tgt, opt);
  if (isP(s, proxy)) {
    if (s.pending.length < 3 && !s.pending.some((e) => e.def === 'saju_request')) pushEvent(s, 'saju_request', { backer: atk.id, target: tgt.id, bonus: opt.bonus ?? 0 });
    return undefined;
  }
  return openByProxy(s, atk, proxy, tgt, opt);
}

function npcImpeachments(s: GameState) {
  const war = s.war.active ? 0.4 : 1;
  for (const f of activeFactions(s)) {
    const line = 1 + (s.line[f] ?? 0) / 200;
    // 거물들이 제 뜻으로 치는 논핵이 따로 있으니, 무작위로 생기는 논핵은 그만큼 줄인다
    if (!chance(s, (0.03 + s.tension / 800) * war * line * 0.8)) continue;
    const atk = pickAttacker(s, f);
    if (!atk) continue;
    const tgt = pickTarget(s, atk, false);
    if (!tgt) continue;
    if (isP(s, tgt)) startPlot(s, atk);
    else npcOpen(s, atk, tgt);
  }
  const dong = s.factions.dong;
  if (dong.active && dong.division > 8 && chance(s, dong.division / 500)) {
    const atk = pickAttacker(s, 'dong');
    const tgt = atk && pickTarget(s, atk, true);
    if (atk && tgt) {
      if (isP(s, tgt)) startPlot(s, atk);
      else npcOpen(s, atk, tgt);
      dong.division += 2;
    }
  }
}

/** 원수를 유배 보낸 것으로는 모자라 죄를 더하자고 청한다 */
function npcAggravate(s: GameState) {
  const exiles = people(s).filter((c) => c.status === 'exiled' && !caseOn(s, c.id));
  const foeOf = (c: (typeof exiles)[number], line: number) =>
    people(s)
      .filter((x) => !isP(s, x) && inCourt(x) && atSeat(s, x) && x.politics >= 3 && topOf(x.faction) !== topOf(c.faction))
      .map((x) => [x, opinion(s, x, c)] as const)
      .filter(([, v]) => v <= line)
      .sort((a, b) => a[1] - b[1])[0]?.[0];
  // 위리안치된 거물(당상관 이상 출신·영수·왕의 진노를 산 이)에게는 반대 당이 뿌리를 뽑으려 사사를 청한다.
  // 판이 뒤집힌 직후(환국 뒤 한 해)나 정국이 격앙되었을 때만이다
  if (s.tension >= 35 || monthsSince(s, 'lastHwanguk') <= 12) {
    for (const c of exiles) {
      if ((c.exileLevel ?? 1) < 2) continue;
      if (!(c.tags.includes('royalWrath') || c.favor <= -30 || c.rank <= 3 || Object.values(s.factions).some((f) => f.leader === c.id))) continue;
      if (!chance(s, 0.05)) continue;
      const foe = foeOf(c, -20);
      if (foe) {
        openCase(s, foe, c);
        return;
      }
    }
  }
  // 그 밖에는 원수를 유배 보낸 것으로 모자라 위리안치를 청한다
  if (!chance(s, 0.08)) return;
  for (const c of exiles) {
    if ((c.exileLevel ?? 1) >= 2 || !chance(s, 0.3)) continue;
    const foe = foeOf(c, -40);
    if (foe) {
      openCase(s, foe, c);
      return;
    }
  }
}

function npcFlaws(s: GameState) {
  for (const c of people(s)) {
    if (isP(s, c) || c.status === 'exiled') continue;
    const p = 0.004 + (c.traits.includes('greedy') ? 0.008 : 0) - (c.traits.includes('clean') ? 0.003 : 0);
    if (c.status === 'active' && chance(s, p)) addFlaw(s, c, pick(s, FLAW_POOL));
  }
  // 삼사 언관이 정적의 비리를 캐낸다
  if (chance(s, 0.12)) {
    const eyes = people(s).filter((c) => samsa(c) && !isP(s, c));
    const spy = eyes.length ? pick(s, eyes) : undefined;
    if (spy) {
      const marks = people(s).filter((c) => c.faction !== spy.faction && hiddenFlaws(c).some((f) => !f.knownBy.includes(spy.id)));
      const m = marks.length ? pick(s, marks) : undefined;
      if (m) {
        const fl = hiddenFlaws(m).find((f) => !f.knownBy.includes(spy.id))!;
        fl.knownBy.push(spy.id);
        if (isP(s, m) && chance(s, 0.5)) notice(s, '불길한 소문', `삼사의 ${josa(spy.name, '이/가')} 당신의 「${fl.label}」 건을 알게 되었다는 소문이 돈다.`, 'danger');
      }
    }
  }
}

function npcWatchPlayer(s: GameState) {
  const p = P(s);
  const secrets = hiddenFlaws(p);
  if (!secrets.length) return;
  for (const c of people(s)) {
    if (isP(s, c) || c.politics < 3 || c.status === 'exiled') continue;
    if (opinion(s, c, p) > -30) continue;
    if (!chance(s, 0.012)) continue;
    const fl = secrets.find((f) => !f.knownBy.includes(c.id));
    if (!fl) continue;
    fl.knownBy.push(c.id);
    if (chance(s, 0.35)) {
      const who = p.politics >= c.politics ? josa(c.name, '이/가') : '누군가';
      notice(s, '뒤를 캐는 자', `${who} 당신의 행적을 캐고 다닌다는 말이 들린다. 「${fl.label}」 건이 새어 나간 듯하다.`, 'danger');
    }
  }
}

function npcCosignRequests(s: GameState) {
  const p = P(s);
  if (!(p.status === 'active' || p.status === 'idle' || p.status === 'retired')) return;
  if (p.faction === 'none' || s.pending.some((e) => e.def === 'cosign_request')) return;
  if (!chance(s, 0.05)) return;
  const asker = pick(
    s,
    members(s, p.faction).filter((c) => !isP(s, c) && (c.status === 'active' || c.status === 'idle') && opinion(s, c, p) > 0),
  );
  if (!asker) return;
  const exiled = members(s, p.faction).filter((c) => c.status === 'exiled' && !isP(s, c));
  const push = lawToPush(s, p.faction);
  const roll = chance(s, 0.5) ? 'impeach' : exiled.length && chance(s, 0.5) ? 'recall' : push && chance(s, 0.6) ? 'law' : 'sipye';
  if (roll === 'impeach') {
    const tgt = pickTarget(s, asker, false);
    if (!tgt || isP(s, tgt)) return;
    pushEvent(s, 'cosign_request', { initiator: asker.id, topic: 'impeach', target: tgt.id });
  } else if (roll === 'recall') {
    pushEvent(s, 'cosign_request', { initiator: asker.id, topic: 'recall', target: pick(s, exiled).id });
  } else if (roll === 'law' && push) {
    s.flags[`lawPush_${push.lawId}`] = s.t;
    pushEvent(s, 'cosign_request', { initiator: asker.id, topic: 'law', ...push });
  } else {
    pushEvent(s, 'cosign_request', { initiator: asker.id, topic: 'sipye' });
  }
}

/** 당의 중진이 당론에 따라 법을 세우거나 없애자는 상소를 올린다 */
function npcLawMemorials(s: GameState) {
  if (!chance(s, 0.035)) return;
  const f = pick(s, activeFactions(s).filter((x) => x !== 'none'));
  if (!f) return;
  const push = lawToPush(s, f);
  if (!push || monthsSince(s, `lawPush_${push.lawId}`) < 18) return;
  const pool = members(s, f).filter((c) => !isP(s, c) && c.status === 'active' && atSeat(s, c) && c.politics >= 3);
  const init = pool.sort((a, b) => b.politics + b.learning - (a.politics + a.learning))[0];
  if (!init) return;
  s.flags[`lawPush_${push.lawId}`] = s.t;
  const law = LAW_MAP[push.lawId];
  log(s, `[국법] ${FACTION_META[f].name}의 ${josa(init.name, '이/가')} ${lawJosa(law.name, '을/를')} ${push.abolish ? '없애자는' : '세우자는'} 상소를 올렸다.`, 'court');
  const ds = holderOf(s, 'doseungji');
  if (ds && isP(s, ds)) {
    pushEvent(s, 'veto_request', { initiator: init.id, topic: 'law', ...push });
    return;
  }
  openLawDebate(s, init.id, push.lawId, push.abolish);
}

function npcRecallPetitions(s: GameState) {
  if (!chance(s, 0.05)) return;
  const exiled = people(s).filter((c) => c.status === 'exiled' && !isP(s, c) && c.faction !== 'none');
  const tgt = exiled.length ? pick(s, exiled) : undefined;
  if (!tgt) return;
  const allies = members(s, tgt.faction).filter((c) => c.status === 'active' && atSeat(s, c) && !isP(s, c));
  const init = allies.length ? pick(s, allies) : undefined;
  if (!init) return;
  const ds = holderOf(s, 'doseungji');
  if (ds && isP(s, ds)) {
    pushEvent(s, 'veto_request', { initiator: init.id, topic: 'recall', target: tgt.id });
    return;
  }
  const co = allies.filter((c) => c.id !== init.id).slice(0, 3).map((c) => c.id);
  memorial(s, init, 'recall', co, tgt.id);
}

function npcMovement(s: GameState) {
  for (const c of people(s)) {
    if (c.status === 'exiled') {
      // 귀양살이가 길어질수록 사면 논의가 잦아진다 (1년마다 +50%)
      const years = Math.max(0, s.t - (c.exiledAt ?? s.t)) / 12;
      const p = ((isP(s, c) ? 0.015 : 0.012) / ((c.exileLevel ?? 1) >= 2 ? 2 : 1)) * (1 + years * 0.5);
      const boost = isP(s, c) ? appealBoost(s) : 1;
      if (chance(s, (s.war.active ? p * 2.5 : p) * boost)) {
        recall(s, c);
        if (isP(s, c)) notice(s, '해배', '왕의 은사로 유배에서 풀려났다. 한성으로 돌아왔다.');
      }
      continue;
    }
    if (isP(s, c)) continue;
    if (c.status === 'retired' && !c.traits.includes('seoeol') && !s.player.proteges.includes(c.id)) {
      const p = c.traits.includes('recluse') ? 0.004 : 0.02;
      if (chance(s, p)) {
        c.status = 'idle';
        c.location = seat(s);
      }
    } else if (c.status === 'idle' && c.rank <= 5 && chance(s, 0.006)) {
      c.status = 'retired';
      c.location = c.home;
    }
  }
}

/** 주변 사람들이 플레이어에게 부탁을 해 온다. 들어주면 신세를 진다. */
function npcRequests(s: GameState) {
  const p = P(s);
  if (p.status === 'exiled' || s.pending.some((e) => e.def.startsWith('req_'))) return;
  if (!chance(s, 0.07)) return;
  const near = (min: number) =>
    people(s).filter((c) => !isP(s, c) && inCourt(c) && c.status !== 'exiled' && opinion(s, c, p) >= min);
  const options: [string, Record<string, any>, number][] = [];

  if (inCourt(p) && atSeat(s, p)) {
    const cs = s.cases.find(
      (x) => x.kind === 'impeach' && !sideOf(x, p.id) && s.t - x.opened <= 1 && !isP(s, s.chars[x.target]) && opinion(s, s.chars[x.target], p) >= 15,
    );
    if (cs) options.push(['req_defend', { caseId: cs.id }, 3]);
  }
  if (p.status === 'active' && (p.office === 'ijo' || p.office === 'jeonrang')) {
    const asker = pick(s, near(10).filter((c) => (s.recs[c.id] ?? -1) < s.t));
    if (asker) options.push(['req_office', { asker: asker.id }, 2]);
  }
  if (p.wealth >= 30) {
    const asker = pick(s, near(30));
    if (asker) options.push(['req_loan', { asker: asker.id }, 0.6]);
  }
  if (s.player.children > 0) {
    const asker = pick(s, near(20).filter((c) => c.clan !== p.clan && !inLaws(s, p.clan, c.clan)));
    if (asker) options.push(['req_marriage', { asker: asker.id }, 1.2]);
  }
  const intelOwner = people(s).find(
    (c) => !isP(s, c) && inCourt(c) && opinion(s, c, p) >= 25 && people(s).some((x) => x.id !== p.id && hiddenFlaws(x).some((f) => !f.knownBy.includes(p.id) && !f.fake)),
  );
  if (intelOwner) options.push(['req_secret', { from: intelOwner.id }, 0.35]);
  if (p.status === 'active' && p.office) {
    const asker = pick(s, near(0).filter((c) => !c.traits.includes('upright')));
    if (asker) options.push(['req_exempt', { asker: asker.id }, 0.7]);
    const kin = pick(s, near(5).filter((c) => c.clan !== p.clan));
    if (kin) options.push(['req_trial', { asker: kin.id }, (['hyeongjo', 'daesaheon', 'jipyeong1', 'jipyeong2', 'jangnyeong1', 'jangnyeong2'].includes(p.office) || p.office.startsWith('gamsa')) ? 1.5 : 0.5]);
  }

  const choice = weighted(s, options.map((o) => [o, o[2]] as [typeof o, number]));
  if (choice) pushEvent(s, choice[0], choice[1]);
}

export function npcMonth(s: GameState) {
  npcImpeachments(s);
  npcAggravate(s);
  npcFlaws(s);
  npcWatchPlayer(s);
  npcCosignRequests(s);
  npcRequests(s);
  npcRecallPetitions(s);
  npcLawMemorials(s);
  npcMovement(s);
  for (const c of people(s)) {
    if (isP(s, c)) continue;
    c.favor = clamp(c.favor + (c.favor > 10 ? -0.2 : c.favor < 10 ? 0.2 : 0), -100, 100);
  }
}

/* ───────── 능력의 부침 ─────────
 * 해마다 정월에 사람들의 정치력·학식이 오르내린다. 자리에서 단련되면 늘고, 물러나 있거나 늙으면 준다.
 */
export function tickStats(s: GameState) {
  const y = yearOf(s.t);
  const p = P(s);
  const lines: string[] = [];
  for (const c of people(s)) {
    const me = isP(s, c);
    const a = y - c.born;
    const up = (k: 'politics' | 'learning', why: string) => {
      if (c[k] >= 8) return;
      c[k]++;
      if (me) lines.push(`${k === 'politics' ? '정치력' : '학식'} +1 (${why})`);
    };
    const down = (k: 'politics' | 'learning', why: string) => {
      if (c[k] <= 1) return;
      c[k]--;
      if (me) lines.push(`${k === 'politics' ? '정치력' : '학식'} -1 (${why})`);
    };
    // 노쇠
    if (a >= 62 && chance(s, 0.12 + (a - 62) * 0.02)) down(chance(s, 0.5) ? 'politics' : 'learning', '노쇠');
    if (me) {
      if (monthsSince(s, 'workAt') > 12 && monthsSince(s, 'socialAt') > 12 && chance(s, 0.35)) down('politics', '세상일에서 멀어짐');
      if (c.learning >= 4 && monthsSince(s, 'studyAt') > 24 && chance(s, 0.3)) down('learning', '학문을 놓음');
      continue;
    }
    if (c.status === 'active' && c.office) {
      const big = OFFICE_MAP[c.office]?.rank ?? 9;
      if (a < 60 && chance(s, big <= 3 ? 0.14 : 0.07)) up('politics', '');
    } else if ((c.status === 'retired' || c.status === 'exiled') && chance(s, 0.12)) down('politics', '');
    if ((c.traits.includes('scholar') || c.traits.includes('writer')) && a < 65 && chance(s, 0.1)) up('learning', '');
    else if (c.status === 'retired' && c.traits.includes('recluse') && chance(s, 0.12)) up('learning', '');
  }
  if (lines.length && alive(p)) notice(s, '한 해를 돌아보며', `지난 한 해 동안 당신의 능력이 달라졌다.\n\n${lines.join('\n')}`, 'personal');
}
