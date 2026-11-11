import { useState } from 'react';
import { useG } from './ctx';
import { P, officeTitle, statusLabel } from '../engine/state';
import { FACTION_META, REGION_META, SCHOOL_META, TRAIT_META } from '../engine/data/meta';
import {
  MAX_SWITCHES,
  MEMORIAL_INFO,
  MONTHLY,
  PROJECTS,
  RETAINER_UPKEEP,
  SELF_ACTIONS,
  dropMemorial,
  expNeed,
  joinError,
  joinFaction,
  leaveError,
  leaveFaction,
  memorialError,
  monthlyError,
  runMonthly,
  runSelfAction,
  startMemorial,
} from '../engine/actions';
import { LAWS, LAW_MAP, lawOpen } from '../engine/laws';
import { activeFactions } from '../engine/factions';
import { BOND } from '../engine/relations';
import { TOPIC_LABEL } from '../engine/conflict';
import { standing } from '../engine/factions';
import { playerCases, sideOf } from '../engine/cases';
import { GOALS, GOAL_REWARD, goalKey, reconsiderGoal } from '../engine/goals';
import { GUIDE, guideOn } from '../engine/tutorial';
import { Bar, CharLink, FactionBadge, Opinion, Portrait } from './common';
import { Tip } from './guide';


