import { useState } from 'react';
import { useG } from './ctx';
import { P, josa, officeTitle, people } from '../engine/state';
import { opinion } from '../engine/opinion';
import { shortDate } from '../engine/calendar';
import { joinCase, joinError, nextLevelLabel, sideOf } from '../engine/cases';
import { CharLink, Opinion, useStoredOpen } from './common';
import { Briefing } from './Briefing';

const SIDE_LABEL = { attacker: '내가 이끈다', target: '나를 겨눔', pro: '동조함', con: '구원함' } as const;

export function NewsFeed() {
  const { s, since, act } = useG();
  const p = P(s);
  const all = people(s).filter((c) => c.id !== p.id);
  const ops = all.map((c) => ({ c, v: opinion(s, c, p) }));
  const threats = ops
    .filter(({ c, v }) => v <= -25 && (c.status === 'active' || c.status === 'idle') && (p.flaws.some((f) => f.knownBy.includes(c.id)) || v <= -50))
    .sort((a, b) => a.v - b.v)
    .slice(0, 5);
  const friends = ops
    .filter(({ c, v }) => v >= 40 && c.status === 'active')
    .sort((a, b) => b.v - a.v)
    .slice(0, 5);
  const fresh = s.log.filter((e) => e.t >= since).reverse();
  const older = s.log.filter((e) => e.t < since).slice(-15).reverse();

  const cases = [...s.cases].sort((a, b) => (sideOf(b, p.id) ? 1 : 0) - (sideOf(a, p.id) ? 1 : 0) || a.due - b.due).slice(0, 6);

  const [allFresh, setAllFresh] = useState(false);
  const [friendsOpen, toggleFriends] = useStoredOpen('news_friends', false);
  const [oldOpen, toggleOld] = useStoredOpen('news_old', false);
  return (
    <div className="panel news">
      <Briefing />
      {cases.length > 0 && (
        <section className="cp-sec cases">
          <h4>
            조정 공방 <span className="muted small">판정 전에 동조하거나 구원할 수 있다 (행동력 1)</span>
          </h4>
          <ul className="case-list">
            {cases.map((cs) => {
              const side = sideOf(cs, p.id);
              const tgt = s.chars[cs.target];
              const left = cs.due - s.t;
              const proErr = joinError(s, cs, 'pro');
              const conErr = joinError(s, cs, 'con');
              return (
                <li key={cs.id} className={side ? `mine side-${side}` : ''}>
                  <div className="case-head">
                    <span className={`case-kind ${cs.kind}`}>{cs.kind === 'aggravate' ? `가죄 → ${nextLevelLabel(tgt).replace(/\(.*\)/, '')}` : '논핵'}</span>
                    <CharLink id={cs.attacker} />
                    <span className="muted">→</span>
                    <CharLink id={cs.target} />
                    <span className="muted small">{cs.kind === 'aggravate' ? '유배 중' : officeTitle(tgt)}</span>
                  </div>
                  <div className="case-body small">
                    <span>
                      동조 {cs.pros.length} · 구원 {cs.cons.length} · {left <= 1 ? '다음 달 판정' : `${left}달 뒤 판정`}
                    </span>
                    {side ? (
                      <span className="case-me">{SIDE_LABEL[side]}</span>
                    ) : (
                      <span className="case-btns">
                        <button className="mini" disabled={!!proErr} title={proErr ?? `${tgt.name}의 가문이 원한을 품는다.`} onClick={() => act((g) => joinCase(g, cs.id, 'pro'))}>
                          동조 ●
                        </button>
                        <button className="mini" disabled={!!conErr} title={conErr ?? `${josa(tgt.name, '이/가')} 당신에게 신세를 진다. 공격하는 쪽은 언짢아한다.`} onClick={() => act((g) => joinCase(g, cs.id, 'con'))}>
                          구원 ●
                        </button>
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <section className="cp-sec fresh">
        <h4>
          {since < s.t ? `지난 ${s.t - since + 1}개월의 소식` : '이번 달의 소식'} <span className="muted small">{fresh.length}건</span>
        </h4>
        {fresh.length ? (
          <ul className="feed">
            {(allFresh ? fresh : fresh.slice(0, 12)).map((e, i) => (
              <li key={i} className={`k-${e.kind}`}>
                <span className="feed-date">{shortDate(e.t)}</span>
                {e.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">조정은 조용했다.</p>
        )}
        {fresh.length > 12 && (
          <button className="mini more" onClick={() => setAllFresh(!allFresh)}>
            {allFresh ? '줄여 보기' : `나머지 ${fresh.length - 12}건 더 보기`}
          </button>
        )}
      </section>
      {threats.length > 0 && (
        <section className="cp-sec">
          <h4 className="warn-text">당신을 노리는 이들</h4>
          <ul className="mini-list">
            {threats.map(({ c, v }) => {
              const holds = p.flaws.filter((f) => f.knownBy.includes(c.id)).length;
              return (
                <li key={c.id}>
                  <CharLink id={c.id} />
                  <span className="muted small">{officeTitle(c)}</span>
                  {holds > 0 && <span className="flaw known small">약점 {holds}</span>}
                  <Opinion v={v} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {friends.length > 0 && (
        <section className="cp-sec">
          <h4 className="fold-h" onClick={toggleFriends}>
            <span className="fold-mark">{friendsOpen ? '▾' : '▸'}</span> 당신의 우군 <span className="muted small">{friends.length}명</span>
          </h4>
          {friendsOpen && <ul className="mini-list">
            {friends.map(({ c, v }) => (
              <li key={c.id}>
                <CharLink id={c.id} />
                <span className="muted small">{officeTitle(c)}</span>
                <Opinion v={v} />
              </li>
            ))}
          </ul>}
        </section>
      )}
      <section className="cp-sec">
        <h4 className="fold-h" onClick={toggleOld}>
          <span className="fold-mark">{oldOpen ? '▾' : '▸'}</span> 지난 조보(朝報)
        </h4>
        {oldOpen && <ul className="feed old">
          {older.map((e, i) => (
            <li key={i} className={`k-${e.kind}`}>
              <span className="feed-date">{shortDate(e.t)}</span>
              {e.text}
            </li>
          ))}
        </ul>}
      </section>
    </div>
  );
}
