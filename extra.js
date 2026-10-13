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

// ---------- datos ampliados (documento user_data en Firebase, con copia local) ----------
let X = null;            // { v, u, tx:[], meta:{}, incomes:[], goals:[], history:{} }
let xMode = 'cloud';     // 'cloud' | 'local'
let selMonth = curMonth();
const uid = () => currentUser && currentUser.id;
function blankX(){ return { v:1, u:0, tx:[], meta:{}, incomes:[], goals:[], history:{}, subIgnore:[], debts:[], debtCfg:{}, worth:{} }; }
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

let lastUid = null;
window.loadExtra = async function(){
  const id = uid(); if (!id) return;
  lastUid = id;
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
  renderIncomes(); renderGoals(); renderDebts(); refreshViews();
  checkBillReminders();
  if (/[?&]accion=apuntar/.test(location.search)) { history.replaceState(null, '', location.pathname); setTimeout(openSheet, 600); }
};
window.onSignedOut = function(){
  // Privacidad: al cerrar sesión se borra la copia local de los datos de esa cuenta en este dispositivo.
  if (lastUid) ['alesagli-cache-', 'alesagli-x-', 'alesagli-notified-'].forEach(k => { try { localStorage.removeItem(k + lastUid); } catch (e) {} });
  lastUid = null; X = null; selMonth = curMonth(); stopLockTimer();
  renderIncomes(); renderGoals(); renderDebts();
};
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
  renderFund();
  if (!X) return;
  snapshotHistory();
  refreshViews();
};
function refreshViews(){
  renderFund();
  if (!X) return;
  const it = $('#incomeTotal');
  if (X.incomes.length) { it.hidden = false; it.textContent = t3('Ingresos totales: ', 'Entrate totali: ', 'Total income: ') + money(planNow().inc); } else it.hidden = true;
  decorateRows(); renderMoves(); renderCharts(); renderBills(); renderSubs(); renderTips(); snapshotWorth(); updateDebtPlan(); renderYear(); updateGoalsProgress();
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
  fillTxCats(); renderTags();
  const F = txFilter(txIn(selMonth));
  const txs = F.txs.slice().sort((a, b) => b.d.localeCompare(a.d));
  const found = $('#txFound');
  found.hidden = !F.active;
  if (F.active) found.innerHTML = esc(t3(`${txs.length} ${txs.length === 1 ? 'gasto' : 'gastos'}${F.all ? ' en todos los meses' : ''} · total `, `${txs.length} ${txs.length === 1 ? 'spesa' : 'spese'}${F.all ? ' in tutti i mesi' : ''} · totale `, `${txs.length} ${txs.length === 1 ? 'expense' : 'expenses'}${F.all ? ' across all months' : ''} · total `)) + '<b>' + esc(money(txs.reduce((s, t) => s + toNum(t.a), 0))) + '</b>';
  if (!txs.length && F.active) { list.append(el('p', 'empty', esc(t3('No hay gastos que coincidan con tu búsqueda.', 'Nessuna spesa corrisponde alla ricerca.', 'No expenses match your search.')))); return; }
  if (!txs.length) {
    list.append(el('p', 'empty', esc(t3('Aún no has apuntado gastos este mes. Pulsa «+» para apuntar uno en segundos, o importa el extracto de tu banco.', 'Non hai ancora annotato spese questo mese. Premi «+» per aggiungerne una in pochi secondi o importa l\'estratto conto.', 'No expenses logged this month yet. Tap «+» to add one in seconds, or import your bank statement.'))));
    return;
  }
  let lastDay = '';
  txs.forEach(t => {
    if (t.d !== lastDay) { lastDay = t.d; list.append(el('div', 'txDay', esc(dayLabel(t.d) + (F.all && t.d.slice(0, 4) !== today().slice(0, 4) ? ' ' + t.d.slice(0, 4) : '')))); }
    const c = catOf(t.c);
    const r = el('div', 'tx');
    r.innerHTML = `<span class="em">${esc(c.emoji)}</span><div style="min-width:0"><div class="nm">${esc(c.name)}</div>${t.n ? `<div class="nt">${esc(t.n)}</div>` : ''}</div><span class="am">${esc(money(t.a))}</span><button type="button" class="remove" title="${esc(t3('Eliminar movimiento', 'Elimina movimento', 'Delete transaction'))}" aria-label="${esc(t3('Eliminar movimiento', 'Elimina movimento', 'Delete transaction'))}">×</button>`;
    r.querySelector('.remove').onclick = () => { X.tx = X.tx.filter(x => x !== t); saveX(); refreshViews(); };
    list.append(r);
  });
}

