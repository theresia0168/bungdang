import { useG } from '../ctx';
import { P } from '../../engine/state';
import { FACTION_META } from '../../engine/data/meta';
import { activeFactions, influence, members, powerShare, standing } from '../../engine/factions';
import { Bar, CharLink, Opinion } from '../common';

export function FactionTab() {
  const { s } = useG();
  const p = P(s);
  const share = powerShare(s);
  const facs = activeFactions(s);

  return (
    <div className="factions">
      <div className="tension-box">
        <div>
          <b>붕당 간 긴장</b> <span className="big-num">{Math.round(s.tension)}</span>
        </div>
        <Bar value={s.tension} color="linear-gradient(90deg,#7a6a3a,#b8432f)" />
        <p className="muted small">긴장이 높을수록 서로 탄핵이 잦아지고, 다른 당 사람의 호감이 떨어진다. 조제 상소와 당색을 넘은 혼인이 이를 누그러뜨린다.</p>
      </div>

      <div className="fac-cards">
        {facs.map((f) => {
          const m = FACTION_META[f];
          const st = s.factions[f];
          const ms = members(s, f)
            .map((c) => ({ c, inf: influence(s, c) }))
            .sort((a, b) => b.inf - a.inf);
          const mine = p.faction === f;
          const myStanding = standing(s, f);
          return (
            <section key={f} className={`fac-card ${mine ? 'mine' : ''}`} style={{ ['--fc' as string]: m.color }}>
              <header>
                <span className="fac-seal">{m.short}</span>
                <div>
                  <h3>
                    {m.name} {mine && <small>(내 당)</small>}
                  </h3>
                  <p className="small muted">{m.desc}</p>
                </div>
              </header>
              <div className="fac-stats">
                <div>
                  <span>조정 당세</span>
                  <b>{Math.round(share[f] * 100)}%</b>
                  <Bar value={share[f] * 100} color={m.color} />
                </div>
                <div>
                  <span>영수</span>
                  <b>{st.leader ? <CharLink id={st.leader} /> : '—'}</b>
                </div>
                <div>
                  <span>인원</span>
                  <b>{ms.length}명</b>
                </div>
                <div title="당내 분열 값. 영수의 영향력을 넘으면 당이 갈라질 수 있다.">
                  <span>분열</span>
                  <b>{Math.round(st.division)}</b>
                  <Bar value={st.division} max={Math.max(30, ms[0]?.inf ?? 30)} color="#b8432f" />
                </div>
                <div title={`${m.name} 사람들이 당신을 보는 평균 호감`}>
                  <span>나에 대한 평판</span>
                  <b>
                    <Opinion v={myStanding} />
                  </b>
                </div>
              </div>
              <ol className="fac-members">
                {ms.slice(0, 10).map(({ c, inf }) => (
                  <li key={c.id}>
                    <CharLink id={c.id} />
                    <span className="muted small">{c.status === 'active' ? '' : c.status === 'exiled' ? '유배' : c.status === 'retired' ? '낙향' : '대기'}</span>
                    <span className="fm-inf">{inf}</span>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}
