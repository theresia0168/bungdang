import { useG } from './ctx';
import type { FocusKind, MemorialTopic } from '../engine/types';
import { P, officeTitle, statusLabel } from '../engine/state';
import { FACTION_META, REGION_META, SCHOOL_META, TRAIT_META } from '../engine/data/meta';
import { FOCUS_INFO, PROJECTS, RETAINER_UPKEEP, SELF_ACTIONS, focusCheck, runSelfAction, setFocus } from '../engine/actions';
import { BOND } from '../engine/relations';
import { TOPIC_LABEL } from '../engine/conflict';
import { standing } from '../engine/factions';
import { playerCases, sideOf } from '../engine/cases';
import { GOALS, GOAL_REWARD, goalKey, reconsiderGoal } from '../engine/goals';
import { GUIDE, guideOn } from '../engine/tutorial';
import { Bar, CharLink, FactionBadge, Opinion, Portrait } from './common';
import { Tip } from './guide';

const PICK_FOCUS: FocusKind[] = ['duty', 'study', 'social', 'teach', 'estate', 'rest', 'seowon', 'munjip'];
const MEMORIALS: { topic: MemorialTopic; desc: string }[] = [
  { topic: 'sipye', desc: '시정의 폐단을 논한다. 받아들여지면 명망과 성심이 오른다. 가장 쉽다.' },
  { topic: 'jojae', desc: '붕당의 화합을 청한다. 받아들여지면 긴장도가 크게 내리지만 당내에서 미온적이라는 말을 듣는다.' },
];

