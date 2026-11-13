import type { GameState } from './types';

/* ───────── 임금의 됨됨이 ─────────
 * 임금에게도 학식과 정치력이 있고, 학문에 대한 관심(好學)이 다르다.
 * 경연·진강·책문은 「주사위 + (내 학식 - 임금의 학식)」, 청대에서 설득하는 일은 「주사위 + (내 정치력 - 임금의 정치력)」으로 판정한다.
 * 학문을 즐기는 임금은 강론에 크게 감복하지만 눈이 높고, 학문에 뜻이 없는 임금은 경전 이야기를 지루해하다 짜증을 낸다.
 * 정치에 밝은 임금은 아첨과 설득을 꿰뚫어 본다.
 */

export type Zeal = -1 | 0 | 1 | 2;

export interface KingProfile {
  learning: number;
  politics: number;
  /** 학문에 대한 관심: -1 싫어함, 0 무덤덤, 1 즐김, 2 군사(君師)를 자처함 */
  zeal: Zeal;
  note: string;
}

const PROFILES: Record<string, KingProfile> = {
  선조: { learning: 7, politics: 6, zeal: 1, note: '학문을 즐기고 글씨에 능하다. 다만 의심이 많아 신하를 쉽게 믿지 않는다.' },
  광해군: { learning: 6, politics: 7, zeal: 0, note: '실리에 밝고 외교에 능하다. 경전보다 당장의 일을 묻는다.' },
  임해군: { learning: 3, politics: 3, zeal: -1, note: '성품이 거칠고 술을 즐긴다. 경연을 귀찮아하고, 거슬리는 말에 쉽게 노한다.' },
  정원군: { learning: 5, politics: 4, zeal: 0, note: '너그럽되 결단이 무르다. 대신들의 말을 잘 듣는다.' },
  의창군: { learning: 6, politics: 4, zeal: 1, note: '젊고 글을 좋아한다. 아직 정사에 서툴다.' },
  경선군: { learning: 5, politics: 3, zeal: 1, note: '어린 나이에 즉위한 소현세자의 아들이다. 몸이 약하고, 대신들의 말에 기댄다.' },
  밀풍군: { learning: 4, politics: 4, zeal: 0, note: '소론이 받든 종친 임금이다. 소론 대신들의 뜻을 거스르지 못한다.' },
  장조: { learning: 7, politics: 5, zeal: -1, note: '임오년에 살아남은 세자다. 총명하나 화증이 깊어, 거슬리는 말에 불같이 노한다.' },
  인조: { learning: 4, politics: 5, zeal: 0, note: '반정으로 오른 임금이다. 경연보다 공신들의 눈치를 본다.' },
  효종: { learning: 5, politics: 6, zeal: 0, note: '학문보다 북벌과 무예에 마음을 둔다.' },
  현종: { learning: 6, politics: 4, zeal: 1, note: '온화하고 학문을 좋아하나, 예송에 휘둘려 결단이 약하다.' },
  숙종: { learning: 7, politics: 8, zeal: 1, note: '판을 읽는 데 능하고 결단이 빠르다. 설득하기 어렵다.' },
  경종: { learning: 5, politics: 3, zeal: -1, note: '병약해 경연을 자주 거른다. 긴 강론을 지루해한다.' },
  영조: { learning: 8, politics: 8, zeal: 2, note: '조선에서 경연을 가장 많이 연 임금이다. 신하의 강론을 꼼꼼히 따진다.' },
  정조: { learning: 9, politics: 8, zeal: 2, note: '스스로 신하들의 스승(君師)을 자처한다. 웬만한 강론은 눈에 차지 않는다.' },
  순조: { learning: 6, politics: 3, zeal: 0, note: '어려서 즉위해 외척의 뜻에 기댄다.' },
};

const kingName = (s: GameState) => s.chars[String(s.flags.kingId ?? 'seonjo')]?.name ?? '선조';

/** 수렴청정 중인가: 어린 임금 대신 대비가 발 뒤에서 정사를 듣는다 */
export const regency = (s: GameState) => typeof s.flags.suryeomUntil === 'number' && s.t < (s.flags.suryeomUntil as number);

/** 수렴청정 중이면 「대왕대비」, 아니면 임금의 이름 */
export const rulerName = (s: GameState) => (regency(s) ? '대왕대비' : kingName(s));

export function kingProfile(s: GameState): KingProfile {
  if (regency(s)) return { learning: 5, politics: 7, zeal: 0, note: '대왕대비 정순왕후가 발 뒤에서 정사를 듣는다(수렴청정). 어린 임금 대신 대비의 뜻을 살펴야 한다. 대비는 벽파를 감싸고 서학을 미워한다.' };
  return PROFILES[kingName(s)] ?? { learning: 5, politics: 5, zeal: 0, note: '' };
}

export const ZEAL_NAME: Record<Zeal, string> = {
  [-1]: '학문을 싫어함',
  0: '학문에 무덤덤함',
  1: '학문을 즐김',
  2: '군사(君師)를 자처함',
};

/** 학문을 즐기는 임금일수록 경연을 자주 연다 */
export const ZEAL_FREQ: Record<Zeal, number> = { [-1]: 0.4, 0: 0.8, 1: 1.1, 2: 1.5 };

/** 「주사위 + (내 능력 - 임금의 능력)」의 차를 글로 */
export const vsText = (mine: number, his: number, label: string) => `주사위 + (내 ${label} ${mine} − 임금 ${his})`;
