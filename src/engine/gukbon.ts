import { legitOf } from './legit';
import type { FactionId, GameState, Situation } from './types';
import type { EventDef } from './events/types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { tOf, yearOf } from './calendar';
import { chance, rand, randInt } from './rng';
import { addFlaw, age, alive, clamp, fav, inCourt, isP, josa, log, monthsSince, notice, P, pres, pushEvent, uid } from './state';
import { swayFaction, topOf } from './opinion';
import { activeFactions, powerShare } from './factions';
import { kingLean, kingMood } from './king';
import { vacate } from './court';
import { exile } from './conflict';

/* ───────── 선조 이후의 국본(國本) 논의 ─────────
 * 왕대마다 꼭 일어나지는 않는다. 왕의 권위(용안)가 낮거나, 왕이 병들었거나, 늙도록 세자가 없을 때 잘 일어난다.
 * 두 갈래(가·나)로 조정이 갈리고, 왕은 속으로 한쪽을 바란다.
 * 왕의 권위가 높으면 왕의 뜻대로, 낮으면 힘센 당들의 뜻대로 끝난다. 왕의 뜻을 꺾으면 왕권이 더 떨어진다.
 * 역사에 있었던 논의(원손·원자 정호·세제 책봉·세손 대리청정)는 결말이 정해져 있다. 그 사이에서 어느 쪽에 섰는지가 남는다.
 */

type Side = 'a' | 'b';

interface Topic {
  title: string;
  /** 논의가 일어난 까닭 */
  text: string;
  a: string;
  b: string;
  /** 왕이 바라는 쪽. 함수면 논의가 일 때 정한다 */
  king: Side | ((s: GameState) => Side);
  /** 가(a)를 미는 당론 (+면 가, -면 나). 당 이름 또는 서인·동인 계열로 */
  stance: Partial<Record<FactionId, number>>;
  /** 역사대로 정해진 결말 */
  fixed?: Side;
  /** 역사 쪽이 크게 유리하지만 뒤집힐 수 있는 결말 (대체역사의 갈래). 반대쪽이 이길 확률은 많아야 25% */
  hard?: Side;
  /** 논의 기간 (달) */
  months: [number, number];
  /** 끝났을 때 */
  done: (s: GameState, win: Side) => string;
}

export const heirKey = (s: GameState) => `heirSet_${String(s.flags.kingId ?? 'seonjo')}`;
const kingChar = (s: GameState) => s.chars[String(s.flags.kingId ?? 'seonjo')];
const reignYears = (s: GameState) => (typeof s.flags.reignFrom === 'number' ? (s.t - (s.flags.reignFrom as number)) / 12 : 99);

