// ============================================================
//  Mi presupuesto — funciones ampliadas
//  Historial mensual · gastos reales · gráficos · apuntado rápido
//  objetivos · próximos pagos · CSV · ingresos extra · consejos
//  modo oscuro · app instalable · seguridad
// ============================================================
(function(){
'use strict';

// ---------- utilidades ----------
const LANG = () => { try { return localStorage.getItem('libroLang') || 'es'; } catch (e) { return 'es'; } };
const t3 = (es, it, en) => { const l = LANG(); return l === 'it' ? it : l === 'en' ? en : es; };
const LOC = () => ({ es:'es-ES', it:'it-IT', en:'en-GB' })[LANG()] || 'es-ES';
const pad = n => String(n).padStart(2, '0');
const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => isoDay(new Date());
const curMonth = () => today().slice(0, 7);
function addMonths(m, k){ const [y, mo] = m.split('-').map(Number); return isoDay(new Date(y, mo - 1 + k, 1)).slice(0, 7); }
function monthLabel(m, short){ const [y, mo] = m.split('-').map(Number); const s = new Intl.DateTimeFormat(LOC(), short ? { month:'short' } : { month:'long', year:'numeric' }).format(new Date(y, mo - 1, 1)); return s.charAt(0).toUpperCase() + s.slice(1); }
function dayLabel(d){ const [y, m, dd] = d.split('-').map(Number); return new Intl.DateTimeFormat(LOC(), { weekday:'long', day:'numeric', month:'long' }).format(new Date(y, m - 1, dd)); }
const daysInMonth = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const newId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
const r2 = v => Math.round(v * 100) / 100;
const same = (a, b) => String(a) === String(b);
const esc = s => escapeHtml(s == null ? '' : s);
const fmt2 = n => (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ---------- datos ampliados (tabla user_data en Supabase, con copia local) ----------
let X = null;            // { v, u, tx:[], meta:{}, incomes:[], goals:[], history:{} }
let xMode = 'cloud';     // 'cloud' | 'local'
let selMonth = curMonth();
const uid = () => currentUser && currentUser.id;
function blankX(){ return { v:1, u:0, tx:[], meta:{}, incomes:[], goals:[], history:{} }; }
function normX(d){
  const b = blankX();
  d = (d && typeof d === 'object') ? d : {};
  for (const k in b) if (d[k] == null || typeof d[k] !== typeof b[k] || Array.isArray(d[k]) !== Array.isArray(b[k])) d[k] = b[k];
  d.tx = d.tx.filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(t.d) && isFinite(Number(t.a)));
  return d;
}
const LKEY = id => 'alesagli-x-' + id;
function readLocalX(id){ try { return JSON.parse(localStorage.getItem(LKEY(id)) || 'null'); } catch (e) { return null; } }
function writeLocalX(){ const id = uid(); if (!id || !X) return; try { localStorage.setItem(LKEY(id), JSON.stringify(X)); } catch (e) {} }

window.loadExtra = async function(){
  const id = uid(); if (!id) return;
  X = null;
  let res = null, error = null;
  try { res = await sb.from('user_data').select('data').eq('user_id', id).maybeSingle(); error = res.error; } catch (e) { error = e; }
  const local = readLocalX(id);
  if (error) {
    const txt = (error.code || '') + ' ' + (error.message || '');
    const missing = /PGRST205|42P01|user_data|schema cache|does not exist/i.test(txt);
    xMode = 'local';
    X = normX(local);
    showLocalNote(missing
      ? t3('Tus movimientos y objetivos se guardan solo en este dispositivo hasta que se active su tabla en la nube.', 'Movimenti e obiettivi sono salvati solo su questo dispositivo finché non si attiva la loro tabella nel cloud.', 'Your transactions and goals are saved on this device only until their cloud table is enabled.')
      : t3('Sin conexión: estás viendo la última copia guardada en este dispositivo.', 'Offline: stai vedendo l\'ultima copia salvata su questo dispositivo.', 'Offline: you are seeing the last copy saved on this device.'));
  } else {
    xMode = 'cloud';
    const cloud = res.data ? normX(res.data.data) : null;
    if (cloud && !(local && (local.u || 0) > (cloud.u || 0))) X = cloud;
    else { X = normX(local || cloud); pushX(); }   // la copia local es más nueva (cambios sin conexión)
    showLocalNote('');
  }
  migrateOldGoal();
  writeLocalX();
  renderIncomes(); renderGoals(); refreshViews();
  checkBillReminders();
  if (/[?&]accion=apuntar/.test(location.search)) { history.replaceState(null, '', location.pathname); setTimeout(openSheet, 600); }
};
window.onSignedOut = function(){ X = null; selMonth = curMonth(); stopLockTimer(); };
window.addEventListener('online', () => { if (currentUser && xMode === 'local') loadExtra(); });

const pushX = debounce(async () => {
  const id = uid(); if (!id || !X || xMode !== 'cloud') return;
  setStatus('Guardando…', 'saving');
  let error = null;
  try { ({ error } = await sb.from('user_data').upsert({ user_id: id, data: X, updated_at: new Date().toISOString() })); } catch (e) { error = e; }
  setStatus(error ? 'Error al guardar' : '✓ Guardado en la nube', error ? 'error' : 'ok');
}, 700);
function saveX(){ if (!X) return; X.u = Date.now(); writeLocalX(); pushX(); }
function showLocalNote(t){ const n = $('#localNote'); n.textContent = t; n.hidden = !t; }

// Copia el antiguo «objetivo» único como primer objetivo de la lista (una sola vez).
function migrateOldGoal(){
  if (X.goalsMigrated) return;
  X.goalsMigrated = true;
  const g = toNum(savings.goal);
  if (g > 0 && !X.goals.length) X.goals.push({ id:newId(), emoji: savingsEmoji || '🐷', name: t3('Mi objetivo', 'Il mio obiettivo', 'My goal'), target: g, saved: toNum(savings.now) });
  saveX();
}

// ---------- cálculo ----------
window.extraIncomeTotal = () => X ? X.incomes.reduce((s, i) => s + toNum(i.amount), 0) : 0;
function planNow(){
  let fix = 0, vr = 0;
  expenses.forEach(e => { const a = toNum(e.amount); if (typeOf(e) === 'v') vr += a; else fix += a; });
  return { inc: toNum(salary) + extraIncomeTotal(), fix, vr, plan: fix + vr };
}
function planFor(m){ return m === curMonth() ? planNow() : (X && X.history[m]) || null; }
const txIn = m => X ? X.tx.filter(t => t.d.slice(0, 7) === m) : [];
const findCat = id => expenses.find(e => same(e.id, id));
function spentBy(m){
  const map = {}; let total = 0;
  txIn(m).forEach(t => { const a = toNum(t.a); total += a; const k = (t.c != null && findCat(t.c)) ? String(t.c) : '_'; map[k] = (map[k] || 0) + a; });
  return { map, total };
}
function catOf(id){ const e = (id != null && id !== '_') ? findCat(id) : null; return e ? { emoji: e.emoji || '•', name: e.name || t3('Sin nombre', 'Senza nome', 'Unnamed') } : { emoji:'❓', name: t3('Sin categoría', 'Senza categoria', 'Uncategorised') }; }

function snapshotHistory(){
  if (!X || !window.budgetLoaded) return;
  const p = planNow(), m = curMonth(), h = X.history[m];
  const n = { inc:r2(p.inc), plan:r2(p.plan), fix:r2(p.fix), vr:r2(p.vr) };
  if (!h || h.inc !== n.inc || h.plan !== n.plan || h.fix !== n.fix || h.vr !== n.vr) { X.history[m] = n; saveX(); }
}

window.onBudgetChange = function(){
  if (!X) return;
  snapshotHistory();
  refreshViews();
};
function refreshViews(){
  if (!X) return;
  const it = $('#incomeTotal');
  if (X.incomes.length) { it.hidden = false; it.textContent = t3('Ingresos totales: ', 'Entrate totali: ', 'Total income: ') + money(planNow().inc); } else it.hidden = true;
  decorateRows(); renderMoves(); renderCharts(); renderBills(); renderTips(); updateGoalsProgress();
}

// ---------- 1 · ingresos extra ----------
function renderIncomes(){
  const box = $('#incomeExtra'); box.innerHTML = '';
  if (!X) return;
  X.incomes.forEach(inc => {
    const r = el('div', 'incRow');
    r.innerHTML = `<input class="name" maxlength="60" value="${esc(inc.name)}" placeholder="${esc(t3('Ej. Horas extra', 'Es. Straordinari', 'e.g. Overtime'))}" aria-label="${esc(t3('Nombre del ingreso', 'Nome dell\'entrata', 'Income name'))}"><input class="amount" inputmode="decimal" value="${esc(toInput(inc.amount))}" placeholder="0,00" aria-label="${esc(t3('Importe del ingreso', 'Importo dell\'entrata', 'Income amount'))}"><button type="button" class="remove" aria-label="${esc(t3('Eliminar ingreso', 'Elimina entrata', 'Delete income'))}">×</button>`;
    r.querySelector('.name').oninput = e => { inc.name = e.target.value; saveX(); };
    r.querySelector('.amount').oninput = e => { inc.amount = toNum(e.target.value); calculate(); saveX(); };
    r.querySelector('.remove').onclick = () => { X.incomes = X.incomes.filter(i => i !== inc); renderIncomes(); calculate(); saveX(); };
    box.append(r);
  });
}
$('#addIncome').onclick = () => {
  if (!X) return;
  X.incomes.push({ id:newId(), name:'', amount:0 });
  renderIncomes(); saveX();
  const last = $('#incomeExtra').lastElementChild; if (last) last.querySelector('.name').focus();
};

// ---------- 2 · gastado de verdad en cada fila ----------
function decorateRows(){
  const { map } = spentBy(selMonth);
  document.querySelectorAll('#appWrap .row[data-id]').forEach(row => {
    const e = findCat(row.dataset.id); if (!e) return;
    let line = row.querySelector('.rowSpent');
    if (!line) { line = el('div', 'rowSpent'); row.append(line); }
    const plan = toNum(e.amount), spent = map[String(e.id)] || 0;
    if (typeOf(e) === 'f') {
      if (spent > 0) line.innerHTML = `<span class="chip ok">✓ ${esc(t3('Pagado', 'Pagato', 'Paid'))}</span><span>${esc(t3('este mes', 'questo mese', 'this month'))}: <b>${esc(money(spent))}</b></span>`;
      else if (plan > 0) { line.innerHTML = `<button type="button" class="chipBtn">${esc(t3('Marcar como pagado', 'Segna come pagato', 'Mark as paid'))}</button>`; line.querySelector('button').onclick = () => markPaid(e); }
      else line.innerHTML = '';
      return;
    }
    if (!(plan > 0 || spent > 0)) { line.innerHTML = ''; return; }
    const pct = plan > 0 ? Math.min(spent / plan * 100, 100) : 100, over = spent > plan;
    const rest = over
      ? `<span class="neg">${esc(t3('te has pasado', 'hai sforato di', 'over by'))} ${esc(money(spent - plan))}</span>`
      : `${esc(t3('quedan', 'restano', 'left'))} ${esc(money(plan - spent))}`;
    line.innerHTML = `<div class="mini"><i class="${over ? 'over' : ''}" style="width:${pct}%"></i></div><span>${esc(t3('Gastado', 'Speso', 'Spent'))} <b>${esc(money(spent))}</b> ${esc(t3('de', 'di', 'of'))} ${esc(money(plan))} · ${rest}</span>`;
  });
}
function markPaid(e){
  const m = selMonth, d = m === curMonth() ? today() : m + '-' + pad(Math.min((X.meta[e.id] || {}).day || 1, daysInMonth(m)));
  X.tx.push({ id:newId(), d, a:r2(toNum(e.amount)), c:e.id, n:'' });
  saveX(); refreshViews();
}

// ---------- 3 · movimientos y meses ----------
$('#prevMonth').onclick = () => { selMonth = addMonths(selMonth, -1); refreshViews(); };
$('#nextMonth').onclick = () => { if (selMonth < curMonth()) { selMonth = addMonths(selMonth, 1); refreshViews(); } };
function renderMoves(){
  $('#monthLabel').textContent = monthLabel(selMonth);
  $('#nextMonth').disabled = selMonth >= curMonth();
  const plan = planFor(selMonth), { total } = spentBy(selMonth);
  $('#mvPlan').textContent = plan ? money(plan.plan) : '—';
  $('#mvSpent').textContent = money(total);
  const d = $('#mvDiff');
  if (plan) { const diff = plan.plan - total; d.textContent = (diff < 0 ? '−' : '') + money(Math.abs(diff)); d.className = diff < 0 ? 'neg' : 'pos'; }
  else { d.textContent = '—'; d.className = ''; }
  const list = $('#txList'); list.innerHTML = '';
  const txs = txIn(selMonth).slice().sort((a, b) => b.d.localeCompare(a.d));
  if (!txs.length) {
    list.append(el('p', 'empty', esc(t3('Aún no has apuntado gastos este mes. Pulsa «+» para apuntar uno en segundos, o importa el extracto de tu banco.', 'Non hai ancora annotato spese questo mese. Premi «+» per aggiungerne una in pochi secondi o importa l\'estratto conto.', 'No expenses logged this month yet. Tap «+» to add one in seconds, or import your bank statement.'))));
    return;
  }
  let lastDay = '';
  txs.forEach(t => {
    if (t.d !== lastDay) { lastDay = t.d; list.append(el('div', 'txDay', esc(dayLabel(t.d)))); }
    const c = catOf(t.c);
    const r = el('div', 'tx');
    r.innerHTML = `<span class="em">${esc(c.emoji)}</span><div style="min-width:0"><div class="nm">${esc(c.name)}</div>${t.n ? `<div class="nt">${esc(t.n)}</div>` : ''}</div><span class="am">${esc(money(t.a))}</span><button type="button" class="remove" title="${esc(t3('Eliminar movimiento', 'Elimina movimento', 'Delete transaction'))}" aria-label="${esc(t3('Eliminar movimiento', 'Elimina movimento', 'Delete transaction'))}">×</button>`;
    r.querySelector('.remove').onclick = () => { X.tx = X.tx.filter(x => x !== t); saveX(); refreshViews(); };
    list.append(r);
  });
}

// ---------- 4 · apuntado rápido (botón +) ----------
let qCat = null;
function openSheet(){
  if (!X) return;
  $('#qAmount').value = ''; $('#qNote').value = ''; $('#qErr').textContent = '';
  $('#qDate').value = selMonth === curMonth() ? today() : selMonth + '-01';
  $('#qDate').max = today();
  const cats = $('#qCats'); cats.innerHTML = '';
  const list = expenses.slice().sort((a, b) => (typeOf(a) === 'v' ? 0 : 1) - (typeOf(b) === 'v' ? 0 : 1));
  if (qCat == null || !findCat(qCat)) qCat = list.length ? list[0].id : null;
  list.forEach(e => {
    const b = el('button', same(e.id, qCat) ? 'sel' : '', `${esc(e.emoji || '•')} ${esc(e.name || '')}`);
    b.type = 'button';
    b.onclick = () => { qCat = e.id; cats.querySelectorAll('button').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); };
    cats.append(b);
  });
  $('#sheetBack').hidden = false;
  setTimeout(() => $('#qAmount').focus(), 50);
}
function closeSheet(){ $('#sheetBack').hidden = true; }
$('#fab').onclick = openSheet;
$('#addTx').onclick = openSheet;
$('#qCancel').onclick = closeSheet;
$('#sheetBack').addEventListener('click', e => { if (e.target.id === 'sheetBack') closeSheet(); });
$('#sheet').onsubmit = e => {
  e.preventDefault();
  const a = toNum($('#qAmount').value), d = $('#qDate').value;
  if (!(a > 0)) { $('#qErr').textContent = t3('Escribe un importe mayor que 0.', 'Scrivi un importo maggiore di 0.', 'Enter an amount greater than 0.'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { $('#qErr').textContent = t3('Elige una fecha.', 'Scegli una data.', 'Pick a date.'); return; }
  X.tx.push({ id:newId(), d, a:r2(a), c:qCat, n:$('#qNote').value.trim().slice(0, 120) });
  selMonth = d.slice(0, 7);
  saveX(); closeSheet(); refreshViews();
};

// ---------- 5 · gráficos ----------
const SERIES = ['--s1','--s2','--s3','--s4','--s5','--s6','--s7'];
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function renderCharts(){
  // Donut: gasto real del mes (o el presupuesto si aún no hay movimientos)
  const { map, total } = spentBy(selMonth);
  let items, real = total > 0;
  if (real) items = Object.keys(map).map(k => ({ k, v: map[k] }));
  else items = expenses.filter(e => toNum(e.amount) > 0).map(e => ({ k: String(e.id), v: toNum(e.amount) }));
  items.sort((a, b) => b.v - a.v);
  const top = items.slice(0, 7), rest = items.slice(7);
  // colores por categoría (orden fijo de la lista de gastos), nunca por posición en el ranking
  const order = expenses.map(e => String(e.id));
  top.slice().sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)).forEach((it, i) => { it.c = cssVar(SERIES[i]); });
  if (rest.length) top.push({ k:'_rest', v: rest.reduce((s, x) => s + x.v, 0), c: cssVar('--other'), other:true });
  const sum = top.reduce((s, x) => s + x.v, 0);
  $('#donutCap').textContent = real
    ? t3('Gasto real de ', 'Spesa reale di ', 'Actual spending in ') + monthLabel(selMonth)
    : t3('Según tu presupuesto (aún no hay gastos apuntados este mes)', 'Secondo il tuo budget (nessuna spesa annotata questo mese)', 'Based on your budget (no expenses logged this month yet)');
  const box = $('#donut');
  if (!sum) { box.innerHTML = `<p class="empty">${esc(t3('Añade gastos para ver el gráfico.', 'Aggiungi spese per vedere il grafico.', 'Add expenses to see the chart.'))}</p>`; }
  else {
    const R = 70, C = 2 * Math.PI * R; let off = 0, segs = '';
    top.forEach(it => {
      const len = it.v / sum * C, name = it.other ? t3('Otros', 'Altro', 'Other') : catOf(it.k).name;
      const tip = `${name}: ${money(it.v)} (${Math.round(it.v / sum * 100)} %)`;
      segs += `<circle r="${R}" cx="100" cy="100" fill="none" stroke="${it.c}" stroke-width="26" stroke-dasharray="${Math.max(len - (top.length > 1 ? 2 : 0), 0.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)" data-tip="${esc(tip)}"></circle>`;
      off += len;
    });
    const lbl = real ? t3('gastado', 'speso', 'spent') : t3('previsto', 'previsto', 'planned');
    box.innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="${esc($('#donutCap').textContent)}">${segs}<text x="100" y="98" text-anchor="middle" font-size="19" font-weight="800" fill="var(--ink)">${esc(money(sum))}</text><text x="100" y="118" text-anchor="middle" font-size="12" fill="var(--muted)">${esc(lbl)}</text></svg>`;
    const ul = el('ul', 'legend');
    top.forEach(it => {
      const c = it.other ? { emoji:'', name:t3('Otros', 'Altro', 'Other') } : catOf(it.k);
      ul.insertAdjacentHTML('beforeend', `<li><span class="sw" style="background:${it.c}"></span><span>${esc((c.emoji ? c.emoji + ' ' : '') + c.name)}</span><span class="v">${esc(money(it.v))} · ${Math.round(it.v / sum * 100)} %</span></li>`);
    });
    box.append(ul);
  }

  // Barras: presupuestado vs gastado, últimos 6 meses
  const months = []; for (let i = 5; i >= 0; i--) months.push(addMonths(selMonth, -i));
  const data = months.map(m => ({ m, plan: (planFor(m) || {}).plan || 0, spent: spentBy(m).total }));
  const maxV = Math.max(1, ...data.map(d => Math.max(d.plan, d.spent)));
  const step = niceStep(maxV / 4), top4 = Math.ceil(maxV / step) * step;
  const W = Math.round(Math.max(300, Math.min(600, ($('#bars').clientWidth || 600)))), H = 230, L = 56, B = 26, T = 10, plotH = H - B - T, gw = (W - L - 8) / 6, bw = Math.min(26, gw / 3.2);
  let g = '';
  for (let v = 0; v <= top4 + 0.001; v += step) {
    const y = T + plotH - v / top4 * plotH;
    g += `<line x1="${L}" x2="${W - 4}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(compact(v))}</text>`;
  }
  data.forEach((d, i) => {
    const cx = L + gw * i + gw / 2;
    [[d.plan, '--s1', t3('Presupuestado', 'Previsto', 'Budgeted'), cx - bw - 1], [d.spent, '--s2', t3('Gastado de verdad', 'Speso davvero', 'Actually spent'), cx + 1]].forEach(([v, c, name, x]) => {
      const h = v / top4 * plotH, y = T + plotH - h;
      const tip = `${monthLabel(d.m)} · ${name}: ${money(v)}`;
      if (h > 0.5) g += `<path d="${barPath(x, y, bw, h, Math.min(4, h, bw / 2))}" fill="${cssVar(c)}"/>`;
      g += `<rect x="${x - 2}" y="${T}" width="${bw + 4}" height="${plotH}" fill="transparent" data-tip="${esc(tip)}"/>`;
    });
    g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${d.m === selMonth ? 'var(--ink)' : 'var(--muted)'}" font-weight="${d.m === selMonth ? 700 : 400}">${esc(monthLabel(d.m, true))}</text>`;
  });
  $('#bars').innerHTML = `<svg class="barsSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t3('Presupuestado frente a gastado, últimos 6 meses', 'Previsto rispetto a speso, ultimi 6 mesi', 'Budgeted vs spent, last 6 months'))}">${g}</svg>`;
}
function niceStep(x){ const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1)))); const f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
function compact(v){ return v >= 1000 ? (Math.round(v / 100) / 10).toString().replace('.', ',') + ' k€' : Math.round(v) + ' €'; }
function barPath(x, y, w, h, r){ return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
// tooltip
const tipEl = $('#vizTip');
document.addEventListener('pointermove', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { tipEl.hidden = true; return; }
  tipEl.textContent = t.getAttribute('data-tip'); tipEl.hidden = false;
  const w = tipEl.offsetWidth;
  tipEl.style.left = Math.max(8, Math.min(e.clientX + 12, innerWidth - w - 8)) + 'px';
  tipEl.style.top = (e.clientY - 36) + 'px';
});

