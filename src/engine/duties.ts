import type { Character, GameState, RegionId } from './types';
import type { Choice, EventDef } from './events/types';
import { OFFICE_MAP } from './data/offices';
import { FACTION_META, REGION_META } from './data/meta';
import { chance, d6, pick } from './rng';
import { addFlaw, alive, clamp, hiddenFlaws, inCourt, isP, josa, officeTitle, owe, P, people, pushEvent } from './state';
import { opinion, sway, swayFaction, topOf } from './opinion';
import { activeFactions } from './factions';
import { vacate } from './court';
import { kingMood } from './king';
import { HARVEST_LABEL, harvestOf, regionYield } from './regions';

interface Duty {
  id: string;
  when(s: GameState, office: string): boolean;
  title: string;
  text(s: GameState, ctx: Record<string, any>): string;
  choices(s: GameState, ctx: Record<string, any>): Choice[];
  setup?(s: GameState): Record<string, any> | null;
  resolve(s: GameState, key: string, ctx: Record<string, any>): string;
}

const isGamsa = (o: string) => o.startsWith('gamsa_');
const region = (s: GameState) => P(s).location as RegionId;
const rname = (s: GameState) => REGION_META[region(s)].short;
const minsim = (s: GameState, r: RegionId, v: number) => {
  s.regions[r].minsim = clamp(s.regions[r].minsim + v, 0, 100);
};
const pres = (c: Character, v: number) => {
  c.prestige = clamp(c.prestige + v, 0, 100);
};
const fav = (c: Character, v: number) => {
  c.favor = clamp(c.favor + v, -100, 100);
};
const party = (s: GameState, v: number, label: string) => {
  const p = P(s);
  if (p.faction === 'none') return '';
  const fx = swayFaction(s, p.faction, p.id, v, label, 0.1);
  return fx ? `, ${fx}` : '';
};
const others = (s: GameState, v: number, label: string) => {
  const p = P(s);
  for (const f of activeFactions(s)) if (f !== p.faction && topOf(f) !== topOf(p.faction)) swayFaction(s, f, p.id, v, label, 0.1);
};
const skimOf = (s: GameState) => Math.max(2, Math.round(regionYield(s, region(s)) * 0.45));
const roll = (s: GameState, stat: number, need: number) => {
  const r = d6(s) + stat;
  return [r >= need, r] as const;
};

