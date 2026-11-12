import type { GameState, RegionId } from '../types';
import type { EventDef } from './types';
import { REGION_META } from '../data/meta';
import { alive, inCourt, josa, log, monthsSince, P, pushEvent } from '../state';
import { shortDate } from '../calendar';
import { chance } from '../rng';
import { kill } from '../conflict';
import { defenseScore } from '../realm';
import { vacate } from '../court';
import { choicesOf, resolveScene, type Scene } from '../scenes';

/* ───────── 임진왜란의 결정 ─────────
 * 전란 중에 플레이어가 직접 내리는 큰 결정들. 연대기의 전황(history.ts의 w1~w19) 사이에 끼어든다.
 */

const atCourt = (s: GameState) => inCourt(P(s)) && P(s).status !== 'exiled';
const home = (s: GameState) => REGION_META[P(s).home].short;

export const WAR_SCENES: (Scene & { at: [number, number]; ok(s: GameState): boolean })[] = [
  {
    id: 'mongjin',
    at: [1592, 5],
    ok: (s) => atCourt(s) && s.realm.warPath !== 'held',
    title: '몽진(蒙塵)',
    text: () => '왜군이 충주를 넘었다는 급보가 들어왔다. 왕이 한밤중에 도성을 버리고 서쪽으로 떠나려 한다. 비가 쏟아지는 돈의문 밖으로 어가가 나서는데, 따르는 신하가 백도 되지 않는다.',
    opts: () => [
      { key: 'follow', label: '어가를 따라 몽진길에 오른다', fx: { say: '빗속에 어가를 따랐다. 왕이 그 얼굴을 기억할 것이다.', favor: 10, prestige: 3, sick: 0.15, note: '몽진 속도 +1', run: (s) => void (s.flags.escorted = true) } },
      { key: 'stay', label: '도성에 남아 백성을 수습한다', fx: { say: '도성에 남아 흩어진 백성을 모았다.', prestige: 4, favor: -3, minsim: 6, minsimAt: 'hanseong' } },
      {
        key: 'flee',
        label: '식솔을 데리고 고향으로 피한다',
        fx: {
          say: '식솔을 이끌고 고향으로 피했다. 사람들이 손가락질한다.',
          prestige: -6,
          favor: -12,
          note: '관직을 잃고 낙향한다',
          run(s) {
            const p = P(s);
            if (p.office) vacate(s, p, 'retired');
            p.status = 'retired';
            p.location = p.home;
          },
        },
      },
    ],
  },
  {
    id: 'bunjo',
    at: [1592, 7],
    ok: (s) => atCourt(s) && s.realm.warPath !== 'held' && s.heir === 'gwanghae' && alive(s.chars.gwanghae),
    title: '분조(分朝)',
    text: () => '의주까지 밀려난 왕은 요동으로 건너갈 생각까지 한다. 조정을 둘로 나누어, 세자 광해군이 따로 분조를 이끌고 강원·황해를 돌며 의병을 모으기로 했다. 세자를 따를 신하를 뽑는다.',
    opts: () => [
      {
        key: 'prince',
        label: '세자를 따라 분조로 간다',
        fx: {
          say: '세자를 따라 험한 산길을 돌며 의병을 독려했다.',
          prestige: 4,
          favor: -2,
          prep: 3,
          note: '「세자의 사람」이 된다. 분조에서 따로 결정을 내린다',
          run(s) {
            s.royal.backing = 'gwanghae';
            s.royal.backingPublic = true;
            if (typeof s.flags.bunjoSeat === 'string') P(s).location = s.flags.bunjoSeat as RegionId;
          },
        },
      },
      { key: 'king', label: '의주 행재소에 남아 왕을 모신다', fx: { say: '행재소에 남아 왕을 모셨다.', favor: 5 } },
    ],
  },
  {
    id: 'ming_supply',
    at: [1593, 1],
    ok: atCourt,
    title: '명군의 군량',
    text: () => '이여송의 명군이 평양을 되찾았지만, 4만 대군을 먹일 군량이 없다. 명의 장수들은 군량이 늦으면 군사를 물리겠다고 으름장을 놓고, 명군이 지나는 고을마다 행패가 심하다.',
    opts: () => [
      { key: 'own', label: '사재를 털어 군량을 보탠다', cost: 30, fx: { say: '집안의 곡식을 털어 군량을 보탰다.', favor: 6, prestige: 3, prep: 3 } },
      { key: 'squeeze', label: '고을마다 군량을 거두어 바친다', fx: { say: '굶주린 고을에서 마지막 곡식까지 거두었다.', favor: 4, minsimAll: -3, flaw: { label: '군량 독징', p: 0.2 } } },
      { key: 'protest', label: '명군의 행패를 바로잡아 달라고 아뢴다', fx: { say: '명군의 행패를 아뢰었다. 왕은 명나라 눈치를 보며 말이 없었다.', prestige: 4, favor: -4, mood: -5 } },
    ],
  },
  {
    id: 'ming_host',
    at: [1593, 5],
    ok: (s) => {
      const o = P(s).office ?? '';
      return atCourt(s) && P(s).status === 'active' && (o === 'hojo' || o === 'gamsa_pyeongan' || o === 'gamsa_hwanghae' || o === 'gamsa_gyeonggi' || o === 'panyun');
    },
    title: '명군의 행패',
    text: () => '평양을 되찾은 명군이 고을마다 머물며 술과 고기, 여자를 내놓으라 한다. 말을 듣지 않는 수령을 매질하고, 군량이 늦으면 철수하겠다고 으름장을 놓는다. 그들을 맞는 일이 당신의 몫이다.',
    opts: () => [
      {
        key: 'lavish',
        label: '국고를 털어 융숭히 대접한다',
        fx: { say: '명의 장수들이 흡족해하며 진격을 약속했다.', favor: 4, mood: 4, minsimAll: -1, prep: 2, note: '국고 -40', run: (s) => void (s.realm.treasury -= 40) },
      },
      {
        key: 'curb',
        label: '명 장수와 담판해 군율을 세우게 한다',
        roll: {
          stat: 'politics',
          need: 8,
          ok: { say: '명의 제독이 부하들의 행패를 엄히 다스렸다. 백성들이 한숨을 돌렸다.', prestige: 5, minsimAll: 2 },
          fail: { say: '명 장수가 "속국의 신하가 감히"라며 펄펄 뛰었다. 왕이 사과 사신을 보냈다.', favor: -6, mood: -6 },
        },
      },
      { key: 'endure', label: '참고 견디며 고을에 맡긴다', fx: { say: '고을마다 명군의 등쌀에 시달렸다.', minsimAll: -2 } },
    ],
  },
  {
    id: 'peace_talk',
    at: [1594, 3],
    ok: (s) => atCourt(s) && P(s).rank <= 5,
    title: '강화(講和) 논의',
    text: () => '명과 일본이 조선을 빼놓고 강화를 논한다. 왜군은 남해안에 성을 쌓고 눌러앉았다. 조정에서는 강화에 따르자는 쪽과 끝까지 싸우자는 쪽, 그리고 이 틈에 스스로 힘을 길러야 한다는 쪽이 맞선다.',
    opts: () => [
      { key: 'peace', label: '명의 뜻을 따라 강화를 받아들이자', fx: { say: '강화를 받아들이자고 아뢰었다. 사림은 등을 돌렸지만 왕은 고개를 끄덕였다.', favor: 4, prestige: -4, tension: 2 } },
      { key: 'fight', label: '원수와는 하늘을 함께 이지 않는다', fx: { say: '끝까지 싸워야 한다고 아뢰었다. 선비들이 박수를 쳤다.', prestige: 4, favor: -2, party: 3 } },
      { key: 'reform', label: '훈련도감과 둔전으로 스스로 강해지자', fx: { say: '군제를 고치고 둔전을 일구자고 청했다. 왕이 비변사에 맡겼다.', prep: 6, polExp: 4 } },
    ],
  },
  {
    id: 'jeongyu',
    at: [1597, 8],
    ok: (s) => P(s).status !== 'exiled' && P(s).status !== 'dead',
    title: '정유재란(丁酉再亂)',
    text: (s) => `왜군이 다시 바다를 건너왔다. 남원성이 무너지고 전라도가 짓밟힌다. ${home(s)}에서도 피란민이 길을 메웠다.`,
    opts: (s) => [
      {
        key: 'militia',
        label: '다시 의병을 일으킨다',
        fx: {
          say: '향병을 모아 고개를 지켰다.',
          prestige: 5,
          favor: 3,
          prep: 3,
          note: '1년 동안 고향 근처에서 왜군과 싸운다 (전공 +2)',
          run(s) {
            s.flags.militia = s.t + 12;
            s.flags.warMerit = Number(s.flags.warMerit ?? 0) + 2;
            const p = P(s);
            if (p.status === 'retired' || p.status === 'idle') p.location = p.home;
          },
        },
      },
      { key: 'relief', label: '피란민을 거두어 먹인다', cost: 20, fx: { say: '피란민에게 집과 곡식을 내주었다.', prestige: 3, minsim: 8, minsimAt: P(s).home } },
      { key: 'hide', label: '식솔을 데리고 산으로 피한다', fx: { say: '산골로 몸을 피했다.', prestige: -3 } },
    ],
  },
];

