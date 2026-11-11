import { useState } from 'react';
import { useG } from '../ctx';
import type { RealmProjectKind, RegionId } from '../../engine/types';
import { REGIONS, REGION_META } from '../../engine/data/meta';
import { holderOf } from '../../engine/court';
import { P } from '../../engine/state';
import { tOf } from '../../engine/calendar';
import {
  COASTAL,
  POWERS,
  PROJECT_DEFS,
  TAX_REGIONS,
  WAR_HELD,
  WAR_ROUT,
  approvalChance,
  defenseScore,
  militaryUpkeep,
  monthlyBudget,
  powerError,
  projectError,
  proposeProject,
  regionTax,
  suryeongSkimRate,
  usePower,
  warForecast,
  warReadiness,
} from '../../engine/realm';
import { LAWS, lawOpen } from '../../engine/laws';
import { traitForbids } from '../../engine/actions';
import { CharLink } from '../common';

const KINDS = Object.keys(PROJECT_DEFS) as RealmProjectKind[];

export function RealmTab() {
  const { s, act } = useG();
  const p = P(s);
  const realm = s.realm;
  const [kind, setKind] = useState<RealmProjectKind>('fort');
  const [region, setRegion] = useState<RegionId>(p.office?.startsWith('gamsa_') ? (p.location as RegionId) : 'gyeongsang');
  const budget = monthlyBudget(s);
  const spend = budget.reduce((a, x) => a + x.value, 0);
  const ready = warReadiness(s);
  const def = PROJECT_DEFS[kind];
  const r = def.regional ? region : undefined;
  const perr = projectError(s, kind, r);
  const greed = traitForbids(p, 'greed');
  const powers = POWERS.filter((w) => p.status === 'active' && p.office && w.office(p.office));
  const preWar = s.t < tOf(1592, 4);
  const est = TAX_REGIONS.reduce((a, x) => a + regionTax(s, x), 0);

  return (
    <div className="realm">
      <section className="ogroup">
        <h3>국고(國庫)</h3>
        <div className="realm-head">
          <div className={`realm-big ${realm.treasury < 0 ? 'bad-text' : ''}`}>
            {Math.round(realm.treasury)}
            <small>국고</small>
          </div>
          <div className="realm-big">
            -{Math.round(spend)}
            <small>다달이 나가는 돈</small>
          </div>
          <div className="realm-big">
            {realm.ledger ? realm.ledger.revenue : '—'}
            <small>지난 가을의 세입</small>
          </div>
          <div className="realm-big">
            {est}
            <small>올해 장부상 거둘 세</small>
          </div>
        </div>
        <p className="small muted">
          해마다 10월에 팔도의 세가 국고에 든다. 그 사이 관찰사와 수령의 손을 타고, 장부에서 빠진 은결만큼 줄어든다. 국고가 바닥나면 녹봉이 반으로 깎이고 나라 사업이 멈추며, 용안이 어두워지고 조련이 풀린다.
        </p>
        <ul className="ledger">
          {budget.map((x) => (
            <li key={x.label}>
              <span>{x.label}</span>
              <b>{Math.round(x.value * 10) / 10}</b>
            </li>
          ))}
          <li className="muted small">
            <span>왕실 경비 수준</span>
            <b>{Math.round(realm.royal * 100)}%</b>
          </li>
        </ul>
        {realm.ledger && (
          <table className="realm-table">
            <thead>
              <tr>
                <th>도</th>
                <th>장부상 세</th>
                <th>관찰사 착복</th>
                <th>수령 착복</th>
                <th>국고에 든 것</th>
                <th>은결</th>
              </tr>
            </thead>
            <tbody>
              {TAX_REGIONS.map((id) => {
                const x = realm.ledger!.byRegion[id];
                if (!x) return null;
                return (
                  <tr key={id}>
                    <td>{REGION_META[id].short}</td>
                    <td>{x.due}</td>
                    <td className={x.gamsa ? 'bad-text' : ''}>{x.gamsa}</td>
                    <td className="bad-text">{x.suryeong}</td>
                    <td>
                      <b>{x.got}</b>
                    </td>
                    <td>{Math.round(s.regions[id].hidden * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="ogroup">
        <h3>나라 사업</h3>
        {realm.projects.length ? (
          <ul className="mini-list">
            {realm.projects.map((x) => (
              <li key={x.id}>
                <b>
                  {x.region ? `${REGION_META[x.region].short} ` : ''}
                  {PROJECT_DEFS[x.kind].name}
                </b>
                <span className="muted small">
                  {x.left}개월 남음 · 다달이 {x.cost} · 맡은 이 <CharLink id={x.by} />
                  {x.skim && x.by === p.id ? ' · 착복 중' : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">벌여 놓은 사업이 없다.</p>
        )}
        <div className="propose">
          <select value={kind} onChange={(e) => setKind(e.target.value as RealmProjectKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {PROJECT_DEFS[k].name} ({PROJECT_DEFS[k].cost}×{PROJECT_DEFS[k].months}개월)
              </option>
            ))}
          </select>
          {def.regional && (
            <select value={region} onChange={(e) => setRegion(e.target.value as RegionId)}>
              {REGIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.short}
                </option>
              ))}
            </select>
          )}
          <button className="fbtn" disabled={!!perr} title={perr ?? `${def.desc}\n왕이 재가할 확률 ${Math.round(approvalChance(s, kind) * 100)}%`} onClick={() => act((g) => proposeProject(g, kind, r))}>
            건의 (직권)
          </button>
          <button
            className="fbtn"
            disabled={!!perr || !!greed}
            title={perr ?? greed ?? '공사비의 3할을 빼돌린다. 다달이 재산이 들어오지만 흠결이 생길 수 있고, 부실 공사가 될 수 있다.'}
            onClick={() => act((g) => proposeProject(g, kind, r, true))}
          >
            착복하며 건의
          </button>
        </div>
        <p className="small muted">{def.desc} 판서·정승·관찰사가 직권으로 건의한다 (자리마다 다룰 수 있는 일이 다르다).</p>
        {powers.length > 0 && (
          <>
            <h4>직무의 권한</h4>
            <div className="focus-grid">
              {powers.map((w) => {
                const err = powerError(s, w);
                return (
                  <button key={w.id} className="fbtn" disabled={!!err} title={err ? `${err}\n\n${w.desc}` : w.desc} onClick={() => act((g) => usePower(g, w.id))}>
                    {w.name} <span className="cost auth">직권</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="ogroup">
        <h3>국방</h3>
        <div className="realm-head">
          <div className={`realm-big ${ready.score >= WAR_HELD ? 'good-text' : ready.score < WAR_ROUT ? 'bad-text' : ''}`}>
            {ready.score}
            <small>전쟁 대비</small>
          </div>
          <div className="realm-big">
            {Math.round(s.war.preparedness)}
            <small>비변사의 대비</small>
          </div>
          <div className="realm-big">
            {militaryUpkeep(s)}
            <small>다달이 군비</small>
          </div>
        </div>
        <p className="small">
          {preWar || s.war.active ? `${warForecast(ready.score)}.` : ''} <span className="muted">{ready.parts.map((x) => `${x.label} ${x.value >= 0 ? '+' : ''}${x.value}`).join(' · ')}</span>
        </p>
        <p className="small muted">
          왜군이 쳐들어오면 대비 점수 {WAR_HELD} 이상이면 남쪽에서 막아 내고, {WAR_ROUT} 아래면 어가마저 위태롭다. 조련은 내버려 두면 다달이 풀린다.
        </p>
        <table className="realm-table">
          <thead>
            <tr>
              <th>도</th>
              <th>성곽</th>
              <th>진보</th>
              <th>조련</th>
              <th>수군</th>
              <th>방비</th>
              <th>수령 착복</th>
              <th>관찰사</th>
            </tr>
          </thead>
          <tbody>
            {REGIONS.map((m) => {
              const d = s.regions[m.id].defense;
              const g = holderOf(s, `gamsa_${m.id}`);
              return (
                <tr key={m.id} className={s.war.zones.includes(m.id) ? 'war-row' : ''}>
                  <td>{m.short}</td>
                  <td>{'■'.repeat(d.fort)}{'□'.repeat(5 - d.fort)}</td>
                  <td>{d.jin}</td>
                  <td>{Math.round(d.drill)}</td>
                  <td>{COASTAL.includes(m.id) ? d.navy : '—'}</td>
                  <td>
                    <b>{defenseScore(s, m.id)}</b>
                  </td>
                  <td>{TAX_REGIONS.includes(m.id) ? `${Math.round(suryeongSkimRate(s, m.id) * 100)}%` : '—'}</td>
                  <td>{g ? <CharLink id={g.id} /> : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="ogroup">
        <h3>국법(國法)</h3>
        <p className="small muted">왼쪽 「상소」에서 법을 고르고 변법 상소를 올려 세우거나 없앨 수 있다.</p>
        <ul className="laws">
          {LAWS.map((l) => {
            const st = s.laws[l.id];
            const open = lawOpen(s, l);
            return (
              <li key={l.id} className={st?.on ? 'on' : ''}>
                <span className={`law-state ${st?.on ? 'on' : ''}`}>{st?.on ? '시행 중' : open ? '미시행' : '논의 전'}</span>
                <b>{l.name}</b>
                <span className="small">{l.desc}</span>
                <span className="small muted">
                  효과: {l.effect}
                  {' · '}왕 {l.king > 0.2 ? '찬성' : l.king < -0.2 ? '반대' : '관망'} · 동인 계열 {l.stance.dong > 0.2 ? '찬성' : l.stance.dong < -0.2 ? '반대' : '관망'} · 서인 {l.stance.seo > 0.2 ? '찬성' : l.stance.seo < -0.2 ? '반대' : '관망'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
