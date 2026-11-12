import { useG } from '../ctx';
import { P } from '../../engine/state';
import { FACTION_META } from '../../engine/data/meta';
import { activeFactions, influence, members, powerShare, standing } from '../../engine/factions';
import { Bar, CharLink, Opinion } from '../common';
import { WING_NAME, cheongyoHeld, gongronOf, wingHead, wingShare } from '../../engine/strife';

export function FactionTab() {
  const { s } = useG();
  const p = P(s);
  const share = powerShare(s);
  const facs = activeFactions(s);
  const cy = cheongyoHeld(s);
  const gr = gongronOf(s);
  const ok = s.oksa;

  return (
    <div className="factions">
      <div className="tension-box">
        <div>
          <b>붕당 간 긴장</b> <span className="big-num">{Math.round(s.tension)}</span>
        </div>
        <Bar value={s.tension} color="linear-gradient(90deg,#7a6a3a,#b8432f)" />
        <p className="muted small">긴장이 높을수록 서로 탄핵이 잦아지고, 다른 당 사람의 호감이 떨어진다. 조제 상소와 당색을 넘은 혼인이 이를 누그러뜨린다.</p>
      </div>

      {ok && (
        <div className="tension-box bad">
          <b>국청이 열려 있다</b> — {FACTION_META[ok.faction].name} <CharLink id={ok.accused} />의 역모 고변. {ok.due - s.t}달 뒤 결판.{' '}
          {ok.judge && (
            <>
              위관 <CharLink id={ok.judge} />
            </>
          )}
        </div>
      )}

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
                <div title="삼사·청요직 가운데 이 당이 쥔 자리. 절반을 넘으면 탄핵에 「언로 장악」 +1">
                  <span>청요직</span>
                  <b>
                    {cy[f] ?? 0} / {cy.total}
                  </b>
                </div>
                <div title="재야 명망가·서원·유생의 목소리. 상대 당보다 15%p 넘게 앞서면 공방에서 「사림의 공론」 +1">
                  <span>사림의 공론</span>
                  <b>{Math.round((gr[f] ?? 0) * 100)}%</b>
                  <Bar value={(gr[f] ?? 0) * 100} color={m.color} />
                </div>
                <div title="원로 중심의 노장파와 젊은 언관 중심의 소장파. 소장파가 우세하면 당론이 강경해진다">
                  <span>계파</span>
                  <b className="small">
                    {(['elder', 'young'] as const).map((w) => {
                      const h = wingHead(s, f, w);
                      return (
                        <span key={w}>
                          {WING_NAME[w]} {Math.round(wingShare(s, f)[w] * 100)}%{h && <> (<CharLink id={h.id} />)</>}{' '}
                        </span>
                      );
                    })}
                  </b>
                </div>
                {st.contest && (
                  <div>
                    <span>후계 다툼</span>
                    <b className="small">
                      {st.contest.cands.map((id, i) => (
                        <span key={id}>
                          {i > 0 && ' 對 '}
                          <CharLink id={id} /> ({st.contest!.backers[id]?.length ?? 0})
                        </span>
                      ))}{' '}
                      · {st.contest.due - s.t}달 뒤
                    </b>
                  </div>
                )}
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