// ---------- 6 · objetivos ----------
window.goalEmoji = id => { const g = X && X.goals.find(x => same(x.id, id)); return g ? g.emoji : ''; };
window.setGoalEmoji = (id, em) => { const g = X && X.goals.find(x => same(x.id, id)); if (!g) return; g.emoji = em; saveX(); renderGoals(); };
function goalStatus(g){
  const tgt = toNum(g.target), sv = toNum(g.saved), pct = tgt > 0 ? Math.min(sv / tgt * 100, 100) : 0;
  let msg;
  if (!(tgt > 0)) msg = esc(t3('Escribe cuánto quieres conseguir.', 'Scrivi quanto vuoi raggiungere.', 'Enter how much you want to reach.'));
  else if (sv >= tgt) msg = esc(t3('¡Objetivo conseguido! 🎉', 'Obiettivo raggiunto! 🎉', 'Goal reached! 🎉'));
  else msg = `${esc(t3('Te faltan', 'Ti mancano', 'You still need'))} <b>${esc(money(tgt - sv))}</b> · ${Math.round(pct)} %`;
  return { pct, msg };
}
function renderGoals(){
  const box = $('#goals'); box.innerHTML = '';
  if (!X) return;
  if (!X.goals.length) box.append(el('p', 'empty', esc(t3('Aún no tienes objetivos.', 'Non hai ancora obiettivi.', 'No goals yet.'))));
  X.goals.forEach(g => {
    const c = el('div', 'goal'); c.dataset.id = g.id;
    c.innerHTML = `<div class="goalHead"><button type="button" class="emoji${g.emoji ? '' : ' empty'}" aria-label="${esc(t3('Cambiar emoji', 'Cambia emoji', 'Change emoji'))}">${g.emoji ? esc(g.emoji) + '<span class="plus">+</span>' : '+'}</button><input class="gName" maxlength="60" value="${esc(g.name)}" placeholder="${esc(t3('Ej. Vacaciones', 'Es. Vacanze', 'e.g. Holidays'))}" aria-label="${esc(t3('Nombre del objetivo', 'Nome dell\'obiettivo', 'Goal name'))}"><button type="button" class="remove" aria-label="${esc(t3('Eliminar objetivo', 'Elimina obiettivo', 'Delete goal'))}">×</button></div>
      <div class="goalNums"><label>${esc(t3('Objetivo', 'Obiettivo', 'Target'))}<input class="gTarget" inputmode="decimal" value="${esc(toInput(g.target || ''))}" placeholder="0,00"></label><label>${esc(t3('Ahorrado', 'Risparmiato', 'Saved'))}<input class="gSaved" inputmode="decimal" value="${esc(toInput(g.saved || ''))}" placeholder="0,00"></label><button type="button" class="addSmall gAdd">+ ${esc(t3('Aportar', 'Versa', 'Add money'))}</button></div>
      <div class="goalBar"><i></i></div><p class="goalMsg"></p>`;
    c.querySelector('.emoji').onclick = ev => { ev.stopPropagation(); openEmojiPicker(ev.currentTarget, 'goal:' + g.id); };
    c.querySelector('.gName').oninput = e => { g.name = e.target.value; saveX(); };
    c.querySelector('.gTarget').oninput = e => { g.target = toNum(e.target.value); updateGoalsProgress(); saveX(); };
    c.querySelector('.gSaved').oninput = e => { g.saved = toNum(e.target.value); updateGoalsProgress(); saveX(); };
    c.querySelector('.remove').onclick = () => { if (!confirm(t3('¿Eliminar este objetivo?', 'Eliminare questo obiettivo?', 'Delete this goal?'))) return; X.goals = X.goals.filter(x => x !== g); saveX(); renderGoals(); };
    c.querySelector('.gAdd').onclick = () => {
      const v = toNum(prompt(t3('¿Cuánto quieres aportar a este objetivo?', 'Quanto vuoi versare in questo obiettivo?', 'How much do you want to add to this goal?'), ''));
      if (!(v > 0)) return;
      g.saved = r2(toNum(g.saved) + v); saveX(); renderGoals();
    };
    box.append(c);
  });
  updateGoalsProgress();
}
function updateGoalsProgress(){
  if (!X) return;
  document.querySelectorAll('#goals .goal').forEach(c => {
    const g = X.goals.find(x => same(x.id, c.dataset.id)); if (!g) return;
    const s = goalStatus(g);
    c.querySelector('.goalBar i').style.width = s.pct + '%';
    c.querySelector('.goalMsg').innerHTML = s.msg;
  });
}
$('#addGoal').onclick = () => {
  if (!X) return;
  X.goals.push({ id:newId(), emoji:'🎯', name:'', target:0, saved:0 });
  saveX(); renderGoals();
  const last = $('#goals').lastElementChild; if (last && last.querySelector('.gName')) last.querySelector('.gName').focus();
};

