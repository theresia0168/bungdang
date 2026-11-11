import { useState } from 'react';
import { useG } from '../ctx';
import { OFFICES, OFFICE_GROUPS, rankLabel } from '../../engine/data/offices';
import { P, people } from '../../engine/state';
import { appointParts, cooldownLeft, eligible, holderMap, nominate, nominateChance, nominateRight, nomineePool, raceFor } from '../../engine/court';
import { FACTION_META } from '../../engine/data/meta';
import { activeFactions } from '../../engine/factions';
import { CharLink, fcolor, StackBar } from '../common';
import type { FactionId } from '../../engine/types';

function NominateRow({ officeId }: { officeId: string }) {
  const { s, act } = useG();
  const o = OFFICES.find((x) => x.id === officeId)!;
  const pool = nomineePool(s, o).slice(0, 8);
  const [cand, setCand] = useState(pool[0]?.c.id ?? '');
  const c = pool.find((x) => x.c.id === cand)?.c ?? pool[0]?.c;
  if (!c) return null;
  const ch = nominateChance(s, o, c);
  const race = raceFor(s, o.id);
  return (
    <li className="nominate">
      <span>
        {o.name} <em className="muted small">{race ? `${race.due - s.t}달 뒤 빔` : '공석'}</em>
      </span>
      <select value={c.id} onChange={(e) => setCand(e.target.value)}>
        {pool.map((x) => (
          <option key={x.c.id} value={x.c.id}>
            {x.c.name} ({FACTION_META[x.c.faction].short} · 점수 {Math.round(x.score)})
          </option>
        ))}
      </select>
      <button className="mini" title={ch.parts.map((x) => `${x.label} ${x.value >= 0 ? '+' : ''}${x.value}`).join(' · ')} onClick={() => act((g) => nominate(g, o.id, c.id))}>
        의망 ({Math.round(ch.p * 100)}%)
      </button>
    </li>
  );
}

export function CourtTab() {
  const { s } = useG();
  const p = P(s);
  const hm = holderMap(s);
  const nominable = OFFICES.filter((o) => !nominateRight(s, o));
  const canNominate = p.status === 'active' && (p.office === 'ijo' || p.office === 'jeonrang');
  const mine = OFFICES.filter((o) => eligible(s, p, o)).map((o) => {
    const parts = appointParts(s, p, o, hm);
    return { o, parts, total: parts.reduce((a, x) => a + x.value, 0) };
  });
  mine.sort((a, b) => b.total - a.total);
  const cooling = OFFICES.map((o) => ({ o, n: cooldownLeft(s, p, o) }))
    .filter((x) => x.n > 0 && x.o.rank >= p.rank && x.o.id !== p.office)
    .filter((x, i, xs) => xs.findIndex((y) => y.o.name === x.o.name) === i);

  const pool = people(s);
  const count = (pred: (f: FactionId) => boolean, filter: (c: (typeof pool)[number]) => boolean) =>
    ([...activeFactions(s), 'none'] as FactionId[]).filter(pred).map((f) => ({
      key: f,
      value: pool.filter((c) => c.faction === f && filter(c)).length,
      color: FACTION_META[f].color,
      label: FACTION_META[f].name,
    }));
  const nang = count(() => true, (c) => c.status === 'active' && c.office === 'nanggwan');
  const sury = count(() => true, (c) => c.status === 'active' && c.office === 'suryeong');
  const idle = pool.filter((c) => c.status === 'idle').length;

  return (
    <div className="court">
      <div className="court-groups">
        {OFFICE_GROUPS.map((g) => (
          <section key={g.id} className="ogroup">
            <h3>{g.name}</h3>
            <ul>
              {OFFICES.filter((o) => o.group === g.id).map((o) => {
                const h = hm[o.id];
                return (
                  <li key={o.id} style={{ ['--fc' as string]: h ? fcolor(h.faction) : 'transparent' }} title={o.desc}>
                    <span className="o-name">{o.name}</span>
                    <span className="o-rank">{rankLabel(o.rank)}</span>
                    <span className="o-holder">{h ? <CharLink id={h.id} /> : <span className="muted">공석</span>}</span>
                    <span className="o-tenure muted">{h ? `${h.tenure}개월` : ''}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="court-side">
        <section className="ogroup">
          <h3>하위 관원</h3>
          <div className="sub-row">
            <span>낭관 {nang.reduce((a, x) => a + x.value, 0)}명</span>
            <StackBar parts={nang} />
          </div>
          <div className="sub-row">
            <span>지방 수령 {sury.reduce((a, x) => a + x.value, 0)}명</span>
            <StackBar parts={sury} />
          </div>
          <div className="sub-row muted">한성에서 보직을 기다리는 이 {idle}명</div>
        </section>

        {canNominate && (
          <section className="ogroup">
            <h3>{p.office === 'ijo' ? '이조의 의망(擬望)' : '전랑의 통청(通淸)'}</h3>
            {s.player.authorityUsed ? (
              <p className="muted small">이번 달 직권을 이미 썼다.</p>
            ) : nominable.length ? (
              <ul className="prospects">
                {nominable.map((o) => (
                  <NominateRow key={o.id} officeId={o.id} />
                ))}
              </ul>
            ) : (
              <p className="muted small">지금 의망할 빈자리나 곧 빌 자리가 없다.</p>
            )}
            <p className="muted small">
              빈자리나 곧 빌 자리에 사람을 골라 왕에게 올린다 (직권). 왕은 그 사람의 됨됨이, 당신에 대한 성심, 용안, 조정의 균형을 따져 낙점한다. 터무니없는 사람을 올리면 문책을 받아 자리에서 밀려날 수 있다.
            </p>
          </section>
        )}

        <section className="ogroup">
          <h3>당신이 거론될 만한 자리</h3>
          {mine.length ? (
            <ul className="prospects">
              {mine.slice(0, 8).map(({ o, parts, total }) => (
                <li key={o.id} title={parts.map((x) => `${x.label} ${x.value >= 0 ? '+' : ''}${Math.round(x.value * 10) / 10}`).join('\n')}>
                  <span>{o.name}</span>
                  <span className="muted">{hm[o.id] ? '자리 있음' : '공석'}</span>
                  <b>{Math.round(total)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              {p.status === 'retired'
                ? '낙향 중이라 임용 대상이 아니다. 상경하면 거론될 수 있다.'
                : p.status === 'exiled'
                  ? '유배 중이다.'
                  : p.rank === 1 && !p.office
                    ? '원임대신(原任大臣)이다. 정승을 지낸 이는 아래 자리로 내려가지 않으니, 정승 자리가 비기를 기다린다.'
                    : '지금 품계와 경력, 나이로 오를 만한 자리가 없다. 품계가 오른 지 36개월이 지나야 다음 승진을 바랄 수 있고, 당상관부터는 한 계단씩 오른다. 판서는 대개 마흔 가까이 되어야 오른다.'}
            </p>
          )}
          {cooling.length > 0 && (
            <p className="muted small">
              최근에 지낸 자리라 당분간 다시 맡을 수 없다: {cooling.map(({ o, n }) => `${o.name} (${n}달)`).join(', ')}
            </p>
          )}
          <p className="muted small">
            자리가 비면 후보 중 점수가 가장 높은 사람이 제수된다. 이조판서와 이조전랑의 호감, 왕의 성심, 정치력이 크게 작용한다. 점수에 마우스를 올리면 내역이 보인다.
          </p>
        </section>
      </div>
    </div>
  );
}
