// ============================================================
//  Mi presupuesto — presupuesto compartido (en pareja)
//  Quien invita crea un código. La otra persona, con su propia cuenta,
//  escribe el código y pasa a ver y editar el mismo presupuesto.
//  Firestore: shares/{dueño} = { owner, members:[uid], memberEmails:[email], invite }
//             invites/{código} = { owner, ownerEmail, expires }
//             users/{miembro}/tablas/link = { owner, ownerEmail }
//  Las reglas de seguridad solo dejan entrar a los miembros de shares/{dueño}.
// ============================================================
(function(){
'use strict';
const $q = s => document.querySelector(s);
const LANG = () => { try { return localStorage.getItem('libroLang') || 'es'; } catch (e) { return 'es'; } };
const t3 = (es, it, en) => { const l = LANG(); return l === 'it' ? it : l === 'en' ? en : es; };
const esc = s => escapeHtml(s == null ? '' : s);
const INVITE_HOURS = 48;
let S = { role:'own' };

const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const linkKey = me => 'alesagli-link-' + me;

// Se llama antes de cargar el presupuesto: decide de qué cuenta se leen los datos.
window.resolveShare = async function(){
  const me = currentUser && currentUser.id; if (!me) return;
  sb.setDataOwner(null);
  S = { role:'own' };
  let link = null, offline = false;
  try { link = await sb.fs.getDoc('users/' + me + '/tablas/link'); }
  catch (e) { if (e.code === 'NETWORK') { offline = true; link = lsGet(linkKey(me)); } }
  if (link && link.owner) {
    try {
      const sh = offline ? null : await sb.fs.getDoc('shares/' + link.owner);
      if (offline || (sh && (sh.members || []).includes(me))) {
        sb.setDataOwner(link.owner);
        S = { role:'member', owner: link.owner, ownerEmail: link.ownerEmail || '' };
        lsSet(linkKey(me), { owner: link.owner, ownerEmail: link.ownerEmail || '' });
      } else throw Object.assign(new Error('removed'), { code:'REMOVED' });
    } catch (e) {
      if (e.code === 'NETWORK') { sb.setDataOwner(link.owner); S = { role:'member', owner: link.owner, ownerEmail: link.ownerEmail || '' }; }
      else {
        // Ya no es miembro (la otra persona dejó de compartir): vuelve a su propio presupuesto.
        try { await sb.fs.delDoc('users/' + me + '/tablas/link'); } catch (e2) {}
        lsSet(linkKey(me), null);
        S = { role:'own', notice: t3('La otra persona ha dejado de compartir su presupuesto contigo. Estás viendo otra vez el tuyo.', 'L\'altra persona ha smesso di condividere il budget con te. Stai di nuovo vedendo il tuo.', 'The other person stopped sharing their budget with you. You\'re back on your own.') };
      }
    }
  } else lsSet(linkKey(me), null);
  if (S.role === 'own' && !offline) {
    try {
      const sh = await sb.fs.getDoc('shares/' + me);
      if (sh) { S.members = (sh.members || []).map((u, i) => ({ uid: u, email: (sh.memberEmails || [])[i] || '' })); S.invite = sh.invite || ''; S.inviteExp = sh.inviteExp || 0; }
    } catch (e) { if (e.code === 'PERMISSION_DENIED' || e.code === '403') S.disabled = true; }
  }
  renderShare();
};

function newCode(){
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = new Uint32Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, x => A[x % A.length]).join('');
}
const pretty = c => c ? c.slice(0, 4) + '-' + c.slice(4) : '';
function msg(t, err){ const m = $q('#shareMsg'); if (m) { m.textContent = t || ''; m.className = 'shareMsg' + (err ? ' err' : ''); } }
function errText(e){
  if (e && e.code === 'NETWORK') return t3('Sin conexión. Inténtalo cuando tengas internet.', 'Offline. Riprova quando hai internet.', 'Offline. Try again when you have internet.');
  if (e && (e.code === 'PERMISSION_DENIED' || e.code === '403')) return t3('El servidor no lo ha permitido. Puede que el código haya caducado o que el presupuesto compartido aún no esté activado.', 'Il server non lo ha permesso. Il codice potrebbe essere scaduto o la condivisione non ancora attiva.', 'The server didn\'t allow it. The code may have expired, or sharing isn\'t enabled yet.');
  return t3('Algo ha fallado. Inténtalo de nuevo.', 'Qualcosa è andato storto. Riprova.', 'Something went wrong. Please try again.');
}

async function createInvite(){
  const me = sb.fs.uid(); if (!me) return;
  msg(t3('Creando código…', 'Creo il codice…', 'Creating code…'));
  try {
    let sh = await sb.fs.getDoc('shares/' + me);
    if (!sh) { await sb.fs.setDoc('shares/' + me, { owner: me, members: [], memberEmails: [], joinCode: '' }); sh = {}; }
    if (sh.invite) { try { await sb.fs.delDoc('invites/' + sh.invite); } catch (e) {} }
    const code = newCode(), exp = Date.now() + INVITE_HOURS * 3600e3;
    await sb.fs.setDoc('invites/' + code, { owner: me, ownerEmail: currentUser.email || '', expires: exp });
    await sb.fs.mergeDoc('shares/' + me, { invite: code, inviteExp: exp });
    S.invite = code; S.inviteExp = exp;
    renderShare();
  } catch (e) { msg(errText(e), true); }
}

async function joinWith(raw){
  const me = sb.fs.uid(); if (!me) return;
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) { msg(t3('El código tiene 8 letras y números, por ejemplo ABCD-2345.', 'Il codice ha 8 lettere e numeri, ad esempio ABCD-2345.', 'The code has 8 letters and numbers, e.g. ABCD-2345.'), true); return; }
  msg(t3('Comprobando el código…', 'Controllo il codice…', 'Checking the code…'));
  try {
    const inv = await sb.fs.getDoc('invites/' + code);
    if (!inv || !inv.owner) { msg(t3('Ese código no existe. Revísalo con la persona que te ha invitado.', 'Questo codice non esiste. Controllalo con chi ti ha invitato.', 'That code doesn\'t exist. Check it with the person who invited you.'), true); return; }
    if (inv.owner === me) { msg(t3('Ese es tu propio código: tiene que escribirlo la otra persona en su cuenta.', 'È il tuo codice: deve inserirlo l\'altra persona nel suo account.', 'That\'s your own code: the other person must enter it in their account.'), true); return; }
    if (Number(inv.expires) < Date.now()) { msg(t3('Ese código ha caducado. Pide uno nuevo.', 'Il codice è scaduto. Chiedine uno nuovo.', 'That code has expired. Ask for a new one.'), true); return; }
    if (!confirm(t3(`Vas a usar el presupuesto de ${inv.ownerEmail || 'la otra persona'}. Tu presupuesto actual no se borra: volverás a él si dejas de compartir. ¿Continuar?`, `Userai il budget di ${inv.ownerEmail || 'l\'altra persona'}. Il tuo budget attuale non viene cancellato: ci tornerai se smetti di condividere. Continuare?`, `You'll use ${inv.ownerEmail || 'the other person'}'s budget. Your current budget is kept: you'll return to it if you stop sharing. Continue?`))) { msg(''); return; }
    await sb.fs.commit([{
      update: { name: sb.fs.name('shares/' + inv.owner), fields: { joinCode: { stringValue: code } } },
      updateMask: { fieldPaths: ['joinCode'] },
      updateTransforms: [
        { fieldPath: 'members', appendMissingElements: { values: [{ stringValue: me }] } },
        { fieldPath: 'memberEmails', appendMissingElements: { values: [{ stringValue: currentUser.email || '' }] } }
      ],
      currentDocument: { exists: true }
    }]);
    await sb.fs.setDoc('users/' + me + '/tablas/link', { owner: inv.owner, ownerEmail: inv.ownerEmail || '' });
    msg(t3('✓ Listo. Cargando el presupuesto compartido…', '✓ Fatto. Carico il budget condiviso…', '✓ Done. Loading the shared budget…'));
    setTimeout(() => location.reload(), 700);
  } catch (e) { msg(errText(e), true); }
}

