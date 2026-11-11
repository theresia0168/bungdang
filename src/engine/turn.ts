import type { GameState } from './types';
import { END_T, monthOf, tOf, yearOf } from './calendar';
import { OFFICE_MAP, salaryOf } from './data/offices';
import { chance, d6, randInt } from './rng';
import { alive, clamp, isP, josa, log, notice, P, pushEvent } from './state';
import { decayMods } from './opinion';
import { checkSplit, updateLeaders } from './factions';
import { fillVacancies, holderOf, settleRaces, tickRaces, turnover } from './court';
import { npcMonth, tickStats } from './npc';
import { collectTaxes, tickRealm, tickWarFront } from './realm';
import { kill } from './conflict';
import { refreshAp, RETAINER_UPKEEP, tickFocus, tickScheme } from './actions';
import { rollAudience, tickKing } from './king';
import { rollHarvest, rollLocal, tickIncidents } from './regions';
import { tickRoyal } from './royal';
import { tickSituations } from './situations';
import { tickBonds, tickSuspicion, tickWants } from './relations';
import { tickPlots } from './plots';
import { tickParty } from './party';
import { rollDuty } from './duties';
import { rollTalent } from './events/intrigue';
import { tickCases } from './cases';
import { rollAgenda } from './agenda';
import { checkGoal } from './goals';
import { EVENTS, rollPersonal, runHistory } from './events';
import { genChar, pickHome, regionFaction } from './generate';
import { checkSuccession } from './succession';
import { updateGuide } from './tutorial';

function income(s: GameState) {
  const p = P(s);
  if (p.status === 'active' && p.office) {
    // 국고가 바닥나면 녹봉이 반으로 깎인다
    p.wealth += (salaryOf(p.rank) * 0.5 + (p.office === 'hojo' ? 2 : 0)) * (s.realm.treasury < 0 ? 0.5 : 1);
  }
  p.wealth += 0.5;
  const pl = s.player;
  if (pl.retainers > 0) {
    p.wealth -= pl.retainers * RETAINER_UPKEEP;
    if (p.wealth < 0) {
      pl.retainers--;
      p.wealth = 0;
      notice(s, '떠나는 식객', `살림이 어려워 식객 하나가 떠났다. (식객 ${pl.retainers}명)`, 'personal');
    }
  }
  p.wealth = Math.round(p.wealth * 10) / 10;
  if (p.favor > 0) p.favor = Math.max(0, p.favor - 0.15);
}

function destinyChecks(s: GameState) {
  const y = yearOf(s.t);
  const m = monthOf(s.t);
  for (const c of Object.values(s.chars)) {
    if (!alive(c) || c.checkMonth !== m || y < c.destiny) continue;
    const pen = y - c.destiny;
    let thr = c.vigor - pen;
    const me = isP(s, c);
    if (me) {
      thr += s.player.doctor;
      if (s.player.sick) thr -= 1;
      s.player.doctor = 0;
    }
    if (s.war.active && s.war.zones.includes(c.location)) thr -= 1;
    const roll = d6(s);
    if (roll > thr) kill(s, c, me ? '천명을 다하여 세상을 떠났다' : '세상을 떠났다');
    else if (me) notice(s, '천명', `천명의 해를 넘겼다. (주사위 ${roll} ≤ 한계 ${thr})\n해마다 한계가 1씩 낮아진다. 명의를 부르면 한계를 올릴 수 있다.`, 'danger');
  }
}

function warTick(s: GameState) {
  const p = P(s);
  const mil = s.flags.militia;
  if (typeof mil === 'number' && mil > s.t && alive(p)) {
    if (chance(s, p.vigor >= 5 ? 0.008 : 0.015)) kill(s, p, '의병을 이끌고 싸우다 전사했다');
  }
  if (!s.war.active) return;
  for (const c of Object.values(s.chars)) {
    if (!alive(c) || c.status === 'royal' || isP(s, c)) continue;
    if (s.war.zones.includes(c.location) && chance(s, 0.004 * (1.3 - s.war.preparedness / 100))) kill(s, c, '전란 중에 목숨을 잃었다');
  }
}

