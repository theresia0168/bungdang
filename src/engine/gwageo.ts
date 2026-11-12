import type { GameState } from './types';
import type { EventDef } from './events/types';
import { monthOf, yearOf } from './calendar';
import { chance, d6 } from './rng';
import { alive, josa, log, notice, P, pres, pushEvent } from './state';
import { appointGeneric } from './court';

/* ───────── 과거(科擧)와 음서(蔭敍) ─────────
 * 선친의 음덕으로 벼슬길에 나선 자식은 청요직에 오르지 못하고 승진이 더디다.
 * 식년시(3년마다 봄)와 별시(가끔 가을)에 응시해 급제하면 그 굴레를 벗는다.
 * 학문 수양과 강학을 쌓을수록 붓이 무르익는다.
 */

/** 과거를 볼 만한 처지인가 */
export function canSitExam(s: GameState): string | null {
  const p = P(s);
  if (!alive(p)) return '세상을 떠났다';
  if (!p.eumseo && p.rank <= 9 && p.tags.includes('passed')) return '이미 급제했다';
  if (!p.eumseo && p.rank < 10) return '이미 과거를 거쳐 벼슬길에 나섰다';
  if (p.status === 'exiled') return '유배 중이다';
  if (yearOf(s.t) - p.born >= 60) return '과거를 보기에는 나이가 많다';
  if (typeof s.flags.mournUntil === 'number' && (s.flags.mournUntil as number) > s.t) return '상중이다';
  return null;
}

/** 응시 판정에 더해지는 준비 */
export function examPrep(s: GameState) {
  return Math.min(3, Math.floor((s.player.examPrep ?? 0) / 4));
}

/** 식년시: 3년마다 3월 / 별시: 식년이 아닌 해 가을에 가끔 */
export function rollExamCall(s: GameState) {
  const y = yearOf(s.t);
  const m = monthOf(s.t);
  const sik = m === 3 && (y - 1576) % 3 === 0;
  const byeol = m === 9 && (y - 1576) % 3 !== 0 && chance(s, 0.35);
  if (!sik && !byeol) return;
  if (canSitExam(s)) return;
  pushEvent(s, 'gwageo', { kind: sik ? 'sik' : 'byeol' });
}

export const GWAGEO_EVENTS: Record<string, EventDef> = {
  gwageo: {
    build(s, c) {
      const p = P(s);
      const sik = c.kind === 'sik';
      const need = sik ? 14 : 15;
      const prep = examPrep(s);
      return {
        title: sik ? '식년시(式年試)' : '별시(別試)',
        kind: 'personal',
        text:
          `${sik ? '3년마다 열리는 식년 문과' : '나라에 경사가 있어 별시'}가 열린다. ${p.eumseo ? '음서로 나선 몸이라 청요직에는 오르지 못하고 승진도 더디다. 급제하면 그 굴레를 벗는다.' : '급제하면 정식으로 벼슬길이 열린다.'}\n\n` +
          `판정: 주사위 + 학식 ${p.learning} + 준비 ${prep} ≥ ${need}. 합이 ${need + 3} 이상이면 장원이다.\n준비는 학문 수양·강학을 할 때마다 쌓인다 (지금 ${s.player.examPrep ?? 0}, 4마다 +1, 최대 +3). 문과는 3년에 서른셋만 뽑는 좁은 문이다.`,
        choices: [
          { key: 'sit', label: '응시한다', hint: `급제하면 음서의 굴레를 벗고 명망 +3 (장원이면 +6, 6품으로). 낙방하면 명망 -1` },
          { key: 'skip', label: '이번에는 쉰다', hint: '준비는 그대로 남는다' },
        ],
      };
    },
    resolve(s, c, key) {
      if (key !== 'sit') return '다음 과거를 기약했다.';
      const p = P(s);
      const sik = c.kind === 'sik';
      const need = sik ? 14 : 15;
      const roll = d6(s) + p.learning + examPrep(s);
      s.player.examPrep = 0;
      if (roll < need) {
        pres(p, -1);
        return `낙방했다. (판정 ${roll}, ${need} 이상 필요) 명망 -1`;
      }
      const top = roll >= need + 3;
      const was = p.eumseo;
      p.eumseo = false;
      if (!p.tags.includes('passed')) p.tags.push('passed');
      pres(p, top ? 6 : 3);
      const label = top ? '장원' : '급제';
      s.player.deeds.push(`${yearOf(s.t)}.${String(monthOf(s.t)).padStart(2, '0')} ${sik ? '식년시' : '별시'} ${label}`);
      log(s, `${josa(p.name, '이/가')} ${sik ? '식년시' : '별시'}에 ${label}했다.`, 'player');
      if (top) p.rank = Math.min(p.rank, 6);
      else p.rank = Math.min(p.rank, 9);
      if (p.status !== 'active' && p.status !== 'exiled') {
        appointGeneric(s, p, 'nanggwan');
        if (top) p.rank = Math.min(p.rank, 6);
      }
      p.promotedAt = Math.min(p.promotedAt, s.t - 12);
      notice(s, `과거 ${label}`, `${label}했다! (판정 ${roll})${was ? ' 이제 음서 출신이라는 굴레를 벗었다. 청요직에도 오를 수 있다.' : ''}`, 'personal');
      return `${label}했다. (판정 ${roll})`;
    },
  },
};

