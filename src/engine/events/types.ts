import type { GameState } from '../types';
import type { ImpeachReport, MemorialResult } from '../conflict';

export interface Choice {
  key: string;
  label: string;
  hint?: string;
  disabled?: string;
}

export interface EventView {
  title: string;
  text: string;
  choices: Choice[];
  kind?: 'history' | 'personal' | 'notice' | 'danger' | 'court' | 'war';
  report?: ImpeachReport;
  memorial?: MemorialResult;
}

export interface EventDef {
  build(s: GameState, ctx: Record<string, any>): EventView;
  /** 반환한 문자열은 화면 하단 알림으로 보인다 */
  resolve(s: GameState, ctx: Record<string, any>, key: string): string | void;
}

export const OK = [{ key: 'ok', label: '확인' }];
