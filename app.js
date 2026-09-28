// Agent coverage review. Synthetic, deterministic data: monthly volume per
// regulated task type and sector, plus per task confidence and exception
// curves. Everything on the page is computed from TASKS and the two curve
// functions below, nothing downstream is hardcoded.

const SECTORS = ['Banking', 'Insurance', 'Government'];
const SECTOR_FX = {
  Banking:    { exc: 1.00, conf: 0.000 },
  Insurance:  { exc: 0.95, conf: 0.002 },
  Government: { exc: 1.12, conf: -0.006 },
};

// live: agent runs end to end today. lock: policy keeps a human as the decision maker
// (adverse determinations about a person). median: confidence score half the items clear.
// e0: exception rate among auto approved items at a 0.85 threshold. min: manual handling minutes.
const TASKS = [
  { name: 'Document intake', volume: 48000, min: 4,  median: 0.970, e0: 0.012, live: true,  mix: [.40, .35, .25] },
  { name: 'Escalation routing', volume: 34000, min: 5, median: 0.960, e0: 0.009, live: true,  mix: [.35, .35, .30] },
  { name: 'Policy compliance check',            volume: 26000, min: 7,  median: 0.920, e0: 0.028, live: true,  mix: [.40, .40, .20] },
  { name: 'KYC identity verification',          volume: 22000, min: 9,  median: 0.930, e0: 0.024, live: true,  mix: [.70, .20, .10] },
  { name: 'Claims FNOL intake', volume: 18000, min: 11, median: 0.940, e0: 0.016, live: false, mix: [0, 1, 0] },
  { name: 'Loan application triage',            volume: 16000, min: 14, median: 0.925, e0: 0.020, live: false, mix: [.85, 0, .15] },
  { name: 'AML alert triage',                   volume: 14000, min: 22, median: 0.900, e0: 0.045, live: false, mix: [.90, .05, .05] },
  { name: 'Benefits eligibility', volume: 12000, min: 25, median: 0.915, e0: 0.035, live: false, lock: true, mix: [0, .10, .90] },
];

const CMAX = 0.97, SPREAD = 0.025, DECAY = 0.07;
// Share of items whose calibrated confidence clears threshold t
const coverageAt = (median, t) => CMAX / (1 + Math.exp((t - median) / SPREAD));
// Exception rate among auto approved items at threshold t
const exceptionAt = (e0, t) => e0 * Math.exp(-(t - 0.85) / DECAY);
// Lowest threshold that keeps exceptions at or under a limit
const thresholdFor = (e0, limit) => Math.min(0.98, Math.max(0.80, 0.85 + DECAY * Math.log(e0 / limit)));

const state = { sector: 'All sectors', t: 0.90, limit: 2.0, view: 'today', nWanted: 2, n: 2, guard: 0, assist: 35, sort: { col: 'rank', dir: 1 } };

function aggregate() {
  const sectors = state.sector === 'All sectors' ? SECTORS : [state.sector];
  const g = state.guard / 100, L = state.limit / 100;
  const rows = TASKS.map(task => {
    const parts = sectors.map(s => ({ s, vol: task.volume * task.mix[SECTORS.indexOf(s)] })).filter(p => p.vol > 0);
    const volume = parts.reduce((a, p) => a + p.vol, 0);
    if (!volume) return null;
    const w = f => parts.reduce((a, p) => a + f(p) * p.vol, 0) / volume;
    const median = w(p => task.median + SECTOR_FX[p.s].conf);
    const e0 = w(p => task.e0 * SECTOR_FX[p.s].exc) * (1 - g);
    const coverage = coverageAt(median, state.t);
    const exc = exceptionAt(e0, state.t);
    const fullHrs = volume * task.min / 60;
    const over = exc > L;
    let status, stake;
    if (task.lock) { status = 'Human in the loop'; stake = fullHrs * state.assist / 100; }
    else if (task.live) { status = over ? 'Live, over limit' : 'Agent live'; stake = 0; }
    else { status = over ? 'Guardrail first' : 'Expand next'; stake = over ? 0 : fullHrs * coverage; }
    return {
      name: task.name, live: task.live, lock: !!task.lock, volume, min: task.min, median, e0, coverage, exc, over, status, stake, fullHrs,
      potential: fullHrs * coverage, guardNeeded: Math.max(0, 1 - L / (exceptionAt(e0 / (1 - g || 1), state.t))),
    };
  }).filter(Boolean);
  const ranked = [...rows].sort((a, b) => b.stake - a.stake || b.potential - a.potential);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const expandList = ranked.filter(r => r.status === 'Expand next');
  return { rows, ranked, expandList };
}

