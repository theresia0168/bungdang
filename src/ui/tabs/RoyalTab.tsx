import { useG } from '../ctx';
import type { FactionId } from '../../engine/types';
import { FACTION_META } from '../../engine/data/meta';
import { age, P } from '../../engine/state';
import { activeFactions } from '../../engine/factions';
import { moodLabel } from '../../engine/king';
import { backError, backPrince, candidates, dropBacking, favorite, heirOdds, heirSit, loveOf, motherOf, princes } from '../../engine/royal';
import { Bar, CharLink, FactionBadge } from '../common';
import { kingId } from '../../engine/later';
import { gukbonError, gukbonOdds, gukbonSit, joinGukbon, TOPICS } from '../../engine/gukbon';
import { KINGS, kingOfYear, tOf, yearOf } from '../../engine/calendar';

const STYLE_TEXT: Record<string, string> = {
  plain: '',
  neutral: '여러 당 사이에서 저울질하는 임금이다.',
  volatile: '판을 자주 뒤집는 임금이다. 한 당이 조정을 오래 쥐면 환국이 잦다.',
  tangpyeong: '탕평을 내세우는 임금이다. 한 당의 독주를 더 세게 누르고 붕당 간 긴장이 빨리 가라앉는다.',
  sedo: '어린 임금 뒤로 외척이 권세를 잡았다. 왕의 마음이 외척의 당으로 기운다.',
};

export function RoyalTab() {
  const { s, act } = useG();
  const p = P(s);
  const king = s.chars[kingId(s)];
  const sit = heirSit(s);
  const odds = sit ? heirOdds(s) : {};
  const total = Object.values(odds).reduce((a, b) => a + b, 0) || 1;
  const cands = new Set(candidates(s).map((c) => c.id));
  const fav = favorite(s);
  const pickers = (id: string) => activeFactions(s).filter((f) => s.royal.picks[f] === id) as FactionId[];

  // 선조 대의 국본 다툼이 끝난 뒤에는 왕대의 흐름만 보인다
  if (s.t >= tOf(1608, 2)) {
    const y = yearOf(s.t);
    return (
      <div className="royal">
        <section className="royal-king">
          <h3>
            {king ? <CharLink id={king.id} /> : kingOfYear(y).name} <span className="muted small">{king ? `${age(s, king)}세` : ''} · 용안 「{moodLabel(s.king.mood)}」</span>
          </h3>
          <p className="muted small">{STYLE_TEXT[String(s.flags.kingStyle ?? 'plain')] ?? ''}</p>
        </section>
        <GukbonPanel />
        <section>
          <h4>역대 임금</h4>
          <ul className="royal-list">
            {KINGS.filter((k) => k.from < y).map((k) => (
              <li key={k.name} className={k.to <= y ? 'gone' : ''}>
                <b>{k.name}</b>
                <span className="muted small">
                  {k.from + 1}~{Math.min(k.to, 1821)}
                  {k.to > y ? ' · 재위 중' : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>왕의 마음</h4>
          <ul className="royal-list">
            {activeFactions(s).map((f) => (
              <li key={f}>
                <FactionBadge f={f} full /> <span className="small">{Math.round(s.king.lean[f] ?? 0)}</span>
                <span className="muted small"> (바탕 {Math.round(s.king.base?.[f] ?? 0)})</span>
              </li>
            ))}
          </ul>
          <p className="muted small">왕의 마음은 왕대마다 정해진 바탕으로 천천히 돌아온다. 한 당이 조정을 오래 쥐면 식는다.</p>
        </section>
      </div>
    );
  }

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

/** 선조 이후의 국본 논의 */
function GukbonPanel() {
  const { s, act } = useG();
  const p = P(s);
  const sit = gukbonSit(s);
  if (!sit) return null;
  const t = TOPICS[sit.data.topic];
  const odds = gukbonOdds(s, sit);
  const side = (k: 'a' | 'b') => activeFactions(s).filter((f) => sit.data.picks[f] === k) as FactionId[];
  const row = (k: 'a' | 'b') => {
    const label = k === 'a' ? t.a : t.b;
    const errPub = gukbonError(s, k, true);
    const errSec = gukbonError(s, k, false);
    const mine = sit.data.side === k;
    return (
      <li key={k} className={mine ? 'mine' : ''}>
        <div className="prince-head">
          <b>{label}</b>
        </div>
        <div className="prince-row">
          {side(k).map((f) => (
            <FactionBadge key={f} f={f} />
          ))}
          {!t.fixed && <span className="muted small">대세 {Math.round((k === 'a' ? odds : 1 - odds) * 100)}%</span>}
          {mine && <span className="case-me">{sit.data.pub ? '드러내 놓고 섬' : '뒤에서 거듦'}</span>}
        </div>
        <div className="prince-act">
          <button className="mini" disabled={!!errPub} title={errPub ?? '조정에서 이쪽이 옳다고 아뢴다 (행동력 1). 지고 왕의 뜻까지 거스른 것이면 화를 입을 수 있다.'} onClick={() => act((g) => joinGukbon(g, k, true))}>
            드러내 놓고 선다 ●
          </button>
          <button className="mini" disabled={!!errSec} title={errSec ?? '뒤에서 재물을 써 거든다 (행동력 1, 재산 15). 화는 피한다.'} onClick={() => act((g) => joinGukbon(g, k, false))}>
            뒤에서 거든다 ● 15
          </button>
        </div>
      </li>
    );
  };
  return (
    <section>
      <h4>국본 논의 — {t.title}</h4>
      <p className="small">{t.text}</p>
      <ul className="royal-list">{(['a', 'b'] as const).map(row)}</ul>
      <p className="muted small">
        약 {Math.max(1, sit.until - s.t)}달 뒤에 끝난다. 왕은 속으로 한쪽을 바란다. 용안이 밝으면 왕의 뜻대로, 어두우면 당들의 세력대로 끝나기 쉽고, 신하들이 왕의 뜻을 꺾으면 왕권이 더 흔들린다.
        {p.faction !== 'none' && sit.data.picks[p.faction] ? ` ${FACTION_META[p.faction].name}과 다른 쪽에 서면 당의 호감이 떨어진다.` : ''}
      </p>
    </section>
  );
}
