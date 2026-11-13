import type { Character, FactionId, GameState } from './types';
import { kingProfile, rulerName, vsText } from './kingstat';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { tOf, yearOf } from './calendar';
import { chance, d6, pick } from './rng';
import { addFlaw, alive, atSeat, fav, inCourt, isP, josa, log, monthsSince, officeTitle, owe, P, people, pres, pushEvent } from './state';
import { sway, topOf } from './opinion';
import { activeFactions } from './factions';
import { kingLean, moodLabel } from './king';
import { LAWS, lawJosa, lawOpen } from './laws';
import { vacate } from './court';
import { gukbonSit, TOPICS as GUKBON_TOPICS } from './gukbon';

/* ───────── 임금과 마주하다 ─────────
 * 조선은 군주를 정점에 둔 나라다. 신하는 청대(請對)해 임금을 뵙고, 경연에서 강론하고, 병환에 문안한다.
 * 임금도 밀지를 내리고, 하사하고, 꾸짖고, 몸소 책문을 내고, 사람됨을 묻는다.
 */

const kingName = (s: GameState) => rulerName(s);

export interface KingAct {
  id: 'cheongdae' | 'jingang' | 'munan' | 'jinheon';
  name: string;
  desc: string;
  ap: number;
}

export const KING_ACTS: KingAct[] = [
  { id: 'cheongdae', name: '청대(請對)', desc: '임금께 따로 뵙기를 청한다. 시정을 아뢰거나, 의중을 살피거나, 당을 변호하거나, 사람을 천거하거나, 남의 허물을 은밀히 아뢴다. 석 달에 한 번.', ap: 1 },
  { id: 'jingang', name: '진강(進講)', desc: '경연에서 경서를 강론한다. 주사위 + (내 학식 - 임금의 학식)으로 판정한다. 학문을 즐기는 임금은 크게 감복하고, 학문에 뜻이 없는 임금은 지루해한다. 홍문관·규장각·대제학이거나 학식 6 이상이어야 한다. 두 달에 한 번.', ap: 1 },
  { id: 'munan', name: '문안(問安)', desc: '병석의 임금께 문안을 여쭙는다. 환후 중에 한 번. 성심 +3.', ap: 1 },
  { id: 'jinheon', name: '진헌(進獻)', desc: '귀한 물건을 바친다. 재산 -30, 성심 +4. 아첨이라는 말을 듣는다 (명망 -1). 한 해에 한 번.', ap: 1 },
];

export function kingActError(s: GameState, id: KingAct['id']): string | null {
  const p = P(s);
  if (!alive(p)) return '세상을 떠났다';
  if (p.status === 'exiled') return '귀양 중이다';
  if (!inCourt(p) || !atSeat(s, p)) return '조정에 있어야 한다';
  if (s.flags.kingCaptive) return '임금이 적의 손에 있다';
  const a = KING_ACTS.find((x) => x.id === id)!;
  if (s.player.ap < a.ap) return '행동력이 부족하다';
  const o = p.office ? OFFICE_MAP[p.office] : undefined;
  const ill = s.situations.some((x) => x.kind === 'illness');
  if (id === 'cheongdae') {
    if (ill) return '임금이 병석에 있다';
    if (!(p.rank <= 3 || o?.samsa || o?.dept === 'seungjeongwon' || o?.dept === 'gyujanggak')) return '당상관이거나 삼사·승정원·규장각에 있어야 한다';
    const n = 3 - monthsSince(s, 'cheongdaeAt');
    return n > 0 ? `${n}달 뒤에 다시 청할 수 있다` : null;
  }
  if (id === 'jingang') {
    if (ill) return '경연이 멈추었다';
    if (!(o?.dept === 'hongmungwan' || o?.dept === 'gyujanggak' || o?.literary || p.learning >= 6)) return '홍문관·규장각·문형이거나 학식 6 이상이어야 한다';
    const n = 2 - monthsSince(s, 'jingangAt');
    return n > 0 ? `${n}달 뒤에 다시 할 수 있다` : null;
  }
  if (id === 'munan') {
    if (!ill) return '임금이 병석에 있을 때만 할 수 있다';
    return s.flags.munanFor === s.situations.find((x) => x.kind === 'illness')?.id ? '이번 환후에 이미 문안했다' : null;
  }
  if (p.traits.includes('upright') || p.traits.includes('clean')) return '강직한 성품이 허락하지 않는다';
  if (p.wealth < 30) return '재산 30이 필요하다';
  const n = 12 - monthsSince(s, 'jinheonAt');
  return n > 0 ? `${n}달 뒤에 다시 할 수 있다` : null;
}

