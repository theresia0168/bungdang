import type { GameState, PendingEvent } from '../types';
import type { Choice, EventDef, EventView } from './types';
import { P } from '../state';
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
import { BUNJO_EVENTS, WAR_EVENTS, WAR_EXTRA_EVENTS } from './war';
import { CASE_EVENTS } from '../cases';
import { STRIFE_EVENTS } from '../strife';
import { LATER_EVENTS } from '../later';
import { GWAGEO_EVENTS } from '../gwageo';
import { GUKBON_EVENTS } from '../gukbon';
import { KWANJE_EVENTS } from '../kwanje';
import { WANG_EVENTS } from '../wang';
import { COUP_EVENTS } from '../coup';
import { BOKSANG_EVENTS } from '../court';
import { COUNTY_EVENTS } from '../county';

export const EVENTS: Record<string, EventDef> = {
  ...SUCCESSION_EVENTS,
  ...SALLIM_EVENTS,
  ...WAR_EVENTS,
  ...WAR_EXTRA_EVENTS,
  ...BUNJO_EVENTS,
  ...CASE_EVENTS,
  ...STRIFE_EVENTS,
  ...LATER_EVENTS,
  ...GWAGEO_EVENTS,
  ...GUKBON_EVENTS,
  ...KWANJE_EVENTS,
  ...WANG_EVENTS,
  ...COUP_EVENTS,
  ...BOKSANG_EVENTS,
  ...COUNTY_EVENTS,
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
  const v = def.build(s, e.ctx);
  return { ...v, choices: bindByTraits(s, v.choices) };
}

/* ───────── 성품이 고르는 길 ─────────
 * 청렴한 이는 재물을 탐하는 선택지를, 강직한 이는 눈감아 주거나 얽어 넣는 선택지를,
 * 온건한 이는 남을 모함하는 선택지를, 탐욕스러운 이는 사재를 터는 선택지를 고를 수 없다.
 * 고를 수 있는 길이 하나도 남지 않으면 막지 않는다.
 */
const GREED_LABEL = /(챙긴|착복|몫을|뇌물|사례를 받|나누어 받|예물을 받|인사를 받|사무역에 끼어|교역에 슬쩍|수탈)/;
const COVER_LABEL = /(눈감아|못 본 척|덮어 둔다|입을 막)/;
const FRAME_LABEL = /(얽어 넣|날조|모함)/;
const GIVE_LABEL = /(사재|털어|내놓|재물을 들여|\(재산 \d+\))/;
const BOLD_LABEL = /(직언|거듭 간|들춰|정면으로|맞선다|탄핵한다|구명한다|곧게 간)/;
const RISK_LABEL = /(목숨을 걸고|거듭 간|정면으로)/;
const BOW_LABEL = /(아첨|뜻에 맞춘|뜻에 맞추어|반성문|사죄|대죄|한발 물러|양보)/;
const BETRAY_LABEL = /(반정에 가담|거사에 가담|밀고|흘린다|궁중에 흘)/;

function bindByTraits(s: GameState, choices: Choice[]): Choice[] {
  const p = P(s);
  if (!p || choices.length < 2) return choices;
  const has = (t: string) => p.traits.includes(t as never);
  const out = choices.map((c) => {
    if (c.disabled) return c;
    const text = `${c.label} ${c.hint ?? ''}`;
    const gain = /재산 \+\d/.test(c.hint ?? '') && (/(흠결|착복|뇌물|국고에 들지 않)/.test(text) || GREED_LABEL.test(c.label));
    let why: string | undefined;
    if ((gain || GREED_LABEL.test(c.label)) && has('clean')) why = '청렴한 성품이 허락하지 않는다';
    else if ((gain || COVER_LABEL.test(c.label) || FRAME_LABEL.test(c.label)) && has('upright')) why = '강직한 성품이 허락하지 않는다';
    else if (FRAME_LABEL.test(c.label) && has('mild')) why = '온건한 성품이 허락하지 않는다';
    else if (GIVE_LABEL.test(c.label) && !/재산 \+/.test(c.hint ?? '') && has('greedy')) why = '재물을 내놓기가 아까워 차마 못 하겠다';
    else if (BOLD_LABEL.test(c.label) && has('timid')) why = '소심한 성품이 허락하지 않는다';
    else if (RISK_LABEL.test(c.label) && has('cautious')) why = '신중한 성품이 허락하지 않는다';
    else if (BOW_LABEL.test(c.label) && has('arrogant')) why = '오만한 성품이 허락하지 않는다';
    else if (BETRAY_LABEL.test(c.label) && has('loyal')) why = '충직한 성품이 허락하지 않는다';
    return why ? { ...c, disabled: why } : c;
  });
  return out.some((c) => !c.disabled) ? out : choices;
}

export type { EventView, Choice } from './types';
export { runHistory } from './history';
export { rollPersonal } from './personal';
