import { WAR_SCHEDULE } from './war';
import { addPrep } from '../realm';
import type { Character, GameState, RegionId } from '../types';
import type { Choice, EventDef } from './types';
import { OK } from './types';
import { ROSTER } from '../data/roster';
import { tOf } from '../calendar';
import { shortDate } from '../calendar';
import { chance, d6 } from '../rng';
import { addFlaw, alive, clamp, inCourt, isP, josa, log, notice, officeTitle, owe, P, people, pushEvent } from '../state';
import { OFFICE_MAP } from '../data/offices';
import { swayFaction, topOf } from '../opinion';
import { appoint, sendOut, vacate } from '../court';
import { exile, kill, purge, recall } from '../conflict';
import { caseById, openCase } from '../cases';
import { members } from '../factions';
import { fromRoster, leanOf } from '../generate';
import { endDebateByHistory, settleHeir } from '../royal';
import { decideWarPath, defenseScore, raceForKing } from '../realm';
import { kingMood } from '../king';
import { setLaw } from '../laws';
import { LATER_SCHEDULE } from '../later';

const live = (s: GameState, id: string): Character | undefined => (alive(s.chars[id]) ? s.chars[id] : undefined);
const pIs = (s: GameState, id: string) => s.player.charId === id;
const pTop = (s: GameState) => topOf(P(s).faction);

interface Scheduled {
  id: string;
  at: [number, number];
  window?: number;
  cond?: (s: GameState) => boolean;
  run: (s: GameState) => void;
}

function joinFaction(s: GameState, c: Character, f: 'dong' | 'seo') {
  if (f === 'dong' && !s.factions.dong.active) {
    c.lean = c.lean ?? leanOf(s, c.school);
    c.faction = c.lean;
  } else c.faction = f;
}

// ───────────────────────────── 을해당론 ─────────────────────────────

function eulhaeAftermath(s: GameState) {
  const kim = live(s, 'kim_hyowon');
  const sim = live(s, 'sim_uigyeom');
  if (kim && !isP(s, kim)) sendOut(s, kim, 'hamgyeong');
  if (sim && !isP(s, sim)) sendOut(s, sim, 'gyeonggi');
  log(s, '이이의 건의로 김효원은 함경도 부령 부사로, 심의겸은 개성 유수로 나갔다. 그러나 두 사람을 따르던 무리는 흩어지지 않았다.', 'history');
  if (s.flags.mediated && !pIs(s, 'kim_hyowon') && !pIs(s, 'sim_uigyeom')) {
    const p = P(s);
    p.prestige = clamp(p.prestige + 3, 0, 100);
    notice(s, '조제책', '두 사람을 외직으로 내보내자는 당신의 건의가 받아들여졌다. 명망 +3', 'court');
  }
}

// ───────────────────────────── 계미삼찬 ─────────────────────────────

const PANSEO = ['ijo', 'hojo', 'yejo', 'byeongjo', 'hyeongjo', 'gongjo'];
/** 지금 앉아 있거나 가장 최근에 지낸 판서 자리 */
function panseoOf(c: Character | undefined): string | undefined {
  if (!c) return undefined;
  if (c.office && PANSEO.includes(c.office)) return c.office;
  const left = Object.entries(c.leftOffices ?? {}).filter(([id]) => PANSEO.includes(id));
  left.sort((a, b) => b[1] - a[1]);
  return left[0]?.[0];
}
const PANSEO_ABUSE: Record<string, [string, string]> = {
  ijo: ['이조판서', '인사(人事)'],
  hojo: ['호조판서', '재정(財政)'],
  yejo: ['예조판서', '예정(禮政)'],
  byeongjo: ['병조판서', '병정(兵政)'],
  hyeongjo: ['형조판서', '형옥(刑獄)'],
  gongjo: ['공조판서', '공역(工役)'],
};

function gyemiOutcome(s: GameState, extra: string[] = []) {
  for (const id of ['song_eunggae', 'heo_bong', ...extra]) {
    const c = live(s, id);
    if (c && c.status !== 'exiled') exile(s, c, 'yi_i');
  }
  const yi = live(s, 'yi_i');
  if (yi && yi.faction === 'none' && !isP(s, yi)) yi.faction = 'seo';
  s.tension = clamp(s.tension + 10, 0, 100);
  log(s, '계미삼찬(癸未三竄): 병조판서 이이를 탄핵한 동인 송응개·허봉·박근원이 귀양 갔다. 이이는 서인으로 기울었다.', 'history');
}

// ───────────────────────────── 기축옥사 ─────────────────────────────

function gichukPurge(s: GameState, harsh: boolean, reroll: string[] = []) {
  const linked = people(s).filter(
    (c) =>
      c.tags.includes('jeong_link') ||
      c.teacher === 'jeong_yeorip' ||
      s.mods.some((m) => m.scope === 'char' && m.holder === 'jeong_yeorip' && m.about === c.id && m.value >= 15),
  );
  const extra = harsh
    ? people(s).filter((c) => topOf(c.faction) === 'dong' && (c.rank <= 3 || (c.home === 'jeolla' && c.rank <= 6)))
    : [];
  const targets = [...new Map([...linked, ...extra].map((c) => [c.id, c])).values()];
  const lines = purge(s, targets, linked.map((c) => c.id), reroll);
  const jl = s.regions.jeolla;
  jl.minsim = clamp(jl.minsim - 20, 0, 100);
  if (!jl.tags.includes('banyeok')) jl.tags.push('banyeok');
  s.tension = clamp(s.tension + (harsh ? 20 : 15), 0, 100);
  if (s.factions.dong.active) s.factions.dong.division += 10;
  for (const c of members(s, 'seo')) c.favor = clamp(c.favor + 5, -100, 100);
  s.flags.gichuk = true;
  const dead = lines.filter((l) => l.result === '사사').length;
  const ex = lines.filter((l) => l.result === '유배').length;
  log(s, `기축옥사: 정여립 모반 사건으로 ${dead}명이 죽고 ${ex}명이 유배되었다. 전라도는 반역향(反逆鄕)으로 낙인찍혔다.`, 'history');

  const p = P(s);
  const body = lines.length
    ? lines
        .map((l) => {
          const c = s.chars[l.id];
          const me = isP(s, c) ? ' ← 당신' : '';
          return `· ${c.name}: ${l.result}${l.roll ? ` (주사위 ${l.roll} + 정치력/2 ${Math.floor(c.politics / 2)} = ${l.roll + Math.floor(c.politics / 2)})` : ''}${me}`;
        })
        .join('\n')
    : '연루된 이가 많지 않았다.';
  if (alive(p))
    notice(
      s,
      '옥사의 결과',
      `${harsh ? '옥사는 크게 번졌다.' : '옥사는 연루자 위주로 다스려졌다.'}\n\n당상관과 연루자는 주사위 + 정치력/2로 판정한다. 2 이하면 사사, 5 이하면 유배, 6 이상이면 무사.\n\n${body}`,
      'danger',
    );
}

// ───────────────────────────── 건저의 ─────────────────────────────

function geonjeoOutcome(s: GameState, cheolFalls: boolean) {
  const cheol = live(s, 'jeong_cheol');
  if (cheolFalls && cheol && cheol.status !== 'exiled') {
    s.flags.cheolFell = true;
    exile(s, cheol, undefined, true);
    cheol.location = 'pyeongan';
    cheol.exilePlace = '강계';
    cheol.tags.push('royalWrath');
  }
  for (const c of members(s, 'seo')) {
    c.favor = clamp(c.favor - 10, -100, 100);
    if (!isP(s, c) && c.status === 'active' && c.rank <= 3 && chance(s, 0.35)) vacate(s, c);
  }
  if (s.factions.dong.active) s.factions.dong.division += 20;
  s.flags.splitReady = true;
  s.flags.geonjeo = true;
  s.tension = clamp(s.tension + 10, 0, 100);
  endDebateByHistory(s);
  if (s.royal.backing === 'gwanghae' && s.royal.backingPublic) {
    const p = P(s);
    p.favor = clamp(p.favor - 8, -100, 100);
    notice(s, '건저의의 여파', '광해군을 드러내 놓고 밀었던 당신도 왕의 눈 밖에 났다. (성심 -8)', 'danger');
  }
  log(
    s,
    cheolFalls
      ? '건저의(建儲議): 정철이 광해군을 세자로 세우자고 청했다가 왕의 노여움을 사 강계로 유배되었다. 서인이 조정에서 밀려났다.'
      : '건저의: 세자 책봉 논의가 흐지부지되었지만, 서인은 왕의 의심을 샀다.',
    'history',
  );
}

// ───────────────────────────── 전쟁 ─────────────────────────────