export function kingAct(s: GameState, id: KingAct['id']): string {
  const err = kingActError(s, id);
  if (err) return err;
  const p = P(s);
  const a = KING_ACTS.find((x) => x.id === id)!;
  s.player.ap -= a.ap;
  if (id === 'cheongdae') {
    s.flags.cheongdaeAt = s.t;
    pushEvent(s, 'cheongdae', {});
    return `${kingName(s)}께 뵙기를 청했다. 승지가 편전으로 이끈다.`;
  }
  if (id === 'jingang') {
    s.flags.jingangAt = s.t;
    const k = kingProfile(s);
    const r = d6(s) + p.learning - k.learning;
    s.player.exp.learning += 4;
    if (k.zeal < 0) {
      if (r >= 4) {
        pres(p, 1);
        return `막힘없이 강론했지만 임금은 내내 딴 데를 보았다. (판정 ${r}, 명망 +1)`;
      }
      fav(p, -2);
      return `강론이 길어지자 임금이 "오늘은 이만하라" 하고 경연을 파했다. (판정 ${r}, 성심 -2)`;
    }
    if (r >= 6 + (k.zeal >= 2 ? 0 : 1)) {
      fav(p, 5);
      pres(p, 3);
      log(s, `${josa(p.name, '이/가')} 경연에서 강론하자 임금이 크게 감복해 책을 내렸다.`, 'player');
      return `경연에서 『${pick(s, ['대학연의', '논어', '맹자', '서경', '근사록', '심경'])}』을 강론했다. 임금이 무릎을 치며 감복해 내사본(內賜本)을 내렸다. (판정 ${r}, 성심 +5, 명망 +3)`;
    }
    if (r >= 3) {
      fav(p, k.zeal >= 2 ? 4 : 3);
      pres(p, 1);
      return `경연에서 막힘 없이 강론했다. 임금이 고개를 끄덕였다. (판정 ${r}, 성심 +${k.zeal >= 2 ? 4 : 3}, 명망 +1)`;
    }
    fav(p, -1);
    return `${k.zeal >= 2 ? '임금이 몸소 주석을 들어 되묻자 말이 막혔다' : '임금의 물음에 말이 막혔다. 다른 경연관이 대신 답했다'}. (판정 ${r} < 3, 성심 -1)`;
  }
  if (id === 'munan') {
    s.flags.munanFor = s.situations.find((x) => x.kind === 'illness')?.id ?? '';
    fav(p, 3);
    return '대궐에 나아가 환후를 여쭈었다. 내의원 제조가 탕제를 올리는 것을 지켜보았다. (성심 +3)';
  }
  s.flags.jinheonAt = s.t;
  p.wealth -= 30;
  fav(p, 4);
  pres(p, -1);
  const what = pick(s, ['명주 비단', '고려 인삼', '귀한 벼루', '송나라 판본의 서책', '매 한 쌍']);
  return `${josa(what, '을/를')} 바쳤다. 임금이 흐뭇해했지만, 선비들은 아첨이라 수군거린다. (재산 -30, 성심 +4, 명망 -1)`;
}

/* ───────── 청대: 무엇을 아뢸 것인가 ───────── */

