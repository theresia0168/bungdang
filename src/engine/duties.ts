import type { GameState, RegionId } from './types';
import type { EventDef } from './events/types';
import { OFFICE_MAP } from './data/offices';
import { FACTION_META, REGION_META } from './data/meta';
import { chance, pick } from './rng';
import { addFlaw, alive, hiddenFlaws, inCourt, isP, josa, monthsSince, officeTitle, P, people, pushEvent } from './state';
import { opinion } from './opinion';
import { vacate } from './court';
import { HARVEST_LABEL, harvestOf, regionYield } from './regions';
import { choicesOf, resolveScene, type Scene } from './scenes';

/* ───────── 관직의 직무 사건 ─────────
 * 자리마다 가끔 결정할 일이 생긴다. 선택지의 수치는 scenes.ts가 힌트와 결과 문구로 풀어 쓴다.
 */

const isGamsa = (o: string) => o.startsWith('gamsa_');
const region = (s: GameState) => P(s).location as RegionId;
const rname = (s: GameState) => REGION_META[region(s)].short;
const skimOf = (s: GameState) => Math.max(2, Math.round(regionYield(s, region(s)) * 0.45));
const localSuryeong = (s: GameState) => people(s).filter((c) => c.office === 'suryeong' && c.location === P(s).location && !isP(s, c));
const freshFlawOwners = (s: GameState) =>
  people(s).filter((c) => !isP(s, c) && inCourt(c) && hiddenFlaws(c).some((f) => !f.knownBy.includes(P(s).id) && !f.fake));

type Duty = Omit<Scene, 'when'> & { when(s: GameState, office: string): boolean };

