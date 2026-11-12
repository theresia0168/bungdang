import type { Character, FactionId, GameState, RegionId } from './types';
import { addPrep } from './realm';
import type { EventDef } from './events/types';
import { FACTION_META, REGION_META } from './data/meta';
import { OFFICE_MAP } from './data/offices';
import { tOf } from './calendar';
import { chance, pick, rand } from './rng';
import { monthsSince, alive, atSeat, clamp, inCourt, isP, josa, log, officeTitle, owe, P, people, pushEvent } from './state';
import { sway, swayFaction } from './opinion';
import { activeFactions, influence, powerShare } from './factions';
import { appoint, appointParts, eligible, holderOf, vacate } from './court';
import { recall } from './conflict';
import { isAbroad } from './actions';
import { fulfillAgainst } from './relations';
import { LAW_MAP, lawJosa, lawStance, setLaw } from './laws';

type Stance = Partial<Record<FactionId, number>>;
type Vote = 'yes' | 'no' | 'abstain';

interface AgendaDef {
  id: string;
  /** 저절로 오르지 않고, 누군가 상소를 올려야 오르는 쟁점 */
  manual?: boolean;
  from: [number, number];
  to: [number, number];
  /** 다시 오를 수 있는 간격(개월). 없으면 한 번뿐 */
  repeat?: number;
  weight?: number;
  prepare?(s: GameState): Record<string, any> | null;
  title: string;
  text(s: GameState, c: Record<string, any>): string;
  stance(s: GameState, c: Record<string, any>): Stance;
  /** 왕의 뜻: -1 반대 ~ 1 찬성 */
  king: number;
  /** 왕의 뜻이 사안마다 다를 때 */
  kingOf?(s: GameState, c: Record<string, any>): number;
  kingWeight?: number;
  /** 사림의 공론이 어느 쪽인가. 그쪽에 서면 명망이 오른다 */
  gongron?: 'yes' | 'no';
  yes(s: GameState, c: Record<string, any>): string;
  no(s: GameState, c: Record<string, any>): string;
  pass(s: GameState, c: Record<string, any>, vote: Vote | null): string;
  fail(s: GameState, c: Record<string, any>, vote: Vote | null): string;
}

const both = (s: GameState, dong: number, seo: number, nam = dong, buk = dong): Stance =>
  s.factions.dong.active ? { dong, seo } : { nam, buk, seo };

function allMinsim(s: GameState, v: number, only?: RegionId[]) {
  for (const r of Object.values(s.regions)) if (!only || only.includes(r.id)) r.minsim = clamp(r.minsim + v, 0, 100);
}

function jeonrangCandidates(s: GameState): Character[] | null {
  const o = OFFICE_MAP.jeonrang;
  const cur = holderOf(s, 'jeonrang');
  if (cur && cur.tenure < 12) return null;
  const pool = people(s)
    .filter((c) => !isP(s, c) && c.faction !== 'none' && eligible(s, c, o))
    .map((c) => [c, appointParts(s, c, o).reduce((a, x) => a + x.value, 0)] as const)
    .sort((a, b) => b[1] - a[1]);
  const a = pool[0]?.[0];
  if (!a) return null;
  const b = pool.find(([c]) => c.faction !== a.faction)?.[0];
  return b ? [a, b] : null;
}

