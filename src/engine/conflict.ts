import type { Character, GameState, MemorialTopic } from './types';
import { articleParts, bidap, memorialDraft } from './sangso';
import { OFFICE_MAP } from './data/offices';
import { chance, d6 } from './rng';
import { addFlaw, alive, chargeable, clamp, isP, josa, log, owe, seat } from './state';
import { holderOf, vacate, exileSpot } from './court';
import { opinion, sway, swayFaction, topOf } from './opinion';
import { MAIN_FACTIONS, powerShare } from './factions';
import { END_T, shortDate } from './calendar';
import { fulfillAgainst, fulfillAll } from './relations';
import { LAW_MAP, lawJosa, lawResist, lawStance, setLaw } from './laws';
import { controlsCheongyo, gongronOf } from './strife';

export interface RollPart {
  label: string;
  value: number;
}

export type Outcome = 'severe_backfire' | 'backfire' | 'rejected' | 'shielded' | 'dismiss' | 'strip' | 'exile' | 'spared' | 'wiri' | 'sasa';

export interface ImpeachReport {
  attacker: string;
  target: string;
  aParts: RollPart[];
  dParts: RollPart[];
  aRoll: number;
  dRoll: number;
  aTotal: number;
  dTotal: number;
  outcome: Outcome;
  text: string;
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  severe_backfire: '무고죄로 역풍 (공격자 파직)',
  backfire: '무고로 판명 (공격자 흠결)',
  rejected: '불윤 (기각)',
  shielded: '불윤 (왕이 감쌈)',
  dismiss: '파직',
  strip: '삭탈관작 (문외출송)',
  exile: '유배 (중도부처)',
  spared: '가죄 불윤',
  wiri: '위리안치',
  sasa: '사약',
};

export const SUCCESS: Outcome[] = ['dismiss', 'strip', 'exile', 'wiri', 'sasa'];

const sum = (ps: RollPart[]) => ps.reduce((a, p) => a + p.value, 0);

/** 최근 2년 동안 플레이어가 연 논핵 수. 잦을수록 왕과 조정이 싫증을 낸다. */
export const recentImpeachments = (s: GameState) => s.player.impeachAt.filter((t) => s.t - t <= 24).length;

export function kill(s: GameState, c: Character, cause: string) {
  if (c.status === 'dead') return;
  if (c.office) vacate(s, c);
  c.status = 'dead';
  c.death = { t: s.t, cause };
  log(s, `${josa(c.name, '이/가')} ${cause}.`, isP(s, c) ? 'player' : 'death');
  if (isP(s, c)) {
    // 끝(1821년)까지 반년 넘게 남았으면 자식이 가문을 이을지 묻는다 (succession.ts)
    if (s.t < END_T - 6) s.flags.succession = cause;
    else s.over = { reason: cause, t: s.t };
  }
  if (s.heir === c.id) s.heir = undefined;
}

export function exile(s: GameState, c: Character, byId?: string, quiet = false) {
  if (c.status === 'exiled') {
    const [region, place] = exileSpot(s);
    c.location = region;
    c.exilePlace = place;
    c.prestige = clamp(c.prestige - 3, 0, 100);
    if (!quiet) log(s, `유배 중인 ${josa(c.name, '이/가')} ${place}로 이배(移配)되었다.`, isP(s, c) ? 'player' : 'court');
    if (isP(s, c)) s.player.deeds.push(`${shortDate(s.t)} ${place}로 이배`);
    return;
  }
  vacate(s, c, 'exiled');
  const [region, place] = exileSpot(s);
  c.location = region;
  c.exilePlace = place;
  c.exiledBy = byId;
  c.exiledAt = s.t;
  c.exileLevel = 1;
  c.prestige = clamp(c.prestige - 8, 0, 100);
  if (!quiet) log(s, `${josa(c.name, '이/가')} ${place}에 유배되었다.`, isP(s, c) ? 'player' : 'court');
  if (isP(s, c)) {
    s.player.stats.exiled++;
    s.player.deeds.push(`${shortDate(s.t)} ${place} 유배`);
    if (s.player.focus && !['study', 'rest'].includes(s.player.focus.kind)) s.player.focus = null;
  }
}

