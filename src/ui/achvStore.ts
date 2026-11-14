/** 판을 넘어 모은 업적 (이 브라우저에만 남는다) */
const KEY = 'joseon-bungdang/achv/v1';

export function loadAchv(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function mergeAchv(ids: string[] | undefined) {
  if (!ids?.length) return;
  try {
    const all = new Set(loadAchv());
    const n = all.size;
    for (const id of ids) all.add(id);
    if (all.size !== n) localStorage.setItem(KEY, JSON.stringify([...all]));
  } catch {
    /* 저장이 막혀 있으면 이 판에서만 보인다 */
  }
}