export const AGENDAS: AgendaDef[] = [
  {
    id: 'jeonrang',
    from: [1575, 6],
    to: [1600, 12],
    repeat: 12,
    weight: 2,
    prepare(s) {
      const c = jeonrangCandidates(s);
      return c ? { a: c[0].id, b: c[1].id } : null;
    },
    title: '이조전랑의 후임',
    text(s, c) {
      const a = s.chars[c.a];
      const b = s.chars[c.b];
      return (
        '이조전랑 자리를 두고 공론이 갈렸다. 전랑은 삼사와 청요직의 인사를 쥐는 자리라, 누가 앉느냐에 따라 조정의 판이 바뀐다.\n\n' +
        `· ${a.name} (${FACTION_META[a.faction].name}, 정치력 ${a.politics} · 학식 ${a.learning})\n` +
        `· ${b.name} (${FACTION_META[b.faction].name}, 정치력 ${b.politics} · 학식 ${b.learning})`
      );
    },
    stance: (s, c) => ({ [s.chars[c.a].faction]: 1, [s.chars[c.b].faction]: -1 }),
    king: 0,
    yes: (s, c) => `${josa(s.chars[c.a].name, '을/를')} 민다`,
    no: (s, c) => `${josa(s.chars[c.b].name, '을/를')} 민다`,
    pass(s, c, vote) {
      const a = s.chars[c.a];
      if (!alive(a) || !inCourt(a)) return '';
      appoint(s, a, 'jeonrang');
      if (vote === 'yes') owe(s, a.id);
      return `${josa(a.name, '이/가')} 이조전랑이 되었다.${vote === 'yes' ? ' 그가 당신에게 신세를 졌다.' : ''}`;
    },
    fail(s, c, vote) {
      const b = s.chars[c.b];
      if (!alive(b) || !inCourt(b)) return '';
      appoint(s, b, 'jeonrang');
      if (vote === 'no') owe(s, b.id);
      return `${josa(b.name, '이/가')} 이조전랑이 되었다.${vote === 'no' ? ' 그가 당신에게 신세를 졌다.' : ''}`;
    },
  },
  {
    id: 'baek',
    from: [1579, 3],
    to: [1579, 12],
    title: '백인걸의 조제 상소',
    text: () =>
      '원로 백인걸이 동서의 화합을 청하는 상소를 올렸다. 그런데 동인 사이에서는 이이가 이 상소를 대신 지어 주었다는 말이 돈다. ' +
      '화합을 핑계로 서인을 감싸려는 술책이라는 것이다.',
    stance: (s) => both(s, -1, 1),
    king: 0.5,
    yes: () => '상소의 뜻을 받들자',
    no: () => '이이의 술책이라 비판한다',
    pass(s) {
      s.tension = clamp(s.tension - 6, 0, 100);
      return '왕이 백인걸의 상소를 칭찬했다. 동서의 날이 조금 무디어졌다.';
    },
    fail(s) {
      s.tension = clamp(s.tension + 4, 0, 100);
      return '동인이 상소의 배후를 물고 늘어졌다. 이이에 대한 동인의 의심이 깊어졌다.';
    },
  },
  {
    id: 'munmyo',
    from: [1576, 1],
    to: [1599, 12],
    weight: 0.8,
    title: '오현(五賢)의 문묘 종사',
    text: () =>
      '성균관 유생과 사림이 김굉필·정여창·조광조·이언적·이황 다섯 선현을 문묘에 모시자고 청한다. ' +
      '사림의 정통을 세우는 일이지만, 왕은 기묘년의 일을 꺼려 쉽게 허락하지 않으려 한다.',
    stance: (s) => (s.factions.dong.active ? { dong: 1, seo: 1 } : { nam: 1, buk: 1, seo: 1 }),
    king: -1,
    kingWeight: 1.6,
    gongron: 'yes',
    yes: () => '연명하여 거듭 청한다',
    no: () => '왕의 뜻을 따른다',
    pass: () => '왕이 마침내 오현의 문묘 종사를 허락했다. 사림이 감격했다.',
    fail: () => '왕은 끝내 윤허하지 않았다. 유생들이 권당(捲堂)하며 버틴다.',
  },
  {
    id: 'nitanggae',
    from: [1583, 2],
    to: [1583, 5],
    weight: 3,
    title: '니탕개의 난과 병조의 전결',
    text(s) {
      const b = holderOf(s, 'byeongjo');
      return (
        '함경도 경원에서 번호(藩胡) 니탕개가 난을 일으켰다. ' +
        `병조판서${b ? ` ${b.name}` : ''}가 급한 김에 왕의 재가를 기다리지 않고 군사와 군량을 움직였는데, 동인은 이를 권세를 멋대로 휘두른 것이라 문제 삼는다.`
      );
    },
    stance: (s) => both(s, -1, 1),
    king: 0.4,
    yes: () => '전시의 변통이었다고 감싼다',
    no: () => '전횡이라고 따진다',
    pass(s) {
      addPrep(s, 5);
      s.regions.hamgyeong.minsim = clamp(s.regions.hamgyeong.minsim + 5, 0, 100);
      return '신립이 이끄는 군사가 니탕개를 몰아냈다. 병조의 처결은 문제 삼지 않기로 했다.';
    },
    fail(s) {
      s.tension = clamp(s.tension + 6, 0, 100);
      return '난은 평정되었으나 병조의 전결을 두고 논란이 그치지 않는다. 동인의 공세가 거세졌다.';
    },
  },
  {
    id: 'sugun',
    from: [1587, 3],
    to: [1588, 12],
    title: '남해 방비',
    text: () =>
      '정해년에 왜구가 전라도 손죽도를 노략질하고 녹도 권관이 전사했다. 남쪽 바다의 수군을 정비해야 한다는 건의가 올라왔다. 다만 전라·경상의 백성이 그 짐을 져야 한다.',
    stance: (s) => both(s, 0.3, 0.5),
    king: 0.4,
    yes: () => '수군을 정비하자',
    no: () => '연해의 백성이 감당하지 못한다',
    pass(s) {
      addPrep(s, 6);
      allMinsim(s, -3, ['jeolla', 'gyeongsang']);
      for (const r of ['jeolla', 'gyeongsang'] as RegionId[]) s.regions[r].defense.navy = Math.min(3, s.regions[r].defense.navy + 1);
      return '전라·경상의 수영에 배를 더 짓게 했다. (두 도의 수군 +1)';
    },
    fail: () => '남해 방비는 수령들에게 맡겨졌다.',
  },
  {
    id: 'imhae',
    from: [1590, 1],
    to: [1600, 6],
    weight: 0.8,
    title: '왕자 궁노(宮奴)의 횡포',
    text: () =>
      '임해군 등 왕자들의 궁노가 민가의 땅을 빼앗고 사람을 때려 원성이 자자하다. 대간이 그 궁노들을 다스리자고 청한다. 왕은 자식 일에 언짢은 기색이다.',
    stance: (s) => (s.factions.dong.active ? { dong: 0.6, seo: 0.6 } : { nam: 0.6, buk: 0.6, seo: 0.6 }),
    king: -1,
    kingWeight: 1.4,
    gongron: 'yes',
    yes: () => '궁노를 엄히 다스리자',
    no: () => '왕실의 일이니 덮어 두자',
    pass(s) {
      allMinsim(s, 3, ['hanseong', 'gyeonggi']);
      return '왕이 마지못해 궁노 몇을 벌했다.';
    },
    fail: () => '왕은 대간의 청을 듣지 않았다. 궁노의 횡포는 여전하다.',
  },
  {
    id: 'ganghwa',
    from: [1593, 6],
    to: [1596, 6],
    weight: 2,
    title: '강화 협상',
    text: () =>
      '명과 일본 사이에 강화가 논의된다. 지친 나라를 살리려면 협상을 묵인해야 한다는 쪽과, 임금을 욕보인 원수와 화친할 수 없다는 쪽이 맞선다.',
    stance: () => ({ nam: 1, buk: -1, seo: -0.5, dong: 0 }),
    king: -0.3,
    yes: () => '강화를 묵인하자',
    no: () => '원수와 화친할 수 없다',
    pass(s, _c, vote) {
      if (vote === 'yes') s.flags.backedPeace = true;
      return '조정은 명의 강화 협상을 막지 않기로 했다. 척화하는 이들이 "주화오국"이라 수군댄다.';
    },
    fail(s) {
      s.tension = clamp(s.tension + 3, 0, 100);
      return '척화론이 조정을 덮었다. 그러나 명은 아랑곳없이 협상을 이어 간다.';
    },
  },
  {
    id: 'tamhak',
    from: [1575, 8],
    to: [1600, 10],
    repeat: 10,
    weight: 1.2,
    prepare(s) {
      const fresh = (c: Character) => c.flaws.find((f) => f.public && !f.aired && f.label !== '무고(誣告)');
      const pool = people(s).filter(
        (c) => !isP(s, c) && c.status === 'active' && c.office && c.faction !== 'none' && !!fresh(c) && monthsSince(s, `tamhak_${c.id}`) >= 36,
      );
      if (!pool.length) return null;
      const w = pick(s, pool);
      const f = fresh(w)!;
      // 한 번 조정에서 다룬 허물은 다시 쟁점으로 올리지 않는다
      f.aired = s.t;
      s.flags[`tamhak_${w.id}`] = s.t;
      return { who: w.id, flaw: f.label };
    },
    title: '탐학한 관원의 처분',
    text(s, c) {
      const w = s.chars[c.who];
      const label = c.flaw ?? w.flaws.find((x) => x.public)?.label ?? '비행';
      return `${officeTitle(w)} ${w.name}(${FACTION_META[w.faction].name})의 「${label}」 건이 조정에 알려졌다. 대간은 파직하자고 하고, 그와 같은 당은 사소한 허물이라며 감싼다.`;
    },
    stance(s, c) {
      const w = s.chars[c.who];
      const st: Stance = {};
      for (const f of activeFactions(s)) st[f] = f === w.faction ? -1 : 0.6;
      return st;
    },
    king: 0.2,
    gongron: 'yes',
    yes: (s, c) => `${josa(s.chars[c.who].name, '을/를')} 파직하자`,
    no: (s, c) => `${josa(s.chars[c.who].name, '을/를')} 감싼다`,
    pass(s, c, vote) {
      const w = s.chars[c.who];
      if (!alive(w) || w.status !== 'active') return '';
      vacate(s, w);
      if (vote === 'yes') sway(s, w, P(s).id, -12, '파직을 주장', { clan: 0.3, decay: 0.1 });
      return `${josa(w.name, '이/가')} 파직되었다.`;
    },
    fail(s, c, vote) {
      const w = s.chars[c.who];
      if (vote === 'no' && alive(w)) {
        owe(s, w.id);
        sway(s, w, P(s).id, 10, '감싸 줌', { decay: 0.1 });
        return `${josa(w.name, '은/는')} 자리를 지켰다. 그가 당신에게 신세를 졌다.`;
      }
      return `${josa(w.name, '은/는')} 자리를 지켰다.`;
    },
  },
  {
    id: 'amnesty',
    from: [1576, 1],
    to: [1600, 10],
    repeat: 18,
    prepare(s) {
      const ex = people(s).filter((c) => c.status === 'exiled' && !isP(s, c) && c.faction !== 'none');
      return ex.length >= 2 ? { who: ex.slice(0, 3).map((c) => c.id) } : null;
    },
    title: '사면 논의',
    text(s, c) {
      const names = (c.who as string[]).map((id) => `${s.chars[id].name}(${FACTION_META[s.chars[id].faction].name})`);
      return `가뭄이 이어지자 왕이 덕을 베풀어 유배된 이들을 풀어 주자는 논의가 일었다. 거론되는 이는 ${names.join(', ')} 등이다. 그들을 몰아낸 쪽은 펄쩍 뛴다.`;
    },
    stance(s, c) {
      const st: Stance = {};
      for (const f of activeFactions(s)) st[f] = -0.6;
      for (const id of c.who as string[]) st[s.chars[id].faction] = 1;
      return st;
    },
    king: 0.3,
    yes: () => '풀어 주자',
    no: () => '아직 이르다',
    pass(s, c, vote) {
      const freed: string[] = [];
      for (const id of c.who as string[]) {
        const x = s.chars[id];
        if (!alive(x) || x.status !== 'exiled') continue;
        recall(s, x);
        if (vote === 'yes') {
          owe(s, x.id);
          fulfillAgainst(s, 'recall', x.id);
        }
        freed.push(x.name);
      }
      return `${freed.join(', ')} 등이 유배에서 풀려났다.${vote === 'yes' && freed.length ? ' 그들이 당신에게 신세를 졌다.' : ''}`;
    },
    fail: () => '사면은 없던 일이 되었다.',
  },
  {
    id: 'construction',
    from: [1576, 1],
    to: [1591, 12],
    repeat: 36,
    weight: 0.6,
    title: '왕릉 수축과 백성의 부역',
    text: () => '왕이 선왕의 능을 고치고 정자를 새로 짓는 공역을 일으키려 한다. 흉년 끝이라 백성을 부역에 끌어내는 것이 옳으냐는 말이 나온다.',
    stance: (s) => (s.factions.dong.active ? { dong: -0.5, seo: -0.5 } : { nam: -0.5, buk: -0.5, seo: -0.5 }),
    king: 1,
    kingWeight: 0.9,
    gongron: 'no',
    yes: () => '효를 다하는 일이니 받든다',
    no: () => '백성을 쉬게 하소서',
    pass(s) {
      allMinsim(s, -4, ['gyeonggi', 'hanseong', 'chungcheong']);
      return '공역이 시작되었다. 경기의 백성들이 부역에 끌려 나갔다.';
    },
    fail: () => '왕이 언짢아하며 공역을 미루었다.',
  },
  {
    id: 'jinhyul',
    from: [1576, 1],
    to: [1600, 10],
    repeat: 30,
    weight: 0.7,
    prepare(s) {
      const low = Object.values(s.regions).filter((r) => r.minsim < 45);
      return low.length ? { region: pick(s, low).id } : null;
    },
    title: '기근과 공명첩',
    text: (_s, c) =>
      `${REGION_META[c.region as RegionId].name}에 기근이 들었다. 곡식을 바치는 이에게 이름만 있는 벼슬을 주는 공명첩(空名帖)을 팔아 구휼하자는 건의가 올랐다. 신분 질서를 어지럽힌다는 반대가 있다.`,
    stance: (s) => both(s, -0.3, 0.3, 0.3, -0.3),
    king: 0.5,
    yes: () => '공명첩으로 백성을 살리자',
    no: () => '벼슬을 팔 수는 없다',
    pass(s, c) {
      allMinsim(s, 10, [c.region]);
      return `${REGION_META[c.region as RegionId].short}에 구휼미가 풀렸다.`;
    },
    fail(s, c) {
      allMinsim(s, -3, [c.region]);
      return `${REGION_META[c.region as RegionId].short}의 굶주림은 고을 수령에게 맡겨졌다.`;
    },
  },
  {
    id: 'law_debate',
    manual: true,
    from: [1575, 1],
    to: [1600, 12],
    title: '변법 논의',
    text(s, c) {
      const l = LAW_MAP[c.lawId];
      const by = s.chars[c.by];
      return `${by ? `${FACTION_META[by.faction].name}의 ${josa(by.name, '이/가')} ` : ''}${lawJosa(l.name, '을/를')} ${c.abolish ? '없애자는' : '세우자는'} 상소를 올려 조정의 논의에 부쳐졌다.\n\n${l.desc}\n효과: ${l.effect}`;
    },
    stance(s, c) {
      const l = LAW_MAP[c.lawId];
      const st: Stance = {};
      for (const f of activeFactions(s)) st[f] = lawStance(l, f, !c.abolish);
      return st;
    },
    king: 0,
    kingOf: (_s, c) => (c.abolish ? -LAW_MAP[c.lawId].king : LAW_MAP[c.lawId].king),
    yes: (_s, c) => (c.abolish ? '없애자' : '세우자'),
    no: (_s, c) => (c.abolish ? '그대로 두자' : '아직 이르다'),
    pass(s, c) {
      const l = LAW_MAP[c.lawId];
      setLaw(s, l.id, !c.abolish, s.chars[c.by]?.name);
      if (l.id === 'sumi' || l.id === 'daedong' || l.id === 'nobi')
        for (const x of people(s)) if (x.traits.includes('greedy') && x.status === 'active' && !isP(s, x)) sway(s, x, P(s).id, -3, '이권을 막음', { decay: 0.1 });
      return `${lawJosa(l.name, '이/가')} ${c.abolish ? '폐지되었다' : '시행되었다'}.`;
    },
    fail: (_s, c) => `${LAW_MAP[c.lawId].name} 논의는 부결되었다.`,
  },
];

