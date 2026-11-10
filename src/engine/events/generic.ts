import type { EventDef } from './types';
import { OK } from './types';
import type { ImpeachReport, MemorialResult } from '../conflict';
import { memorial, OUTCOME_LABEL, TOPIC_LABEL } from '../conflict';
import { openCase } from '../cases';
import { OFFICE_MAP } from '../data/offices';
import { FACTION_META, REGION_META } from '../data/meta';
import { harvestOf, REGION_ECON, tributeAmounts } from '../regions';
import { addFlaw, alive, clamp, inCourt, isP, josa, log, officeTitle, P, pushEvent } from '../state';
import { sway, swayFaction } from '../opinion';
import { appoint } from '../court';
import { members } from '../factions';
import { shortDate } from '../calendar';

const fname = (f: string) => FACTION_META[f as keyof typeof FACTION_META].name;

export const GENERIC_EVENTS: Record<string, EventDef> = {
  notice: {
    build: (_s, c) => ({ title: c.title, text: c.text, kind: c.kind ?? 'notice', choices: OK }),
    resolve() {},
  },

  intro: {
    build(s) {
      const p = P(s);
      return {
        title: '선조 8년, 을해년',
        kind: 'history',
        text:
          `당신은 ${p.clan}의 ${p.name}${p.ho ? `(호 ${p.ho})` : ''}입니다.\n\n` +
          '훈척 정치가 막을 내리고 사림이 조정을 차지한 지 여러 해. 이제 사림은 둘로 갈라서려 하고 있습니다. ' +
          '앞으로 25년, 당신은 상소와 탄핵, 혼맥과 천거로 살아남아야 합니다.\n\n' +
          '· 당신이 한 사람에게 한 일은 그의 가문과 붕당 전체에 번집니다.\n' +
          '· 흠결은 탄핵의 칼이 됩니다. 탐문과 뒷조사로 남의 흠결을 캐고, 내 흠결은 숨기십시오.\n' +
          '· 탄핵은 두 달 동안 이어지는 공방입니다. 남을 구원해 주면 그가 신세를 지고, 신세는 당신이 위태로울 때 돌아옵니다.\n' +
          '· 두세 달마다 조정에 쟁점이 오릅니다. 어느 편에 서느냐가 당과 왕의 마음을 움직입니다.\n' +
          '· 천명의 해가 오면 해마다 생사를 판정합니다. 명의를 부르면 버틸 수 있습니다.\n' +
          '· 한 턴은 한 달입니다. 이번 달의 일을 정하고 인물을 눌러 교유한 뒤, 우측 상단의 다음 달 버튼(Space)으로 턴을 넘기십시오.\n' +
          '· 성심·명망 같은 수치에 마우스를 올리면 어디에 쓰이는지 나옵니다. 전체 설명은 우측 상단 「? 도움말」에 있습니다.',
        choices: [{ key: 'ok', label: '조정에 나아간다' }],
      };
    },
    resolve() {},
  },

  impeach_report: {
    build(s, c) {
      const r = c.report as ImpeachReport;
      const t = s.chars[r.target];
      return { title: c.kind === 'aggravate' ? '가죄(加罪) 판정' : '탄핵 판정', kind: isP(s, t) ? 'danger' : 'court', text: r.text, report: r, choices: OK };
    },
    resolve() {},
  },

  memorial_report: {
    build(_s, c) {
      const r = c.result as MemorialResult;
      return { title: TOPIC_LABEL[c.topic as keyof typeof TOPIC_LABEL] ?? '상소', kind: 'court', text: r.text, memorial: r, choices: OK };
    },
    resolve() {},
  },

  appointment_offer: {
    build(_s, c) {
      const o = OFFICE_MAP[c.office];
      return {
        title: '제수(除授)',
        kind: 'court',
        text: `왕명으로 당신을 ${o.name}(${o.rank}품)에 제수한다는 교지가 내려왔다.\n\n${o.desc}`,
        choices: [
          { key: 'accept', label: '교지를 받든다' },
          { key: 'decline', label: '사직소를 올려 사양한다', hint: '명망 +2, 성심 -2. 반년 동안 이 자리에 다시 거론되지 않는다.' },
        ],
      };
    },
    resolve(s, c, key) {
      delete s.flags[`reserve_${c.office}`];
      const p = P(s);
      const o = OFFICE_MAP[c.office];
      if (!inCourt(p)) return;
      if (key === 'accept') {
        appoint(s, p, c.office);
        return `${o.name}에 부임했다.`;
      }
      p.prestige = clamp(p.prestige + 2, 0, 100);
      p.favor = clamp(p.favor - 2, -100, 100);
      s.flags[`declined_${c.office}`] = s.t + 6;
      return `${o.name} 자리를 사양했다. 사림이 그 겸양을 칭송한다.`;
    },
  },

  cosign_request: {
    build(s, c) {
      const init = s.chars[c.initiator];
      const tgt = c.target ? s.chars[c.target] : undefined;
      const what =
        c.topic === 'impeach'
          ? `${tgt ? officeTitle(tgt) : ''} ${tgt ? josa(tgt.name, '을/를') : ''}(${tgt ? fname(tgt.faction) : ''}) 탄핵하는 상소`
          : c.topic === 'recall'
            ? `유배 중인 ${tgt?.name}의 신원을 청하는 상소`
            : '시폐를 논하는 상소';
      return {
        title: '연명 요청',
        kind: 'court',
        text: `같은 당의 ${josa(init.name, '이/가')} ${what}에 연명해 달라고 청해 왔다.`,
        choices: [
          {
            key: 'accept',
            label: '연명한다',
            hint:
              c.topic === 'impeach'
                ? `${init.name} 호감 +10. 논핵이 2개월 이어지며 당신은 동조자가 된다. ${tgt?.name}과 그 가문의 원한을 산다.`
                : `${init.name} 호감 +10. 성공하면 명망 +2.`,
          },
          { key: 'decline', label: '거절한다', hint: `${init.name} 호감 -8, 당내 평판 소폭 하락` },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const init = s.chars[c.initiator];
      const tgt = c.target ? s.chars[c.target] : undefined;
      if (!alive(init)) return;
      const allies = members(s, init.faction)
        .filter((x) => x.id !== init.id && !isP(s, x) && x.status === 'active')
        .slice(0, 2)
        .map((x) => x.id);
      const cos = key === 'accept' ? [p.id, ...allies] : allies;
      let msg = '';
      if (key === 'accept') {
        msg = sway(s, init, p.id, 10, '연명 동참', { faction: 0.15 }).join(', ');
        if (c.topic === 'impeach' && alive(tgt)) sway(s, tgt, p.id, -15, '탄핵 연명', { clan: 0.3 });
      } else {
        msg = sway(s, init, p.id, -8, '연명 거절', {}).join(', ');
        if (p.faction === init.faction) swayFaction(s, p.faction, p.id, -2, '연명 거절');
      }
      if (c.topic === 'impeach') {
        if (alive(tgt) && tgt.status === 'active' && tgt.office) openCase(s, init, tgt, { pros: cos });
      } else {
        const r = memorial(s, init, c.topic, cos, c.target);
        if (key === 'accept') pushEvent(s, 'memorial_report', { result: r, topic: c.topic });
      }
      return msg;
    },
  },

  veto_request: {
    build(s, c) {
      const init = s.chars[c.initiator];
      const tgt = c.target ? s.chars[c.target] : undefined;
      return {
        title: '승정원에 들어온 상소',
        kind: 'court',
        text: `${fname(init.faction)} ${init.name}의 ${TOPIC_LABEL[c.topic as keyof typeof TOPIC_LABEL]}${tgt ? `(${tgt.name} 관련)` : ''} 한 통이 승정원에 들어왔다. 도승지인 당신은 이를 왕에게 올리지 않고 돌려보낼 수 있다.`,
        choices: [
          { key: 'pass', label: '그대로 올린다' },
          {
            key: 'veto',
            label: '돌려보낸다 (봉환)',
            hint: '상소는 무산되지만 「언로 차단」 흠결이 드러난다. 올린 이와 그 당이 반감을 품는다.',
          },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const init = s.chars[c.initiator];
      if (!alive(init)) return;
      if (key === 'pass') {
        memorial(s, init, c.topic, [], c.target);
        return '상소를 그대로 올렸다.';
      }
      addFlaw(s, p, '언로 차단', true);
      const fx = sway(s, init, p.id, -30, '상소 봉환', { faction: 0.3, decay: 0.15 });
      log(s, `도승지 ${josa(p.name, '이/가')} ${init.name}의 상소를 돌려보냈다.`, 'player');
      return `상소를 돌려보냈다. (${fx.join(', ')})`;
    },
  },

  dong_split: {
    build(s) {
      const p = P(s);
      return {
        title: '동인의 분열',
        kind: 'history',
        text: `정철의 처벌을 두고 동인이 둘로 갈라섰다. 정철 한 사람만 벌하자는 온건파는 남인, 서인을 일망타진하자는 강경파는 북인이라 불린다.\n\n당신은 지금 ${FACTION_META[p.faction].name}으로 분류되었다. 어느 편에 설 것인가?`,
        choices: [
          { key: 'nam', label: '남인 — 류성룡·우성전과 함께한다', hint: FACTION_META.nam.desc },
          { key: 'buk', label: '북인 — 이산해·정인홍과 함께한다', hint: FACTION_META.buk.desc },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const f = key === 'buk' ? 'buk' : 'nam';
      if (p.faction !== f) {
        swayFaction(s, p.faction, p.id, -10, '등을 돌림', 0.05);
        p.faction = f;
      }
      p.lean = f;
      swayFaction(s, f, p.id, 5, '새 동지', 0.05);
      if (s.flags.wing === f) swayFaction(s, f, p.id, 8, '일찍부터 함께함', 0.03);
      else if (s.flags.wing) swayFaction(s, f, p.id, -5, '말을 바꿈', 0.05);
      s.player.deeds.push(`${shortDate(s.t)} ${FACTION_META[f].name}에 섬`);
      return `${FACTION_META[f].name}에 섰다.`;
    },
  },

  gamsa_tribute: {
    build(s) {
      const p = P(s);
      const t = tributeAmounts(s);
      const h = harvestOf(s, p.location);
      const harsh = h < 0 ? 10 + 5 * -h : 10;
      const note =
        h === 1 ? '올해는 풍작이라 곳간이 넉넉하다.' : h === -1 ? '올해는 흉작이라 거둘 것이 적고, 더 짜내면 백성이 버티지 못한다.' : h === -2 ? '올해는 대흉년이다. 백성은 초근목피로 연명한다.' : '올해 작황은 평년작이다.';
      return {
        title: '공납을 거둘 때',
        kind: 'court',
        text: `추수가 끝나 ${officeTitle(p).replace(' 관찰사', '')}의 공납을 거둘 때가 되었다. ${note}\n\n${REGION_META[p.location].short}의 살림: ${REGION_ECON[p.location].produce}.`,
        choices: [
          { key: 'clean', label: '청렴 — 정해진 만큼만 거두어 모두 나라에 바친다', hint: `명망 +3, 민심 +${h < 0 ? 6 : 4}` },
          { key: 'normal', label: '관행 — 관례대로 거두고 관례대로 남긴다', hint: `재산 +${t.normal}${h < 0 ? ', 민심 -3' : ''}` },
          { key: 'exploit', label: '수탈 — 방납을 눈감아 주고 몫을 챙긴다', hint: `재산 +${t.exploit}, 숨은 흠결 1, 민심 -${harsh}` },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const r = s.regions[p.location];
      const t = tributeAmounts(s);
      const h = harvestOf(s, p.location);
      if (key === 'clean') {
        p.prestige = clamp(p.prestige + 3, 0, 100);
        r.minsim = clamp(r.minsim + (h < 0 ? 6 : 4), 0, 100);
        return '청렴하게 공납을 거두었다.';
      }
      if (key === 'normal') {
        p.wealth += t.normal;
        if (h < 0) r.minsim = clamp(r.minsim - 3, 0, 100);
        return `관례대로 거두었다. 재산 +${t.normal}`;
      }
      p.wealth += t.exploit;
      addFlaw(s, p, '공납 착복');
      r.minsim = clamp(r.minsim - (h < 0 ? 10 + 5 * -h : 10), 0, 100);
      return `두둑이 챙겼다. 재산 +${t.exploit}. 누군가 장부를 들여다보지 않기를 바랄 뿐이다.`;
    },
  },
};

export { OUTCOME_LABEL };