const $ = id => document.getElementById(id);
const F = Viz.fmt;

function plan(rows, expandList, n) {
  const chosen = expandList.slice(0, n);
  const chosenSet = new Set(chosen.map(r => r.name));
  const expHrs = chosen.reduce((a, r) => a + r.stake, 0);
  const assistHrs = rows.filter(r => r.lock).reduce((a, r) => a + r.stake, 0);
  const running = rows.filter(r => r.live || chosenSet.has(r.name));
  const autoItems = running.reduce((a, r) => a + r.volume * r.coverage, 0);
  const excItems = running.reduce((a, r) => a + r.volume * r.coverage * r.exc, 0);
  const total = rows.reduce((a, r) => a + r.volume, 0);
  return { chosen, chosenSet, expHrs, assistHrs, hours: expHrs + assistHrs, fte: (expHrs + assistHrs) / 160, autoRate: autoItems / total, excItems, excPer10k: autoItems ? excItems / autoItems * 1e4 : 0 };
}

function render() {
  const { rows, ranked, expandList } = aggregate();
  state.n = Math.min(state.nWanted, expandList.length); // keep the user's choice if the list grows back
  const today = plan(rows, expandList, 0);
  const p = plan(rows, expandList, state.n);
  const c1 = Viz.css('--viz-1'), c2 = Viz.css('--viz-2'), cm = Viz.css('--viz-muted');
  const total = rows.reduce((a, r) => a + r.volume, 0);
  const overCount = rows.filter(r => r.over && !r.lock).length;
  const atStake = expandList.reduce((a, r) => a + r.stake, 0);
  const sectorTxt = state.sector === 'All sectors' ? 'all sectors' : state.sector.toLowerCase();

  $('kpis').innerHTML = `
    <div class="stat"><div class="label">Tasks processed</div><div class="num">${F.k(total)}</div><div class="desc">Items per month, ${sectorTxt}</div></div>
    <div class="stat"><div class="label">Fully automated</div><div class="num">${F.pct(today.autoRate, 1)}</div><div class="desc">End to end today at threshold ${state.t.toFixed(3)}</div></div>
    <div class="stat"><div class="label">Types over exception limit</div><div class="num">${overCount} of ${rows.filter(r => !r.lock).length}</div><div class="desc">Agent eligible task types above ${state.limit.toFixed(1)}%</div></div>
    <div class="stat"><div class="label">Manual hours at stake</div><div class="num">${F.int(atStake)}</div><div class="desc">Per month across ${expandList.length} shadow task type${expandList.length === 1 ? '' : 's'} under the limit</div></div>`;

  // Stacked handling view, today or after the expansion plan
  const after = state.view === 'after';
  $('stackSub').textContent = (after ? `After moving ${state.n} task type${state.n === 1 ? '' : 's'} to live` : 'Current deployment') + `, ${sectorTxt}`;
  const byVol = [...rows].sort((a, b) => b.volume - a.volume);
  Viz.stack100($('stackChart'), {
    rows: byVol.map(r => {
      const running = r.live || (after && p.chosenSet.has(r.name));
      const cov = running ? r.coverage : 0;
      const clean = cov * (1 - r.exc), ex = cov * r.exc, human = 1 - cov;
      return {
        label: r.name,
        segs: [{ value: clean, color: c1, label: clean > 0.2 ? F.pct(clean, 0) : '' }, { value: ex, color: c2 }, { value: human, color: cm, label: human > 0.2 ? F.pct(human, 0) : '' }],
        tip: Viz.tipHtml(r.name, [['Monthly items', F.int(r.volume)], ['Mode', running ? 'Agent live' : r.lock ? 'Human decides, agent assists' : 'Shadow mode'], ['End to end, clean', F.pct(clean, 1)], ['Exceptions', F.pct(ex, 2)], ['Escalated to human', F.pct(human, 1)]]),
      };
    }),
  });

  // Coverage against exception rate
  const agentRows = rows.filter(r => !r.lock); // policy locked tasks are never automated, so they have no coverage point
  const maxVol = Math.max(...agentRows.map(r => r.volume));
  Viz.scatter($('scatter'), {
    points: agentRows.map(r => ({
      x: r.exc * 100, y: r.coverage * 100, r: 5 + 12 * Math.sqrt(r.volume / maxVol), color: r.over ? c2 : c1,
      label: r.name, showLabel: r.rank === 1 || (r.over && !r.lock && r.volume === Math.max(...rows.filter(x => x.over && !x.lock).map(x => x.volume))),
      tip: Viz.tipHtml(r.name, [['Coverage', F.pct(r.coverage, 1)], ['Exception rate', F.pct(r.exc, 2)], ['Monthly items', F.int(r.volume)], ['Status', r.status]]),
    })),
    xLabel: 'Exception rate among automated items', yLabel: 'Coverage at threshold', xFmt: v => v + '%', yFmt: v => v + '%', yMax: 100,
    xMax: Math.max(Viz.niceMax(Math.max(...agentRows.map(r => r.exc * 100), state.limit) * 1.15), 1),
    refX: { value: state.limit, label: 'limit' },
  });

  renderTable(rows, p);
  renderFindings(rows, ranked, today);
  renderActions(rows, expandList, p);
  renderImpact(rows, expandList, p, today);
}

