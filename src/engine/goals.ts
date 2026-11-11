import type { Character, GameState, Goal, GoalKind } from './types';
import { FACTION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { alive, clamp, inCourt, josa, log, notice, officeTitle, P, people, pushEvent } from './state';
import { opinion, topOf } from './opinion';
import { influence } from './factions';
import { PROJECTS } from './actions';
import { shortDate } from './calendar';

export const GOAL_REWARD = 15;

const RANK_GOAL: Record<number, string> = { 3: '당상관(정3품)', 2: '판서의 반열(정2품)', 1: '정승(정1품)' };

interface GoalDef {
  name(s: GameState, g: Goal): string;
  desc: string;
  progress(s: GameState, g: Goal): { text: string; done: boolean; failed?: string };
}

const target = (s: GameState, g: Goal): Character | undefined => (g.targetId ? s.chars[g.targetId] : undefined);

export const GOALS: Record<GoalKind, GoalDef> = {
  climb: {
    name: (_s, g) => `${RANK_GOAL[g.rank ?? 3]}에 오른다`,
    desc: '벼슬길을 오른다. 품계는 한 번 오르면 내려가지 않는다.',
    progress: (s, g) => ({ text: `지금 ${P(s).rank}품`, done: P(s).rank <= (g.rank ?? 3) }),
  },
  jeonrang: {
    name: () => '이조전랑이 된다',
    desc: '삼사와 청요직의 인사를 쥐는 자리. 붕당 싸움의 시작이 이 자리였다.',
    progress(s) {
      const h = people(s).find((c) => c.status === 'active' && c.office === 'jeonrang');
      return { text: h ? `지금 전랑은 ${h.name}(${FACTION_META[h.faction].name})` : '전랑 자리가 비어 있다', done: P(s).office === 'jeonrang' };
    },
  },
  rival: {
    name: (s, g) => `${josa(target(s, g)?.name ?? '정적', '을/를')} 조정에서 몰아낸다`,
    desc: '정적이 유배되거나, 낙향하거나, 세상을 떠나면 이룬다. 누가 몰아냈는지는 따지지 않는다.',
    progress(s, g) {
      const t = target(s, g);
      if (!t) return { text: '', done: false, failed: '대상이 없다' };
      const gone = !alive(t) || t.status === 'exiled' || t.status === 'retired';
      return { text: `${t.name}: ${alive(t) ? officeTitle(t) : '졸'}`, done: gone };
    },
  },
  leader: {
    name: (s) => `${FACTION_META[P(s).faction].name}의 영수가 된다`,
    desc: '당내 영향력이 가장 높으면 영수가 된다. 영향력은 관직, 명망, 정치력, 학식, 문인 수로 정해진다.',
    progress(s) {
      const p = P(s);
      if (p.faction === 'none') return { text: '', done: false, failed: '당에 속해 있지 않다' };
      const lid = s.factions[p.faction].leader;
      const l = lid ? s.chars[lid] : undefined;
      return {
        text: l && l.id !== p.id ? `영수 ${l.name} ${influence(s, l)} · 나 ${influence(s, p)}` : '',
        done: lid === p.id,
      };
    },
  },
  seowon: {
    name: () => '고향에 서원을 세운다',
    desc: '이달의 행동에서 「서원 건립」을 거듭한다.',
    progress: (s) => ({ text: `${s.player.projects.seowon ?? 0}/${PROJECTS.seowon.months}개월`, done: s.player.built.includes('seowon') }),
  },
  munjip: {
    name: () => '문집을 펴낸다',
    desc: '이달의 행동에서 「문집 편찬」을 거듭한다. 학식 4 이상.',
    progress: (s) => ({ text: `${s.player.projects.munjip ?? 0}/${PROJECTS.munjip.months}개월`, done: s.player.built.includes('munjip') }),
  },
  family: {
    name: () => '두 가문과 혼맥을 맺는다',
    desc: '혼담으로 다른 가문과 사돈을 맺는다. 자녀는 나이가 들면 혼기에 이른다.',
    progress: (s, g) => {
      const n = s.player.stats.marriages - (g.base ?? 0);
      return { text: `${n}/2`, done: n >= 2 };
    },
  },
  prestige: {
    name: () => '사림의 종장이 된다',
    desc: '명망 70에 이른다. 상소, 강학, 서원, 문집, 청렴한 처신이 명망을 쌓는다.',
    progress: (s) => ({ text: `명망 ${Math.round(P(s).prestige)}/70`, done: P(s).prestige >= 70 }),
  },
  jojae: {
    name: () => '동서를 조제보합한다',
    desc: '조제보합 상소를 두 번 가납받는다. 긴장도가 낮을수록 쉽다.',
    progress: (s, g) => {
      const n = s.player.stats.jojae - (g.base ?? 0);
      return { text: `가납 ${n}/2`, done: n >= 2 };
    },
  },
};

function rivalFor(s: GameState): Character | undefined {
  const p = P(s);
  return people(s)
    .filter((c) => c.id !== p.id && c.status === 'active' && c.office && OFFICE_MAP[c.office] && topOf(c.faction) !== topOf(p.faction))
    .map((c) => [c, influence(s, c) / 2 - opinion(s, c, p) - opinion(s, p, c)] as const)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** 지금 처지에서 고를 만한 뜻들. 같은 처지면 같은 목록이 나온다. */
export function goalOptions(s: GameState): Goal[] {
  const p = P(s);
  const pl = s.player;
  const done = new Set(pl.goalsDone);
  const out: Goal[] = [];
  const add = (g: Goal) => {
    const key = goalKey(s, g);
    if (!done.has(key)) out.push(g);
  };
  if (p.rank > 1) add({ kind: 'climb', rank: p.rank > 3 ? 3 : p.rank - 1, since: s.t });
  if (p.rank >= 5 && p.office !== 'jeonrang' && inCourt(p)) add({ kind: 'jeonrang', since: s.t });
  const r = rivalFor(s);
  if (r) add({ kind: 'rival', targetId: r.id, since: s.t });
  if (p.faction !== 'none' && s.factions[p.faction].leader !== p.id) add({ kind: 'leader', since: s.t });
  if (p.traits.includes('mediator') || p.faction === 'none') add({ kind: 'jojae', base: pl.stats.jojae, since: s.t });
  if (!pl.built.includes('seowon')) add({ kind: 'seowon', since: s.t });
  if (!pl.built.includes('munjip') && p.learning >= 4) add({ kind: 'munjip', since: s.t });
  if (p.prestige < 60) add({ kind: 'prestige', since: s.t });
  add({ kind: 'family', base: pl.stats.marriages, since: s.t });
  return out.slice(0, 5);
}

export const goalKey = (s: GameState, g: Goal) => GOALS[g.kind].name(s, g);

export function setGoal(s: GameState, g: Goal | null) {
  s.player.goal = g;
}

export function reconsiderGoal(s: GameState): string {
  if (!s.pending.some((e) => e.def === 'goal_pick')) pushEvent(s, 'goal_pick');
  return '';
}

/** 매달 뜻을 이루었는지 살핀다 */
export function checkGoal(s: GameState) {
  const p = P(s);
  const g = s.player.goal;
  if (!g || !alive(p)) return;
  const pr = GOALS[g.kind].progress(s, g);
  if (pr.failed) {
    s.player.goal = null;
    notice(s, '뜻을 접다', `「${goalKey(s, g)}」 — ${pr.failed}. 새 뜻을 세울 수 있다.`);
    pushEvent(s, 'goal_pick');
    return;
  }
  if (!pr.done) return;
  const name = goalKey(s, g);
  s.player.goal = null;
  s.player.goalsDone.push(name);
  p.prestige = clamp(p.prestige + 4, 0, 100);
  s.player.deeds.push(`${shortDate(s.t)} 뜻을 이룸: ${name}`);
  log(s, `${josa(p.name, '이/가')} 오랜 뜻을 이루었다.`, 'player');
  notice(s, '뜻을 이루다', `「${name}」\n\n명망 +4. 결말 점수에 ${GOAL_REWARD}점이 더해진다. 새 뜻을 세우라.`, 'personal');
  pushEvent(s, 'goal_pick');
}
