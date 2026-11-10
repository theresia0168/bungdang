import type { GameState, PendingEvent } from '../types';
import type { EventDef, EventView } from './types';
import { GENERIC_EVENTS } from './generic';
import { HISTORY_EVENTS } from './history';
import { PERSONAL_EVENTS } from './personal';
import { FAVOR_EVENTS } from './favors';
import { INTRIGUE_EVENTS } from './intrigue';
import { AGENDA_EVENTS } from '../agenda';
import { KING_EVENTS } from '../king';
import { DUTY_EVENTS } from '../duties';
import { PARTY_EVENTS } from '../party';
import { REGION_EVENTS } from '../regions';
import { ROYAL_EVENTS } from '../royal';
import { SITUATION_EVENTS } from '../situations';
import { SUCCESSION_EVENTS } from '../succession';
import { SALLIM_EVENTS } from './sallim';
import { WAR_EVENTS } from './war';

export const EVENTS: Record<string, EventDef> = {
  ...SUCCESSION_EVENTS,
  ...SALLIM_EVENTS,
  ...WAR_EVENTS,
  ...GENERIC_EVENTS,
  ...HISTORY_EVENTS,
  ...PERSONAL_EVENTS,
  ...FAVOR_EVENTS,
  ...INTRIGUE_EVENTS,
  ...AGENDA_EVENTS,
  ...KING_EVENTS,
  ...DUTY_EVENTS,
  ...PARTY_EVENTS,
  ...REGION_EVENTS,
  ...ROYAL_EVENTS,
  ...SITUATION_EVENTS,
};

export function viewEvent(s: GameState, e: PendingEvent): EventView {
  const def = EVENTS[e.def];
  if (!def) return { title: e.def, text: '알 수 없는 사건', choices: [{ key: 'ok', label: '확인' }] };
  return def.build(s, e.ctx);
}

export type { EventView, Choice } from './types';
export { runHistory } from './history';
export { rollPersonal } from './personal';
