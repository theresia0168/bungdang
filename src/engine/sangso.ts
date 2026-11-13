import type { Character, GameState, MemorialTopic } from './types';
import { kingProfile } from './kingstat';
import type { RollPart } from './conflict';
import { OFFICE_MAP } from './data/offices';
import { REGION_META } from './data/meta';
import { FACTION_META } from './data/meta';
import { pick } from './rng';
import { josa, knownFlaws, officeTitle, P } from './state';
import { LAW_MAP, lawJosa } from './laws';
import { powerShare } from './factions';

/* ───────── 상소를 짓다: 담을 조목, 쓰는 시간, 임금의 비답 ─────────
 * 상소에 무엇을 담을지 고른다. 담을수록 판정에 보탬이 되지만 짓는 데 오래 걸린다.
 * 상소가 올라가면 상소문의 한 대목과 임금의 비답(批答)이 돌아온다.
 */

export interface Article {
  id: string;
  name: string;
  desc: string;
  /** 짓는 데 더 드는 달 */
  months: number;
  /** 고를 수 없는 까닭 */
  avail?: (s: GameState, p: Character, topic: MemorialTopic) => string | null;
  /** 판정에 더해지는 몫 */
  part?: (s: GameState, p: Character, topic: MemorialTopic) => RollPart | null;
}

const worstRegion = (s: GameState) => Object.values(s.regions).sort((a, b) => a.minsim - b.minsim)[0];

export const ARTICLES: Article[] = [
  {
    id: 'gosa',
    name: '경전과 고사를 인용한다',
    desc: '성현의 말과 옛 임금의 일을 들어 논지를 세운다. 학식이 깊을수록 무게가 실린다. (+1달)',
    months: 1,
    avail: (_s, p) => (p.learning < 4 ? '학식 4 이상이어야 한다' : null),
    part: (s, p) => {
      const z = kingProfile(s).zeal;
      const v = (p.learning >= 7 ? 2 : 1) + (z >= 2 ? 1 : z < 0 ? -2 : 0);
      return { label: z < 0 ? '경전을 지루해하는 임금' : z >= 2 ? '경전을 즐기는 임금' : '경전 인용', value: v };
    },
  },
  {
    id: 'minsaeng',
    name: '백성의 고통을 낱낱이 아뢴다',
    desc: '고을을 돌며 들은 백성의 실상을 적는다. 민심이 나쁜 도가 있으면 절실하게 들린다. (+1달)',
    months: 1,
    part: (s) => {
      const r = worstRegion(s);
      return r.minsim < 45 ? { label: '민생의 실상', value: 2 } : r.minsim < 60 ? { label: '민생의 실상', value: 1 } : null;
    },
  },
  {
    id: 'daechaek',
    name: '조목마다 대책을 갖춘다',
    desc: '폐단만 들지 않고 고칠 방도를 조목조목 적는다. 정치력이 높을수록 조리가 선다. (+1달)',
    months: 1,
    avail: (_s, p) => (p.politics < 4 ? '정치력 4 이상이어야 한다' : null),
    part: (_s, p) => ({ label: '대책의 조리', value: p.politics >= 7 ? 2 : 1 }),
  },
  {
    id: 'jikgan',
    name: '임금의 허물을 곧게 간한다',
    desc: '전하의 잘못을 에두르지 않고 아뢴다. 용안이 밝으면 가상히 여기고, 어두우면 노여움을 산다. 받아들여지면 명망 +3, 안 되면 성심 -5에 왕이 크게 노할 수 있다.',
    months: 0,
    part: (s) => (s.king.mood >= 20 ? { label: '직언을 가상히 여김', value: 1 } : s.king.mood <= -20 ? { label: '심기를 거스름', value: -1 } : null),
  },
  {
    id: 'dangron',
    name: '상대 당의 잘못을 논박한다',
    desc: '당론을 세우고 맞선 당을 친다. 당세가 크면 힘이 실린다. 당의 호감 +3, 맞선 당의 호감 -4, 붕당 간 긴장 +3.',
    months: 0,
    avail: (_s, p, topic) => (p.faction === 'none' ? '당에 속해 있어야 한다' : topic === 'jojae' ? '조제 상소와 맞지 않는다' : null),
    part: (s, p) => ((powerShare(s)[p.faction] ?? 0) >= 0.45 ? { label: '당세를 업음', value: 1 } : null),
  },
  {
    id: 'cheonjae',
    name: '재이(災異)를 들어 수성(修省)을 청한다',
    desc: '하늘의 꾸짖음을 들어 임금이 몸과 마음을 닦기를 청한다. 천변이나 흉년이 있을 때만 쓸 수 있다.',
    months: 0,
    avail: (s) => (s.situations.some((x) => x.kind === 'omen') || (typeof s.flags.droughtUntil === 'number' && (s.flags.droughtUntil as number) > s.t) ? null : '천변이나 흉년이 있어야 한다'),
    part: () => ({ label: '하늘의 꾸짖음', value: 1 }),
  },
  {
    id: 'daejoe',
    name: '대죄(待罪)하는 말로 맺는다',
    desc: '"신의 말이 망령되면 신을 벌하소서" 하고 처분을 기다린다. 판정에는 보탬이 없지만, 받아들여지지 않아도 왕이 크게 노하지 않는다.',
    months: 0,
  },
];

