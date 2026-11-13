import type { Character, FactionId, GameState } from './types';
import { authorityBase, gunmunSway } from './kwanje';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { chance, d6 } from './rng';
import { alive, clamp, fav, inCourt, isP, josa, log, notice, P, people, pres, pushEvent } from './state';
import { activeFactions, members, powerShare } from './factions';
import { swayFaction, topOf } from './opinion';
import { kingLean, kingMood } from './king';
import { appoint, vacate } from './court';
import { exile, kill } from './conflict';
import { warReadiness } from './realm';

/* ───────── 용안과 반정(反正) ─────────
 * 나라 창고가 비고 공명첩을 팔고 어가가 욕을 보면 용안이 어두워지고 왕실의 체통이 떨어진다.
 * 용안이 바닥이면 왕의 마음을 잃은 당의 영수가 군사를 움직일 마음을 먹는다.
 */

export const COUP_LINE = -40;

/** 이달 반정이 꾸며질 확률 */
/** 비변사가 국정을 쥔 시대에는 낮은 왕권이 예사라, 그 바탕에서 더 떨어져야 반정의 기운이 인다 */
const coupLine = (s: GameState) => COUP_LINE + Math.min(0, authorityBase(s));
export const coupRisk = (s: GameState) => (s.king.mood >= coupLine(s) || s.realm.coup ? 0 : (coupLine(s) - s.king.mood) / 900);

export function tickAuthority(s: GameState) {
  const realm = s.realm;
  // 적자와 왕실 경비는 realm.ts가 용안에 반영한다. 여기서는 어가가 겪는 굴욕만 더한다.
  if (s.flags.kingCaptive) kingMood(s, -3);

  if (realm.coup) {
    if (s.t >= realm.coup.due) resolveCoup(s);
    return;
  }
  if (chance(s, coupRisk(s))) plotCoup(s);
}

/** 왕의 마음을 가장 잃은 당이 반정을 꾸민다 */
function plotCoup(s: GameState) {
  const share = powerShare(s);
  const fs = activeFactions(s).filter((f) => f !== 'none' && (share[f] ?? 0) > 0.15);
  if (!fs.length) return;
  const f = fs.sort((a, b) => (s.king.lean[a] ?? 0) - (s.king.lean[b] ?? 0))[0];
  const p = P(s);
  const lead = members(s, f)
    .filter((c) => !isP(s, c) && inCourt(c) && c.politics >= 4)
    .sort((a, b) => b.politics + b.prestige / 20 - (a.politics + a.prestige / 20))[0];
  if (!lead) return;
  s.realm.coup = { faction: f, leader: lead.id, due: s.t + 2 };
  log(s, '[조정] 도성에 심상치 않은 기운이 돈다. 밤마다 대갓집에 무장한 겸인들이 드나든다는 말이 들린다.', 'court');
  if (alive(p) && inCourt(p) && p.status !== 'exiled') pushEvent(s, 'coup_plot', {});
}

function conspirators(s: GameState, f: FactionId, leader: string): Character[] {
  return members(s, f)
    .filter((c) => c.id !== leader && !isP(s, c) && inCourt(c))
    .sort((a, b) => b.politics - a.politics)
    .slice(0, 3);
}

