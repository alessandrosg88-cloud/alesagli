// ============================================================
//  Mi presupuesto — cambio de monedas
//  Tasas del día para todas las monedas (open.er-api.com) y el
//  bolívar venezolano oficial BCV y paralelo (ve.dolarapi.com).
//  · Ver todo el presupuesto en otra moneda (los importes se
//    siguen guardando y escribiendo en euros).
//  · Conversor entre cualquier par de monedas.
// ============================================================
(function(){
'use strict';

const LANG = () => { try { return localStorage.getItem('libroLang') || 'es'; } catch (e) { return 'es'; } };
const t3 = (es, it, en) => { const l = LANG(); return l === 'it' ? it : l === 'en' ? en : es; };
const LOC = () => ({ es:'es-ES', it:'it-IT', en:'en-GB' })[LANG()] || 'es-ES';
const esc = s => String(s == null ? '' : s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const $ = s => document.querySelector(s);
const store = {
  get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }
};

const URL_ALL = 'https://open.er-api.com/v6/latest/EUR';
const URL_VE = 'https://ve.dolarapi.com/v1/dolares';
const FX_KEY = 'alesagli-fx', CUR_KEY = 'alesagli-moneda';
const MAX_AGE = 24 * 60 * 60 * 1000; // las tasas se actualizan cada día
const VE_KEY = 'alesagli-venezuela';
let veOn = store.get(VE_KEY) === '1'; // el bolívar BCV / paralelo solo si la persona lo activa

// Monedas que se muestran en la tabla de tasas (las más usadas)
const MAJOR = ['USD', 'VES_BCV', 'VES_PAR', 'GBP', 'CHF', 'JPY', 'CNY', 'CAD', 'AUD', 'BRL', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'UYU', 'BOB', 'PYG', 'DOP', 'CRC', 'GTQ', 'HNL', 'NIO', 'CUP', 'RUB', 'INR', 'TRY', 'MAD'];
const FLAG = { EUR:'🇪🇺', USD:'🇺🇸', VES_BCV:'🇻🇪', VES_PAR:'🇻🇪', GBP:'🇬🇧', CHF:'🇨🇭', JPY:'🇯🇵', CNY:'🇨🇳', CAD:'🇨🇦', AUD:'🇦🇺', BRL:'🇧🇷', MXN:'🇲🇽', COP:'🇨🇴', ARS:'🇦🇷', CLP:'🇨🇱', PEN:'🇵🇪', UYU:'🇺🇾', BOB:'🇧🇴', PYG:'🇵🇾', DOP:'🇩🇴', CRC:'🇨🇷', GTQ:'🇬🇹', HNL:'🇭🇳', NIO:'🇳🇮', CUP:'🇨🇺', RUB:'🇷🇺', INR:'🇮🇳', TRY:'🇹🇷', MAD:'🇲🇦' };

let fx = null; // { t, eur:{CODE: unidades por 1 €}, bcv, par, bcvDate, parDate }
try { fx = JSON.parse(store.get(FX_KEY) || 'null'); } catch (e) { fx = null; }
let loading = false, lastError = '';

// ---------- tasas ----------
const iso = c => c.startsWith('VES') ? 'VES' : c;
function rate(c){ // unidades de la moneda c por 1 €
  if (c === 'EUR') return 1;
  if (!fx || !fx.eur) return null;
  const usd = fx.eur.USD;
  if (c.startsWith('VES_') && !veOn) return null;
  if (c === 'VES_BCV') return fx.bcv && usd ? fx.bcv * usd : (fx.eur.VES || null);
  if (c === 'VES_PAR') return fx.par && usd ? fx.par * usd : null;
  return fx.eur[c] || null;
}
function convert(amount, from, to){ const a = rate(from), b = rate(to); return a && b ? amount / a * b : null; }

function currencyName(c){
  if (c === 'VES_BCV') return t3('Bolívar (oficial BCV)', 'Bolívar (ufficiale BCV)', 'Bolívar (official BCV)');
  if (c === 'VES_PAR') return t3('Bolívar (paralelo)', 'Bolívar (parallelo)', 'Bolívar (parallel)');
  try { const n = new Intl.DisplayNames([LANG()], { type:'currency' }).of(c); return n.charAt(0).toUpperCase() + n.slice(1); } catch (e) { return c; }
}
function fmt(n, c, digits){
  const code = iso(c);
  const x = Math.abs(n), d = digits != null ? digits : (x > 0 && x < 0.01 ? 6 : x > 0 && x < 1 ? 4 : 2);
  try { return new Intl.NumberFormat('es-ES', { style:'currency', currency:code, minimumFractionDigits:d, maximumFractionDigits:d }).format(n || 0); }
  catch (e) { return (n || 0).toFixed(d).replace('.', ',') + ' ' + code; }
}
function symbol(c){
  try { const p = new Intl.NumberFormat('es-ES', { style:'currency', currency:iso(c) }).formatToParts(0).find(x => x.type === 'currency'); return p ? p.value : iso(c); } catch (e) { return iso(c); }
}

async function getJSON(u){
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000);
  try { const r = await fetch(u, { signal: ctl.signal, cache:'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
async function loadRates(force){
  if (loading) return;
  if (!force && fx && Date.now() - fx.t < MAX_AGE) return;
  loading = true; lastError = ''; renderCard();
  const next = Object.assign({}, fx || {});
  const [all, ve] = await Promise.allSettled([getJSON(URL_ALL), veOn ? getJSON(URL_VE) : Promise.resolve(null)]);
  if (all.status === 'fulfilled' && all.value && all.value.rates) {
    next.eur = all.value.rates; next.eurDate = (all.value.time_last_update_unix || 0) * 1000;
  } else lastError = t3('No se pudieron actualizar las tasas mundiales.', 'Impossibile aggiornare i tassi mondiali.', 'Could not update world rates.');
  if (ve.status === 'fulfilled' && Array.isArray(ve.value)) {
    const o = ve.value.find(x => x.fuente === 'oficial'), p = ve.value.find(x => x.fuente === 'paralelo');
    if (o && o.promedio) { next.bcv = o.promedio; next.bcvDate = o.fechaActualizacion; }
    if (p && p.promedio) { next.par = p.promedio; next.parDate = p.fechaActualizacion; }
  } else if (veOn) lastError = (lastError ? lastError + ' ' : '') + t3('No se pudo actualizar el bolívar.', 'Impossibile aggiornare il bolívar.', 'Could not update the bolívar.');
  if (next.eur) { next.t = Date.now(); fx = next; store.set(FX_KEY, JSON.stringify(fx)); }
  loading = false;
  fillSelects(); renderCard(); refreshBudget();
}

// ---------- ver el presupuesto en otra moneda ----------
let display = store.get(CUR_KEY) || 'EUR';
const activeCur = () => (display !== 'EUR' && rate(display)) ? display : 'EUR';

window.fxMoney = function(n){
  const c = activeCur();
  return fmt((n || 0) * rate(c), c, 2);
};
window.fxCompact = function(v){ // para los ejes de los gráficos
  const c = activeCur(), x = v * rate(c), s = symbol(c);
  if (x >= 1e6) return (Math.round(x / 1e5) / 10).toString().replace('.', ',') + ' M' + s;
  if (x >= 1000) return (Math.round(x / 100) / 10).toString().replace('.', ',') + ' k' + s;
  return Math.round(x) + ' ' + s;
};
function refreshBudget(){
  try { if (typeof calculate === 'function') calculate(); } catch (e) {}
  renderNote();
}
function setDisplay(c){
  display = c; store.set(CUR_KEY, c);
  const sel = $('#fxShow'); if (sel) sel.value = c;
  refreshBudget(); renderCard();
}

function renderNote(){
  const n = $('#fxNote'); if (!n) return;
  const c = activeCur();
  if (c === 'EUR') { n.hidden = true; n.innerHTML = ''; return; }
  n.hidden = false;
  n.innerHTML = `<span>💱 ${esc(t3('Viendo los importes en', 'Importi mostrati in', 'Showing amounts in'))} <b>${esc(currencyName(c))}</b> · 1 € = ${esc(fmt(rate(c), c))}. ${esc(t3('Lo que escribes sigue en euros.', 'Quello che scrivi resta in euro.', 'What you type stays in euros.'))}</span><button type="button" class="fxBack">${esc(t3('Volver a €', 'Torna a €', 'Back to €'))}</button>`;
  n.querySelector('.fxBack').onclick = () => setDisplay('EUR');
}

// ---------- tarjeta ----------
function allCodes(){
  const codes = fx && fx.eur ? Object.keys(fx.eur).filter(c => !(veOn && c === 'VES')) : MAJOR.filter(c => !c.startsWith('VES'));
  const top = veOn ? ['EUR', 'USD', 'VES_BCV', 'VES_PAR'] : ['EUR', 'USD'];
  const rest = codes.filter(c => !top.includes(c)).sort((a, b) => currencyName(a).localeCompare(currencyName(b), LANG()));
  return top.concat(rest);
}
function optionsHtml(sel){
  return allCodes().map(c => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc((FLAG[c] ? FLAG[c] + ' ' : '') + iso(c) + ' · ' + currencyName(c))}</option>`).join('');
}
let convFrom = store.get('alesagli-fx-from') || 'EUR', convTo = store.get('alesagli-fx-to') || (veOn ? 'VES_BCV' : 'USD');
const okCode = c => !c.startsWith('VES_') || veOn;
function fillSelects(){
  const s = $('#fxShow'), f = $('#fxFrom'), t = $('#fxTo');
  if (!okCode(convFrom)) convFrom = 'EUR';
  if (!okCode(convTo)) convTo = 'USD';
  if (s) s.innerHTML = optionsHtml(display);
  if (f) f.innerHTML = optionsHtml(convFrom);
  if (t) t.innerHTML = optionsHtml(convTo);
}
function fmtDate(d){
  if (!d) return '';
  try { return new Intl.DateTimeFormat(LOC(), { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(d)); } catch (e) { return ''; }
}
function fmtDay(d){ try { return new Intl.DateTimeFormat(LOC(), { day:'numeric', month:'short', timeZone:'America/Caracas' }).format(new Date(d)); } catch (e) { return ''; } }
function toNumber(v){ v = String(v || '').replace(/\s/g, ''); if (v.includes(',')) v = v.replace(/\./g, '').replace(',', '.'); const n = parseFloat(v); return isFinite(n) ? n : 0; }

function renderConv(){
  const out = $('#fxResult'); if (!out) return;
  const a = toNumber($('#fxAmount').value || '1');
  const r = convert(a, convFrom, convTo);
  if (r == null) { out.innerHTML = `<span class="muted">${esc(loading ? t3('Cargando tasas…', 'Caricamento tassi…', 'Loading rates…') : t3('Tasa no disponible', 'Tasso non disponibile', 'Rate not available'))}</span>`; return; }
  const unit = convert(1, convFrom, convTo);
  out.innerHTML = `<strong>${esc(fmt(r, convTo, 2))}</strong><small>1 ${esc(iso(convFrom))} = ${esc(fmt(unit, convTo))} · 1 ${esc(iso(convTo))} = ${esc(fmt(1 / unit, convFrom))}</small>`;
}

function renderCard(){
  const box = $('#fxBody'); if (!box) return;
  const mini = $('#fxMini');
  const usdEur = rate('USD');
  if (mini) mini.innerHTML = veOn && fx && fx.bcv ? `<span>🇺🇸 $<b>${esc(fmt(fx.bcv, 'VES', 2))}</b></span>${fx.par ? `<span>${esc(t3('Paralelo', 'Parallelo', 'Parallel'))}<b>${esc(fmt(fx.par, 'VES', 2))}</b></span>` : ''}` : '';

  // Venezuela
  const vw = $('#fxVeWrap'); if (vw) vw.hidden = !veOn;
  const cb = $('#fxVeOn'); if (cb) cb.checked = veOn;
  const ve = $('#fxVe');
  if (ve && veOn) {
    if (fx && (fx.bcv || fx.par)) {
      const gap = fx.bcv && fx.par ? (fx.par / fx.bcv - 1) * 100 : null;
      ve.innerHTML = `
        <div class="metric"><span>🇻🇪 ${esc(t3('Dólar oficial BCV', 'Dollaro ufficiale BCV', 'Official BCV dollar'))}</span><strong>${fx.bcv ? esc(fmt(fx.bcv, 'VES', 2)) : '—'}</strong><small>${fx.bcv && usdEur ? '1 € = ' + esc(fmt(fx.bcv * usdEur, 'VES', 2)) : ''}${fx.bcvDate ? ' · ' + esc(fmtDay(fx.bcvDate)) : ''}</small></div>
        <div class="metric"><span>🇻🇪 ${esc(t3('Dólar paralelo', 'Dollaro parallelo', 'Parallel dollar'))}</span><strong>${fx.par ? esc(fmt(fx.par, 'VES', 2)) : '—'}</strong><small>${fx.par && usdEur ? '1 € = ' + esc(fmt(fx.par * usdEur, 'VES', 2)) : ''}${fx.parDate ? ' · ' + esc(fmtDate(fx.parDate)) : ''}</small></div>
        <div class="metric"><span>${esc(t3('Brecha paralelo / BCV', 'Divario parallelo / BCV', 'Parallel / BCV gap'))}</span><strong>${gap != null ? (gap >= 0 ? '+' : '') + gap.toFixed(1).replace('.', ',') + ' %' : '—'}</strong><small>${esc(t3('Bolívares por 1 dólar', 'Bolívar per 1 dollaro', 'Bolívars per 1 dollar'))}</small></div>`;
    } else ve.innerHTML = `<p class="muted">${esc(loading ? t3('Cargando tasas…', 'Caricamento tassi…', 'Loading rates…') : t3('Sin datos del bolívar todavía.', 'Ancora nessun dato sul bolívar.', 'No bolívar data yet.'))}</p>`;
  }

  // Tabla de monedas importantes
  const tb = $('#fxTable');
  if (tb) {
    const rows = MAJOR.filter(c => rate(c)).map(c => {
      const r = rate(c);
      return `<tr><td>${esc((FLAG[c] || '') + ' ' + currencyName(c))} <span class="muted">${esc(iso(c))}</span></td><td class="r">${esc(fmt(r, c))}</td><td class="r">${c === 'USD' ? '—' : esc(fmt(r / usdEur, c))}</td><td class="r">${esc(fmt(1 / r, 'EUR'))}</td></tr>`;
    }).join('');
    tb.innerHTML = rows
      ? `<table><thead><tr><th>${esc(t3('Moneda', 'Valuta', 'Currency'))}</th><th class="r">1 € =</th><th class="r">1 $ =</th><th class="r">${esc(t3('1 unidad =', '1 unità =', '1 unit ='))}</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="muted">${esc(loading ? t3('Cargando tasas…', 'Caricamento tassi…', 'Loading rates…') : t3('No hay tasas guardadas. Comprueba tu conexión.', 'Nessun tasso salvato. Controlla la connessione.', 'No saved rates. Check your connection.'))}</p>`;
  }

  const st = $('#fxStatus');
  if (st) {
    const when = fx && fx.t ? t3('Actualizado: ', 'Aggiornato: ', 'Updated: ') + fmtDate(fx.t) + ' · ' + t3('próxima actualización: ', 'prossimo aggiornamento: ', 'next update: ') + fmtDate(fx.t + MAX_AGE) : '';
    st.innerHTML = `${esc(when)}${lastError ? ` · <span class="neg">${esc(lastError)}</span>` : ''} · ${esc(t3('Se actualizan solas cada día. Fuentes: ExchangeRate-API y DolarApi (BCV / paralelo). Tasas orientativas.', 'Si aggiornano da soli ogni giorno. Fonti: ExchangeRate-API e DolarApi (BCV / parallelo). Tassi indicativi.', 'Updated automatically every day. Sources: ExchangeRate-API and DolarApi (BCV / parallel). Indicative rates.'))}`;
  }
  const rb = $('#fxRefresh'); if (rb) { rb.disabled = loading; rb.textContent = loading ? '…' : '↻ ' + t3('Actualizar', 'Aggiorna', 'Refresh'); }
  const lb = $('#fxShowLbl'); if (lb) lb.textContent = t3('Ver mi presupuesto en', 'Mostra il mio budget in', 'Show my budget in');
  renderConv(); renderNote();
}

function init(){
  if (!$('#fxCard')) return;
  fillSelects();
  $('#fxShow').onchange = e => setDisplay(e.target.value);
  $('#fxFrom').onchange = e => { convFrom = e.target.value; store.set('alesagli-fx-from', convFrom); renderConv(); };
  $('#fxTo').onchange = e => { convTo = e.target.value; store.set('alesagli-fx-to', convTo); renderConv(); };
  $('#fxAmount').oninput = renderConv;
  $('#fxSwap').onclick = () => { [convFrom, convTo] = [convTo, convFrom]; store.set('alesagli-fx-from', convFrom); store.set('alesagli-fx-to', convTo); fillSelects(); renderConv(); };
  $('#fxRefresh').onclick = () => loadRates(true);
  $('#fxVeOn').onchange = e => {
    veOn = e.target.checked; store.set(VE_KEY, veOn ? '1' : '0');
    if (!veOn && display.startsWith('VES_')) { display = 'EUR'; store.set(CUR_KEY, 'EUR'); }
    if (veOn && fx && !fx.bcv) loadRates(true);
    fillSelects(); renderCard(); refreshBudget();
  };
  const lb = $('#langBtn'); if (lb) lb.addEventListener('click', () => setTimeout(() => { fillSelects(); renderCard(); refreshBudget(); }, 0));
  renderCard();
  if (display !== 'EUR') refreshBudget();
  loadRates(false);
  setInterval(() => { if (document.visibilityState === 'visible') loadRates(false); }, 60 * 60 * 1000);
  window.addEventListener('online', () => loadRates(true));
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
