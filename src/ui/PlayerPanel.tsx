import { PATH_DESC, PATH_NAME, pathBonus } from '../engine/ending';
import { AUTO_NAMES } from '../engine/turn';
import { useState, type ReactNode } from 'react';
import { MemorialComposer } from './Composer';
import { useG } from './ctx';
import { josa, P, officeTitle, statusLabel } from '../engine/state';
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
  lawMemorialError,
  memorialError,
  monthlyError,
  runMonthly,
  runSelfAction,
  startMemorial,
} from '../engine/actions';
import { LAWS, LAW_MAP, lawOpen } from '../engine/laws';
import { activeFactions } from '../engine/factions';
import { POWERS, powerError, usePower } from '../engine/realm';
import { OFFICE_MAP } from '../engine/data/offices';
import { BOND } from '../engine/relations';
import { TOPIC_LABEL } from '../engine/conflict';
import { standing } from '../engine/factions';
import { LEAD_ACTIONS, leadError, lineOf, partyRank, runLead } from '../engine/party';
import { playerCases, sideOf } from '../engine/cases';
import { GOALS, GOAL_REWARD, goalKey, reconsiderGoal } from '../engine/goals';
import { GUIDE, guideOn } from '../engine/tutorial';
import { Bar, CharLink, FactionBadge, Opinion, Portrait, Fold } from './common';
import { Tip } from './guide';