// ---------- 7 · próximos pagos y avisos ----------
function billState(e, paidMap){
  const m = curMonth(), dim = daysInMonth(m), t = new Date().getDate();
  const day = (X.meta[e.id] || {}).day;
  if ((paidMap[String(e.id)] || 0) > 0) return { k:3, cls:'', txt:'✓ ' + t3('Pagado', 'Pagato', 'Paid') };
  if (!day) return { k:2, cls:'muted', txt:t3('Elige el día', 'Scegli il giorno', 'Pick the day') };
  const diff = Math.min(day, dim) - t;
  if (diff < 0) return { k:0, d:diff, cls:'late', txt:t3(`Venció hace ${-diff} ${-diff === 1 ? 'día' : 'días'}`, `Scaduto da ${-diff} ${-diff === 1 ? 'giorno' : 'giorni'}`, `Overdue by ${-diff} ${-diff === 1 ? 'day' : 'days'}`) };
  if (diff === 0) return { k:0, d:0, cls:'soon', txt:t3('Hoy', 'Oggi', 'Today') };
  if (diff === 1) return { k:1, d:1, cls:'soon', txt:t3('Mañana', 'Domani', 'Tomorrow') };
  return { k:1, d:diff, cls:'', txt:t3(`En ${diff} días`, `Tra ${diff} giorni`, `In ${diff} days`) };
}
function renderBills(){
  const box = $('#bills'); box.innerHTML = '';
  const fixed = expenses.filter(e => typeOf(e) === 'f' && toNum(e.amount) > 0);
  const { map } = spentBy(curMonth());
  const rows = fixed.map(e => ({ e, s: billState(e, map) })).sort((a, b) => a.s.k - b.s.k || (a.s.d || 0) - (b.s.d || 0));
  const pending = rows.filter(r => r.s.k < 3).reduce((s, r) => s + toNum(r.e.amount), 0);
  $('#billsInfo').innerHTML = fixed.length
    ? `${esc(t3('Indica qué día te cobran cada gasto fijo y te avisaremos. Te quedan por pagar este mes:', 'Indica in che giorno ti addebitano ogni spesa fissa e ti avviseremo. Ti restano da pagare questo mese:', 'Set the day each fixed expense is charged and we\'ll remind you. Still to pay this month:'))} <b>${esc(money(pending))}</b>`
    : esc(t3('Añade gastos fijos para ver aquí tus próximos pagos.', 'Aggiungi spese fisse per vedere qui i prossimi pagamenti.', 'Add fixed expenses to see your upcoming payments here.'));
  rows.forEach(({ e, s }) => {
    const r = el('div', 'bill');
    const day = (X.meta[e.id] || {}).day || '';
    let opts = `<option value="">${esc(t3('Día…', 'Giorno…', 'Day…'))}</option>`;
    for (let i = 1; i <= 31; i++) opts += `<option value="${i}"${i === day ? ' selected' : ''}>${esc(t3('Día ', 'Giorno ', 'Day ')) + i}</option>`;
    r.innerHTML = `<span class="em" style="width:34px;height:34px;display:grid;place-items:center;background:var(--soft);border-radius:10px">${esc(e.emoji || '•')}</span><div style="min-width:0"><div style="font-weight:650">${esc(e.name)}</div><div class="amt muted" style="font-size:.82rem">${esc(money(e.amount))}</div></div><select aria-label="${esc(t3('Día de cobro', 'Giorno di addebito', 'Charge day'))}">${opts}</select><span class="st ${s.cls}">${esc(s.txt)}</span>`;
    r.querySelector('select').onchange = ev => { const v = Number(ev.target.value); X.meta[e.id] = Object.assign({}, X.meta[e.id], { day: v || undefined }); saveX(); refreshViews(); };
    box.append(r);
  });
  const nb = $('#notifyBtn');
  nb.hidden = !('Notification' in window) || Notification.permission !== 'default';
}
$('#notifyBtn').onclick = async () => {
  try { await Notification.requestPermission(); } catch (e) {}
  renderBills(); checkBillReminders(true);
};
async function checkBillReminders(force, tries){
  tries = tries || 0;
  if (!X || !window.budgetLoaded) { if (X && tries < 20) setTimeout(() => checkBillReminders(force, tries + 1), 1500); return; }
  const { map } = spentBy(curMonth());
  const due = expenses.filter(e => typeOf(e) === 'f' && toNum(e.amount) > 0).map(e => ({ e, s: billState(e, map) })).filter(x => x.s.k <= 1 && x.s.d != null && x.s.d <= 1);
  if (!due.length || !('Notification' in window) || Notification.permission !== 'granted') return;
  const key = 'alesagli-notified-' + uid();
  try { if (!force && localStorage.getItem(key) === today()) return; localStorage.setItem(key, today()); } catch (e) {}
  const body = due.map(x => `${x.e.emoji || ''} ${x.e.name}: ${money(x.e.amount)} (${x.s.txt})`).join('\n');
  const title = t3('Pagos para hoy y mañana', 'Pagamenti per oggi e domani', 'Payments due today and tomorrow');
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) reg.showNotification(title, { body, icon:'icon.svg', tag:'bills' });
    else new Notification(title, { body, icon:'icon.svg' });
  } catch (e) {}
}

