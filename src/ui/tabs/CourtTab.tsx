import { useState } from 'react';
import { useG } from '../ctx';
import { BRANCHES, DEPTS, OFFICES, OFFICE_MAP, rankLabel, type OfficeDef } from '../../engine/data/offices';
import { authorityBase, bibyeonPower, bibyeonStage, kyeomHolder, kyeomsOf, officeOpen, openOffices } from '../../engine/kwanje';
import { yearOf } from '../../engine/calendar';
import { P, people } from '../../engine/state';
import { appointParts, cooldownLeft, eligible, holderMap, nominate, nominateChance, nominateRight, nomineePool, raceFor } from '../../engine/court';
import { FACTION_META } from '../../engine/data/meta';
import { activeFactions } from '../../engine/factions';
import { CharLink, fcolor, StackBar, useStoredOpen } from '../common';
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
  const live = openOffices(s);
  const nominable = live.filter((o) => !nominateRight(s, o));
  const canNominate = p.status === 'active' && (p.office === 'ijo' || p.office === 'jeonrang');
  const mine = live.filter((o) => eligible(s, p, o)).map((o) => {
    const parts = appointParts(s, p, o, hm);
    return { o, parts, total: parts.reduce((a, x) => a + x.value, 0) };
  });
  mine.sort((a, b) => b.total - a.total);
  const cooling = live.map((o) => ({ o, n: cooldownLeft(s, p, o) }))
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
  // 내가 맡은 자리(겸직 포함)가 있는 관서는 처음부터 펼쳐 둔다
  const myDepts = new Set<string>([p.office ? OFFICE_MAP[p.office]?.dept : undefined, ...kyeomsOf(s, p).map((o) => o.dept)].filter((x) => !!x) as string[]);
  const [ver, setVer] = useState(0);
  const foldAll = (open: boolean) => {
    try {
      for (const d of DEPTS) localStorage.setItem(`bungdang/fold/dept_${d.id}`, open ? '1' : '0');
    } catch {
      /* 저장할 수 없으면 무시 */
    }
    setVer((v) => v + 1);
  };

  return (
    <div className="court">
      <div className="court-chart">
        <div className="chart-tools">
          <div className="chart-king">국왕</div>
          <span className="muted small">관서 이름을 누르면 펼치고 접는다.</span>
          <button className="mini" onClick={() => foldAll(true)}>모두 펼치기</button>
          <button className="mini" onClick={() => foldAll(false)}>모두 접기</button>
        </div>
        <CenterBar />
        {BRANCHES.map((b) => {
          const depts = DEPTS.filter((d) => d.branch === b.id && OFFICES.some((o) => o.dept === d.id && officeOpen(s, o)));
          if (!depts.length) return null;
          return (
            <section key={b.id} className={`chart-branch br-${b.id}`}>
              <h3>{b.name}</h3>
              <div className="chart-depts">
                {depts.map((d) => (
                  <DeptCard key={`${d.id}-${ver}`} id={d.id} name={d.name} desc={d.desc} mine={myDepts.has(d.id)} />
                ))}
              </div>
            </section>
          );
        })}
        <KwanjeHistory />
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

/** 관서 하나: 접혀 있으면 이름과 당색 점만, 펼치면 자리마다 */
function DeptCard({ id, name, desc, mine }: { id: string; name: string; desc?: string; mine: boolean }) {
  const { s } = useG();
  const hm = holderMap(s);
  const [open, toggle] = useStoredOpen(`dept_${id}`, mine || id === 'uijeongbu');
  const offices = OFFICES.filter((o) => o.dept === id && officeOpen(s, o));
  const holders = offices.map((o) => (o.concurrent ? kyeomHolder(s, o.id) : hm[o.id]));
  const filled = holders.filter(Boolean).length;
  return (
    <div className={`chart-dept ${open ? 'open' : 'closed'} ${mine ? 'mine' : ''}`} title={desc}>
      <h4 className="fold-h" onClick={toggle}>
        <span className="fold-mark">{open ? '▾' : '▸'}</span> {name}
        {mine ? <em className="o-tag">내 관서</em> : null}
        <span className="dept-sum">
          {holders.map((h, i) => (
            <i key={i} className="dot" style={{ background: h ? fcolor(h.faction) : 'transparent' }} />
          ))}
          <span className="muted small">
            {filled}/{offices.length}
          </span>
        </span>
      </h4>
      {open && (
        <ul>
          {offices.map((o) => (
            <OfficeRow key={o.id} o={o} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OfficeRow({ o }: { o: OfficeDef }) {
  const { s } = useG();
  const hm = holderMap(s);
  const h = o.concurrent ? kyeomHolder(s, o.id) : hm[o.id];
  const main = o.concurrent && h?.office ? OFFICE_MAP[h.office] : undefined;
  const since = o.concurrent ? s.kyeom?.[o.id]?.since : undefined;
  const other = !o.concurrent && h ? kyeomsOf(s, h) : [];
  return (
    <li style={{ ['--fc' as string]: h ? fcolor(h.faction) : 'transparent' }} title={o.desc} className={o.concurrent ? 'kyeom' : ''}>
      <span className="o-name">
        {o.name}
        {o.concurrent ? <em className="o-tag">겸</em> : null}
      </span>
      <span className="o-rank">{o.concurrent ? '' : rankLabel(o.rank)}</span>
      <span className="o-holder">
        {h ? <CharLink id={h.id} /> : <span className="muted">공석</span>}
        {main ? <span className="muted small"> ({main.name})</span> : null}
        {other.length ? (
          <em className="o-tag" title={`겸직: ${other.map((x) => x.name).join(', ')}`}>
            겸{other.length > 1 ? other.length : ''}
          </em>
        ) : null}
      </span>
      <span className="o-tenure muted">{h ? (since !== undefined ? `${s.t - since}개월` : `${h.tenure}개월`) : ''}</span>
    </li>
  );
}

/** 관서가 생기고 없어진 내력 */
function KwanjeHistory() {
  const { s } = useG();
  const lines = s.log.filter((e) => e.text.startsWith('[관제]')).slice(-8).reverse();
  if (!lines.length) return null;
  return (
    <section className="chart-branch">
      <h3>관제의 변화</h3>
      <ul className="kwanje-log">
        {lines.map((e, i) => (
          <li key={i}>
            <span className="muted small">{yearOf(e.t)}</span> {e.text.replace('[관제] ', '')}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 국정의 중심: 의정부 ↔ 비변사 */
export function CenterBar() {
  const { s } = useG();
  const v = bibyeonPower(s);
  const st = bibyeonStage(v);
  const base = authorityBase(s);
  return (
    <section className="chart-center" title="비변사는 왜변에 대비한 임시 기구로 출발해 임진왜란 뒤 국정 최고 기관이 되었다. 의정부와 육조는 형식만 남고, 세도기에는 척신이 비변사를 쥐어 왕권이 제약되었다 (이재호 1971, 반윤홍 2003, 『신편 한국사』 30).">
      <div className="center-head">
        <span>국정의 중심</span>
        <b>{st.name}</b>
        <span className="muted small">비변사 위상 {Math.round(v)} · 왕권의 바탕 {base > 0 ? '+' : ''}{base}</span>
      </div>
      <div className="center-bar">
        <span className="cb-left">의정부</span>
        <div className="cb-track">
          <div className="cb-fill" style={{ width: `${v}%` }} />
        </div>
        <span className="cb-right">비변사</span>
      </div>
      <details className="center-more">
        <summary className="muted small">{st.text}</summary>
        <p className="muted small">비변사의 위상이 높을수록 정승 자리의 힘이 줄고 비변사 당상의 힘이 커지며, 용안이 돌아가는 바탕(왕권)이 낮아진다. 위상 45부터는 비변사 도제조의 호감이 임용에 끼어든다. 전란 중에 크게 오르고, 탕평하는 임금 때 조금씩 내려가며, 세도 아래서 빠르게 오른다. 「의정부 서사제 복구」 법으로 되돌릴 수 있다.</p>
      </details>
    </section>
  );
}
