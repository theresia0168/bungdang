import { useEffect, useState } from 'react';
import { useG } from '../ctx';
import { P, officeTitle } from '../../engine/state';
import { FACTION_META } from '../../engine/data/meta';
import { network, TIE_META, type TieKind } from '../../engine/network';
import { Opinion } from '../common';

const W = 560;
const C = W / 2;

/** 플레이어를 가운데 두고, 가까운 사람일수록 안쪽에 그린다 */
export function NetworkTab() {
  const { s, select, act } = useG();
  useEffect(() => {
    if (!s.flags.sawNetwork) act((g) => void (g.flags.sawNetwork = true));
  }, [s, act]);
  const p = P(s);
  const [only, setOnly] = useState<TieKind | null>(null);
  const ties = network(s).filter((t) => !only || t.kinds.includes(only));
  const used = new Set(network(s).flatMap((t) => t.kinds));
  // 당색끼리 모이도록 각도를 나눈다
  const order = [...ties].sort((a, b) => a.c.faction.localeCompare(b.c.faction) || b.op - a.op);
  const pos = new Map(
    order.map((t, i) => {
      const ang = (i / Math.max(1, order.length)) * Math.PI * 2 - Math.PI / 2;
      const r = 70 + ((100 - Math.max(-100, Math.min(100, t.op))) / 200) * 170;
      return [t.c.id, { x: C + Math.cos(ang) * r, y: C + Math.sin(ang) * r }];
    }),
  );

  return (
    <div className="network">
      <p className="muted small">
        가운데가 당신이다. 당신을 좋게 보는 사람일수록 안쪽에, 미워할수록 바깥쪽에 있다. 원의 색은 당색, 선의 색은 관계다. 사람을 누르면 인물 창이 열린다.
      </p>
      <div className="filters">
        <button className={`chip ${!only ? 'on' : ''}`} onClick={() => setOnly(null)}>
          전체
        </button>
        {(Object.keys(TIE_META) as TieKind[])
          .filter((k) => used.has(k))
          .map((k) => (
            <button key={k} className={`chip ${only === k ? 'on' : ''}`} onClick={() => setOnly(k)} style={{ borderColor: TIE_META[k].color }}>
              {TIE_META[k].name}
            </button>
          ))}
      </div>
      {ties.length === 0 ? (
        <p className="muted">아직 맺은 인연이 없다. 서신과 방문, 혼담으로 사람을 사귀어라.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${W}`} className="net-svg" role="img" aria-label="인맥도">
          {[70, 155, 240].map((r) => (
            <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="var(--line)" strokeDasharray="2 6" />
          ))}
          {ties.map((t) => {
            const q = pos.get(t.c.id)!;
            const k = t.kinds[0];
            return <line key={t.c.id} x1={C} y1={C} x2={q.x} y2={q.y} stroke={TIE_META[k].color} strokeWidth={t.kinds.length > 1 ? 2.5 : 1.5} strokeDasharray={TIE_META[k].dash} opacity={0.75} />;
          })}
          <circle cx={C} cy={C} r={20} fill={FACTION_META[p.faction].color} stroke="var(--gold2)" strokeWidth={3} />
          <text x={C} y={C + 5} textAnchor="middle" className="net-me">
            {p.name.slice(0, 1)}
          </text>
          {ties.map((t) => {
            const q = pos.get(t.c.id)!;
            return (
              <g key={t.c.id} className="net-node" onClick={() => select(t.c.id)}>
                <title>{`${t.c.name} (${FACTION_META[t.c.faction].name}, ${officeTitle(t.c)}) — ${t.kinds.map((k) => TIE_META[k].name).join(', ')} · 그가 보는 나 ${t.op}`}</title>
                <circle cx={q.x} cy={q.y} r={11} fill={FACTION_META[t.c.faction].color} stroke={t.c.status === 'exiled' ? 'var(--red)' : 'var(--bg)'} strokeWidth={2} />
                <text x={q.x} y={q.y + 24} textAnchor="middle" className="net-label">
                  {t.c.name}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <table className="net-table">
        <thead>
          <tr>
            <th>인물</th>
            <th>관계</th>
            <th>그가 보는 나</th>
            <th>내가 보는 그</th>
          </tr>
        </thead>
        <tbody>
          {ties.map((t) => (
            <tr key={t.c.id} onClick={() => select(t.c.id)}>
              <td>
                <b>{t.c.name}</b> <span className="muted small">{FACTION_META[t.c.faction].name} · {officeTitle(t.c)}</span>
              </td>
              <td>
                {t.kinds.map((k) => (
                  <span key={k} className="net-tag" style={{ borderColor: TIE_META[k].color, color: TIE_META[k].color }}>
                    {TIE_META[k].name}
                    {k === 'debt' ? ` ${'●'.repeat(s.player.debts[t.c.id] ?? 0)}` : ''}
                  </span>
                ))}
              </td>
              <td>
                <Opinion v={t.op} />
              </td>
              <td>
                <Opinion v={t.mine} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