const DUTIES: Duty[] = [
  {
    id: 'gamsa_famine',
    when: (s, o) => isGamsa(o) && harvestOf(s, region(s)) < 0,
    title: '흉년의 장계',
    text: (s) => `${rname(s)} 고을 곳곳에서 흉년이 들어 백성이 나무껍질을 벗겨 먹는다는 보고가 올라왔다. 감영 창고의 곡식을 풀면 당장은 살리겠지만, 조정의 허락 없이 열면 문책을 받을 수 있다.`,
    choices: () => [
      { key: 'open', label: '창고를 열어 진휼한다', hint: '민심 +8, 명망 +2. 성심 -2 (독단).' },
      { key: 'report', label: '장계를 올리고 허락을 기다린다', hint: '민심 +3, 성심 +1' },
      { key: 'hide', label: '대수롭지 않다고 덮어 둔다', hint: '재산 +10, 민심 -6. 30% 확률로 「흉년 은폐」 흠결.' },
    ],
    resolve(s, key) {
      const p = P(s);
      const r = region(s);
      if (key === 'open') {
        minsim(s, r, 8);
        pres(p, 2);
        fav(p, -2);
        return `창고를 열어 굶주린 백성을 먹였다. (${rname(s)} 민심 +8, 명망 +2, 성심 -2)`;
      }
      if (key === 'report') {
        minsim(s, r, 3);
        fav(p, 1);
        return '장계를 올렸다. 한 달 뒤에야 진휼하라는 명이 내려왔다. (민심 +3, 성심 +1)';
      }
      p.wealth += 10;
      minsim(s, r, -6);
      if (chance(s, 0.3)) addFlaw(s, p, '흉년 은폐', false);
      return `흉년을 덮고 진휼곡 일부를 챙겼다. (재산 +10, ${rname(s)} 민심 -6)`;
    },
  },
  {
    id: 'gamsa_bandit',
    when: (_s, o) => isGamsa(o),
    title: '도적떼',
    text: (s) => `${rname(s)} 산골에 도적떼가 들끓어 관아를 습격하기에 이르렀다. 굶주린 백성이 도적이 된 것이라는 말도 있다.`,
    choices: (s) => [
      { key: 'troops', label: '관군을 풀어 토벌한다', hint: `정치력 판정 (주사위 + ${P(s).politics} ≥ 7). 성공하면 명망 +3, 성심 +3. 실패하면 명망 -2.` },
      { key: 'pardon', label: '죄를 묻지 않겠다며 회유한다', hint: '민심 +4. 절반 확률로 명망 +2, 아니면 성심 -3.' },
      { key: 'ignore', label: '수령들에게 맡긴다', hint: '민심 -4' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'troops') {
        const [ok, r] = roll(s, p.politics, 7);
        if (ok) {
          pres(p, 3);
          fav(p, 3);
          return `도적떼를 소탕했다. (판정 ${r}, 명망 +3, 성심 +3)`;
        }
        pres(p, -2);
        return `관군이 산속에서 길을 잃고 돌아왔다. (판정 ${r}, 명망 -2)`;
      }
      if (key === 'pardon') {
        minsim(s, region(s), 4);
        if (chance(s, 0.5)) {
          pres(p, 2);
          return '도적들이 무기를 내려놓고 고향으로 돌아갔다. (민심 +4, 명망 +2)';
        }
        fav(p, -3);
        return '회유는 먹히지 않았고, 조정에서 나약하다는 말이 나왔다. (민심 +4, 성심 -3)';
      }
      minsim(s, region(s), -4);
      return '수령들에게 맡겼다. 도적은 여전하다. (민심 -4)';
    },
  },
  {
    id: 'gamsa_corrupt',
    when: (s, o) => isGamsa(o) && people(s).some((c) => c.office === 'suryeong' && c.location === P(s).location && !isP(s, c)),
    setup(s) {
      const pool = people(s).filter((c) => c.office === 'suryeong' && c.location === P(s).location && !isP(s, c));
      const c = pick(s, pool);
      return c ? { who: c.id } : null;
    },
    title: '탐학한 수령',
    text: (s, c) => {
      const w = s.chars[c.who];
      return `순행 중에 ${FACTION_META[w.faction].name}의 수령 ${josa(w.name, '이/가')} 세곡을 부풀려 거두고 있다는 원성을 들었다.${w.faction === P(s).faction ? ' 같은 당 사람이다.' : ''}`;
    },
    choices: (s, c) => {
      const w = s.chars[c.who];
      return [
        { key: 'punish', label: '파직을 청하는 장계를 올린다', hint: `${w.name} 파직, 명망 +3, 민심 +4.${w.faction === P(s).faction ? ' 같은 당 호감 -3.' : ''}` },
        { key: 'cover', label: '눈감아 준다', hint: `${w.name}이 신세를 지고 재산 +5. 30% 확률로 「비리 묵인」 흠결(그가 앎).` },
      ];
    },
    resolve(s, key, c) {
      const p = P(s);
      const w = s.chars[c.who];
      if (!alive(w) || w.office !== 'suryeong') return '그 수령은 이미 자리를 떠났다.';
      if (key === 'punish') {
        vacate(s, w);
        addFlaw(s, w, '탐학', true);
        pres(p, 3);
        minsim(s, region(s), 4);
        const fx = w.faction === p.faction ? party(s, -3, '동당 수령을 내침') : '';
        return `${josa(w.name, '을/를')} 파직시켰다. (명망 +3, 민심 +4${fx})`;
      }
      owe(s, w.id);
      p.wealth += 5;
      if (chance(s, 0.3)) addFlaw(s, p, '비리 묵인', false, [w.id]);
      return `${josa(w.name, '은/는')} 고개를 조아리며 예물을 보냈다. 그가 신세를 졌다. (재산 +5)`;
    },
  },
  {
    id: 'ijo_slate',
    when: (_s, o) => o === 'ijo' || o === 'jeonrang',
    title: '도목정사(都目政事)',
    text: () => '정기 인사를 앞두고 낙점 명단을 짜야 한다. 당신의 붓끝에 수십 명의 앞길이 달렸다.\n\n당의 원로들은 이번 기회에 우리 사람을 요직에 심으라고 하고, 왕은 고르게 쓰라고 한다.',
    choices: () => [
      { key: 'own', label: '우리 당 사람을 우선한다', hint: '6개월간 같은 당 인사 점수 +3, 같은 당 호감 +6. 다른 당 호감 -6, 긴장 +3, 왕의 경계 +6.' },
      { key: 'fair', label: '당색을 가리지 않고 고르게 안배한다', hint: '긴장 -3, 성심 +2, 같은 당 호감 -3.' },
      { key: 'merit', label: '오직 재능과 학식만 본다', hint: '명망 +2' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'own') {
        s.flags.ijoBias = p.faction;
        s.flags.ijoBiasUntil = s.t + 6;
        others(s, -6, '편파 인사');
        s.tension = clamp(s.tension + 3, 0, 100);
        if (p.faction !== 'none') s.king.wary[p.faction] = (s.king.wary[p.faction] ?? 0) + 6;
        return `명단을 우리 당 사람들로 채웠다. (긴장 +3${party(s, 6, '당을 챙김')})`;
      }
      if (key === 'fair') {
        s.tension = clamp(s.tension - 3, 0, 100);
        fav(p, 2);
        others(s, 3, '공정한 인사');
        return `당색을 가리지 않고 안배했다. (긴장 -3, 성심 +2${party(s, -3, '당을 외면')})`;
      }
      pres(p, 2);
      return '재능만 보고 뽑았다. 뒷말이 없지는 않았지만, 선비들이 수긍했다. (명망 +2)';
    },
  },
  {
    id: 'byeongjo_muster',
    when: (_s, o) => o === 'byeongjo',
    title: '군적(軍籍) 정비',
    text: () => '군적이 엉망이다. 죽은 사람과 어린아이에게까지 군포를 매기는 백골징포·황구첨정이 판친다. 바로잡으려면 힘 있는 집안의 빠진 장정을 찾아내야 한다.',
    choices: () => [
      { key: 'strict', label: '엄하게 정비한다', hint: '국방 대비 +5, 명망 +1, 권세가의 호감 하락.' },
      { key: 'lenient', label: '억울한 백성만 덜어 준다', hint: '모든 도 민심 +1' },
      { key: 'skim', label: '빠진 장정을 눈감아 주고 사례를 받는다', hint: '재산 +15. 40% 확률로 「군포 착복」 흠결.' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'strict') {
        s.war.preparedness = clamp(s.war.preparedness + 5, 0, 100);
        pres(p, 1);
        others(s, -2, '군적을 들춤');
        return `군적을 바로잡았다. (국방 대비 +5, 명망 +1${party(s, -2, '권문의 반발')})`;
      }
      if (key === 'lenient') {
        for (const r of Object.keys(s.regions) as RegionId[]) minsim(s, r, 1);
        return '억울한 백성의 군포를 덜어 주었다. (민심 +1)';
      }
      p.wealth += 15;
      if (chance(s, 0.4)) addFlaw(s, p, '군포 착복', false);
      return '권세가 자제들의 이름을 군적에서 빼 주고 사례를 받았다. (재산 +15)';
    },
  },
  {
    id: 'hojo_budget',
    when: (_s, o) => o === 'hojo',
    title: '바닥난 국고',
    text: () => '호조의 창고가 바닥을 드러냈다. 궁궐의 씀씀이를 줄이자니 왕이 언짢아하고, 세를 더 거두자니 백성이 운다.',
    choices: () => [
      { key: 'cut', label: '궁궐 경비를 줄이자고 아뢴다', hint: '명망 +3, 성심 -3, 용안이 어두워진다.' },
      { key: 'tax', label: '세를 더 거둔다', hint: '성심 +3, 용안이 밝아진다. 모든 도 민심 -2.' },
      { key: 'save', label: '아껴 쓰며 버틴다', hint: '성심 +1' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'cut') {
        pres(p, 3);
        fav(p, -3);
        kingMood(s, -8);
        return '궁궐 경비를 줄이자고 아뢰었다. 왕의 낯빛이 어두워졌다. (명망 +3, 성심 -3)';
      }
      if (key === 'tax') {
        fav(p, 3);
        kingMood(s, 4);
        for (const r of Object.keys(s.regions) as RegionId[]) minsim(s, r, -2);
        return '세를 더 거두어 창고를 채웠다. (성심 +3, 민심 -2)';
      }
      fav(p, 1);
      return '아껴 쓰며 버텼다. (성심 +1)';
    },
  },
  {
    id: 'hyeongjo_case',
    when: (_s, o) => o === 'hyeongjo',
    title: '억울한 옥사',
    text: () => '살인 혐의로 갇힌 자가 억울하다고 울부짖는다. 증거는 흐릿하다. 그런데 그 사건에 당신의 정적과 가까운 집안이 얽혀 있다는 말이 들린다.',
    choices: () => [
      { key: 'free', label: '의심스러우면 풀어 준다', hint: '명망 +2, 한성 민심 +2' },
      { key: 'law', label: '법대로 처결한다', hint: '성심 +1' },
      { key: 'frame', label: '정적의 집안을 얽어 넣는다', hint: '정적 하나의 가짜 흠결을 쥔다 (탄핵 +1). 20% 확률로 「옥사 날조」 흠결이 드러난다.' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'free') {
        pres(p, 2);
        minsim(s, 'hanseong', 2);
        return '의심스러울 때는 벌하지 않는다며 풀어 주었다. (명망 +2)';
      }
      if (key === 'law') {
        fav(p, 1);
        return '법대로 처결했다. (성심 +1)';
      }
      const foe = people(s)
        .filter((c) => !isP(s, c) && c.status === 'active' && c.office && OFFICE_MAP[c.office])
        .sort((a, b) => opinion(s, a, p) - opinion(s, b, p))[0];
      if (!foe) return '얽어 넣을 만한 정적이 없었다.';
      const f = addFlaw(s, foe, '옥사 연루', false, [p.id]);
      f.fake = true;
      if (chance(s, 0.2)) {
        addFlaw(s, p, '옥사 날조', true);
        pres(p, -4);
        return `${foe.name}의 집안을 얽어 넣으려다 들통났다. (흠결 공개, 명망 -4)`;
      }
      return `${foe.name}의 집안을 옥사에 얽어 넣었다. 탄핵할 때 쓸 수 있다.`;
    },
  },
  {
    id: 'samsa_inspect',
    when: (s, o) => !!OFFICE_MAP[o]?.samsa && people(s).some((c) => !isP(s, c) && inCourt(c) && hiddenFlaws(c).some((f) => !f.knownBy.includes(P(s).id) && !f.fake)),
    setup(s) {
      const p = P(s);
      const pool = people(s).filter((c) => !isP(s, c) && inCourt(c) && hiddenFlaws(c).some((f) => !f.knownBy.includes(p.id) && !f.fake));
      const c = pick(s, pool);
      return c ? { who: c.id } : null;
    },
    title: '언관의 규찰',
    text: (s, c) => {
      const w = s.chars[c.who];
      return `사헌부 서리가 은밀히 문서를 내밀었다. ${officeTitle(w)} ${w.name}(${FACTION_META[w.faction].name})의 비행을 적은 것이다.`;
    },
    choices: (s, c) => {
      const w = s.chars[c.who];
      return [
        { key: 'keep', label: '탄핵 재료로 간직한다', hint: `${w.name}의 숨은 흠결 하나를 쥔다.` },
        { key: 'warn', label: '조용히 불러 경고한다', hint: `흠결을 쥐되 ${w.name}이 신세를 진다. 그도 당신이 안다는 것을 안다.` },
        { key: 'burn', label: '문서를 태운다', hint: `명망 +1, ${w.name}의 호감 +6` },
      ];
    },
    resolve(s, key, c) {
      const p = P(s);
      const w = s.chars[c.who];
      const f = hiddenFlaws(w).find((x) => !x.knownBy.includes(p.id) && !x.fake);
      if (!f) return '문서의 내용은 이미 아는 것이었다.';
      if (key === 'burn') {
        pres(p, 1);
        sway(s, w, p.id, 6, '허물을 덮어 줌', { decay: 0.15 });
        return `문서를 태웠다. ${josa(w.name, '은/는')} 그 사실을 전해 듣고 고마워했다.`;
      }
      f.knownBy.push(p.id);
      if (key === 'warn') {
        owe(s, w.id);
        return `${josa(w.name, '을/를')} 불러 「${f.label}」 건을 넌지시 일렀다. 그가 신세를 졌다.`;
      }
      return `${w.name}의 「${f.label}」 건을 쥐었다. 탄핵이나 협박에 쓸 수 있다.`;
    },
  },
  {
    id: 'seungji_secret',
    when: (_s, o) => o === 'doseungji' || o === 'seungji1' || o === 'seungji2',
    title: '밀지(密旨)',
    text: (s) => {
      const p = P(s);
      return `왕이 좌우를 물리고 당신에게 밀지를 내렸다. ${p.faction !== 'none' ? `${FACTION_META[p.faction].name}의 요인들` : '조정 대신들'}이 사사로이 모이는 일을 살펴 보고하라는 것이다.`;
    },
    choices: () => [
      { key: 'obey', label: '받들어 보고한다', hint: '성심 +5, 용안이 밝아진다. 같은 당 호감 -4.' },
      { key: 'leak', label: '당에 몰래 알린다', hint: '같은 당 호감 +6. 30% 확률로 들통나 성심 -10, 「기밀 누설」 흠결.' },
      { key: 'refuse', label: '신하를 감시하는 일은 옳지 않다고 아뢴다', hint: '명망 +3, 성심 -4' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'obey') {
        fav(p, 5);
        kingMood(s, 5);
        return `밀지를 받들었다. (성심 +5${party(s, -4, '당을 엿봄')})`;
      }
      if (key === 'leak') {
        const fx = party(s, 6, '당을 지킴');
        if (chance(s, 0.3)) {
          fav(p, -10);
          addFlaw(s, p, '기밀 누설', true);
          kingMood(s, -10);
          return `밀지를 당에 흘린 것이 들통났다! (성심 -10, 흠결 공개${fx})`;
        }
        return `당의 원로들에게 몰래 귀띔했다.${fx ? ` (${fx.slice(2)})` : ''}`;
      }
      pres(p, 3);
      fav(p, -4);
      return '감시는 옳지 않다고 아뢰었다. 왕이 말없이 붓을 들었다. (명망 +3, 성심 -4)';
    },
  },
  {
    id: 'jeongseung_line',
    when: (_s, o) => OFFICE_MAP[o]?.rank === 1,
    title: '묘당의 방향',
    text: () => '빈청(賓廳)에 대신들이 모였다. 당신이 어떤 방향을 잡느냐에 따라 앞으로의 정국이 달라진다.',
    choices: () => [
      { key: 'peace', label: '양당을 고르게 아우른다', hint: '긴장 -6, 다른 당 호감 +4, 같은 당 호감 -4' },
      { key: 'party', label: '당론을 밀어붙인다', hint: '같은 당 호감 +6, 긴장 +5, 왕의 경계 +8' },
      { key: 'king', label: '왕의 뜻을 받든다', hint: '성심 +4, 용안이 밝아진다. 명망 -1' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'peace') {
        s.tension = clamp(s.tension - 6, 0, 100);
        others(s, 4, '아우르는 정승');
        return `양당을 아울렀다. (긴장 -6${party(s, -4, '당론을 흐림')})`;
      }
      if (key === 'party') {
        s.tension = clamp(s.tension + 5, 0, 100);
        if (p.faction !== 'none') s.king.wary[p.faction] = (s.king.wary[p.faction] ?? 0) + 8;
        return `당론을 밀어붙였다. (긴장 +5${party(s, 6, '당론을 세움')})`;
      }
      fav(p, 4);
      pres(p, -1);
      kingMood(s, 5);
      return '왕의 뜻을 받들었다. (성심 +4, 명망 -1)';
    },
  },
  {
    id: 'exam_officer',
    when: (_s, o) => o === 'yejo' || o === 'daesaseong' || o === 'daejehak',
    title: '과거의 시관',
    text: () => '이번 과거의 시관(試官)을 맡게 되었다. 답안지를 가리는 손끝에 선비들의 앞날이 달렸다.',
    choices: (s) => [
      { key: 'fair', label: '공정하게 채점한다', hint: '명망 +3' },
      { key: 'bias', label: '같은 당 응시자를 눈여겨본다', hint: '다음 과거에서 같은 당 급제자가 늘어난다. 같은 당 호감 +4. 25% 확률로 「시관 편파」 흠결이 드러난다.' },
      {
        key: 'leak',
        label: '제자들에게 시제(試題)를 귀띔한다',
        hint: '다음 과거에서 문인과 제자의 급제 판정 +3. 35% 확률로 「시제 누설」 흠결.',
        disabled: s.player.disciples + s.player.proteges.length > 0 ? undefined : '응시할 문인이나 제자가 없다',
      },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'fair') {
        pres(p, 3);
        return '공정하게 채점했다. (명망 +3)';
      }
      if (key === 'bias') {
        s.flags.examBias = p.faction;
        const fx = party(s, 4, '당의 선비를 챙김');
        if (chance(s, 0.25)) {
          addFlaw(s, p, '시관 편파', true);
          return `같은 당 응시자를 챙긴 것이 소문났다. (흠결 공개${fx})`;
        }
        return `같은 당 응시자를 눈여겨보기로 했다.${fx ? ` (${fx.slice(2)})` : ''}`;
      }
      s.flags.examLeak = true;
      if (chance(s, 0.35)) addFlaw(s, p, '시제 누설', false);
      return '제자들에게 넌지시 시제를 일러 주었다.';
    },
  },
  {
    id: 'panyun_fire',
    when: (_s, o) => o === 'panyun',
    title: '도성의 큰불',
    text: () => '한밤중에 도성 저잣거리에 큰불이 났다. 초가 수백 채가 타고 이재민이 거리에 나앉았다.',
    choices: (s) => [
      { key: 'rush', label: '직접 나가 불길을 잡는다', hint: `명망 +3, 성심 +3. ${P(s).vigor <= 2 ? '몸이 약해 30%' : '10%'} 확률로 병을 얻는다.` },
      { key: 'relief', label: '사재를 털어 이재민을 돕는다 (재산 10)', hint: '한성 민심 +5, 명망 +2', disabled: P(s).wealth < 10 ? '재산이 모자란다' : undefined },
      { key: 'delegate', label: '아전들에게 맡긴다', hint: '성심 -1' },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'rush') {
        pres(p, 3);
        fav(p, 3);
        if (chance(s, p.vigor <= 2 ? 0.3 : 0.1)) {
          s.player.sick = true;
          return '불길을 잡았지만 연기를 마시고 병을 얻었다. (명망 +3, 성심 +3, 병중)';
        }
        return '앞장서 불길을 잡았다. (명망 +3, 성심 +3)';
      }
      if (key === 'relief') {
        p.wealth -= 10;
        minsim(s, 'hanseong', 5);
        pres(p, 2);
        return '사재를 털어 이재민을 도왔다. (한성 민심 +5, 명망 +2)';
      }
      fav(p, -1);
      return '아전들에게 맡겼다. 불은 새벽에야 꺼졌다. (성심 -1)';
    },
  },
  {
    id: 'suryeong_tax',
    when: (_s, o) => o === 'suryeong',
    title: '고을의 세곡',
    text: (s) =>
      `${rname(s)} 고을의 세곡을 거둘 때다. 아전들이 관례대로 웃돈을 얹어 거두자고 한다. 이 돈은 대개 수령의 주머니로 들어간다.\n\n(올해 ${rname(s)} 작황: ${HARVEST_LABEL[harvestOf(s, region(s))]})`,
    choices: (s) => [
      { key: 'honest', label: '정해진 만큼만 거둔다', hint: '민심 +4, 명망 +1' },
      { key: 'skim', label: '관례대로 거둔다', hint: `재산 +${skimOf(s)}. 30% 확률로 「탐학」 흠결.${harvestOf(s, region(s)) < 0 ? ' 흉년이라 민심 -4.' : ''}` },
    ],
    resolve(s, key) {
      const p = P(s);
      if (key === 'honest') {
        minsim(s, region(s), 4);
        pres(p, 1);
        return '정해진 만큼만 거두었다. 고을 사람들이 송덕비 이야기를 꺼낸다. (민심 +4, 명망 +1)';
      }
      const v = skimOf(s);
      p.wealth += v;
      if (harvestOf(s, region(s)) < 0) minsim(s, region(s), -4);
      if (chance(s, 0.3)) addFlaw(s, p, '탐학', false);
      return `관례대로 거두었다. (재산 +${v})`;
    },
  },
];

const dutyOf = (id: string) => DUTIES.find((d) => d.id === id);

export function rollDuty(s: GameState) {
  const p = P(s);
  if (p.status !== 'active' || !p.office || s.pending.length >= 2) return;
  const at = typeof s.flags.dutyAt === 'number' ? s.flags.dutyAt : -99;
  if (s.t - at < 3) return;
  const keen = s.player.focus?.kind === 'duty';
  if (!chance(s, keen ? 0.3 : 0.15)) return;
  const pool = DUTIES.filter((d) => d.when(s, p.office!));
  const d = pick(s, pool);
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
      return { title: `직무 — ${d.title}`, kind: 'court', text: d.text(s, c), choices: d.choices(s, c) };
    },
    resolve(s, c, key) {
      const d = dutyOf(c.sid);
      if (!d) return;
      const p = P(s);
      if (p.status !== 'active' || !p.office || !d.when(s, p.office)) return '이미 그 자리를 떠났다.';
      return d.resolve(s, key, c);
    },
  },
};
