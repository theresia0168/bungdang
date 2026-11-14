import { useG } from './ctx';
import { P, josa, officeTitle, people } from '../engine/state';
import { FACTION_META } from '../engine/data/meta';
import { OFFICE_MAP } from '../engine/data/offices';
import { backCandidate, raceBackError } from '../engine/court';
import { kingSummary, WARY_TRIGGER, WARY_WARN } from '../engine/king';
import { lineLabel, lineOf } from '../engine/party';
import { knowsWant, wantName, WANT_META } from '../engine/relations';
import { SIT_META, sitLine } from '../engine/situations';
import { CharLink } from './common';
import { liveOmens, nudgeError, nudgeOmen } from '../engine/later';
import { rivalOf } from '../engine/rival';
import { grandeeRumors } from '../engine/grandees';
import { harmLabel } from '../engine/county';
import { opinion } from '../engine/opinion';

export function Briefing() {
  const { s, act } = useG();
  const p = P(s);
  const plots = s.plots.filter((x) => x.known);
  const races = [...s.races].sort((a, b) => OFFICE_MAP[a.office].rank - OFFICE_MAP[b.office].rank).slice(0, 5);
  const myLean = p.faction !== 'none' ? Math.round(s.king.lean[p.faction] ?? 0) : 0;
  const wants = people(s)
    .filter((c) => c.id !== p.id && knowsWant(s, c) && c.status !== 'exiled')
    .slice(0, 6);
  const susp = Math.round(s.player.suspicion);
  const omens = liveOmens(s);
  const rival = rivalOf(s);
  const moves = grandeeRumors(s);

  return (
    <section className="cp-sec brief">
      <h4>이달의 정국</h4>
      <ul className="brief-list">
        <li>
          <span className="b-k">왕</span>
          <span>{kingSummary(s)}</span>
        </li>
        {p.faction !== 'none' && (
          <li className={myLean <= WARY_WARN ? 'bad' : ''}>
            <span className="b-k">{FACTION_META[p.faction].name}</span>
            <span>
              당론 {lineLabel(lineOf(s, p.faction))}
              {` · 왕의 마음 ${myLean > 0 ? '+' : ''}${myLean}`}
              {myLean <= WARY_WARN && ` — 환국 위험 (${WARY_TRIGGER} 이하면 일어날 수 있다)! 「당론과 거리 두기」로 몸을 사릴 수 있다.`}
            </span>
          </li>
        )}
        {s.situations.map((x) => (
          <li key={x.id} className={x.kind === 'heir' || x.kind === 'scandal' ? 'warn' : ''} title={SIT_META[x.kind].effect}>
            <span className="b-k">{SIT_META[x.kind].name}</span>
            <span>
              {sitLine(s, x)}
              <span className="muted small"> — {SIT_META[x.kind].effect}</span>
            </span>
          </li>
        ))}
        {s.player.county && (
          <li className={s.player.county.harm >= 30 ? 'bad' : s.player.county.harm >= 20 ? 'warn' : ''} title="환곡·군정·전정을 어떻게 다루었는지가 쌓인다. 30을 넘으면 백성이 관아로 몰려올 수 있다.">
            <span className="b-k">고을</span>
            <span>
              원성 {Math.round(s.player.county.harm)} ({harmLabel(s.player.county.harm)})
              {s.player.county.harm >= 30 && <span className="muted small"> — 백성이 관아로 몰려올 수 있다</span>}
            </span>
          </li>
        )}
        {rival && (
          <li className="bad">
            <span className="b-k">숙적</span>
            <span>
              <CharLink id={rival.id} /> ({FACTION_META[rival.faction].name}, {officeTitle(rival)}) · 나를 보는 마음 {Math.round(opinion(s, rival, p))}
              <span className="muted small"> — 뒤를 캐고 비방하고 논핵을 꾸민다. 그가 몰락하거나 죽어야 끝난다.</span>
            </span>
          </li>
        )}
        {moves.length > 0 && (
          <li className={moves.some((m) => m.danger) ? 'warn' : ''} title="당 영수·정승·숙적·당신의 원수 같은 거물들은 제 뜻을 품고 여러 달에 걸쳐 움직인다. 들리는 소문이다.">
            <span className="b-k">거물</span>
            <span>
              {moves.map((m, i) => (
                <span key={m.id} className={m.danger ? 'bad-text' : ''}>
                  {i > 0 && ' · '}
                  <CharLink id={m.id} /> {m.text}
                </span>
              ))}
            </span>
          </li>
        )}
        {omens.map((w) => {
          const err = nudgeError(s, w.id);
          const n = Number(s.flags[`nudge_${w.id}`] ?? 0);
          return (
            <li key={w.id} className="warn" title={w.cancellable ? '거듭 누르면 끝내 일어나지 않을 수도 있다' : '늦출 수는 있어도 막을 수는 없다'}>
              <span className="b-k">조짐</span>
              <span>
                {w.label}의 기운{n ? <span className="muted small"> (지금까지 {n > 0 ? `부추김 ${n}` : `누름 ${-n}`})</span> : null}{' '}
                <button className="mini" disabled={!!err} title={err ?? '앞당긴다. 긴장 +2, 노려지는 당의 원망'} onClick={() => act((g) => nudgeOmen(g, w.id, 1))}>
                  부추긴다 ●
                </button>{' '}
                <button className="mini" disabled={!!err} title={err ?? '늦춘다. 긴장 -1, 명망·성심 +1'} onClick={() => act((g) => nudgeOmen(g, w.id, -1))}>
                  누른다 ●
                </button>
              </span>
            </li>
          );
        })}
        {susp > 0 && (
          <li className={susp >= 45 ? 'bad' : susp >= 25 ? 'warn' : ''}>
            <span className="b-k">내통 의심</span>
            <span>
              {susp}
              {susp >= 45 ? ' — 당이 해명을 요구할 수 있다' : ''} · 다른 당 사람과 교유할수록 쌓인다
            </span>
          </li>
        )}
        {plots.map((x) => (
          <li key={x.id} className="bad">
            <span className="b-k">음모</span>
            <span>
              <CharLink id={x.by} />
              {josa(s.chars[x.by].name, '이/가').slice(s.chars[x.by].name.length)} 당신을 노린다 · 약 {Math.max(1, x.due - s.t)}달 뒤{x.softened ? ' (근신으로 기세가 꺾임)' : ''}
              <span className="muted small"> — 선제 논핵, 화해 청함, 흠결 무마, 근신</span>
            </span>
          </li>
        ))}
      </ul>

      {races.length > 0 && (
        <>
          <div className="brief-sub">
            자리 경쟁 <span className="muted small">한 사람을 밀 수 있다 (행동력 1). 오르면 신세를 진다.</span>
          </div>
          <ul className="race-list">
            {races.map((r) => {
              const o = OFFICE_MAP[r.office];
              const left = r.due - s.t;
              return (
                <li key={r.office}>
                  <div className="race-head">
                    <b>{o.name}</b>
                    <span className="muted small">{left > 0 ? `${left}달 뒤 결정` : '곧 결정'}</span>
                  </div>
                  <div className="race-cands">
                    {r.candidates.map((id) => {
                      const c = s.chars[id];
                      if (!c) return null;
                      const backers = r.backers[id] ?? [];
                      const mine = backers.includes(p.id);
                      const err = raceBackError(s, r.office, id);
                      return (
                        <span key={id} className={`race-cand ${mine ? 'on' : ''}`}>
                          <CharLink id={id} />
                          <span className="muted small">
                            {FACTION_META[c.faction].name.slice(0, 2)}
                            {backers.length > 0 && ` · 지지 ${backers.length}`}
                          </span>
                          {id !== p.id && !mine && (
                            <button className="mini" disabled={!!err} title={err ?? `${c.name}을(를) 민다. 다른 후보들은 언짢아한다.`} onClick={() => act((g) => backCandidate(g, r.office, id))}>
                              밀기 ●
                            </button>
                          )}
                          {mine && <span className="case-me">밀고 있음</span>}
                        </span>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {wants.length > 0 && (
        <>
          <div className="brief-sub">
            알아낸 바람 <span className="muted small">이루어 주면 호감 +25, 신세 둘</span>
          </div>
          <ul className="mini-list">
            {wants.map((c) => (
              <li key={c.id} title={WANT_META[c.want!.kind].how}>
                <CharLink id={c.id} />
                <span className="muted small">{officeTitle(c)}</span>
                <span className="want-tag">{wantName(s, c)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