const DUTIES: Duty[] = [
  {
    id: 'gamsa_famine',
    when: (s, o) => isGamsa(o) && harvestOf(s, region(s)) < 0,
    title: '흉년의 장계',
    text: (s) => `${rname(s)} 고을 곳곳에서 흉년이 들어 백성이 나무껍질을 벗겨 먹는다는 보고가 올라왔다. 감영 창고의 곡식을 풀면 당장은 살리겠지만, 조정의 허락 없이 열면 문책을 받을 수 있다.`,
    opts: () => [
      { key: 'open', label: '창고를 열어 진휼한다', fx: { say: '창고를 열어 굶주린 백성을 먹였다.', minsim: 8, prestige: 2, favor: -2 } },
      { key: 'report', label: '장계를 올리고 허락을 기다린다', fx: { say: '장계를 올렸다. 한 달 뒤에야 진휼하라는 명이 내려왔다.', minsim: 3, favor: 1 } },
      { key: 'hide', label: '대수롭지 않다고 덮어 둔다', fx: { say: '흉년을 덮고 진휼곡 일부를 챙겼다.', wealth: 10, minsim: -6, flaw: { label: '흉년 은폐', p: 0.3 } } },
    ],
  },
  {
    id: 'gamsa_bandit',
    when: (_s, o) => isGamsa(o),
    title: '도적떼',
    text: (s) => `${rname(s)} 산골에 도적떼가 들끓어 관아를 습격하기에 이르렀다. 굶주린 백성이 도적이 된 것이라는 말도 있다.`,
    opts: () => [
      { key: 'troops', label: '관군을 풀어 토벌한다', roll: { stat: 'politics', need: 7, ok: { say: '도적떼를 소탕했다.', prestige: 3, favor: 3 }, fail: { say: '관군이 산속에서 길을 잃고 돌아왔다.', prestige: -2 } } },
      { key: 'pardon', label: '죄를 묻지 않겠다며 회유한다', odds: { p: 0.5, yes: { say: '도적들이 무기를 내려놓고 고향으로 돌아갔다.', minsim: 4, prestige: 2 }, no: { say: '회유는 먹히지 않았고, 조정에서 나약하다는 말이 나왔다.', minsim: 4, favor: -3 } } },
      { key: 'ignore', label: '수령들에게 맡긴다', fx: { say: '수령들에게 맡겼다. 도적은 여전하다.', minsim: -4 } },
    ],
  },
  {
    id: 'gamsa_corrupt',
    when: (s, o) => isGamsa(o) && localSuryeong(s).length > 0,
    setup(s) {
      const c = pick(s, localSuryeong(s));
      return c ? { who: c.id } : null;
    },
    stale: (s, c) => (alive(s.chars[c.who]) && s.chars[c.who].office === 'suryeong' ? null : '그 수령은 이미 자리를 떠났다.'),
    title: '탐학한 수령',
    text: (s, c) => {
      const w = s.chars[c.who];
      return `순행 중에 ${FACTION_META[w.faction].name}의 수령 ${josa(w.name, '이/가')} 세곡을 부풀려 거두고 있다는 원성을 들었다.${w.faction === P(s).faction ? ' 같은 당 사람이다.' : ''}`;
    },
    opts: (s, c) => {
      const same = s.chars[c.who].faction === P(s).faction;
      return [
        {
          key: 'punish',
          label: '파직을 청하는 장계를 올린다',
          fx: {
            say: '탐학한 수령을 파직시켰다.',
            prestige: 3,
            minsim: 4,
            party: same ? -3 : 0,
            note: '그는 파직된다',
            run(s, c) {
              const w = s.chars[c.who];
              vacate(s, w);
              addFlaw(s, w, '탐학', true);
            },
          },
        },
        { key: 'cover', label: '눈감아 준다', fx: { say: '수령이 고개를 조아리며 예물을 보냈다.', wealth: 5, owe: true, flaw: { label: '비리 묵인', p: 0.3, whoKnows: true } } },
      ];
    },
  },
  {
    id: 'ijo_slate',
    when: (_s, o) => o === 'ijo' || o === 'jeonrang',
    title: '도목정사(都目政事)',
    text: () => '정기 인사를 앞두고 낙점 명단을 짜야 한다. 당신의 붓끝에 수십 명의 앞길이 달렸다.\n\n당의 원로들은 이번 기회에 우리 사람을 요직에 심으라고 하고, 왕은 고르게 쓰라고 한다.',
    opts: () => [
      {
        key: 'own',
        label: '우리 당 사람을 우선한다',
        fx: {
          say: '명단을 우리 당 사람들로 채웠다.',
          party: 6,
          others: -6,
          tension: 3,
          lean: -6,
          note: '6개월간 같은 당 인사 점수 +3',
          run(s) {
            s.flags.ijoBias = P(s).faction;
            s.flags.ijoBiasUntil = s.t + 6;
          },
        },
      },
      { key: 'fair', label: '당색을 가리지 않고 고르게 안배한다', fx: { say: '당색을 가리지 않고 안배했다.', tension: -3, favor: 2, others: 3, party: -3 } },
      { key: 'merit', label: '오직 재능과 학식만 본다', fx: { say: '재능만 보고 뽑았다. 선비들이 수긍했다.', prestige: 2 } },
    ],
  },
  {
    id: 'byeongjo_muster',
    when: (_s, o) => o === 'byeongjo',
    title: '군적(軍籍) 정비',
    text: () => '군적이 엉망이다. 죽은 사람과 어린아이에게까지 군포를 매기는 백골징포·황구첨정이 판친다. 바로잡으려면 힘 있는 집안의 빠진 장정을 찾아내야 한다.',
    opts: () => [
      { key: 'strict', label: '엄하게 정비한다', fx: { say: '군적을 바로잡았다.', prep: 5, prestige: 1, party: -2, others: -2 } },
      { key: 'lenient', label: '억울한 백성만 덜어 준다', fx: { say: '억울한 백성의 군포를 덜어 주었다.', minsimAll: 1 } },
      { key: 'skim', label: '빠진 장정을 눈감아 주고 사례를 받는다', fx: { say: '권세가 자제들의 이름을 군적에서 빼 주고 사례를 받았다.', wealth: 15, flaw: { label: '군포 착복', p: 0.4 } } },
    ],
  },
  {
    id: 'hojo_budget',
    when: (_s, o) => o === 'hojo',
    title: '바닥난 국고',
    text: () => '호조의 창고가 바닥을 드러냈다. 궁궐의 씀씀이를 줄이자니 왕이 언짢아하고, 세를 더 거두자니 백성이 운다.',
    opts: () => [
      { key: 'cut', label: '궁궐 경비를 줄이자고 아뢴다', fx: { say: '궁궐 경비를 줄이자고 아뢰었다. 왕의 낯빛이 어두워졌다.', prestige: 3, favor: -3, mood: -8 } },
      { key: 'tax', label: '세를 더 거둔다', fx: { say: '세를 더 거두어 창고를 채웠다.', favor: 3, mood: 4, minsimAll: -2 } },
      { key: 'save', label: '아껴 쓰며 버틴다', fx: { say: '아껴 쓰며 버텼다.', favor: 1 } },
    ],
  },
  {
    id: 'hyeongjo_case',
    when: (_s, o) => o === 'hyeongjo',
    title: '억울한 옥사',
    text: () => '살인 혐의로 갇힌 자가 억울하다고 울부짖는다. 증거는 흐릿하다. 그런데 그 사건에 당신의 정적과 가까운 집안이 얽혀 있다는 말이 들린다.',
    opts: () => [
      { key: 'free', label: '의심스러우면 풀어 준다', fx: { say: '의심스러울 때는 벌하지 않는다며 풀어 주었다.', prestige: 2, minsim: 2, minsimAt: 'hanseong' } },
      { key: 'law', label: '법대로 처결한다', fx: { say: '법대로 처결했다.', favor: 1 } },
      {
        key: 'frame',
        label: '정적의 집안을 얽어 넣는다',
        odds: {
          p: 0.8,
          yes: { say: '정적의 집안을 옥사에 얽어 넣었다.', note: '정적의 가짜 흠결을 쥔다 (탄핵 +1)', run: (s) => frame(s) },
          no: { say: '정적의 집안을 얽어 넣으려다 들통났다.', prestige: -4, flaw: { label: '옥사 날조', p: 1, public: true }, run: (s) => frame(s) },
        },
      },
    ],
  },
  {
    id: 'samsa_inspect',
    when: (s, o) => !!OFFICE_MAP[o]?.samsa && freshFlawOwners(s).length > 0,
    setup(s) {
      const c = pick(s, freshFlawOwners(s));
      return c ? { who: c.id } : null;
    },
    stale: (s, c) => (hiddenFlaws(s.chars[c.who]).some((f) => !f.knownBy.includes(P(s).id) && !f.fake) ? null : '문서의 내용은 이미 아는 것이었다.'),
    title: '언관의 규찰',
    text: (s, c) => {
      const w = s.chars[c.who];
      return `사헌부 서리가 은밀히 문서를 내밀었다. ${officeTitle(w)} ${w.name}(${FACTION_META[w.faction].name})의 비행을 적은 것이다.`;
    },
    opts: () => [
      { key: 'keep', label: '탄핵 재료로 간직한다', fx: { say: '그의 비행을 쥐었다. 탄핵이나 협박에 쓸 수 있다.', note: '그의 숨은 흠결 하나를 쥔다', run: (s, c) => grab(s, c.who) } },
      { key: 'warn', label: '조용히 불러 경고한다', fx: { say: '그를 불러 넌지시 일렀다.', owe: true, note: '흠결을 쥔다. 그도 당신이 안다는 것을 안다', run: (s, c) => grab(s, c.who) } },
      { key: 'burn', label: '문서를 태운다', fx: { say: '문서를 태웠다. 그가 전해 듣고 고마워했다.', prestige: 1, who: { v: 6 } } },
    ],
  },
  {
    id: 'seungji_secret',
    when: (_s, o) => o === 'doseungji' || o === 'seungji1' || o === 'seungji2',
    title: '밀지(密旨)',
    text: (s) => {
      const p = P(s);
      return `왕이 좌우를 물리고 당신에게 밀지를 내렸다. ${p.faction !== 'none' ? `${FACTION_META[p.faction].name}의 요인들` : '조정 대신들'}이 사사로이 모이는 일을 살펴 보고하라는 것이다.`;
    },
    opts: () => [
      { key: 'obey', label: '받들어 보고한다', fx: { say: '밀지를 받들었다.', favor: 5, mood: 5, party: -4 } },
      {
        key: 'leak',
        label: '당에 몰래 알린다',
        odds: {
          p: 0.7,
          yes: { say: '당의 원로들에게 몰래 귀띔했다.', party: 6 },
          no: { say: '밀지를 당에 흘린 것이 들통났다!', party: 6, favor: -10, mood: -10, flaw: { label: '기밀 누설', p: 1, public: true } },
        },
      },
      { key: 'refuse', label: '신하를 감시하는 일은 옳지 않다고 아뢴다', fx: { say: '감시는 옳지 않다고 아뢰었다. 왕이 말없이 붓을 들었다.', prestige: 3, favor: -4 } },
    ],
  },
  {
    id: 'jeongseung_line',
    when: (_s, o) => OFFICE_MAP[o]?.rank === 1,
    title: '묘당의 방향',
    text: () => '빈청(賓廳)에 대신들이 모였다. 당신이 어떤 방향을 잡느냐에 따라 앞으로의 정국이 달라진다.',
    opts: () => [
      { key: 'peace', label: '양당을 고르게 아우른다', fx: { say: '양당을 아울렀다.', tension: -6, others: 4, party: -4 } },
      { key: 'party', label: '당론을 밀어붙인다', fx: { say: '당론을 밀어붙였다.', party: 6, tension: 5, lean: -8 } },
      { key: 'king', label: '왕의 뜻을 받든다', fx: { say: '왕의 뜻을 받들었다.', favor: 4, prestige: -1, mood: 5 } },
    ],
  },
  {
    id: 'exam_officer',
    when: (_s, o) => o === 'yejo' || o === 'daesaseong' || o === 'daejehak',
    title: '과거의 시관',
    text: () => '이번 과거의 시관(試官)을 맡게 되었다. 답안지를 가리는 손끝에 선비들의 앞날이 달렸다.',
    opts: () => [
      { key: 'fair', label: '공정하게 채점한다', fx: { say: '공정하게 채점했다.', prestige: 3 } },
      {
        key: 'bias',
        label: '같은 당 응시자를 눈여겨본다',
        fx: { say: '같은 당 응시자를 눈여겨보기로 했다.', party: 4, flaw: { label: '시관 편파', p: 0.25, public: true }, note: '다음 과거에서 같은 당 급제자가 늘어난다', run: (s) => void (s.flags.examBias = P(s).faction) },
      },
      {
        key: 'leak',
        label: '제자들에게 시제(試題)를 귀띔한다',
        disabled: (s) => (s.player.disciples + s.player.proteges.length > 0 ? undefined : '응시할 문인이나 제자가 없다'),
        fx: { say: '제자들에게 넌지시 시제를 일러 주었다.', flaw: { label: '시제 누설', p: 0.35 }, note: '다음 과거에서 문인과 제자의 급제 판정 +3', run: (s) => void (s.flags.examLeak = true) },
      },
    ],
  },
  {
    id: 'panyun_fire',
    when: (_s, o) => o === 'panyun',
    title: '도성의 큰불',
    text: () => '한밤중에 도성 저잣거리에 큰불이 났다. 초가 수백 채가 타고 이재민이 거리에 나앉았다.',
    opts: (s) => [
      { key: 'rush', label: '직접 나가 불길을 잡는다', fx: { say: '앞장서 불길을 잡았다.', prestige: 3, favor: 3, sick: P(s).vigor <= 2 ? 0.3 : 0.1 } },
      { key: 'relief', label: '사재를 털어 이재민을 돕는다', cost: 10, fx: { say: '사재를 털어 이재민을 도왔다.', minsim: 5, minsimAt: 'hanseong', prestige: 2 } },
      { key: 'delegate', label: '아전들에게 맡긴다', fx: { say: '아전들에게 맡겼다. 불은 새벽에야 꺼졌다.', favor: -1 } },
    ],
  },
  {
    id: 'suryeong_tax',
    when: (_s, o) => o === 'suryeong',
    title: '고을의 세곡',
    text: (s) =>
      `${rname(s)} 고을의 세곡을 거둘 때다. 아전들이 관례대로 웃돈을 얹어 거두자고 한다. 이 돈은 대개 수령의 주머니로 들어간다.\n\n(올해 ${rname(s)} 작황: ${HARVEST_LABEL[harvestOf(s, region(s))]})`,
    opts: (s) => [
      { key: 'honest', label: '정해진 만큼만 거둔다', fx: { say: '정해진 만큼만 거두었다. 고을 사람들이 송덕비 이야기를 꺼낸다.', minsim: 4, prestige: 1 } },
      { key: 'skim', label: '관례대로 거둔다', fx: { say: '관례대로 거두었다.', wealth: skimOf, minsim: harvestOf(s, region(s)) < 0 ? -4 : 0, flaw: { label: '탐학', p: 0.3 } } },
    ],
  },
];

