import { useState } from 'react';
import { useG } from '../ctx';
import type { Character, FactionId, Status } from '../../engine/types';
import { P, age, officeTitle, statusLabel } from '../../engine/state';
import { opinion } from '../../engine/opinion';
import { FACTION_META, REGION_META } from '../../engine/data/meta';
import { OFFICE_MAP } from '../../engine/data/offices';
import { influence } from '../../engine/factions';
import { yearOf } from '../../engine/calendar';
import { CharLink, FactionBadge, Opinion } from '../common';

type SortKey = 'office' | 'opinion' | 'prestige' | 'influence' | 'age' | 'clan';

const officeWeight = (c: Character) => (c.office ? (OFFICE_MAP[c.office]?.weight ?? 0.5) * 10 + (10 - c.rank) : 10 - c.rank - 5);

export function PeopleTab() {
  const { s, selected } = useG();
  const p = P(s);
  const [fac, setFac] = useState<FactionId | 'all'>('all');
  const [st, setSt] = useState<Status | 'all' | 'dead'>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('office');
  const [historicalOnly, setHistoricalOnly] = useState(false);
  const [n, setN] = useState(60);

  const rows = (() => {
    const list = Object.values(s.chars)
      .filter((c) => (st === 'dead' ? c.status === 'dead' : c.status !== 'dead'))
      .filter((c) => st === 'all' || st === 'dead' || c.status === st)
      .filter((c) => fac === 'all' || c.faction === fac)
      .filter((c) => !historicalOnly || c.historical)
      .filter((c) => !q || c.name.includes(q) || c.clan.includes(q) || officeTitle(c).includes(q) || (c.ho ?? '').includes(q))
      .map((c) => ({ c, op: c.id === p.id ? 0 : opinion(s, c, p), inf: influence(s, c) }));
    const key: Record<SortKey, (r: (typeof list)[number]) => number | string> = {
      office: (r) => -officeWeight(r.c),
      opinion: (r) => -r.op,
      prestige: (r) => -r.c.prestige,
      influence: (r) => -r.inf,
      age: (r) => r.c.born,
      clan: (r) => r.c.clan,
    };
    const k = key[sort];
    return list.sort((a, b) => {
      const x = k(a);
      const y = k(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  })();

  const th = (k: SortKey, label: string) => (
    <th className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
      {label}
    </th>
  );

  return (
    <div className="people">
      <div className="filters">
        <span className="muted small">{rows.length}명</span>
        <input placeholder="이름 · 본관 · 관직 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={fac} onChange={(e) => setFac(e.target.value as FactionId | 'all')}>
          <option value="all">모든 붕당</option>
          {(Object.keys(FACTION_META) as FactionId[])
            .filter((f) => f === 'none' || s.factions[f].active)
            .map((f) => (
              <option key={f} value={f}>
                {FACTION_META[f].name}
              </option>
            ))}
        </select>
        <select value={st} onChange={(e) => setSt(e.target.value as Status | 'all' | 'dead')}>
          <option value="all">살아 있는 모든 이</option>
          <option value="active">재직</option>
          <option value="idle">대기</option>
          <option value="retired">낙향</option>
          <option value="exiled">유배</option>
          <option value="royal">왕실</option>
          <option value="dead">고인</option>
        </select>
        <label className="chk">
          <input type="checkbox" checked={historicalOnly} onChange={(e) => setHistoricalOnly(e.target.checked)} />
          역사 인물만
        </label>
        <span className="muted small">{rows.length}명</span>
      </div>
      <div className="table-wrap">
        <table className="ptable">
          <thead>
            <tr>
              <th />
              <th>이름</th>
              {th('office', '관직')}
              <th>상태</th>
              {th('age', '나이')}
              {th('clan', '가문')}
              <th>학·정</th>
              {th('prestige', '명망')}
              {th('influence', '영향력')}
              {th('opinion', '나에 대한 호감')}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, n).map(({ c, op, inf }) => (
              <tr key={c.id} className={`${selected === c.id ? 'sel' : ''} ${c.id === p.id ? 'me' : ''}`}>
                <td>
                  <FactionBadge f={c.faction} />
                </td>
                <td>
                  <CharLink id={c.id} />
                  {c.historical && <span className="hist-dot" title="역사 인물" />}
                  {c.faction !== 'none' && s.factions[c.faction].leader === c.id && <span className="leader-tag">영수</span>}
                </td>
                <td>{officeTitle(c)}</td>
                <td className="muted">
                  {statusLabel(c)}
                  {c.status !== 'royal' && c.location !== 'hanseong' && c.status !== 'exiled' && c.status !== 'dead' && ` · ${REGION_META[c.location].short}`}
                </td>
                <td>{c.status === 'dead' && c.death ? `졸 ${yearOf(c.death.t)}` : age(s, c)}</td>
                <td className="muted">{c.clan}</td>
                <td>
                  {c.learning}·{c.politics}
                </td>
                <td>{Math.round(c.prestige)}</td>
                <td>{inf}</td>
                <td>{c.id === p.id ? <span className="muted">—</span> : <Opinion v={op} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > n && (
          <button className="mini more" onClick={() => setN(n + 120)}>
            더 보기 ({rows.length - n}명 남음)
          </button>
        )}
      </div>
    </div>
  );
}