/** 이 당을 임금이 어떻게 보는가 */
const leanWord = (v: number) => (v >= 15 ? '깊이 믿는다' : v >= 5 ? '가까이한다' : v > -5 ? '저울질한다' : v > -15 ? '경계한다' : '미워한다');

/** 은밀히 아뢸 만한 남의 허물: 다른 당 사람의, 나만 아는 흠결 */
function secretTarget(s: GameState): [Character, string] | null {
  const p = P(s);
  for (const c of people(s)) {
    if (isP(s, c) || !inCourt(c) || c.faction === 'none' || topOf(c.faction) === topOf(p.faction)) continue;
    const f = c.flaws.find((x) => !x.public && x.knownBy.includes(p.id) && !x.settled);
    if (f) return [c, f.label];
  }
  return null;
}

/** 천거할 만한 사람: 같은 당이고 자리가 낮거나 없는 이 */
function protege(s: GameState): Character | undefined {
  const p = P(s);
  return people(s)
    .filter((c) => !isP(s, c) && inCourt(c) && c.faction === p.faction && p.faction !== 'none' && (c.status === 'idle' || c.rank >= 4) && (s.recs[c.id] ?? 0) <= s.t)
    .sort((a, b) => b.politics + b.learning + b.prestige / 20 - (a.politics + a.learning + a.prestige / 20))[0];
}