function renderTable(rows, p) {
  const sorted = Viz.sortRows(rows, state.sort);
  const maxStake = Math.max(1, ...rows.map(r => r.stake));
  const cls = s => ({ 'Agent live': 'good', 'Expand next': 'info', 'Guardrail first': 'flag', 'Live, over limit': 'flag', 'Human in the loop': 'alt' }[s]);
  $('rankBody').innerHTML = sorted.map(r => `
    <tr class="${p.chosenSet.has(r.name) ? 'selected' : ''}">
      <td class="num rank">${r.rank}</td>
      <td class="name">${r.name}</td>
      <td class="num">${F.int(r.volume)}</td>
      <td class="num">${r.lock ? 'n/a' : F.pct(r.coverage, 1)}</td>
      <td class="num">${F.pct(r.exc, 2)}</td>
      <td class="num">${r.stake ? `<span class="bar-cell" style="width:${(r.stake / maxStake * 50).toFixed(0)}px"></span>` : ''}${F.int(r.stake)}</td>
      <td><span class="tag ${cls(r.status)}">${r.over && !r.lock ? '&#9650; ' : ''}${r.status}</span></td>
    </tr>`).join('');
  Viz.markSorted($('rankTable'), state.sort);
}

function renderFindings(rows, ranked, today) {
  const L = state.limit / 100, g = state.guard / 100;
  const live = rows.filter(r => r.live);
  const liveAt = t => {
    const items = live.reduce((a, r) => a + r.volume, 0);
    const auto = live.reduce((a, r) => a + r.volume * coverageAt(r.median, t), 0);
    const exc = live.reduce((a, r) => a + r.volume * coverageAt(r.median, t) * exceptionAt(r.e0, t), 0);
    return { cov: auto / items, exc: exc / auto };
  };
  const now = liveAt(state.t), up = liveAt(Math.min(0.98, state.t + 0.02));

  // Per task thresholds: each eligible task at the lowest threshold that meets the limit
  const eligible = rows.filter(r => !r.lock);
  const hoursAt = (r, t) => r.volume * r.min / 60 * coverageAt(r.median, t);
  let globalHrs = 0, perTaskHrs = 0;
  eligible.forEach(r => {
    globalHrs += r.over ? 0 : hoursAt(r, state.t);
    const ti = thresholdFor(r.e0, L);
    perTaskHrs += exceptionAt(r.e0, ti) <= L + 1e-9 ? hoursAt(r, ti) : 0;
  });

  const blocked = rows.filter(r => r.status === 'Guardrail first' || r.status === 'Live, over limit');
  const topVol = [...rows].sort((a, b) => b.volume - a.volume)[0];
  const topHrs = [...rows].sort((a, b) => b.fullHrs - a.fullHrs)[0];

  $('findings').innerHTML = `
    <div class="finding"><strong>The threshold is a real tradeoff</strong>On live tasks, threshold ${state.t.toFixed(3)} automates ${F.pct(now.cov, 1)} of items at a ${F.pct(now.exc, 2)} exception rate. Raising it to ${Math.min(0.98, state.t + 0.02).toFixed(3)} gives up ${((now.cov - up.cov) * 100).toFixed(1)} points of coverage to cut exceptions to ${F.pct(up.exc, 2)}. That is a question about the cost of an error in each workflow, not a single model metric.</div>
    <div class="finding"><strong>One global threshold leaves hours on the table</strong>Setting each task's threshold to the lowest value that still meets the ${state.limit.toFixed(1)}% limit would automate work worth ${F.int(perTaskHrs)} reviewer hours a month across agent eligible tasks, against ${F.int(globalHrs)} under the single global threshold, a ${perTaskHrs >= globalHrs ? 'gain' : 'change'} of ${F.int(perTaskHrs - globalHrs)} hours with no task above the limit.</div>
    <div class="finding"><strong>${blocked.length ? 'The guardrail is the unlock' : 'Nothing is blocked by the limit'}</strong>${blocked.length ? blocked.map(r => `<em>${r.name}</em> sits at ${F.pct(r.exc, 2)} and needs about a ${(r.guardNeeded * 100).toFixed(0)}% exception cut to clear the limit`).join('; ') + `. ${g ? `With the current ${state.guard}% guardrail applied.` : 'A verifier pass with that effect makes it eligible without lowering the bar.'}` : `At this threshold${g ? ' and guardrail' : ''}, every agent eligible task is under the ${state.limit.toFixed(1)}% limit.`}</div>
    <div class="finding"><strong>Volume is not where the hours are</strong><em>${topVol.name}</em> has the most items (${F.int(topVol.volume)} a month) at ${topVol.min} minutes each, while <em>${topHrs.name}</em> carries the largest manual hours pool (${F.int(topHrs.fullHrs)} a month) at ${topHrs.min} minutes per item. Expansion should be ranked on handling time times coverage, not item count.</div>`;
}