export const TOPICS: Record<string, Topic> = {
  // ── 역사의 논의 ──
  wonson: {
    title: '원손이냐 봉림대군이냐',
    text: '볼모에서 돌아온 소현세자가 갑자기 세상을 떠났다. 법도대로라면 세자의 맏아들인 원손이 뒤를 이어야 한다. 그러나 왕은 둘째 아들 봉림대군을 세자로 세우려 한다.',
    a: '봉림대군을 세자로 세운다 — 나라가 어지러우니 장성한 대군이 낫다',
    b: '원손을 세워야 한다 — 적통의 법도를 어길 수 없다',
    king: 'a',
    stance: { seo: -0.3, nam: -0.4 },
    hard: 'a',
    months: [2, 3],
    done: (s, win) => {
      if (win === 'b') {
        s.flags.wonsonKept = true;
        return '신하들이 끝내 물러서지 않자 왕이 원손을 세손(世孫)으로 세웠다. 왕은 원손을 볼 때마다 낯빛이 굳는다.';
      }
      s.flags.wonsonAt = s.t;
      return '왕이 봉림대군을 세자로 세웠다. 원손을 세우자던 신하들이 줄줄이 물러났다.';
    },
  },
  wonja: {
    title: '원자 정호(元子定號)',
    text: '희빈 장씨가 왕자를 낳았다. 왕은 갓난 왕자를 곧바로 원자로 정하려 한다. 중전이 아직 젊으니 기다려야 한다는 말이 서인 쪽에서 나온다.',
    a: '원자로 정한다 — 국본을 일찍 정해야 나라가 편하다',
    b: '중전이 젊으니 기다려야 한다',
    king: 'a',
    stance: { nam: 0.7, seo: -0.6, noron: -0.7, soron: -0.4 },
    fixed: 'a',
    months: [2, 2],
    done: () => '왕이 희빈 장씨의 아들을 원자로 정했다. 반대한 서인들에게 왕의 노여움이 쌓인다.',
  },
  seje: {
    title: '세제 책봉(世弟冊封)',
    text: '병약한 왕에게 후사가 없다. 노론은 왕의 아우 연잉군을 세제로 세우자고 서두르고, 소론은 왕이 아직 젊은데 무엄하다며 맞선다.',
    a: '연잉군을 세제로 세운다',
    b: '왕이 젊으니 서두를 일이 아니다',
    king: 'b',
    stance: { noron: 0.9, soron: -0.7, nam: -0.3 },
    hard: 'a',
    months: [2, 3],
    done: (s, win) => {
      if (win === 'b') {
        s.flags.sejeFailed = true;
        return '세제 책봉이 무산되었다. 연잉군은 사저에 칩거하고, 노론은 숨을 죽인다. 소론은 종친 가운데 후사를 고르자는 말을 꺼낸다.';
      }
      s.flags[heirKey(s)] = s.t;
      return '대비의 뜻으로 연잉군이 세제가 되었다. 노론이 내친김에 대리청정까지 밀어붙이자 소론의 칼이 노론을 겨눈다.';
    },
  },
  daeri_seson: {
    title: '세손의 대리청정',
    text: '여든을 넘긴 왕이 기력이 쇠하자 세손에게 정사를 맡기겠다고 한다. 홍인한은 "세손은 노론과 소론을, 이조판서와 병조판서를 알 필요가 없다"며 막아선다.',
    a: '세손의 대리청정을 받든다',
    b: '세손은 아직 정사를 알 필요가 없다',
    king: 'a',
    stance: { noron: -0.4, soron: 0.3, nam: 0.5 },
    fixed: 'a',
    months: [2, 3],
    done: () => '세손이 대리청정에 나섰다. 대리청정을 막아선 이들의 이름을 세손이 하나하나 적어 두었다는 말이 돈다.',
  },

  // ── 왕대마다 일어날 수 있는 논의 ──
  chaekbong: {
    title: '세자 책봉',
    text: '왕이 즉위한 지 여러 해가 되도록 세자가 정해지지 않았다. 대신들이 국본을 서둘러 정하자고 청한다. 왕은 재촉받는 것을 싫어한다.',
    a: '세자 책봉을 서두르자',
    b: '왕의 뜻을 기다려야 한다',
    king: (s) => (chance(s, 0.65) ? 'b' : 'a'),
    stance: {},
    months: [4, 8],
    done: (s, win) => {
      if (win === 'a') {
        s.flags[heirKey(s)] = s.t;
        return '세자가 책봉되었다. 국본이 섰다.';
      }
      return '책봉 논의가 거두어졌다. 국본은 여전히 비어 있다.';
    },
  },
  yangja: {
    title: '후사(後嗣) 논의',
    text: '왕이 마흔을 바라보도록 후사가 없다. 종친 가운데 하나를 골라 후사로 삼자는 말이 나온다. 왕자를 기다려야 한다는 쪽은 그 말이 불충하다고 한다.',
    a: '종친 가운데 후사를 정하자',
    b: '왕자가 태어나기를 기다려야 한다',
    king: (s) => (chance(s, 0.75) ? 'b' : 'a'),
    stance: {},
    months: [4, 8],
    done: (s, win) => {
      if (win === 'a') {
        s.flags[heirKey(s)] = s.t;
        return '종친의 아들이 후사로 정해졌다.';
      }
      return '후사 논의가 거두어졌다. 왕자가 태어나기를 기다리기로 했다.';
    },
  },
  daeri: {
    title: '세자의 대리청정',
    text: '왕이 병석에 누운 날이 길어지자 세자에게 정사를 맡기자는 말이 나온다. 대리청정을 받드는 쪽과, 왕의 권한을 나누는 것은 불충이라는 쪽이 맞선다.',
    a: '세자의 대리청정을 청한다',
    b: '대리청정은 불가하다',
    king: (s) => (s.situations.some((x) => x.kind === 'illness') ? (chance(s, 0.5) ? 'a' : 'b') : chance(s, 0.7) ? 'b' : 'a'),
    stance: {},
    months: [3, 6],
    done: (s, win) => {
      if (win === 'a') {
        s.flags.daeriUntil = s.t + 24;
        return '세자가 대리청정에 나섰다. 대신들이 동궁에 줄을 대기 시작한다.';
      }
      return '대리청정 논의가 거두어졌다.';
    },
  },
  pye: {
    title: '세자 교체',
    text: '세자의 행실을 두고 흉흉한 말이 돈다. 세자를 바꾸어야 한다는 쪽과, 국본은 함부로 흔들 수 없다는 쪽이 맞선다. 진 쪽은 무사하지 못할 것이다.',
    a: '세자를 바꾸어야 한다',
    b: '국본은 흔들 수 없다',
    king: (s) => (chance(s, 0.4) ? 'a' : 'b'),
    stance: {},
    months: [4, 7],
    done: (s, win) => {
      if (win === 'a') {
        s.flags[heirKey(s)] = s.t;
        s.tension = clamp(s.tension + 6, 0, 100);
        return '세자가 폐위되고 다른 왕자가 세자로 섰다. 폐세자를 감싸던 이들이 숨을 죽인다.';
      }
      return '세자의 자리가 지켜졌다. 세자를 흔들던 이들이 역풍을 맞는다.';
    },
  },
};

