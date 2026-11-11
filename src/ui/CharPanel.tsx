import { useG } from './ctx';
import type { Character, GameState } from '../engine/types';
import { P, age, inCourt, isP, knownFlaws, officeTitle, statusLabel } from '../engine/state';
import { FACTION_META, REGION_META, SCHOOL_META, TRAIT_META } from '../engine/data/meta';
import { opinion, opinionLines, inLaws, topOf } from '../engine/opinion';
import { BOND, bondWith, contactMult, knowsWant, wantName, WANT_META } from '../engine/relations';
import { TARGET_ACTIONS, actionError, runTargetAction, type TargetActionId } from '../engine/actions';
import { sideOf } from '../engine/cases';
import { influence } from '../engine/factions';
import { OFFICE_MAP, rankLabel } from '../engine/data/offices';
import { yearOf } from '../engine/calendar';
import { ApPips, CharLink, FactionBadge, Opinion, Portrait, Stat } from './common';
import { Tip } from './guide';

/** 조건이 맞을 때만 보이는 행동 */
const CONTEXTUAL: TargetActionId[] = ['recommend', 'ask_recommend', 'cosign', 'plead', 'recall', 'blackmail', 'reconcile', 'hush', 'sponsor', 'bribe'];

/** 이 사람이 나에게 어떤 쓸모가 있는가 */
function usesOf(s: GameState, c: Character, op: number): [string, string][] {
  const p = P(s);
  const out: [string, string][] = [];
  const o = c.status === 'active' && c.office ? OFFICE_MAP[c.office] : undefined;
  if (c.office === 'ijo') out.push(['', '인사권 — 그의 호감이 모든 임용 점수에 들어간다. 천거 부탁과 뇌물이 통한다.']);
  else if (c.office === 'jeonrang') out.push(['', '통청권 — 그의 호감이 삼사·청요직 임용에 크게 들어간다. 천거 부탁과 뇌물이 통한다.']);
  else if (o?.samsa) out.push(['', '언관 — 상소 없이 바로 탄핵할 수 있다. 우군이면 든든한 칼, 적이면 위협.']);
  else if (c.office === 'doseungji') out.push(['', '도승지 — 미워하는 사람의 상소를 왕에게 올리지 않고 돌려보낼 수 있다.']);
  else if (o?.rank === 1) out.push(['', '정승 — 조정 쟁점과 정국의 방향에 큰 힘을 쓴다.']);
  if (c.faction !== 'none' && s.factions[c.faction].leader === c.id) out.push(['', '영수 — 자리 경쟁에서 제 당 후보를 밀고, 당론을 이끈다.']);
  if (c.want && knowsWant(s, c)) out.push(['good', `바람 「${wantName(s, c)}」 — ${WANT_META[c.want.kind].how}`]);
  else if (c.want) out.push(['muted', '무언가 바라는 것이 있는 듯하다. 탐문하거나 찾아가 담소하면 알 수 있다.']);
  const same = p.faction !== 'none' && topOf(p.faction) === topOf(c.faction);
  if (!bondWith(s, c.id) && inCourt(c)) {
    if (same) out.push([op >= 50 ? 'good' : 'muted', `맹약 — 호감 50이면 청할 수 있다 (지금 ${op})`]);
    else if (c.faction !== 'none' && p.faction !== 'none') out.push([op >= 40 ? 'good' : 'muted', `밀서 — 다른 당이라 몰래 맺어야 한다. 호감 40 필요 (지금 ${op})`]);
  }
  const t = c.traits;
  if (t.includes('greedy')) out.push(['', '탐욕 — 선물·뇌물·입막음이 잘 통하지만, 선물을 받으면 약점이 되기 쉽다.']);
  if (t.includes('upright')) out.push(['', '강직 — 선물·뇌물·입막음을 물리치고, 협박에 굴하지 않는다.']);
  if (t.includes('clean')) out.push(['', '청렴 — 선물이 잘 통하지 않는다.']);
  if (t.includes('scholar') || t.includes('writer')) out.push(['', '학자 — 서책 선물을 반기고, 학문을 논하면 마음을 연다.']);
  if (t.includes('mild') || t.includes('mediator')) out.push(['', '온화 — 화해 청함이 잘 통한다.']);
  return out;
}

