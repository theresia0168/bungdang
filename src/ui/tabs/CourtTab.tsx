import { useG } from '../ctx';
import { OFFICES, OFFICE_GROUPS, rankLabel } from '../../engine/data/offices';
import { P, people } from '../../engine/state';
import { appointParts, cooldownLeft, eligible, holderMap } from '../../engine/court';
import { FACTION_META } from '../../engine/data/meta';
import { activeFactions } from '../../engine/factions';
import { CharLink, fcolor, StackBar } from '../common';
import type { FactionId } from '../../engine/types';

export function CourtTab() {
  const { s } = useG();
  const p = P(s);
  const hm = holderMap(s);
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
                    : '지금 품계와 경력으로 오를 만한 자리가 없다. 품계가 오른 지 30개월이 지나야 다음 승진을 바랄 수 있다.'}
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