// ---------- 8 · consejos y regla 50/30/20 ----------
function renderTips(){
  const p = planNow(), rule = $('#rule'), tips = [];
  if (p.inc > 0) {
    const parts = [
      [t3('Necesidades (gastos fijos)', 'Necessità (spese fisse)', 'Needs (fixed expenses)'), p.fix / p.inc * 100, 50, 'max'],
      [t3('Deseos (gastos variables)', 'Desideri (spese variabili)', 'Wants (variable expenses)'), p.vr / p.inc * 100, 30, 'max'],
      [t3('Ahorro (lo que te queda)', 'Risparmio (ciò che resta)', 'Savings (what\'s left)'), Math.max(0, (p.inc - p.plan) / p.inc * 100), 20, 'min'],
    ];
    rule.innerHTML = parts.map(([name, v, tgt, kind]) => {
      const ok = kind === 'max' ? v <= tgt + 0.5 : v >= tgt - 0.5;
      return `<div class="metric"><span>${esc(name)}</span><strong>${Math.round(v)} % <span class="${ok ? 'pos' : 'neg'}" style="font-size:.85rem">${ok ? '✓' : '⚠'}</span></strong><span class="target">${esc(t3('Recomendado', 'Consigliato', 'Recommended'))}: ${kind === 'max' ? '≤' : '≥'} ${tgt} %</span><div class="mbar"><i style="width:${Math.min(v, 100)}%;background:${ok ? 'var(--green)' : 'var(--danger)'}"></i><u style="left:${tgt}%"></u></div></div>`;
    }).join('');
    const savePct = (p.inc - p.plan) / p.inc * 100;
    if (savePct < 20) tips.push(['💰', t3(`Para ahorrar el 20 % deberías apartar ${money(p.inc * 0.2)} al mes; ahora te quedan ${money(p.inc - p.plan)}.`, `Per risparmiare il 20 % dovresti mettere da parte ${money(p.inc * 0.2)} al mese; ora ti restano ${money(p.inc - p.plan)}.`, `To save 20 % you should set aside ${money(p.inc * 0.2)} a month; right now you have ${money(p.inc - p.plan)} left.`)]);
    if (p.vr / p.inc > 0.3) tips.push(['✂️', t3(`Tus gastos variables son el ${Math.round(p.vr / p.inc * 100)} % de tus ingresos. Recortar ${money(p.vr - p.inc * 0.3)} te pondría en el 30 %.`, `Le spese variabili sono il ${Math.round(p.vr / p.inc * 100)} % delle entrate. Tagliando ${money(p.vr - p.inc * 0.3)} arriveresti al 30 %.`, `Variable spending is ${Math.round(p.vr / p.inc * 100)} % of income. Cutting ${money(p.vr - p.inc * 0.3)} would bring it to 30 %.`)]);
  } else {
    rule.innerHTML = `<p class="empty" style="grid-column:1/-1">${esc(t3('Escribe tus ingresos para ver cómo repartes tu dinero según la regla 50/30/20.', 'Scrivi le tue entrate per vedere come dividi i soldi secondo la regola 50/30/20.', 'Enter your income to see how you split your money using the 50/30/20 rule.'))}</p>`;
  }
  // gastos que parecen variables pero están en fijos
  const VAR_RE = /comida|ocio|ropa|super|restaur|capricho|cibo|svago|spesa|food|leisure|groceries|clothes/i;
  const mis = expenses.filter(e => typeOf(e) === 'f' && VAR_RE.test(e.name || ''));
  if (mis.length) tips.push(['🔄', t3(`«${mis.map(e => e.name).join('», «')}» ${mis.length > 1 ? 'parecen gastos variables' : 'parece un gasto variable'}: pulsa ⇅ para moverlo y que la regla 50/30/20 sea exacta.`, `«${mis.map(e => e.name).join('», «')}» ${mis.length > 1 ? 'sembrano spese variabili' : 'sembra una spesa variabile'}: premi ⇅ per spostarla.`, `«${mis.map(e => e.name).join('», «')}» ${mis.length > 1 ? 'look like variable expenses' : 'looks like a variable expense'}: tap ⇅ to move it.`)]);
  if (X) {
    const cur = spentBy(selMonth), prev = spentBy(addMonths(selMonth, -1));
    // categorías en las que te has pasado
    expenses.forEach(e => { const s = cur.map[String(e.id)] || 0, pl = toNum(e.amount); if (typeOf(e) === 'v' && pl > 0 && s > pl) tips.push(['🚨', t3(`Te has pasado ${money(s - pl)} en ${e.name} este mes.`, `Hai sforato di ${money(s - pl)} in ${e.name} questo mese.`, `You're ${money(s - pl)} over budget on ${e.name} this month.`)]); });
    // comparación con el mes anterior
    if (cur.total > 0 && prev.total > 0) {
      let best = null;
      Object.keys(cur.map).forEach(k => { const a = cur.map[k], b = prev.map[k] || 0; if (b > 0 && a - b > 10 && a / b > 1.1 && (!best || a - b > best.diff)) best = { k, diff: a - b, pct: Math.round((a / b - 1) * 100) }; });
      if (best) tips.push(['📈', t3(`Este mes gastas un ${best.pct} % más en ${catOf(best.k).name} que el mes pasado (+${money(best.diff)}).`, `Questo mese spendi il ${best.pct} % in più in ${catOf(best.k).name} rispetto al mese scorso (+${money(best.diff)}).`, `This month you're spending ${best.pct} % more on ${catOf(best.k).name} than last month (+${money(best.diff)}).`)]);
      const dt = cur.total - prev.total;
      if (selMonth !== curMonth()) tips.push([dt > 0 ? '📊' : '👏', t3(`En total gastaste ${money(Math.abs(dt))} ${dt > 0 ? 'más' : 'menos'} que el mes anterior.`, `In totale hai speso ${money(Math.abs(dt))} ${dt > 0 ? 'in più' : 'in meno'} rispetto al mese prima.`, `In total you spent ${money(Math.abs(dt))} ${dt > 0 ? 'more' : 'less'} than the previous month.`)]);
    }
    // pagos inminentes
    const { map } = spentBy(curMonth());
    expenses.filter(e => typeOf(e) === 'f' && toNum(e.amount) > 0).forEach(e => { const s = billState(e, map); if (s.k <= 1 && s.d != null && s.d <= 3) tips.push(['📅', `${e.name} (${money(e.amount)}): ${s.txt}`]); });
    if (selMonth === curMonth() && !cur.total) tips.push(['✍️', t3('Apunta tus gastos reales con el botón «+» para comprobar si cumples tu presupuesto.', 'Annota le spese reali con il pulsante «+» per verificare se rispetti il budget.', 'Log your real spending with the «+» button to check you stick to your budget.')]);
  }
  if (!tips.length) tips.push(['✅', t3('¡Vas muy bien! Tu presupuesto está equilibrado.', 'Stai andando benissimo! Il tuo budget è equilibrato.', 'Great job! Your budget is balanced.')]);
  $('#tips').innerHTML = tips.slice(0, 5).map(([ic, t]) => `<div class="tip"><span class="ic">${ic}</span><span>${esc(t)}</span></div>`).join('');
}

