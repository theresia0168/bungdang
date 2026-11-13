import { useState } from 'react';
import { useG } from '../ctx';
import type { FactionId, RegionId } from '../../engine/types';
import { REGIONS, REGION_META, FACTION_META } from '../../engine/data/meta';
import { holderOf } from '../../engine/court';
import { officeTitle, people } from '../../engine/state';
import { HARVEST_LABEL, REGION_ECON, regionYield } from '../../engine/regions';
import { CharLink, FactionBadge, StackBar } from '../common';

const AREA: Record<RegionId, string> = {
  hamgyeong: 'hg',
  pyeongan: 'pa',
  hwanghae: 'hh',
  gyeonggi: 'gg',
  hanseong: 'hs',
  gangwon: 'gw',
  chungcheong: 'cc',
  jeolla: 'jl',
  gyeongsang: 'gs',
};

export function RegionTab() {
  const { s } = useG();
  const [sel, setSel] = useState<RegionId>('hanseong');
  const all = people(s);

  const infParts = (id: RegionId) =>
    (Object.entries(s.regions[id].influence) as [FactionId, number][]).map(([f, v]) => ({
      key: f,
      value: v,
      color: FACTION_META[f].color,
      label: FACTION_META[f].name,
    }));

  const here = all.filter((c) => c.location === sel && c.status !== 'royal');
  const [allHere, setAllHere] = useState(false);
  const r = s.regions[sel];
  const gov = holderOf(s, `gamsa_${sel}`);

  return (
    <div className="regions">
      <div className="map">
        {REGIONS.map((meta) => {
          const st = s.regions[meta.id];
          const war = s.war.zones.includes(meta.id);
          const g = holderOf(s, `gamsa_${meta.id}`);
          const n = all.filter((c) => c.location === meta.id).length;
          return (
            <button
              key={meta.id}
              className={`region ${sel === meta.id ? 'on' : ''} ${war ? 'war' : ''}`}
              style={{ gridArea: AREA[meta.id] }}
              onClick={() => setSel(meta.id)}
            >
              <div className="rg-name">{meta.short}</div>
              <StackBar parts={infParts(meta.id)} height={6} />
              <div className="rg-meta">
                <span title="민심">民 {Math.round(st.minsim)}</span>
                <span>{n}인</span>
              </div>
              {g && (
                <div className="rg-gov">
                  <FactionBadge f={g.faction} /> {g.name}
                </div>
              )}
              <div className="rg-tags">
                {war && <span className="tag war">전장</span>}
                {REGION_ECON[meta.id].yield > 0 && (st.harvest ?? 0) !== 0 && <span className={`tag ${(st.harvest ?? 0) > 0 ? 'good' : 'bad'}`}>{HARVEST_LABEL[st.harvest ?? 0]}</span>}
                {st.tags.includes('banyeok') && <span className="tag bad">반역향</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="region-detail">
        <h3>{REGION_META[sel].name}</h3>
        <p className="muted">{REGION_META[sel].desc}</p>
        <StackBar parts={infParts(sel)} height={12} />
        <div className="rd-legend small">
          {infParts(sel).map((p) => (
            <span key={p.key}>
              <FactionBadge f={p.key as FactionId} /> {Math.round(p.value)}
            </span>
          ))}
          <span>· 민심 {Math.round(r.minsim)}</span>
        </div>
        {REGION_ECON[sel].yield > 0 && (
          <div className="rd-econ small">
            <div>
              <b>살림</b> {REGION_ECON[sel].produce}
            </div>
            <div>
              <b>올해 작황</b> {HARVEST_LABEL[r.harvest ?? 0]} · <b>거둘 재물</b> {regionYield(s, sel)}{' '}
              <span className="muted">(평년 {REGION_ECON[sel].yield}. 관찰사가 관례대로 남기면 그 절반, 수탈하면 1.2배)</span>
            </div>
            <div>
              <b>골칫거리</b> {REGION_ECON[sel].hazard}
              {r.tags.includes('reserve') && ' · 비축한 환곡이 있다'}
            </div>
          </div>
        )}
        {gov && (
          <p>
            관찰사 <CharLink id={gov.id} />
          </p>
        )}
        <h4>머무는 이 ({here.length})</h4>
        <ul className="mini-list">
          {here
            .sort((a, b) => a.rank - b.rank)
            .slice(0, allHere ? here.length : 20)
            .map((c) => (
              <li key={c.id}>
                <FactionBadge f={c.faction} />
                <CharLink id={c.id} />
                <span className="muted small">{c.status === 'exiled' ? `유배 (${c.exilePlace ?? ''})` : c.status === 'retired' ? '낙향' : officeTitle(c)}</span>
              </li>
            ))}
        </ul>
        {here.length > 20 && (
          <button className="mini more" onClick={() => setAllHere(!allHere)}>
            {allHere ? '줄여 보기' : `나머지 ${here.length - 20}명 더 보기`}
          </button>
        )}
      </div>
    </div>
  );
}
