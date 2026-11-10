import type { ReactNode } from 'react';
import type { Character, FactionId } from '../engine/types';
import { FACTION_META } from '../engine/data/meta';
import { useG } from './ctx';
import { apMax, hasAuthority } from '../engine/actions';
import { Tip } from './guide';

export const fcolor = (f: FactionId) => FACTION_META[f].color;

export function FactionBadge({ f, full }: { f: FactionId; full?: boolean }) {
  const m = FACTION_META[f];
  return (
    <span className="fbadge" style={{ ['--fc' as string]: m.color }} title={m.desc}>
      {full ? m.name : m.short}
    </span>
  );
}

export function Portrait({ c, size = 56 }: { c: Character; size?: number }) {
  const sur = c.status === 'royal' ? '王' : c.name.slice(0, 1);
  const dead = c.status === 'dead';
  return (
    <div
      className={`portrait ${dead ? 'dead' : ''} ${c.status === 'exiled' ? 'exiled' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.48, ['--fc' as string]: fcolor(c.faction) }}
    >
      {sur}
    </div>
  );
}

export function CharLink({ id, children }: { id: string | undefined; children?: ReactNode }) {
  const { s, select } = useG();
  const c = id ? s.chars[id] : undefined;
  if (!c) return <span className="muted">—</span>;
  const me = c.id === s.player.charId;
  return (
    <button
      className={`clink ${c.status === 'dead' ? 'dead' : ''} ${me ? 'me' : ''}`}
      style={{ ['--fc' as string]: fcolor(c.faction) }}
      onClick={(e) => {
        e.stopPropagation();
        select(c.id);
      }}
    >
      {children ?? c.name}
    </button>
  );
}

export function Bar({ value, max = 100, color, label }: { value: number; max?: number; color?: string; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar" title={label}>
      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export function StackBar({ parts, height = 10 }: { parts: { key: string; value: number; color: string; label: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="stackbar" style={{ height }}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} title={`${p.label} ${Math.round((p.value / total) * 100)}%`} />
        ))}
    </div>
  );
}

export function Opinion({ v }: { v: number }) {
  const cls = v >= 40 ? 'op-great' : v >= 10 ? 'op-good' : v > -10 ? 'op-neutral' : v > -40 ? 'op-bad' : 'op-awful';
  return <span className={`op ${cls}`}>{v > 0 ? `+${v}` : v}</span>;
}

export function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div className="stat" title={title}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

/** 행동력 남은 것(●)과 쓴 것(○), 직권 여부 */
export function ApPips() {
  const { s } = useG();
  const max = Math.max(apMax(s), s.player.ap);
  const left = s.player.ap;
  return (
    <Tip k="ap" s={s}>
      <span className="ap">
        <span className="ap-label">행동력</span>
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={`pip ${i < left ? 'on' : ''}`} />
        ))}
        {hasAuthority(s) && <span className={`auth-chip ${s.player.authorityUsed ? 'used' : ''}`}>직권</span>}
      </span>
    </Tip>
  );
}

export function Paras({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((p, i) => (
        <p key={i}>
          {p.split('\n').map((line, j) => (
            <span key={j}>
              {j > 0 && <br />}
              {line}
            </span>
          ))}
        </p>
      ))}
    </>
  );
}
