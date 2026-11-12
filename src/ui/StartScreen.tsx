import { useState } from 'react';
import type { FactionId, RegionId, SchoolId, TraitId } from '../engine/types';
import { BACKGROUNDS, PLAYABLE, type CustomSpec, type StartChoice } from '../engine/setup';
import type { RosterEntry } from '../engine/data/roster';
import { FACTION_META, REGIONS, SCHOOL_META, TRAIT_META } from '../engine/data/meta';
import { OFFICE_MAP } from '../engine/data/offices';
import { CLAN_POOL, GIVEN_1, GIVEN_2 } from '../engine/data/names';
import { josa } from '../engine/state';
import { fcolor } from './common';
import { STAT_GUIDE, Tip, type StatKey } from './guide';

const PICKABLE_TRAITS: TraitId[] = ['upright', 'mild', 'radical', 'scholar', 'writer', 'schemer', 'clean', 'greedy', 'ambitious', 'mediator'];
const CONFLICTS: [TraitId, TraitId][] = [
  ['clean', 'greedy'],
  ['mild', 'radical'],
  ['upright', 'schemer'],
];
const DIFF_ORDER = ['쉬움', '보통', '어려움', '매우 어려움'];

const rosterOffice = (r: RosterEntry) => {
  if (r.status === 'retired') return '낙향 처사';
  if (!r.office) return '무직';
  if (r.office === 'nanggwan') return `낭관 (${r.rank}품)`;
  return OFFICE_MAP[r.office]?.name ?? r.office;
};

const rnd = <T,>(xs: readonly T[] | string) => xs[Math.floor(Math.random() * xs.length)] as T;

function randomSpec(): CustomSpec {
  const [bon, sur] = rnd(CLAN_POOL);
  const faction: FactionId = Math.random() < 0.5 ? 'dong' : 'seo';
  const home = rnd(REGIONS.filter((r) => r.id !== 'hanseong')).id;
  return {
    name: sur + rnd<string>(GIVEN_1) + rnd<string>(GIVEN_2),
    bon,
    ho: '',
    faction,
    school: faction === 'seo' ? 'giho' : home === 'gyeongsang' ? 'toegye' : 'hwadam',
    home,
    background: 'sinjin',
    traits: [],
  };
}