// ---------- 9 · exportar e importar CSV ----------
function downloadFile(name, content, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// Evita la «inyección de fórmulas» al abrir el CSV en Excel (=, +, -, @ al inicio)
function csvCell(v){ v = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+([.,]\d+)?$/.test(v)) v = "'" + v; return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
$('#exportCsv').onclick = () => {
  if (!X) return;
  const rows = [[t3('Fecha', 'Data', 'Date'), t3('Categoría', 'Categoria', 'Category'), t3('Tipo', 'Tipo', 'Type'), t3('Nota', 'Nota', 'Note'), t3('Importe', 'Importo', 'Amount')]];
  X.tx.slice().sort((a, b) => a.d.localeCompare(b.d)).forEach(t => { const e = findCat(t.c); rows.push([t.d, catOf(t.c).name, e ? (typeOf(e) === 'v' ? t3('Variable', 'Variabile', 'Variable') : t3('Fijo', 'Fissa', 'Fixed')) : '', t.n || '', fmt2(toNum(t.a))]); });
  downloadFile('movimientos-' + today() + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
};
$('#exportBudget').onclick = () => {
  const rows = [[t3('Tipo', 'Tipo', 'Type'), t3('Concepto', 'Voce', 'Item'), t3('Importe', 'Importo', 'Amount')]];
  rows.push([t3('Ingreso', 'Entrata', 'Income'), t3('Ingresos', 'Entrate', 'Income'), fmt2(toNum(salary))]);
  (X ? X.incomes : []).forEach(i => rows.push([t3('Ingreso', 'Entrata', 'Income'), i.name, fmt2(toNum(i.amount))]));
  expenses.forEach(e => rows.push([typeOf(e) === 'v' ? t3('Gasto variable', 'Spesa variabile', 'Variable expense') : t3('Gasto fijo', 'Spesa fissa', 'Fixed expense'), e.name, fmt2(toNum(e.amount))]));
  const p = planNow(); rows.push(['', t3('Total gastos', 'Totale spese', 'Total expenses'), fmt2(p.plan)], ['', t3('Te queda', 'Ti resta', 'Left'), fmt2(p.inc - p.plan)]);
  downloadFile('presupuesto-' + today() + '.csv', toCSV(rows), 'text/csv;charset=utf-8');
};

function parseCSV(text){
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const delim = [';', '\t', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x));
}
function parseDate(s){
  s = String(s || '').trim(); let m, y, mo, d;
  if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  return y + '-' + pad(mo) + '-' + pad(d);
}
function parseAmt(s){
  s = String(s || '').replace(/[\s €]|EUR/gi, '').replace(/−/g, '-');
  if (!/\d/.test(s) || /[a-z]/i.test(s)) return NaN;
  const neg = /^\(.*\)$/.test(s) || /-$/.test(s);
  s = s.replace(/[()]/g, '').replace(/-$/, '');
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc > -1) s = s.replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) ? (neg ? -Math.abs(n) : n) : NaN;
}
const KW = [
  [/comida|super|aliment|cibo|spesa|food|grocer|compra/i, /mercadona|carrefour|lidl|aldi|\bdia\b|eroski|alcampo|hipercor|consum|supermerc|bonpreu|ahorramas|esselunga|conad|coop|tesco|fruter|panader|carnicer/i],
  [/transport|coche|gasolin|auto|trasport|car\b/i, /renfe|metro|\bemt\b|\btmb\b|uber(?! ?eats)|cabify|\bbolt\b|gasolin|repsol|cepsa|\bbp\b|galp|shell|parking|peaje|taxi|blablacar|trenitalia|italo|ryanair|vueling|iberia/i],
  [/ocio|svago|leisure|entreten|diversi|restaur|salir/i, /cine|steam|playstation|xbox|nintendo|restaur|cafeter|burger|mcdonald|telepizza|glovo|just ?eat|deliveroo|uber ?eats|ticketmaster|bar\s/i],
  [/suscrip|abbonam|subscri|streaming/i, /netflix|spotify|hbo|\bmax\b|disney|apple\.com|icloud|google|amazon prime|youtube|chatgpt|openai|dazn|filmin/i],
  [/factura|luz|agua|\bgas\b|bollet|bills|suministr|internet|m[oó]vil|tel[eé]fono|utilit/i, /iberdrola|endesa|naturgy|holaluz|totalenergies|vodafone|movistar|orange|yoigo|\bdigi\b|masmovil|pepephone|canal de isabel|aqualia|\benel\b|\btim\b|wind ?tre|fastweb/i],
  [/renta|alquiler|hipoteca|vivienda|affitto|mutuo|rent|casa|piso/i, /alquiler|hipoteca|affitto|\brent\b|comunidad de propietarios/i],
  [/salud|farmacia|m[eé]dic|salute|health|dentist/i, /farmacia|pharma|cl[ií]nica|hospital|dentist|sanitas|adeslas|\bdkv\b|optica/i],
  [/ropa|vestir|abbigl|cloth|moda/i, /zara|primark|h&m|mango|pull ?& ?bear|bershka|decathlon|nike|adidas|shein|zalando|stradivarius/i],
  [/seguro|assicur|insur/i, /seguro|mapfre|allianz|\baxa\b|mutua|generali|l[ií]nea directa|zurich/i],
];
function guessCat(desc){
  const d = (desc || '').toLowerCase();
  for (const e of expenses) { const n = (e.name || '').toLowerCase().trim(); if (n.length >= 4 && d.includes(n)) return e.id; }
  for (const [catRe, kwRe] of KW) if (kwRe.test(d)) { const e = expenses.find(x => catRe.test(x.name || '')); if (e) return e.id; }
  const key = d.split(/[^a-z0-9áéíóúñ]+/).filter(w => w.length > 3)[0];
  if (key && X) { const prev = X.tx.slice().reverse().find(t => t.c != null && t.n && t.n.toLowerCase().includes(key) && findCat(t.c)); if (prev) return prev.c; }
  return '';
}
function detectColumns(rows){
  const H = { date:/fecha|date|data|f\.? ?valor|f\.? ?operaci|valuta/i, desc:/concepto|descrip|detalle|description|concept|causale|movimiento|operaci[oó]n|payee|beneficiario|comercio|texto|details/i, amount:/importe|amount|cantidad|importo|monto|euros?$|€|valore/i, debit:/cargo|debe|d[eé]bito|debit|uscite|addebit|gasto/i, credit:/abono|haber|cr[eé]dito|credit|entrate|accredit|ingreso/i };
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const r = rows[i], find = re => r.findIndex(c => re.test(c) && c.length < 40);
    const date = find(H.date);
    if (date < 0) continue;
    const cols = { header:i, date, desc:find(H.desc), amount:-1, debit:-1, credit:-1 };
    r.forEach((c, j) => { if (j === date || c.length >= 40) return; if (cols.amount < 0 && H.amount.test(c) && !/saldo|balance/i.test(c)) cols.amount = j; if (cols.debit < 0 && H.debit.test(c)) cols.debit = j; if (cols.credit < 0 && H.credit.test(c)) cols.credit = j; });
    if (cols.amount >= 0 || cols.debit >= 0) return cols;
  }
  // sin cabecera: adivinar con la primera fila que tenga fecha
  const r = rows.find(x => x.some(c => parseDate(c)));
  if (!r) return null;
  const date = r.findIndex(c => parseDate(c));
  let amount = -1, desc = -1, len = 0;
  r.forEach((c, j) => { if (j === date) return; if (!isNaN(parseAmt(c)) && !parseDate(c)) { if (amount < 0) amount = j; } else if (c.length > len) { len = c.length; desc = j; } });
  return amount < 0 ? null : { header:-1, date, desc, amount, debit:-1, credit:-1 };
}
let impRows = [];
$('#importCsv').onclick = () => { const f = $('#impFile'); f.value = ''; f.click(); };
$('#impFile').onchange = async e => {
  const file = e.target.files[0]; if (!file || !X) return;
  if (file.size > 5 * 1024 * 1024) { alert(t3('El archivo es demasiado grande (máximo 5 MB).', 'Il file è troppo grande (massimo 5 MB).', 'The file is too large (max 5 MB).')); return; }
  if (/\.xlsx?$/i.test(file.name)) { alert(t3('Descarga el extracto de tu banco en formato CSV y vuelve a intentarlo.', 'Scarica l\'estratto conto in formato CSV e riprova.', 'Download your bank statement as CSV and try again.')); return; }
  const buf = await file.arrayBuffer();
  let text; try { text = new TextDecoder('utf-8', { fatal:true }).decode(buf); } catch (err) { text = new TextDecoder('windows-1252').decode(buf); }
  const rows = parseCSV(text.replace(/^﻿/, ''));
  const cols = detectColumns(rows);
  if (!cols) { alert(t3('No hemos encontrado columnas de fecha e importe en este archivo.', 'Non abbiamo trovato colonne di data e importo in questo file.', 'We couldn\'t find date and amount columns in this file.')); return; }
  let parsed = [];
  rows.slice(cols.header + 1).forEach(r => {
    const d = parseDate(r[cols.date]); if (!d) return;
    let a;
    if (cols.amount >= 0) a = parseAmt(r[cols.amount]);
    else { const deb = parseAmt(r[cols.debit]), cre = cols.credit >= 0 ? parseAmt(r[cols.credit]) : NaN; a = (isNaN(cre) ? 0 : Math.abs(cre)) - (isNaN(deb) ? 0 : Math.abs(deb)); }
    if (isNaN(a) || a === 0) return;
    const desc = (cols.desc >= 0 ? r[cols.desc] : r.filter((c, j) => j !== cols.date && j !== cols.amount).join(' ')).slice(0, 120);
    parsed.push({ d, a, n: desc });
  });
  const anyNeg = parsed.some(p => p.a < 0);
  const incomes = anyNeg ? parsed.filter(p => p.a > 0).length : 0;
  parsed = parsed.filter(p => anyNeg ? p.a < 0 : true).map(p => ({ d:p.d, a:r2(Math.abs(p.a)), n:p.n }));
  const sig = t => t.d + '|' + r2(toNum(t.a)) + '|' + (t.n || '').toLowerCase();
  const existing = new Set(X.tx.map(sig));
  impRows = parsed.map(p => ({ ...p, c: guessCat(p.n), dup: existing.has(sig(p)), on: !existing.has(sig(p)) }));
  if (!impRows.length) { alert(t3('No hay gastos que importar en este archivo.', 'Non ci sono spese da importare in questo file.', 'There are no expenses to import in this file.')); return; }
  renderImport(incomes);
  $('#impBack').hidden = false;
};
function renderImport(incomes){
  const dups = impRows.filter(r => r.dup).length;
  $('#impInfo').textContent = t3(`Hemos encontrado ${impRows.length} gastos`, `Abbiamo trovato ${impRows.length} spese`, `We found ${impRows.length} expenses`) +
    (incomes ? t3(` (y ${incomes} ingresos que no importamos)`, ` (e ${incomes} entrate che non importiamo)`, ` (and ${incomes} incomes we skip)`) : '') +
    (dups ? t3(`. ${dups} ya estaban apuntados y están desmarcados.`, `. ${dups} erano già annotate e sono deselezionate.`, `. ${dups} were already logged and are unticked.`) : '.') +
    t3(' Revisa la categoría de cada uno antes de importar.', ' Controlla la categoria di ognuna prima di importare.', ' Check each category before importing.');
  let opts = `<option value="">${esc(t3('Sin categoría', 'Senza categoria', 'Uncategorised'))}</option>` + expenses.map(e => `<option value="${esc(e.id)}">${esc((e.emoji || '') + ' ' + (e.name || ''))}</option>`).join('');
  const tbl = el('table');
  tbl.innerHTML = `<thead><tr><th><input type="checkbox" id="impAll" checked aria-label="${esc(t3('Seleccionar todos', 'Seleziona tutti', 'Select all'))}"></th><th>${esc(t3('Fecha', 'Data', 'Date'))}</th><th>${esc(t3('Concepto', 'Voce', 'Description'))}</th><th>${esc(t3('Importe', 'Importo', 'Amount'))}</th><th>${esc(t3('Categoría', 'Categoria', 'Category'))}</th></tr></thead><tbody></tbody>`;
  const tb = tbl.querySelector('tbody');
  impRows.forEach(r => {
    const tr = el('tr', r.dup ? 'dup' : '');
    tr.innerHTML = `<td><input type="checkbox" ${r.on ? 'checked' : ''}></td><td class="d">${esc(r.d)}</td><td class="c" title="${esc(r.n)}">${esc(r.n)}</td><td class="r">${esc(money(r.a))}</td><td><select>${opts}</select></td>`;
    const sel = tr.querySelector('select'); sel.value = r.c == null ? '' : String(r.c);
    sel.onchange = () => { r.c = sel.value === '' ? null : (findCat(sel.value) || {}).id; };
    tr.querySelector('input').onchange = ev => { r.on = ev.target.checked; updImpBtn(); };
    tb.append(tr);
  });
  $('#impTable').innerHTML = ''; $('#impTable').append(tbl);
  $('#impAll').onchange = ev => { impRows.forEach(r => r.on = ev.target.checked); tb.querySelectorAll('input').forEach(i => i.checked = ev.target.checked); updImpBtn(); };
  updImpBtn();
}
function updImpBtn(){ const n = impRows.filter(r => r.on).length; $('#impOk').textContent = t3(`Importar ${n}`, `Importa ${n}`, `Import ${n}`); $('#impOk').disabled = !n; }
$('#impCancel').onclick = () => { $('#impBack').hidden = true; };
$('#impOk').onclick = () => {
  const chosen = impRows.filter(r => r.on);
  chosen.forEach(r => X.tx.push({ id:newId(), d:r.d, a:r.a, c:(r.c === '' ? null : r.c), n:r.n, src:'csv' }));
  if (chosen.length) selMonth = chosen.map(r => r.d).sort().pop().slice(0, 7);
  $('#impBack').hidden = true; saveX(); refreshViews();
};
$('#exportJson').onclick = () => {
  const dump = { exported: new Date().toISOString(), email: currentUser && currentUser.email, income: toNum(salary), expenses: expenses.map(e => ({ emoji:e.emoji, name:e.name, amount:toNum(e.amount), type: typeOf(e) === 'v' ? 'variable' : 'fixed' })), savings, extra: X };
  downloadFile('mis-datos-' + today() + '.json', JSON.stringify(dump, null, 2), 'application/json');
};

