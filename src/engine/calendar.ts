export const START_YEAR = 1575;
export const END_YEAR = 1600;
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
export const reignLabel = (y: number) => `선조 ${y - 1567}년`;

export function formatDate(t: number) {
  const y = yearOf(t);
  return `${reignLabel(y)} ${ganji(y)}년 ${monthName(monthOf(t))}`;
}

export const shortDate = (t: number) => `${yearOf(t)}.${String(monthOf(t)).padStart(2, '0')}`;
