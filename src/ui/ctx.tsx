import { createContext, useContext } from 'react';
import type { GameState } from '../engine/types';

export interface GameCtx {
  s: GameState;
  /** 엔진 함수로 상태를 바꾼 뒤 다시 그린다. 반환된 문자열은 알림으로 띄운다. */
  act: (fn: (s: GameState) => string | void) => void;
  select: (id: string | null) => void;
  selected: string | null;
  toast: (text: string) => void;
  /** 이번 턴이 시작된 달. 이후의 기록이 '지난 턴의 소식'이다. */
  since: number;
}

export const Ctx = createContext<GameCtx>(null!);
export const useG = () => useContext(Ctx);