function exam(s: GameState) {
  const y = yearOf(s.t);
  const yejo = holderOf(s, 'yejo');
  const n = randInt(s, 4, 6);
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    const home = pickHome(s);
    let faction = regionFaction(s, home);
    if (yejo && yejo.faction !== 'none' && chance(s, 0.25)) faction = yejo.faction;
    const bias = s.flags.examBias;
    if (typeof bias === 'string' && bias !== 'none' && chance(s, 0.4)) faction = bias as typeof faction;
    const c = genChar(s, { rank: i === 0 ? 6 : 9, age: randInt(s, 22, 38), status: 'active', office: 'nanggwan', faction, home });
    names.push(c.name);
  }
  log(s, `${y}년 식년시가 열렸다. 장원은 ${josa(names[0], '이/가')} 차지했다. 그 밖에 ${names.slice(1).join(', ')} 등이 급제했다.`, 'court');

  const p = P(s);
  const leak = !!s.flags.examLeak;
  delete s.flags.examBias;
  delete s.flags.examLeak;
  const pr: string[] = [];
  for (const id of [...s.player.proteges]) {
    const c = s.chars[id];
    if (!alive(c) || c.status !== 'retired') {
      s.player.proteges = s.player.proteges.filter((x) => x !== id);
      continue;
    }
    const roll = d6(s) + c.learning + 2 + (leak ? 3 : 0);
    if (roll >= 10) {
      c.status = 'active';
      c.office = 'nanggwan';
      c.location = 'hanseong';
      c.tenure = 0;
      c.promotedAt = s.t;
      s.player.proteges = s.player.proteges.filter((x) => x !== id);
      pr.push(`· ${c.name} 급제! 낭관으로 조정에 나간다 (${roll})`);
      log(s, `${josa(p.name, "이/가")} 거둔 제자 ${josa(c.name, '이/가')} 급제했다.`, 'player');
    } else pr.push(`· ${c.name} 낙방 (${roll}, 10 이상 필요). 다음 식년시를 기약한다.`);
  }
  if (pr.length) notice(s, '제자의 과거', `${pr.join('\n')}\n\n급제한 제자는 맹약을 맺은 이처럼 당신이 걸린 공방에 저절로 나선다.`, 'personal');
  const k = Math.min(2, s.player.disciples);
  if (!k) return;
  const lines: string[] = [];
  for (let i = 0; i < k; i++) {
    const roll = d6(s) + randInt(s, 3, 5) + (yejo && yejo.faction === p.faction && p.faction !== 'none' ? 1 : 0) + (leak ? 3 : 0);
    if (roll >= 8) {
      const c = genChar(s, {
        rank: 9,
        age: randInt(s, 22, 32),
        status: 'active',
        office: 'nanggwan',
        faction: p.faction === 'none' ? undefined : p.faction,
        home: p.home,
        school: p.school,
        teacher: p.id,
      });
      s.player.disciples--;
      lines.push(`· ${c.name} 급제 (${roll})`);
      log(s, `${p.name}의 문인 ${josa(c.name, '이/가')} 급제했다.`, 'player');
    } else lines.push(`· 낙방 (${roll}, 8 이상 필요)`);
  }
  notice(s, '문인의 과거', `식년시에 문인 ${k}명이 응시했다.\n\n${lines.join('\n')}\n\n급제한 문인은 스승인 당신을 따른다.`, 'court');
}

export function advanceMonth(s: GameState) {
  if (s.over || s.pending.length) return;
  s.t++;
  if (s.t > END_T) {
    s.t = END_T;
    s.over = { reason: 'timeline', t: s.t };
    return;
  }
  const y = yearOf(s.t);
  const m = monthOf(s.t);
  runHistory(s);
  income(s);
  tickFocus(s);
  tickScheme(s);
  decayMods(s);
  tickKing(s);
  tickRaces(s);
  turnover(s);
  npcMonth(s);
  tickPlots(s);
  tickCases(s);
  fillVacancies(s);
  settleRaces(s);
  tickWants(s);
  tickSuspicion(s);
  tickBonds(s);
  tickParty(s);
  tickRoyal(s);
  tickSituations(s);
  tickRealm(s);
  if (m === 10) collectTaxes(s);
  tickWarFront(s);
  if (m === 1) tickStats(s);
  destinyChecks(s);
  warTick(s);
  if (m === 3 && (y - 1576) % 3 === 0) exam(s);
  const p = P(s);
  if (m === 9) rollHarvest(s);
  tickIncidents(s);
  if (alive(p) && m === 9 && p.status === 'active' && p.office?.startsWith('gamsa_')) pushEvent(s, 'gamsa_tribute', {});
  if (s.player.abroadUntil === s.t && alive(p)) notice(s, '귀국', '사행을 마치고 한성으로 돌아왔다.');
  if (s.flags.mournUntil === s.t && alive(p) && p.status === 'retired')
    notice(s, '탈상(脫喪)', '상을 마쳤다. 이제 거취의 「상경」으로 한성에 올라가 다시 벼슬을 구할 수 있다.', 'personal');
  rollPersonal(s);
  rollAudience(s);
  rollDuty(s);
  rollLocal(s);
  rollTalent(s);
  rollAgenda(s);
  checkGoal(s);
  if (s.factions.dong.active && y >= 1589) s.factions.dong.division += 0.15;
  if (s.t >= tOf(1591, 6)) s.flags.splitReady = true;
  updateLeaders(s);
  checkSplit(s);
  s.tension = clamp(s.tension - (0.3 + s.tension * 0.008), 10, 100);
  for (const c of Object.values(s.chars)) if (c.prestige > 55) c.prestige -= (c.prestige - 55) * 0.01;
  if (p.status === 'active' && p.office) {
    const o = OFFICE_MAP[p.office];
    if (o && o.rank < s.player.peakRank) {
      s.player.peakRank = o.rank;
      s.player.peakOffice = o.name;
    }
  }
  refreshAp(s);
  updateGuide(s);
  checkSuccession(s);
  if (s.over) s.pending = [];
}

export function resolveEvent(s: GameState, eventId: string, key: string): string {
  const i = s.pending.findIndex((e) => e.id === eventId);
  if (i < 0) return '';
  const [e] = s.pending.splice(i, 1);
  const def = EVENTS[e.def];
  const msg = def?.resolve(s, e.ctx, key) ?? '';
  checkSuccession(s);
  if (s.over) s.pending = [];
  return msg;
}