export const ARTICLE_MAP: Record<string, Article> = Object.fromEntries(ARTICLES.map((a) => [a.id, a]));

/** 고른 조목으로 짓는 데 걸리는 달 (기본 1달, 최대 4달) */
export const memorialMonths = (ids: string[] = []) => Math.min(4, 1 + ids.reduce((a, id) => a + (ARTICLE_MAP[id]?.months ?? 0), 0));

export function articleError(s: GameState, id: string, topic: MemorialTopic): string | null {
  const a = ARTICLE_MAP[id];
  if (!a) return '없는 조목이다';
  return a.avail?.(s, P(s), topic) ?? null;
}

export function articleParts(s: GameState, p: Character, topic: MemorialTopic, ids: string[] = []): RollPart[] {
  const out: RollPart[] = [];
  for (const id of ids) {
    const a = ARTICLE_MAP[id];
    if (!a || a.avail?.(s, p, topic)) continue;
    const part = a.part?.(s, p, topic);
    if (part && part.value) out.push(part);
  }
  return out;
}

/* ───────── 상소문의 한 대목 ───────── */

const GOSA = [
  '『서경』에 "백성은 오직 나라의 근본이니, 근본이 굳어야 나라가 편안하다" 하였습니다.',
  '옛날 당 태종은 위징의 곧은 말을 거울로 삼아 정관의 다스림을 이루었습니다.',
  '『논어』에 "정사(政事)란 바로잡는 것이니, 임금이 바름으로 이끌면 누가 감히 바르지 않겠는가" 하였습니다.',
  '『대학』에 "재물이 모이면 백성이 흩어지고, 재물이 흩어지면 백성이 모인다" 하였습니다.',
  '송나라 범중엄은 "천하의 근심을 먼저 근심하고 천하의 즐거움을 뒤에 즐긴다" 하였습니다.',
];

function topicLine(s: GameState, topic: MemorialTopic, ctx: { lawId?: string; abolish?: boolean; targetId?: string }): string {
  if (topic === 'law' && ctx.lawId && LAW_MAP[ctx.lawId]) {
    const l = LAW_MAP[ctx.lawId];
    return ctx.abolish
      ? `지금 시행하는 ${lawJosa(l.name, '은/는')} 그 폐단이 이미 드러났습니다. 청컨대 이를 거두소서.`
      : `${l.desc} 청컨대 ${lawJosa(l.name, '을/를')} 세우소서.`;
  }
  if (topic === 'jojae') return '붕당의 다툼이 날로 깊어 조정의 일이 시비로만 흐르니, 피차를 가리지 말고 어진 이를 고루 쓰시어 조제보합(調劑保合)하소서.';
  if (topic === 'recall') {
    const t = ctx.targetId ? s.chars[ctx.targetId] : undefined;
    return `${t ? josa(t.name, '은/는') : '귀양 간 신하는'} 죄가 분명하지 않은데 먼 곳에 매여 있으니, 그 억울함을 풀어 주소서.`;
  }
  return '근래 기강이 풀리고 언로가 막혀, 아래의 사정이 위에 이르지 못하니 신은 밤낮으로 근심합니다.';
}

