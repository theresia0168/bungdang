import type { GameState } from '../types';
import type { EventDef } from './types';
import { REGION_META } from '../data/meta';
import { alive, inCourt, P, pushEvent } from '../state';
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
      { key: 'follow', label: '어가를 따라 몽진길에 오른다', fx: { say: '빗속에 어가를 따랐다. 왕이 그 얼굴을 기억할 것이다.', favor: 10, prestige: 3, sick: 0.15 } },
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
          note: '「세자의 사람」이 된다',
          run(s) {
            s.royal.backing = 'gwanghae';
            s.royal.backingPublic = true;
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
      { key: 'militia', label: '다시 의병을 일으킨다', fx: { say: '향병을 모아 고개를 지켰다.', prestige: 5, favor: 3, prep: 3, note: '1년 동안 전사할 위험이 있다', run: (s) => void (s.flags.militia = s.t + 12) } },
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
