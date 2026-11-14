import type { Character, FactionId, GameState } from './types';
import { kingProfile, vsText, ZEAL_FREQ } from './kingstat';
import { authorityBase, bibyeonPower, bibyeonStage } from './kwanje';
import { legitName, legitOf } from './legit';
import type { EventDef } from './events/types';
import { OFFICE_MAP } from './data/offices';
import { FACTION_META } from './data/meta';
import { chance, d6, randInt } from './rng';
import { monthsSince, alive, atSeat, clamp, inCourt, isP, josa, log, notice, officeTitle, owe, P, people, uid } from './state';
import { sway, swayFaction, topOf } from './opinion';
import { activeFactions, powerShare } from './factions';
import { vacate } from './court';
import { tOf } from './calendar';

/* ───────── 용안과 왕의 마음 ───────── */

export function moodLabel(m: number): string {
  if (m >= 40) return '흡족';
  if (m >= 10) return '평온';
  if (m > -30) return '심드렁';
  if (m > -60) return '언짢음';
  return '진노';
}

export const leanOf = (s: GameState, f: FactionId) => Math.round(s.king.lean[f] ?? 0);

export function kingMood(s: GameState, v: number) {
  s.king.mood = clamp(s.king.mood + v, -100, 100);
}

export function kingLean(s: GameState, f: FactionId, v: number) {
  if (f === 'none') return;
  s.king.lean[f] = clamp((s.king.lean[f] ?? 0) + v, -50, 50);
}

/** 가장 기운 당과 그 정도 */
export function favoredFaction(s: GameState): [FactionId, number] | null {
  let best: [FactionId, number] | null = null;
  for (const f of activeFactions(s)) {
    const v = leanOf(s, f);
    if (!best || v > best[1]) best = [f, v];
  }
  return best && best[1] >= 8 ? best : null;
}

/** 왕의 마음이 이만큼 식으면 환국의 조짐이 보인다 */
export const WARY_WARN = -20;
/** 이만큼 식으면 환국이 일어날 수 있다 */
export const WARY_TRIGGER = -35;

/**
 * 왕의 마음(lean)은 당마다 -50 ~ 50. 예전의 「견제(wary)」를 여기에 합쳤다:
 * 한 당이 관직을 너무 많이 쥐거나 당론이 강경하면 그 당을 향한 마음이 식고, 깊이 식으면 환국이 난다.
 */
