import type { GameState, RegionId } from './types';
import type { EventDef } from './events/types';
import { REGION_META } from './data/meta';
import { chance } from './rng';
import { addFlaw, alive, clamp, josa, log, notice, P, pushEvent } from './state';
import { yearOf } from './calendar';
import { vacate } from './court';
import { exile } from './conflict';
import { diffK } from './diff';

/* ───────── 고을의 원성: 수령의 삼정(三政) ─────────
 * 수령으로 나가 있는 동안 환곡·군정·전정을 어떻게 다루었는지가 「고을의 원성」으로 쌓인다.
 * 원성이 차면 고을 백성이 관아로 몰려온다(19세기에는 더 쉽게). 원성이 낮게 오래 다스리면 선정비가 선다.
 */

const late = (s: GameState) => yearOf(s.t) >= 1800;

export function countyOf(s: GameState) {
  const p = P(s);
  if (p.office !== 'suryeong' || p.status !== 'active') return undefined;
  if (!s.player.county || s.player.county.region !== p.location) s.player.county = { region: p.location as RegionId, harm: late(s) ? 15 : 5, good: 0, since: s.t };
  return s.player.county;
}

/** 원성을 더하거나 덜어 낸다 (선정은 good으로 센다) */
export function countyHarm(s: GameState, v: number, good = 0) {
  const c = countyOf(s);
  if (!c) return;
  c.harm = clamp(c.harm + v, 0, 100);
  c.good += good;
}

export const harmLabel = (v: number) => (v >= 55 ? '들끓는다' : v >= 30 ? '높다' : v >= 20 ? '수군댄다' : '잠잠하다');

/** 매달: 원성이 가라앉거나, 터지거나, 선정비가 선다 */
export function tickCounty(s: GameState) {
  const p = P(s);
  if (!alive(p)) return;
  if (p.office !== 'suryeong' || p.status !== 'active') {
    s.player.county = undefined;
    return;
  }
  const c = countyOf(s)!;
  const r = s.regions[c.region];
  // 19세기의 고을은 수령이 가만있어도 아전과 토호가 원성을 쌓는다
  c.harm = clamp(c.harm + (late(s) ? 0.5 : 0) - 0.4 + (r.minsim < 40 ? 0.4 : 0), 0, 100);
  if (c.harm >= 30 && s.pending.length < 3 && !s.pending.some((e) => e.def === 'county_revolt')) {
    const odds = ((c.harm - 20) / 250) * (late(s) ? 1.6 : 1) * diffK(s);
    if (chance(s, odds)) {
      pushEvent(s, 'county_revolt', { region: c.region });
      return;
    }
  }
  const months = s.t - c.since;
  if (months >= 18 && c.harm < 12 && c.good >= 2 && !s.flags[`seonjeong_${p.id}_${c.region}`]) {
    s.flags[`seonjeong_${p.id}_${c.region}`] = true;
    p.prestige = clamp(p.prestige + 4, 0, 100);
    p.favor = clamp(p.favor + 3, 0, 100);
    r.minsim = clamp(r.minsim + 3, 0, 100);
    s.player.deeds.push(`${REGION_META[c.region].short} 고을에 선정비가 서다`);
    notice(s, '선정비(善政碑)', `${REGION_META[c.region].short} 고을 백성들이 돈을 모아 길가에 당신의 선정비를 세웠다. 감사의 포폄에 「상(上)」이 올라갔다는 말도 들린다. (명망 +4, 성심 +3)`, 'personal');
    log(s, `${REGION_META[c.region].short} 고을 백성들이 수령 ${p.name}의 선정비를 세웠다.`, 'player');
  }
}

