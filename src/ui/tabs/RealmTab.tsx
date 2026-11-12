import { useState } from 'react';
import { useG } from '../ctx';
import type { RealmProjectKind, RegionId } from '../../engine/types';
import { REGIONS, REGION_META } from '../../engine/data/meta';
import { holderOf } from '../../engine/court';
import { P } from '../../engine/state';
import { tOf } from '../../engine/calendar';
import {
  ARMY_NAME,
  BUDGET_DESC,
  COASTAL,
  POWERS,
  ROYAL_NAME,
  TAX_NAME,
  armyFunding,
  militaryNeed,
  setBudget,
  PROJECT_DEFS,
  TAX_REGIONS,
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
  warOdds,
  warReadiness,
} from '../../engine/realm';
import { LAWS, lawOpen } from '../../engine/laws';
import { traitForbids } from '../../engine/actions';
import { CharLink } from '../common';
import { COUP_LINE, coupRisk } from '../../engine/coup';

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
  const hojo = p.status === 'active' && p.office === 'hojo';
  const fund = armyFunding(s);
  const b = realm.budget;
  const levers: { key: 'tax' | 'army' | 'royal'; name: string; opts: Record<string, string> }[] = [
    { key: 'tax', name: '전세', opts: TAX_NAME },
    { key: 'army', name: '군비', opts: ARMY_NAME },
    { key: 'royal', name: '왕실 경비', opts: ROYAL_NAME },
  ];

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
        </ul>
        <h4>
          올해 예산 <span className="muted small">{hojo ? '호조판서로서 한 달에 한 항목씩 고친다 (직권)' : '호조판서가 해마다 10월에 짠다'}</span>
        </h4>
        <div className="budget">
          {levers.map((l) => (
            <div key={l.key} className="budget-row" title={BUDGET_DESC[l.key]}>
              <span>{l.name}</span>
              <div className="seg">
                {Object.entries(l.opts).map(([k, name]) => (
                  <button
                    key={k}
                    className={b[l.key] === k ? 'on' : ''}
                    disabled={!hojo || b[l.key] === k || s.player.authorityUsed}
                    onClick={() => act((g) => setBudget(g, l.key, k))}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="realm-head">
          <div className={`realm-big ${realm.authority < COUP_LINE ? 'bad-text' : ''}`}>
            {Math.round(realm.authority)}
            <small>왕실 권위</small>
          </div>
          {coupRisk(s) > 0 && (
            <div className="realm-big bad-text">
              {(coupRisk(s) * 100).toFixed(1)}%
              <small>달마다 반정이 꾸며질 확률</small>
            </div>
          )}
        </div>
        <p className="small muted">
          국고가 바닥나고 공명첩을 팔고 어가가 욕을 보면 왕실의 권위가 떨어진다. {COUP_LINE} 아래로 떨어지면 왕의 마음을 잃은 당이 반정을 꾸민다. 살림이 넉넉하면 천천히 회복한다.
        </p>
        {realm.ledger && (
          <table className="realm-table">
            <thead>
              <tr>
                <th>도</th>
                <th>장부상 세</th>
                <th>관찰사 착복</th>
                <th>수령 착복</th>
                <th>국고에 든 것</th>
                <th>경작지</th>
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
                    <td>{Math.round(s.regions[id].arable * 100)}%</td>
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
          <div className={`realm-big ${warOdds(ready.score).held >= 0.4 ? 'good-text' : warOdds(ready.score).rout >= 0.2 ? 'bad-text' : ''}`}>
            {ready.score}
            <small>전쟁 대비</small>
          </div>
          <div className="realm-big">
            {Math.round(s.war.preparedness)}
            <small>비변사의 대비</small>
          </div>
          <div className="realm-big">
            {militaryUpkeep(s)} / {militaryNeed(s)}
            <small>다달이 군비 / 유지비</small>
          </div>
          <div className={`realm-big ${fund < 1 ? 'bad-text' : fund >= 1.2 ? 'good-text' : ''}`}>
            {Math.round(fund * 100)}%
            <small>유지비 대비 군비</small>
          </div>
        </div>
        <p className="small">
          {preWar ? `${warForecast(ready.score)}.` : ''} <span className="muted">{ready.parts.map((x) => `${x.label} ${x.value >= 0 ? '+' : ''}${x.value}`).join(' · ')}</span>
        </p>
        <p className="small muted">
          {fund < 1 ? '군비가 유지비에 못 미쳐 조련이 풀리고 성곽·진보·판옥선이 하나씩 허물어진다. ' : fund >= 1.2 ? '군비가 넉넉해 조련이 조금씩 오른다. ' : ''}
          왜군이 쳐들어오면 주사위 둘에 대비 점수의 보정((대비-35)/8)을 더해 전황을 정한다. 11 이상이면 남쪽에서 막아내고, 3 이하면 남쪽이 무너진다. 도성이 떨어지면 몽진과 왜군의 진군이 주사위로 속도를 겨루고, 왜군이 빠르면 어가가 사로잡힌다 (경기·황해·도성의 방비가 진군을 늦춘다). 군비가 유지비만큼이면 조련은 아주 천천히 풀린다.
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