const AGENDA_MAP = Object.fromEntries(AGENDAS.map((a) => [a.id, a]));


const STRENGTH = (v: number) => (Math.abs(v) >= 0.8 ? '강하게 ' : Math.abs(v) >= 0.4 ? '' : '다소 ');
const sideWord = (v: number) => (v > 0 ? '찬성' : v < 0 ? '반대' : '관망');

export function stanceLines(s: GameState, def: AgendaDef, c: Record<string, any>): string {
  const st = def.stance(s, c);
  const kingV = def.kingOf?.(s, c) ?? def.king;
  const lines = activeFactions(s)
    .filter((f) => st[f] !== undefined)
    .map((f) => `${FACTION_META[f].name} ${STRENGTH(st[f]!)}${sideWord(st[f]!)}`);
  const k = kingV ? `왕은 ${STRENGTH(kingV)}${sideWord(kingV)}에 기울었다` : '왕은 뜻을 드러내지 않는다';
  return `${lines.join(' · ')}\n${k}`;
}

/** 조정의 힘, 왕의 뜻, 플레이어의 한 표로 가부가 정해진다 */
function tally(s: GameState, def: AgendaDef, c: Record<string, any>, vote: Vote | null): number {
  const st = def.stance(s, c);
  const share = powerShare(s);
  let score = 0;
  for (const f of activeFactions(s)) score += (share[f] ?? 0) * (st[f] ?? 0);
  score += (def.kingOf?.(s, c) ?? def.king) * (def.kingWeight ?? 0.35);
  if (vote && vote !== 'abstain') {
    const w = 0.08 + influence(s, P(s)) / 150;
    score += vote === 'yes' ? w : -w;
  }
  return score + (rand(s) - 0.5) * 0.16;
}

