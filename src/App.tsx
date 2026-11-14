import { syncReigns } from './engine/calendar';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from './engine/types';
import { newGame, upgrade, type StartChoice } from './engine/setup';
import { advanceMonth } from './engine/turn';
import { updateGuide } from './engine/tutorial';
import { Ctx } from './ui/ctx';
import { StartScreen } from './ui/StartScreen';
import { GameScreen } from './ui/GameScreen';
import { EndScreen } from './ui/EndScreen';
import { mergeAchv } from './ui/achvStore';
import type { Diff } from './engine/diff';

const SAVE_KEY = 'joseon-bungdang/save/v3';
const OLD_KEYS = ['joseon-bungdang/save/v1', 'joseon-bungdang/save/v2'];

function loadSave(): GameState | null {
  try {
    for (const k of OLD_KEYS) localStorage.removeItem(k);
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    const u = s.version >= 3 && s.version <= 5 ? upgrade(s) : null;
    if (u) syncReigns(u);
    return u;
  } catch {
    return null;
  }
}

interface Toast {
  id: number;
  text: string;
}

export default function App() {
  const game = useRef<GameState | null>(null);
  const [, setVer] = useState(0);
  const [screen, setScreen] = useState<'start' | 'play' | 'end'>('start');
  const [selected, setSelected] = useState<string | null>(null);
  const [since, setSince] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hasSave, setHasSave] = useState(() => !!loadSave());
  const saveTimer = useRef<number | undefined>(undefined);
  const toastId = useRef(0);

  const toast = useCallback((text: string) => {
    if (!text) return;
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-4), { id, text }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 6000);
  }, []);

  const persist = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const s = game.current;
      if (!s) return;
      mergeAchv(s.player.achv);
      if (s.over) localStorage.removeItem(SAVE_KEY);
      else localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      setHasSave(!s.over);
    }, 400);
  }, []);

  const refresh = useCallback(() => {
    setVer((v) => v + 1);
    persist();
    if (game.current?.over && !game.current.pending.length) {
      window.setTimeout(() => setScreen('end'), 600);
    }
  }, [persist]);

  const act = useCallback(
    (fn: (s: GameState) => string | void) => {
      const s = game.current;
      if (!s) return;
      const msg = fn(s);
      updateGuide(s);
      if (msg) toast(msg);
      refresh();
    },
    [refresh, toast],
  );

  const start = (choice: StartChoice, diff: Diff = 'normal') => {
    game.current = newGame(choice, Date.now(), diff);
    setSelected(null);
    setSince(0);
    setScreen('play');
    refresh();
  };

  const resume = () => {
    const s = loadSave();
    if (!s) return;
    game.current = s;
    setSelected(null);
    setSince(s.t);
    setScreen(s.over ? 'end' : 'play');
    setVer((v) => v + 1);
  };

  /** months개월을 넘기되, 결정할 일이 생기면 그 달에서 멈춘다. */
  const endTurn = useCallback(
    (months = 1) => {
      const g = game.current;
      if (!g || g.pending.length || g.over) return;
      setSince(g.t + 1);
      for (let i = 0; i < months; i++) {
        if (g.pending.length || g.over) break;
        advanceMonth(g);
      }
      refresh();
    },
    [refresh],
  );

  useEffect(() => {
    if (screen !== 'play') return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code === 'Escape') setSelected(null);
      if (e.code !== 'Space' || el?.tagName === 'INPUT' || el?.tagName === 'SELECT' || document.querySelector('.modal.help')) return;
      e.preventDefault();
      if (el?.tagName === 'BUTTON') el.blur();
      endTurn(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, endTurn]);

  const s = game.current;

  return (
    <>
      {screen === 'start' && <StartScreen onStart={start} onResume={hasSave ? resume : undefined} />}
      {screen !== 'start' && s && (
        <Ctx.Provider value={{ s, act, select: setSelected, selected, toast, since }}>
          {screen === 'play' && <GameScreen endTurn={endTurn} />}
          {screen === 'end' && <EndScreen onRestart={() => setScreen('start')} />}
        </Ctx.Provider>
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
