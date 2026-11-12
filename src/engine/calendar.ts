export const START_YEAR = 1575;
export const END_YEAR = 1821;
export const END_T = (END_YEAR - START_YEAR) * 12 + 11;

export const yearOf = (t: number) => START_YEAR + Math.floor(t / 12);
export const monthOf = (t: number) => (t % 12) + 1;
export const tOf = (y: number, m: number) => (y - START_YEAR) * 12 + (m - 1);

const STEMS = '갑을병정무기경신임계';
const BRANCHES = '자축인묘진사오미신유술해';

export function ganji(y: number) {
  const i = (((y - 4) % 60) + 60) % 60;
  return STEMS[i % 10] + BRANCHES[i % 12];
}

export function monthName(m: number) {
  if (m === 1) return '정월';
  if (m === 11) return '동짓달';
  if (m === 12) return '섣달';
  return `${m}월`;
}

export const seasonOf = (m: number) => (m <= 3 ? '봄' : m <= 6 ? '여름' : m <= 9 ? '가을' : '겨울');
/** 왕대. 즉위한 해의 이듬해를 원년으로 친다(유년칭원). */
export const KINGS: { name: string; from: number; to: number }[] = [
  { name: '선조', from: 1567, to: 1608 },
  { name: '광해군', from: 1608, to: 1623 },
  { name: '인조', from: 1623, to: 1649 },
  { name: '효종', from: 1649, to: 1659 },
  { name: '현종', from: 1659, to: 1674 },
  { name: '숙종', from: 1674, to: 1720 },
  { name: '경종', from: 1720, to: 1724 },
  { name: '영조', from: 1724, to: 1776 },
  { name: '정조', from: 1776, to: 1800 },
  { name: '순조', from: 1800, to: 1834 },
];
export const kingOfYear = (y: number) => [...KINGS].reverse().find((k) => y > k.from) ?? KINGS[0];
export const reignLabel = (y: number) => {
  const k = kingOfYear(y);
  return `${k.name} ${y - k.from}년`;
};

export function formatDate(t: number) {
  const y = yearOf(t);
  return `${reignLabel(y)} ${ganji(y)}년 ${monthName(monthOf(t))}`;
}

export const shortDate = (t: number) => `${yearOf(t)}.${String(monthOf(t)).padStart(2, '0')}`;
