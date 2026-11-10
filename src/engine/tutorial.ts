import type { GameState } from './types';
import { notice, pres } from './state';

/* ───────── 첫 해의 길잡이 ─────────
 * 처음 1년 동안 핵심 행동을 하나씩 해 보게 이끈다. 하나 해낼 때마다 명망 +1, 모두 마치면 재산 +20.
 */

export interface GuideStep {
  id: string;
  name: string;
  how: string;
  done(s: GameState): boolean;
}

export const GUIDE: GuideStep[] = [
  { id: 'goal', name: '뜻을 세운다', how: '왼쪽 「뜻」의 세우기 버튼', done: (s) => !!s.player.goal || s.player.goalsDone.length > 0 },
  { id: 'focus', name: '이번 달의 일을 고른다', how: '왼쪽 「이번 달의 일」에서 하나를 누른다', done: (s) => !!s.player.focus },
  { id: 'contact', name: '사람을 사귄다', how: '조정이나 인물 탭에서 이름을 눌러 서신·방문을 한다', done: (s) => Object.keys(s.player.contacts).length > 0 },
  { id: 'month', name: '한 달을 보낸다', how: '오른쪽 위 「다음 달」 버튼이나 Space', done: (s) => s.t >= 1 },
  { id: 'memorial', name: '상소를 올린다', how: '「시폐 상소」를 고르고, 짓는 동안 인물 창에서 연명을 청한다', done: (s) => s.player.stats.memorials > 0 },
  { id: 'case', name: '조정 공방에 끼어든다', how: '오른쪽 「조정 공방」에서 동조하거나 구원한다 (구원하면 그가 신세를 진다)', done: (s) => !!s.flags.joinedCase || s.player.stats.impeachWins + s.player.stats.impeachFails > 0 },
  { id: 'network', name: '인맥을 살핀다', how: '가운데 「인맥」 탭에서 나를 둘러싼 사람들을 본다', done: (s) => !!s.flags.sawNetwork },
];

/** 길잡이가 보이는가 */
export const guideOn = (s: GameState) => !s.flags.guideOff && s.player.lineage.length === 0 && (s.player.guide.length < GUIDE.length || s.t < 12);

/** 새로 해낸 단계를 표시하고 보상한다 */
export function updateGuide(s: GameState) {
  if (s.flags.guideOff || s.player.guide.length >= GUIDE.length) return;
  for (const g of GUIDE) {
    if (s.player.guide.includes(g.id) || !g.done(s)) continue;
    s.player.guide.push(g.id);
    pres(s.chars[s.player.charId], 1);
  }
  if (s.player.guide.length === GUIDE.length) {
    s.chars[s.player.charId].wealth += 20;
    notice(s, '첫 걸음을 마치다', '조정에서 살아가는 법을 하나씩 익혔다. 이제부터는 당신의 판단이다.\n\n(길잡이 완료: 재산 +20)', 'personal');
  }
}