export const gukbonSit = (s: GameState) => s.situations.find((x) => x.kind === 'gukbon');

/** 이 당이 이 논의에서 가(a)를 미는 마음 */
function factionLean(t: Topic, f: FactionId, kingSide: Side, s: GameState, noise: number) {
  const st = t.stance[f] ?? t.stance[topOf(f)] ?? 0;
  const near = ((s.king.lean[f] ?? 0) / 50) * (kingSide === 'a' ? 1 : -1);
  return st + near + noise;
}

export function startGukbon(s: GameState, id: string, cause?: string) {
  if (gukbonSit(s)) return;
  const t = TOPICS[id];
  if (!t) return;
  const kingSide = typeof t.king === 'function' ? t.king(s) : t.king;
  const picks: Partial<Record<FactionId, Side>> = {};
  for (const f of activeFactions(s)) picks[f] = factionLean(t, f, kingSide, s, (rand(s) - 0.5) * (t.fixed ? 0.3 : 1)) >= 0 ? 'a' : 'b';
  // 모든 당이 한쪽이면 논의가 되지 않는다: 왕과 가장 먼 당이 맞선다
  const sides = new Set(Object.values(picks));
  if (sides.size < 2) {
    const fs = activeFactions(s);
    const far = [...fs].sort((x, y) => (s.king.lean[x] ?? 0) - (s.king.lean[y] ?? 0))[0];
    if (far) picks[far] = picks[far] === 'a' ? 'b' : 'a';
  }
  const sit: Situation = {
    id: uid(s, 'sit'),
    kind: 'gukbon',
    since: s.t,
    until: s.t + randInt(s, t.months[0], t.months[1]),
    data: { topic: id, kingSide, picks, side: undefined, pub: false },
  };
  s.situations.push(sit);
  s.flags.gukbonAt = s.t;
  s.tension = clamp(s.tension + 4, 0, 100);
  const who = (side: Side) =>
    activeFactions(s)
      .filter((f) => picks[f] === side)
      .map((f) => FACTION_META[f].name)
      .join('·') || '아무도';
  log(s, `[국본] ${cause ? `${cause} ` : ''}「${t.title}」${josa(t.title.replace(/\([^)]*\)/g, ''), '을/를').slice(-1)} 두고 조정이 갈렸다. ${who('a')}은 「${short(t.a)}」, ${who('b')}은 「${short(t.b)}」 쪽이다.`, 'history');
  const p = P(s);
  if (alive(p) && p.status !== 'exiled' && s.pending.length < 3) pushEvent(s, 'gukbon_open', {});
}