export function recall(s: GameState, c: Character) {
  c.status = 'idle';
  c.location = seat(s);
  c.exilePlace = undefined;
  c.exileLevel = undefined;
  if (c.exiledBy && !c.grudges.includes(c.exiledBy) && alive(s.chars[c.exiledBy])) c.grudges.push(c.exiledBy);
  c.exiledBy = undefined;
  log(s, `${josa(c.name, '이/가')} 유배에서 풀려나 한성으로 돌아왔다.`, isP(s, c) ? 'player' : 'court');
  if (isP(s, c)) s.player.deeds.push(`${shortDate(s.t)} 해배`);
}

/**
 * 기획안 4.1 탄핵: 1d6 + 정치력 + 상대 흠결 vs 1d6 + 정치력. 격차로 결과가 갈린다.
 * 탄핵만으로는 죽지 않는다. 사사는 유배 뒤 가죄(加罪) 논의나 옥사에서만 나온다.
 */
export function impeach(
  s: GameState,
  atk: Character,
  tgt: Character,
  opt: { bonus?: RollPart[]; defBonus?: RollPart[]; response?: 'explain' | 'endure'; quiet?: boolean; hapgye?: number; charges?: string[]; pungmun?: boolean } = {},
): ImpeachReport {
  const aParts: RollPart[] = [{ label: '정치력', value: atk.politics }];
  // 고른 죄목만 쓴다. 고르지 않은 흠결은 다음을 위해 남는다
  const flaws = chargeable(s, tgt, atk.id).filter((f) => !opt.charges || opt.charges.includes(f.id));
  if (flaws.length) aParts.push({ label: `흠결 ${flaws.length}개`, value: flaws.length });
  const atkSamsa = !!(atk.office && OFFICE_MAP[atk.office]?.samsa);
  if (atkSamsa) aParts.push({ label: '삼사 언관', value: 1 });
  // 대간이 대신을 논하는 것은 공론의 몫이다
  const tgtSamsa = !!(tgt.office && OFFICE_MAP[tgt.office]?.samsa);
  if (atkSamsa && !tgtSamsa && tgt.rank <= 3) aParts.push({ label: tgt.rank <= 1 ? '대간이 정승을 논함' : '대간이 대신을 논함', value: tgt.rank <= 1 ? 2 : 1 });
  if (atk.traits.includes('upright') || atk.traits.includes('radical')) aParts.push({ label: '강경한 기질', value: 1 });
  if (atk.traits.includes('mild')) aParts.push({ label: '온건한 기질', value: -1 });
  if (atk.grudges.includes(tgt.id)) aParts.push({ label: '설욕', value: 2 });
  if ((powerShare(s)[atk.faction] ?? 0) > 0.55 && atk.faction !== 'none') aParts.push({ label: '당세 우위', value: 1 });
  if (atk.faction !== 'none' && atk.faction !== tgt.faction && controlsCheongyo(s, atk.faction)) aParts.push({ label: '언로 장악', value: 1 });
  const gr = gongronOf(s);
  const gd = (gr[atk.faction] ?? 0) - (gr[tgt.faction] ?? 0);
  if (atk.faction !== tgt.faction && gd >= 0.15) aParts.push({ label: '사림의 공론', value: 1 });
  if (isP(s, atk)) {
    // 2년에 두 번까지는 괜찮고, 그보다 잦으면 공격이 약해진다
    const n = recentImpeachments(s) - 2;
    if (n > 0) aParts.push({ label: `잦은 탄핵 (2년 새 ${n + 2}번째)`, value: -Math.min(2, n) });
  }
  for (const b of opt.bonus ?? []) if (b.value) aParts.push(b);

  const dParts: RollPart[] = [{ label: '정치력', value: tgt.politics }];
  const pr = Math.floor(tgt.prestige / 25);
  if (pr) dParts.push({ label: '명망', value: pr });
  const fv = tgt.favor >= 50 ? 2 : tgt.favor >= 20 ? 1 : tgt.favor <= -30 ? -1 : 0;
  if (fv) dParts.push({ label: '성심', value: fv });
  if (tgt.traits.includes('clean')) dParts.push({ label: '청렴', value: 1 });
  if (opt.response === 'explain') dParts.push({ label: '해명 상소', value: 1 });
  if (atk.faction !== tgt.faction && gd <= -0.15) dParts.push({ label: '사림의 공론', value: 1 });
  for (const b of opt.defBonus ?? []) if (b.value) dParts.push(b);

  const aRoll = d6(s);
  const dRoll = d6(s);
  const aTotal = aRoll + sum(aParts);
  const dTotal = dRoll + sum(dParts);
  const diff = aTotal - dTotal;
  let outcome: Outcome =
    diff <= -4 ? 'severe_backfire' : diff <= -1 ? 'backfire' : diff === 0 ? 'rejected' : diff <= 2 ? 'dismiss' : diff <= 4 ? 'strip' : 'exile';
  if (tgt.favor >= 50) {
    if (outcome === 'exile') outcome = 'strip';
    else if (outcome === 'strip') outcome = 'dismiss';
  }
  // 왕이 아끼는 신하는 탄핵이 이겨도 끝내 윤허하지 않기도 한다. 삼사가 합계하면 버티지 못한다.
  if (SUCCESS.includes(outcome) && (opt.hapgye ?? 0) < 3) {
    const lean = tgt.faction !== 'none' ? (s.king?.lean[tgt.faction] ?? 0) : 0;
    const shield = (tgt.favor - 45) / 100 + Math.max(0, lean) / 200 - (opt.hapgye === 2 ? 0.15 : 0);
    if (shield > 0 && chance(s, shield)) outcome = 'shielded';
  }

  const success = SUCCESS.includes(outcome);
  const fakes = flaws.filter((f) => f.fake);
  let exposed = false;
  if (fakes.length && !success && chance(s, 0.5)) {
    exposed = true;
    tgt.flaws = tgt.flaws.filter((f) => !f.fake);
    addFlaw(s, atk, '혐의 날조', true);
    atk.favor = clamp(atk.favor - 10, -100, 100);
  }
  for (const f of flaws) {
    f.public = true;
    f.usedAt = s.t;
    // 벌을 받았으면 그 허물은 갚은 셈이다
    if (success) f.settled = true;
  }
  const sameTop = topOf(atk.faction) === topOf(tgt.faction) && atk.faction !== 'none';

  switch (outcome) {
    case 'severe_backfire':
      if (atk.office) vacate(s, atk);
      if (!opt.pungmun) addFlaw(s, atk, '무고(誣告)', true);
      atk.favor = clamp(atk.favor - 10, -100, 100);
      break;
    case 'backfire':
      // 대간은 풍문으로 논해도 무고의 죄를 묻지 않는다 (풍문거핵)
      if (!opt.pungmun) addFlaw(s, atk, '무고(誣告)', true);
      atk.favor = clamp(atk.favor - 5, -100, 100);
      break;
    case 'rejected':
      atk.favor = clamp(atk.favor - 3, -100, 100);
      break;
    case 'shielded':
      atk.favor = clamp(atk.favor - 2, -100, 100);
      s.tension = clamp(s.tension + 2, 0, 100);
      break;
    case 'dismiss':
      vacate(s, tgt);
      tgt.prestige = clamp(tgt.prestige - 5, 0, 100);
      break;
    case 'strip':
      vacate(s, tgt, 'retired');
      tgt.banUntil = s.t + 12;
      tgt.prestige = clamp(tgt.prestige - 6, 0, 100);
      tgt.favor = clamp(tgt.favor - 6, -100, 100);
      break;
    case 'exile':
      exile(s, tgt, atk.id, true);
      break;
  }

  if (success) {
    sway(s, tgt, atk.id, -40, '탄핵의 원한', { clan: 0.6, decay: 0.1 });
    if (!sameTop && tgt.faction !== 'none') {
      swayFaction(s, tgt.faction, atk.id, -6, '정적', 0.05);
      swayFaction(s, atk.faction, atk.id, 5, '당론에 공헌', 0.1);
    }
    if (sameTop) {
      swayFaction(s, atk.faction, atk.id, -12, '동당을 공격', 0.1);
      s.factions[topOf(atk.faction)].division += 4;
    }
    s.tension = clamp(s.tension + 2, 0, 100);
  } else {
    sway(s, tgt, atk.id, -20, '부당한 탄핵', { clan: 0.4, decay: 0.15 });
    s.tension = clamp(s.tension + 1, 0, 100);
  }

  if (isP(s, atk)) {
    if (success) s.player.stats.impeachWins++;
    else s.player.stats.impeachFails++;
    s.player.deeds.push(`${shortDate(s.t)} ${tgt.name} 탄핵 — ${OUTCOME_LABEL[outcome]}`);
  }

  const text =
    `${josa(atk.name, '이/가')} ${josa(tgt.name, '을/를')} 탄핵했다 — ${OUTCOME_LABEL[outcome]}` +
    (exposed ? `. 내세운 혐의가 날조였음이 드러났다` : '');
  if (!opt.quiet) log(s, text, isP(s, atk) || isP(s, tgt) ? 'player' : 'court');
  return { attacker: atk.id, target: tgt.id, aParts, dParts, aRoll, dRoll, aTotal, dTotal, outcome, text };
}