export const WANG_EVENTS: Record<string, EventDef> = {
  cheongdae: {
    build(s) {
      const p = P(s);
      const sec = secretTarget(s);
      const pro = protege(s);
      const pf = p.faction !== 'none' ? p.faction : null;
      const k = kingProfile(s);
      return {
        title: '청대(請對)',
        kind: 'court',
        text: `편전에 들자 ${josa(kingName(s), '이/가')} 붓을 내려놓는다. 용안은 「${moodLabel(s.king.mood)}」이다. 승지와 사관만 곁에 있다.\n\n"경이 따로 보기를 청했으니, 무슨 일인가."`,
        choices: [
          { key: 'sijeong', label: '시정(時政)의 득실을 아뢴다', hint: `${vsText(p.politics, k.politics, '정치력')} ≥ 2. 되면 성심 +4, 안 되면 성심 -1. 정치 경험 +3` },
          { key: 'probe', label: '넌지시 임금의 의중을 살핀다', hint: '정치에 밝은 임금일수록 속내를 감춘다. 어느 당을 믿고 어느 당을 경계하는지, 지금의 국본 논의에서 어느 쪽을 바라는지, 어떤 법을 바라는지 짐작한다' },
          ...(pf ? [{ key: 'defend', label: `${FACTION_META[pf].name}의 처지를 변호한다`, hint: `${vsText(p.politics, k.politics, '정치력')} ≥ ${(s.king.lean[pf] ?? 0) < 0 ? 4 : 3}. 되면 왕이 당을 보는 마음 +5, 안 되면 -2에 성심 -2` }] : []),
          ...(pro ? [{ key: 'recommend', label: `${josa(pro.name, '을/를')} 천거한다`, hint: `${pro.name}: 임용 점수 +8 (6달). 그가 신세를 진다. 성심이 낮으면 임금이 사사로운 천거로 본다` }] : []),
          ...(sec ? [{ key: 'secret', label: `${sec[0].name}의 「${sec[1]}」을 은밀히 아뢴다 (밀계)`, hint: `${sec[0].name}의 성심 -15, 당신의 성심 +3. 30% 확률로 「밀계」라는 숨은 흠결이 남는다` }] : []),
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const kn = kingName(s);
      const k = kingProfile(s);
      if (key === 'sijeong') {
        s.player.exp.politics += 3;
        const r = d6(s) + p.politics - k.politics + (p.favor >= 40 ? 1 : 0) + (p.traits.includes('eloquent') ? 1 : 0);
        if (r >= 2) {
          fav(p, 4);
          return `시정의 득실을 아뢰자 ${josa(kn, '이/가')} "경의 말이 옳다" 하며 승지에게 받아 적게 했다. (판정 ${r}, 성심 +4)`;
        }
        fav(p, -1);
        return `아뢰었으나 ${kn}의 표정이 시큰둥했다. "알았다. 물러가라." (판정 ${r} < 2, 성심 -1)`;
      }
      if (key === 'probe') {
        const lines: string[] = [];
        const fs = activeFactions(s).map((f) => [f, s.king.lean[f] ?? 0] as [FactionId, number]).sort((a, b) => b[1] - a[1]);
        const sharp = d6(s) + p.politics - k.politics >= 2;
        for (const [f, v] of fs) lines.push(`· ${FACTION_META[f].name}: ${sharp ? leanWord(v) : v >= 0 ? '나쁘지 않게 보는 듯하다' : '탐탁지 않게 보는 듯하다'}`);
        const gs = gukbonSit(s);
        if (gs) {
          const t = GUKBON_TOPICS[gs.data.topic];
          const side = gs.data.kingSide === 'a' ? t.a : t.b;
          lines.push(sharp ? `· 「${t.title}」: 속으로는 「${side.split(' — ')[0]}」 쪽을 바라는 듯하다.` : `· 「${t.title}」: 속내를 드러내지 않는다.`);
        }
        const want = LAWS.filter((l) => lawOpen(s, l) && !s.laws[l.id]?.on && l.king >= 0.4).sort((a, b) => b.king - a.king)[0];
        if (want) lines.push(`· "${want.name} 이야기가 나오면 귀를 기울인다."`);
        const hate = LAWS.filter((l) => s.laws[l.id]?.on && l.king <= -0.3)[0];
        if (hate) lines.push(`· "${lawJosa(hate.name, '을/를')} 두고는 못마땅한 기색이다."`);
        return `한담을 나누며 ${kn}의 속내를 살폈다.${sharp ? '' : ' (정치력이 모자라 또렷이 읽지 못했다)'}\n${lines.join('\n')}`;
      }
      if (key === 'defend' && p.faction !== 'none') {
        const need = (s.king.lean[p.faction] ?? 0) < 0 ? 4 : 3;
        const r = d6(s) + p.politics - k.politics + (p.traits.includes('eloquent') ? 1 : 0);
        if (r >= need) {
          kingLean(s, p.faction, 5);
          return `${FACTION_META[p.faction].name}이 나라를 위하는 마음을 아뢰었다. ${kn}의 표정이 누그러졌다. (판정 ${r}, 왕이 당을 보는 마음 +5)`;
        }
        kingLean(s, p.faction, -2);
        fav(p, -2);
        return `"경도 결국 당을 위해 왔구나." ${josa(kn, '이/가')} 혀를 찼다. (판정 ${r} < ${need}, 왕이 당을 보는 마음 -2, 성심 -2)`;
      }
      if (key === 'recommend') {
        const c = protege(s);
        if (!c) return '천거할 사람이 마땅치 않았다.';
        if (p.favor < 0 && chance(s, 0.5)) {
          fav(p, -2);
          return `${josa(c.name, '을/를')} 천거했지만 ${josa(kn, '은/는')} "경의 사람이구나" 할 뿐이었다. (성심 -2)`;
        }
        s.recs[c.id] = s.t + 6;
        owe(s, c.id);
        sway(s, c, p.id, 12, '어전에서 천거', { decay: 0.12 });
        return `${josa(c.name, '을/를')} 천거하자 ${josa(kn, '이/가')} 이름을 기억해 두겠다고 했다. (${c.name} 임용 점수 +8, 6달)`;
      }
      if (key === 'secret') {
        const t = secretTarget(s);
        if (!t) return '아뢸 일이 없었다.';
        const [c, label] = t;
        fav(c, -15);
        fav(p, 3);
        if (chance(s, 0.3)) addFlaw(s, p, '밀계(密啓)', false, [c.id]);
        log(s, `${josa(p.name, '이/가')} 임금께 은밀히 아뢴 일이 있었다.`, 'player');
        return `${c.name}의 「${label}」을 아뢰었다. ${kn}의 낯빛이 굳었다. "알았다. 이 일은 경과 과인만 아는 것으로 하라." (${c.name} 성심 -15, 당신의 성심 +3)`;
      }
      return '물러났다.';
    },
  },

  king_milji: {
    build(s, c) {
      const f = c.faction as FactionId;
      return {
        title: '밀지(密旨)',
        kind: 'danger',
        text: `밤늦게 내관이 찾아와 봉한 종이를 건넨다. ${kingName(s)}의 친필이다.\n\n"요사이 ${FACTION_META[f].name}의 무리가 조정을 제 집처럼 여긴다. 경은 그들의 동태를 살펴 남모르게 아뢰라."`,
        choices: [
          { key: 'accept', label: '밀지를 받든다', hint: `성심 +6. 「왕의 사람」이 된다. 25% 확률로 ${FACTION_META[f].name}이 눈치챈다 (그 당의 호감 -8)` },
          { key: 'decline', label: '신하의 도리가 아니라며 사양한다', hint: '성심 -3, 명망 +2' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const f = c.faction as FactionId;
      if (key === 'decline') {
        fav(p, -3);
        pres(p, 2);
        return '밀지를 돌려보냈다. "조정의 일은 조정에서 논하소서."';
      }
      fav(p, 6);
      if (!p.tags.includes('kingsman')) p.tags.push('kingsman');
      kingLean(s, f, -3);
      if (chance(s, 0.25)) {
        for (const m of people(s)) if (m.faction === f && !isP(s, m) && chance(s, 0.5)) sway(s, m, p.id, -8, '왕의 귀', { decay: 0.1 });
        return `밀지를 받들었다. 그런데 ${FACTION_META[f].name} 쪽에서 당신이 왕의 귀 노릇을 한다는 말이 돈다. (성심 +6)`;
      }
      return '밀지를 받들었다. 이제 당신은 임금의 눈과 귀다. (성심 +6)';
    },
  },

  king_hasa: {
    build(s) {
      const what = pick(s, ['호피(虎皮) 한 장', '어주(御酒) 한 동이', '내구마(內廐馬) 한 필', '임금이 손수 지은 시 한 수', '내사본(內賜本) 한 질']);
      return {
        title: '하사(下賜)',
        kind: 'personal',
        text: `${josa(kingName(s), '이/가')} 당신의 노고를 치하하며 ${josa(what, '을/를')} 내렸다. 조정 사람들이 부러운 눈으로 본다.`,
        choices: [
          { key: 'bow', label: '대궐에 나아가 사은숙배한다', hint: '명망 +2, 성심 +1' },
          { key: 'decline', label: '공이 없다며 사양하는 글을 올린다', hint: '명망 +3. 임금이 겸양을 가상히 여기기도, 언짢아하기도 한다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'bow') {
        pres(p, 2);
        fav(p, p.traits.includes('loyal') ? 3 : 1);
        return '사은숙배했다. (명망 +2, 성심 +1)';
      }
      pres(p, 3);
      if (chance(s, 0.5)) {
        fav(p, 2);
        return '사양하는 글을 올리자 임금이 그 겸양을 더 가상히 여겼다. (명망 +3, 성심 +2)';
      }
      fav(p, -2);
      return '사양하는 글을 올리자 임금이 "과인의 뜻을 무르는가" 하고 언짢아했다. (명망 +3, 성심 -2)';
    },
  },

  king_rebuke: {
    build(s) {
      return {
        title: '임금의 견책',
        kind: 'danger',
        text: `승지가 와서 ${kingName(s)}의 말을 전한다.\n\n"근래 경의 처신이 신하의 도리에 어긋남이 많다. 과인이 경을 어찌 보아야 하는가."`,
        choices: [
          { key: 'daejoe', label: '거적을 깔고 대죄(待罪)한다', hint: '명망 -1, 성심 +5' },
          { key: 'explain', label: '억울함을 조목조목 해명한다', hint: `주사위 + 정치력 ${P(s).politics} ≥ 8. 되면 성심 +3, 안 되면 성심 -5` },
          { key: 'resign', label: '사직을 청한다', hint: '관직을 내려놓는다. 명망 +2. 임금의 노여움이 가라앉는다 (성심 +4)' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'daejoe') {
        pres(p, -1);
        fav(p, p.traits.includes('loyal') ? 8 : 5);
        return '대궐 앞에 엎드려 대죄했다. 사흘 만에 "대죄하지 말라"는 명이 내렸다. (성심 +5)';
      }
      if (key === 'explain') {
        const r = d6(s) + p.politics;
        if (r >= 8) {
          fav(p, 3);
          return `해명이 이치에 닿았다. 임금이 "과인이 잘못 들었구나" 했다. (판정 ${r}, 성심 +3)`;
        }
        fav(p, -5);
        return `해명할수록 임금의 노여움이 커졌다. (판정 ${r} < 8, 성심 -5)`;
      }
      if (p.office) vacate(s, p);
      pres(p, 2);
      fav(p, 4);
      return '사직소를 올리고 물러났다. 임금의 노여움이 가라앉았다. (명망 +2, 성심 +4)';
    },
  },

  king_chaekmun: {
    build(s) {
      const q = pick(s, [
        '나라의 재정이 날로 궁핍해지는데, 백성을 괴롭히지 않고 곳간을 채울 방도는 무엇인가',
        '붕당의 폐해를 없애려면 어찌해야 하는가',
        '인재를 고루 쓰려면 과거와 천거 가운데 무엇을 중히 여겨야 하는가',
        '변방의 방비를 굳게 하면서 백성의 군역을 덜 방도는 무엇인가',
        '선비의 풍속이 날로 경박해지니 이를 바로잡을 길은 무엇인가',
      ]);
      return {
        title: '친림 책문(親臨策問)',
        kind: 'court',
        text: `${josa(kingName(s), '이/가')} 몸소 문신들을 불러 책문을 내렸다.\n\n"${q}?"\n\n붓을 든 손에 땀이 밴다.`,
        choices: [
          { key: 'honest', label: '소신대로 쓴다', hint: `${vsText(P(s).learning, kingProfile(s).learning, '학식')} ≥ 3. 되면 성심 +5, 명망 +3. 안 되면 성심 -1. 학식 경험 +5` },
          { key: 'safe', label: '무난하게 쓴다', hint: '성심 +1' },
          { key: 'flatter', label: '임금의 뜻에 맞추어 쓴다', hint: '성심 +3, 명망 -2' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'safe') {
        fav(p, 1);
        return '무난한 답안을 냈다. (성심 +1)';
      }
      if (key === 'flatter') {
        fav(p, 3);
        pres(p, -2);
        return '임금의 뜻을 헤아려 답했다. 동료들이 곁눈질한다. (성심 +3, 명망 -2)';
      }
      s.player.exp.learning += 5;
      const r = d6(s) + p.learning - kingProfile(s).learning;
      if (r >= 3) {
        fav(p, 5);
        pres(p, 3);
        s.player.deeds.push(`${yearOf(s.t)} 친림 책문에서 으뜸`);
        return `답안이 으뜸으로 뽑혔다. 임금이 붉은 붓으로 비점을 가득 찍었다. (판정 ${r}, 성심 +5, 명망 +3)`;
      }
      fav(p, -1);
      return `소신대로 썼으나 임금의 눈에 차지 않았다. (판정 ${r} < 3, 성심 -1)`;
    },
  },

  king_ask: {
    build(s, c) {
      const t = s.chars[c.who];
      return {
        title: '인물을 묻다',
        kind: 'court',
        text: `경연이 끝나고 ${josa(kingName(s), '이/가')} 지나가듯 묻는다.\n\n"${officeTitle(t)} ${josa(t.name, '은/는')} 어떤 사람인가?"\n\n${t.name} (${FACTION_META[t.faction].name}, 정치력 ${t.politics} · 학식 ${t.learning})`,
        choices: [
          { key: 'praise', label: '칭찬한다', hint: `${t.name}의 성심 +6. 그가 알게 되면 고마워한다` },
          { key: 'slight', label: '넌지시 깎아내린다', hint: `${t.name}의 성심 -6. 30% 확률로 그가 알게 된다 (호감 -12)` },
          { key: 'none', label: '잘 모른다고 아뢴다', hint: '아무 일도 없다' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const t = s.chars[c.who];
      if (!alive(t)) return '그는 이미 세상을 떠났다.';
      if (key === 'praise') {
        fav(t, 6);
        if (chance(s, 0.5)) sway(s, t, p.id, 8, '어전의 칭찬', { decay: 0.12 });
        return `${josa(t.name, '을/를')} 칭찬했다. 임금이 고개를 끄덕였다.`;
      }
      if (key === 'slight') {
        fav(t, -6);
        if (chance(s, 0.3)) {
          sway(s, t, p.id, -12, '어전의 험담', { decay: 0.1 });
          return `${josa(t.name, '을/를')} 깎아내렸다. 그런데 그 말이 사관의 입을 타고 ${t.name}의 귀에 들어갔다.`;
        }
        return `${josa(t.name, '을/를')} 넌지시 깎아내렸다.`;
      }
      return '잘 모른다고 아뢰었다.';
    },
  },
};

/** 매달: 임금이 먼저 부른다 */
export function tickWang(s: GameState) {
  const p = P(s);
  if (!alive(p) || p.status === 'exiled' || !inCourt(p) || !atSeat(s, p) || s.pending.length >= 2 || s.flags.kingCaptive) return;
  if (monthsSince(s, 'wangEvAt') < 4) return;
  const ill = s.situations.some((x) => x.kind === 'illness');
  if (ill) return;
  const active = p.status === 'active';
  const fire = (def: string, ctx: Record<string, unknown> = {}) => {
    s.flags.wangEvAt = s.t;
    s.flags[`${def}At`] = s.t;
    pushEvent(s, def, ctx);
  };
  // 밀지: 임금이 믿는 신하에게, 경계하는 당을 살피라 한다
  if (active && p.favor >= 40 && p.rank <= 4 && monthsSince(s, 'king_miljiAt') >= 36 && chance(s, 0.012)) {
    const cold = activeFactions(s).filter((f) => (s.king.lean[f] ?? 0) <= -12 && topOf(f) !== topOf(p.faction)).sort((a, b) => (s.king.lean[a] ?? 0) - (s.king.lean[b] ?? 0))[0];
    if (cold) return fire('king_milji', { faction: cold });
  }
  if (active && p.favor >= 60 && monthsSince(s, 'king_hasaAt') >= 24 && chance(s, 0.015)) return fire('king_hasa');
  if (p.favor <= -30 && monthsSince(s, 'king_rebukeAt') >= 24 && chance(s, 0.03)) return fire('king_rebuke');
  // 학문을 즐기는 임금일수록 책문을 자주 낸다 (정조 대에 가장 잦다)
  const scholarKing = s.t >= tOf(1776, 3) && s.t < tOf(1800, 7);
  if (active && p.rank >= 3 && p.learning >= 5 && monthsSince(s, 'king_chaekmunAt') >= 18 && chance(s, scholarKing ? 0.04 : kingProfile(s).zeal >= 2 ? 0.02 : kingProfile(s).zeal < 0 ? 0 : 0.008)) return fire('king_chaekmun');
  if (active && p.rank <= 5 && monthsSince(s, 'king_askAt') >= 12 && chance(s, 0.02)) {
    const pool = people(s).filter((c) => !isP(s, c) && c.status === 'active' && c.office && OFFICE_MAP[c.office] && OFFICE_MAP[c.office].rank <= 4);
    if (pool.length) return fire('king_ask', { who: pick(s, pool).id });
  }
}