/** 상소문의 첫머리와 고른 조목을 이어 한 대목을 짓는다 */
export function memorialDraft(s: GameState, init: Character, topic: MemorialTopic, ids: string[] = [], ctx: { lawId?: string; abolish?: boolean; targetId?: string } = {}): string {
  const o = init.office ? OFFICE_MAP[init.office] : undefined;
  const lines: string[] = [`신(臣) ${o ? `${o.name} ` : ''}${josa(init.name, '은/는')} 삼가 머리를 조아려 아룁니다.`];
  if (ids.includes('gosa')) lines.push(pick(s, GOSA));
  lines.push(topicLine(s, topic, ctx));
  if (ids.includes('minsaeng')) {
    const r = worstRegion(s);
    lines.push(`신이 들으니 ${REGION_META[r.id].short}의 백성은 ${r.minsim < 45 ? '초근목피로 연명하며 유랑하는 자가 길을 메웠다' : '부역과 환곡에 시달려 원망하는 소리가 그치지 않는다'} 합니다.`);
  }
  if (ids.includes('cheonjae')) lines.push('근래 하늘의 재변이 잇따르니, 이는 하늘이 전하를 꾸짖어 깨우치려는 것입니다.');
  if (ids.includes('daechaek')) lines.push('신이 그 고칠 방도를 몇 조목으로 갖추어 아래에 적었으니, 묘당에 내려 의논하게 하소서.');
  if (ids.includes('dangron') && init.faction !== 'none') {
    const foe = Object.entries(powerShare(s))
      .filter(([f]) => f !== init.faction && f !== 'none' && s.factions[f as keyof typeof s.factions]?.active)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    if (foe) lines.push(`${FACTION_META[foe as keyof typeof FACTION_META].name}의 무리가 조정을 그르치는데도 이를 바로잡는 이가 없습니다.`);
  }
  if (ids.includes('jikgan')) lines.push('전하께서 근래 듣기 좋은 말만 가까이하시고 거슬리는 말을 멀리하시니, 신은 이것이 가장 두렵습니다.');
  lines.push(ids.includes('daejoe') ? '신의 말이 망령되면 신을 벌하소서. 대죄(待罪)하며 처분을 기다립니다.' : '엎드려 바라건대 전하께서는 굽어살피소서.');
  return lines.join(' ');
}

/* ───────── 임금의 비답(批答) ───────── */

export function bidap(s: GameState, success: boolean, disaster: boolean, topic: MemorialTopic, ids: string[] = [], dismissed = false): string {
  const style = s.flags.kingStyle;
  if (success) {
    if (ids.includes('jikgan')) return pick(s, ['경의 말이 귀에 거슬리나 몸에는 약이 된다. 깊이 새기겠다.', '곧은 말을 들으니 부끄럽다. 마땅히 고치겠다.']);
    if (topic === 'law') return pick(s, ['상소를 보고 잘 알았다. 아뢴 대로 시행하라.', '소의 뜻이 절실하다. 묘당에 내려 아뢴 대로 거행하게 하라.']);
    if (topic === 'jojae') return '피차를 가리지 말라는 말이 옳다. 과인도 깊이 유념하겠다.';
    return pick(s, ['상소를 보고 잘 알았다. 그대의 말이 절실하니 마땅히 유념하겠다.', '소의 내용을 갖추어 알았다. 그대의 충성을 가상히 여긴다.', '아뢴 바가 옳다. 묘당에 내려 품처(稟處)하게 하겠다.']);
  }
  if (disaster) {
    const base = pick(s, ['말이 매우 해괴하다. 추고(推考)하라.', '어찌 감히 이런 말을 하는가. 엄히 추고하라.', '소를 돌려주어라. 다시는 이런 말로 번거롭게 하지 말라.']);
    return dismissed ? `${base} 그 직을 갈라.` : base;
  }
  const soft = pick(s, ['상소를 보고 잘 알았다. 번거롭게 하지 말라.', '그대의 뜻은 알겠으나 갑자기 고치기는 어렵다.', '소의 말은 지나치다. 물러가 직분을 다하라.']);
  const extra = ids.includes('dangron') && style === 'tangpyeong' ? ' 편당(偏黨)의 말을 섞지 말라.' : ids.includes('daejoe') ? ' 대죄하지 말라.' : '';
  return soft + extra;
}

/* ───────── 탄핵의 죄목 ───────── */

/** 탄핵할 때 고를 수 있는 흠결 */
export function chargeOptions(s: GameState, tgt: Character) {
  const p = P(s);
  return knownFlaws(tgt, p.id).map((f) => {
    const used = f.usedAt !== undefined && s.t - f.usedAt < 36;
    return { f, ok: !f.settled && !used, why: f.settled ? '이미 벌을 받은 일' : used ? `3년 안에 탄핵에 쓴 일 (${36 - (s.t - f.usedAt!)}달 뒤)` : '' };
  });
}

/** 탄핵 계사(啓辭)의 한 대목 */
export function impeachDraft(s: GameState, atk: Character, tgt: Character, labels: string[], pungmun: boolean): string {
  const title = officeTitle(tgt);
  if (!labels.length)
    return pungmun
      ? `${title} ${josa(tgt.name, '은/는')} 행실이 바르지 못하다는 풍문이 자자합니다. 대간은 풍문으로도 논할 수 있으니, 청컨대 파직하소서.`
      : `${title} ${josa(tgt.name, '은/는')} 그 자리에 걸맞지 않으니 청컨대 체차(遞差)하소서.`;
  const crimes = labels.map((l) => `「${l}」`).join(', ');
  return `${title} ${josa(tgt.name, '은/는')} ${crimes}의 일로 물의가 그치지 않습니다. ${labels.length >= 3 ? '죄상이 한두 가지가 아니니 ' : ''}청컨대 ${labels.length >= 2 ? '삭탈관작(削奪官爵)하소서' : '파직하소서'}.`;
}