/** 가장 미운 현직자에게 가짜 흠결을 씌운다 */
function frame(s: GameState): string {
  const p = P(s);
  const foe = people(s)
    .filter((c) => !isP(s, c) && c.status === 'active' && c.office && OFFICE_MAP[c.office])
    .sort((a, b) => opinion(s, a, p) - opinion(s, b, p))[0];
  if (!foe) return '얽어 넣을 만한 정적이 없었다.';
  addFlaw(s, foe, '옥사 연루', false, [p.id]).fake = true;
  return `${foe.name}의 약점을 쥐었다.`;
}

function grab(s: GameState, id: string): string {
  const f = hiddenFlaws(s.chars[id]).find((x) => !x.knownBy.includes(P(s).id) && !x.fake);
  if (!f) return '';
  f.knownBy.push(P(s).id);
  return `「${f.label}」 건이다.`;
}

const dutyOf = (id: string) => DUTIES.find((d) => d.id === id);

export function rollDuty(s: GameState) {
  const p = P(s);
  if (p.status !== 'active' || !p.office || s.pending.length >= 2) return;
  if (monthsSince(s, 'dutyAt') < 3) return;
  const keen = monthsSince(s, 'workAt') <= 1;
  if (!chance(s, keen ? 0.3 : 0.15)) return;
  const d = pick(s, DUTIES.filter((x) => x.when(s, p.office!)));
  if (!d) return;
  const ctx = d.setup ? d.setup(s) : {};
  if (!ctx) return;
  s.flags.dutyAt = s.t;
  pushEvent(s, 'duty', { ...ctx, sid: d.id });
}

export const DUTY_EVENTS: Record<string, EventDef> = {
  duty: {
    build(s, c) {
      const d = dutyOf(c.sid)!;
      return { title: `직무 — ${d.title}`, kind: 'court', text: d.text(s, c), choices: choicesOf(s, c, d) };
    },
    resolve(s, c, key) {
      const d = dutyOf(c.sid);
      if (!d) return;
      const p = P(s);
      if (p.status !== 'active' || !p.office || !d.when(s, p.office)) return '이미 그 자리를 떠났다.';
      return resolveScene(s, d, c, key, region(s));
    },
  },
};