const short = (x: string) => x.split(' — ')[0];

/** 지금 이 논의에서 가(a)가 이길 확률 */
export function gukbonOdds(s: GameState, sit: Situation): number {
  const t = TOPICS[sit.data.topic];
  if (t.fixed) return t.fixed === 'a' ? 1 : 0;
  if (t.hard) {
    // 역사를 뒤집기는 어렵다: 형세가 아무리 좋아도 25%를 넘지 못한다
    const normal = gukbonOddsRaw(s, sit);
    const histA = t.hard === 'a';
    // 저절로는 열에 하나 남짓, 플레이어가 앞장서면 넷에 하나까지
    const altPush = sit.data.side && sit.data.pub && sit.data.side !== t.hard ? 0.1 : 0;
    const alt = clamp((histA ? 1 - normal : normal) * 0.15 + altPush, 0.01, 0.25);
    return histA ? 1 - alt : alt;
  }
  return gukbonOddsRaw(s, sit);
}

function gukbonOddsRaw(s: GameState, sit: Situation): number {
  const share = powerShare(s);
  let a = 0;
  let b = 0;
  for (const f of activeFactions(s)) {
    if (sit.data.picks[f] === 'a') a += share[f] ?? 0;
    else if (sit.data.picks[f] === 'b') b += share[f] ?? 0;
  }
  // 왕의 권위: 용안이 밝으면 왕의 뜻대로, 어두우면 당들의 힘대로
  const will = clamp(0.55 + s.king.mood / 120, 0.15, 0.95);
  const p = P(s);
  let push = (a - b) * 0.45;
  if (sit.data.side && sit.data.pub) push += (sit.data.side === 'a' ? 1 : -1) * clamp((p.prestige + (5 - p.rank) * 5) / 400, 0.01, 0.12);
  const base = sit.data.kingSide === 'a' ? will : 1 - will;
  return clamp(base + push, 0.08, 0.92);
}

/** 매달: 논의가 흘러가거나, 새 논의가 일어난다 */
export function tickGukbon(s: GameState) {
  if (yearOf(s.t) < 1609) return;
  const sit = gukbonSit(s);
  if (sit) {
    s.tension = clamp(s.tension + 0.3, 0, 100);
    kingMood(s, -0.5);
    if (s.t >= sit.until) resolveGukbon(s, sit);
    return;
  }
  if (s.war.active || monthsSince(s, 'gukbonAt') < 36) return;
  const king = kingChar(s);
  if (!alive(king)) return;
  // 선조 뒤 열린 구간의 대체 임금은 후사를 두지 못한다 (later.ts의 방계 계승이 뒤를 잇는다)
  if (s.t < tOf(1623, 3) && king.id !== 'gwanghae' && s.royal?.princes?.[king.id]) return;
  if (s.flags.altKing === king.id) return;
  const kAge = age(s, king);
  const heirSet = typeof s.flags[heirKey(s)] === 'number';
  const ill = s.situations.some((x) => x.kind === 'illness');
  const style = String(s.flags.kingStyle ?? 'plain');
  const count = Number(s.flags[`gukbonN_${String(s.flags.kingId)}`] ?? 0);
  if (count >= 2) return;
  // 일어나기 쉬운 처지: 권위가 낮다 · 병들었다 · 늙었다 · 판을 흔드는 임금
  let p = 0.0015;
  if (ill) p += 0.02;
  if (s.king.mood < 0) p += (-s.king.mood / 100) * 0.02;
  if (kAge >= 50) p += 0.003;
  if (legitOf(s).score < 45) p += 0.002;
  if (style === 'volatile') p *= 1.5;
  if (style === 'sedo') p *= 0.6;
  if (!chance(s, p)) return;
  let id: string | null = null;
  if (!heirSet && kAge >= 35 && reignYears(s) >= 3 && chance(s, 0.4)) id = 'yangja';
  else if (!heirSet && kAge >= 24 && reignYears(s) >= 3) id = 'chaekbong';
  else if (heirSet && (ill || kAge >= 55)) id = 'daeri';
  else if (heirSet && (s.king.mood < -15 || style === 'volatile')) id = 'pye';
  if (!id) return;
  s.flags[`gukbonN_${String(s.flags.kingId)}`] = count + 1;
  startGukbon(s, id, ill ? '왕의 환후가 길어지자' : s.king.mood < -20 ? '왕의 권위가 흔들리자' : undefined);
}