function applyVote(s: GameState, def: AgendaDef, c: Record<string, any>, vote: Vote): string[] {
  const p = P(s);
  const st = def.stance(s, c);
  const fx: string[] = [];
  if (vote === 'abstain') {
    if (p.faction !== 'none' && !p.traits.includes('mediator') && Math.abs(st[p.faction] ?? 0) >= 0.5) {
      fx.push(swayFaction(s, p.faction, p.id, -2, '미온적', 0.1));
    }
    return fx.filter(Boolean);
  }
  const sign = vote === 'yes' ? 1 : -1;
  for (const f of activeFactions(s)) {
    const v = st[f] ?? 0;
    if (!v) continue;
    const own = f === p.faction;
    const agree = Math.sign(v) === sign;
    const mag = Math.round(3 * Math.abs(v)) + (own ? (agree ? 2 : 5) : 0);
    fx.push(swayFaction(s, f, p.id, agree ? mag : -mag, agree ? '쟁점에서 한편' : '쟁점에서 맞섬', 0.1));
  }
  const ownSt = p.faction !== 'none' ? (st[p.faction] ?? 0) : 0;
  if (ownSt && Math.sign(ownSt) !== sign) {
    const d = p.traits.includes('upright') ? 2 : 1;
    p.prestige = clamp(p.prestige + d, 0, 100);
    fx.push(`소신 명망 +${d}`);
  }
  const kingV = def.kingOf?.(s, c) ?? def.king;
  if (kingV) {
    const agree = Math.sign(kingV) === sign;
    const d = Math.max(1, Math.round(4 * Math.abs(kingV)));
    p.favor = clamp(p.favor + (agree ? d : -d), -100, 100);
    fx.push(`성심 ${agree ? '+' : '-'}${d}`);
  }
  if (def.gongron) {
    const agree = def.gongron === vote;
    const d = agree ? 3 : -3;
    p.prestige = clamp(p.prestige + d, 0, 100);
    fx.push(`공론 명망 ${d > 0 ? '+' : ''}${d}`);
  }
  return fx.filter(Boolean);
}