export interface PurgeLine {
  id: string;
  roll?: number;
  result: '사사' | '유배' | '파직' | '무사';
}

/** 옥사 판정: 1d6 + 정치력/2 (내림). 2 이하면 사사, 5 이하면 유배, 6 이상이면 무사. */
export const PURGE_RULE = { death: 2, exile: 5 } as const;
export const purgeJudge = (roll: number, politics: number): PurgeLine['result'] => {
  const v = roll + Math.floor(politics / 2);
  return v <= PURGE_RULE.death ? '사사' : v <= PURGE_RULE.exile ? '유배' : '무사';
};

/**
 * 옥사·환국의 판정. 당상관과 연루자는 1d6 + 정치력/2로 판정한다:
 * 2 이하 사사, 5 이하 유배, 6 이상 무사. 수완이 좋을수록 빠져나가기 쉽다.
 * (예전 규칙은 눈 = 정치력이면 사사, 작으면 유배라, 정치력 7 이상은 반드시 유배되었다.)
 * 당하관은 파직만 당한다. harsh 대상(역모 연루)은 품계와 상관없이 당상관 규칙을 따른다.
 */
export function purge(s: GameState, targets: Character[], harshIds: string[], reroll: string[] = []): PurgeLine[] {
  const out: PurgeLine[] = [];
  for (const c of targets) {
    if (!alive(c)) continue;
    const heavy = c.rank <= 3 || harshIds.includes(c.id);
    if (!heavy) {
      if (c.office && chance(s, 0.5)) {
        vacate(s, c);
        out.push({ id: c.id, result: '파직' });
      } else out.push({ id: c.id, result: '무사' });
      continue;
    }
    const judge = (r: number) => purgeJudge(r, c.politics);
    let roll = d6(s);
    let res: PurgeLine['result'] = judge(roll);
    if (res !== '무사' && reroll.includes(c.id)) {
      roll = d6(s);
      res = judge(roll);
    }
    if (res === '사사') kill(s, c, '옥사에 연루되어 죽었다');
    else if (res === '유배') exile(s, c, undefined, true);
    out.push({ id: c.id, roll, result: res });
  }
  return out;
}