const WAR_ZONES_1592: RegionId[] = ['gyeongsang', 'chungcheong', 'gyeonggi', 'hanseong', 'gangwon', 'hwanghae', 'pyeongan', 'hamgyeong'];

function warLog(text: string, fx?: (s: GameState) => void) {
  return (s: GameState) => {
    log(s, text, 'war');
    fx?.(s);
  };
}

/** 「영의정 이산해」처럼 지금의 관직을 붙인 이름. 죽었으면 대신 쓸 말 */
function titled(s: GameState, id: string, fallback: string): string {
  const c = live(s, id);
  if (!c) return fallback;
  const t = officeTitle(c);
  return t && !t.startsWith('낭관') ? `${t} ${c.name}` : c.name;
}

/** 지금 삼사에 있는 동인 셋 (없으면 「동인 언관들이」) */
function dongSamsa(s: GameState): string {
  const xs = people(s).filter((c) => c.status === 'active' && c.office && OFFICE_MAP[c.office]?.samsa && topOf(c.faction) === 'dong' && !isP(s, c)).slice(0, 3);
  return xs.length ? josa(xs.map((c) => c.name).join('·'), '이/가') : '언관들이';
}

// ───────────────────────────── 일정 ─────────────────────────────

export const SCHEDULE: Scheduled[] = [
  { id: 'eulhae', at: [1575, 2], run: (s) => pushEvent(s, 'h_eulhae') },
  {
    id: 'eulhae_after',
    at: [1575, 9],
    cond: (s) => !!live(s, 'kim_hyowon') && !!live(s, 'sim_uigyeom'),
    run(s) {
      if (pIs(s, 'kim_hyowon') || pIs(s, 'sim_uigyeom')) pushEvent(s, 'h_eulhae_after');
      eulhaeAftermath(s);
    },
  },
  { id: 'gongbin', at: [1577, 5], run: warLogless('공빈 김씨가 세상을 떠났다. 왕의 총애가 인빈 김씨에게 옮겨 갔다.') },
  {
    id: 'nitanggae',
    at: [1583, 1],
    run: warLog('함경도 경원에서 번호(藩胡) 니탕개가 난을 일으켜 경원부를 함락시켰다.', (s) => {
      s.regions.hamgyeong.minsim = clamp(s.regions.hamgyeong.minsim - 10, 0, 100);
    }),
  },
  {
    id: 'seoik',
    at: [1585, 5],
    run: warLogless('의주 목사 서익이 상소하여 죽은 이이와 성혼을 변호하고, 스승을 배반한 정여립을 꾸짖었다. 동인이 크게 반발했다.'),
  },
  {
    id: 'jeonghae',
    at: [1587, 2],
    run: warLog('정해왜변: 왜구가 전라도 손죽도를 습격해 녹도 권관 이대원이 전사했다.', (s) => {
      addPrep(s, 3);
      s.regions.jeolla.minsim = clamp(s.regions.jeolla.minsim - 5, 0, 100);
    }),
  },
  {
    id: 'yejo_envoy',
    at: [1587, 9],
    run: warLogless('일본의 사신 귤강광이 와서 통신사를 보내 달라고 청했다. 조정은 "바닷길이 험하다"며 거절했다.'),
  },
  {
    id: 'iyi_side',
    at: [1582, 1],
    window: 12,
    cond: (s) => live(s, 'yi_i')?.faction === 'none',
    run(s) {
      if (pIs(s, 'yi_i')) pushEvent(s, 'h_iyi_side');
      else {
        s.chars.yi_i.faction = 'seo';
        log(s, '조제를 외치던 이이가 점차 서인과 뜻을 같이하게 되었다. 동인은 그를 서인으로 여기기 시작했다.', 'history');
      }
    },
  },
  {
    id: 'gyemi',
    at: [1583, 6],
    window: 6,
    // 판서를 지내며 그 권한을 휘두른 일이 있어야 탄핵거리가 된다
    cond: (s) => live(s, 'yi_i')?.status === 'active' && !!panseoOf(s.chars.yi_i),
    run(s) {
      const p = P(s);
      if (pIs(s, 'yi_i') || (inCourt(p) && (pTop(s) === 'dong' || p.faction === 'seo'))) pushEvent(s, 'h_gyemi');
      else gyemiOutcome(s);
    },
  },
  {
    id: 'jeong_turn',
    at: [1584, 1],
    window: 48,
    cond: (s) => s.chars.yi_i?.status === 'dead' && live(s, 'jeong_yeorip')?.faction === 'seo',
    run(s) {
      if (pIs(s, 'jeong_yeorip')) {
        pushEvent(s, 'h_jeong_turn');
        return;
      }
      const j = s.chars.jeong_yeorip;
      joinFaction(s, j, 'dong');
      if (j.office) vacate(s, j, 'retired');
      j.status = 'retired';
      j.location = 'jeolla';
      j.favor = clamp(j.favor - 20, -100, 100);
      log(s, '정여립이 죽은 스승 이이를 비판하며 동인에 가담했다. 왕이 이를 미워하자 그는 전라도 진안 죽도로 낙향했다.', 'history');
    },
  },
  {
    id: 'daedong',
    at: [1587, 2],
    window: 24,
    cond: (s) => {
      const j = live(s, 'jeong_yeorip');
      return !!j && topOf(j.faction) === 'dong' && (pIs(s, 'jeong_yeorip') || j.status === 'retired');
    },
    run(s) {
      if (pIs(s, 'jeong_yeorip')) {
        pushEvent(s, 'h_daedong');
        return;
      }
      s.flags.daedong = true;
      log(s, '정여립이 진안 죽도에서 대동계(大同契)를 조직했다. 정해년 왜구가 전라도를 노략질하자 대동계가 나서서 물리쳤다.', 'history');
    },
  },
  {
    id: 'gichuk',
    at: [1589, 10],
    cond: (s) => !!live(s, 'jeong_yeorip') && !!s.flags.daedong,
    run(s) {
      if (pIs(s, 'jeong_yeorip')) {
        pushEvent(s, 'h_gichuk_self');
        return;
      }
      kill(s, s.chars.jeong_yeorip, '모반 고변을 받고 죽도에서 스스로 목숨을 끊었다');
      log(s, '황해도 관찰사의 비밀 장계로 정여립의 모반이 고변되었다. 옥사가 시작되었다.', 'history');
      const cheol = live(s, 'jeong_cheol');
      if (cheol && cheol.status !== 'exiled' && !isP(s, cheol)) {
        appoint(s, cheol, 'uuijeong', true);
        log(s, '정철이 우의정으로서 옥사를 다스리는 위관(委官)을 맡았다.', 'history');
      }
      const p = P(s);
      if (pIs(s, 'jeong_cheol') || inCourt(p) || pTop(s) === 'dong') pushEvent(s, 'h_gichuk');
      else gichukPurge(s, !!cheol && cheol.faction === 'seo');
    },
  },
  {
    id: 'tongsinsa',
    at: [1590, 3],
    run: warLogless('황윤길을 정사, 김성일을 부사로 한 통신사가 일본으로 떠났다. 도요토미 히데요시의 속내를 살피기 위해서다.'),
  },
  {
    id: 'yisunsin',
    at: [1591, 2],
    run(s) {
      const ryu = live(s, 'yu_seongryong');
      addPrep(s, 8);
      log(s, ryu && inCourt(ryu) ? `${ryu.name}의 천거로 정읍 현감 이순신이 전라좌도 수군절도사가 되었다.` : '비변사의 천거로 정읍 현감 이순신이 전라좌도 수군절도사가 되었다.', 'history');
    },
  },
  {
    id: 'geonjeo',
    at: [1591, 2],
    window: 4,
    cond: (s) => {
      const c = live(s, 'jeong_cheol');
      return !!c && inCourt(c) && !s.heir;
    },
    run(s) {
      const p = P(s);
      if (pIs(s, 'jeong_cheol') || pIs(s, 'yi_sanhae') || (inCourt(p) && (p.faction === 'seo' || pTop(s) === 'dong'))) pushEvent(s, 'h_geonjeo');
      else geonjeoOutcome(s, true);
    },
  },
  {
    id: 'tongsinsa_report',
    at: [1591, 3],
    run(s) {
      if (inCourt(P(s))) pushEvent(s, 'h_tongsinsa_report');
      else courtWarDecision(s);
    },
  },
  {
    id: 'imjin',
    at: [1592, 4],
    run(s) {
      s.war.active = true;
      const { path, text: roll } = decideWarPath(s);
      const ready = roll;
      s.war.zones = path === 'held' ? ['gyeongsang', 'chungcheong'] : [...WAR_ZONES_1592];
      if (path === 'held')
        log(s, `임진왜란: 왜군 15만이 부산포에 상륙했다. 그러나 미리 쌓은 성과 조련한 군사가 고을마다 버티며 왜군의 발을 묶었다. (${ready})`, 'war');
      else if (path === 'rout')
        log(s, `임진왜란: 왜군 15만이 부산포에 상륙했다. 성은 허물어져 있고 군적은 빈 이름뿐이라, 왜군이 거의 싸움 없이 북상한다. (${ready})`, 'war');
      else log(s, `임진왜란: 왜군 15만이 부산포에 상륙했다. 부산진과 동래성이 하루 만에 무너졌다. (${ready})`, 'war');
      const gh = live(s, 'gwanghae');
      if (gh && !s.heir) {
        settleHeir(s, gh.id, 'war');
        log(s, '피란을 앞두고 광해군이 서둘러 세자로 책봉되었다.', 'history');
      } else if (s.heir && path !== 'held') log(s, `세자 ${josa(s.chars[s.heir].name, "이/가")} 피란길에 오른다.`, 'history');
      const cheol = live(s, 'jeong_cheol');
      if (cheol?.status === 'exiled') recall(s, cheol);
      for (const c of people(s)) if (c.status === 'exiled' && !isP(s, c) && chance(s, 0.3)) recall(s, c);
      const hit = path === 'rout' ? 35 : path === 'held' ? 15 : 25;
      for (const r of s.war.zones) s.regions[r].minsim = clamp(s.regions[r].minsim - hit, 0, 100);
      const p = P(s);
      if (s.war.zones.includes(p.home)) p.wealth = Math.round(p.wealth * (path === 'rout' ? 0.55 : 0.7));
      if (s.flags.warned) {
        p.prestige = clamp(p.prestige + 8, 0, 100);
        notice(s, '경고가 옳았다', '왜의 침략을 경고했던 당신의 말이 옳았음이 드러났다. 명망 +8', 'war');
      }
      pushEvent(s, 'h_imjin');
    },
  },
  {
    id: 'w1',
    at: [1592, 5],
    run(s) {
      if (s.realm.warPath === 'held') {
        log(s, '신립과 이일의 군사가 조령의 관문과 충주성을 지켜 냈다. 왜군은 고개를 넘지 못하고 경상도로 물러났다. 도성은 무사하다.', 'war');
        addPrep(s, 5);
        return;
      }
      log(s, '한성이 함락되었다. 왕은 평양으로 몽진했다. 성난 백성들이 궁궐에 불을 질렀다.', 'war');
      moveCourt(s, 'pyeongan');
    },
  },
  {
    id: 'w2',
    at: [1592, 6],
    run(s) {
      const path = s.realm.warPath;
      if (path === 'held') {
        log(s, '왜군이 경상도 남해안의 성에 틀어박혔다. 조정은 도성을 지키며 각 도의 근왕병을 모은다.', 'war');
        s.war.zones = ['gyeongsang'];
        return;
      }
      const race = raceForKing(s);
      if (race.caught) {
        s.flags.kingCaptive = true;
        kingMood(s, -40);
        log(s, `평양으로 가던 어가가 임진강가에서 왜군 선봉에 따라잡혔다. 왕이 사로잡혔다! ${s.heir && s.chars[s.heir] ? `세자 ${s.chars[s.heir].name}` : '대신들'}이 분조를 이끌고 나라를 지탱한다. (${race.text})`, 'war');
        splitCourt(s);
        for (const r of ['pyeongan', 'hwanghae'] as RegionId[]) s.regions[r].minsim = clamp(s.regions[r].minsim - 15, 0, 100);
        const p = P(s);
        if (inCourt(p) && p.status !== 'exiled' && chance(s, 0.25) && p.office) {
          notice(s, '사로잡힌 어가', '어가를 따르던 길에 왜군의 습격을 받았다. 겨우 목숨을 건졌으나 크게 다쳤다.', 'war');
          s.player.sick = true;
        }
        return;
      }
      log(s, `평양이 함락되었다. 어가는 왜군보다 한발 앞서 의주로 향했다. ${s.heir && s.chars[s.heir] ? `세자 ${josa(s.chars[s.heir].name, '은/는')}` : '대신들은'} 분조(分朝)를 이끌고 각지를 돌며 의병을 독려했다. (${race.text})`, 'war');
      splitCourt(s);
    },
  },
  { id: 'w3', at: [1592, 7], run: warLog('이순신이 한산도 앞바다에서 왜 수군을 크게 무찔렀다.') },
  { id: 'w4', at: [1592, 10], run: warLog('김시민이 진주성에서 왜군의 대공세를 막아냈다.') },
  {
    id: 'w5',
    at: [1592, 11],
    cond: (s) => !!live(s, 'sinseong'),
    run(s) {
      const c = s.chars.sinseong;
      log(s, s.realm.warPath === 'held' ? `${josa(c.name, '이/가')} 병으로 세상을 떠났다.` : `${josa(c.name, '이/가')} 피란길의 의주에서 병으로 죽었다.`, 'war');
      kill(s, c, '병으로 세상을 떠났다');
    },
  },
  { id: 'w6', at: [1592, 12], run: warLog('명나라 이여송이 4만 원군을 이끌고 압록강을 건넜다.') },
  {
    id: 'w7',
    at: [1593, 1],
    run(s) {
      if (s.realm.warPath === 'held') return log(s, '명나라 원군과 함께 남해안의 왜성을 에워쌌다.', 'war');
      mergeCourt(s);
      if (s.flags.kingCaptive) {
        delete s.flags.kingCaptive;
        kingMood(s, 20);
        return log(s, '조명 연합군이 평양성을 되찾았다. 왜군이 끌고 다니던 왕을 강화 협상의 볼모로 내놓고 물러났다. 왕이 반년 만에 풀려났다.', 'war');
      }
      log(s, '조명 연합군이 평양성을 되찾았다.', 'war');
    },
  },
  { id: 'napsok', at: [1593, 2], cond: (s) => P(s).status !== 'exiled' && P(s).wealth >= 20, run: (s) => pushEvent(s, 'h_napsok') },
  { id: 'w8', at: [1593, 2], cond: (s) => s.realm.warPath !== 'held', run: warLog('권율이 행주산성에서 왜군을 대파했다.') },
  {
    id: 'w9',
    at: [1593, 4],
    cond: (s) => s.realm.warPath !== 'held',
    run: warLog('왜군이 한성에서 물러나 남해안으로 내려갔다.', (s) => {
      s.war.zones = ['gyeongsang'];
    }),
  },
  { id: 'w10', at: [1593, 6], run: warLog('진주성이 다시 함락되어 성 안의 군민이 몰살당했다.') },
  { id: 'w11', at: [1593, 8], run: warLog('훈련도감을 설치해 포수·사수·살수의 삼수병을 기르기 시작했다.', (s) => setLaw(s, 'hullyeon', true)) },
  {
    id: 'w12',
    at: [1593, 10],
    cond: (s) => s.realm.warPath !== 'held',
    run: warLog('왕이 한성으로 돌아왔다. 궁궐이 모두 불타 월산대군의 옛집을 행궁으로 삼았다.', (s) => {
      moveCourt(s, 'hanseong');
      const p = P(s);
      if (s.flags.hojong && inCourt(p)) p.location = 'hanseong';
    }),
  },
  { id: 'w13', at: [1594, 3], run: warLog('명과 일본 사이에 강화 협상이 이어지고 있다. 조선은 협상에서 배제되었다.') },
  { id: 'w14', at: [1596, 9], run: warLog('강화 협상이 결렬되었다. 히데요시가 다시 군사를 일으키려 한다.') },
  {
    id: 'w15',
    at: [1597, 1],
    run: warLog('정유재란: 왜군이 다시 바다를 건너왔다.', (s) => {
      // 전라도가 단단히 지키면 호남이 짓밟히지 않는다
      const jl = defenseScore(s, 'jeolla');
      s.war.zones = jl >= 55 ? ['gyeongsang'] : ['gyeongsang', 'jeolla', 'chungcheong'];
      if (jl >= 55) log(s, '전라도의 성과 수영이 단단해 왜군이 호남으로 넘어오지 못했다.', 'war');
      for (const r of s.war.zones) s.regions[r].minsim = clamp(s.regions[r].minsim - 15, 0, 100);
    }),
  },
  { id: 'yisunsin_jail', at: [1597, 2], cond: (s) => inCourt(P(s)), run: (s) => pushEvent(s, 'h_yisunsin_jail') },
  {
    id: 'w16',
    at: [1597, 7],
    run: warLog('원균이 이끈 조선 수군이 칠천량에서 궤멸했다.', (s) => {
      if (s.flags.backed_won) {
        const p = P(s);
        p.prestige = clamp(p.prestige - 5, 0, 100);
        notice(s, '칠천량', '원균을 지지했던 당신에게 비난이 쏟아진다. 명망 -5', 'war');
      }
    }),
  },
  { id: 'w17', at: [1597, 9], run: warLog('다시 기용된 이순신이 명량에서 남은 배 열두 척으로 왜선 백여 척을 물리쳤다.') },
  { id: 'w18', at: [1598, 8], run: warLog('도요토미 히데요시가 죽었다. 왜군이 철수를 서두른다.') },
  {
    id: 'w19',
    at: [1598, 11],
    run: warLog('노량 해전: 이순신이 퇴각하는 왜군을 쫓다가 전사했다. 7년 전쟁이 끝났다.', (s) => {
      s.war.active = false;
      s.war.zones = [];
    }),
  },
  {
    id: 'ryu_fall',
    at: [1598, 11],
    window: 3,
    cond: (s) => live(s, 'yu_seongryong')?.status === 'active' && s.factions.buk.active,
    run(s) {
      const atk = bukAttacker(s);
      if (!atk) return;
      log(s, '북인이 류성룡을 "화친을 주장해 나라를 그르쳤다(주화오국)"며 탄핵하기 시작했다.', 'history');
      const p = P(s);
      const cs = openCase(s, atk, s.chars.yu_seongryong, { bonus: 2 });
      if (cs && !pIs(s, 'yu_seongryong') && inCourt(p) && (p.faction === 'buk' || p.faction === 'nam')) pushEvent(s, 'h_ryu_fall', { caseId: cs.id });
    },
  },
  {
    id: 'ilmonghak',
    at: [1596, 7],
    run(s) {
      log(s, '이몽학의 난: 충청도 홍산에서 이몽학이 난을 일으켰다가 진압되었다. 의병장 김덕령이 연루되었다는 공초가 나왔다.', 'war');
      s.regions.chungcheong.minsim = clamp(s.regions.chungcheong.minsim - 8, 0, 100);
      if (inCourt(P(s))) pushEvent(s, 'h_kim_deokryeong');
      else log(s, '김덕령은 여섯 차례의 형문 끝에 옥중에서 죽었다.', 'war');
    },
  },
  {
    id: 'jeong_eungtae',
    at: [1598, 6],
    run: warLogless('명의 주사 정응태가 "조선이 왜와 손잡고 명을 치려 한다"고 무고했다. 조정이 발칵 뒤집혀 진주사를 보내기로 했다.'),
  },
  {
    id: 'buk_split',
    at: [1599, 6],
    cond: (s) => s.factions.buk.active,
    run(s) {
      const bs = members(s, 'buk').filter((c) => c.status !== 'exiled' && !isP(s, c)).sort((a, b) => b.prestige + b.politics * 5 - (a.prestige + a.politics * 5));
      const a = bs[0]?.name;
      const b = bs[1]?.name;
      log(s, a && b ? `북인 안에서 ${josa(a, '을/를')} 따르는 대북과 ${josa(b, '을/를')} 따르는 소북이 갈라설 조짐을 보인다.` : '북인 안에서 대북과 소북이 갈라설 조짐을 보인다.', 'history');
    },
  },
  { id: 'queen', at: [1600, 6], run: warLogless('의인왕후 박씨가 승하했다. 왕은 새 왕비를 맞으려 한다.') },
  {
    id: 'nokhun',
    at: [1599, 3],
    run(s) {
      log(s, '전란의 공신을 가리는 녹훈 논의가 시작되었다. 이순신·권율·원균 등이 선무공신에, 어가를 호종한 이항복·이원익 등이 호성공신에 오를 것이라 한다.', 'history');
      const p = P(s);
      if (alive(p) && p.status !== 'exiled') pushEvent(s, 'war_merit', {});
    },
  },
  ...WAR_SCHEDULE,
  ...LATER_SCHEDULE,
];

