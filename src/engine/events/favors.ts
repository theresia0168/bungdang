import type { EventDef } from './types';
import { OK } from './types';
import type { Goal } from '../types';
import { FACTION_META, FLAW_POOL } from '../data/meta';
import { chance, pick } from '../rng';
import { addFlaw, alive, clamp, hiddenFlaws, inCourt, josa, knownFlaws, officeTitle, owe, P, people } from '../state';
import { inLaws, sway } from '../opinion';
import { CASE_MONTHS, caseById, joinCase, nextLevelLabel, sideOf, withdraw } from '../cases';
import { TARGET_ACTIONS, actionError, marry, runTargetAction } from '../actions';
import { GOALS, goalKey, goalOptions, setGoal } from '../goals';
import { fulfill } from '../relations';

const fname = (f: string) => FACTION_META[f as keyof typeof FACTION_META].name;

export const FAVOR_EVENTS: Record<string, EventDef> = {
  impeached: {
    build(s, c) {
      const cs = caseById(s, c.caseId);
      const p = P(s);
      if (!cs) return { title: '탄핵', text: '논핵은 이미 끝났다.', choices: OK };
      const a = s.chars[cs.attacker];
      const kf = knownFlaws(p, a.id);
      return {
        title: '논핵을 당하다',
        kind: 'danger',
        text:
          `${a.name}(${fname(a.faction)}, ${officeTitle(a)})${josa(a.name, '이/가').slice(a.name.length)} 당신을 논핵하는 계사를 올렸다.\n\n` +
          (kf.length ? `그가 쥐고 있는 당신의 흠결: ${kf.map((f) => `「${f.label}」`).join(', ')}` : '그가 아는 당신의 흠결은 없다. 근거가 약한 공격이다.') +
          `\n\n논핵은 ${CASE_MONTHS.impeach}개월 동안 이어진다. 그동안 인물 창의 「연명·구원 요청」으로 편을 모으라. 당신에게 신세를 진 이들은 알아서 나선다. ` +
          '구원자 1인당 방어 +1(최대 +3), 공격 쪽 동조자도 마찬가지다.\n\n' +
          '격차가 1~2면 파직(관직이 없으면 삭탈관직), 3~4면 삭탈관작·문외출송, 5 이상이면 유배. 탄핵만으로 목숨을 잃지는 않지만, 유배된 뒤에는 가죄(위리안치·사사)를 청하는 상소가 이어질 수 있다.',
        choices: [
          { key: 'explain', label: '해명 상소를 올린다', hint: '방어 +1' },
          { key: 'endure', label: '대죄(待罪)하며 버틴다', hint: '보정 없음. 막아내면 명망 +3' },
          { key: 'resign', label: '사직하고 물러난다', hint: '관직을 잃고 낙향한다. 논핵은 끝나지 않지만 스스로 물러난 점이 참작된다(방어 +1). 명망 +1, 성심 -3, 반년 동안 서용되지 않는다.', disabled: p.office ? undefined : '이미 관직에 있지 않다' },
          {
            key: 'counter',
            label: `${josa(a.name, '을/를')} 맞받아 논핵한다`,
            hint: '그를 겨눈 논핵을 새로 연다 (탄핵과 같은 조건·쿨다운). 해명은 하지 못한다.',
            disabled: actionError(s, TARGET_ACTIONS.find((x) => x.id === 'impeach')!, a) ?? undefined,
          },
        ],
      };
    },
    resolve(s, c, key) {
      const cs = caseById(s, c.caseId);
      if (!cs) return;
      if (key === 'resign') {
        withdraw(s, cs);
        return '사직하고 고향으로 내려갔다.';
      }
      if (key === 'counter') {
        cs.response = 'endure';
        const msg = runTargetAction(s, 'impeach', cs.attacker);
        return `${msg} 공방이 둘로 번졌다.`;
      }
      cs.response = key === 'explain' ? 'explain' : 'endure';
      return key === 'explain' ? '해명 상소를 올렸다. 이제 구원해 줄 사람을 모으라.' : '대죄하며 처분을 기다린다. 구원해 줄 사람을 모으라.';
    },
  },

  aggravated: {
    build(s, c) {
      const cs = caseById(s, c.caseId);
      const p = P(s);
      if (!cs) return { title: '가죄', text: '논의는 이미 끝났다.', choices: OK };
      const a = s.chars[cs.attacker];
      return {
        title: '죄를 더하라는 계사',
        kind: 'danger',
        text:
          `${josa(a.name, '이/가')} 유배 중인 당신에게 ${nextLevelLabel(p)}의 죄를 더하라고 청했다.\n\n` +
          `논의는 ${CASE_MONTHS.aggravate}개월 동안 이어진다. 서신으로 「연명·구원 요청」을 보내 조정의 벗들에게 도움을 청하라. 당신에게 신세를 진 이들은 알아서 나선다.\n\n` +
          `왕은 ${(p.exileLevel ?? 1) >= 2 ? '사사만은 쉽게 허락하지 않는다 (방어 +5)' : '죄를 더하는 데 신중하다 (방어 +2)'}. 왕의 진노를 샀거나 성심을 잃었다면 위험하다.`,
        choices: [{ key: 'ok', label: '벗들에게 서신을 쓴다' }],
      };
    },
    resolve() {},
  },

  req_defend: {
    build(s, c) {
      const cs = caseById(s, c.caseId);
      if (!cs) return { title: '구명 요청', text: '논핵은 이미 끝났다.', choices: OK };
      const a = s.chars[cs.attacker];
      const t = s.chars[cs.target];
      return {
        title: '구명 요청',
        kind: 'court',
        text: `${officeTitle(t)} ${josa(t.name, '이/가')} ${a.name}의 논핵을 받고 있다. 그가 밤늦게 사람을 보내 구원 상소에 이름을 올려 달라고 간곡히 청한다.`,
        choices: [
          { key: 'yes', label: '구원에 나선다 (행동력 1)', hint: `${josa(t.name, "이/가")} 신세를 진다. ${josa(a.name, "과/와")} 그 가문의 미움을 산다.`, disabled: s.player.ap < 1 ? '이번 달 행동력이 없다' : undefined },
          { key: 'no', label: '몸을 사린다', hint: `${t.name} 호감 -10` },
        ],
      };
    },
    resolve(s, c, key) {
      const cs = caseById(s, c.caseId);
      if (!cs) return;
      const t = s.chars[cs.target];
      if (key === 'yes' && !sideOf(cs, s.player.charId)) return joinCase(s, cs.id, 'con');
      return sway(s, t, P(s).id, -10, '구명을 외면', { decay: 0.15 }).join(', ');
    },
  },

  req_office: {
    build(s, c) {
      const a = s.chars[c.asker];
      return {
        title: '인사 청탁',
        kind: 'court',
        text: `${josa(a.name, '이/가')} 은근히 찾아와, 이조에 있는 당신이 자신을 좋은 자리에 천거해 주기를 바란다는 뜻을 비쳤다.`,
        choices: [
          { key: 'yes', label: '들어준다', hint: `${josa(a.name, "이/가")} 신세를 지고 6개월간 임용 점수 +8. 30% 확률로 「인사 청탁」 흠결(그가 앎).` },
          { key: 'no', label: '공도(公道)를 지킨다', hint: `${a.name} 호감 -6, 명망 +1` },
        ],
      };
    },
    resolve(s, c, key) {
      const a = s.chars[c.asker];
      const p = P(s);
      if (!alive(a)) return;
      if (key === 'yes') {
        s.recs[a.id] = s.t + 6;
        owe(s, a.id);
        const fx = sway(s, a, p.id, 10, '청탁을 들어줌', { decay: 0.15 });
        if (chance(s, 0.3)) addFlaw(s, p, '인사 청탁', false, [a.id]);
        return `${a.name}의 청을 들어주었다. 그가 당신에게 신세를 졌다. (${fx.join(', ')})`;
      }
      p.prestige = clamp(p.prestige + 1, 0, 100);
      return sway(s, a, p.id, -6, '청탁 거절', { decay: 0.2 }).join(', ');
    },
  },

  req_loan: {
    build(s, c) {
      const a = s.chars[c.asker];
      return {
        title: '어려운 살림',
        kind: 'personal',
        text: `${josa(a.name, '이/가')} 집안에 우환이 겹쳐 살림이 어렵다며, 체면을 무릅쓰고 재물을 융통해 달라고 청한다.`,
        choices: [
          { key: 'yes', label: '재물 20을 보낸다', hint: `${josa(a.name, "이/가")} 신세를 진다. 호감 +8`, disabled: P(s).wealth < 20 ? '재산이 모자란다' : undefined },
          { key: 'no', label: '형편이 어렵다고 사양한다', hint: `${a.name} 호감 -4` },
        ],
      };
    },
    resolve(s, c, key) {
      const a = s.chars[c.asker];
      const p = P(s);
      if (!alive(a)) return;
      if (key === 'yes') {
        p.wealth -= 20;
        owe(s, a.id);
        const wish = fulfill(s, a, 'wealth');
        return `${a.name}에게 재물을 보냈다. 그가 당신에게 신세를 졌다. (${sway(s, a, p.id, 8, '어려울 때 도움', { decay: 0.1 }).join(', ')})${wish ? ` ${wish}` : ''}`;
      }
      return sway(s, a, p.id, -4, '도움을 거절', { decay: 0.2 }).join(', ');
    },
  },

  req_marriage: {
    build(s, c) {
      const a = s.chars[c.asker];
      const p = P(s);
      const cross = a.faction !== 'none' && p.faction !== 'none' && a.faction !== p.faction;
      return {
        title: '혼담이 들어오다',
        kind: 'personal',
        text: `${a.clan}의 ${josa(a.name, '이/가')} 매파를 보내 당신 집안과 사돈을 맺고 싶다는 뜻을 전해 왔다.${cross ? ` 그는 ${fname(a.faction)}이라 당내에서 말이 나올 수 있다.` : ''}`,
        choices: [
          { key: 'yes', label: '혼인을 받아들인다 (재산 20)', hint: '두 가문이 사돈이 된다. 직접 청하는 혼담의 절반 비용.', disabled: p.wealth < 20 ? '혼수가 모자란다' : s.player.children <= 0 ? '혼기의 자녀가 없다' : undefined },
          { key: 'no', label: '정중히 사양한다', hint: `${a.name} 호감 -5` },
        ],
      };
    },
    resolve(s, c, key) {
      const a = s.chars[c.asker];
      const p = P(s);
      if (!alive(a)) return;
      if (key === 'yes' && s.player.children > 0 && !inLaws(s, p.clan, a.clan)) return marry(s, a, 20);
      return sway(s, a, p.id, -5, '혼담 거절', { decay: 0.2 }).join(', ');
    },
  },

  req_secret: {
    build(s, c) {
      const f = s.chars[c.from];
      return {
        title: '은밀한 귀띔',
        kind: 'court',
        text: `${josa(f.name, '이/가')} 술자리 끝에 목소리를 낮추어, 조정의 누군가가 감추고 있는 일을 알고 있다고 귀띔한다. 그는 당신을 믿어서 하는 말이라고 했다.`,
        choices: [
          { key: 'listen', label: '듣는다', hint: '누군가의 숨은 흠결 하나를 알게 된다' },
          { key: 'refuse', label: '남의 허물은 듣지 않겠다', hint: `명망 +1, ${f.name} 호감 +3` },
        ],
      };
    },
    resolve(s, c, key) {
      const f = s.chars[c.from];
      const p = P(s);
      if (key === 'refuse') {
        p.prestige = clamp(p.prestige + 1, 0, 100);
        if (alive(f)) sway(s, f, p.id, 3, '군자의 처신', { decay: 0.2 });
        return '그 이야기는 거기서 그쳤다.';
      }
      const marks = people(s).filter((x) => x.id !== p.id && inCourt(x) && hiddenFlaws(x).some((fl) => !fl.knownBy.includes(p.id) && !fl.fake));
      const m = marks.length ? pick(s, marks) : undefined;
      if (!m) return '들어 보니 이미 아는 이야기였다.';
      const fl = hiddenFlaws(m).find((x) => !x.knownBy.includes(p.id) && !x.fake)!;
      fl.knownBy.push(p.id);
      return `${officeTitle(m)} ${m.name}의 「${fl.label}」 건을 알게 되었다. 탄핵이나 협박에 쓸 수 있다.`;
    },
  },

  investigate_empty: {
    build(s, c) {
      const t = s.chars[c.targetId];
      return {
        title: '나오지 않는 먼지',
        kind: 'court',
        text: `겸인들이 ${t.name}의 뒤를 샅샅이 캤지만 흠잡을 것이 나오지 않았다. 겸인 하나가 "없으면 만들면 됩니다" 하고 눈치를 본다.`,
        choices: [
          { key: 'drop', label: '그만둔다', hint: '깨끗한 사람이다' },
          {
            key: 'fake',
            label: '혐의를 지어낸다',
            hint: '탄핵할 때 +1이 되는 가짜 약점이 생긴다. 탄핵이 실패하면 절반 확률로 날조가 들통나 「혐의 날조」 흠결과 성심 -10.',
          },
        ],
      };
    },
    resolve(s, c, key) {
      const t = s.chars[c.targetId];
      if (key !== 'fake' || !alive(t)) return `${josa(t.name, '은/는')} 깨끗한 사람이었다.`;
      const f = addFlaw(s, t, pick(s, FLAW_POOL), false, [s.player.charId]);
      f.fake = true;
      return `${t.name}에게 「${f.label}」 혐의를 씌울 증좌를 꾸몄다.`;
    },
  },

  goal_pick: {
    build(s) {
      const opts = goalOptions(s);
      return {
        title: '뜻을 세우다',
        kind: 'personal',
        text: '선비는 뜻을 세워야 한다. 앞으로 무엇을 이루려 하는가?\n\n이룬 뜻 하나마다 명망 +4, 결말 점수 +15. 뜻은 왼쪽 패널에서 언제든 바꿀 수 있다.',
        choices: [
          ...opts.map((g, i) => ({ key: `g${i}`, label: goalKey(s, g), hint: GOALS[g.kind].desc })),
          { key: 'none', label: '아직 정하지 않는다' },
        ],
      };
    },
    resolve(s, _c, key) {
      if (key === 'none') {
        setGoal(s, null);
        return;
      }
      const g: Goal | undefined = goalOptions(s)[Number(key.slice(1))];
      if (!g) return;
      setGoal(s, g);
      return `뜻을 세웠다: ${goalKey(s, g)}`;
    },
  },
};