// ---------- extras: modo oscuro, instalar app, cambiar idioma ----------
const bar = document.querySelector('.lang-bar');
const themeBtn = el('button', 'lang-btn'); themeBtn.type = 'button'; themeBtn.id = 'themeBtn';
function themeLabel(){ const d = document.documentElement.dataset.theme === 'dark'; themeBtn.textContent = d ? '☀️' : '🌙'; themeBtn.title = d ? t3('Modo claro', 'Modalità chiara', 'Light mode') : t3('Modo oscuro', 'Modalità scura', 'Dark mode'); themeBtn.setAttribute('aria-label', themeBtn.title); }
themeBtn.onclick = () => { const n = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('alesagli-theme', n); } catch (e) {} themeLabel(); refreshViews(); };
themeLabel();
const installBtn = el('button', 'lang-btn', '📲 ' + esc(t3('Instalar app', 'Installa app', 'Install app'))); installBtn.type = 'button'; installBtn.hidden = true;
if (bar) { bar.insertBefore(themeBtn, bar.firstChild); bar.insertBefore(installBtn, bar.firstChild); }
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; installBtn.hidden = false; });
installBtn.onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) {} deferredInstall = null; installBtn.hidden = true; };
window.addEventListener('appinstalled', () => { installBtn.hidden = true; });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
const langBtn = document.getElementById('langBtn');
if (langBtn) langBtn.addEventListener('click', () => setTimeout(() => { themeLabel(); installBtn.textContent = '📲 ' + t3('Instalar app', 'Installa app', 'Install app'); if (X) { renderIncomes(); renderGoals(); refreshViews(); } }, 0));

