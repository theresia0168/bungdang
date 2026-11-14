/**
 * 백테스트 봇의 성향. bt10.ts가 쓴다.
 *  passive  업무와 학문만 한다 (예전 봇)
 *  attack   정적의 흠을 캐고 탄핵(사주)·괘서를 쓴다
 *  social   교유·선물·혼담·맹약·연명 요청으로 사람을 모은다
 *  landlord 땅을 사 모으고 가문 사업을 한다
 *  sallim   학문·강학·서원·문집에 힘쓴다
 */
import type { Character, GameState } from '../src/engine/types';
import { P, people, inCourt } from '../src/engine/state';
import { actionError, landPrice, MONTHLY, monthlyError, runMonthly, runTargetAction, TARGET_ACTIONS, type MonthlyId, type TargetActionId } from '../src/engine/actions';
import { opinion, topOf } from '../src/engine/opinion';
import { leadError, runLead, type LeadId } from '../src/engine/party';

export type Profile = 'passive' | 'attack' | 'social' | 'landlord' | 'sallim';
export const PROFILES: Profile[] = ['passive', 'attack', 'social', 'landlord', 'sallim'];

/** 성향마다 고르는 선택지 (먼저 나온 것을 먼저 고른다) */
export const PREF: Record<Profile, string[]> = {
  passive: ['follow', 'accept', 'explain', 'yes', 'silent', 'calm', 'obey', 'king', 'hold', 'sit', 'office'],
  attack: ['hard', 'press', 'accept', 'explain', 'follow', 'yes', 'king', 'office'],
  social: ['accept', 'follow', 'calm', 'explain', 'yes', 'king', 'office'],
  landlord: ['wealth', 'accept', 'follow', 'calm', 'explain', 'cut', 'office'],
  sallim: ['sallim', 'decline', 'calm', 'explain', 'follow', 'silent'],
};

const act = (s: GameState, id: TargetActionId, t: Character) => {
  const a = TARGET_ACTIONS.find((x) => x.id === id);
  if (!a || actionError(s, a, t)) return false;
  runTargetAction(s, id, t.id);
  return true;
};
const mon = (s: GameState, id: MonthlyId) => {
  const a = MONTHLY.find((x) => x.id === id);
  if (!a || monthlyError(s, a)) return false;
  runMonthly(s, id);
  return true;
};

/** 한 달 동안 성향대로 움직인다 */
export function botMonth(s: GameState, prof: Profile) {
  const p = P(s);
  // 유배 중: 책을 짓고, 가르치고, 해배를 청한다 (수동형은 예전처럼 학문만)
  if (p.status === 'exiled' && prof !== 'passive') {
    mon(s, 'exile_appeal') || mon(s, 'exile_teach');
    mon(s, 'exile_write');
    return;
  }
  // 영수가 되면 당을 꾸린다
  if (prof !== 'passive') {
    const order: LeadId[] = prof === 'attack' ? ['lead_slate', 'lead_hard', 'lead_discipline'] : ['lead_slate', 'lead_unite', 'lead_soft'];
    for (const id of order) if (!leadError(s, id)) (runLead(s, id), 0);
  }
  const base = p.status === 'active' ? 'work' : p.status === 'retired' ? 'teach' : 'study';
  if (prof === 'sallim') {
    mon(s, 'study') || mon(s, 'teach');
    mon(s, 'seowon') || mon(s, 'munjip') || mon(s, 'teach');
    return;
  }
  mon(s, base as MonthlyId);
  const court = people(s).filter((c) => c.id !== p.id && inCourt(c));
  if (prof === 'attack') {
    const foes = court.filter((c) => c.faction !== 'none' && topOf(c.faction) !== topOf(p.faction)).sort((a, b) => opinion(s, p, a) - opinion(s, p, b));
    const foe = foes[0];
    if (foe) act(s, 'investigate', foe) || act(s, 'impeach', foe) || (s.t % 48 === 7 && act(s, 'placard', foe));
  } else if (prof === 'social') {
    const friends = court.filter((c) => topOf(c.faction) === topOf(p.faction)).sort((a, b) => b.rank - a.rank);
    for (const t of friends.slice(0, 6)) if (act(s, 'visit', t) || act(s, 'gift', t)) break;
    const big = court.filter((c) => c.rank <= 2).sort((a, b) => opinion(s, b, p) - opinion(s, a, p))[0];
    if (big) act(s, 'marriage', big) || act(s, 'pact', big);
  } else if (prof === 'landlord') {
    for (const id of ['jongga', 'heir_edu', 'jokbo', 'uijang', 'jinhyul'] as MonthlyId[]) if (p.wealth > 160 && mon(s, id)) break;
    if (p.wealth >= landPrice(s) + 30) mon(s, 'buy_land');
  }
  mon(s, 'study');
}
