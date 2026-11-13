import { useState } from 'react';
import { useG } from './ctx';
import type { Character, MemorialTopic } from '../engine/types';
import { LAWS, LAW_MAP, lawOpen } from '../engine/laws';
import { lawMemorialError, MEMORIAL_INFO, memorialError, runTargetAction, startMemorial } from '../engine/actions';
import { ARTICLES, articleError, articleParts, chargeOptions, impeachDraft, memorialMonths } from '../engine/sangso';
import { P } from '../engine/state';
import { OFFICE_MAP } from '../engine/data/offices';

/** 상소를 짓는다: 주제를 고르고 담을 조목을 고른다 */
export function MemorialComposer() {
  const { s, act } = useG();
  const p = P(s);
  const [topic, setTopic] = useState<'sipye' | 'jojae' | 'law'>('sipye');
  const openLaws = LAWS.filter((l) => lawOpen(s, l));
  const [lawChoice, setLaw] = useState(openLaws[0]?.id ?? '');
  const lawPick = openLaws.some((l) => l.id === lawChoice) ? lawChoice : (openLaws[0]?.id ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const t = topic as MemorialTopic;
  const live = picked.filter((id) => !articleError(s, id, t));
  const months = memorialMonths(live);
  const bonus = articleParts(s, p, t, live).reduce((a, x) => a + x.value, 0);
  const err = memorialError(s) ?? (topic === 'law' ? (!LAW_MAP[lawPick] ? '논할 법이 없다' : lawMemorialError(s, lawPick)) : null);
  const toggle = (id: string) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  return (
    <div className="composer">
      <div className="comp-topics">
        {(['sipye', 'jojae', 'law'] as const).map((k) => (
          <button key={k} className={`mini ${topic === k ? 'on' : ''}`} title={MEMORIAL_INFO[k].desc} onClick={() => setTopic(k)}>
            {MEMORIAL_INFO[k].name}
          </button>
        ))}
      </div>
      {topic === 'law' && (
        <select value={lawPick} onChange={(e) => setLaw(e.target.value)}>
          {openLaws.map((l) => (
            <option key={l.id} value={l.id}>
              {s.laws[l.id]?.on ? `${l.name} 폐지` : `${l.name} 시행`}
            </option>
          ))}
        </select>
      )}
      <p className="small muted">상소에 담을 내용을 고른다. 많이 담을수록 힘이 실리지만 짓는 데 오래 걸린다.</p>
      <ul className="comp-articles">
        {ARTICLES.map((a) => {
          const why = articleError(s, a.id, t);
          const part = why ? null : a.part?.(s, p, t);
          return (
            <li key={a.id} className={why ? 'off' : ''} title={why ?? a.desc}>
              <label>
                <input type="checkbox" disabled={!!why} checked={live.includes(a.id)} onChange={() => toggle(a.id)} />
                <span>{a.name}</span>
                <em className="muted small">
                  {why ?? `${a.months ? `+${a.months}달` : '시간 그대로'}${part ? ` · ${part.label} ${part.value > 0 ? '+' : ''}${part.value}` : ''}`}
                </em>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="comp-foot">
        <span className="small">
          짓는 데 <b>{months}달</b> · 조목의 힘 {bonus >= 0 ? '+' : ''}
          {bonus}
        </span>
        <button
          className="fbtn"
          disabled={!!err}
          title={err ?? (topic === 'law' ? `${LAW_MAP[lawPick]?.desc ?? ''}\n효과: ${LAW_MAP[lawPick]?.effect ?? ''}` : MEMORIAL_INFO[topic].desc)}
          onClick={() =>
            act((g) =>
              topic === 'law'
                ? startMemorial(g, 'law', { lawId: lawPick, abolish: !!g.laws[lawPick]?.on, articles: live })
                : startMemorial(g, topic, { articles: live }),
            )
          }
        >
          상소를 짓기 시작한다
        </button>
      </div>
      <p className="small muted">상소는 행동력이 들지 않는다. 짓는 동안 인물 창의 「연명 요청」으로 연명을 모은다. 올리면 임금의 비답이 돌아온다.</p>
    </div>
  );
}

/** 탄핵 계사를 짓는다: 어떤 흠결로 논할지 고른다 */
export function ImpeachComposer({ c, onClose }: { c: Character; onClose: () => void }) {
  const { s, act } = useG();
  const p = P(s);
  const opts = chargeOptions(s, c);
  const [sel, setSel] = useState<string[]>(() => opts.filter((o) => o.ok).map((o) => o.f.id));
  const samsa = !!(p.office && OFFICE_MAP[p.office]?.samsa);
  const live = sel.filter((id) => opts.some((o) => o.ok && o.f.id === id));
  const labels = opts.filter((o) => live.includes(o.f.id)).map((o) => o.f.label);
  const pungmun = samsa && live.length === 0;
  const toggle = (id: string) => setSel((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  return (
    <div className="composer impeach-comp">
      <h5>탄핵 계사(啓辭) — {c.name}</h5>
      {opts.length ? (
        <ul className="comp-articles">
          {opts.map(({ f, ok, why }) => (
            <li key={f.id} className={ok ? '' : 'off'}>
              <label>
                <input type="checkbox" disabled={!ok} checked={ok && live.includes(f.id)} onChange={() => toggle(f.id)} />
                <span>「{f.label}」</span>
                <em className="muted small">{!ok ? why : `${f.public ? '드러난 허물' : '당신만 아는 허물'}${f.fake ? ' · 날조 (지면 들통날 수 있다)' : ''} · +1`}</em>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">알고 있는 흠결이 없다. 「뒷조사」로 약점을 캐 둘 수 있다.</p>
      )}
      <p className="small">
        「{impeachDraft(s, p, c, labels, pungmun)}」
      </p>
      <p className="small muted">
        고른 흠결 하나마다 공격 +1. 탄핵에 쓴 흠결은 세상에 드러나고 3년 동안 다시 쓰지 못하며, 이기면 죗값을 치른 일이 된다. 고르지 않은 흠결은 다음을 위해 남는다.
        {samsa ? ' 삼사 언관은 흠결 없이 풍문으로도 논할 수 있고, 그때는 져도 무고의 죄를 받지 않는다.' : ''}
      </p>
      <div className="comp-foot">
        <button className="mini" onClick={onClose}>
          그만둔다
        </button>
        <button
          className="fbtn"
          onClick={() => {
            act((g) => {
              g.player.draftCharges = live;
              const out = runTargetAction(g, 'impeach', c.id);
              g.player.draftCharges = null;
              return out;
            });
            onClose();
          }}
        >
          {pungmun ? '풍문으로 논핵한다' : `${live.length}가지 죄목으로 논핵한다`}
        </button>
      </div>
    </div>
  );
}