window.addEventListener('resize', debounce(() => { if (X) renderCharts(); }, 200));
// ---------- teclado: Esc cierra hojas ----------
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSheet(); $('#impBack').hidden = true; } });

// ============================================================
//  CIBERSEGURIDAD
// ============================================================
// Mostrar / ocultar contraseña
document.querySelectorAll('.pwEye').forEach(b => {
  b.onclick = () => { const i = document.getElementById(b.dataset.for); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? '🙈' : '👁'; b.title = show ? t3('Ocultar contraseña', 'Nascondi password', 'Hide password') : t3('Mostrar contraseña', 'Mostra password', 'Show password'); };
});
// Fuerza de la contraseña
function pwScore(p){
  let s = 0; if (!p) return 0;
  if (p.length >= 8) s++; if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p)) s++; if (/[^A-Za-z0-9]/.test(p)) s++;
  if (/^(.)\1+$/.test(p) || /^(123456|password|qwerty|contraseña|111111|abc123)/i.test(p)) s = 0;
  return Math.min(s, 4);
}
function bindMeter(input, wrap, barEl, hint){
  input.addEventListener('input', () => {
    if (wrap.dataset.only === 'signup' && mode !== 'signup') return;
    const s = pwScore(input.value), cols = ['var(--danger)', 'var(--danger)', 'var(--warn)', 'var(--green)', 'var(--green)'];
    barEl.style.width = (input.value ? (s + 1) * 20 : 0) + '%'; barEl.style.background = cols[s];
    hint.textContent = !input.value ? '' : [t3('Muy débil', 'Molto debole', 'Very weak'), t3('Débil', 'Debole', 'Weak'), t3('Aceptable', 'Accettabile', 'Fair'), t3('Fuerte', 'Forte', 'Strong'), t3('Muy fuerte', 'Molto forte', 'Very strong')][s] + (input.value.length < 8 ? ' · ' + t3('mínimo 8 caracteres', 'minimo 8 caratteri', 'at least 8 characters') : '');
  });
}
const pw1 = $('#pwStrength'); pw1.dataset.only = 'signup';
bindMeter($('#authPassword'), pw1, $('#pwBar'), $('#pwHint'));
bindMeter($('#newPassword'), $('#pwStrength2'), $('#pwBar2'), $('#pwHint2'));
// Mostrar el medidor solo al crear cuenta
if (typeof setAuthMode === 'function') {
  $('#tabSignup').addEventListener('click', () => { pw1.hidden = false; $('#authPassword').placeholder = t3('Mínimo 8 caracteres', 'Minimo 8 caratteri', 'At least 8 characters'); });
  $('#tabLogin').addEventListener('click', () => { pw1.hidden = true; });
  $('#forgotBtn').addEventListener('click', () => { pw1.hidden = true; });
}
// Comprueba la contraseña: longitud, fuerza y si ha aparecido en filtraciones (Have I Been Pwned, k-anonimato:
// solo se envían los 5 primeros caracteres del hash SHA-1, nunca la contraseña).
async function pwnedCount(p){
  try {
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(p)))).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch('https://api.pwnedpasswords.com/range/' + h.slice(0, 5), { signal: ctrl.signal, headers: { 'Add-Padding':'true' } });
    if (!res.ok) return 0;
    const line = (await res.text()).split('\n').find(l => l.startsWith(h.slice(5)));
    return line ? parseInt(line.split(':')[1], 10) || 0 : 0;
  } catch (e) { return 0; }
}
window.passwordProblem = async function(p){
  if (!p || p.length < 8) return t3('La contraseña debe tener al menos 8 caracteres.', 'La password deve avere almeno 8 caratteri.', 'The password must be at least 8 characters.');
  if (pwScore(p) < 2) return t3('La contraseña es demasiado débil: mezcla mayúsculas, minúsculas, números o símbolos.', 'La password è troppo debole: mescola maiuscole, minuscole, numeri o simboli.', 'The password is too weak: mix upper and lower case, numbers or symbols.');
  if (currentUser == null && authEmail.value && p.toLowerCase().includes(authEmail.value.split('@')[0].toLowerCase()) && authEmail.value.split('@')[0].length > 3) return t3('La contraseña no debe contener tu correo.', 'La password non deve contenere la tua email.', 'The password must not contain your email.');
  const n = await pwnedCount(p);
  if (n > 0) return t3(`Esta contraseña ha aparecido en ${n.toLocaleString('es-ES')} filtraciones de datos. Elige otra distinta.`, `Questa password è apparsa in ${n.toLocaleString('it-IT')} violazioni di dati. Scegline un'altra.`, `This password has appeared in ${n.toLocaleString('en-GB')} data breaches. Please choose another.`);
  return '';
};
// Límite de intentos de inicio de sesión (frena ataques de fuerza bruta desde este navegador)
const LK = 'alesagli-login-fails';
function fails(){ try { return JSON.parse(localStorage.getItem(LK) || '{"n":0,"t":0}'); } catch (e) { return { n:0, t:0 }; } }
window.loginWait = () => { const f = fails(); if (f.n < 5) return 0; const lock = Math.min(30 * Math.pow(2, f.n - 5), 15 * 60) * 1000; return Math.max(0, Math.ceil((f.t + lock - Date.now()) / 1000)); };
window.loginFailed = () => { const f = fails(); f.n++; f.t = Date.now(); try { localStorage.setItem(LK, JSON.stringify(f)); } catch (e) {} };
window.loginOk = () => { try { localStorage.removeItem(LK); } catch (e) {} };
window.tWait = s => t3(`Demasiados intentos fallidos. Espera ${s} segundos antes de volver a intentarlo.`, `Troppi tentativi falliti. Attendi ${s} secondi prima di riprovare.`, `Too many failed attempts. Wait ${s} seconds before trying again.`);