function decide(s: GameState, def: AgendaDef, c: Record<string, any>, vote: Vote | null): { passed: boolean; text: string } {
  const passed = tally(s, def, c, vote) > 0;
  const text = passed ? def.pass(s, c, vote) : def.fail(s, c, vote);
  log(s, `[조정 쟁점] ${def.title} — ${passed ? '가결' : '부결'}. ${text}`, vote && vote !== 'abstain' ? 'player' : 'court');
  return { passed, text };
}

export function rollAgenda(s: GameState) {
  if (monthsSince(s, 'lastAgenda') < 3 || !chance(s, 0.6)) return;
  const pool: [AgendaDef, number][] = [];
  for (const a of AGENDAS) {
    if (s.t < tOf(a.from[0], a.from[1]) || s.t > tOf(a.to[0], a.to[1])) continue;
    const prev = s.flags[`ag_${a.id}`];
    if (typeof prev === 'number' && (!a.repeat || s.t - prev < a.repeat)) continue;
    if (a.manual) continue;
    pool.push([a, a.weight ?? 1]);
  }
  if (!pool.length) return;
  let r = rand(s) * pool.reduce((x, [, w]) => x + w, 0);
  let def = pool[0][0];
  for (const [a, w] of pool) {
    r -= w;
    if (r <= 0) {
      def = a;
      break;
    }
  }
  const ctx = def.prepare ? def.prepare(s) : {};
  if (!ctx) return;
  s.flags.lastAgenda = s.t;
  s.flags[`ag_${def.id}`] = s.t;
  const p = P(s);
  if (inCourt(p) && atSeat(s, p) && !isAbroad(s) && alive(p)) pushEvent(s, 'agenda', { ...ctx, agenda: def.id });
  else decide(s, def, ctx, null);
}