export function resolveGukbon(s: GameState, sit: Situation) {
  s.situations = s.situations.filter((x) => x !== sit);
  const t = TOPICS[sit.data.topic];
  const kingSide: Side = sit.data.kingSide;
  // 결말이 정해지지 않은 논의는 왕이 그냥 덮기도 한다
  if (!t.fixed && !t.hard && s.king.mood > -10 && chance(s, 0.2)) {
    log(s, `[국본] 왕이 「${t.title}」 논의를 덮었다. 누구도 이기지 못했다.`, 'history');
    if (sit.data.side) notice(s, '국본 논의가 덮였다', '왕이 논의를 덮었다. 어느 쪽도 이기지 못했다.', 'court');
    return;
  }
  const win: Side = chance(s, gukbonOdds(s, sit)) ? 'a' : 'b';
  const kingWon = win === kingSide;
  const text = t.done(s, win);
  const losers = activeFactions(s).filter((f) => sit.data.picks[f] && sit.data.picks[f] !== win);
  const winners = activeFactions(s).filter((f) => sit.data.picks[f] === win);
  const fallen: string[] = [];
  const style = String(s.flags.kingStyle ?? 'plain');
  if (kingWon) {
    for (const f of winners) kingLean(s, f, 5);
    for (const f of losers) {
      kingLean(s, f, -8);
      const lead = s.chars[s.factions[f].leader ?? ''];
      if (lead && alive(lead) && !isP(s, lead) && lead.status === 'active' && chance(s, style === 'volatile' ? 0.5 : 0.3)) {
        fav(lead, -20);
        if (chance(s, 0.5)) exile(s, lead, undefined, true);
        else vacate(s, lead);
        fallen.push(lead.name);
      }
    }
    kingMood(s, 4);
    s.tension = clamp(s.tension + 5, 0, 100);
  } else {
    // 신하들이 왕의 뜻을 꺾었다: 왕권이 떨어지고, 이긴 당도 왕의 눈 밖에 난다
    kingMood(s, -12);
    for (const f of winners) kingLean(s, f, -3);
    s.tension = clamp(s.tension + 3, 0, 100);
  }
  log(s, `[국본] ${text}${kingWon ? '' : ' 신하들이 왕의 뜻을 꺾었다. 왕권이 흔들린다.'}${fallen.length ? ` ${fallen.join(', ')} 등이 화를 입었다.` : ''}`, 'history');

  // 역사의 논의에서 선 자리는 다음 임금이 기억한다
  if (sit.data.topic === 'daeri_seson' && sit.data.side) s.flags.daeriSide = sit.data.side;
  if (sit.data.topic === 'seje' && sit.data.side) s.flags.sejeSide = sit.data.side;
  if (sit.data.topic === 'wonson' && sit.data.side) s.flags.wonsonSide = sit.data.side;

  const p = P(s);
  const side: Side | undefined = sit.data.side;
  if (!side || !alive(p)) return;
  if (!sit.data.pub) {
    if (side === win) {
      fav(p, 2);
      notice(s, '국본 논의', `${text}\n\n은밀히 거들던 쪽이 이겼다. (성심 +2)`, 'court');
    } else notice(s, '국본 논의', `${text}\n\n은밀히 거들던 쪽이 졌지만, 드러나지 않았다.`, 'court');
    return;
  }
  if (side === win) {
    pres(p, kingWon ? 3 : 4);
    fav(p, kingWon ? 5 : -3);
    notice(s, '국본 논의', `${text}\n\n당신이 앞장선 쪽이 이겼다. (명망 +${kingWon ? 3 : 4}, 성심 ${kingWon ? '+5' : '-3: 왕의 뜻을 꺾은 쪽이다'})`, 'court');
    return;
  }
  if (!kingWon) {
    fav(p, 4);
    pres(p, -2);
    notice(s, '국본 논의', `${text}\n\n당신이 섰던 쪽은 졌다. 그래도 왕은 끝까지 자기 편에 섰던 당신을 기억한다. (성심 +4, 명망 -2)`, 'court');
    return;
  }
  const risk = clamp(0.3 + (p.rank <= 2 ? 0.15 : 0) - (p.favor >= 50 ? 0.15 : 0) + (style === 'volatile' ? 0.1 : 0), 0.1, 0.7);
  if (p.status === 'active' && p.office && OFFICE_MAP[p.office] && chance(s, risk)) {
    vacate(s, p);
    fav(p, -12);
    s.player.deeds.push(`${yearOf(s.t)} 국본 논의(${t.title})로 파직`);
    notice(s, '왕의 진노', `${text}\n\n왕의 뜻을 거슬러 앞장섰던 당신도 화를 입었다. 파직되었다. (성심 -12, 화를 입을 확률 ${Math.round(risk * 100)}%)`, 'danger');
  } else {
    fav(p, -8);
    notice(s, '왕의 진노', `${text}\n\n왕의 뜻을 거슬렀던 당신을 왕이 차갑게 본다. (성심 -8, 파직될 확률 ${Math.round(risk * 100)}%를 넘겼다)`, 'danger');
  }
}

