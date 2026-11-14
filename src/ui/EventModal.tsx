import { useG } from './ctx';
import type { PendingEvent } from '../engine/types';
import { viewEvent } from '../engine/events';
import { AUTO_NAMES, resolveEvent } from '../engine/turn';
import { josa } from '../engine/state';
import { useState } from 'react';
import { OUTCOME_LABEL, type RollPart } from '../engine/conflict';
import { formatDate } from '../engine/calendar';
import { CharLink, Paras } from './common';

const KIND_LABEL: Record<string, string> = {
  history: '역사',
  personal: '사사(私事)',
  notice: '소식',
  danger: '위기',
  court: '조정',
  war: '전란',
};

function Parts({ title, who, parts, roll, total }: { title: string; who?: string; parts: RollPart[]; roll: number; total: number }) {
  return (
    <div className="roll-col">
      <h5>
        {title} {who && <CharLink id={who} />}
      </h5>
      <ul>
        <li className="die">
          <span>주사위</span>
          <b>{roll}</b>
        </li>
        {parts.map((p, i) => (
          <li key={i}>
            <span>{p.label}</span>
            <b>{p.value > 0 ? `+${Math.round(p.value * 10) / 10}` : Math.round(p.value * 10) / 10}</b>
          </li>
        ))}
        <li className="total">
          <span>합계</span>
          <b>{Math.round(total * 10) / 10}</b>
        </li>
      </ul>
    </div>
  );
}

export function EventModal({ ev, more }: { ev: PendingEvent; more: number }) {
  const { s, act } = useG();
  const v = viewEvent(s, ev);
  const r = v.report;
  const m = v.memorial;
  const autoName = AUTO_NAMES[ev.def];
  const [remember, setRemember] = useState(false);

  return (
    <div className="modal-back">
      <div className={`modal kind-${v.kind ?? 'notice'}`}>
        <div className="modal-head">
          <span className="modal-kind">{KIND_LABEL[v.kind ?? 'notice']}</span>
          <span className="modal-date">{formatDate(s.t)}</span>
        </div>
        <h2>{v.title}</h2>
        <div className="modal-text">
          <Paras text={v.text} />
        </div>

        {r && (
          <div className="roll">
            <Parts title="공격" who={r.attacker} parts={r.aParts} roll={r.aRoll} total={r.aTotal} />
            <div className="roll-vs">
              <span>격차</span>
              <b>{Math.round((r.aTotal - r.dTotal) * 10) / 10}</b>
              <em>{OUTCOME_LABEL[r.outcome]}</em>
            </div>
            <Parts title="방어" who={r.target} parts={r.dParts} roll={r.dRoll} total={r.dTotal} />
          </div>
        )}
        {m && !m.veto && (
          <div className="roll single">
            <Parts title="상소" parts={m.parts} roll={m.roll} total={m.total} />
            <div className="roll-vs">
              <span>왕의 기준</span>
              <b>{m.difficulty}</b>
              <em>{m.success ? '가납' : m.disaster ? '진노' : '불윤'}</em>
            </div>
          </div>
        )}

        <div className="choices">
          {v.choices.map((c) => (
            <button
              key={c.key}
              className="choice"
              disabled={!!c.disabled}
              title={c.disabled}
              onClick={() =>
                act((g) => {
                  if (remember && autoName) {
                    g.player.auto = { ...(g.player.auto ?? {}), [ev.def]: c.key };
                    g.player.autoLabel = { ...(g.player.autoLabel ?? {}), [ev.def]: c.label };
                  }
                  return resolveEvent(g, ev.id, c.key);
                })
              }
            >
              <b>{c.label}</b>
              {(c.hint || c.disabled) && <span>{c.disabled ?? c.hint}</span>}
            </button>
          ))}
        </div>
        {autoName && (
          <label className="modal-auto">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 다음부터 {josa(autoName, '은/는')} 이 선택으로 알아서 처리한다 <span className="muted small">(왼쪽 「거취」에서 해제)</span>
          </label>
        )}
        {more > 0 && <div className="modal-more">이어서 {more}건이 더 있다</div>}
      </div>
    </div>
  );
}
