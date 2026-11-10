import type { GameState } from '../types';
import type { EventDef } from './types';
import { FACTION_META, REGION_META } from '../data/meta';
import { chance, d6, randInt } from '../rng';
import { monthsSince, addFlaw, alive, clamp, isP, josa, owe, P, pushEvent } from '../state';
import { sway, swayFaction, topOf } from '../opinion';
import { genChar } from '../generate';

const fname = (f: string) => FACTION_META[f as keyof typeof FACTION_META].name;

export const INTRIGUE_EVENTS: Record<string, EventDef> = {
  suspicion_confront: {
    build(s) {
      const p = P(s);
      const lead = s.chars[s.factions[p.faction]?.leader ?? ''];
      const who = alive(lead) && !isP(s, lead) ? `당의 영수 ${josa(lead.name, '이/가')}` : '당의 원로들이';
      return {
        title: '내통의 의심',
        kind: 'danger',
        text: `${who} 당신을 불렀다. 요즘 다른 당 사람들과 너무 가까이 지낸다는 말이 돈다며, 어느 편에 설 것인지 분명히 하라고 다그친다.\n\n당내 내통 의심: ${Math.round(s.player.suspicion)}`,
        choices: [
          { key: 'explain', label: '사사로운 교분일 뿐이라고 해명한다', hint: `정치력 판정 (주사위 + ${p.politics} ≥ 8). 성공하면 의심 -25, 실패하면 의심 -10에 당 호감 -3.` },
          { key: 'cut', label: '그들과 발길을 끊겠다고 맹세한다', hint: '의심이 사라지고 당 호감 +3. 다른 당 사람들과 맺은 지기는 끊어지고 그들의 호감 -10.' },
          { key: 'defy', label: '당색보다 사람이 먼저라고 맞선다', hint: `명망 +2${p.traits.includes('mediator') ? ' (조제: +2 더)' : ''}, 당 호감 -8. 의심 -5.` },
        ],
      };
    },
    resolve(s, _c, key) {
      const p = P(s);
      const pl = s.player;
      if (key === 'explain') {
        const r = d6(s) + p.politics;
        if (r >= 8) {
          pl.suspicion = Math.max(0, pl.suspicion - 25);
          return `말을 잘 골라 의심을 누그러뜨렸다. (판정 ${r})`;
        }
        pl.suspicion = Math.max(0, pl.suspicion - 10);
        const fx = swayFaction(s, p.faction, p.id, -3, '궁색한 변명', 0.1);
        return `변명이 궁색했다. (판정 ${r}${fx ? `, ${fx}` : ''})`;
      }
      if (key === 'cut') {
        pl.suspicion = 0;
        const cut: string[] = [];
        for (const b of [...pl.bonds]) {
          const c = s.chars[b.with];
          if (!alive(c) || b.kind !== 'jigi' || topOf(c.faction) === topOf(p.faction)) continue;
          pl.bonds = pl.bonds.filter((x) => x !== b);
          sway(s, c, p.id, -10, '발길을 끊음', { decay: 0.1 });
          cut.push(c.name);
        }
        for (const id of Object.keys(pl.contacts)) {
          const c = s.chars[id];
          if (c && c.faction !== 'none' && topOf(c.faction) !== topOf(p.faction)) delete pl.contacts[id];
        }
        const fx = swayFaction(s, p.faction, p.id, 3, '당론을 따름', 0.1);
        return `다른 당 사람들과의 왕래를 끊었다.${cut.length ? ` ${cut.join(', ')}과의 지기가 끊어졌다.` : ''}${fx ? ` (${fx})` : ''}`;
      }
      p.prestige = clamp(p.prestige + 2 + (p.traits.includes('mediator') ? 2 : 0), 0, 100);
      pl.suspicion = Math.max(0, pl.suspicion - 5);
      const fx = swayFaction(s, p.faction, p.id, -8, '당론을 무시함', 0.1);
      return `물러서지 않았다. 사람들은 당신을 군자라 부르기도, 고집쟁이라 부르기도 했다.${fx ? ` (${fx})` : ''}`;
    },
  },

  letter_intercepted: {
    build(s, c) {
      const p = P(s);
      const t = s.chars[c.with];
      return {
        title: '가로채인 밀서',
        kind: 'danger',
        text: `${t?.name ?? '그'}에게 보낸 밀서가 중간에 가로채였다는 소식이 들어왔다. 편지는 지금 누군가의 손에 들려 조정에 돌고 있다.${c.cross ? `\n\n${fname(t.faction)} 사람과 몰래 손잡으려 한 것이 드러나면 당에서 큰 의심을 산다.` : ''}`,
        choices: [
          { key: 'deny', label: '모함이라고 잡아뗀다', hint: `정치력 판정 (주사위 + ${p.politics} ≥ 9). 성공하면 의심 +10으로 끝나고, 실패하면 「밀서 왕래」 흠결이 드러나고 명망 -3${c.cross ? ', 의심 +35' : ', 의심 +15'}.` },
          { key: 'admit', label: '사실대로 밝히고 사죄한다', hint: `「밀서 왕래」 흠결이 드러나고 명망 -2, 성심 -2${c.cross ? ', 의심 +20' : ''}.` },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      const t = s.chars[c.with];
      const pl = s.player;
      if (key === 'deny') {
        const r = d6(s) + p.politics;
        if (r >= 9) {
          pl.suspicion = clamp(pl.suspicion + 10, 0, 100);
          return `위작이라고 우겨 넘어갔다. 그래도 의심의 눈길은 남았다. (판정 ${r})`;
        }
        addFlaw(s, p, '밀서 왕래', true);
        p.prestige = clamp(p.prestige - 3, 0, 100);
        pl.suspicion = clamp(pl.suspicion + (c.cross ? 35 : 15), 0, 100);
        if (alive(t)) sway(s, t, p.id, -6, '밀서가 드러남', { decay: 0.2 });
        return `거짓말까지 들통났다. (판정 ${r}, 흠결 공개, 명망 -3)`;
      }
      addFlaw(s, p, '밀서 왕래', true);
      p.prestige = clamp(p.prestige - 2, 0, 100);
      p.favor = clamp(p.favor - 2, -100, 100);
      if (c.cross) pl.suspicion = clamp(pl.suspicion + 20, 0, 100);
      return '솔직히 밝히고 대죄했다. (흠결 공개, 명망 -2, 성심 -2)';
    },
  },

  req_exempt: {
    build(s, c) {
      const a = s.chars[c.asker];
      return {
        title: '군역 면제 청탁',
        kind: 'court',
        text: `${josa(a.name, '이/가')} 재물을 싸 들고 와서, 자기 집안 노비와 소작인의 군역을 빼 달라고 청한다. 흔한 일이라지만 그만큼 가난한 백성이 대신 짐을 진다.`,
        choices: [
          { key: 'yes', label: '들어준다', hint: `재산 +15, ${josa(a.name, "이/가")} 신세를 진다. 35% 확률로 「군역 면제 청탁」 흠결(그가 앎). 명망 -1.` },
          { key: 'no', label: '공도(公道)를 지킨다', hint: `명망 +2, ${a.name} 호감 -8` },
        ],
      };
    },
    resolve(s, c, key) {
      const a = s.chars[c.asker];
      const p = P(s);
      if (!alive(a)) return;
      if (key === 'yes') {
        p.wealth += 15;
        p.prestige = clamp(p.prestige - 1, 0, 100);
        owe(s, a.id);
        const fx = sway(s, a, p.id, 8, '청탁을 들어줌', { decay: 0.15 });
        if (chance(s, 0.35)) addFlaw(s, p, '군역 면제 청탁', false, [a.id]);
        return `청을 들어주고 재물을 받았다. (재산 +15, ${fx.join(', ')})`;
      }
      p.prestige = clamp(p.prestige + 2, 0, 100);
      return `청탁을 물리쳤다. (명망 +2, ${sway(s, a, p.id, -8, '청탁 거절', { decay: 0.15 }).join(', ')})`;
    },
  },

  req_trial: {
    build(s, c) {
      const a = s.chars[c.asker];
      return {
        title: '옥사(獄事) 청탁',
        kind: 'court',
        text: `${josa(a.name, '이/가')} 다급하게 찾아왔다. 그의 친척이 살인 사건에 얽혀 옥에 갇혔는데, 당신이 손을 써서 가볍게 처결되도록 해 달라는 것이다. 죄가 분명한지는 알 수 없다.`,
        choices: [
          { key: 'yes', label: '손을 써 준다', hint: `${josa(a.name, "이/가")} 두 번 신세를 지고 재산 +10. 40% 확률로 「옥사 청탁」 흠결(그가 앎), 그중 일부는 곧바로 소문이 난다.` },
          { key: 'no', label: '법대로 하라고 돌려보낸다', hint: `명망 +3, ${a.name} 호감 -12, 원한을 살 수 있다.` },
        ],
      };
    },
    resolve(s, c, key) {
      const a = s.chars[c.asker];
      const p = P(s);
      if (!alive(a)) return;
      if (key === 'yes') {
        p.wealth += 10;
        owe(s, a.id, 2);
        const fx = sway(s, a, p.id, 12, '친척을 살려 줌', { clan: 0.3, decay: 0.1 });
        if (chance(s, 0.4)) {
          const pub = chance(s, 0.3);
          addFlaw(s, p, '옥사 청탁', pub, [a.id]);
          if (pub) {
            p.prestige = clamp(p.prestige - 4, 0, 100);
            return `옥사에 손을 썼는데 소문이 나고 말았다. (흠결 공개, 명망 -4, ${fx.join(', ')})`;
          }
        }
        return `옥사에 손을 써 주었다. 그가 두 번 신세를 졌다. (${fx.join(', ')})`;
      }
      p.prestige = clamp(p.prestige + 3, 0, 100);
      const fx = sway(s, a, p.id, -12, '친척을 외면', { clan: 0.3, decay: 0.1 });
      if (chance(s, 0.4) && !a.grudges.includes(p.id)) a.grudges.push(p.id);
      return `법대로 하라고 돌려보냈다. (명망 +3, ${fx.join(', ')})`;
    },
  },

  talent: {
    build(s, c) {
      const p = P(s);
      return {
        title: '눈에 띄는 젊은이',
        kind: 'personal',
        text: `${REGION_META[p.home].short}의 한 젊은 선비가 글을 들고 찾아왔다. 문장에 기개가 있고 학문이 깊다. 집안이 가난해 과거 공부를 이어 가기 어렵다고 한다.\n\n그를 거두어 후원하면 당신의 제자가 되어 다음 식년시에 응시한다. 급제하면 조정에서 당신 편에 서고, 논핵이 벌어지면 부르지 않아도 나선다.`,
        choices: [
          { key: 'yes', label: '거두어 후원한다 (재산 20)', hint: `제자로 삼는다 (학식 ${c.learning}). 식년시에서 급제 판정 +2.`, disabled: p.wealth < 20 ? '재산이 모자란다' : undefined },
          { key: 'no', label: '격려만 하고 돌려보낸다', hint: '명망 +1' },
        ],
      };
    },
    resolve(s, c, key) {
      const p = P(s);
      if (key !== 'yes' || p.wealth < 20) {
        p.prestige = clamp(p.prestige + 1, 0, 100);
        return '좋은 말을 해 주어 돌려보냈다.';
      }
      p.wealth -= 20;
      const y = genChar(s, {
        rank: 9,
        age: randInt(s, 18, 23),
        status: 'retired',
        faction: p.faction === 'none' ? undefined : p.faction,
        home: p.home,
        school: p.school,
        teacher: p.id,
        learning: c.learning,
      });
      y.location = p.home;
      s.player.proteges.push(y.id);
      sway(s, y, p.id, 30, '스승의 은혜', { decay: 0.02, cap: 30 });
      return `${josa(y.name, '을/를')} 제자로 거두었다. 다음 식년시를 기다린다.`;
    },
  },
};

export function rollTalent(s: GameState) {
  const p = P(s);
  if (s.pending.length >= 2 || p.status === 'exiled' || p.wealth < 20 || s.player.proteges.length >= 2) return;
  if (monthsSince(s, 'talentAt') < 12) return;
  const ch = (p.learning >= 6 ? 0.04 : 0.02) + (s.player.focus?.kind === 'teach' ? 0.06 : 0) + (p.status === 'retired' ? 0.02 : 0);
  if (!chance(s, ch)) return;
  s.flags.talentAt = s.t;
  pushEvent(s, 'talent', { learning: randInt(s, 4, 6) });
}