/* ───────── 플레이어의 줄서기 ───────── */

export function gukbonError(s: GameState, side: Side, pub: boolean): string | null {
  const sit = gukbonSit(s);
  const p = P(s);
  if (!sit) return '국본 논의가 일고 있을 때만 할 수 있다';
  if (p.status === 'exiled') return '귀양 중이다';
  if (sit.data.side === side && (sit.data.pub || !pub)) return '이미 그쪽에 섰다';
  if (s.player.ap < 1) return '행동력이 부족하다';
  if (pub && !inCourt(p)) return '조정에 있어야 한다';
  if (!pub && p.wealth < 15) return '재산 15가 필요하다';
  return null;
}

export function joinGukbon(s: GameState, side: Side, pub: boolean): string {
  const err = gukbonError(s, side, pub);
  if (err) return err;
  const sit = gukbonSit(s)!;
  const t = TOPICS[sit.data.topic];
  const p = P(s);
  s.player.ap -= 1;
  const switched = sit.data.side && sit.data.side !== side && sit.data.pub;
  sit.data.side = side;
  if (!pub) {
    p.wealth -= 15;
    sit.data.pub = false;
    return `뒤에서 「${short(side === 'a' ? t.a : t.b)}」 쪽을 거들었다. (재산 -15)`;
  }
  sit.data.pub = true;
  const pick = p.faction !== 'none' ? sit.data.picks[p.faction] : undefined;
  const fx = pick === side ? swayFaction(s, p.faction, p.id, 3, '국본 논의에 앞장섬', 0.08) : pick ? swayFaction(s, p.faction, p.id, -5, '당론과 다른 쪽에 섬', 0.08) : '';
  if (switched) {
    pres(p, -4);
    addFlaw(s, p, '국본 논의의 변절', true);
  }
  return `「${short(side === 'a' ? t.a : t.b)}」고 드러내 놓고 아뢰었다.${fx ? ` (${fx})` : ''}${switched ? ' 말을 바꾼 당신을 두고 변절했다는 말이 돈다. (명망 -4)' : ''}`;
}