/** 세자가 분조를 이끌고 강원으로 간다. 조정의 넷에 하나쯤이 따른다. */
function splitCourt(s: GameState) {
  const gh = s.heir ? s.chars[s.heir] : undefined;
  if (!alive(gh)) return;
  s.flags.bunjoSeat = 'gangwon';
  const from = typeof s.flags.courtSeat === 'string' ? (s.flags.courtSeat as RegionId) : 'hanseong';
  for (const c of people(s)) {
    if (isP(s, c) || c.location !== from || c.status !== 'active') continue;
    if (c.office === 'suryeong' || c.office?.startsWith('gamsa_')) continue;
    if (chance(s, 0.25)) c.location = 'gangwon';
  }
}

/** 분조가 행재소와 합친다 */
function mergeCourt(s: GameState) {
  const b = s.flags.bunjoSeat;
  if (typeof b !== 'string') return;
  delete s.flags.bunjoSeat;
  const to = typeof s.flags.courtSeat === 'string' ? (s.flags.courtSeat as RegionId) : 'hanseong';
  for (const c of people(s)) if (c.location === b && (c.status === 'active' || c.status === 'idle') && c.office !== 'suryeong' && !c.office?.startsWith('gamsa_')) c.location = to;
  log(s, '분조가 행재소와 합쳤다.', 'war');
}