export function tickKing(s: GameState) {
  const k = s.king;
  // 용안은 왕권의 바탕으로 돌아간다. 비변사가 국정을 쥘수록 그 바탕이 낮아진다 (kwanje.ts authorityBase)
  kingMood(s, randInt(s, -8, 8) - (k.mood - authorityBase(s)) * 0.08 - (s.war.active ? 1 : 0));
  for (const f of new Set([...Object.keys(k.lean), ...Object.keys(k.base ?? {})]) as Set<FactionId>) {
    const b = k.base?.[f] ?? 0;
    k.lean[f] = b + ((k.lean[f] ?? 0) - b) * 0.97;
  }
  const act = activeFactions(s);
  if (act.length && chance(s, 0.2)) kingLean(s, act[randInt(s, 0, act.length - 1)], randInt(s, -3, 6));
  const share = powerShare(s);
  // 왕마다 성향이 다르다: 탕평하는 왕은 한 당의 독주를 더 세게 누르고, 세도 아래에서는 외척의 당으로 기운다
  const style = s.flags.kingStyle;
  for (const f of act) {
    const sh = share[f] ?? 0;
    if (sh > 0.52) kingLean(s, f, -(sh - 0.52) * 12 * (style === 'tangpyeong' ? 2 : 1));
  }
  if (style === 'sedo' && s.factions.noron.active) kingLean(s, 'noron', 0.6);
  if (style === 'tangpyeong') s.tension = clamp(s.tension - 0.15, 0, 100);
  for (const f of act) {
    const v = k.lean[f] ?? 0;
    const warned = !!s.flags[`waryWarn_${f}`];
    if (v <= WARY_WARN && (share[f] ?? 0) > 0.45 && !warned) {
      s.flags[`waryWarn_${f}`] = true;
      log(s, `[조정] 왕이 ${FACTION_META[f].name}의 독주를 못마땅해한다는 말이 돈다.`, 'court');
      const p = P(s);
      if (p.faction === f && inCourt(p))
        notice(
          s,
          '환국의 조짐',
          `${FACTION_META[f].name}이 조정을 오래 쥐자 왕의 마음이 식었다. 이대로 가면 왕이 판을 뒤집어 ${FACTION_META[f].name}의 요인들을 한꺼번에 갈아치울 수 있다(환국).

당의 요인일수록, 당론에 깊이 붙어 있을수록 함께 쓸려 나간다. 「당론과 거리 두기」나 조제보합 상소로 몸을 사릴 수 있다.`,
          'danger',
        );
    } else if (v > WARY_WARN / 2 && warned) delete s.flags[`waryWarn_${f}`];
  }
  // 숙종처럼 판을 자주 뒤집는 왕은 환국의 문턱이 낮다
  const volatile = style === 'volatile';
  // 탕평하는 왕은 한 당을 통째로 내치기보다 섞어 쓴다. 세도 아래에서는 외척이 판을 쥐어 왕이 판을 뒤집기 어렵다
  // 숙종 대의 굵직한 환국(경신·기사·갑술)은 시간 창 사건이 맡으므로, 그 사이의 작은 판갈이는 다섯 해에 한 번꼴이면 족하다
  const gap = volatile ? 60 : style === 'tangpyeong' ? 120 : 84;
  const odds = volatile ? 0.08 : style === 'tangpyeong' || style === 'sedo' ? 0.015 : style === 'neutral' ? 0.02 : 0.03;
  if (s.war.active || monthsSince(s, 'lastHwanguk') < gap) return;
  const f = act.find((x) => (k.lean[x] ?? 0) <= (volatile ? WARY_TRIGGER + 10 : WARY_TRIGGER) && (share[x] ?? 0) > (volatile ? 0.4 : 0.45));
  if (f && chance(s, odds)) hwanguk(s, f);
}