export function StartScreen({ onStart, onResume }: { onStart: (c: StartChoice) => void; onResume?: () => void }) {
  const [mode, setMode] = useState<'list' | 'custom'>('list');
  const [pick, setPick] = useState<string>(PLAYABLE[0]?.id);
  const [spec, setSpec] = useState<CustomSpec>(randomSpec);
  const sorted = [...PLAYABLE].sort((a, b) => DIFF_ORDER.indexOf(a.playable!.difficulty) - DIFF_ORDER.indexOf(b.playable!.difficulty));
  const chosen = PLAYABLE.find((r) => r.id === pick);

  const toggleTrait = (t: TraitId) => {
    setSpec((sp) => {
      if (sp.traits.includes(t)) return { ...sp, traits: sp.traits.filter((x) => x !== t) };
      if (sp.traits.length >= 2) return sp;
      const clash = CONFLICTS.find(([a, b]) => (a === t && sp.traits.includes(b)) || (b === t && sp.traits.includes(a)));
      if (clash) return sp;
      return { ...sp, traits: [...sp.traits, t] };
    });
  };
  const nameOk = /^[가-힣]{2,4}$/.test(spec.name) && /^[가-힣]{1,4}$/.test(spec.bon);

  return (
    <div className="start">
      <header className="start-head">
        <div className="start-seal">黨</div>
        <div>
          <h1>붕당(朋黨)</h1>
          <p className="start-sub">선조 8년 을해년(1575), 사림이 둘로 갈라지던 해부터 임진왜란과 호란, 예송과 환국, 탕평과 세도를 지나 순조 21년(1821)까지</p>
        </div>
      </header>

      <div className="start-tabs">
        <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>
          역사 인물로 시작
        </button>
        <button className={mode === 'custom' ? 'on' : ''} onClick={() => setMode('custom')}>
          가상 인물 만들기
        </button>
        {onResume && (
          <button className="resume" onClick={onResume}>
            이어하기
          </button>
        )}
      </div>

      {mode === 'list' && (
        <div className="start-body">
          <ul className="roster-list">
            {sorted.map((r) => (
              <li key={r.id} className={pick === r.id ? 'on' : ''} onClick={() => setPick(r.id)} style={{ ['--fc' as string]: fcolor(r.faction) }}>
                <span className="rl-seal">{r.name[0]}</span>
                <span className="rl-name">
                  {r.name}
                  {r.ho && <small> {r.ho}</small>}
                </span>
                <span className="rl-fac">{FACTION_META[r.faction].name}</span>
                <span className={`rl-diff d${DIFF_ORDER.indexOf(r.playable!.difficulty)}`}>{r.playable!.difficulty}</span>
              </li>
            ))}
          </ul>
          {chosen && (
            <div className="roster-detail" style={{ ['--fc' as string]: fcolor(chosen.faction) }}>
              <h2>
                {chosen.name}
                {chosen.ho && <small> 호 {chosen.ho}</small>}
              </h2>
              <div className="rd-meta">
                {chosen.clan} · {1575 - chosen.born}세 · {FACTION_META[chosen.faction].name} · {SCHOOL_META[chosen.school].name} · {rosterOffice(chosen)}
              </div>
              <p className="rd-pitch">{chosen.playable!.pitch}</p>
              <p className="rd-bio">{chosen.bio}</p>
              <div className="rd-stats">
                {(
                  [
                    ['learning', chosen.learning],
                    ['politics', chosen.politics],
                    ['vigor', chosen.vigor],
                    ['prestige', chosen.prestige],
                    ['wealth', chosen.wealth],
                    ['favor', chosen.favor],
                  ] as [StatKey, number][]
                ).map(([k, v]) => (
                  <Tip key={k} k={k}>
                    <span>
                      {STAT_GUIDE[k].name} {v} <em className="cap">{STAT_GUIDE[k].caption}</em>
                    </span>
                  </Tip>
                ))}
              </div>
              <div className="rd-traits">
                {chosen.traits.map((t) => (
                  <span key={t} className="trait" title={TRAIT_META[t].desc}>
                    {TRAIT_META[t].name}
                  </span>
                ))}
              </div>
              <button className="btn-primary big" onClick={() => onStart({ kind: 'historical', id: chosen.id })}>
                {josa(chosen.name, '으로/로')} 시작
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'custom' && (
        <div className="start-body custom">
          <div className="form-grid">
            <label>
              이름
              <input value={spec.name} maxLength={4} onChange={(e) => setSpec({ ...spec, name: e.target.value.trim() })} />
            </label>
            <label>
              본관
              <input value={spec.bon} maxLength={4} onChange={(e) => setSpec({ ...spec, bon: e.target.value.trim() })} />
            </label>
            <label>
              호 (선택)
              <input value={spec.ho} maxLength={4} onChange={(e) => setSpec({ ...spec, ho: e.target.value.trim() })} />
            </label>
            <button className="btn-ghost" onClick={() => setSpec(randomSpec())}>
              무작위
            </button>
            <label>
              붕당
              <select value={spec.faction} onChange={(e) => setSpec({ ...spec, faction: e.target.value as FactionId })}>
                {(['dong', 'seo', 'none'] as FactionId[]).map((f) => (
                  <option key={f} value={f}>
                    {FACTION_META[f].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              학통
              <select value={spec.school} onChange={(e) => setSpec({ ...spec, school: e.target.value as SchoolId })}>
                {(Object.keys(SCHOOL_META) as SchoolId[]).map((k) => (
                  <option key={k} value={k}>
                    {SCHOOL_META[k].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              고향
              <select value={spec.home} onChange={(e) => setSpec({ ...spec, home: e.target.value as RegionId })}>
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3>출신</h3>
          <div className="bg-cards">
            {(Object.keys(BACKGROUNDS) as CustomSpec['background'][]).map((b) => (
              <button key={b} className={`bg-card ${spec.background === b ? 'on' : ''}`} onClick={() => setSpec({ ...spec, background: b })}>
                <b>{BACKGROUNDS[b].name}</b>
                <span>{BACKGROUNDS[b].desc}</span>
              </button>
            ))}
          </div>

          <h3>
            성품 <small>(최대 2개)</small>
          </h3>
          <div className="trait-pick">
            {PICKABLE_TRAITS.map((t) => (
              <button key={t} className={`trait ${spec.traits.includes(t) ? 'on' : ''}`} onClick={() => toggleTrait(t)} title={TRAIT_META[t].desc}>
                {TRAIT_META[t].name}
              </button>
            ))}
          </div>
          <p className="muted small">{spec.traits.map((t) => `${TRAIT_META[t].name}: ${TRAIT_META[t].desc}`).join(' / ') || '성품에 마우스를 올리면 효과가 보인다.'}</p>

          <button className="btn-primary big" disabled={!nameOk} onClick={() => onStart({ kind: 'custom', spec })}>
            {nameOk ? `${spec.bon} ${spec.name[0]}씨 ${josa(spec.name, '으로/로')} 시작` : '이름(한글 2~4자)과 본관을 입력하라'}
          </button>
        </div>
      )}
    </div>
  );
}
