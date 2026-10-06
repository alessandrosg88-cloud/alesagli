// ============================================================
//  Mi presupuesto — moneda del presupuesto
//  La persona elige si su presupuesto está en euros (€) o en
//  dólares USA ($). No se convierte nada: solo cambia el símbolo.
// ============================================================
(function(){
'use strict';

const KEY = 'alesagli-moneda';
const store = {
  get(k){ try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }
};
const LANG = () => store.get('libroLang') || 'es';
const t3 = (es, it, en) => { const l = LANG(); return l === 'it' ? it : l === 'en' ? en : es; };

let cur = store.get(KEY) === 'USD' ? 'USD' : 'EUR';
const sym = () => cur === 'USD' ? '$' : '€';

window.fxMoney = function(n){
  const s = new Intl.NumberFormat('es-ES', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(n || 0);
  return s + ' ' + sym();
};
window.fxCompact = function(v){ // para los ejes de los gráficos
  if (v >= 1e6) return (Math.round(v / 1e5) / 10).toString().replace('.', ',') + ' M' + sym();
  if (v >= 1000) return (Math.round(v / 100) / 10).toString().replace('.', ',') + ' k' + sym();
  return Math.round(v) + ' ' + sym();
};

function render(){
  document.querySelectorAll('#curRow [data-cur]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cur === cur ? 'true' : 'false'));
  const lbl = document.getElementById('curLbl'); if (lbl) lbl.textContent = t3('Moneda de mi presupuesto:', 'Valuta del mio budget:', 'My budget currency:');
  const usd = document.querySelector('#curRow [data-cur="USD"]'); if (usd) usd.textContent = '$ ' + t3('Dólares', 'Dollari', 'Dollars');
  const eur = document.querySelector('#curRow [data-cur="EUR"]'); if (eur) eur.textContent = '€ ' + t3('Euros', 'Euro', 'Euros');
  const q = document.getElementById('qAmount'); if (q) q.placeholder = '0,00 ' + sym();
}
function refresh(){
  render();
  try { if (typeof calculate === 'function') calculate(); } catch (e) {}
}
function init(){
  document.querySelectorAll('#curRow [data-cur]').forEach(b => b.onclick = () => { cur = b.dataset.cur; store.set(KEY, cur); refresh(); });
  const lb = document.getElementById('langBtn'); if (lb) lb.addEventListener('click', () => setTimeout(render, 0));
  render();
  if (cur !== 'EUR') refresh();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