/** 왕이 판을 뒤집는다 */
export function hwanguk(s: GameState, f: FactionId, forced = false, quiet = false): string[] {
  const p = P(s);
  const holders = people(s)
    .filter((c) => c.faction === f && c.status === 'active' && c.office && OFFICE_MAP[c.office] && !isP(s, c))
    .sort((a, b) => OFFICE_MAP[b.office!].weight - OFFICE_MAP[a.office!].weight)
    .slice(0, 4);
  for (const c of holders) {
    vacate(s, c);
    c.favor = clamp(c.favor - 15, -100, 100);
  }
  // 환국으로 판이 뒤집히면 쫓겨난 이들에 대한 논핵은 거두어진다 (이미 벌을 받은 셈이다)
  const swept = new Set(holders.map((c) => c.id));
  s.cases = s.cases.filter((cs) => !(cs.kind === 'impeach' && swept.has(cs.target)));
  delete s.flags[`waryWarn_${f}`];
  s.flags.lastHwanguk = s.t;
  s.flags.hwangukAfter = `${f}:${s.t}`;
  s.king.lean[f] = -10;
  for (const o of activeFactions(s)) if (o !== f) kingLean(s, o, 12);
  s.tension = clamp(s.tension + 8, 0, 100);
  if (!quiet) log(s, `[환국] 왕이 ${FACTION_META[f].name}의 전횡을 꺾었다. ${holders.map((c) => c.name).join(', ')} 등이 하루아침에 자리에서 물러났다.`, 'history');

  if (p.faction !== f) {
    // 서인 전체를 치는 환국에서 같은 뿌리의 다른 당이 쫓겨난 것은 당신에게 기회가 아니다 (당신의 당 몫에서 따로 알린다)
    if (quiet && p.faction !== 'none' && topOf(p.faction) === topOf(f)) return holders.map((c) => c.name);
    if (inCourt(p)) notice(s, '환국(換局)', `왕이 ${FACTION_META[f].name}의 요인들을 한꺼번에 갈아치웠다. 빈자리가 쏟아진다. 당신에게는 기회다.`, 'history');
    return holders.map((c) => c.name);
  }
  if (p.status !== 'active' || !p.office || !OFFICE_MAP[p.office]) {
    notice(s, '환국(換局)', `왕이 ${FACTION_META[f].name}의 요인들을 한꺼번에 갈아치웠다. 관직에 있지 않던 당신은 화를 비껴갔다.`, 'history');
    return holders.map((c) => c.name);
  }
  const leader = s.factions[f].leader === p.id;
  const distanced = typeof s.flags.distanced === 'number' && s.t - s.flags.distanced <= 12;
  // 역사의 환국은 그 당의 대신을 통째로 갈아치웠다
  const top = OFFICE_MAP[p.office].rank <= 2;
  const risk = clamp(0.35 + (forced ? 0.2 + (top ? 0.25 : 0) : 0) + (leader ? 0.3 : 0) + Math.max(0, (s.line[f] ?? 0) / 300) - (distanced ? 0.3 : 0) - (p.favor >= 50 ? 0.15 : 0), 0.05, 0.9);
  if (chance(s, risk)) {
    const name = officeTitle(p);
    vacate(s, p);
    s.cases = s.cases.filter((cs) => !(cs.kind === 'impeach' && cs.target === p.id));
    p.favor = clamp(p.favor - 10, -100, 100);
    s.player.deeds.push(`환국으로 ${name}에서 물러남`);
    notice(s, '환국(換局)', `왕이 ${FACTION_META[f].name}의 요인들을 한꺼번에 갈아치웠다. 당신도 ${name} 자리에서 쫓겨났다. (성심 -10)\n\n화를 입을 확률은 ${Math.round(risk * 100)}%였다.`, 'danger');
  } else {
    notice(s, '환국(換局)', `왕이 ${FACTION_META[f].name}의 요인들을 한꺼번에 갈아치웠다. 당신은 용케 자리를 지켰다. (화를 입을 확률 ${Math.round(risk * 100)}%${distanced ? ', 당론과 거리를 둔 덕' : ''})`, 'danger');
  }
  return holders.map((c) => c.name);
}

/* ───────── 경연(經筵)과 차대(次對) ───────── */

interface Topic {
  id: string;
  title: string;
  ask: string;
  risk: number;
  from?: [number, number];
  to?: [number, number];
}