async function leaveShare(){
  const me = sb.fs.uid(); if (!me || S.role !== 'member') return;
  if (!confirm(t3('¿Dejar de usar el presupuesto compartido? Volverás a ver tu propio presupuesto.', 'Smettere di usare il budget condiviso? Tornerai a vedere il tuo.', 'Stop using the shared budget? You\'ll go back to your own.'))) return;
  try {
    await sb.fs.commit([{
      update: { name: sb.fs.name('shares/' + S.owner), fields: {} },
      updateMask: { fieldPaths: [] },
      updateTransforms: [
        { fieldPath: 'members', removeAllFromArray: { values: [{ stringValue: me }] } },
        { fieldPath: 'memberEmails', removeAllFromArray: { values: [{ stringValue: currentUser.email || '' }] } }
      ],
      currentDocument: { exists: true }
    }]);
  } catch (e) { if (e.code === 'NETWORK') { msg(errText(e), true); return; } }
  try { await sb.fs.delDoc('users/' + me + '/tablas/link'); } catch (e) {}
  ['alesagli-cache-', 'alesagli-x-'].forEach(k => { try { localStorage.removeItem(k + S.owner); } catch (e) {} });
  lsSet(linkKey(me), null);
  location.reload();
}

async function removeMember(m){
  const me = sb.fs.uid(); if (!me) return;
  if (!confirm(t3(`¿Dejar de compartir tu presupuesto con ${m.email || 'esta persona'}?`, `Smettere di condividere il budget con ${m.email || 'questa persona'}?`, `Stop sharing your budget with ${m.email || 'this person'}?`))) return;
  try {
    const sh = await sb.fs.getDoc('shares/' + me) || {};
    const mem = sh.members || [], ems = sh.memberEmails || [];
    const keep = mem.map((u, i) => [u, ems[i] || '']).filter(([u]) => u !== m.uid);
    await sb.fs.mergeDoc('shares/' + me, { members: keep.map(x => x[0]), memberEmails: keep.map(x => x[1]) });
    S.members = keep.map(([uid, email]) => ({ uid, email }));
    renderShare();
  } catch (e) { msg(errText(e), true); }
}