function resolveCoup(s: GameState) {
  const c = s.realm.coup!;
  s.realm.coup = undefined;
  const lead = s.chars[c.leader];
  const p = P(s);
  if (!alive(lead) || !inCourt(lead)) {
    log(s, '[조정] 반정을 꾸미던 무리가 우두머리를 잃고 흩어졌다.', 'court');
    return;
  }
  const fname = FACTION_META[c.faction].name;
  const a = d6(s);
  const b = d6(s);
  const [gA, gD] = gunmunSway(s, c.faction);
  const atk = a + Math.round((COUP_LINE - s.king.mood) / 10) + Math.round((powerShare(s)[c.faction] ?? 0) * 4) + (c.joined ? 1 : 0) + gA;
  const def = b + 4 + Math.round(warReadiness(s).score / 40) + (c.reported ? 4 : 0) + gD;
  const roll = `반정 ${a}→${atk} · 왕실 ${b}→${def}${gA + gD ? ` (도성 군영 대장 ${gA}명이 반정 쪽, ${gD}명이 왕실 쪽)` : ''}`;
  const cons = conspirators(s, c.faction, lead.id);
  if (atk > def) {
    // 반정 성공: 왕은 자리를 지키되 허수아비가 되고, 반정한 당이 조정을 쥔다
    appoint(s, lead, 'yeonguijeong', true);
    for (const x of people(s)) {
      if (x.status !== 'active' || !x.office || topOf(x.faction) === topOf(c.faction)) continue;
      const o = OFFICE_MAP[x.office];
      if (o && o.rank <= 2) vacate(s, x);
    }
    kingMood(s, -30);
    kingLean(s, c.faction, 25);
    s.king.mood = -20;
    s.tension = clamp(s.tension + 20, 0, 100);
    log(s, `[반정] ${fname}의 ${josa(lead.name, '이/가')} 군사를 이끌고 궐에 들어가 왕을 핍박하고 조정을 쥐었다. 반대편 대신들이 모두 쫓겨났다. (${roll})`, 'history');
    if (c.joined) {
      fav(p, -10);
      pres(p, 4);
      notice(s, '반정 성공', `반정이 성공했다. 당신은 공신의 반열에 올랐다. 다만 왕은 당신을 결코 잊지 않을 것이다. (${roll})`, 'danger');
    } else if (topOf(p.faction) !== topOf(c.faction) && p.status !== 'exiled') {
      notice(s, '반정', `${fname}이 반정으로 조정을 쥐었다. 반대편에 섰던 이들이 모두 밀려난다. (${roll})`, 'danger');
    }
    return;
  }
  // 반정 실패: 역모로 다스린다
  kill(s, lead, '반정을 꾀하다 붙잡혀 사사되었다');
  for (const x of cons) if (chance(s, 0.6)) exile(s, x);
  kingLean(s, c.faction, -25);
  kingMood(s, 20);
  s.tension = clamp(s.tension + 15, 0, 100);
  log(s, `[역모] ${fname} ${lead.name} 일당의 반정 기도가 발각되어 옥사가 일어났다. (${roll})`, 'history');
  if (c.joined) {
    exile(s, p);
    p.exileLevel = 2;
    notice(s, '역모에 연루되다', `반정이 실패했다. 가담한 당신도 붙잡혀 위리안치되었다. (${roll})`, 'danger');
  } else if (c.reported) {
    fav(p, 15);
    pres(p, 2);
    notice(s, '고변의 공', `당신의 고변으로 역모를 미리 막았다. 왕이 크게 고마워한다. (${roll}, 성심 +15)`, 'personal');
  }
}

export const COUP_EVENTS: Record<string, EventDef> = {
  coup_plot: {
    build(s) {
      const c = s.realm.coup;
      const lead = c ? s.chars[c.leader] : undefined;
      const p = P(s);
      const mine = !!c && topOf(p.faction) === topOf(c.faction);
      const fname = c ? FACTION_META[c.faction].name : '';
      return {
        title: '반정의 기운',
        kind: 'danger',
        text: c && lead
          ? `나라 창고가 비고 왕실의 체통이 땅에 떨어지자, ${fname}의 ${josa(lead.name, '이/가')} 은밀히 군사를 모은다는 사실을 알게 되었다. ${mine ? '그가 당신에게도 손을 내밀었다.' : '당신과는 다른 당의 일이다.'} 두 달 안에 일이 벌어진다.\n\n(용안 ${Math.round(s.king.mood)})`
          : '도성의 기운이 가라앉았다.',
        choices: !c
          ? [{ key: 'silent', label: '확인' }]
          : [
              ...(mine ? [{ key: 'join', label: '반정에 가담한다', hint: '성공하면 공신이 되지만 왕의 원한을 산다. 실패하면 위리안치. 반정 쪽 주사위 +1.' }] : []),
              { key: 'report', label: '왕에게 고변한다', hint: `왕실 쪽 주사위 +4. 막아내면 성심 +15. ${mine ? '같은 당이 등을 돌린다 (-20).' : `${fname}의 원한을 산다 (-10).`}` },
              { key: 'silent', label: '모르는 척한다' },
            ],
      };
    },
    resolve(s, _c, key) {
      const c = s.realm.coup;
      if (!c) return;
      const p = P(s);
      if (key === 'join') {
        c.joined = true;
        return '반정에 이름을 올렸다. 이제 돌이킬 수 없다.';
      }
      if (key === 'report') {
        c.reported = true;
        const fx = swayFaction(s, c.faction, p.id, topOf(p.faction) === topOf(c.faction) ? -20 : -10, '역모를 고변함', 0.04);
        return `은밀히 입궐해 역모를 고변했다.${fx ? ` (${fx})` : ''}`;
      }
      return '입을 다물고 지켜보기로 했다.';
    },
  },
};