export const AGENDA_EVENTS: Record<string, EventDef> = {
  agenda: {
    build(s, c) {
      const def = AGENDA_MAP[c.agenda];
      return {
        title: `조정 쟁점: ${def.title}`,
        kind: 'court',
        text:
          `${def.text(s, c)}\n\n${stanceLines(s, def, c)}\n\n` +
          '당신의 입장은 각 당과 왕의 마음에 남는다. 가부는 조정의 세력, 왕의 뜻, 당신의 영향력으로 정해진다.' +
          (def.gongron ? ' 사림의 공론이 걸린 일이라 명망도 오르내린다.' : ''),
        choices: [
          { key: 'yes', label: def.yes(s, c) },
          { key: 'no', label: def.no(s, c) },
          { key: 'abstain', label: '입을 다문다', hint: '아무 편도 들지 않는다. 당론이 분명한 일이면 미온적이라는 말을 듣는다.' },
        ],
      };
    },
    resolve(s, c, key) {
      const def = AGENDA_MAP[c.agenda];
      const vote = key as Vote;
      const fx = applyVote(s, def, c, vote);
      const r = decide(s, def, c, vote);
      return `${def.title} — ${r.passed ? '가결' : '부결'}. ${r.text}${fx.length ? ` (${fx.join(', ')})` : ''}`;
    },
  },
};

/** 변법 상소가 올라오면 조정의 표결에 부친다. 플레이어가 조정에 없으면 그대로 결판난다. */
export function openLawDebate(s: GameState, by: string, lawId: string, abolish: boolean) {
  const ctx = { agenda: 'law_debate', lawId, abolish, by };
  const p = P(s);
  if (inCourt(p) && atSeat(s, p) && !isAbroad(s) && alive(p) && p.id !== by) pushEvent(s, 'agenda', ctx);
  else decide(s, AGENDA_MAP.law_debate, ctx, null);
}
