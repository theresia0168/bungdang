import { useState, type ReactNode } from 'react';
import type { GameState } from '../engine/types';
import { useG } from './ctx';
import { END_T, formatDate, monthName, monthOf, yearOf } from '../engine/calendar';
import { P, age } from '../engine/state';
import { FACTION_META } from '../engine/data/meta';
import { activeFactions, powerShare } from '../engine/factions';
import { ApPips, StackBar } from './common';
import { HelpModal, STAT_GUIDE, Tip, type StatKey } from './guide';

export function TopBar({ endTurn }: { endTurn: (months?: number) => void }) {
  const { s } = useG();
  const [help, setHelp] = useState(false);
  const p = P(s);
  const y = yearOf(s.t);
  const flaws = p.flaws.length;
  const exposed = p.flaws.filter((f) => f.public).length;
  const watched = p.flaws.filter((f) => !f.public && f.knownBy.length).length;
  const share = powerShare(s);
  const blocked = s.pending.length > 0;
  const destinyNear = y >= p.destiny;

  return (
    <header className="topbar">
      <div className="tb-date">
        <div className="tb-date-main">{formatDate(s.t)}</div>
        <div className="tb-progress">
          <div style={{ width: `${(s.t / END_T) * 100}%` }} />
        </div>
      </div>

      <div className="tb-res">
        <Res s={s} k="favor" value={Math.round(p.favor)} />
        <Res s={s} k="prestige" value={Math.round(p.prestige)} />
        <Res s={s} k="wealth" value={Math.round(p.wealth)} />
        <Res s={s} k="vigor" value={`${p.vigor}${s.player.sick ? ' (병)' : ''} · ${age(s, p)}세`} warn={s.player.sick} />
        <Res s={s} k="destiny" value={destinyNear ? '판정 중' : `${p.destiny}년`} warn={destinyNear} />
        <Res s={s} k="flaws" value={flaws ? `${flaws}${exposed ? ` · 드러남 ${exposed}` : ''}` : '없음'} warn={exposed > 0 || watched > 0} />
      </div>

      <div className="tb-power" title="관직 비중에 따른 당세">
        <StackBar
          height={8}
          parts={[...activeFactions(s), 'none' as const].map((f) => ({ key: f, value: share[f], color: FACTION_META[f].color, label: FACTION_META[f].name }))}
        />
        <div className="tb-tension" title="붕당 간 긴장도. 높을수록 탄핵이 잦고 다른 당 사람의 호감이 낮다.">
          긴장 {Math.round(s.tension)}
          {s.war.active && <span className="war-flag">전란</span>}
        </div>
      </div>

      <div className="tb-ap">
        <ApPips />
      </div>
      <div className="tb-turn">
        <button className="tb-help" onClick={() => setHelp(true)} title="능력치와 용어 설명">
          ? 도움말
        </button>
        <button className="tb-skip" onClick={() => endTurn(3)} disabled={blocked} title="석 달을 넘긴다. 결정할 일이 생기면 그 달에서 멈춘다.">
          석 달
        </button>
        <button className="tb-next" onClick={() => endTurn(1)} disabled={blocked} title="이번 달을 마친다 (Space)">
          {blocked ? '결정 대기 중' : s.t >= END_T ? '마지막 달을 마친다 ▶' : `${monthName(monthOf(s.t + 1))}로 ▶`}
        </button>
      </div>
      {help && <HelpModal onClose={() => setHelp(false)} />}
    </header>
  );
}

function Res({ s, k, value, warn }: { s: GameState; k: StatKey; value: ReactNode; warn?: boolean }) {
  const g = STAT_GUIDE[k];
  return (
    <Tip k={k} s={s}>
      <div className={`res ${warn ? 'warn' : ''}`}>
        <span className="res-label">{g.name}</span>
        <span className="res-value">{value}</span>
        <span className="res-cap">{g.caption}</span>
      </div>
    </Tip>
  );
}
