import { useState } from 'react';
import { useG } from '../ctx';
import type { LogKind } from '../../engine/types';
import { formatDate } from '../../engine/calendar';

const KINDS: { id: LogKind | 'all'; name: string }[] = [
  { id: 'all', name: '전체' },
  { id: 'history', name: '역사' },
  { id: 'player', name: '나' },
  { id: 'court', name: '조정' },
  { id: 'faction', name: '붕당' },
  { id: 'death', name: '부고' },
  { id: 'war', name: '전란' },
];

export function ChronicleTab() {
  const { s } = useG();
  const [kind, setKind] = useState<LogKind | 'all'>('all');
  const list = s.log.filter((e) => kind === 'all' || e.kind === kind).reverse();
  let lastT = -1;

  return (
    <div className="chronicle">
      <div className="filters">
        {KINDS.map((k) => (
          <button key={k.id} className={`chip ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>
            {k.name}
          </button>
        ))}
      </div>
      <ol className="chron">
        {list.map((e, i) => {
          const head = e.t !== lastT;
          lastT = e.t;
          return (
            <li key={i} className={`k-${e.kind}`}>
              {head && <div className="chron-date">{formatDate(e.t)}</div>}
              <div className="chron-text">{e.text}</div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