/** history.ts의 연표에 끼워 넣는 일정 */
export const WAR_SCHEDULE = WAR_SCENES.map((w) => ({
  id: `war_${w.id}`,
  at: w.at,
  window: 2,
  cond: (s: GameState) => s.war.active && w.ok(s),
  run: (s: GameState) => pushEvent(s, 'war_scene', { wid: w.id }),
}));

const sceneOf = (id: string) => WAR_SCENES.find((w) => w.id === id);

export const WAR_EVENTS: Record<string, EventDef> = {
  war_scene: {
    build(s, c) {
      const w = sceneOf(c.wid)!;
      return { title: w.title, kind: 'war', text: w.text(s, c), choices: choicesOf(s, c, w) };
    },
    resolve(s, c, key) {
      const w = sceneOf(c.wid);
      return w ? resolveScene(s, w, c, key, P(s).location) : '';
    },
  },
};

/* ───────── 전장의 싸움 ─────────
 * 전란 중 전장이 된 도에 있으면(의병, 관찰사·수령, 고향에 물러나 있는 이) 왜군과 맞닥뜨린다.
 * 그 도의 성곽·진보·조련이 높을수록 지켜 내기 쉽다.
 */

const merit = (s: GameState, v: number) => void (s.flags.warMerit = Number(s.flags.warMerit ?? 0) + v);
const frontRegion = (s: GameState, c: Record<string, any>) => c.region as RegionId;
const holdNeed = (s: GameState, r: RegionId) => Math.max(4, 10 - Math.round(defenseScore(s, r) / 15));