const TOPICS: Topic[] = [
  { id: 'gunyeok', title: '군역의 폐단', ask: '"백성이 군포에 시달린다 하니, 경의 생각은 어떠한가?"', risk: 1 },
  { id: 'sarim', title: '인재의 등용', ask: '"산림에 숨은 선비를 불러 쓰라는 말이 많다. 어찌 생각하는가?"', risk: 0 },
  { id: 'daehak', title: '『대학연의』 강론', ask: '"수신(修身)과 치국(治國)이 어찌 하나로 이어진다는 것인가?"', risk: 0 },
  { id: 'hunt', title: '왕의 사냥', ask: '"과인이 근교에 나가 사냥을 하려는데, 신하들이 말이 많구나."', risk: 2 },
  { id: 'inlaw', title: '외척의 전횡', ask: '"외척이 권세를 부린다는 말이 있다. 경은 누구를 두고 하는 말이라 보는가?"', risk: 2 },
  { id: 'party', title: '붕당의 폐해', ask: '"신하들이 당을 갈라 서로 헐뜯으니, 과인은 누구를 믿어야 하는가?"', risk: 1 },
  { id: 'heir', title: '세자 책봉', ask: '"국본(國本)을 정하라는 말이 있다지. 경도 같은 생각인가?"', risk: 3, from: [1589, 1], to: [1591, 12] },
  { id: 'japan', title: '왜의 동태', ask: '"왜가 군사를 기른다는 소문이 있다. 정말 쳐들어오겠는가?"', risk: 1, from: [1588, 1], to: [1592, 3] },
  { id: 'war', title: '전란의 수습', ask: '"종묘사직이 위태롭다. 이 난국을 어찌 수습해야 하는가?"', risk: 1, from: [1592, 5], to: [1598, 12] },
  { id: 'later_jin', title: '명과 후금', ask: '"명은 은혜를 갚으라 하고 후금은 칼을 갈고 있다. 과인은 어느 쪽에 서야 하는가?"', risk: 2, from: [1610, 1], to: [1622, 12] },
  { id: 'later_cheong', title: '청에 대한 의리', ask: '"삼전도의 치욕을 어찌 잊겠는가. 그러나 지금 청을 거스를 힘이 있는가?"', risk: 2, from: [1637, 3], to: [1659, 12] },
  { id: 'later_ye', title: '예론(禮論)', ask: '"상복의 일로 조정이 갈렸다. 경은 예(禮)가 왕통보다 앞선다고 보는가?"', risk: 2, from: [1659, 6], to: [1680, 12] },
  { id: 'later_hwanguk', title: '환국의 뒤', ask: '"과인이 판을 바꾼 것을 두고 말이 많다지. 경도 과인이 변덕스럽다 보는가?"', risk: 3, from: [1680, 1], to: [1720, 12] },
  { id: 'later_tang', title: '탕평', ask: '"노론과 소론을 고루 쓰려 한다. 경은 탕평이 옳다고 보는가, 의리를 흐린다고 보는가?"', risk: 1, from: [1725, 1], to: [1800, 6] },
  { id: 'later_seohak', title: '서학(西學)', ask: '"천주학이 선비들 사이에 번진다 한다. 엄금해야 하는가, 학문으로 다스려야 하는가?"', risk: 2, from: [1785, 1], to: [1821, 12] },
  { id: 'later_sedo', title: '외척의 세도', ask: '"과인의 장인 집안을 두고 말이 많다. 경은 어찌 생각하는가?"', risk: 3, from: [1803, 1], to: [1821, 12] },
  { id: 'later_restore', title: '전후의 복구', ask: '"전란으로 땅은 묵고 호적은 흩어졌다. 무엇부터 바로잡아야 하는가?"', risk: 0, from: [1599, 1], to: [1610, 12] },
  { id: 'later_gongsin', title: '반정 공신', ask: '"반정에 공을 세운 이들이 권세를 부린다는 말이 들린다. 과인이 그들을 어찌 대해야 하는가?"', risk: 2, from: [1623, 6], to: [1640, 12] },
  { id: 'later_daedong', title: '대동법의 확대', ask: '"대동법을 온 나라에 넓히자는 말과, 지주들이 견디지 못한다는 말이 함께 들린다. 경의 생각은?"', risk: 1, from: [1623, 1], to: [1708, 12] },
  { id: 'later_bukbeol', title: '북벌', ask: '"군사를 길러 청을 치고 치욕을 씻으려 한다. 경은 이것이 될 일이라 보는가?"', risk: 2, from: [1649, 6], to: [1659, 4] },
  { id: 'later_yangyeok', title: '양역의 폐단', ask: '"양인이 군포를 두 필씩 내느라 도망치는 자가 많다. 호포와 결포 가운데 무엇이 옳은가?"', risk: 1, from: [1730, 1], to: [1752, 12] },
  { id: 'later_sado', title: '동궁의 행실', ask: '"세자의 행실을 두고 흉흉한 말이 들린다. 경은 들은 바가 있는가?"', risk: 3, from: [1755, 1], to: [1762, 4] },
  { id: 'later_uiri', title: '임오년의 의리', ask: '"과인은 사도세자의 아들이다. 경은 임오년의 일을 어떻게 보는가?"', risk: 3, from: [1776, 4], to: [1790, 12] },
  { id: 'later_hwaseong', title: '화성과 장용영', ask: '"화성을 쌓고 장용영을 키우려 한다. 나라 살림이 이를 버티겠는가?"', risk: 1, from: [1789, 1], to: [1800, 6] },
  { id: 'later_seobuk', title: '서북의 민심', ask: '"평안도 백성의 원망이 깊다 한다. 그 까닭이 무엇이라 보는가?"', risk: 2, from: [1808, 1], to: [1821, 12] },
];