// ---------- 4 · apuntado rápido (botón +) ----------
let qCat = null, sheetCats = [];
function openSheet(){
  if (!X) return;
  $('#qAmount').value = ''; $('#qNote').value = ''; $('#qErr').textContent = '';
  $('#qDate').value = selMonth === curMonth() ? today() : selMonth + '-01';
  $('#qDate').max = today();
  const cats = $('#qCats'); cats.innerHTML = '';
  const list = expenses.slice().sort((a, b) => (typeOf(a) === 'v' ? 0 : 1) - (typeOf(b) === 'v' ? 0 : 1));
  sheetCats = list;
  $('#qScanMsg').textContent = '';
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
function compact(v){ if (typeof window.fxCompact === 'function') return window.fxCompact(v); return v >= 1000 ? (Math.round(v / 100) / 10).toString().replace('.', ',') + ' k€' : Math.round(v) + ' €'; }
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
  else {
    msg = `${esc(t3('Te faltan', 'Ti mancano', 'You still need'))} <b>${esc(money(tgt - sv))}</b> · ${Math.round(pct)} %`;
    if (g.date) {
      const [y1, m1] = curMonth().split('-').map(Number), [y2, m2] = g.date.split('-').map(Number), n = (y2 - y1) * 12 + (m2 - m1);
      msg += n > 0
        ? ` · ${esc(t3('Ahorra', 'Metti da parte', 'Save'))} <b>${esc(money((tgt - sv) / n))} ${esc(t3('al mes', 'al mese', 'a month'))}</b> ${esc(t3('para conseguirlo en', 'per raggiungerlo a', 'to reach it by'))} ${esc(monthLabel(g.date))}`
        : ` · ${esc(t3('La fecha ya ha llegado: cambia la fecha o aporta lo que falta.', 'La data è arrivata: cambiala o versa quanto manca.', 'The date has arrived: change it or add what\'s missing.'))}`;
    }
  }
  return { pct, msg };
}
function renderGoals(){
  const box = $('#goals'); box.innerHTML = '';
  if (!X) return;
  if (!X.goals.length) box.append(el('p', 'empty', esc(t3('Aún no tienes objetivos.', 'Non hai ancora obiettivi.', 'No goals yet.'))));
  X.goals.forEach(g => {
    const c = el('div', 'goal'); c.dataset.id = g.id;
    c.innerHTML = `<div class="goalHead"><button type="button" class="emoji${g.emoji ? '' : ' empty'}" aria-label="${esc(t3('Cambiar emoji', 'Cambia emoji', 'Change emoji'))}">${g.emoji ? esc(g.emoji) + '<span class="plus">+</span>' : '+'}</button><input class="gName" maxlength="60" value="${esc(g.name)}" placeholder="${esc(t3('Ej. Vacaciones', 'Es. Vacanze', 'e.g. Holidays'))}" aria-label="${esc(t3('Nombre del objetivo', 'Nome dell\'obiettivo', 'Goal name'))}"><button type="button" class="remove" aria-label="${esc(t3('Eliminar objetivo', 'Elimina obiettivo', 'Delete goal'))}">×</button></div>
      <div class="goalNums withDate"><label>${esc(t3('Objetivo', 'Obiettivo', 'Target'))}<input class="gTarget" inputmode="decimal" value="${esc(toInput(g.target || ''))}" placeholder="0,00"></label><label>${esc(t3('Ahorrado', 'Risparmiato', 'Saved'))}<input class="gSaved" inputmode="decimal" value="${esc(toInput(g.saved || ''))}" placeholder="0,00"></label><label>${esc(t3('Para cuándo', 'Entro quando', 'By when'))}<input class="gDate" type="month" value="${esc(g.date || '')}" min="${esc(curMonth())}"></label><button type="button" class="addSmall gAdd">+ ${esc(t3('Aportar', 'Versa', 'Add money'))}</button></div>
      <div class="goalBar"><i></i></div><p class="goalMsg"></p>`;
    c.querySelector('.emoji').onclick = ev => { ev.stopPropagation(); openEmojiPicker(ev.currentTarget, 'goal:' + g.id); };
    c.querySelector('.gName').oninput = e => { g.name = e.target.value; saveX(); };
    c.querySelector('.gTarget').oninput = e => { g.target = toNum(e.target.value); updateGoalsProgress(); saveX(); };
    c.querySelector('.gSaved').oninput = e => { g.saved = toNum(e.target.value); updateGoalsProgress(); saveX(); };
    c.querySelector('.gDate').onchange = e => { g.date = /^\d{4}-\d{2}$/.test(e.target.value) ? e.target.value : ''; updateGoalsProgress(); saveX(); };
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

// ---------- fondo de emergencia: gastos fijos × los meses que elijas ----------
function fundMonths(){
  let m = X && X.fundMonths;
  if (!m) { try { m = Number(localStorage.getItem('alesagli-fund-months')); } catch (e) {} }
  m = Math.round(Number(m));
  return [3, 6, 9, 12].includes(m) ? m : 6;
}
function setFundMonths(m){
  m = Math.round(Number(m));
  if (![3, 6, 9, 12].includes(m)) return;
  try { localStorage.setItem('alesagli-fund-months', String(m)); } catch (e) {}
  if (X && X.fundMonths !== m) { X.fundMonths = m; saveX(); }
  renderFund();
}
document.querySelectorAll('.fundOpt').forEach(b => { b.onclick = () => setFundMonths(b.dataset.m); });
function renderFund(){
  const FUND_MONTHS = fundMonths();
  document.querySelectorAll('.fundOpt').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.m) === FUND_MONTHS ? 'true' : 'false'));
  const mWord = n => n === 1 ? t3('mes', 'mese', 'month') : t3('meses', 'mesi', 'months');
  $('#fundX').textContent = '× ' + FUND_MONTHS;
  $('#fundNeedLbl').textContent = t3(`Necesitas para ${FUND_MONTHS} ${mWord(FUND_MONTHS)}`, `Ti servono per ${FUND_MONTHS} ${mWord(FUND_MONTHS)}`, `Needed for ${FUND_MONTHS} ${mWord(FUND_MONTHS)}`);
  const fixed = expenses.filter(e => typeOf(e) === 'f' && toNum(e.amount) > 0);
  const monthly = fixed.reduce((s, e) => s + toNum(e.amount), 0), need = monthly * FUND_MONTHS;
  const have = Math.max(0, toNum(savings.now)), pct = need > 0 ? Math.min(have / need * 100, 100) : 0;
  $('#fundMonthly').textContent = money(monthly);
  $('#fundNeed').textContent = money(need);
  $('#fundMini').textContent = money(need);
  $('#fundPct').textContent = Math.round(pct) + ' %';
  $('#fundBar').style.width = pct + '%';
  const msg = $('#fundMsg');
  if (!(need > 0)) msg.textContent = t3('Añade tus gastos fijos para calcular cuánto necesitas.', 'Aggiungi le spese fisse per calcolare quanto ti serve.', 'Add your fixed expenses to work out how much you need.');
  else {
    const months = monthly > 0 ? have / monthly : 0;
    const cover = months >= 1 ? t3(` Con lo que tienes ahorrado cubres ${months.toFixed(1).replace('.', ',')} meses.`, ` Con quanto hai risparmiato copri ${months.toFixed(1).replace('.', ',')} mesi.`, ` Your savings cover ${months.toFixed(1)} months.`) : '';
    if (have >= need) msg.innerHTML = esc(t3(`¡Lo tienes cubierto! Tus ahorros pagan ${FUND_MONTHS} ${mWord(FUND_MONTHS)} de gastos fijos.`, `Sei coperto! I tuoi risparmi pagano ${FUND_MONTHS} ${mWord(FUND_MONTHS)} di spese fisse.`, `You're covered! Your savings pay for ${FUND_MONTHS} ${mWord(FUND_MONTHS)} of fixed expenses.`)) + esc(cover);
    else {
      const missing = need - have, left = Math.max(0, planNow().inc - planNow().plan);
      const per = String(savings.monthly).trim() === '' ? left : toNum(savings.monthly);
      let when = '';
      if (per > 0) { const n = Math.ceil(missing / per); when = t3(` Ahorrando ${money(per)} al mes lo tendrás en ${n} ${n === 1 ? 'mes' : 'meses'}.`, ` Risparmiando ${money(per)} al mese lo avrai in ${n} ${n === 1 ? 'mese' : 'mesi'}.`, ` Saving ${money(per)} a month you'll have it in ${n} ${n === 1 ? 'month' : 'months'}.`); }
      msg.innerHTML = `${esc(t3('Te faltan', 'Ti mancano', 'You still need'))} <b>${esc(money(missing))}</b>.${esc(cover)}${esc(when)}`;
    }
  }
  const tb = $('#fundTable');
  if (!fixed.length) { tb.innerHTML = ''; return; }
  tb.innerHTML = `<table><thead><tr><th>${esc(t3('Gasto fijo', 'Spesa fissa', 'Fixed expense'))}</th><th class="r">${esc(t3('Al mes', 'Al mese', 'Per month'))}</th><th class="r">${esc('× ' + FUND_MONTHS + ' ' + mWord(FUND_MONTHS))}</th></tr></thead><tbody>` +
    fixed.map(e => `<tr><td>${esc((e.emoji ? e.emoji + ' ' : '') + (e.name || ''))}</td><td class="r">${esc(money(e.amount))}</td><td class="r">${esc(money(toNum(e.amount) * FUND_MONTHS))}</td></tr>`).join('') +
    `</tbody><tfoot><tr><td>${esc(t3('Total', 'Totale', 'Total'))}</td><td class="r">${esc(money(monthly))}</td><td class="r">${esc(money(need))}</td></tr></tfoot></table>`;
}

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
  s = String(s || '').replace(/[\s €$]|EUR|USD/gi, '').replace(/−/g, '-');
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

