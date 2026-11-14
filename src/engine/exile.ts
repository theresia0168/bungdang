import type { GameState } from './types';
import type { EventDef } from './events/types';
import { REGION_META } from './data/meta';
import { chance } from './rng';
import { alive, clamp, josa, log, notice, P, pres, pushEvent } from './state';
import { shortDate } from './calendar';

/* ───────── 유배 생활 ─────────
 * 귀양은 끝이 아니라 다른 방식의 한 시기다. 유배지에서 책을 짓고(다산·추사처럼), 그 고을 선비를 가르치고,
 * 집안과 벗을 움직여 해배를 청한다. 위리안치되면 가시울타리 안에 갇혀 사람을 만날 수 없고 병을 얻기 쉽다.
 * 유배지의 수령이 후하게 대할지 박하게 대할지도 갈린다.
 */

const exiled = (s: GameState) => P(s).status === 'exiled';
const fenced = (s: GameState) => (P(s).exileLevel ?? 1) >= 2;
const place = (s: GameState) => P(s).exilePlace ?? REGION_META[P(s).location].short;

/** 저술을 마치는 데 드는 달 */
export const WRITE_MONTHS = 10;

/** 유배 중 이달의 행동 (actions.ts의 MONTHLY에 붙는다) */
export const EXILE_MONTHLY = [
  {
    id: 'exile_write' as const,
    name: '유배지의 저술',
    cost: 1,
    desc: `귀양살이의 긴 날을 책 짓는 데 쓴다. ${WRITE_MONTHS}달을 쌓으면 저서 한 권이 완성되어 학식 경험 +15, 명망 +4. 산림의 길에서 저작으로 친다. 위리안치 중에도 할 수 있다.`,
    check: (s: GameState) => (!exiled(s) ? '유배 중에만 할 수 있다' : null),
    run(s: GameState) {
      const pl = s.player;
      pl.exileWork = (pl.exileWork ?? 0) + 1;
      if (pl.exileWork < WRITE_MONTHS) return `${place(s)}의 초가에서 붓을 들었다. (저술 ${pl.exileWork}/${WRITE_MONTHS})`;
      pl.exileWork = 0;
      const p = P(s);
      pl.exp.learning += 15;
      pres(p, 4);
      pl.books = (pl.books ?? 0) + 1;
      pl.deeds.push(`${shortDate(s.t)} 유배지 ${place(s)}에서 저서를 완성`);
      log(s, `${josa(p.name, '이/가')} 유배지 ${place(s)}에서 저서 한 권을 완성했다. 필사본이 서울의 사랑방에 돈다.`, 'player');
      return `저서 한 권을 마쳤다. 필사본이 서울까지 돈다. (학식 경험 +15, 명망 +4)`;
    },
  },
  {
    id: 'exile_teach' as const,
    name: '적소(謫所)의 강학',
    cost: 1,
    desc: '유배지 고을의 젊은 선비들을 모아 가르친다. 문인을 얻을 수 있고(30%), 그 도의 민심 +1, 명망 +1. 위리안치 중에는 사람을 만날 수 없다.',
    check: (s: GameState) => (!exiled(s) ? '유배 중에만 할 수 있다' : fenced(s) ? '가시울타리 안에서는 사람을 만날 수 없다' : null),
    run(s: GameState) {
      const p = P(s);
      const r = s.regions[p.location];
      r.minsim = clamp(r.minsim + 1, 0, 100);
      pres(p, 1);
      if (chance(s, 0.3)) {
        s.player.disciples++;
        return `${place(s)}의 선비 하나가 제자의 예를 갖추었다. (문인 ${s.player.disciples}명, 명망 +1)`;
      }
      return `${place(s)}의 젊은이들에게 경서를 가르쳤다. (명망 +1)`;
    },
  },
  {
    id: 'exile_appeal' as const,
    name: '해배 운동',
    cost: 1,
    desc: '재산 30을 들여 집안 사람과 벗들에게 서신을 보내 해배를 청하게 한다. 한 해 동안 해배될 확률이 1.6배. 같은 당이 조정에서 힘이 셀수록 잘 통한다. 반년에 한 번.',
    check: (s: GameState) =>
      !exiled(s) ? '유배 중에만 할 수 있다' : P(s).wealth < 30 ? '재산 30이 든다' : Number(s.flags.appealAt ?? -99) > s.t - 6 ? '반년에 한 번 할 수 있다' : null,
    run(s: GameState) {
      const p = P(s);
      p.wealth -= 30;
      s.flags.appealAt = s.t;
      s.flags.appealUntil = s.t + 12;
      return '아들과 벗들에게 서신을 띄웠다. 집안 사람들이 상소를 올리고 대궐 앞에서 격쟁(擊錚)한다. (재산 −30, 한 해 동안 해배 확률 1.6배)';
    },
  },
];

/** 해배 확률의 배수 (해배 운동) */
export const appealBoost = (s: GameState) => (Number(s.flags.appealUntil ?? -1) > s.t ? 1.6 : 1);

/** 매달: 유배지의 대우와 위리안치의 병 */
export function tickExile(s: GameState) {
  const p = P(s);
  if (!alive(p) || p.status !== 'exiled') {
    delete s.flags.exileHostFor;
    return;
  }
  // 새로 유배지에 닿으면 그 고을 수령의 대우가 정해진다
  const key = `${p.exiledAt ?? 0}`;
  if (s.flags.exileHostFor !== key && s.pending.length < 3) {
    s.flags.exileHostFor = key;
    pushEvent(s, 'exile_host', {});
  }
  // 가시울타리 안의 습한 초가는 몸을 상하게 한다. 박한 수령 밑이면 더
  if (fenced(s) && !s.player.sick && chance(s, s.flags.exileHost === 'harsh' ? 0.03 : 0.015)) {
    s.player.sick = true;
    notice(s, '적소의 병', `${place(s)}의 가시울타리 안, 습한 초가에서 병을 얻었다.`, 'danger');
  }
}

export const EXILE_EVENTS: Record<string, EventDef> = {
  exile_host: {
    build(s) {
      const p = P(s);
      return {
        title: '유배지의 수령',
        kind: 'personal',
        text: `${place(s)}에 닿았다. 고을 수령이 죄인을 맞는다. 귀양 온 이를 어떻게 대할지는 수령에게 달렸다. 선비로 대접하는 이도 있고, 조정의 눈치를 보며 박하게 구는 이도 있다.${(p.exileLevel ?? 1) >= 2 ? ' 집 둘레에는 가시울타리가 쳐졌다.' : ''}`,
        choices: [
          { key: 'gift', label: '가져온 재물로 수령과 아전을 구슬린다', hint: '재산 −20. 후한 대우: 병에 덜 걸린다' },
          { key: 'pride', label: '선비의 체모를 지키며 고개를 숙이지 않는다', hint: '명망 +1. 수령의 성품에 따라 반반으로 후하거나 박하다' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'gift' && p.wealth >= 20) {
        p.wealth -= 20;
        s.flags.exileHost = 'kind';
        return '수령이 땔감과 쌀을 넉넉히 보내왔다. 아전들도 함부로 하지 않는다. (재산 −20)';
      }
      pres(p, 1);
      if (chance(s, 0.5)) {
        s.flags.exileHost = 'kind';
        return '수령이 선비를 알아보고 예로 대했다. 이따금 술과 서책을 보낸다. (명망 +1)';
      }
      s.flags.exileHost = 'harsh';
      return '수령은 조정의 눈치를 보며 박하게 굴었다. 땔감도 넉넉지 않다. 겨울이 걱정이다. (명망 +1)';
    },
  },
};