function renderActions(rows, expandList, p) {
  const next = expandList[0];
  const guard = rows.filter(r => r.status === 'Guardrail first');
  const locked = rows.filter(r => r.lock);
  const overLive = rows.filter(r => r.status === 'Live, over limit');
  $('actions').innerHTML = `
    <li><div><h3>${next ? `Move ${next.name} to live next` : 'No shadow task clears the limit yet'}</h3><p>${next ? `It clears the limit at ${F.pct(next.exc, 2)} exceptions, automates ${F.pct(next.coverage, 0)} of ${F.int(next.volume)} monthly items, and removes about ${F.int(next.stake)} reviewer hours a month. Roll out behind a canary with QA sampling at twice the steady state rate for the first two weeks.` : 'Lower the threshold only with a guardrail in place, or raise the limit only with business sign off.'}</p><div class="meta"><span class="tag info">${next ? F.int(next.stake) + ' hrs / month' : 'Blocked'}</span><span class="tag good">Applied AI</span></div></div></li>
    <li><div><h3>${guard.length ? `Add a verification guardrail before expanding ${guard.map(r => r.name).join(', ')}` : overLive.length ? `Pull ${overLive.map(r => r.name).join(', ')} back under the limit` : 'Keep the verifier ready for the next task'}</h3><p>${guard.length ? `Chain a second pass verifier prompt, schema validation on extracted fields, and a citation check against the source documents. It needs to cut exceptions by about ${(Math.max(...guard.map(r => r.guardNeeded)) * 100).toFixed(0)}% to clear the limit at this threshold; measure that in shadow mode before any traffic moves.` : overLive.length ? 'A live task over the limit should get a higher per task threshold today and the verifier chain before the next release.' : 'Every agent eligible task is under the limit at this setting.'}</p><div class="meta"><span class="tag flag">${guard.length + overLive.length} task type${guard.length + overLive.length === 1 ? '' : 's'}</span><span class="tag info">Guardrails</span></div></div></li>
    <li><div><h3>Keep a human as decision maker on ${locked.map(r => r.name).join(', ') || 'adverse determinations'}</h3><p>Adverse decisions about a person stay with a reviewer. Run the agent in assist mode: it assembles evidence, drafts the determination with citations, and routes low confidence cases to senior review. At ${state.assist}% time saved that is ${F.int(p.assistHrs)} hours a month without changing who decides.</p><div class="meta"><span class="tag alt">Human in the loop</span></div></div></li>
    <li><div><h3>Move from a global threshold to per task thresholds</h3><p>Calibrate each task's confidence separately, set its threshold from its own exception curve, and check calibration weekly with reliability curves on QA samples so drift shows up before exceptions do.</p><div class="meta"><span class="tag good">Evaluation</span></div></div></li>`;
}