export function CharPanel({ id }: { id: string }) {
  const { s, act, select } = useG();
  const c = s.chars[id];
  const p = P(s);
  const me = isP(s, c);
  const theyThink = me ? 0 : opinion(s, c, p);
  const lines = me ? [] : opinionLines(s, c, p);
  const iThink = me ? 0 : opinion(s, p, c);
  const flaws = knownFlaws(c, p.id);
  const hidden = me ? c.flaws.filter((f) => !f.public) : [];
  const kin = Object.values(s.chars).filter((x) => x.id !== c.id && x.clan === c.clan && x.status !== 'dead');
  const disciples = Object.values(s.chars).filter((x) => x.teacher === c.id && x.status !== 'dead');
  const leaderOf = c.faction !== 'none' && s.factions[c.faction].leader === c.id;
  const dead = c.status === 'dead';
  const cases = s.cases.filter((cs) => sideOf(cs, c.id));
  const tags: [string, string][] = [];
  if (!me) {
    const owed = s.player.debts[c.id] ?? 0;
    if (owed) tags.push(['good', `나에게 신세 ${'●'.repeat(owed)}`]);
    const intel = s.player.intel[c.id];
    if (intel) tags.push([intel.dirty ? 'warn' : '', `탐문 ${s.t - intel.t}달 전: ${intel.dirty ? '무언가 숨기는 낌새' : '깨끗해 보인다'}`]);
    if (s.player.scheme?.targetId === c.id) tags.push(['', `뒷조사 중 ${s.player.scheme.progress}/${s.player.scheme.required}`]);
    for (const b of s.player.bonds.filter((x) => x.with === c.id)) tags.push(['good', `${BOND.name}${b.secret ? ' (비밀)' : ''}`]);
    if (s.player.proteges.includes(c.id)) tags.push(['good', '내 제자 — 식년시를 준비한다']);
    const plot = s.plots.find((x) => x.by === c.id && x.known);
    if (plot) tags.push(['bad', `나를 노리는 중 · 약 ${Math.max(1, plot.due - s.t)}달 뒤`]);
    const race = s.races.find((r) => r.candidates.includes(c.id));
    if (race) tags.push(['', `${OFFICE_MAP[race.office].name} 후보`]);
    const n = (s.player.contacts[c.id] ?? []).filter((m) => s.t - m < 12).length;
    if (n) tags.push(['', `최근 1년 교유 ${n}회 · 효과 ×${Math.round(contactMult(s, c) * 100) / 100}`]);
  }
  if (c.status === 'exiled' && (c.exileLevel ?? 1) >= 2) tags.push(['bad', '위리안치 — 한 번 더 죄를 입으면 사약']);
  if ((c.banUntil ?? 0) > s.t) tags.push(['warn', `삭탈관작 — ${c.banUntil! - s.t}달 동안 서용 불가`]);
  const uses = me || dead ? [] : usesOf(s, c, theyThink);

  return (
    <div className="panel charp" style={{ ['--fc' as string]: FACTION_META[c.faction].color }}>
      <button className="close" onClick={() => select(null)} title="닫기 (Esc)">
        ×
      </button>
      <div className="cp-head">
        <Portrait c={c} size={72} />
        <div>
          <div className="cp-name">
            {c.name}
            {c.ho && <small> {c.ho}</small>}
            {me && <span className="me-tag">나</span>}
          </div>
          <div className="cp-office">{officeTitle(c)}</div>
          <div className="cp-sub">
            <FactionBadge f={c.faction} full />
            {leaderOf && <span className="leader-tag">영수</span>} · {statusLabel(c)}
            {c.status !== 'royal' && ` · ${rankLabel(c.rank)}`}
          </div>
        </div>
      </div>

      <div className="cp-meta">
        {c.clan} · {dead && c.death ? `향년 ${yearOf(c.death.t) - c.born}세` : `${age(s, c)}세`}
        {' · '}
        <span title={SCHOOL_META[c.school].desc}>{SCHOOL_META[c.school].name}</span> · 고향 {REGION_META[c.home].short}
        {c.location !== c.home && !dead && ` · 지금 ${REGION_META[c.location].short}`}
      </div>
      {dead && c.death && <div className="cp-death">{c.death.cause}</div>}
      {!dead && (tags.length > 0 || cases.length > 0) && (
        <div className="cp-tags">
          {tags.map(([cls, t]) => (
            <span key={t} className={`ctag ${cls}`}>
              {t}
            </span>
          ))}
          {cases.map((cs) => {
            const side = sideOf(cs, c.id);
            const other = side === 'target' ? s.chars[cs.attacker] : s.chars[cs.target];
            const what = cs.kind === 'aggravate' ? '가죄' : '논핵';
            const label =
              side === 'target'
                ? `${other.name}에게 ${what}당하는 중`
                : side === 'attacker'
                  ? `${other.name} ${what}을 이끄는 중`
                  : side === 'pro'
                    ? `${other.name} ${what}에 동조`
                    : `${other.name} 구원`;
            return (
              <span key={cs.id} className={`ctag ${side === 'target' ? 'bad' : ''}`}>
                {label} · {cs.due - s.t}달 뒤 판정
              </span>
            );
          })}
        </div>
      )}

      <div className="cp-stats">
        <Tip k="learning" s={me ? s : undefined} place="down-end">
          <Stat label="학식" value={c.learning} />
        </Tip>
        <Tip k="politics" s={me ? s : undefined} place="down-end">
          <Stat label="정치력" value={c.politics} />
        </Tip>
        <Tip k="vigor" s={me ? s : undefined} place="down-end">
          <Stat label="강건" value={c.vigor} />
        </Tip>
        <Tip k="prestige" s={me ? s : undefined} place="down-end">
          <Stat label="명망" value={Math.round(c.prestige)} />
        </Tip>
        <Tip k="favor" s={me ? s : undefined} place="down-end">
          <Stat label="성심" value={Math.round(c.favor)} />
        </Tip>
        <Stat label="영향력" value={influence(s, c)} title="당내 영향력. 가장 높은 이가 영수가 된다." />
      </div>

      <div className="trait-row">
        {c.traits.map((t) => (
          <span key={t} className="trait" title={TRAIT_META[t].desc}>
            {TRAIT_META[t].name}
          </span>
        ))}
      </div>

      {c.bio && <p className="cp-bio">{c.bio}</p>}

      {(flaws.length > 0 || hidden.length > 0) && (
        <section className="cp-sec">
          <h4>흠결</h4>
          <div className="flaw-row">
            {flaws.map((f) => (
              <span key={f.id} className={`flaw ${f.public ? 'public' : 'known'}`} title={f.public ? '세상에 드러난 흠결' : me ? `${f.knownBy.length}명이 알고 있다` : '당신만 아는 약점'}>
                {f.label}
                {!f.public && !me && ' (약점)'}
              </span>
            ))}
          </div>
          {me && hidden.some((f) => f.knownBy.length) && <p className="small warn-text">남이 쥐고 있는 흠결은 탄핵당할 때 상대에게 +1이 된다.</p>}
        </section>
      )}

      {!me && !dead && c.status !== 'royal' && (
        <section className="cp-sec">
          <h4>
            그가 보는 나 <Opinion v={theyThink} />
            <span className="muted small"> · 내가 보는 그 {iThink > 0 ? `+${iThink}` : iThink}</span>
          </h4>
          <ul className="op-lines">
            {lines.map((l, i) => (
              <li key={i}>
                <span>{l.label}</span>
                <Opinion v={l.value} />
              </li>
            ))}
            {!lines.length && <li className="muted">특별한 감정이 없다.</li>}
          </ul>
        </section>
      )}

      {!me && !dead && c.status !== 'royal' && uses.length > 0 && (
        <section className="cp-sec">
          <h4>쓸모</h4>
          <ul className="use-list small">
            {uses.map(([cls, t], i) => (
              <li key={i} className={cls}>
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!me && !dead && c.status !== 'royal' && (
        <section className="cp-sec">
          <h4>
            교유와 공작 <ApPips />
          </h4>
          <div className="act-grid">
            {TARGET_ACTIONS.map((a) => {
              const own = a.check(s, c);
              if (own && CONTEXTUAL.includes(a.id) && /이어야|없다|아니다|않다|당사자/.test(own)) return null;
              const err = actionError(s, a, c);
              const cost = a.cost(s);
              return (
                <button key={a.id} className="abtn" disabled={!!err} onClick={() => act((g) => runTargetAction(g, a.id, c.id))} title={a.desc}>
                  <b>
                    {a.name}
                    <span className={`cost ${cost === 'authority' ? 'auth' : cost === 0 ? 'free' : ''}`}>
                      {cost === 'authority' ? '직권' : cost === 0 ? '상소' : '●'.repeat(cost)}
                    </span>
                  </b>
                  <span>{err ?? a.desc}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="cp-sec">
        <h4>관계</h4>
        <div className="rel">
          {c.teacher && (
            <div>
              스승 <CharLink id={c.teacher} />
            </div>
          )}
          {disciples.length > 0 && (
            <div>
              문인{' '}
              {disciples.slice(0, 8).map((d) => (
                <CharLink key={d.id} id={d.id} />
              ))}
            </div>
          )}
          {kin.length > 0 && (
            <div>
              {c.clan.split(' ')[0]} 일가{' '}
              {kin.slice(0, 10).map((k) => (
                <CharLink key={k.id} id={k.id} />
              ))}
            </div>
          )}
          {!me && inLaws(s, p.clan, c.clan) && <div className="good-text">당신 가문과 혼맥으로 이어져 있다.</div>}
          {c.grudges.length > 0 && (
            <div>
              원한{' '}
              {c.grudges.map((g) => (
                <CharLink key={g} id={g} />
              ))}
            </div>
          )}
          {c.exiledBy && c.status === 'exiled' && (
            <div>
              유배시킨 이 <CharLink id={c.exiledBy} />
            </div>
          )}
          {!c.teacher && !disciples.length && !kin.length && !c.grudges.length && <div className="muted">알려진 관계가 없다.</div>}
        </div>
      </section>
    </div>
  );
}