export function PlayerPanel() {
  const { s, act, select } = useG();
  const p = P(s);
  const pl = s.player;
  const f = pl.focus;
  const [lawChoice, setLawPick] = useState('sumi');
  const openLaws = LAWS.filter((l) => lawOpen(s, l));
  const lawPick = openLaws.some((l) => l.id === lawChoice) ? lawChoice : (openLaws[0]?.id ?? '');
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
            <Bar value={ex.learning} max={expNeed(p.learning)} />
          </div>
        </Tip>
        <Tip k="politics" s={s} place="right">
          <div>
            <span>
              정치력 <em className="cap">수완과 처세</em>
            </span>
            <b>{p.politics}</b>
            <Bar value={ex.politics} max={expNeed(p.politics)} />
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
        <h4>
          이달의 행동 <span className="muted small">행동력 {pl.ap} 남음 · 같은 일은 한 달에 한 번</span>
        </h4>
        <div className="focus-grid">
          {MONTHLY.filter((a) => !a.estate).map((a) => {
            const err = monthlyError(s, a);
            const done = pl.done.includes(a.id);
            const prog = a.id === 'seowon' || a.id === 'munjip' ? pl.projects[a.id] ?? 0 : 0;
            if ((a.id === 'teach' || a.id === 'rest') && err && !done && !pl.sick && p.status !== 'retired') return null;
            return (
              <button
                key={a.id}
                className={`fbtn ${done ? 'on' : ''}`}
                disabled={!!err}
                title={err ? `${err}\n\n${a.desc}` : a.desc}
                onClick={() => act((g) => runMonthly(g, a.id))}
              >
                {a.name}
                {prog > 0 && (
                  <small>
                    {' '}
                    {prog}/{PROJECTS[a.id as 'seowon' | 'munjip'].months}
                  </small>
                )}
                <span className="cost">{done ? '✓' : '●'.repeat(a.cost)}</span>
              </button>
            );
          })}
        </div>
        {p.status === 'active' && p.office && !pl.done.includes('work') && (
          <p className="small muted">업무 집중을 석 달 넘게 거르면 성심이 조금씩 식는다.</p>
        )}
        {p.id === pl.charId && <p className="small muted">학식 {expNeed(p.learning)} · 정치 {expNeed(p.politics)}의 경험이 차야 한 단계 오른다.</p>}
      </section>

      <section className="pp-sec">
        <h4>상소</h4>
        {f?.kind === 'memorial' ? (
          <div className="focus-now">
            <b>
              {f.topic === 'law' && f.lawId ? `${LAW_MAP[f.lawId]?.name} ${f.abolish ? '폐지' : '시행'} 상소` : TOPIC_LABEL[f.topic ?? 'sipye']}
            </b>
            {tgt && <span> — {tgt.name}</span>}
            <Bar value={f.progress} max={f.required} />
            <span className="small muted">
              {f.progress}/{f.required}개월 · 연명 {f.cosigners.length}인 (인물 창에서 「연명 요청」)
            </span>
            <button className="mini" onClick={() => act((g) => dropMemorial(g))}>
              거두기
            </button>
          </div>
        ) : (
          <>
            <div className="law-pick">
              <select value={lawPick} onChange={(e) => setLawPick(e.target.value)}>
                {openLaws.map((l) => (
                  <option key={l.id} value={l.id}>
                    {s.laws[l.id]?.on ? `${l.name} 폐지` : `${l.name} 시행`}
                  </option>
                ))}
              </select>
              <button
                className="fbtn"
                disabled={!!memorialError(s) || !LAW_MAP[lawPick]}
                title={memorialError(s) ?? `${MEMORIAL_INFO.law.desc}\n\n${LAW_MAP[lawPick]?.desc ?? ''}\n효과: ${LAW_MAP[lawPick]?.effect ?? ''}`}
                onClick={() => act((g) => startMemorial(g, 'law', { lawId: lawPick, abolish: !!g.laws[lawPick]?.on }))}
              >
                변법 상소
              </button>
            </div>
            <div className="focus-grid">
              <button className="fbtn" disabled={!!memorialError(s)} title={memorialError(s) ?? MEMORIAL_INFO.jojae.desc} onClick={() => act((g) => startMemorial(g, 'jojae'))}>
                조제 상소
              </button>
            </div>
            <p className="small muted">상소는 행동력이 들지 않는다. 두 달 동안 지으며 연명을 모은다. 나라의 법은 「국정」 탭에서 볼 수 있다.</p>
          </>
        )}
      </section>

      <section className="pp-sec">
        <h4>
          가산 <span className="muted small">재산 {Math.round(p.wealth)}</span>
        </h4>
        <div className="small">
          전장 {pl.land}결{pl.hiddenLand > 0 && <span className="bad-text"> (은결 {pl.hiddenLand})</span>}
          {pl.loans.length > 0 && <span> · 놓은 장리 {pl.loans.map((l) => `${l.amount}(${l.due - s.t}달 뒤)`).join(', ')}</span>}
        </div>
        <div className="focus-grid">
          {MONTHLY.filter((a) => a.estate).map((a) => {
            const err = monthlyError(s, a);
            const done = pl.done.includes(a.id);
            return (
              <button key={a.id} className={`fbtn ${done ? 'on' : ''}`} disabled={!!err} title={err ? `${err}\n\n${a.desc}` : a.desc} onClick={() => act((g) => runMonthly(g, a.id))}>
                {a.name}
                <span className="cost">{done ? '✓' : '●'.repeat(a.cost)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="pp-sec">
        <h4>
          당적 <span className="muted small">한평생 {MAX_SWITCHES}번까지 · 지금까지 {pl.factionChanges}번</span>
        </h4>
        <div className="focus-grid">
          {activeFactions(s)
            .filter((x) => x !== 'none' && x !== p.faction)
            .map((x) => {
              const err = joinError(s, x);
              return (
                <button
                  key={x}
                  className="fbtn"
                  disabled={!!err}
                  title={err ?? `${FACTION_META[x].name}에 들기를 청한다. ${p.faction === 'none' ? '' : '지금의 당을 버리는 일이라 옛 동지들의 원한을 산다.'}`}
                  onClick={() => act((g) => joinFaction(g, x))}
                >
                  {p.faction === 'none' ? '입당' : '전향'}: {FACTION_META[x].name}
                </button>
              );
            })}
          {p.faction !== 'none' && (
            <button className="fbtn" disabled={!!leaveError(s)} title={leaveError(s) ?? '당을 떠나 어느 편에도 서지 않는다. 옛 당의 호감이 크게 깎인다.'} onClick={() => act((g) => leaveFaction(g))}>
              탈당
            </button>
          )}
        </div>
        <p className="small muted">무당의 인물은 인물 창의 「포섭」으로 끌어들일 수 있다.</p>
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