// ---------- 11 · escanear ticket con la cámara (el texto se lee en tu dispositivo: la foto nunca se sube) ----------
const OCR_CDN = 'https://cdn.jsdelivr.net/npm/';
let ocrWorker = null, ocrLang = '';
function loadScript(src){
  return new Promise((ok, ko) => { if (window.Tesseract) return ok(); const s = document.createElement('script'); s.src = src; s.crossOrigin = 'anonymous'; s.onload = ok; s.onerror = () => ko(new Error('load')); document.head.append(s); });
}
async function getOcr(onProgress){
  const lang = ({ es:'spa', it:'ita', en:'eng' })[LANG()] || 'spa';
  if (ocrWorker && ocrLang === lang) return ocrWorker;
  if (ocrWorker) { try { await ocrWorker.terminate(); } catch (e) {} ocrWorker = null; }
  await loadScript(OCR_CDN + 'tesseract.js@5.1.1/dist/tesseract.min.js');
  ocrWorker = await Tesseract.createWorker(lang, 1, {
    workerPath: OCR_CDN + 'tesseract.js@5.1.1/dist/worker.min.js',
    corePath: OCR_CDN + 'tesseract.js-core@5.1.1',
    langPath: OCR_CDN + '@tesseract.js-data/' + lang + '/4.0.0_best_int',
    logger: m => onProgress && onProgress(m)
  });
  ocrLang = lang;
  return ocrWorker;
}
// Reduce la foto y la pasa a escala de grises: el reconocimiento es más rápido y más fiable.
async function prepImage(file){
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation:'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d'); g.filter = 'grayscale(1) contrast(1.35)'; g.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}
// Lee importe total, fecha y comercio del texto del ticket.
function parseReceipt(text){
  const lines = String(text || '').replace(/(\d)\s*([.,])\s*(\d{2})(?!\d)/g, '$1$2$3').split(/\n/).map(l => l.trim()).filter(Boolean);
  const amts = l => (l.match(/\d{1,5}(?:[.,]\d{3})*[.,]\d{2}(?!\d)/g) || []).map(parseAmt).filter(n => n > 0 && n < 100000);
  const TOT = /\b(total|importe|a pagar|totale|tot\.?|suma|amount due|grand total)\b/i;
  const NOT = /sub ?-?total|base|imponible|\biva\b|\bi\.v\.a|cuota|cambio|devol|entregad|ahorr|descuento|\bdto\b|punto|resto|vat|tax|resto|art[ií]culos|items/i;
  const cand = [];
  lines.forEach((l, i) => {
    if (!TOT.test(l) || NOT.test(l)) return;
    let a = amts(l);
    if (!a.length && lines[i + 1]) a = amts(lines[i + 1]);
    if (a.length) cand.push(a[a.length - 1]);
  });
  let amount = cand.length ? Math.max(...cand) : 0;
  if (!amount) { const all = lines.flatMap(amts).filter(n => n < 5000); amount = all.length ? Math.max(...all) : 0; }
  let date = '';
  const lim = isoDay(new Date(Date.now() - 400 * 864e5));
  for (const l of lines) {
    const m = l.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/) || l.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    const d = m && parseDate(m[0]);
    if (d && d <= today() && d >= lim) { date = d; break; }
  }
  let shop = '';
  for (const l of lines.slice(0, 6)) {
    const letters = (l.match(/[a-záéíóúñüàèìòç]/gi) || []).length;
    if (letters >= 3 && letters / l.length > 0.55 && !/ticket|factura|fra\.|nif|cif|c\/|calle|avda|tel[eé]?f?|www|http|@|^\W*$/i.test(l)) { shop = l.replace(/[^\p{L}\p{N} &'.\-]/gu, '').replace(/\s+/g, ' ').trim(); break; }
  }
  if (shop && shop === shop.toUpperCase()) shop = shop.toLowerCase().replace(/(^|\s)\p{L}/gu, c => c.toUpperCase());
  return { amount: r2(amount), date, shop: shop.slice(0, 60) };
}
window.parseReceipt = parseReceipt;   // para pruebas
function scanMsg(t, err){ const m = $('#qScanMsg'); m.textContent = t; m.className = 'qScanMsg' + (err ? ' err' : ''); }
$('#qScanBtn').onclick = () => { const f = $('#qScanFile'); f.value = ''; f.click(); };
$('#qScanFile').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  const btn = $('#qScanBtn'); btn.disabled = true;
  scanMsg(t3('Preparando el lector… (la primera vez tarda un poco)', 'Preparo il lettore… (la prima volta ci vuole un po\')', 'Getting the reader ready… (slower the first time)'));
  try {
    const img = await prepImage(file);
    const w = await getOcr(m => { if (m.status === 'recognizing text') scanMsg(t3('Leyendo el ticket… ', 'Leggo lo scontrino… ', 'Reading the receipt… ') + Math.round((m.progress || 0) * 100) + ' %'); });
    const { data } = await w.recognize(img);
    const r = parseReceipt(data && data.text);
    const got = [];
    if (r.amount > 0) { $('#qAmount').value = fmt2(r.amount); got.push(t3('importe', 'importo', 'amount')); }
    if (r.date) { $('#qDate').value = r.date; got.push(t3('fecha', 'data', 'date')); }
    if (r.shop) { $('#qNote').value = r.shop; got.push(t3('comercio', 'negozio', 'shop')); }
    const c = guessCat(r.shop) || guessCat((data.text || '').slice(0, 300));
    if (c) { qCat = c; $('#qCats').querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', same(sheetCats[i] && sheetCats[i].id, c))); }
    scanMsg(got.length
      ? t3('✓ He leído: ', '✓ Ho letto: ', '✓ Read: ') + got.join(', ') + t3('. Revísalo antes de guardar.', '. Controlla prima di salvare.', '. Check it before saving.')
      : t3('No he podido leer el ticket. Prueba con una foto más cerca, recta y con buena luz.', 'Non riesco a leggere lo scontrino. Prova con una foto più vicina, dritta e con buona luce.', 'Couldn\'t read the receipt. Try a closer, straight photo in good light.'), !got.length);
  } catch (err) {
    scanMsg(navigator.onLine === false
      ? t3('Necesitas conexión la primera vez para descargar el lector de tickets.', 'Serve la connessione la prima volta per scaricare il lettore.', 'You need a connection the first time to download the reader.')
      : t3('No se ha podido leer la foto. Inténtalo de nuevo.', 'Impossibile leggere la foto. Riprova.', 'Couldn\'t read the photo. Please try again.'), true);
  } finally { btn.disabled = false; }
};

// ---------- 14 · detectar suscripciones (cargos que se repiten cada mes) ----------
const SUB_STOP = /\b(compra|compras|pago|pagos|recibo|recibos|tarj(eta)?|card|debit|d[eé]bito|cargo|adeudo|domiciliaci[oó]n|transferencia|bizum|en|de|del|la|el|con|ref|sepa|cuota|mensual|payment|purchase|www|com|es|net|eur|usd|s\.?l\.?|s\.?a\.?|inc|ltd)\b/gi;
function subKey(n){
  const w = String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d+/g, ' ').replace(SUB_STOP, ' ').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(x => x.length > 1);
  return w.slice(0, 2).join(' ');
}
function median(a){ const s = a.slice().sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; }
function detectSubs(){
  if (!X) return [];
  const from = addMonths(curMonth(), -6) + '-01';
  const groups = {};
  X.tx.forEach(t => { if (t.d < from || !t.n) return; const k = subKey(t.n); if (k.length < 3) return; (groups[k] = groups[k] || []).push(t); });
  const recent = isoDay(new Date(Date.now() - 45 * 864e5));
  const out = [];
  for (const k in groups) {
    const g = groups[k], med = median(g.map(t => toNum(t.a)));
    if (!(med > 0)) continue;
    const same = g.filter(t => Math.abs(toNum(t.a) - med) <= Math.max(0.5, med * 0.15));
    const months = new Set(same.map(t => t.d.slice(0, 7)));
    const allMonths = new Set(g.map(t => t.d.slice(0, 7))).size;
    if (months.size < 2 || g.length > allMonths * 1.5) continue;   // al menos 2 meses y ~1 cargo al mes en ese comercio (descarta el súper)
    const last = same.map(t => t.d).sort().pop();
    if (last < recent) continue;                                          // ya no se cobra
    const lastTx = same.find(t => t.d === last);
    const amount = r2(toNum(lastTx.a));
    const day = Math.round(median(same.map(t => Number(t.d.slice(8)))));
    const name = (lastTx.n || k).replace(/\s+/g, ' ').trim().slice(0, 40);
    const known = expenses.find(e => typeOf(e) === 'f' && (e.name || '').trim().length >= 3 && (() => { const en = subKey(e.name) || (e.name || '').toLowerCase(); return en && (k.includes(en) || en.includes(k) || k.split(' ')[0] === en.split(' ')[0]); })());
    out.push({ key:k, name, amount, day, months:months.size, known });
  }
  return out.sort((a, b) => (a.known ? 1 : 0) - (b.known ? 1 : 0) || b.amount - a.amount);
}
async function addSubAsFixed(s){
  if (!currentUser) return;
  setStatus('Guardando…', 'saving');
  const { data, error } = await sb.from('expenses').insert({ user_id: currentUser.id, emoji: '🔁', name: s.name, amount: s.amount }).select().single();
  if (error) { setStatus('Error al guardar', 'error'); return; }
  expenses.push({ id: data.id, emoji: data.emoji, name: data.name, amount: data.amount });
  if (s.day) X.meta[data.id] = Object.assign({}, X.meta[data.id], { day: s.day });
  saveX();
  render();
  setStatus('✓ Guardado en la nube', 'ok');
}
function renderSubs(){
  const box = $('#subs'); if (!box) return;
  box.innerHTML = '';
  const ign = new Set(X.subIgnore || []);
  const list = detectSubs().filter(s => !ign.has(s.key));
  const yearly = list.reduce((s, x) => s + x.amount * 12, 0);
  $('#subsMini').textContent = money(yearly);
  if (!list.length) {
    $('#subsInfo').textContent = t3('Aún no vemos cargos que se repitan cada mes. Cuando apuntes o importes los movimientos de tu banco de un par de meses, aquí aparecerán tus suscripciones y cuánto te cuestan al año.', 'Non vediamo ancora addebiti che si ripetono ogni mese. Quando annoterai o importerai i movimenti di un paio di mesi, qui appariranno i tuoi abbonamenti e quanto ti costano all\'anno.', 'No monthly repeating charges yet. Once you log or import a couple of months of bank transactions, your subscriptions and their yearly cost will show up here.');
    return;
  }
  $('#subsInfo').innerHTML = esc(t3(`Hemos encontrado ${list.length} cargos que se repiten cada mes. En total te cuestan `, `Abbiamo trovato ${list.length} addebiti che si ripetono ogni mese. In totale ti costano `, `We found ${list.length} charges that repeat every month. Together they cost you `)) + '<b>' + esc(money(yearly)) + '</b>' + esc(t3(' al año. ¿Los usas todos?', ' all\'anno. Li usi tutti?', ' a year. Do you use them all?'));
  list.forEach(s => {
    const r = el('div', 'sub' + (s.known ? ' known' : ''));
    r.innerHTML = `<span class="em">🔁</span><div style="min-width:0"><div class="nm" title="${esc(s.name)}">${esc(s.name)}</div><div class="dt">${esc(money(s.amount) + t3(' al mes · ', ' al mese · ', ' a month · ') + t3(`visto en ${s.months} meses · suele cobrarse el día ${s.day}`, `visto in ${s.months} mesi · di solito il giorno ${s.day}`, `seen in ${s.months} months · usually on day ${s.day}`))}</div></div><div class="yr">${esc(money(s.amount * 12))}<small>${esc(t3('al año', 'all\'anno', 'a year'))}</small></div><div class="acts"></div>`;
    const acts = r.querySelector('.acts');
    if (s.known) acts.append(el('span', 'dt', esc('✓ ' + t3('Ya está en tus gastos fijos como «', 'È già nelle spese fisse come «', 'Already in your fixed expenses as «') + (s.known.name || '') + '»')));
    else {
      const add = el('button', 'add', esc(t3('Añadir a gastos fijos', 'Aggiungi alle spese fisse', 'Add to fixed expenses'))); add.type = 'button';
      add.onclick = async () => { add.disabled = true; await addSubAsFixed(s); };
      acts.append(add);
    }
    const no = el('button', 'ghost', esc(s.known ? t3('Ocultar', 'Nascondi', 'Hide') : t3('No es una suscripción', 'Non è un abbonamento', 'Not a subscription'))); no.type = 'button';
    no.onclick = () => { X.subIgnore = (X.subIgnore || []).concat(s.key); saveX(); renderSubs(); };
    acts.append(no);
    box.append(r);
  });
}

// ---------- 6 · plan para pagar deudas (bola de nieve / avalancha) ----------
const debtCfg = () => { X.debtCfg = X.debtCfg && typeof X.debtCfg === 'object' ? X.debtCfg : {}; return X.debtCfg; };
const debtTotal = () => X ? (X.debts || []).reduce((s, d) => s + Math.max(0, toNum(d.balance)), 0) : 0;
function simDebts(list, extra, method){
  const ds = list.filter(d => toNum(d.balance) > 0).map(d => ({ name: (d.name || '').trim() || t3('Deuda', 'Debito', 'Debt'), b: toNum(d.balance), r: Math.max(0, toNum(d.rate)) / 1200, min: Math.max(0, toNum(d.min)) }));
  if (!ds.length) return null;
  const budget = ds.reduce((s, d) => s + d.min, 0) + Math.max(0, extra);
  const order = (a, b) => method === 'aval' ? (b.r - a.r || a.b - b.b) : (a.b - b.b || b.r - a.r);
  let m = 0, interest = 0; const done = [];
  while (ds.some(d => d.b > 0.005) && m < 600) {
    m++;
    ds.forEach(d => { if (d.b > 0.005) { const i = d.b * d.r; d.b += i; interest += i; } });
    let left = budget;
    ds.forEach(d => { if (d.b > 0.005) { const p = Math.min(d.min, d.b, left); d.b -= p; left -= p; } });
    ds.filter(d => d.b > 0.005).sort(order).forEach(d => { const p = Math.min(d.b, left); d.b -= p; left -= p; });
    ds.forEach(d => { if (d.b <= 0.005 && !d.done) { d.done = m; d.b = 0; done.push({ name: d.name, month: m }); } });
  }
  return { ok: !ds.some(d => d.b > 0.005), months: m, interest: r2(interest), done, budget: r2(budget) };
}
function renderDebts(){
  const box = $('#debts'); if (!box) return; box.innerHTML = '';
  if (!X) return;
  X.debts = Array.isArray(X.debts) ? X.debts : [];
  if (!X.debts.length) box.append(el('p', 'empty', esc(t3('No tienes deudas apuntadas. Si tienes algún préstamo o tarjeta, añádelo aquí.', 'Nessun debito annotato. Se hai un prestito o una carta, aggiungilo qui.', 'No debts added. If you have a loan or card, add it here.'))));
  X.debts.forEach(d => {
    const c = el('div', 'goal');
    c.innerHTML = `<div class="goalHead"><span class="emoji" aria-hidden="true">💳</span><input class="dName" maxlength="60" value="${esc(d.name || '')}" placeholder="${esc(t3('Ej. Tarjeta, préstamo del coche', 'Es. Carta, prestito auto', 'e.g. Credit card, car loan'))}" aria-label="${esc(t3('Nombre de la deuda', 'Nome del debito', 'Debt name'))}"><button type="button" class="remove" aria-label="${esc(t3('Eliminar deuda', 'Elimina debito', 'Delete debt'))}">×</button></div>
      <div class="debtNums"><label>${esc(t3('Debes', 'Devi', 'You owe'))}<input class="dBal" inputmode="decimal" value="${esc(toInput(d.balance || ''))}" placeholder="0,00"></label><label>${esc(t3('Interés anual (%)', 'Interesse annuo (%)', 'Yearly interest (%)'))}<input class="dRate" inputmode="decimal" value="${esc(toInput(d.rate || ''))}" placeholder="${esc(t3('Ej. 18', 'Es. 18', 'e.g. 18'))}"></label><label>${esc(t3('Cuota mínima al mes', 'Rata minima al mese', 'Minimum monthly payment'))}<input class="dMin" inputmode="decimal" value="${esc(toInput(d.min || ''))}" placeholder="0,00"></label></div>`;
    const bind = (cls, key, num) => { c.querySelector(cls).oninput = e => { d[key] = num ? toNum(e.target.value) : e.target.value; saveX(); updateDebtPlan(); renderYear(); }; };
    bind('.dName', 'name'); bind('.dBal', 'balance', 1); bind('.dRate', 'rate', 1); bind('.dMin', 'min', 1);
    c.querySelector('.remove').onclick = () => { if (!confirm(t3('¿Eliminar esta deuda?', 'Eliminare questo debito?', 'Delete this debt?'))) return; X.debts = X.debts.filter(x => x !== d); saveX(); renderDebts(); renderYear(); };
    box.append(c);
  });
  const cfg = debtCfg();
  $('#debtExtra').value = cfg.extra ? toInput(cfg.extra) : '';
  updateDebtPlan();
}
function updateDebtPlan(){
  if (!X) return;
  const cfg = debtCfg(), method = cfg.method === 'aval' ? 'aval' : 'snow';
  $('#debtMini').textContent = money(debtTotal());
  document.querySelectorAll('.debtOpt').forEach(b => b.setAttribute('aria-pressed', b.dataset.method === method ? 'true' : 'false'));
  $('#debtMethodHint').textContent = method === 'aval'
    ? t3('Avalancha: pagas el mínimo en todas y todo lo demás va a la deuda con más interés. Es la forma de pagar menos intereses.', 'Valanga: paghi il minimo su tutti e il resto va al debito con l\'interesse più alto. Così paghi meno interessi.', 'Avalanche: pay the minimum on all and put the rest on the highest-interest debt. This costs the least interest.')
    : t3('Bola de nieve: pagas el mínimo en todas y todo lo demás va a la deuda más pequeña. Liquidas deudas antes y te motiva seguir.', 'Palla di neve: paghi il minimo su tutti e il resto va al debito più piccolo. Ne chiudi prima qualcuno e resti motivato.', 'Snowball: pay the minimum on all and put the rest on the smallest debt. You clear debts sooner and stay motivated.');
  const plan = $('#debtPlan'), res = $('#debtResult');
  const active = (X.debts || []).filter(d => toNum(d.balance) > 0);
  plan.hidden = !active.length;
  if (!active.length) { res.innerHTML = ''; return; }
  if (active.some(d => !(toNum(d.min) > 0)) && !(toNum(cfg.extra) > 0)) { res.innerHTML = `<div class="debtBox">${esc(t3('Escribe la cuota mínima que pagas al mes en cada deuda para calcular tu plan.', 'Scrivi la rata minima mensile di ogni debito per calcolare il piano.', 'Enter the minimum monthly payment for each debt to build your plan.'))}</div>`; return; }
  const r = simDebts(X.debts, toNum(cfg.extra), method);
  if (!r.ok) { res.innerHTML = `<div class="debtBox neg">${esc(t3('Con estos pagos la deuda no termina de bajar: los intereses son casi tan altos como lo que pagas. Sube la cuota o el extra al mes.', 'Con questi pagamenti il debito non scende: gli interessi sono quasi pari a quanto paghi. Aumenta la rata o l\'extra mensile.', 'With these payments the debt never clears: interest is almost as high as what you pay. Raise the payment or the monthly extra.'))}</div>`; return; }
  const free = monthLabel(addMonths(curMonth(), r.months));
  const other = simDebts(X.debts, toNum(cfg.extra), method === 'aval' ? 'snow' : 'aval');
  let cmp = '';
  if (other && other.ok) {
    const diff = r2(other.interest - r.interest);
    if (diff > 1) cmp = t3(`Con este método ahorras ${money(diff)} en intereses frente al otro.`, `Con questo metodo risparmi ${money(diff)} di interessi rispetto all'altro.`, `This method saves you ${money(diff)} in interest vs the other.`);
    else if (diff < -1) cmp = (method === 'snow' ? t3('Con avalancha', 'Con la valanga', 'With avalanche') : t3('Con bola de nieve', 'Con la palla di neve', 'With snowball')) + t3(` pagarías ${money(-diff)} menos de intereses.`, ` pagheresti ${money(-diff)} in meno di interessi.`, ` you'd pay ${money(-diff)} less interest.`);
    else cmp = t3('Los dos métodos te cuestan casi lo mismo: elige el que te motive más.', 'I due metodi costano quasi uguale: scegli quello che ti motiva di più.', 'Both methods cost about the same: pick the one that motivates you.');
  }
  const extraTip = toNum(cfg.extra) > 0 ? '' : ' ' + t3('Si añades un extra al mes, terminarás antes.', 'Se aggiungi un extra al mese, finirai prima.', 'Adding a monthly extra will get you there sooner.');
  res.innerHTML = `<div class="debtBox"><div class="muted" style="font-size:.85rem;font-weight:700">${esc(t3('Libre de deudas en', 'Libero dai debiti a', 'Debt-free by'))}</div><div class="big">🎉 ${esc(free)}</div>
    <div style="margin-top:4px">${esc(t3(`${r.months} meses pagando ${money(r.budget)} al mes · pagarás ${money(r.interest)} de intereses.`, `${r.months} mesi pagando ${money(r.budget)} al mese · pagherai ${money(r.interest)} di interessi.`, `${r.months} months paying ${money(r.budget)} a month · ${money(r.interest)} in interest.`) + extraTip)}</div>
    <ol class="debtSteps">${r.done.map((d, i) => `<li><span>${i + 1}.</span><span>${esc(d.name)}</span><b>${esc(monthLabel(addMonths(curMonth(), d.month)))}</b></li>`).join('')}</ol>
    ${cmp ? `<p class="debtCmp">${esc(cmp)}</p>` : ''}</div>`;
}
$('#addDebt').onclick = () => {
  if (!X) return;
  X.debts = Array.isArray(X.debts) ? X.debts : [];
  X.debts.push({ id:newId(), name:'', balance:0, rate:0, min:0 });
  saveX(); renderDebts();
  const last = $('#debts').lastElementChild; if (last && last.querySelector('.dName')) last.querySelector('.dName').focus();
};
$('#debtExtra').oninput = e => { if (!X) return; debtCfg().extra = toNum(e.target.value); saveX(); updateDebtPlan(); };
document.querySelectorAll('.debtOpt').forEach(b => { b.onclick = () => { if (!X) return; debtCfg().method = b.dataset.method; saveX(); updateDebtPlan(); }; });

// ---------- 10 · resumen del año y patrimonio neto ----------
let selYear = new Date().getFullYear();
function minYear(){
  let y = new Date().getFullYear();
  if (X) { X.tx.forEach(t => { y = Math.min(y, Number(t.d.slice(0, 4))); }); Object.keys(X.history).forEach(m => { y = Math.min(y, Number(m.slice(0, 4))); }); }
  return y;
}
$('#prevYear').onclick = () => { if (selYear > minYear()) { selYear--; renderYear(); } };
$('#nextYear').onclick = () => { if (selYear < new Date().getFullYear()) { selYear++; renderYear(); } };
function snapshotWorth(){
  if (!X || !window.budgetLoaded) return;
  X.worth = X.worth && typeof X.worth === 'object' && !Array.isArray(X.worth) ? X.worth : {};
  const n = { a: r2(toNum(savings.now)), d: r2(debtTotal()) }, h = X.worth[curMonth()];
  if (!h || h.a !== n.a || h.d !== n.d) { X.worth[curMonth()] = n; saveX(); }
}
function renderYear(){
  if (!X || !$('#yearCard')) return;
  const nowY = new Date().getFullYear();
  $('#yearLabel').textContent = String(selYear);
  $('#prevYear').disabled = selYear <= minYear(); $('#nextYear').disabled = selYear >= nowY;
  const months = []; for (let i = 1; i <= 12; i++) { const m = selYear + '-' + pad(i); if (m <= curMonth()) months.push(m); }
  const rows = months.map(m => { const p = planFor(m) || {}; return { m, inc: p.inc || 0, plan: p.plan || 0, spent: spentBy(m).total }; }).filter(r => r.inc || r.plan || r.spent);
  const sum = k => rows.reduce((s, r) => s + r[k], 0), withSpent = rows.filter(r => r.spent > 0);
  $('#yInc').textContent = rows.length ? money(sum('inc')) : '—';
  $('#ySpent').textContent = withSpent.length ? money(sum('spent')) : '—';
  $('#yAvg').textContent = withSpent.length ? money(sum('spent') / withSpent.length) : '—';
  if (!rows.length) $('#yTable').innerHTML = `<p class="empty">${esc(t3('Aún no hay datos de este año.', 'Ancora nessun dato per quest\'anno.', 'No data for this year yet.'))}</p>`;
  else {
    const diff = r => r.spent > 0 ? `<span class="${r.plan - r.spent < 0 ? 'neg' : ''}">${esc((r.plan - r.spent < 0 ? '−' : '') + money(Math.abs(r.plan - r.spent)))}</span>` : '—';
    $('#yTable').innerHTML = `<table><thead><tr><th>${esc(t3('Mes', 'Mese', 'Month'))}</th><th>${esc(t3('Ingresos', 'Entrate', 'Income'))}</th><th>${esc(t3('Presupuestado', 'Previsto', 'Budgeted'))}</th><th>${esc(t3('Gastado', 'Speso', 'Spent'))}</th><th>${esc(t3('Te sobró', 'Avanzato', 'Left over'))}</th></tr></thead><tbody>`
      + rows.map(r => `<tr><td>${esc(monthLabel(r.m, true))}</td><td>${esc(money(r.inc))}</td><td>${esc(money(r.plan))}</td><td>${r.spent ? esc(money(r.spent)) : '—'}</td><td>${diff(r)}</td></tr>`).join('')
      + `</tbody><tfoot><tr><td><b>${esc(t3('Total', 'Totale', 'Total'))}</b></td><td><b>${esc(money(sum('inc')))}</b></td><td><b>${esc(money(sum('plan')))}</b></td><td><b>${esc(money(sum('spent')))}</b></td><td></td></tr></tfoot></table>`;
  }
  const by = {};
  X.tx.forEach(t => { if (t.d.slice(0, 4) !== String(selYear)) return; const k = (t.c != null && findCat(t.c)) ? String(t.c) : '_'; by[k] = (by[k] || 0) + toNum(t.a); });
  const top = Object.keys(by).map(k => ({ k, v: by[k] })).sort((a, b) => b.v - a.v).slice(0, 6), mx = top.length ? top[0].v : 1;
  $('#yTop').innerHTML = top.length ? top.map(x => { const c = catOf(x.k); return `<div class="yTop"><span>${esc(c.emoji)}</span><span>${esc(c.name)}</span><b>${esc(money(x.v))}</b><div class="bar2"><i style="width:${Math.max(2, x.v / mx * 100)}%"></i></div></div>`; }).join('')
    : `<p class="empty">${esc(t3('Cuando apuntes gastos reales, aquí verás en qué se te va más dinero.', 'Quando annoterai spese reali, qui vedrai dove spendi di più.', 'Once you log real spending, you\'ll see where most of your money goes.'))}</p>`;
  // patrimonio neto
  const a = toNum(savings.now), d = debtTotal(), n = a - d;
  $('#nwA').textContent = money(a); $('#nwD').textContent = money(d);
  const nw = $('#nwN'); nw.textContent = (n < 0 ? '−' : '') + money(Math.abs(n)); nw.className = n < 0 ? 'neg' : '';
  const hist = Object.keys(X.worth || {}).sort().slice(-12).map(m => ({ m, v: toNum(X.worth[m].a) - toNum(X.worth[m].d) }));
  if (hist.length < 2) { $('#nwChart').innerHTML = `<p class="empty">${esc(t3('Cada mes guardamos tu patrimonio. Vuelve el mes que viene para ver cómo cambia.', 'Ogni mese salviamo il tuo patrimonio. Torna il mese prossimo per vedere come cambia.', 'We save your net worth every month. Come back next month to see how it changes.'))}</p>`; return; }
  const W = Math.round(Math.max(300, Math.min(600, $('#nwChart').clientWidth || 600))), H = 170, T = 14, B = 24, ph = H - T - B;
  const mxv = Math.max(1, ...hist.map(h => h.v)), mnv = Math.min(0, ...hist.map(h => h.v)), span = mxv - mnv || 1;
  const y0 = T + mxv / span * ph, gw = (W - 8) / hist.length, bw = Math.min(30, gw * 0.6);
  let g = `<line x1="4" x2="${W - 4}" y1="${y0}" y2="${y0}" stroke="var(--line)"/>`;
  hist.forEach((h, i) => {
    const x = 4 + gw * i + (gw - bw) / 2, hh = Math.abs(h.v) / span * ph, y = h.v >= 0 ? y0 - hh : y0;
    g += `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(hh, 1)}" rx="4" fill="${h.v >= 0 ? 'var(--s3)' : 'var(--danger)'}" data-tip="${esc(monthLabel(h.m) + ': ' + (h.v < 0 ? '−' : '') + money(Math.abs(h.v)))}"/>`;
    g += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(monthLabel(h.m, true))}</text>`;
  });
  $('#nwChart').innerHTML = `<svg class="barsSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t3('Evolución del patrimonio neto', 'Andamento del patrimonio netto', 'Net worth over time'))}">${g}</svg>`;
}

// ---------- 9 · buscar movimientos y etiquetas ----------
function fillTxCats(){
  const s = $('#txCat'), v = s.value;
  s.innerHTML = `<option value="">${esc(t3('Todas las categorías', 'Tutte le categorie', 'All categories'))}</option>` + expenses.map(e => `<option value="${esc(e.id)}">${esc((e.emoji || '') + ' ' + (e.name || ''))}</option>`).join('') + `<option value="_">${esc('❓ ' + t3('Sin categoría', 'Senza categoria', 'Uncategorised'))}</option>`;
  s.value = [...s.options].some(o => o.value === v) ? v : '';
}
function renderTags(){
  const cnt = {};
  X.tx.forEach(t => (String(t.n || '').match(/#[\p{L}\p{N}_-]{2,}/gu) || []).forEach(h => { h = h.toLowerCase(); cnt[h] = (cnt[h] || 0) + 1; }));
  const tags = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]).slice(0, 12), q = $('#txQ').value.trim().toLowerCase();
  const box = $('#txTags'); box.innerHTML = '';
  tags.forEach(h => { const b = el('button', h === q ? 'sel' : '', esc(h)); b.type = 'button'; b.onclick = () => { $('#txQ').value = h === q ? '' : h; if (h !== q) $('#txAllMonths').checked = true; renderMoves(); }; box.append(b); });
}
['#txQ', '#txCat', '#txAllMonths'].forEach(s => { const e = $(s); e.addEventListener(s === '#txQ' ? 'input' : 'change', () => renderMoves()); });
window.txFilter = function(base){
  const q = $('#txQ').value.trim().toLowerCase(), fc = $('#txCat').value, all = $('#txAllMonths').checked;
  let txs = all ? X.tx.slice() : base;
  if (fc) txs = txs.filter(t => fc === '_' ? !(t.c != null && findCat(t.c)) : same(t.c, fc));
  if (q) { const qa = parseAmt(q); txs = txs.filter(t => ((t.n || '') + ' ' + catOf(t.c).name).toLowerCase().includes(q) || (qa > 0 && Math.abs(toNum(t.a) - qa) < 0.005)); }
  return { txs, active: !!(q || fc || all), all };
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
if (langBtn) langBtn.addEventListener('click', () => setTimeout(() => { themeLabel(); renderFund(); installBtn.textContent = '📲 ' + t3('Instalar app', 'Installa app', 'Install app'); if (X) { renderIncomes(); renderGoals(); refreshViews(); } }, 0));

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
if (window.budgetLoaded) renderFund();

$('#logoutAll').onclick = async () => {
  if (!confirm(t3('¿Cerrar sesión en todos tus dispositivos (incluido este)?', 'Uscire da tutti i dispositivi (incluso questo)?', 'Sign out on all your devices (including this one)?'))) return;
  await sb.auth.signOut({ scope:'global' });
};
})();