const HONGMUN = ['bujehak', 'gyori1', 'gyori2', 'eunggyo', 'daejehak'];

export function audienceEligible(s: GameState): boolean {
  const p = P(s);
  if (p.status !== 'active' || !atSeat(s, p) || !p.office) return false;
  const o = OFFICE_MAP[p.office];
  return !!o && (o.rank <= 3 || !!o.samsa || !!o.cheongyo);
}

export function rollAudience(s: GameState) {
  if (!audienceEligible(s) || s.pending.length >= 2 || s.flags.kingCaptive) return;
  // 경연은 잦으면 지루하다: 다섯 달에 한 번꼴까지
  if (monthsSince(s, 'audienceAt') < 5) return;
  const p = P(s);
  // 지난달 업무에 힘썼으면 왕의 눈에 띈다
  const keen = monthsSince(s, 'workAt') <= 1 ? 0.12 : 0;
  if (!chance(s, ((HONGMUN.includes(p.office!) ? 0.2 : 0.1) + keen * 0.7) * ZEAL_FREQ[kingProfile(s).zeal])) return;
  const pool = TOPICS.filter((x) => (!x.from || s.t >= tOf(...x.from)) && (!x.to || s.t <= tOf(...x.to)));
  const topic = pool[randInt(s, 0, pool.length - 1)];
  s.flags.audienceAt = s.t;
  s.pending.push({ id: uid(s, 'ev'), def: 'audience', ctx: { topic: topic.id } });
}

const topicOf = (id: string) => TOPICS.find((x) => x.id === id) ?? TOPICS[0];
const front = (s: GameState, def: string, ctx: Record<string, any>) => s.pending.unshift({ id: uid(s, 'ev'), def, ctx });

function bestAlly(s: GameState, sameFaction: boolean): Character | undefined {
  const p = P(s);
  return people(s)
    .filter((c) => !isP(s, c) && inCourt(c) && c.faction !== 'none' && (sameFaction ? c.faction === p.faction : topOf(c.faction) !== topOf(p.faction)))
    .sort((a, b) => b.politics + b.learning + b.prestige / 20 - (a.politics + a.learning + a.prestige / 20))[0];
}

