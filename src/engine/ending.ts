import type { GameState } from './types';
import { FACTION_META, REGION_META, SCHOOL_META } from './data/meta';
import { influence, MAIN_FACTIONS, members } from './factions';
import { formatDate, yearOf } from './calendar';
import { josa, P } from './state';
import { GOAL_REWARD } from './goals';

export interface Ending {
  title: string;
  epithet: string;
  obituary: string;
  score: number;
  breakdown: { label: string; value: number }[];
}

/** 가문을 이어 했을 때 선대의 점수가 결말 점수에 들어가는 비율 */
export const ANCESTOR_WEIGHT = 0.5;

/** 선대를 뺀, 지금 사람 자신의 업적 */
export function ownScore(s: GameState): number {
  return breakdownOf(s, false).reduce((a, b) => a + b.value, 0);
}

function breakdownOf(s: GameState, withLineage = true) {
  const p = P(s);
  const pl = s.player;
  const survived = p.status !== 'dead';
  const f = p.faction;
  const leader = f !== 'none' && s.factions[f].leader === p.id;
  const pubFlaws = p.flaws.filter((x) => x.public).length;
  const rank = pl.peakRank;
  const anc = pl.lineage;
  const legacy = anc.length ? Math.round(anc.reduce((a, x) => a + x.score, 0) / anc.length) : 0;
  return [
    { label: `최고 관직 (${pl.peakOffice ?? '없음'})`, value: rank <= 9 ? (10 - rank) * 12 : 0 },
    { label: '명망', value: Math.round(p.prestige) },
    { label: '붕당 영수', value: leader ? 25 : 0 },
    { label: '당내 영향력', value: Math.round(influence(s, p)) },
    { label: '살아서 1821년을 맞음', value: survived ? 20 : 0 },
    { label: '과거 급제', value: p.tags.includes('passed') ? 10 : 0 },
    { label: '청백리 녹선', value: p.tags.includes('cheongbaek') ? 15 : 0 },
    { label: '급제한 문인', value: Object.values(s.chars).filter((c) => c.teacher === p.id).length * 6 },
    { label: '혼맥', value: pl.stats.marriages * 5 },
    { label: `이룬 뜻 (${pl.goalsDone.length})`, value: pl.goalsDone.length * GOAL_REWARD },
    { label: '서원·문집', value: pl.built.length * 8 },
    { label: '드러난 흠결', value: -pubFlaws * 6 },
    { label: '유배', value: -pl.stats.exiled * 5 },
    ...(withLineage && anc.length ? [{ label: `가문의 내력 (선대 ${anc.length}대의 평균)`, value: legacy }] : []),
  ].filter((b) => b.value !== 0);
}

export function computeEnding(s: GameState): Ending {
  const p = P(s);
  const pl = s.player;
  const survived = p.status !== 'dead';
  const f = p.faction;
  const leader = f !== 'none' && s.factions[f].leader === p.id;
  const pubFlaws = p.flaws.filter((x) => x.public).length;
  const rank = pl.peakRank;

  const breakdown = breakdownOf(s);
  const score = breakdown.reduce((a, b) => a + b.value, 0);

  let epithet = '사대부';
  if (rank === 1 && p.prestige >= 60) epithet = '현상(賢相)';
  else if (p.traits.includes('clean') && pubFlaws === 0 && p.prestige >= 50) epithet = '청백리(淸白吏)';
  else if (pl.stats.impeachWins >= 3) epithet = '당쟁의 칼';
  else if (pl.stats.jojae >= 2) epithet = '조제의 군자';
  else if (leader) epithet = `${FACTION_META[f].name}의 영수`;
  else if (pl.stats.exiled >= 2) epithet = '유배객';
  else if (p.flaws.length >= 4) epithet = '탐관오리';
  else if (rank <= 2) epithet = '중신(重臣)';

  const age = yearOf(s.t) - p.born;
  const lines: string[] = [];
  if (survived) {
    lines.push(`${formatDate(s.t)}, ${josa(p.name, '은/는')} ${age}세의 나이로 새 세기를 맞았다.`);
  } else {
    lines.push(`${formatDate(p.death!.t)}, ${josa(p.name, '이/가')} ${p.death!.cause}. 향년 ${yearOf(p.death!.t) - p.born}세.`);
  }
  lines.push(
    `${p.ho ? `${p.name}의 호는 ${p.ho}이며` : josa(p.name, '은/는')} ${REGION_META[p.home].short} 사람이다. ${SCHOOL_META[p.school].name}의 학통을 이었고 ${f === 'none' ? '어느 당에도 기울지 않았다' : `${FACTION_META[f].name}에 속했다`}.`,
  );
  lines.push(pl.peakOffice ? `벼슬은 ${pl.peakOffice}에 이르렀다.` : '끝내 높은 벼슬에 오르지 못했다.');
  const remarks: string[] = [];
  if (p.prestige >= 60) remarks.push('학문과 지조가 있어 사림이 우러렀다');
  else if (p.prestige < 20) remarks.push('세상의 평판은 높지 않았다');
  if (pl.stats.impeachWins >= 2) remarks.push(`당론을 앞세워 ${pl.stats.impeachWins}명을 내쳤으니 원망하는 자가 많았다`);
  if (pl.stats.jojae >= 1) remarks.push('붕당의 화합을 힘써 말했다');
  if (pl.stats.exiled) remarks.push(`${pl.stats.exiled}번 귀양을 갔다`);
  if (pubFlaws >= 2) remarks.push('재물과 청탁에 얽힌 추문이 끊이지 않았다');
  if (pl.stats.marriages) remarks.push(`혼맥으로 ${pl.stats.marriages}개 가문과 이어졌다`);
  if (pl.built.includes('seowon')) remarks.push('고향에 서원을 세워 후학을 길렀다');
  if (pl.built.includes('munjip')) remarks.push('문집을 남겼다');
  if (pl.goalsDone.length) remarks.push(`평생 ${pl.goalsDone.map((g) => `"${g}"`).join(', ')}는 뜻을 이루었다`);
  const disciples = Object.values(s.chars).filter((c) => c.teacher === p.id);
  if (disciples.length) remarks.push(`문하에서 ${disciples.map((c) => c.name).join(', ')} 등이 나왔다`);
  if (remarks.length) lines.push(`사신(史臣)은 말한다. "${remarks.join('. ')}."`);
  const anc = pl.lineage;
  if (anc.length)
    lines.push(
      `${p.clan}의 가계: ${anc.map((a) => `${a.name}(${a.peakOffice ?? '벼슬 없음'}, ${yearOf(a.died)}년 졸)`).join(' → ')} → ${p.name}.`,
    );

  const factionsNow = MAIN_FACTIONS.filter((x) => s.factions[x].active);
  lines.push(
    `\n${yearOf(s.t)}년의 조정에는 ${factionsNow.map((x) => `${FACTION_META[x].name}(${members(s, x).length}명)`).join(', ')}이 맞서 있다. 붕당의 싸움은 끝나지 않았다.`,
  );

  return {
    title: survived ? '1821년, 신사년' : '졸기(卒記)',
    epithet,
    obituary: lines.join('\n\n'),
    score,
    breakdown,
  };
}