export interface MemorialResult {
  success: boolean;
  veto?: string;
  roll: number;
  total: number;
  difficulty: number;
  parts: RollPart[];
  text: string;
  disaster: boolean;
  /** 상소문의 한 대목 */
  draft?: string;
  /** 임금의 비답 */
  bidap?: string;
}

export const TOPIC_LABEL: Record<MemorialTopic, string> = {
  sipye: '시폐(時弊) 상소',
  jojae: '조제보합(調劑保合) 상소',
  recall: '신원(伸冤) 상소',
  law: '변법(變法) 상소',
};

/** 기획안 4.2 상소: 1d6 + 연명 + 상황 ≥ 왕의 선호도 */
export function memorial(
  s: GameState,
  init: Character,
  topic: MemorialTopic,
  cosigners: string[],
  targetId?: string,
  opt: { lawId?: string; abolish?: boolean; articles?: string[] } = {},
): MemorialResult {
  const arts = opt.articles ?? [];
  const draft = memorialDraft(s, init, topic, arts, { lawId: opt.lawId, abolish: opt.abolish, targetId });
  const tgt = targetId ? s.chars[targetId] : undefined;
  const law = topic === 'law' && opt.lawId ? LAW_MAP[opt.lawId] : undefined;
  const enact = !opt.abolish;
  const ds = holderOf(s, 'doseungji');
  if (ds && ds.id !== init.id && !cosigners.includes(ds.id) && !isP(s, ds) && opinion(s, ds, init) < -15 && chance(s, 0.35)) {
    addFlaw(s, ds, '언로 차단', true);
    const text = `도승지 ${josa(ds.name, '이/가')} ${init.name}의 ${josa(TOPIC_LABEL[topic], '을/를')} 왕에게 올리지 않고 돌려보냈다.`;
    log(s, text, isP(s, init) ? 'player' : 'court');
    if (isP(s, init)) sway(s, ds, init.id, -5, '상소 봉환', {});
    return { success: false, veto: ds.id, roll: 0, total: 0, difficulty: 0, parts: [], text, disaster: false, draft };
  }

  const parts: RollPart[] = [];
  const n = Math.min(3, cosigners.length);
  if (n) parts.push({ label: `연명 ${cosigners.length}인`, value: n });
  if (init.learning >= 5) parts.push({ label: '학식', value: 1 });
  if (init.traits.includes('writer')) parts.push({ label: '문장가', value: 1 });
  if ((powerShare(s)[init.faction] ?? 0) > 0.5 && init.faction !== 'none') parts.push({ label: '당세 우위', value: 1 });
  if (topic === 'jojae' && init.traits.includes('mediator')) parts.push({ label: '조제의 인품', value: 1 });
  if (init.favor >= 40) parts.push({ label: '성심', value: 1 });
  if (init.favor <= -30) parts.push({ label: '성심 잃음', value: -1 });
  const mood = s.king?.mood ?? 0;
  if (mood >= 40) parts.push({ label: '용안이 밝음', value: 1 });
  if (mood <= -40) parts.push({ label: '용안이 어두움', value: -1 });
  if (s.situations?.some((x) => x.kind === 'omen')) parts.push({ label: '구언(求言)', value: 1 });
  if (s.situations?.some((x) => x.kind === 'illness')) parts.push({ label: '왕의 환후', value: -1 });
  parts.push(...articleParts(s, init, topic, arts));

  let difficulty = topic === 'sipye' ? 5 : 6;
  if (law) {
    // 왕의 마음과 조정 세력의 입장이 법의 어려움을 정한다
    const k = enact ? law.king : -law.king;
    const share = powerShare(s);
    const court = MAIN_FACTIONS.reduce((a, f) => a + (share[f] ?? 0) * lawStance(law, f, enact), 0);
    difficulty = Math.round(7 - k * 2 - court * 3 + lawResist(law, enact) * 6);
  }
  if (topic === 'jojae' && s.tension > 60) difficulty += 1;
  if (topic === 'recall' && tgt?.tags.includes('royalWrath')) difficulty += 2;

  const roll = d6(s);
  const total = roll + sum(parts);
  const success = total >= difficulty;
  const disaster = !success && !arts.includes('daejoe') && total <= difficulty - (arts.includes('jikgan') ? 3 : 4);
  let dismissed = false;
  let text = '';

  if (success) {
    switch (topic) {
      case 'sipye':
        init.prestige = clamp(init.prestige + 4 + (init.traits.includes('upright') ? 2 : 0), 0, 100);
        init.favor = clamp(init.favor + 3, -100, 100);
        text = `${init.name}의 시폐 상소가 가납되었다. 명망이 올랐다.`;
        break;
      case 'law':
        if (law) {
          setLaw(s, law.id, enact, init.name);
          init.prestige = clamp(init.prestige + 5, 0, 100);
          for (const f of MAIN_FACTIONS) {
            if (!s.factions[f].active) continue;
            const v = lawStance(law, f, enact);
            if (Math.abs(v) >= 0.3) swayFaction(s, f, init.id, Math.round(v * 8), enact ? `${law.name} 시행` : `${law.name} 폐지`, 0.08);
          }
          if (law.id === 'sumi' || law.id === 'daedong' || law.id === 'nobi')
            for (const c of Object.values(s.chars)) if (alive(c) && !isP(s, c) && c.traits.includes('greedy') && c.rank <= 4) sway(s, c, init.id, -6, '이권을 막음', { decay: 0.1 });
          text = `${init.name}의 상소로 ${lawJosa(law.name, '이/가')} ${enact ? '시행되었다' : '폐지되었다'}.`;
        }
        break;
      case 'jojae':
        s.tension = clamp(s.tension - 12, 0, 100);
        init.prestige = clamp(init.prestige + 5, 0, 100);
        for (const f of MAIN_FACTIONS) {
          if (s.factions[f].active && f !== init.faction) swayFaction(s, f, init.id, 3, '조제의 뜻', 0.1);
        }
        if (init.faction !== 'none') swayFaction(s, init.faction, init.id, -4, '당론을 흐림', 0.1);
        if (isP(s, init)) {
          s.player.stats.jojae++;
          fulfillAll(s, 'peace');
        }
        text = `${init.name}의 조제 상소에 왕이 공감했다. 붕당 간 긴장이 누그러졌다.`;
        break;
      case 'recall':
        if (tgt && tgt.status === 'exiled') {
          recall(s, tgt);
          tgt.tags = tgt.tags.filter((x) => x !== 'royalWrath');
          sway(s, tgt, init.id, 40, '신원의 은혜', { clan: 0.4, faction: 0.15, decay: 0.08 });
          if (isP(s, init)) {
            owe(s, tgt.id, 2);
            fulfillAgainst(s, 'recall', tgt.id);
          }
        }
        text = `${tgt?.name ?? ''}의 신원 상소가 받아들여졌다.`;
        break;
    }
    for (const id of cosigners) {
      const c = s.chars[id];
      if (alive(c)) {
        c.prestige = clamp(c.prestige + 2, 0, 100);
        if (!isP(s, c)) sway(s, c, init.id, 4, '함께 올린 상소', {});
      }
    }
  } else {
    if (topic === 'sipye') init.prestige = clamp(init.prestige + 1, 0, 100);
    if (law) s.flags[`lawFail_${law.id}`] = s.t;
    text = law
      ? `${lawJosa(law.name, '을/를')} ${enact ? '세우자는' : '없애자는'} ${init.name}의 상소가 받아들여지지 않았다.`
      : `${init.name}의 ${josa(TOPIC_LABEL[topic], '이/가')} 받아들여지지 않았다.`;
    if (disaster) {
      init.favor = clamp(init.favor - 12, -100, 100);
      text += ' 왕이 크게 노하여 성심을 잃었다.';
      if (init.office && chance(s, 0.4)) {
        vacate(s, init);
        dismissed = true;
        text += ' 관직에서 물러났다.';
      }
    }
    if (arts.includes('jikgan')) init.favor = clamp(init.favor - 5, -100, 100);
  }
  // 조목이 남기는 뒷맛
  if (success && arts.includes('jikgan')) init.prestige = clamp(init.prestige + 3, 0, 100);
  if (arts.includes('dangron') && init.faction !== 'none') {
    s.tension = clamp(s.tension + 3, 0, 100);
    swayFaction(s, init.faction, init.id, 3, '당론을 세운 상소', 0.1);
    const foe = MAIN_FACTIONS.filter((f) => s.factions[f].active && topOf(f) !== topOf(init.faction)).sort((a, b) => (powerShare(s)[b] ?? 0) - (powerShare(s)[a] ?? 0))[0];
    if (foe) swayFaction(s, foe, init.id, -4, '당을 논박한 상소', 0.1);
  }
  const reply = bidap(s, success, disaster, topic, arts, dismissed);
  if (isP(s, init)) s.player.stats.memorials++;
  log(s, text, isP(s, init) ? 'player' : 'court');
  return { success, roll, total, difficulty, parts, text, disaster, draft, bidap: reply };
}