/** 조정이 옮겨 간다. 조정에 있던 이들이 함께 움직인다. */
function moveCourt(s: GameState, to: RegionId) {
  const from = typeof s.flags.courtSeat === 'string' ? (s.flags.courtSeat as RegionId) : 'hanseong';
  if (to === 'hanseong') delete s.flags.courtSeat;
  else s.flags.courtSeat = to;
  for (const c of people(s)) {
    if (c.location !== from || !(c.status === 'active' || c.status === 'idle')) continue;
    if (c.office === 'suryeong' || c.office?.startsWith('gamsa_')) continue;
    // 플레이어는 스스로 고른 길을 간다 (호종했으면 이미 행재소에 있다)
    if (isP(s, c)) continue;
    c.location = to;
  }
  const p = P(s);
  if (to === 'hanseong' && p.location === from && inCourt(p)) p.location = 'hanseong';
}

function warLogless(text: string) {
  return (s: GameState) => log(s, text, 'history');
}

function bukAttacker(s: GameState) {
  return members(s, 'buk')
    .filter((c) => !isP(s, c) && (c.status === 'active' || c.status === 'idle'))
    .sort((a, b) => b.politics - a.politics)[0];
}

function courtWarDecision(s: GameState) {
  const share = (f: string) => people(s).filter((c) => c.status === 'active' && topOf(c.faction) === f).length;
  if (share('dong') >= share('seo')) {
    addPrep(s, -10);
    log(s, '통신사가 돌아왔다. 정사 황윤길은 병화를 경고했으나, 조정은 "걱정할 것 없다"는 부사 김성일의 말을 따랐다.', 'history');
  } else {
    addPrep(s, 10);
    log(s, '통신사가 돌아왔다. 조정은 황윤길의 경고를 받아들여 성을 쌓고 장수를 뽑았다.', 'history');
  }
}

export function runHistory(s: GameState) {
  for (const h of SCHEDULE) {
    const key = `h_${h.id}`;
    if (s.flags[key]) continue;
    const t0 = tOf(h.at[0], h.at[1]);
    if (s.t < t0 || s.t > t0 + (h.window ?? 0)) continue;
    if (h.cond && !h.cond(s)) continue;
    s.flags[key] = true;
    h.run(s);
  }
  for (const r of ROSTER) {
    if (!r.arrive || s.chars[r.id]) continue;
    if (tOf(r.arrive[0], r.arrive[1]) !== s.t) continue;
    const c = fromRoster(s, r);
    if (c.status === 'royal') log(s, `왕자 ${josa(c.name, '이/가')} 태어났다.`, 'history');
    else log(s, `${josa(c.name, '이/가')} 과거에 급제해 조정에 나왔다.`, 'court');
  }
}

// ───────────────────────────── 이벤트 정의 ─────────────────────────────

const choicesFor = (s: GameState, map: { when: (s: GameState) => boolean; choices: Choice[] }[]): Choice[] =>
  map.find((m) => m.when(s))?.choices ?? OK;