function renderShare(){
  const box = $q('#shareBox'); if (!box) return;
  const banner = $q('#shareBanner');
  if (banner) { banner.hidden = S.role !== 'member'; banner.innerHTML = S.role === 'member' ? '👫 ' + esc(t3('Presupuesto compartido con ', 'Budget condiviso con ', 'Budget shared with ')) + '<b>' + esc(S.ownerEmail) + '</b>' : ''; }
  let h = '';
  if (S.notice) h += `<p class="localNote">${esc(S.notice)}</p>`;
  if (S.role === 'member') {
    h += `<p>${esc(t3('Estás usando el presupuesto de ', 'Stai usando il budget di ', 'You\'re using the budget of '))}<b>${esc(S.ownerEmail)}</b>${esc(t3('. Lo que apuntes lo veréis los dos.', '. Quello che annoti lo vedrete entrambi.', '. Anything you log is visible to both of you.'))}</p>
      <button type="button" class="ghost" id="shareLeave">${esc(t3('Dejar de compartir', 'Smetti di condividere', 'Stop sharing'))}</button>`;
  } else if (S.disabled) {
    h += `<p class="groupHint">${esc(t3('El presupuesto compartido aún no está activado en el servidor de la app.', 'Il budget condiviso non è ancora attivo sul server dell\'app.', 'Shared budgets aren\'t enabled on the app\'s server yet.'))}</p>`;
  } else {
    const mem = S.members || [];
    if (mem.length) {
      h += `<h3 class="subH">${esc(t3('Lo compartes con', 'Lo condividi con', 'Shared with'))}</h3>` + mem.map((m, i) => `<div class="shareRow"><span>👤 ${esc(m.email || t3('Otra cuenta', 'Altro account', 'Another account'))}</span><button type="button" class="ghost" data-rm="${i}">${esc(t3('Quitar', 'Rimuovi', 'Remove'))}</button></div>`).join('');
    }
    h += `<h3 class="subH">${esc(t3('Invitar a alguien', 'Invita qualcuno', 'Invite someone'))}</h3>`;
    if (S.invite && Number(S.inviteExp) > Date.now()) {
      const hrs = Math.max(1, Math.round((S.inviteExp - Date.now()) / 3600e3));
      h += `<div class="shareCode"><b id="shareCodeTxt">${esc(pretty(S.invite))}</b><button type="button" class="add" id="shareCopy">${esc(t3('Copiar', 'Copia', 'Copy'))}</button></div>
        <p class="groupHint">${esc(t3(`Pásale este código a tu pareja. Tiene que crear su cuenta en esta app, abrir esta tarjeta y escribirlo en «¿Te han invitado?». Caduca en ${hrs} h.`, `Passa questo codice al tuo partner. Deve creare il suo account in questa app, aprire questa scheda e inserirlo in «Ti hanno invitato?». Scade tra ${hrs} h.`, `Give this code to your partner. They create their account in this app, open this card and enter it under «Been invited?». Expires in ${hrs} h.`))}</p>
        <button type="button" class="ghost" id="shareNew">${esc(t3('Crear otro código', 'Crea un altro codice', 'Create another code'))}</button>`;
    } else {
      h += `<button type="button" class="add" id="shareNew">👫 ${esc(t3('Crear código de invitación', 'Crea codice di invito', 'Create invite code'))}</button>`;
    }
    h += `<h3 class="subH">${esc(t3('¿Te han invitado?', 'Ti hanno invitato?', 'Been invited?'))}</h3>
      <div class="shareJoin"><input id="shareJoinCode" maxlength="9" placeholder="ABCD-2345" autocomplete="off" autocapitalize="characters" aria-label="${esc(t3('Código de invitación', 'Codice di invito', 'Invite code'))}"><button type="button" class="add" id="shareJoin">${esc(t3('Unirme', 'Unisciti', 'Join'))}</button></div>`;
  }
  h += `<p class="shareMsg" id="shareMsg" aria-live="polite"></p>`;
  box.innerHTML = h;
  const on = (id, fn) => { const e = $q(id); if (e) e.onclick = fn; };
  on('#shareLeave', leaveShare);
  on('#shareNew', createInvite);
  on('#shareJoin', () => joinWith($q('#shareJoinCode').value));
  on('#shareCopy', async () => { try { await navigator.clipboard.writeText(pretty(S.invite)); msg(t3('✓ Código copiado', '✓ Codice copiato', '✓ Code copied')); } catch (e) { msg(pretty(S.invite)); } });
  box.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => removeMember((S.members || [])[Number(b.dataset.rm)]); });
}
window.renderShare = renderShare;
})();
