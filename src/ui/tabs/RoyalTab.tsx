import { useG } from '../ctx';
import type { FactionId } from '../../engine/types';
import { FACTION_META } from '../../engine/data/meta';
import { age, P } from '../../engine/state';
import { activeFactions } from '../../engine/factions';
import { moodLabel } from '../../engine/king';
import { backError, backPrince, candidates, dropBacking, favorite, heirOdds, heirSit, loveOf, motherOf, princes } from '../../engine/royal';
import { Bar, CharLink, FactionBadge } from '../common';

export function RoyalTab() {
  const { s, act } = useG();
  const p = P(s);
  const king = s.chars.seonjo;
  const sit = heirSit(s);
  const odds = sit ? heirOdds(s) : {};
  const total = Object.values(odds).reduce((a, b) => a + b, 0) || 1;
  const cands = new Set(candidates(s).map((c) => c.id));
  const fav = favorite(s);
  const pickers = (id: string) => activeFactions(s).filter((f) => s.royal.picks[f] === id) as FactionId[];

  return (
    <div className="royal">
      <section className="royal-king">
        <h3>
          {king ? <CharLink id={king.id} /> : '선조'} <span className="muted small">{king ? `${age(s, king)}세` : ''} · 용안 「{moodLabel(s.king.mood)}」</span>
        </h3>
        <p className="muted small">
          {s.heir ? (
            <>
              세자: <CharLink id={s.heir} />
              {s.royal.backing === s.heir && <span className="case-me">세자의 사람 (임용 +2)</span>}
            </>
          ) : sit ? (
            <b className="warn-text">국본 논의가 한창이다 · 약 {Math.max(1, sit.until - s.t)}달 뒤 왕이 결단한다</b>
          ) : (
            '아직 세자가 없다. 왕자들이 장성하면 국본 논의가 일어난다.'
          )}
        </p>
      </section>

      <section>
        <h4>왕비와 후궁</h4>
        <ul className="royal-list">
          {s.royal.consorts.map((c) => (
            <li key={c.id} className={c.alive ? '' : 'gone'}>
              <b>{c.name}</b>
              <span className="muted small">
                {c.title}
                {c.kin ? ` · 친정 ${c.kin}` : ''}
                {c.alive ? '' : ' · 졸'}
              </span>
              {c.alive && (
                <span className="royal-love" title="왕의 총애">
                  총애 <Bar value={c.love} color="#b0476b" />
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>
          왕자 <span className="muted small">왕에게는 적자(嫡子)가 없다. 열 살이 넘으면 세자 후보가 된다.</span>
        </h4>
        <ul className="royal-list princes">
          {princes(s).map((c) => {
            const mom = motherOf(s, c.id);
            const isCand = cands.has(c.id);
            const mine = s.royal.backing === c.id;
            const errPub = backError(s, c.id, true);
            const errSec = backError(s, c.id, false);
            return (
              <li key={c.id} className={`${s.heir === c.id ? 'heir' : ''} ${mine ? 'mine' : ''}`}>
                <div className="prince-head">
                  <CharLink id={c.id} />
                  <span className="muted small">
                    {age(s, c)}세 · {mom?.name ?? ''} 소생 · 학식 {c.learning} · 정치 {c.politics}
                  </span>
                  {s.heir === c.id && <span className="tag good">세자</span>}
                  {fav?.id === c.id && !s.heir && <span className="tag">왕의 총애</span>}
                </div>
                <div className="prince-row">
                  <span className="royal-love" title="왕의 사랑">
                    왕의 사랑 {loveOf(s, c.id)} <Bar value={loveOf(s, c.id)} color="#b0476b" />
                  </span>
                  {pickers(c.id).map((f) => (
                    <FactionBadge key={f} f={f} />
                  ))}
                  {sit && isCand && <span className="muted small">대세 {Math.round(((odds[c.id] ?? 0) / total) * 100)}%</span>}
                  {mine && <span className="case-me">{s.royal.backingPublic ? '드러내 놓고 밂' : '은밀히 줄을 댐'}</span>}
                </div>
                {sit && isCand && !s.heir && (
                  <div className="prince-act">
                    <button className="mini" disabled={!!errPub} title={errPub ?? '조정에서 이 왕자를 세자로 세우자고 아뢴다 (행동력 1). 왕의 뜻과 어긋나면 화를 입을 수 있다.'} onClick={() => act((g) => backPrince(g, c.id, true))}>
                      드러내 놓고 민다 ●
                    </button>
                    <button className="mini" disabled={!!errSec} title={errSec ?? '어머니 쪽에 재물을 넣어 은밀히 민다 (행동력 1, 재산 20). 진노의 화는 피하지만 흠결이 생길 수 있다.'} onClick={() => act((g) => backPrince(g, c.id, false))}>
                      은밀히 줄을 댄다 ● 20
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {s.royal.backing && sit && (
          <button className="mini" onClick={() => act((g) => dropBacking(g))}>
            지지를 거둔다
          </button>
        )}
      </section>

      {sit && (
        <section>
          <h4>각 당의 선택</h4>
          <ul className="mini-list">
            {activeFactions(s).map((f) => (
              <li key={f}>
                <FactionBadge f={f} full />
                <span>{s.royal.picks[f] ? <CharLink id={s.royal.picks[f]} /> : '—'}</span>
                {f === p.faction && <span className="muted small">(내 당)</span>}
              </li>
            ))}
          </ul>
          <p className="muted small">
            논의가 끝나면 왕은 세자를 정하거나, 미루거나, 총애하지 않는 왕자를 민 쪽에 진노한다. 왕이 아끼는 왕자와 대세가 어긋날수록, 논의가 시끄러울수록 진노할 가능성이 크다. {p.faction !== 'none' ? `${FACTION_META[p.faction].name}의 선택과 다른 왕자를 밀면 당의 호감이 떨어진다.` : ''}
          </p>
        </section>
      )}
    </div>
  );
}