export const KING_EVENTS: Record<string, EventDef> = {
  audience: {
    build(s, c) {
      const t = topicOf(c.topic);
      const p = P(s);
      const mood = moodLabel(s.king.mood);
      const riskTxt = ['', '조금 민감한 주제다.', '왕이 듣기 싫어할 주제다.', '목이 달아날 수도 있는 주제다.'][t.risk];
      const k = kingProfile(s);
      const bored = k.zeal < 0 ? ' 다만 이 임금은 경전 이야기를 지루해한다.' : k.zeal >= 2 ? ' 이 임금은 강론에 크게 감복하지만 눈이 높다.' : '';
      const sharp = k.politics >= 7 ? ' 정치에 밝은 임금이라 듣기 좋은 말을 꿰뚫어 본다.' : '';
      return {
        title: `경연(經筵) — ${t.title}`,
        kind: 'court',
        text: `경연이 끝나 갈 무렵, 왕이 당신을 돌아보며 묻는다.\n\n${t.ask}\n\n오늘 용안은 「${mood}」이다. ${riskTxt}`,
        choices: [
          { key: 'bold', label: '직언(直言)한다', hint: `명망 +3. 용안이 밝으면 성심이 오르고, 어두우면 크게 떨어진다.${p.traits.includes('upright') ? ' (강직: 명망 +1)' : ''}` },
          { key: 'soft', label: '완곡하게 아뢴다', hint: `${vsText(p.politics, k.politics, '정치력')} ≥ ${3 + t.risk}. 성공하면 성심 +4.` },
          { key: 'classic', label: '경전을 들어 답한다', hint: `${vsText(p.learning, k.learning, '학식')} ≥ 3. 성공하면 성심 +${k.zeal >= 2 ? 5 : 3}, 명망 +2.${bored}` },
          { key: 'flatter', label: '왕의 뜻에 맞춘다', hint: `성심 +${k.politics >= 7 ? 2 : 5}, 명망 -3. 같은 당에서 아첨한다는 말을 듣는다.${sharp}` },
        ],
      };
    },
    resolve(s, c, key) {
      const t = topicOf(c.topic);
      const p = P(s);
      if (key === 'bold') {
        p.prestige = clamp(p.prestige + 3 + (p.traits.includes('upright') ? 1 : 0), 0, 100);
        if (s.king.mood + p.favor / 2 >= 10 * t.risk) {
          p.favor = clamp(p.favor + 4, -100, 100);
          kingMood(s, 2);
          front(s, 'audience_follow', { topic: t.id, mode: 'ask' });
          return '왕이 한참을 생각하더니 고개를 끄덕였다. (명망 +3, 성심 +4)';
        }
        const loss = 5 + t.risk * 2;
        p.favor = clamp(p.favor - loss, -100, 100);
        kingMood(s, -(6 + t.risk * 3));
        front(s, 'audience_follow', { topic: t.id, mode: 'angry' });
        return `왕의 낯빛이 굳어졌다. (명망 +3, 성심 -${loss})`;
      }
      const k = kingProfile(s);
      if (key === 'soft') {
        const r = d6(s) + p.politics - k.politics + (p.traits.includes('eloquent') ? 1 : 0);
        if (r >= 3 + t.risk) {
          p.favor = clamp(p.favor + 4, -100, 100);
          kingMood(s, 3);
          if (chance(s, 0.5)) front(s, 'audience_follow', { topic: t.id, mode: 'ask' });
          return `말을 골라 아뢰자 왕이 흡족해했다. (판정 ${r}, 성심 +4)`;
        }
        return `${k.politics >= 7 ? '왕이 말의 속뜻을 꿰뚫어 보고 엷게 웃었다' : '왕이 알아듣지 못한 듯 다른 신하에게 말을 돌렸다'}. (판정 ${r} < ${3 + t.risk})`;
      }
      if (key === 'classic') {
        const r = d6(s) + p.learning - k.learning;
        // 학문에 뜻이 없는 임금은 경전 이야기를 지루해한다
        if (k.zeal < 0) {
          if (r >= 3 && chance(s, 0.5)) {
            p.prestige = clamp(p.prestige + 1, 0, 100);
            return `구절을 막힘없이 풀었지만 왕은 하품을 참을 뿐이었다. (판정 ${r}, 명망 +1)`;
          }
          p.favor = clamp(p.favor - 2, -100, 100);
          kingMood(s, -2);
          return `경전 이야기가 길어지자 왕이 "그만하라. 머리가 아프다" 하고 자리를 떴다. (판정 ${r}, 성심 -2)`;
        }
        if (r >= 3) {
          const g = k.zeal >= 2 ? 5 : 3;
          p.favor = clamp(p.favor + g, -100, 100);
          p.prestige = clamp(p.prestige + 2, 0, 100);
          kingMood(s, 4);
          return `${k.zeal >= 2 ? '왕이 몸소 다른 구절로 되묻자 막힘없이 받아냈다. 왕이 무릎을 쳤다' : '경전의 구절을 들어 풀어내자 좌우가 감탄했다'}. (판정 ${r}, 성심 +${g}, 명망 +2)`;
        }
        p.prestige = clamp(p.prestige - 1, 0, 100);
        if (k.zeal >= 2) {
          p.favor = clamp(p.favor - 1, -100, 100);
          return `왕이 "그 구절의 주석은 그렇지 않다" 하며 바로잡았다. 얼굴이 화끈거렸다. (판정 ${r} < 3, 명망 -1, 성심 -1)`;
        }
        return `구절이 입안에서 맴돌 뿐 말이 막혔다. (판정 ${r} < 3, 명망 -1)`;
      }
      const gain = k.politics >= 7 ? 2 : 5;
      p.favor = clamp(p.favor + gain, -100, 100);
      p.prestige = clamp(p.prestige - 3, 0, 100);
      kingMood(s, k.politics >= 7 ? 2 : 6);
      const fx = swayFaction(s, p.faction, p.id, -3, '경연에서 아첨', 0.1);
      return `${k.politics >= 7 ? '왕이 듣기 좋은 말인 줄 알면서도 받아 주었다' : '왕이 기뻐했다'}. 물러 나오는 길에 동료들의 시선이 싸늘했다. (성심 +${gain}, 명망 -3${fx ? `, ${fx}` : ''})`;
    },
  },

  audience_follow: {
    build(s, c) {
      const t = topicOf(c.topic);
      if (c.mode === 'angry') {
        return {
          title: `경연 — ${t.title}`,
          kind: 'danger',
          text: '왕이 붓을 내려놓았다. "경의 말이 지나치다." 좌우의 신하들이 숨을 죽인다.\n\n여기서 물러설 것인가, 거듭 간할 것인가?',
          choices: [
            { key: 'yield', label: '엎드려 사죄한다', hint: '성심 +2, 명망 -1' },
            { key: 'press', label: '거듭 간한다', hint: '명망 +5, 성심 -8. 왕의 진노를 살 수 있다 (15%).' },
          ],
        };
      }
      const ally = bestAlly(s, true);
      const other = bestAlly(s, false);
      return {
        title: `경연 — ${t.title}`,
        kind: 'court',
        text: '왕이 다시 묻는다. "그렇다면 이 일을 누구에게 맡기면 좋겠는가?"\n\n한마디로 사람의 앞길이 열리는 자리다.',
        choices: [
          {
            key: 'ally',
            label: ally ? `같은 당의 ${josa(ally.name, '을/를')} 천거한다` : '같은 당 사람을 천거한다',
            hint: '그가 6개월간 임용 점수 +8을 받고 신세를 진다. 왕의 마음이 당신 당으로 조금 기운다.',
            disabled: ally ? undefined : '천거할 만한 같은 당 사람이 없다',
          },
          {
            key: 'other',
            label: other ? `다른 당의 ${josa(other.name, '을/를')} 천거한다` : '다른 당 사람을 천거한다',
            hint: '긴장 -3, 그의 호감 +12, 같은 당 -3. 공평하다는 평을 듣는다 (성심 +2).',
            disabled: other ? undefined : '천거할 만한 다른 당 사람이 없다',
          },
          { key: 'self', label: '신이 맡겠습니다', hint: '6개월간 내 임용 점수 +8. 명망 -1 (자천).' },
          { key: 'none', label: '사양한다', hint: '명망 +1' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      if (key === 'yield') {
        p.favor = clamp(p.favor + 2, -100, 100);
        p.prestige = clamp(p.prestige - 1, 0, 100);
        return '엎드려 사죄했다. 왕이 손을 내저었다.';
      }
      if (key === 'press') {
        p.prestige = clamp(p.prestige + 5 + (p.traits.includes('upright') ? 1 : 0), 0, 100);
        p.favor = clamp(p.favor - 8, -100, 100);
        kingMood(s, -10);
        if (chance(s, 0.15) && !p.tags.includes('royalWrath')) {
          p.tags.push('royalWrath');
          return '왕이 크게 노하여 자리를 박차고 일어났다. 왕의 진노를 샀다. (명망 +5, 성심 -8)';
        }
        return '물러서지 않았다. 사관이 그 말을 받아 적었다. (명망 +5, 성심 -8)';
      }
      if (key === 'ally') {
        const a = bestAlly(s, true);
        if (!alive(a)) return;
        s.recs[a.id] = s.t + 6;
        owe(s, a.id);
        sway(s, a, p.id, 10, '경연에서 천거', { decay: 0.15 });
        kingLean(s, p.faction, 2);
        return `${josa(a.name, '을/를')} 천거했다. 그가 신세를 졌다.`;
      }
      if (key === 'other') {
        const o = bestAlly(s, false);
        if (!alive(o)) return;
        s.recs[o.id] = s.t + 6;
        s.tension = clamp(s.tension - 3, 0, 100);
        sway(s, o, p.id, 12, '경연에서 천거', { clan: 0.2, decay: 0.12 });
        swayFaction(s, p.faction, p.id, -3, '상대 당을 천거', 0.1);
        p.favor = clamp(p.favor + 2, -100, 100);
        return `다른 당의 ${josa(o.name, '을/를')} 천거했다. 왕이 공평하다 여겼다.`;
      }
      if (key === 'self') {
        s.recs[p.id] = s.t + 6;
        p.prestige = clamp(p.prestige - 1, 0, 100);
        return '스스로 맡겠다고 나섰다. (6개월간 임용 점수 +8)';
      }
      p.prestige = clamp(p.prestige + 1, 0, 100);
      return '겸양하며 물러났다.';
    },
  },
};

/** 왕의 마음이 지금 어느 쪽에 있는지 한 줄로 */
export function kingSummary(s: GameState): string {
  const fav = favoredFaction(s);
  const parts = [`용안 「${moodLabel(s.king.mood)}」`];
  if (fav) parts.push(`${FACTION_META[fav[0]].name}에 마음이 기울었다`);
  const wary = activeFactions(s).filter((f) => (s.king.lean[f] ?? 0) <= WARY_WARN);
  if (wary.length) parts.push(`${wary.map((f) => FACTION_META[f].name).join('·')}의 독주를 경계한다`);
  return parts.join(' · ');
}
/** 정국을 한 줄로: 왕이 어느 쪽에 기울었는지, 왕권은 어떤지, 조정은 어떤지 */
export function politicsSummary(s: GameState): { line: string; detail: string } {
  const fav = favoredFaction(s);
  const lg = legitOf(s).score;
  const auth = s.king.mood + authorityBase(s) + (lg - 55) * 0.5;
  const king = fav ? `${FACTION_META[fav[0]].name} 쪽으로 기운 왕` : '어느 당에도 기울지 않은 왕';
  const power = auth >= 30 ? '굳건한 왕권' : auth >= 0 ? '무난한 왕권' : auth >= -30 ? '흔들리는 왕권' : '땅에 떨어진 왕권';
  const t = s.tension;
  const court = t >= 70 ? '피바람이 부는 조정' : t >= 50 ? '격앙된 조정' : t >= 30 ? '술렁이는 조정' : '잠잠한 조정';
  const line = `${king} · ${power} · ${court}`;
  const detail = `용안 ${moodLabel(s.king.mood)}(${Math.round(s.king.mood)}) · 정통성 ${legitName(lg)}(${lg}) · 긴장 ${Math.round(t)} · ${bibyeonStage(bibyeonPower(s)).name}(비변사 위상 ${Math.round(bibyeonPower(s))})`;
  return { line, detail };
}