export const COUNTY_EVENTS: Record<string, EventDef> = {
  county_revolt: {
    build(s, ctx) {
      const where = REGION_META[ctx.region as RegionId].short;
      const harm = Math.round(s.player.county?.harm ?? 50);
      return {
        title: '관아로 몰려온 백성',
        kind: 'danger',
        text: late(s)
          ? `${where} 고을 백성 수백 명이 죽창과 몽둥이를 들고 관아 앞에 모였다. 환곡의 이자, 죽은 이와 갓난아이에게 매긴 군포, 장부에 없는 땅에 매긴 결세를 견디다 못한 것이다. 앞장선 이는 몰락한 양반이라 한다. 아전 몇이 벌써 매를 맞고 달아났다. (고을의 원성 ${harm})`
          : `${where} 고을 백성들이 관아 앞에 모여 수령을 부른다. 묵은 환곡과 아전의 농간을 더는 못 견디겠다는 것이다. (고을의 원성 ${harm})`,
        choices: [
          { key: 'face', label: '문을 열고 나가 원성을 듣는다', hint: '정치력으로 판정. 되면 원성 −35·명망 +3, 안 되면 매를 맞고 쫓겨나 파직' },
          { key: 'suppress', label: '감영에 군사를 청해 누른다', hint: '이 도 민심 −8, 원성 0. 조정이 안핵사를 보내면(40%) 수령의 책임을 따져 파직' },
          { key: 'flee', label: '인부를 챙겨 관아를 버리고 달아난다', hint: '파직·한 해 서용 금지·명망 −6. 절반의 확률로 유배' },
        ],
      };
    },
    resolve(s, ctx, key) {
      const p = P(s);
      const rg = ctx.region as RegionId;
      const where = REGION_META[rg].short;
      const r = s.regions[rg];
      if (p.office !== 'suryeong' || p.status !== 'active') return '이미 고을을 떠난 뒤였다.';
      log(s, `[고을] ${where} 고을 백성들이 수령 ${josa(p.name, '을/를')} 성토하며 관아로 몰려왔다.`, 'war');
      if (key === 'face') {
        const ok = chance(s, clamp(0.25 + p.politics * 0.06 - (s.player.county?.harm ?? 50) / 300, 0.1, 0.85));
        if (ok) {
          countyHarm(s, -35, 1);
          p.prestige = clamp(p.prestige + 3, 0, 100);
          r.minsim = clamp(r.minsim + 2, 0, 100);
          log(s, `${josa(p.name, '이/가')} 성난 백성 앞에 나가 묵은 환곡을 탕감하고 농간한 아전을 벌하겠다고 약속하자 무리가 흩어졌다.`, 'player');
          return '백성 앞에 나가 묵은 폐단을 고치겠다고 약속했다. 무리가 흩어졌다. (원성 −35, 명망 +3)';
        }
        vacate(s, p, 'idle');
        p.banUntil = Math.max(p.banUntil ?? 0, s.t + 6);
        p.prestige = clamp(p.prestige - 3, 0, 100);
        p.vigor = Math.max(1, p.vigor - 1);
        return '말이 먹히지 않았다. 돌과 몽둥이가 날아와 겨우 몸만 빠져나왔다. 감사가 장계를 올려 파직되었다. (명망 −3, 기력 −1)';
      }
      if (key === 'suppress') {
        r.minsim = clamp(r.minsim - 8, 0, 100);
        s.tension = clamp(s.tension + 2, 0, 100);
        if (s.player.county) s.player.county.harm = 0;
        if (chance(s, 0.4)) {
          vacate(s, p, 'idle');
          p.banUntil = Math.max(p.banUntil ?? 0, s.t + 12);
          p.prestige = clamp(p.prestige - 4, 0, 100);
          addFlaw(s, p, '민란을 부른 학정', true);
          log(s, `조정이 ${where}에 안핵사를 보냈다. 안핵사는 난의 뿌리가 수령 ${p.name}의 학정에 있다고 아뢰었다.`, 'court');
          return '군사가 무리를 흩었지만, 내려온 안핵사가 난의 뿌리를 수령에게서 찾았다. 파직되고 한 해 동안 서용되지 못한다. (명망 −4, 드러난 흠 「민란을 부른 학정」)';
        }
        return '감영 군사가 와서 주동자를 잡아 효수했다. 고을은 조용해졌지만 백성의 눈빛이 차갑다. (이 도 민심 −8)';
      }
      vacate(s, p, 'idle');
      p.banUntil = Math.max(p.banUntil ?? 0, s.t + 12);
      p.prestige = clamp(p.prestige - 6, 0, 100);
      if (chance(s, 0.5)) {
        exile(s, p);
        return '관아를 버리고 달아난 수령이라는 탄핵이 빗발쳤다. 끝내 유배의 명이 내렸다. (명망 −6)';
      }
      return '관아를 버리고 달아났다. 파직되고 한 해 동안 서용되지 못한다. (명망 −6)';
    },
  },
};