export function PlayerPanel() {
  const { s, act, select } = useG();
  const p = P(s);
  const pl = s.player;
  const f = pl.focus;
  const ex = pl.exp;
  const tgt = f?.targetId ? s.chars[f.targetId] : undefined;
  const st = p.faction !== 'none' ? standing(s, p.faction) : null;
  const leader = p.faction !== 'none' && s.factions[p.faction].leader === p.id;
  const myCases = playerCases(s);
  const sc = pl.scheme;
  const debtors = Object.entries(pl.debts)
    .filter(([id, n]) => n > 0 && s.chars[id] && s.chars[id].status !== 'dead')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const bonds = pl.bonds.filter((b) => s.chars[b.with] && s.chars[b.with].status !== 'dead');

  return (
    <div className="panel player">
      <div className="pp-head" onClick={() => select(p.id)}>
        <Portrait c={p} size={64} />
        <div>
          <div className="pp-name">
            {p.name}
            {p.ho && <small> {p.ho}</small>}
          </div>
          <div className="pp-office">{officeTitle(p)}</div>
          <div className="pp-sub">
            <FactionBadge f={p.faction} full /> {leader && <span className="leader-tag">영수</span>} · {statusLabel(p)} · {REGION_META[p.location].short}
          </div>
        </div>
      </div>

      <div className="pp-stats">
        <Tip k="learning" s={s} place="right">
          <div>
            <span>
              학식 <em className="cap">학문의 깊이</em>
            </span>
            <b>{p.learning}</b>
            <Bar value={ex.learning} max={20 + p.learning * 6} />
          </div>
        </Tip>
        <Tip k="politics" s={s} place="right">
          <div>
            <span>
              정치력 <em className="cap">수완과 처세</em>
            </span>
            <b>{p.politics}</b>
            <Bar value={ex.politics} max={20 + p.politics * 6} />
          </div>
        </Tip>
      </div>
      <div className="pp-row small">
        <span title={SCHOOL_META[p.school].desc}>{SCHOOL_META[p.school].name}</span>
        <span>· 자녀 {pl.children}</span>
        <span>· 문인 {pl.disciples}</span>
        {st !== null && (
          <span title={`${FACTION_META[p.faction].name} 사람들이 당신을 보는 평균 호감`}>
            · 당내 평판 <Opinion v={st} />
          </span>
        )}
      </div>
      <div className="trait-row">
        {p.traits.map((t) => (
          <span key={t} className="trait" title={TRAIT_META[t].desc}>
            {TRAIT_META[t].name}
          </span>
        ))}
      </div>

      {guideOn(s) && (
        <section className="pp-sec guide">
          <h4>
            첫 해의 길잡이 <span className="muted small">하나마다 명망 +1</span>
            <button className="mini" onClick={() => act((g) => void (g.flags.guideOff = true))} title="길잡이를 닫는다">
              닫기
            </button>
          </h4>
          <ul className="guide-list">
            {GUIDE.map((g) => {
              const done = pl.guide.includes(g.id);
              return (
                <li key={g.id} className={done ? 'done' : ''} title={g.how}>
                  <span className="guide-box">{done ? '✓' : ''}</span>
                  <span>
                    {g.name}
                    {!done && <em className="muted small"> — {g.how}</em>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="pp-sec goal">
        <h4>
          뜻 <span className="muted small">이루면 명망 +4 · 점수 +{GOAL_REWARD}</span>
          <button className="mini" onClick={() => act((g) => reconsiderGoal(g))} title="다른 뜻을 세운다">
            {pl.goal ? '바꾸기' : '세우기'}
          </button>
        </h4>
        {pl.goal ? (
          <div className="goal-now">
            <b>{goalKey(s, pl.goal)}</b>
            <span className="small muted">{GOALS[pl.goal.kind].progress(s, pl.goal).text}</span>
          </div>
        ) : (
          <div className="muted small">아직 세운 뜻이 없다.</div>
        )}
        {pl.goalsDone.length > 0 && <div className="small good-text">이룬 뜻 {pl.goalsDone.length}: {pl.goalsDone.join(' · ')}</div>}
      </section>

      {myCases.length > 0 && (
        <section className="pp-sec case-alert">
          {myCases.map((cs) => {
            const side = sideOf(cs, p.id);
            const atk = s.chars[cs.attacker];
            const tg = s.chars[cs.target];
            const left = cs.due - s.t;
            return (
              <div key={cs.id} className={side === 'target' ? 'bad' : ''}>
                {side === 'target' ? (
                  <>
                    <b>{cs.kind === 'aggravate' ? '가죄 공방' : '논핵당하는 중'}</b> 공격 <CharLink id={atk.id} /> · {left}달 뒤 판정 · 동조 {cs.pros.length} · 구원 {cs.cons.length}
                    <div className="small">신세를 진 이에게 「구원 요청」을 하라.</div>
                  </>
                ) : (
                  <>
                    <b>{side === 'attacker' ? '논핵을 이끄는 중' : side === 'pro' ? '동조 중' : '구원 중'}</b> <CharLink id={tg.id} /> · {left}달 뒤 판정 · 동조 {cs.pros.length} · 구원 {cs.cons.length}
                    {side === 'attacker' && <div className="small">인물 창에서 「연명 요청」으로 동조를 모으라.</div>}
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="pp-sec">
        <h4>이번 달의 일</h4>
        {f ? (
          <div className="focus-now">
            <b>{f.kind === 'memorial' ? TOPIC_LABEL[f.topic ?? 'sipye'] : FOCUS_INFO[f.kind].name}</b>
            {tgt && <span> — {tgt.name}</span>}
            {f.kind === 'memorial' && (
              <>
                <Bar value={f.progress} max={f.required} />
                <span className="small muted">
                  {f.progress}/{f.required}개월 · 연명 {f.cosigners.length}인 (인물 창에서 연명을 청하라)
                </span>
              </>
            )}
            {(f.kind === 'seowon' || f.kind === 'munjip') && (
              <>
                <Bar value={pl.projects[f.kind] ?? 0} max={PROJECTS[f.kind].months} />
                <span className="small muted">
                  {pl.projects[f.kind] ?? 0}/{PROJECTS[f.kind].months}개월 · 매달 재산 {PROJECTS[f.kind].cost}
                </span>
              </>
            )}
            {f.kind === 'teach' && <Bar value={f.progress} max={6} label="다음 문인까지" />}
          </div>
        ) : (
          <div className="focus-now muted">하는 일 없이 지낸다. 아래에서 고르라.</div>
        )}
        {p.status === 'active' && p.office && f?.kind !== 'duty' && <p className="small muted">직무는 저절로 돌아간다 (성심·정치 경험이 조금씩).</p>}
        <div className="focus-grid">
          {PICK_FOCUS.map((k) => {
            const err = focusCheck(s, k);
            return (
              <button
                key={k}
                className={`fbtn ${f?.kind === k ? 'on' : ''}`}
                disabled={!!err || f?.kind === k}
                title={err ?? (f?.kind === k ? '지금 하고 있는 일이다' : FOCUS_INFO[k].desc)}
                onClick={() => act((g) => setFocus(g, k))}
              >
                {FOCUS_INFO[k].name}
                {(k === 'seowon' || k === 'munjip') && (pl.projects[k] ?? 0) > 0 && f?.kind !== k && (
                  <small> {pl.projects[k]}/{PROJECTS[k].months}</small>
                )}
              </button>
            );
          })}
          {MEMORIALS.map((m) => {
            const err = focusCheck(s, 'memorial');
            const on = f?.kind === 'memorial' && f.topic === m.topic;
            return (
              <button
                key={m.topic}
                className={`fbtn ${on ? 'on' : ''}`}
                disabled={!!err || on}
                title={err ?? `${m.desc} 2개월이 걸리며 그동안 연명을 모은다.`}
                onClick={() => act((g) => setFocus(g, 'memorial', m.topic))}
              >
                {TOPIC_LABEL[m.topic].replace(/\(.*\)/, '')}
              </button>
            );
          })}
        </div>
        {f?.kind === 'memorial' && <p className="small muted">다른 일을 고르면 쓰던 상소는 버려진다.</p>}
        {(f?.kind === 'seowon' || f?.kind === 'munjip') && <p className="small muted">다른 일을 골라도 진척은 남는다.</p>}
      </section>

      {(sc || debtors.length > 0 || bonds.length > 0 || pl.retainers > 0 || pl.proteges.length > 0) && (
        <section className="pp-sec">
          <h4>공작과 신세</h4>
          {bonds.length > 0 && (
            <div className="debtors small">
              <span className="muted">맹약 </span>
              {bonds.map((b) => (
                <span key={b.with} title={BOND.desc}>
                  <CharLink id={b.with} />
                  <em>{b.secret ? '밀약' : '맹약'}</em>
                </span>
              ))}
            </div>
          )}
          {(pl.retainers > 0 || pl.proteges.length > 0) && (
            <div className="small muted">
              {pl.retainers > 0 && `식객 ${pl.retainers}명 (매달 재산 -${pl.retainers * RETAINER_UPKEEP})`}
              {pl.retainers > 0 && pl.proteges.length > 0 && ' · '}
              {pl.proteges.length > 0 && (
                <>
                  과거 준비 중인 제자{' '}
                  {pl.proteges.map((id) => (
                    <CharLink key={id} id={id} />
                  ))}
                </>
              )}
            </div>
          )}
          {sc && (
            <div className="scheme-now">
              뒷조사 — <CharLink id={sc.targetId} />
              <Bar value={sc.progress} max={sc.required} />
              <span className="small muted">
                {sc.progress}/{sc.required}개월 · 다른 일과 함께 굴러간다
              </span>
            </div>
          )}
          {debtors.length > 0 && (
            <div className="debtors small">
              <span className="muted">나에게 신세 진 이 </span>
              {debtors.map(([id, n]) => (
                <span key={id}>
                  <CharLink id={id} />
                  <em>{'●'.repeat(n)}</em>
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="pp-sec">
        <h4>
          거취 <span className="muted small">행동력을 쓰지 않는다 (근신 제외)</span>
        </h4>
        <div className="focus-grid">
          {SELF_ACTIONS.map((a) => {
            const err = a.check(s);
            return (
              <button key={a.id} className="fbtn" disabled={!!err} title={err ?? a.desc} onClick={() => act((g) => runSelfAction(g, a.id))}>
                {a.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="pp-sec deeds">
        <h4>행장(行狀)</h4>
        {pl.deeds.length ? (
          <ul>
            {pl.deeds
              .slice(-8)
              .reverse()
              .map((d, i) => (
                <li key={i}>{d}</li>
              ))}
          </ul>
        ) : (
          <p className="muted small">아직 기록할 만한 일이 없다.</p>
        )}
      </section>
    </div>
  );
}