/* ───────── 이벤트 ───────── */

export const GUKBON_EVENTS: Record<string, EventDef> = {
  gukbon_open: {
    build(s) {
      const sit = gukbonSit(s);
      const p = P(s);
      if (!sit) return { title: '국본 논의', text: '논의가 이미 끝났다.', choices: [{ key: 'wait', label: '확인' }] };
      const t = TOPICS[sit.data.topic];
      const pick = p.faction !== 'none' ? (sit.data.picks[p.faction] as Side | undefined) : undefined;
      const will = s.king.mood >= 20 ? '왕의 권위가 서 있어 왕의 뜻대로 끝나기 쉽다.' : s.king.mood <= -20 ? '왕의 권위가 흔들리고 있어 당들의 힘으로 왕의 뜻을 꺾을 수도 있다.' : '왕의 뜻과 당들의 힘이 엇비슷하다.';
      const hint = (side: Side) =>
        `${pick === side ? '당론과 같다. ' : pick ? '당론과 다르다. ' : ''}${t.fixed ? '' : `지금 이길 가능성 ${Math.round((side === 'a' ? gukbonOdds(s, sit) : 1 - gukbonOdds(s, sit)) * 100)}%`}`;
      const court = inCourt(p);
      return {
        title: `국본(國本) 논의 — ${t.title}`,
        kind: 'history',
        text: `${t.text}\n\n왕은 속으로 한쪽을 바라고 있다. 어느 쪽인지는 짐작할 뿐이다. ${will}${pick ? `\n당신의 당은 「${short(pick === 'a' ? t.a : t.b)}」 쪽이다.` : ''}\n\n진 쪽에 앞장섰다가 왕의 뜻까지 거스른 것이면 화를 입는다. 논의는 몇 달 이어진다.`,
        choices: [
          { key: 'a', label: t.a, hint: hint('a'), disabled: court ? undefined : '조정에 있어야 한다' },
          { key: 'b', label: t.b, hint: hint('b'), disabled: court ? undefined : '조정에 있어야 한다' },
          { key: 'wait', label: '지켜본다', hint: '왕실 탭에서 나중에 줄을 설 수 있다' },
        ],
      };
    },
    resolve(s, _c, key) {
      if (key === 'wait' || !gukbonSit(s)) return '말을 아꼈다.';
      s.player.ap += 1;
      const before = gukbonSit(s)?.data.side;
      const out = joinGukbon(s, key as Side, true);
      if (gukbonSit(s)?.data.side === before && before !== key) s.player.ap -= 1;
      return out;
    },
  },
};

/** 정조가 즉위할 때: 세손의 대리청정을 막았던 이를 기억한다 */
export function daeriPayback(s: GameState) {
  const p = P(s);
  if (!alive(p)) return;
  if (s.flags.daeriSide === 'b') {
    fav(p, -20);
    notice(s, '세손의 기억', '정조가 즉위하며 대리청정을 막아섰던 당신을 잊지 않았다. (성심 -20)', 'danger');
  } else if (s.flags.daeriSide === 'a') {
    fav(p, 10);
    notice(s, '세손의 기억', '정조가 대리청정 때 자신을 받들었던 당신을 기억한다. (성심 +10)', 'personal');
  }
}

/** 영조가 즉위할 때: 세제 책봉에 섰던 자리를 기억한다 */
export function sejePayback(s: GameState) {
  const p = P(s);
  if (!alive(p)) return;
  if (s.flags.sejeSide === 'a') {
    fav(p, 12);
    notice(s, '세제의 기억', `영조가 즉위하며 세제 책봉에 앞장섰던 ${josa(p.name, '을/를')} 기억한다. (성심 +12)`, 'personal');
  } else if (s.flags.sejeSide === 'b') {
    fav(p, -12);
    notice(s, '세제의 기억', '영조가 즉위하며 세제 책봉을 막아섰던 당신을 차갑게 본다. (성심 -12)', 'danger');
  }
}