export const FRONT_SCENE: Scene = {
  id: 'front',
  title: '왜군이 다가온다',
  text: (s, c) => {
    const r = frontRegion(s, c);
    const d = s.regions[r].defense;
    return `왜군 한 갈래가 ${REGION_META[r].short}의 고을로 몰려온다는 척후의 보고다. 성곽 ${d.fort} · 진보 ${d.jin} · 조련 ${Math.round(d.drill)}. 고을 사람들의 눈이 당신을 향한다.\n\n(지켜 내려면 주사위 + 정치력·강건 ≥ ${holdNeed(s, r)})`;
  },
  opts: (s, c) => {
    const r = frontRegion(s, c);
    const need = holdNeed(s, r);
    return [
      {
        key: 'hold',
        label: '성에 들어가 굳게 지킨다',
        roll: {
          stat: 'mixed',
          need,
          ok: { say: '성첩에 올라 사흘 밤낮을 버텼다. 왜군이 물러갔다.', prestige: 3, minsim: 4, minsimAt: r, prep: 1, note: '전공 +2', run: (s) => merit(s, 2) },
          fail: {
            say: '성이 뚫렸다. 남은 군사를 수습해 겨우 빠져나왔다.',
            minsim: -6,
            minsimAt: r,
            sick: 0.2,
            note: '성곽 -1',
            run(s) {
              const d = s.regions[r].defense;
              if (d.fort > 0) d.fort--;
            },
          },
        },
      },
      {
        key: 'raid',
        label: '고갯길에 매복해 기습한다',
        roll: {
          stat: 'mixed',
          need: need + 2,
          ok: { say: '고갯길에서 왜군의 치중대를 덮쳐 크게 이겼다. 소문이 행재소까지 들렸다.', prestige: 6, favor: 4, prep: 3, note: '전공 +4', run: (s) => merit(s, 4) },
          fail: {
            say: '매복이 들통나 군사를 많이 잃었다.',
            prestige: -2,
            minsim: -4,
            minsimAt: r,
            note: '10% 확률로 전사한다',
            run(s) {
              if (chance(s, 0.1)) {
                kill(s, P(s), '왜군과 싸우다 전사했다');
                return '당신도 화살을 맞고 쓰러졌다.';
              }
              s.player.sick = true;
              return '당신도 크게 다쳤다.';
            },
          },
        },
      },
      { key: 'evacuate', label: '백성을 산성으로 옮기고 들을 비운다', fx: { say: '곡식을 거두어 산성으로 들어갔다. 왜군은 빈 들판만 짓밟고 지나갔다.', minsim: -2, minsimAt: r, prestige: 1, note: '전공 +1', run: (s) => merit(s, 1) } },
    ];
  },
};