// Ocultar importes (modo privado)
const ps = $('#privacySwitch');
function setPrivacy(on){ document.body.classList.toggle('privacy', on); ps.setAttribute('aria-checked', on ? 'true' : 'false'); try { localStorage.setItem('alesagli-privacy', on ? '1' : '0'); } catch (e) {} }
ps.onclick = () => setPrivacy(!document.body.classList.contains('privacy'));
try { setPrivacy(localStorage.getItem('alesagli-privacy') === '1'); } catch (e) {}

// Bloqueo automático por inactividad
let lockTimer = null, lastAct = Date.now();
try { const la = Number(localStorage.getItem('alesagli-last') || 0); if (la) lastAct = la; } catch (e) {}
const storeAct = () => { try { localStorage.setItem('alesagli-last', String(lastAct)); } catch (e) {} };
window.addEventListener('pagehide', storeAct);
document.addEventListener('visibilitychange', () => { if (document.hidden) storeAct(); });
const lockMins = () => { try { return Number(localStorage.getItem('alesagli-lock') || '0'); } catch (e) { return 0; } };
$('#lockSelect').value = String(lockMins());
$('#lockSelect').onchange = e => { try { localStorage.setItem('alesagli-lock', e.target.value); } catch (er) {} startLockTimer(); };
function stopLockTimer(){ clearInterval(lockTimer); lockTimer = null; }
function startLockTimer(){
  stopLockTimer();
  if (!lockMins()) return;
  const check = () => { if (currentUser && $('#lockScreen').hidden && Date.now() - lastAct > lockMins() * 60000) lockApp(); };
  setTimeout(check, 300);
  lockTimer = setInterval(() => { check(); storeAct(); }, 15000);
}
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastAct = Date.now(); }, { passive:true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden && currentUser && lockMins() && Date.now() - lastAct > lockMins() * 60000) lockApp(); });
function lockApp(){
  closeSheet(); $('#impBack').hidden = true;
  $('#lockEmail').textContent = currentUser.email; $('#lockPass').value = ''; $('#lockErr').textContent = '';
  $('#lockScreen').hidden = false; $('#appWrap').setAttribute('inert', ''); $('#appWrap').style.filter = 'blur(12px)';
  setTimeout(() => $('#lockPass').focus(), 50);
}
function unlockApp(){ $('#lockScreen').hidden = true; $('#appWrap').removeAttribute('inert'); $('#appWrap').style.filter = ''; lastAct = Date.now(); }
$('#lockForm').onsubmit = async e => {
  e.preventDefault();
  const wait = loginWait();
  if (wait > 0) { $('#lockErr').textContent = tWait(wait); return; }
  const { error } = await sb.auth.signInWithPassword({ email: currentUser.email, password: $('#lockPass').value });
  if (error) { loginFailed(); $('#lockErr').textContent = t3('Contraseña incorrecta.', 'Password errata.', 'Wrong password.'); return; }
  loginOk(); unlockApp();
};
$('#lockLogout').onclick = async () => { unlockApp(); await sb.auth.signOut({ scope:'local' }); };

// Último acceso, cambio de contraseña y cierre de sesión global
sb.auth.onAuthStateChange((ev, session) => {
  if (session && session.user) {
    const t = session.user.last_sign_in_at;
    $('#lastLogin').textContent = t ? new Intl.DateTimeFormat(LOC(), { dateStyle:'full', timeStyle:'short' }).format(new Date(t)) : '—';
    startLockTimer();
  } else { stopLockTimer(); unlockApp(); }
});
$('#changePass').onclick = async () => {
  if (!currentUser) return;
  const { error } = await sb.auth.resetPasswordForEmail(currentUser.email, { redirectTo: location.origin + location.pathname });
  alert(error ? t3('No se pudo enviar el enlace. Inténtalo más tarde.', 'Impossibile inviare il link. Riprova più tardi.', 'Couldn\'t send the link. Try again later.') : t3('Te hemos enviado un enlace a tu correo para cambiar la contraseña.', 'Ti abbiamo inviato un link via email per cambiare la password.', 'We\'ve emailed you a link to change your password.'));
};
// Si la sesión ya estaba cargada antes de que este archivo terminara de cargar
if (currentUser && !X) loadExtra();

$('#logoutAll').onclick = async () => {
  if (!confirm(t3('¿Cerrar sesión en todos tus dispositivos (incluido este)?', 'Uscire da tutti i dispositivi (incluso questo)?', 'Sign out on all your devices (including this one)?'))) return;
  await sb.auth.signOut({ scope:'global' });
};
})();
