import { useState } from 'react';
import { useG } from '../ctx';
import type { LogKind } from '../../engine/types';
import { formatDate } from '../../engine/calendar';

const KINDS: { id: LogKind | 'all' | 'key'; name: string }[] = [
  { id: 'key', name: '굵직한 일' },
  { id: 'all', name: '전체' },
  { id: 'history', name: '역사' },
  { id: 'player', name: '나' },
  { id: 'court', name: '조정' },
  { id: 'faction', name: '붕당' },
  { id: 'death', name: '부고' },
  { id: 'war', name: '전란' },
];

/** 굵직한 일: 임금의 교체, 환국과 옥사, 반정과 전란, 정통성, 조짐, 국법, 붕당의 변천 */
const KEY = /^\[(국왕|반정|붕당|정통성|조짐|국법|환국|국본|전란|정묘호란|병자호란|민란|관제)\]|^(계축옥사|경신환국|기사환국|갑술환국|을사환국|정미환국|신임옥사|임오화변|신유박해|기축옥사|무신정변|병신처분|정유독대)|환국:|난이 일어났다|왜군|세도/;

/** 내 일 가운데 달마다 되풀이되는 것 */
const ROUTINE = /작황|소작료|제수되었다|강학|문안|학업/;

export function ChronicleTab() {
  const { s } = useG();
  const [kind, setKind] = useState<LogKind | 'all' | 'key'>('key');
  const [q, setQ] = useState('');
  const [n, setN] = useState(150);
  const all = s.log.filter((e) => (kind === 'all' ? true : kind === 'key' ? KEY.test(e.text) || (e.kind === 'player' && !ROUTINE.test(e.text)) : e.kind === kind) && (!q || e.text.includes(q))).reverse();
  const list = all.slice(0, n);
  let lastT = -1;

  return (
    <div className="chronicle">
      <div className="filters">
        {KINDS.map((k) => (
          <button key={k.id} className={`chip ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>
            {k.name}
          </button>
        ))}
        <input className="chron-q" placeholder="찾기 (이름·사건)" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{all.length}건</span>
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
      {all.length > n && (
        <button className="mini more" onClick={() => setN(n + 300)}>
          더 보기 ({all.length - n}건 남음)
        </button>
      )}
    </div>
  );
}