/** 전장에 있으면 가끔 왜군과 맞닥뜨린다 */
export function rollWarFront(s: GameState) {
  if (!s.war.active || s.pending.length >= 2) return;
  const p = P(s);
  if (!alive(p) || p.status === 'exiled' || p.status === 'royal') return;
  const r = p.location as RegionId;
  if (!s.war.zones.includes(r)) return;
  const militia = typeof s.flags.militia === 'number' && (s.flags.militia as number) > s.t;
  const local = p.status === 'active' && (p.office?.startsWith('gamsa_') || p.office === 'suryeong');
  const home = p.status === 'retired' && p.home === r;
  if (!militia && !local && !home) return;
  if (monthsSince(s, 'frontAt') < 2 || !chance(s, militia ? 0.3 : 0.18)) return;
  s.flags.frontAt = s.t;
  pushEvent(s, 'war_front', { region: r });
}

/* ───────── 공신 녹훈 ───────── */

export function warMeritOf(s: GameState): number {
  return Number(s.flags.warMerit ?? 0) + (s.flags.escorted ? 3 : 0);
}

export const MERIT_SCENE: Scene = {
  id: 'merit',
  title: '공신 녹훈(錄勳)',
  text: (s) => {
    const m = warMeritOf(s);
    return `전쟁이 끝나고 조정이 공신을 가린다. 어가를 호종한 이는 호성공신(扈聖功臣), 싸움에서 공을 세운 이는 선무공신(宣武功臣)이 된다. 명단을 두고 말이 많다.\n\n당신의 전공: ${m}${m >= 4 ? ' — 녹훈 명단에 오를 만하다.' : ' — 이름을 올리기에는 모자란다.'}`;
  },
  opts: (s) => {
    const m = warMeritOf(s);
    const title = s.flags.escorted && Number(s.flags.warMerit ?? 0) < 3 ? '호성공신' : '선무공신';
    const award = (s: GameState) => {
      s.player.land += 3;
      const p = P(s);
      s.player.deeds.push(`${shortDate(s.t)} ${title} 녹훈`);
      log(s, `${josa(p.name, '이/가')} ${title}에 녹훈되었다.`, 'player');
      return `공신전(功臣田) 3결을 받았다.`;
    };
    if (m >= 4)
      return [
        { key: 'accept', label: `${title} 녹훈을 받는다`, fx: { say: `${title}에 녹훈되었다.`, prestige: 6, favor: 5, note: '전장 +3결', run: award } },
        { key: 'decline', label: '싸우다 죽은 이들을 두고 공을 사양한다', fx: { say: '공을 사양하는 상소를 올렸다. 사림이 그 뜻을 높이 샀다.', prestige: 9, favor: 2 } },
      ];
    return [
      {
        key: 'lobby',
        label: '녹훈 명단에 이름을 올려 달라고 청탁한다',
        cost: 30,
        odds: {
          p: 0.5,
          yes: { say: '이름이 말석에 올랐다.', prestige: 2, note: '전장 +3결', flaw: { label: '녹훈 청탁', p: 0.4 }, run: award },
          no: { say: '청탁이 들통나 웃음거리가 되었다.', prestige: -4, flaw: { label: '녹훈 청탁', p: 1, public: true } },
        },
      },
      { key: 'quiet', label: '공 없는 몸이니 물러나 있는다', fx: { say: '녹훈 논의에서 물러나 있었다.', prestige: 1 } },
    ];
  },
};

export const WAR_EXTRA_EVENTS: Record<string, EventDef> = {
  war_front: {
    build(s, c) {
      return { title: `${REGION_META[frontRegion(s, c)].short} — ${FRONT_SCENE.title}`, kind: 'war', text: FRONT_SCENE.text(s, c), choices: choicesOf(s, c, FRONT_SCENE) };
    },
    resolve: (s, c, key) => resolveScene(s, FRONT_SCENE, c, key, frontRegion(s, c)),
  },
  war_merit: {
    build: (s, c) => ({ title: MERIT_SCENE.title, kind: 'history', text: MERIT_SCENE.text(s, c), choices: choicesOf(s, c, MERIT_SCENE) }),
    resolve: (s, c, key) => resolveScene(s, MERIT_SCENE, c, key, P(s).location),
  },
};

/* ───────── 분조(分朝) ─────────
 * 평양이 떨어지면 세자가 조정을 갈라 강원·황해를 돌며 의병을 모은다.
 * 분조에 있는 이들도 조정의 공방에 낄 수 있고, 분조만의 결정을 내린다.
 */

const atBunjo = (s: GameState) => typeof s.flags.bunjoSeat === 'string' && P(s).location === s.flags.bunjoSeat;
const princeName = (s: GameState) => (s.heir && s.chars[s.heir] ? s.chars[s.heir].name : '세자');

