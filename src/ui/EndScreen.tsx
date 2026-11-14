import { useG } from './ctx';
import { computeEnding } from '../engine/ending';
import { P } from '../engine/state';
import { Paras, Portrait } from './common';
import { ACHIEVEMENTS } from '../engine/achv';

export function EndScreen({ onRestart }: { onRestart: () => void }) {
  const { s } = useG();
  const p = P(s);
  const e = computeEnding(s);

  return (
    <div className="end">
      <div className="end-scroll">
        <div className="end-head">
          <Portrait c={p} size={88} />
          <div>
            <div className="end-title">{e.title}</div>
            <h1>
              {p.name}
              {p.ho && <small> {p.ho}</small>}
            </h1>
            <div className="end-epithet">{e.epithet}</div>
          </div>
        </div>
        <div className="end-obit">
          <Paras text={e.obituary} />
        </div>
        <div className="end-score">
          <table>
            <tbody>
              {e.breakdown.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td className={b.value < 0 ? 'neg' : ''}>{b.value > 0 ? `+${b.value}` : b.value}</td>
                </tr>
              ))}
              <tr className="sum">
                <td>평가</td>
                <td>{e.score}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {!!s.player.achv?.length && (
          <div className="end-deeds">
            <h3>이 판의 업적</h3>
            <ul>
              {ACHIEVEMENTS.filter((a) => s.player.achv!.includes(a.id)).map((a) => (
                <li key={a.id}>
                  ◆ {a.name} <span className="muted small">— {a.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.player.deeds.length > 0 && (
          <div className="end-deeds">
            <h3>행장(行狀)</h3>
            <ul>
              {s.player.deeds.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        )}
        <button className="btn-primary big" onClick={onRestart}>
          처음으로
        </button>
      </div>
    </div>
  );
}