function renderImpact(rows, expandList, p, today) {
  const nEl = $('nTasks');
  nEl.max = expandList.length;
  nEl.value = state.n;
  nEl.disabled = !expandList.length;
  $('nTasksVal').textContent = state.n;
  $('guardVal').textContent = state.guard + '%';
  $('assistVal').textContent = state.assist + '%';
  $('nTasksList').textContent = expandList.length
    ? `Eligible in ranked order: ${expandList.map((r, i) => (i < state.n ? '✓ ' : '') + r.name).join(', ')}`
    : 'No shadow task is under the limit at this threshold. Try the guardrail slider.';
  $('impactOut').innerHTML = `
    <div class="big hero"><div class="label">Manual review hours removed per month</div><div class="num">${F.int(p.hours)}</div><div class="desc">${p.fte.toFixed(1)} reviewer FTE: ${F.int(p.expHrs)} from expansion, ${F.int(p.assistHrs)} from assist mode</div></div>
    <div class="big"><div class="label">Automated end to end</div><div class="num">${F.pct(p.autoRate, 1)}</div><div class="desc">Of all items, up from ${F.pct(today.autoRate, 1)} today</div></div>
    <div class="big"><div class="label">Exceptions reaching QA</div><div class="num">${F.int(p.excItems)}</div><div class="desc">Per month, ${p.excPer10k.toFixed(0)} per 10,000 automated items</div></div>`;
  const pts = [];
  for (let n = 0; n <= expandList.length; n++) pts.push({ x: n, y: plan(rows, expandList, n).expHrs });
  if (pts.length < 2) pts.push({ x: 1, y: 0 });
  Viz.line($('curve'), {
    points: pts, current: state.n, xLabel: 'Shadow task types moved to live, in ranked order', xFmt: v => v, yFmt: v => F.k(v) + 'h',
    tipFor: pt => Viz.tipHtml(pt.x ? `Top ${pt.x} task type${pt.x > 1 ? 's' : ''}` : 'No expansion', [['Hours removed', F.int(pt.y)], ['Added by this task', pt.x ? F.int(pt.y - pts[pt.x - 1].y) : '0']]),
  });
  $('assume').textContent = `Only shadow tasks under the exception limit are eligible, so the curve's length changes with the threshold, limit, and guardrail. Assumptions: coverage follows each task's calibrated confidence curve (logistic around its median score), exception rate falls exponentially as the threshold rises, a guardrail scales exceptions down uniformly without cutting coverage, and a reviewer FTE is 160 hours a month.`;
}

function renderToggles() {
  Viz.toggle($('sectorToggle'), ['All sectors', ...SECTORS], state.sector, v => { state.sector = v; renderToggles(); render(); });
  Viz.toggle($('viewToggle'), [{ value: 'today', label: 'Today' }, { value: 'after', label: 'After plan' }], state.view, v => { state.view = v; renderToggles(); render(); });
}
$('thresh').addEventListener('input', e => { state.t = +e.target.value; $('threshVal').textContent = state.t.toFixed(3); render(); });
$('limit').addEventListener('input', e => { state.limit = +e.target.value; $('limitVal').textContent = state.limit.toFixed(1) + '%'; render(); });
$('nTasks').addEventListener('input', e => { state.nWanted = +e.target.value; render(); });
$('guard').addEventListener('input', e => { state.guard = +e.target.value; render(); });
$('assist').addEventListener('input', e => { state.assist = +e.target.value; render(); });
Viz.sortable($('rankTable'), state.sort, render);

renderToggles();
render();
