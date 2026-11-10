import { useState } from 'react';
import { useG } from './ctx';
import { TopBar } from './TopBar';
import { PlayerPanel } from './PlayerPanel';
import { CharPanel } from './CharPanel';
import { NewsFeed } from './NewsFeed';
import { EventModal } from './EventModal';
import { CourtTab } from './tabs/CourtTab';
import { PeopleTab } from './tabs/PeopleTab';
import { FactionTab } from './tabs/FactionTab';
import { RegionTab } from './tabs/RegionTab';
import { ChronicleTab } from './tabs/ChronicleTab';
import { RoyalTab } from './tabs/RoyalTab';

const TABS = [
  { id: 'court', name: '조정', el: CourtTab },
  { id: 'royal', name: '왕실', el: RoyalTab },
  { id: 'people', name: '인물', el: PeopleTab },
  { id: 'faction', name: '붕당', el: FactionTab },
  { id: 'region', name: '팔도', el: RegionTab },
  { id: 'chronicle', name: '연대기', el: ChronicleTab },
] as const;

export function GameScreen({ endTurn }: { endTurn: (months?: number) => void }) {
  const { s, selected } = useG();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('court');
  const Tab = TABS.find((t) => t.id === tab)!.el;
  const ev = s.pending[0];

  return (
    <div className="game">
      <TopBar endTurn={endTurn} />
      <div className="game-body">
        <aside className="left">
          <PlayerPanel />
        </aside>
        <main className="center">
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.name}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            <Tab />
          </div>
        </main>
        <aside className="right">{selected && s.chars[selected] ? <CharPanel id={selected} /> : <NewsFeed />}</aside>
      </div>
      {ev && <EventModal key={ev.id} ev={ev} more={s.pending.length - 1} />}
    </div>
  );
}