export const HISTORY_EVENTS: Record<string, EventDef> = {
  h_eulhae: {
    build(s) {
      const p = P(s);
      return {
        title: '을해당론(乙亥黨論)',
        kind: 'history',
        text:
          '이조전랑 김효원이 자리를 옮기게 되자, 후임으로 심의겸의 아우 심충겸이 천거되었다.\n\n' +
          '김효원은 "외척 집안의 사람이 어찌 전랑이 될 수 있는가" 하며 반대했다. 조정의 젊은 선비들은 김효원을, 나이 든 선비들은 심의겸을 편들었다.\n\n' +
          '김효원의 집은 도성 동쪽 건천동에, 심의겸의 집은 서쪽 정동에 있었다. 사람들은 이들을 동인(東人)과 서인(西人)이라 부르기 시작했다.',
        choices: choicesFor(s, [
          {
            when: () => p.id === 'kim_hyowon',
            choices: [
              { key: 'kim_hard', label: '외척은 전랑이 될 수 없다고 끝까지 맞선다', hint: '동인 +12, 서인 -12, 명망 +4. 붕당 긴장이 크게 오른다.' },
              { key: 'kim_soft', label: '한발 물러서 화를 피한다', hint: '동인 -8, 명망 -2. 긴장이 덜 오른다.' },
            ],
          },
          {
            when: () => p.id === 'sim_uigyeom',
            choices: [
              { key: 'sim_hard', label: '아우의 천거를 밀어붙인다', hint: '서인 +12, 동인 -12, 성심 +3. 붕당 긴장이 크게 오른다.' },
              { key: 'sim_soft', label: '천거를 거두어 체면을 지킨다', hint: '서인 -6, 명망 +3.' },
            ],
          },
          {
            when: () => p.traits.includes('mediator'),
            choices: [
              { key: 'mediate', label: '두 사람을 모두 외직으로 내보내 다툼을 가라앉히자고 청한다', hint: '긴장 완화, 성심 +6, 명망 +4. 양쪽 모두 조금 서운해한다.' },
              { key: 'watch', label: '지켜본다' },
            ],
          },
          {
            when: () => p.faction === 'dong',
            choices: [
              { key: 'back_dong', label: '김효원을 지지한다', hint: '동인 +8, 서인 -8' },
              { key: 'watch', label: '말을 아낀다' },
            ],
          },
          {
            when: () => p.faction === 'seo',
            choices: [
              { key: 'back_seo', label: '심의겸 편에 선다', hint: '서인 +8, 동인 -8' },
              { key: 'watch', label: '말을 아낀다' },
            ],
          },
          {
            when: () => true,
            choices: [
              { key: 'back_dong', label: '김효원을 지지하며 동인에 가담한다', hint: '동인 +8, 서인 -8' },
              { key: 'back_seo', label: '심의겸을 지지하며 서인에 가담한다', hint: '서인 +8, 동인 -8' },
              { key: 'watch', label: '어느 편도 들지 않는다' },
            ],
          },
        ]),
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      s.tension = clamp(s.tension + 8, 0, 100);
      const fx: string[] = [];
      switch (key) {
        case 'kim_hard':
          fx.push(swayFaction(s, 'dong', p.id, 12, '분당의 기수', 0.05), swayFaction(s, 'seo', p.id, -12, '외척 배척', 0.05));
          p.prestige = clamp(p.prestige + 4, 0, 100);
          s.tension += 6;
          break;
        case 'kim_soft':
          fx.push(swayFaction(s, 'dong', p.id, -8, '나약한 처신', 0.05));
          p.prestige = clamp(p.prestige - 2, 0, 100);
          s.tension -= 3;
          break;
        case 'sim_hard':
          fx.push(swayFaction(s, 'seo', p.id, 12, '서인의 구심', 0.05), swayFaction(s, 'dong', p.id, -12, '외척의 전횡', 0.05));
          p.favor = clamp(p.favor + 3, -100, 100);
          s.tension += 6;
          break;
        case 'sim_soft':
          fx.push(swayFaction(s, 'seo', p.id, -6, '체면만 지킴', 0.05));
          p.prestige = clamp(p.prestige + 3, 0, 100);
          s.tension -= 3;
          break;
        case 'mediate':
          s.flags.mediated = true;
          s.tension -= 6;
          p.favor = clamp(p.favor + 6, -100, 100);
          p.prestige = clamp(p.prestige + 4, 0, 100);
          fx.push(swayFaction(s, 'dong', p.id, -3, '어정쩡한 조제', 0.05), swayFaction(s, 'seo', p.id, -3, '어정쩡한 조제', 0.05));
          break;
        case 'back_dong':
          if (p.faction === 'none') joinFaction(s, p, 'dong');
          fx.push(swayFaction(s, 'dong', p.id, 8, '김효원 지지', 0.05), swayFaction(s, 'seo', p.id, -8, '동인의 편', 0.05));
          break;
        case 'back_seo':
          if (p.faction === 'none') joinFaction(s, p, 'seo');
          fx.push(swayFaction(s, 'seo', p.id, 8, '심의겸 지지', 0.05), swayFaction(s, 'dong', p.id, -8, '서인의 편', 0.05));
          break;
      }
      const kim = live(s, 'kim_hyowon');
      const bal = live(s, 'yi_bal');
      if (kim && kim.office === 'jeonrang') {
        if (bal) appoint(s, bal, 'jeonrang');
        else vacate(s, kim);
        appoint(s, kim, 'gyori2', true);
      }
      log(s, '을해당론: 사림이 동인과 서인으로 갈라섰다.', 'history');
      s.player.deeds.push(`${shortDate(s.t)} 을해당론`);
      return fx.filter(Boolean).join(', ');
    },
  },

  h_eulhae_after: {
    build(s) {
      const kim = pIs(s, 'kim_hyowon');
      return {
        title: '외직으로',
        kind: 'history',
        text: `이이가 "두 사람을 모두 외직으로 내보내 다툼의 뿌리를 없애자"고 건의했고, 왕이 이를 받아들였다. 당신은 ${kim ? '함경도 부령 부사' : '개성 유수'}로 나가라는 명을 받았다.`,
        choices: [
          { key: 'accept', label: '명을 받든다', hint: '명망 +3. 한동안 한성을 떠난다.' },
          { key: 'protest', label: '부당함을 상소한다', hint: '성심 -10. 절반의 확률로 한성에 남는다.' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const region: RegionId = pIs(s, 'kim_hyowon') ? 'hamgyeong' : 'gyeonggi';
      if (key === 'accept') {
        p.prestige = clamp(p.prestige + 3, 0, 100);
        sendOut(s, p, region);
        return '외직으로 나갔다.';
      }
      p.favor = clamp(p.favor - 10, -100, 100);
      if (chance(s, 0.5)) return '왕이 명을 거두었다. 한성에 남는다.';
      sendOut(s, p, region);
      return '상소는 받아들여지지 않았다. 외직으로 나간다.';
    },
  },

  h_iyi_side: {
    build: () => ({
      title: '조제의 한계',
      kind: 'history',
      text: '동서의 조제를 외쳐 왔지만, 동인은 당신을 서인의 편으로 의심하고 서인은 당신을 끌어들이려 한다. 어느 쪽에도 서지 않는 길은 점점 좁아진다.',
      choices: [
        { key: 'seo', label: '서인과 손을 잡는다', hint: '서인 +10, 동인 -10' },
        { key: 'stay', label: '끝까지 조제를 고수한다', hint: '명망 +5, 긴장 -3. 양쪽의 의심을 받는다(각 -5).' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'seo') {
        p.faction = 'seo';
        return [swayFaction(s, 'seo', p.id, 10, '동지', 0.05), swayFaction(s, 'dong', p.id, -10, '서인에 기욺', 0.05)].join(', ');
      }
      p.prestige = clamp(p.prestige + 5, 0, 100);
      s.tension = clamp(s.tension - 3, 0, 100);
      return [swayFaction(s, 'seo', p.id, -5, '모호한 태도', 0.05), swayFaction(s, 'dong', p.id, -5, '모호한 태도', 0.05)].join(', ');
    },
  },

  h_gyemi: {
    build(s) {
      const p = P(s);
      const self = pIs(s, 'yi_i');
      return {
        title: '계미삼찬(癸未三竄)',
        kind: 'history',
        text: (() => {
          const [title, field] = PANSEO_ABUSE[panseoOf(s.chars.yi_i) ?? 'byeongjo'];
          const was = s.chars.yi_i.office && PANSEO.includes(s.chars.yi_i.office) ? '' : '지난날 ';
          return self
            ? `동인 삼사가 일제히 당신을 탄핵했다. ${was}${title}로서 왕의 재가 없이 ${field}을 멋대로 처리했고, 왕의 부름에 병을 핑계로 나오지 않았다는 것이다.`
            : `동인 삼사의 ${dongSamsa(s)} 이이를 탄핵했다. ${was}${title}로서 왕의 재가 없이 ${field}을 처리했다는 것이다. 왕은 이이를 감싸는 기색이다.`;
        })(),
        choices: self
          ? [
              { key: 'resign', label: '스스로 물러나기를 청한다', hint: '낙향. 명망 +6, 성심 +10. 왕이 탄핵한 자들을 벌한다.' },
              { key: 'rebut', label: '정면으로 반박한다', hint: '성심 +5, 동인 -15. 긴장이 오른다.' },
            ]
          : pTop(s) === 'dong'
            ? [
                { key: 'join', label: '이이 탄핵에 이름을 올린다', hint: '동인 +8, 서인 -12. 왕의 노여움을 살 수 있다(40%).' },
                { key: 'abstain', label: '가담하지 않는다', hint: '동인 -5' },
              ]
            : p.faction === 'seo'
              ? [
                  { key: 'defend', label: '이이를 변호하는 상소를 올린다', hint: '서인 +8, 동인 -8, 성심 +4, 명망 +2' },
                  { key: 'watch', label: '지켜본다' },
                ]
              : OK,
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const fx: string[] = [];
      const extra: string[] = [];
      switch (key) {
        case 'resign':
          vacate(s, p, 'retired');
          p.prestige = clamp(p.prestige + 6, 0, 100);
          p.favor = clamp(p.favor + 10, -100, 100);
          break;
        case 'rebut':
          p.favor = clamp(p.favor + 5, -100, 100);
          fx.push(swayFaction(s, 'dong', p.id, -15, '정면 반박', 0.05));
          s.tension = clamp(s.tension + 5, 0, 100);
          break;
        case 'join':
          fx.push(swayFaction(s, pTop(s) === 'dong' ? p.faction : 'dong', p.id, 8, '이이 탄핵', 0.05), swayFaction(s, 'seo', p.id, -12, '이이 탄핵', 0.05));
          if (chance(s, 0.4)) extra.push(p.id);
          break;
        case 'abstain':
          fx.push(swayFaction(s, p.faction, p.id, -5, '당론 이탈', 0.05));
          break;
        case 'defend':
          fx.push(swayFaction(s, 'seo', p.id, 8, '이이 변호', 0.05), swayFaction(s, 'dong', p.id, -8, '이이 변호', 0.05));
          p.favor = clamp(p.favor + 4, -100, 100);
          p.prestige = clamp(p.prestige + 2, 0, 100);
          break;
      }
      gyemiOutcome(s, extra);
      return extra.length ? '왕의 노여움이 당신에게까지 미쳤다.' : fx.filter(Boolean).join(', ');
    },
  },

  h_jeong_turn: {
    build: () => ({
      title: '스승의 죽음 이후',
      kind: 'history',
      text: '스승 이이가 세상을 떠났다. 이제 조정의 대세는 동인에게 있다. 동인에 가담하면 길이 열리겠지만, 서인은 당신을 배신자로 여길 것이고 왕도 스승을 저버린 자를 곱게 보지 않을 것이다.',
      choices: [
        { key: 'turn', label: '동인으로 돌아선다', hint: '동인 +8, 서인 -25, 성심 -15' },
        { key: 'stay', label: '스승의 뜻을 지킨다', hint: '서인 +8, 명망 +3' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'turn') {
        joinFaction(s, p, 'dong');
        p.favor = clamp(p.favor - 15, -100, 100);
        return [swayFaction(s, p.faction, p.id, 8, '새 동지', 0.05), swayFaction(s, 'seo', p.id, -25, '배신자', 0.03)].join(', ');
      }
      p.prestige = clamp(p.prestige + 3, 0, 100);
      return swayFaction(s, 'seo', p.id, 8, '의리', 0.05);
    },
  },

  h_daedong: {
    build: () => ({
      title: '대동계(大同契)',
      kind: 'history',
      text: '고향 전라도의 선비와 무사, 노비까지 신분을 가리지 않고 모여드는 이들이 있다. 이들을 묶어 계를 만들면 큰 힘이 되겠지만, 조정은 이를 어떻게 볼 것인가.',
      choices: [
        { key: 'organize', label: '대동계를 크게 일으킨다', hint: '낙향. 명망 +8, 전라도 당세 상승. 위험한 소문이 돌 수 있다.' },
        { key: 'quiet', label: '조용히 학문에 힘쓴다', hint: '아무 일도 일어나지 않는다.' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key !== 'organize') return '대동계를 만들지 않았다.';
      if (p.office) vacate(s, p, 'retired');
      p.status = 'retired';
      p.location = 'jeolla';
      p.prestige = clamp(p.prestige + 8, 0, 100);
      s.flags.daedong = true;
      const r = s.regions.jeolla;
      r.influence[p.faction] = (r.influence[p.faction] ?? 0) + 5;
      return '진안 죽도에서 대동계를 일으켰다.';
    },
  },

  h_gichuk_self: {
    build: () => ({
      title: '고변(告變)',
      kind: 'danger',
      text: '황해도 관찰사의 비밀 장계가 올라왔다. 당신이 대동계를 이끌고 모반을 꾀한다는 고변이다. 금부도사가 이미 내려오고 있다.',
      choices: [
        { key: 'flee', label: '죽도로 몸을 피한다', hint: '역사가 기록한 길' },
        { key: 'face', label: '상경하여 결백을 밝힌다', hint: '주사위 + 정치력 + 명망/25 ≥ 9 이면 유배로 목숨을 건진다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      const cheol = live(s, 'jeong_cheol');
      if (key === 'flee') {
        kill(s, p, '죽도에서 스스로 목숨을 끊었다');
        return;
      }
      const roll = d6(s);
      const total = roll + p.politics + Math.floor(p.prestige / 25);
      if (total >= 9) {
        exile(s, p);
        p.tags.push('royalWrath');
        gichukPurge(s, !!cheol && cheol.faction === 'seo');
        return `국문을 버텨 냈다 (${total}). 목숨은 건졌지만 유배되었다.`;
      }
      kill(s, p, '국문을 받다가 장살(杖殺)되었다');
    },
  },

  h_gichuk: {
    build(s) {
      const p = P(s);
      const linked =
        p.tags.includes('jeong_link') ||
        s.mods.some((m) => m.scope === 'char' && m.holder === 'jeong_yeorip' && m.about === p.id && m.value >= 15);
      const warn = linked ? '\n\n당신은 정여립과 친분이 있었다. 연루될 수 있다.' : '';
      const base =
        '정여립이 모반을 꾀했다는 고변이 올라왔고, 그는 죽도에서 스스로 목숨을 끊었다. 옥사가 시작되었다. 동인 가운데 정여립과 가까웠던 이들이 줄줄이 잡혀 오고 있다.';
      if (pIs(s, 'jeong_cheol'))
        return {
          title: '기축옥사 — 위관(委官)',
          kind: 'danger',
          text: base + '\n\n당신이 옥사를 다스리는 위관이 되었다.',
          choices: [
            { key: 'harsh', label: '옥사를 크게 일으켜 동인을 뿌리 뽑는다', hint: '서인 +15, 동인 -30, 성심 +10. 동인 당상관 전원이 판정을 받는다.' },
            { key: 'narrow', label: '연루자만 가려 다스린다', hint: '명망 +5, 서인 -5, 동인 +5' },
          ],
        };
      const choices: Choice[] =
        p.faction === 'seo'
          ? [
              { key: 'harsh', label: '옥사를 넓혀야 한다고 주장한다', hint: '서인 +10, 동인 -15' },
              { key: 'narrow', label: '무고한 이는 가려야 한다', hint: '명망 +4, 서인 -4, 동인 +4' },
              { key: 'silent', label: '침묵한다' },
            ]
          : pTop(s) === 'dong'
            ? [
                { key: 'distance', label: '정여립과 선을 긋는 상소를 올린다', hint: '판정을 받게 되면 한 번 다시 굴린다. 성심 +3, 동인 -3' },
                { key: 'defend', label: '억울한 동료를 변호한다', hint: '명망 +5, 동인 +8, 서인 -10' },
                { key: 'silent', label: '침묵한다' },
              ]
            : [
                { key: 'narrow', label: '무고한 이는 가려야 한다고 말한다', hint: '명망 +3' },
                { key: 'silent', label: '침묵한다' },
              ];
      return { title: '기축옥사(己丑獄事)', kind: 'danger', text: base + warn, choices };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const cheol = live(s, 'jeong_cheol');
      const fx: string[] = [];
      let harsh = !!cheol && cheol.faction === 'seo' && !isP(s, cheol);
      if (pIs(s, 'jeong_cheol')) harsh = key === 'harsh';
      else if (key === 'harsh') harsh = true;
      else if (key === 'narrow' && chance(s, 0.4)) harsh = false;
      switch (key) {
        case 'harsh':
          fx.push(swayFaction(s, 'seo', p.id, pIs(s, 'jeong_cheol') ? 15 : 10, '옥사 주도', 0.05));
          fx.push(swayFaction(s, s.factions.dong.active ? 'dong' : 'buk', p.id, pIs(s, 'jeong_cheol') ? -30 : -15, '옥사의 원한', 0.03));
          if (pIs(s, 'jeong_cheol')) p.favor = clamp(p.favor + 10, -100, 100);
          break;
        case 'narrow':
          p.prestige = clamp(p.prestige + (p.faction === 'seo' ? 4 : 3), 0, 100);
          if (p.faction === 'seo') fx.push(swayFaction(s, 'seo', p.id, -4, '물러터짐', 0.05), swayFaction(s, 'dong', p.id, 4, '공정함', 0.05));
          break;
        case 'distance':
          p.favor = clamp(p.favor + 3, -100, 100);
          fx.push(swayFaction(s, p.faction, p.id, -3, '제 몸만 챙김', 0.05));
          break;
        case 'defend':
          p.prestige = clamp(p.prestige + 5, 0, 100);
          fx.push(swayFaction(s, p.faction, p.id, 8, '동료 변호', 0.05), swayFaction(s, 'seo', p.id, -10, '역당 비호', 0.05));
          break;
      }
      gichukPurge(s, harsh, key === 'distance' ? [p.id] : []);
      return fx.filter(Boolean).join(', ');
    },
  },

  h_tongsinsa_report: {
    build: () => ({
      title: '통신사의 귀국',
      kind: 'history',
      text: '통신사가 돌아왔다. 정사 황윤길은 "반드시 병화가 있을 것"이라 했고, 부사 김성일은 "그런 기색을 보지 못했다. 민심을 어지럽혀서는 안 된다"고 했다. 조정의 의견이 둘로 갈린다.',
      choices: [
        { key: 'warn', label: '침략에 대비해야 한다', hint: '남쪽 방비 +15. 전쟁이 나면 명망 +8. 동인이면 당내 반발.' },
        { key: 'calm', label: '민심을 어지럽혀서는 안 된다', hint: '남쪽 방비 -5. 서인이면 당내 반발.' },
        { key: 'silent', label: '말을 아낀다' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      let fx = '';
      if (key === 'warn') {
        addPrep(s, 15);
        s.flags.warned = true;
        if (pTop(s) === 'dong') fx = swayFaction(s, p.faction, p.id, -4, '당론 이탈', 0.05);
      } else if (key === 'calm') {
        addPrep(s, -5);
        if (p.faction === 'seo') fx = swayFaction(s, 'seo', p.id, -4, '당론 이탈', 0.05);
      }
      courtWarDecision(s);
      return fx;
    },
  },

  h_geonjeo: {
    build(s) {
      if (pIs(s, 'jeong_cheol'))
        return {
          title: '건저의(建儲議)',
          kind: 'danger',
          text: `당신은 ${titled(s, 'yi_sanhae', '동인 대신들')}${live(s, 'yu_seongryong') ? `, ${titled(s, 'yu_seongryong', '')}` : ''}과 함께 광해군을 세자로 세우자고 청하기로 약조했다. 그런데 약속한 날, ${live(s, 'yi_sanhae') ? josa(s.chars.yi_sanhae.name, '이/가') : '동인 대신들이'} 병을 핑계로 나오지 않았다. 왕이 총애하는 인빈 김씨 쪽에서 무언가 흘러나왔다는 소문도 있다.`,
          choices: [
            { key: 'propose', label: '약조대로 세자 책봉을 건의한다', hint: '명분을 얻지만(명망 +3) 왕의 노여움을 살 수 있다. 성심이 70 이상이면 파직, 아니면 유배.' },
            { key: 'delay', label: '이상한 기미를 느끼고 건의를 미룬다', hint: '서인 -5, 명망 -3. 화를 피한다.' },
          ],
        };
      if (pIs(s, 'yi_sanhae'))
        return {
          title: '건저의(建儲議)',
          kind: 'danger',
          text: `${josa(titled(s, 'jeong_cheol', '서인 대신'), '이/가')} 광해군 세자 책봉을 함께 건의하자고 청했다. 그러나 왕은 인빈 김씨 소생 신성군을 아낀다. 인빈의 오라비 김공량에게 이 일을 흘리면 정철은 왕의 노여움을 피할 수 없을 것이다.`,
          choices: [
            { key: 'leak', label: '김공량에게 정철의 계획을 흘린다', hint: '정철 실각, 성심 +12. 서인의 깊은 원한을 산다. 숨은 흠결 「모함」.' },
            { key: 'join', label: '약조대로 함께 건의한다', hint: '함께 왕의 노여움을 산다. 성심 -40, 파직, 명망 +4.' },
            { key: 'skip', label: '병을 핑계로 빠진다', hint: '성심 +3' },
          ],
        };
      const p = P(s);
      return {
        title: '건저의(建儲議)',
        kind: 'history',
        text: `${josa(titled(s, 'jeong_cheol', '서인 대신'), '이/가')} 광해군을 세자로 세우자고 청했다가 왕의 진노를 샀다. 왕은 신성군을 아끼고 있었던 것이다. 정철은 강계로 귀양 가게 되었고, 서인 전체가 왕의 의심을 받고 있다.`,
        choices:
          p.faction === 'seo'
            ? [
                { key: 'save', label: '정철을 구명하는 상소를 올린다', hint: '서인 +8, 성심 -8. 30% 확률로 파직.' },
                { key: 'silent', label: '침묵한다', hint: '서인 -4' },
              ]
            : [
                { key: 'hard', label: '서인을 엄히 다스려야 한다', hint: '강경론. 동인이 갈라지면 북인 쪽으로 기운다. 서인 -10, 성심 +3' },
                { key: 'soft', label: '정철 한 사람으로 족하다', hint: '온건론. 동인이 갈라지면 남인 쪽으로 기운다. 서인 +4' },
                { key: 'silent', label: '말을 아낀다' },
              ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const fx: string[] = [];
      if (pIs(s, 'jeong_cheol')) {
        if (key === 'propose') {
          p.prestige = clamp(p.prestige + 3, 0, 100);
          if (p.favor >= 70) {
            p.favor -= 30;
            vacate(s, p);
          } else {
            p.favor = clamp(p.favor - 50, -100, 100);
            exile(s, p);
            p.location = 'pyeongan';
            p.exilePlace = '강계';
            p.tags.push('royalWrath');
          }
          geonjeoOutcome(s, false);
          return '왕이 크게 노했다.';
        }
        fx.push(swayFaction(s, 'seo', p.id, -5, '우유부단', 0.05));
        p.prestige = clamp(p.prestige - 3, 0, 100);
        s.flags.splitReady = true;
        if (s.factions.dong.active) s.factions.dong.division += 5;
        log(s, '정철이 세자 책봉 건의를 미뤘다. 건저 논의는 흐지부지되었다.', 'history');
        return fx.join(', ');
      }
      if (pIs(s, 'yi_sanhae')) {
        if (key === 'leak') {
          p.favor = clamp(p.favor + 12, -100, 100);
          const cheol = live(s, 'jeong_cheol');
          addFlaw(s, p, '건저 모함', false, cheol ? [cheol.id] : []);
          if (cheol && !cheol.grudges.includes(p.id)) cheol.grudges.push(p.id);
          fx.push(swayFaction(s, 'seo', p.id, -20, '건저 모함', 0.03));
        } else if (key === 'join') {
          p.favor = clamp(p.favor - 40, -100, 100);
          p.prestige = clamp(p.prestige + 4, 0, 100);
          if (p.office) vacate(s, p);
        } else p.favor = clamp(p.favor + 3, -100, 100);
        geonjeoOutcome(s, true);
        return fx.join(', ');
      }
      geonjeoOutcome(s, true);
      if (key === 'save') {
        fx.push(swayFaction(s, 'seo', p.id, 8, '정철 구명', 0.05));
        p.favor = clamp(p.favor - 8, -100, 100);
        if (p.office && chance(s, 0.3)) {
          vacate(s, p);
          fx.push('파직되었다');
        }
      } else if (key === 'silent' && p.faction === 'seo') fx.push(swayFaction(s, 'seo', p.id, -4, '침묵', 0.05));
      else if (key === 'hard') {
        p.lean = 'buk';
        p.favor = clamp(p.favor + 3, -100, 100);
        fx.push(swayFaction(s, 'seo', p.id, -10, '서인 공격', 0.05));
      } else if (key === 'soft') {
        p.lean = 'nam';
        fx.push(swayFaction(s, 'seo', p.id, 4, '온건론', 0.05));
      }
      return fx.filter(Boolean).join(', ');
    },
  },

  h_imjin: {
    build(s) {
      const p = P(s);
      const held = s.realm.warPath === 'held';
      const text = held
        ? '왜군이 부산에 상륙했다. 그러나 동래와 밀양의 성이 버티고, 미리 조련한 군사가 고개마다 지키고 있다. 조정은 도성을 지키며 근왕병을 모으기로 했다.'
        : s.realm.warPath === 'rout'
          ? '왜군이 부산에 상륙해 거침없이 북상하고 있다. 성은 무너져 있고 군사는 흩어졌다. 열흘 만에 충주가 떨어졌다는 급보가 들어왔다. 왕은 도성을 버리고 피란길에 오르려 한다.'
          : '왜군이 부산에 상륙해 파죽지세로 북상하고 있다. 상주와 충주에서 관군이 무너졌다는 급보가 잇따른다. 왕은 도성을 버리고 피란길에 오르려 한다.';
      if (p.status === 'exiled')
        return {
          title: '임진왜란',
          kind: 'war',
          text: text + '\n\n당신은 유배지에서 이 소식을 들었다.',
          choices: [
            { key: 'militia', label: '유배지에서 의병을 모은다', hint: '명망 +8. 1년간 전사할 위험이 있다.' },
            { key: 'wait', label: '근신하며 기다린다' },
          ],
        };
      return {
        title: '임진왜란',
        kind: 'war',
        text,
        choices: [
          { key: 'follow', label: '어가를 호종한다', hint: '성심 +25. 평안도로 피란한다.', disabled: inCourt(p) ? undefined : '조정에 있어야 한다' },
          { key: 'militia', label: '고향으로 내려가 의병을 일으킨다', hint: '관직을 내려놓는다. 명망 +12. 1년간 전사할 위험이 있다.' },
          { key: 'flee', label: '가솔을 이끌고 피란한다', hint: '명망 -10. 비겁하다는 낙인이 찍힐 수 있다.' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      switch (key) {
        case 'follow':
          s.flags.escorted = true;
          p.favor = clamp(p.favor + 25, -100, 100);
          p.location = 'pyeongan';
          s.flags.hojong = true;
          s.player.deeds.push(`${shortDate(s.t)} 어가 호종`);
          return '어가를 따라 북으로 향했다.';
        case 'militia':
          if (p.status !== 'exiled') {
            if (p.office) vacate(s, p, 'retired');
            p.status = 'retired';
            p.location = p.home;
          }
          p.prestige = clamp(p.prestige + (p.status === 'exiled' ? 8 : 12), 0, 100);
          s.flags.militia = s.t + 12;
          s.flags.warMerit = Number(s.flags.warMerit ?? 0) + 2;
          s.player.deeds.push(`${shortDate(s.t)} 의병 창의`);
          log(s, `${josa(p.name, '이/가')} 의병을 일으켰다.`, 'player');
          return '의병을 일으켰다.';
        case 'flee':
          p.prestige = clamp(p.prestige - 10, 0, 100);
          if (chance(s, 0.5)) addFlaw(s, p, '피란(避亂)', true);
          return '가솔을 이끌고 깊은 산골로 피했다.';
      }
    },
  },

  h_napsok: {
    build(s) {
      const p = P(s);
      const amt = Math.min(80, Math.round(p.wealth / 2));
      return {
        title: '군량이 바닥나다',
        kind: 'war',
        text: '명군과 관군을 먹일 군량이 바닥났다. 조정은 곡식을 바치는 이에게 벼슬과 상을 내리겠다며 납속(納粟)을 독려하고 있다.',
        choices: [
          { key: 'donate', label: `가산을 털어 군량을 바친다 (재산 -${amt})`, hint: '명망 +6, 성심 +8' },
          { key: 'decline', label: '형편이 어렵다며 사양한다', hint: '명망 -1' },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'donate') {
        p.wealth -= Math.min(80, Math.round(p.wealth / 2));
        p.prestige = clamp(p.prestige + 6, 0, 100);
        p.favor = clamp(p.favor + 8, -100, 100);
        return '군량을 바쳤다.';
      }
      p.prestige = clamp(p.prestige - 1, 0, 100);
    },
  },

  h_yisunsin_jail: {
    build: () => ({
      title: '이순신 하옥',
      kind: 'war',
      text: '삼도수군통제사 이순신이 왕명을 어기고 출전하지 않았다는 죄로 하옥되었다. 원균이 그 자리를 대신한다. 왕은 그를 죽이려 한다.',
      choices: [
        { key: 'save', label: '이순신을 구명하는 상소를 올린다', hint: '명망 +5, 성심 -6' },
        { key: 'follow', label: '조정의 결정을 따른다' },
        { key: 'wongyun', label: '원균을 지지한다', hint: '성심 +3. 원균이 패하면 비난을 받는다.' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'save') {
        p.prestige = clamp(p.prestige + 5, 0, 100);
        p.favor = clamp(p.favor - 6, -100, 100);
      } else if (key === 'wongyun') {
        p.favor = clamp(p.favor + 3, -100, 100);
        s.flags.backed_won = true;
      }
      log(s, '이순신은 정탁의 신구차(伸救箚)로 목숨을 건지고 백의종군하게 되었다.', 'war');
    },
  },

  h_ryu_fall: {
    build(s, c) {
      const p = P(s);
      const cs = caseById(s, c.caseId);
      const atk = cs ? s.chars[cs.attacker] : undefined;
      return {
        title: '주화오국(主和誤國)',
        kind: 'history',
        text: `북인 ${josa(atk?.name ?? '누군가', '이/가')} 영의정 류성룡을 논핵했다. 전란 중 화친을 주장해 나라를 그르쳤다는 것이다. 논핵은 두 달 동안 이어진다.`,
        choices:
          p.faction === 'buk'
            ? [
                { key: 'join', label: '논핵에 가세한다', hint: '북인 +8, 남인 -15. 동조자가 된다' },
                { key: 'abstain', label: '빠진다' },
              ]
            : [
                { key: 'defend', label: '류성룡을 구원한다', hint: '남인 +8, 북인 -10. 구원자가 되고 류성룡이 신세를 진다' },
                { key: 'silent', label: '침묵한다' },
              ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const cs = caseById(s, c.caseId);
      if (!cs) return;
      const fx: string[] = [];
      if (key === 'join') {
        cs.pros.push(p.id);
        fx.push(swayFaction(s, 'buk', p.id, 8, '류성룡 탄핵', 0.05), swayFaction(s, 'nam', p.id, -15, '류성룡 탄핵', 0.03));
      } else if (key === 'defend') {
        cs.cons.push(p.id);
        owe(s, cs.target);
        fx.push(swayFaction(s, 'nam', p.id, 8, '류성룡 변호', 0.05), swayFaction(s, 'buk', p.id, -10, '류성룡 변호', 0.05));
      }
      return fx.filter(Boolean).join(', ');
    },
  },

  h_kim_deokryeong: {
    build: () => ({
      title: '김덕령의 옥사',
      kind: 'history',
      text:
        '이몽학의 무리가 공초에서 의병장 김덕령의 이름을 댔다. 김덕령은 전란 내내 왜적과 싸운 장수다. ' +
        '그러나 왕은 그의 용력을 두려워하는 기색이 역력하다. 국문장에서 신하들의 눈이 당신에게 쏠린다.',
      choices: [
        { key: 'save', label: '억울함을 아뢰고 구명한다', hint: '성심 -6, 명망 +5. 구하지 못할 수도 있다' },
        { key: 'silent', label: '입을 다문다' },
        { key: 'punish', label: '역모는 엄히 다스려야 한다', hint: '성심 +3, 명망 -4' },
      ],
    }),
    resolve(s, _c, key) {
      const p = P(s);
      if (key === 'save') {
        p.favor = clamp(p.favor - 6, -100, 100);
        p.prestige = clamp(p.prestige + 5, 0, 100);
        if (chance(s, 0.3 + p.politics * 0.04)) {
          log(s, `${p.name} 등의 구명으로 김덕령은 목숨을 건졌으나, 다시는 군사를 이끌지 못했다.`, 'war');
          return '김덕령의 목숨을 건졌다. 남도의 의병들이 당신을 칭송한다.';
        }
        log(s, '김덕령은 여섯 차례의 형문 끝에 옥중에서 죽었다. 이후 의병장들이 몸을 사리게 되었다.', 'war');
        return '구명에 힘썼으나 김덕령은 옥중에서 죽었다.';
      }
      log(s, '김덕령은 여섯 차례의 형문 끝에 옥중에서 죽었다. 이후 의병장들이 몸을 사리게 되었다.', 'war');
      if (key === 'punish') {
        p.favor = clamp(p.favor + 3, -100, 100);
        p.prestige = clamp(p.prestige - 4, 0, 100);
      }
      addPrep(s, -3);
    },
  },
};