export function PlayerPanel() {
  const { s, act, select } = useG();
  const p = P(s);
  const pl = s.player;
  const f = pl.focus;
  const powers = POWERS.filter((w) => p.status === 'active' && !!p.office && w.office(p.office));
  const officeHints: string[] = [];
  if (p.status === 'active' && p.office) {
    if (p.office === 'ijo' || p.office === 'jeonrang') officeHints.push('빈자리 의망은 「조정」 탭에서 한다.');
    if (p.office === 'hojo') officeHints.push('한 해 예산은 「국정」 탭에서 짠다.');
    if (p.office.startsWith('gamsa_') || (OFFICE_MAP[p.office]?.rank ?? 9) <= 2) officeHints.push('나라 사업 건의는 「국정」 탭에서 한다.');
    if (OFFICE_MAP[p.office]?.samsa) officeHints.push('언관이라 탄핵을 직권으로 한다 (인물 창).');
  }
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
        {p.eumseo && (
          <span className="trait bad" title="선친의 음덕으로 벼슬길에 나섰다. 청요직(삼사·전랑)과 문형에 오르지 못하고 승진이 더디다. 식년시·별시에 급제하면 벗어난다.">
            음서 출신
          </span>
        )}
        {p.tags.includes('passed') && (
          <span className="trait" title="과거에 급제했다">
            급제
          </span>
        )}
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
        {pl.path && (
          <div className="small" title={PATH_DESC[pl.path]}>
            가문의 길 <b>{PATH_NAME[pl.path]}</b> <span className="muted">· 지금 이룬 몫 +{pathBonus(s)}</span>
          </div>
        )}
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
                    <div className="small">신세를 진 이에게 「연명·구원 요청」을 하라.</div>
                  </>
                ) : (
                  <>
                    <b>{side === 'attacker' ? (cs.backer === p.id ? '대간을 시켜 논핵 중' : '논핵을 이끄는 중') : side === 'pro' ? '동조 중' : '구원 중'}</b> <CharLink id={tg.id} />
                    {cs.backer === p.id && (
                      <span className="small muted">
                        {' '}
                        (앞장선 대간 <CharLink id={cs.attacker} />)
                      </span>
                    )}
                    {cs.backer && cs.attacker === p.id && (
                      <span className="small muted">
                        {' '}
                        (배후 <CharLink id={cs.backer} />)
                      </span>
                    )}{' '}
                    · {left}달 뒤 판정 · 동조 {cs.pros.length} · 구원 {cs.cons.length}
                    {side === 'attacker' && <div className="small">인물 창에서 「연명·구원 요청」으로 동조를 모으라.</div>}
                  </>
                )}
              </div>
            );
          })}
        </section>
      )}

      <Fold id="month" title="이달의 행동" extra={<span className="muted small">행동력 {pl.ap} 남음 · 같은 일은 한 달에 한 번</span>} open>
        <div className="focus-grid">
          {MONTHLY.filter((a) => !a.estate && (!a.id.startsWith('exile_') || p.status === 'exiled')).map((a) => {
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
        {p.status === 'active' && p.office && (
          <>
            <div className="sub-h">
              직무 <span className="muted small">{officeTitle(p)}의 권한 · 직권은 한 달에 한 번</span>
            </div>
            {powers.length > 0 && (
              <div className="focus-grid">
                {powers.map((w) => {
                  const err = powerError(s, w);
                  return (
                    <button key={w.id} className="fbtn" disabled={!!err} title={err ? `${err}\n\n${w.desc}` : w.desc} onClick={() => act((g) => usePower(g, w.id))}>
                      {w.name} <span className="cost auth">직권</span>
                    </button>
                  );
                })}
              </div>
            )}
            {officeHints.length > 0 && <p className="small muted">{officeHints.join(' ')}</p>}
          </>
        )}
      </Fold>

      <Fold id="memorial2" title="상소" open={f?.kind === 'memorial'} extra={f?.kind === 'memorial' ? <span className="muted small">짓는 중 {f.progress}/{f.required}개월</span> : <span className="muted small">주제와 조목을 골라 짓는다</span>}>
        {f?.kind === 'memorial' ? (
          <div className="focus-now">
            <b>
              {f.topic === 'law' && f.lawId ? `${LAW_MAP[f.lawId]?.name} ${f.abolish ? '폐지' : '시행'} 상소` : TOPIC_LABEL[f.topic ?? 'sipye']}
            </b>
            {tgt && <span> — {tgt.name}</span>}
            <Bar value={f.progress} max={f.required} />
            <span className="small muted">
              {f.progress}/{f.required}개월 · 연명 {f.cosigners.length}인 (인물 창에서 「연명·구원 요청」)
            </span>
            <button className="mini" onClick={() => act((g) => dropMemorial(g))}>
              거두기
            </button>
          </div>
        ) : (
          <MemorialComposer />
        )}
      </Fold>

      <Fold id="estate" title="가산" extra={<span className="muted small">재산 {Math.round(p.wealth)} · 전장 {pl.land}결</span>}>
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
                {a.note?.(s) ? <small className="muted"> {a.note(s)}</small> : null}
                <span className="cost">{done ? '✓' : '●'.repeat(a.cost)}</span>
              </button>
            );
          })}
        </div>
      </Fold>

      {p.faction !== 'none' && (() => {
        const pr = partyRank(s);
        if (!pr) return null;
        const leader = pr.leader === p.id;
        return (
          <Fold
            id="lead"
            title={leader ? '당 운영 (영수)' : '당내 서열'}
            extra={
              <span className="muted small">
                {FACTION_META[p.faction].name} {pr.rank}위/{pr.total}명 · 당론 {lineOf(s, p.faction)} · 평판 {standing(s, p.faction)}
              </span>
            }
          >
            {!leader && (
              <div className="small">
                영수 {pr.leader ? <CharLink id={pr.leader} /> : '없음'} · 영향력 당신 {pr.mine} : 영수 {pr.his}
                <div className="muted">영향력은 관직의 무게, 명망, 정치력, 학식, 문인으로 정해진다. 영수의 8할을 넘으면 자리를 다툴 기회가 온다.</div>
              </div>
            )}
            {leader && (
              <div className="focus-grid">
                {LEAD_ACTIONS.map((a) => {
                  const err = leadError(s, a.id);
                  return (
                    <button key={a.id} className="fbtn" disabled={!!err} title={err ? `${err}

${a.desc}` : a.desc} onClick={() => act((g) => runLead(g, a.id))}>
                      {a.name}
                      <span className="cost">●</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Fold>
        );
      })()}

      <Fold id="party" title="당적" extra={<span className="muted small">한평생 {MAX_SWITCHES}번까지 · 지금까지 {pl.factionChanges}번</span>}>
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
      </Fold>

      {(sc || debtors.length > 0 || bonds.length > 0 || pl.retainers > 0 || pl.proteges.length > 0) && (
        <Fold id="web" title="공작과 신세" extra={sc ? <span className="muted small">뒷조사 중</span> : undefined}>
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
        </Fold>
      )}

      <Fold id="self" title="거취" extra={<span className="muted small">행동력을 쓰지 않는다 (근신·통문 제외)</span>}>
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
        {pl.auto && Object.keys(pl.auto).length > 0 && (
          <div className="auto-list">
            <div className="sub-h">알아서 처리하는 일</div>
            {Object.entries(pl.auto).map(([def, key]) => (
              <div key={def} className="small">
                {AUTO_NAMES[def] ?? def} <span className="muted">— {pl.autoLabel?.[def] ?? key}</span>{' '}
                <button
                  className="mini"
                  onClick={() =>
                    act((g) => {
                      const a = { ...(g.player.auto ?? {}) };
                      delete a[def];
                      g.player.auto = a;
                      return `${josa(AUTO_NAMES[def] ?? def, '은/는')} 다시 직접 정한다.`;
                    })
                  }
                >
                  해제
                </button>
              </div>
            ))}
          </div>
        )}
      </Fold>

      <Fold id="deeds" title="행장(行狀)" className="deeds">
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
      </Fold>
    </div>
  );
}