export const BUNJO_SCENES: Scene[] = [
  {
    id: 'bunjo_militia',
    title: '분조 — 의병장들',
    text: (s) => `${princeName(s)}가 산골 고을을 돌며 의병장들을 불러 모았다. 의병장들은 관군의 지휘를 받지 않겠다고 버티면서도 군량과 관직을 원한다.`,
    opts: () => [
      { key: 'title', label: '공명첩을 주어 의병장을 격려한다', fx: { say: '의병장들에게 첩지를 내려 사기를 북돋웠다.', prep: 4, prestige: 2, note: '왕실 권위 -1', run: (s) => void (s.realm.authority = Math.max(0, s.realm.authority - 1)) } },
      {
        key: 'command',
        label: '관군의 절제를 받으라고 다그친다',
        roll: { stat: 'politics', need: 8, ok: { say: '의병장들이 분조의 명을 받들기로 했다.', prep: 6, favor: 2 }, fail: { say: '의병장들이 반발해 흩어졌다.', prep: -2, prestige: -2 } },
      },
      { key: 'leave', label: '그들 뜻대로 싸우게 둔다', fx: { say: '의병들이 제각기 싸운다.', prep: 1 } },
    ],
  },
  {
    id: 'bunjo_grain',
    title: '분조 — 군량',
    text: (s) => `분조를 따르는 군사들이 굶주린다. 강원의 산골 고을에서 곡식을 거둘지, ${princeName(s)}의 이름으로 사대부가에 곡식을 청할지 정해야 한다.`,
    opts: () => [
      { key: 'levy', label: '고을에서 징발한다', fx: { say: '산골 고을의 마지막 곡식까지 거두었다.', prep: 3, minsim: -5, minsimAt: 'gangwon' } },
      { key: 'ask', label: '사대부가에 납속을 청한다', fx: { say: '사족들이 곡식을 내놓았다. 대신 벼슬을 바란다.', prep: 2, others: -2, party: 2 } },
      { key: 'own', label: '사재를 털어 보탠다', cost: 20, fx: { say: '집안의 재물을 털어 군량을 보탰다.', prep: 3, prestige: 3 } },
    ],
  },
  {
    id: 'bunjo_counsel',
    title: '분조 — 세자의 결단',
    text: (s) => `${princeName(s)}가 당신을 불러 묻는다. 행재소의 명을 기다리다 보면 때를 놓치니, 분조가 스스로 결단해 장수를 임명하고 상벌을 내려도 되겠느냐는 것이다. 왕은 세자가 인심을 얻는 것을 꺼린다.`,
    opts: () => [
      {
        key: 'bold',
        label: '나라를 구하는 일이니 결단하시라',
        fx: {
          say: '세자가 분조의 이름으로 장수를 세우고 상을 내렸다. 백성들이 세자를 우러른다.',
          prestige: 3,
          favor: -4,
          prep: 4,
          note: '세자의 사람이 된다. 왕의 견제를 받는다',
          run(s) {
            if (s.heir) {
              s.royal.backing = s.heir;
              s.royal.backingPublic = true;
            }
          },
        },
      },
      { key: 'obey', label: '행재소의 뜻을 받드시라', fx: { say: '세자가 왕의 명을 기다리기로 했다. 왕이 이를 전해 듣고 흡족해했다.', favor: 4 } },
    ],
  },
];

const bunjoScene = (id: string) => BUNJO_SCENES.find((x) => x.id === id);

/** 분조에 있으면 가끔 분조의 결정을 내린다 */
export function rollBunjo(s: GameState) {
  if (!atBunjo(s) || s.pending.length >= 2) return;
  if (monthsSince(s, 'bunjoAt') < 2 || !chance(s, 0.35)) return;
  const done = (s.flags.bunjoDone as string | undefined)?.split(',') ?? [];
  const left = BUNJO_SCENES.filter((x) => !done.includes(x.id));
  if (!left.length) return;
  const sc = left[0];
  s.flags.bunjoAt = s.t;
  s.flags.bunjoDone = [...done, sc.id].join(',');
  pushEvent(s, 'bunjo_scene', { bid: sc.id });
}

export const BUNJO_EVENTS: Record<string, EventDef> = {
  bunjo_scene: {
    build(s, c) {
      const sc = bunjoScene(c.bid)!;
      return { title: sc.title, kind: 'war', text: sc.text(s, c), choices: choicesOf(s, c, sc) };
    },
    resolve(s, c, key) {
      const sc = bunjoScene(c.bid);
      return sc ? resolveScene(s, sc, c, key, P(s).location) : '';
    },
  },
};
