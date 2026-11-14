// Campfire client — vanilla SPA, hash routing, i18n via t() (English text is the key)
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let me = null;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(t((j && j.error) || 'Something went wrong')); e.status = r.status; throw e; }
  return j;
}
function toast(m) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = m; document.body.append(d); setTimeout(() => d.remove(), 2200); }

// ---------- ui bits ----------
const stars = r => r ? `<span class="st" dir="ltr">${'★'.repeat(Math.floor(r / 2))}${r % 2 ? '½' : ''}</span>` : '';
const HEART = `<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.5 3 5 6.3 5c2 0 3.5 1.2 4.2 2.4h3C14.2 6.2 15.7 5 17.7 5 21 5 22.8 8.5 21.5 11.7 19.5 16.4 12 21 12 21z"/></svg>`;
const EYE = `<svg viewBox="0 0 24 24"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const CLOCK = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3.5 2"/></svg>`;
const hue = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const avatar = (n, cls = '') => `<a href="#/u/${esc(n)}" class="av ${cls}" style="background:hsl(${hue(n)} 55% 62%)">${esc(n[0].toUpperCase())}</a>`;
function imgFb(el) {
  if (!el.dataset.t && el.dataset.h) { el.dataset.t = 1; el.src = el.dataset.h; el.classList.add('fb'); }
  else { const p = el.parentElement; el.remove(); if (!p.querySelector('.nm')) p.insertAdjacentHTML('beforeend', `<span class="nm">${esc(el.dataset.n)}</span>`); }
}
window.imgFb = imgFb;
const poster = (g, extra = '') => `<a class="poster" href="#/game/${g.id}">${extra}<img loading="lazy" src="${esc(g.poster)}" data-h="${esc(g.header || '')}" data-n="${esc(g.name)}" alt="${esc(g.name)}" onerror="imgFb(this)"></a>`;
const pcell = (g, meta = '') => `<div class="pcell"><span class="tip">${esc(g.name)}${g.year ? ' (' + g.year + ')' : ''}</span>${poster(g)}${meta ? `<div class="meta">${meta}</div>` : ''}</div>`;
const fmtDate = d => d ? new Date(d + 'T00:00').toLocaleDateString(LOCALE(), { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const ago = at => { const m = (Date.now() - at) / 6e4; return m < 60 ? t('{n}m ago', { n: Math.max(1, Math.round(m)) }) : m < 1440 ? t('{n}h ago', { n: Math.round(m / 60) }) : t('{n}d ago', { n: Math.round(m / 1440) }); };
const sec = (title, more = '') => `<h2 class="sec"><span>${t(title)}</span>${more}</h2>`;
const num = n => Number(n).toLocaleString(LOCALE());

// ---------- header / auth ----------
function renderLang() {
  const sel = $('#lang');
  sel.innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${v.name}</option>`).join('');
  sel.onchange = () => { setLang(sel.value); applyStatic(); renderAuth(); route(); };
}
function renderAuth() {
  $('#auth').innerHTML = me
    ? `<a class="bell" href="#/notifications" title="${t('Notifications')}">${t('Alerts')}${me.unread ? `<b>${me.unread}</b>` : ''}</a>
       <div class="userm"><button class="btn ghost sm" id="um">${esc(me.username)} ▾</button><div class="dd" id="umd" hidden>
        <a href="#/u/${esc(me.username)}">${t('Profile')}</a><a href="#/u/${esc(me.username)}/games">${t('Diary')}</a><a href="#/u/${esc(me.username)}/backlog">${t('Backlog')}</a><a href="#/u/${esc(me.username)}/lists">${t('Lists')}</a><a href="#/u/${esc(me.username)}/following">${t('Following')}</a><a href="#/settings">${t('Settings')}</a><button id="lo">${t('Sign out')}</button></div></div>
       <button class="btn pri sm" id="logbtn">+ ${t('Log')}</button>`
    : `<button class="btn ghost sm" id="si">${t('Sign in')}</button> <button class="btn pri sm" id="cr">${t('Create account')}</button>`;
  if (me) {
    $('#um').onclick = e => { e.stopPropagation(); $('#umd').hidden = !$('#umd').hidden; };
    $('#lo').onclick = async () => { await api('/logout', 'POST'); me = null; renderAuth(); renderNotice(); route(); };
    $('#logbtn').onclick = () => openLogSearch();
  } else { $('#si').onclick = () => authModal('login'); $('#cr').onclick = () => authModal('register'); }
}
document.addEventListener('click', e => { const d = $('#umd'); if (d && !e.target.closest('.userm')) d.hidden = true; if (!e.target.closest('.searchbox')) $('#dd').hidden = true; });

function modal(html, onclose) {
  const mb = document.createElement('div'); mb.className = 'mb'; mb.innerHTML = `<div class="modal">${html}</div>`;
  const close = () => { mb.remove(); onclose && onclose(); };
  mb.addEventListener('mousedown', e => { if (e.target === mb) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  document.body.append(mb); mb.close = close; return mb;
}
function authModal(mode) {
  const reg = mode === 'register';
  const m = modal(`<h3>${reg ? t('Create your account') : t('Sign in')}</h3><form class="f">
    <label style="margin-top:0">${reg ? t('Username') : t('Username or email')}</label><input name="username" autocomplete="username" required dir="ltr">
    ${reg ? `<label>${t('Email')}</label><input name="email" type="email" autocomplete="email" required dir="ltr">` : ''}
    <label>${t('Password')}</label><input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required dir="ltr">
    <div class="err" id="er"></div><div class="mrow"><button class="btn pri">${reg ? t('Sign up') : t('Sign in')}</button>
    <a href="#" id="sw" class="muted">${reg ? t('Have an account? Sign in') : t('New here? Create an account')}</a></div>
    ${reg ? '' : `<div style="margin-top:12px"><a href="#" id="fg" class="muted">${t('Forgot your password?')}</a></div>`}</form>`);
  $('#sw', m).onclick = e => { e.preventDefault(); m.close(); authModal(reg ? 'login' : 'register'); };
  const fg = $('#fg', m); if (fg) fg.onclick = e => { e.preventDefault(); m.close(); forgotModal(); };
  $('form', m).onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { me = await api(reg ? '/register' : '/login', 'POST', { username: f.get('username'), email: f.get('email'), password: f.get('password'), lang: LANG }); m.close(); await refreshMe(); route(); if (reg) toast(t('Check your email to confirm your address')); }
    catch (er) { $('#er', m).textContent = er.message; }
  };
  $('input', m).focus();
}
const needAuth = () => { if (me) return true; authModal('login'); return false; };
async function refreshMe() { try { me = await api('/me'); } catch { me = null; } renderAuth(); renderNotice(); }

function forgotModal() {
  const m = modal(`<h3>${t('Reset your password')}</h3><p class="muted" style="margin-top:0">${t('Enter your email or username and we’ll send you a reset link.')}</p>
    <form class="f"><input name="id" autocomplete="username" required dir="ltr" placeholder="${t('Username or email')}"><div class="err" id="er"></div>
    <div class="mrow"><button class="btn pri">${t('Send reset link')}</button></div></form>`);
  $('input', m).focus();
  $('form', m).onsubmit = async e => {
    e.preventDefault();
    try { await api('/forgot', 'POST', { email: new FormData(e.target).get('id'), lang: LANG }); m.close(); modal(`<h3>${t('Check your email')}</h3><p>${t('If an account matches, a reset link is on its way. It expires in 1 hour.')}</p>`); }
    catch (er) { $('#er', m).textContent = er.message; }
  };
}
// banner for accounts without an email / with an unconfirmed one
function renderNotice() {
  const n = $('#notice'); if (!n) return;
  if (me && !me.email) n.innerHTML = `<div class="wrap">${t('Add an email so you can recover your account.')} <a href="#/settings">${t('Add email')}</a></div>`;
  else if (me && !me.emailVerified) n.innerHTML = `<div class="wrap">${t('Please confirm your email address.')} <a href="#" id="rv">${t('Resend email')}</a></div>`;
  else n.innerHTML = '';
  n.hidden = !n.innerHTML;
  const rv = $('#rv'); if (rv) rv.onclick = async e => { e.preventDefault(); await api('/resend-verify', 'POST', { lang: LANG }).catch(() => {}); toast(t('Email sent')); };
}

// ---------- search ----------
let st;
$('#q').addEventListener('input', e => {
  clearTimeout(st); const q = e.target.value.trim(); const dd = $('#dd');
  if (q.length < 2) { dd.hidden = true; return; }
  st = setTimeout(async () => {
    const r = await api('/search?q=' + encodeURIComponent(q)).catch(() => []);
    dd.innerHTML = r.length ? r.map(g => `<a href="#/game/${g.id}"><img src="${esc(g.header)}" onerror="this.style.visibility='hidden'">${esc(g.name)}</a>`).join('') : `<div class="empty" style="padding:14px">${t('No games found')}</div>`;
    dd.hidden = false;
  }, 250);
});
$('#q').addEventListener('keydown', e => { if (e.key === 'Enter') { const a = $('#dd a'); if (a) { location.hash = a.getAttribute('href'); $('#dd').hidden = true; e.target.blur(); } } });
$('#dd').addEventListener('click', () => { $('#dd').hidden = true; $('#q').value = ''; });

function openLogSearch() {
  if (!needAuth()) return;
  const m = modal(`<h3>${t('Log a game')}</h3><input id="lq" placeholder="${t('Search for a game…')}" autocomplete="off"><div id="lr" style="margin-top:8px"></div>`);
  let tm; $('#lq', m).focus();
  $('#lq', m).oninput = e => { clearTimeout(tm); tm = setTimeout(async () => {
    const r = await api('/search?q=' + encodeURIComponent(e.target.value)).catch(() => []);
    $('#lr', m).innerHTML = r.map(g => `<div class="dd" style="position:static;width:auto;border:0;box-shadow:none"><a href="#" data-id="${g.id}"><img src="${esc(g.header)}">${esc(g.name)}</a></div>`).join('');
    m.querySelectorAll('[data-id]').forEach(a => a.onclick = async ev => { ev.preventDefault(); m.close(); const d = await api('/game/' + a.dataset.id); logModal(d); });
  }, 250); };
}

// ---------- rating widget ----------
function rateWidget(el, value, onchange) {
  let v = value || 0; el.dir = 'ltr';
  const draw = x => { el.innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="s ${x >= i * 2 ? 'f' : x === i * 2 - 1 ? 'h' : ''}">★</span>`).join(''); };
  draw(v);
  el.onmousemove = e => { const s = e.target.closest('.s'); if (!s) return; const i = [...el.children].indexOf(s) + 1; const half = e.offsetX < s.offsetWidth / 2; draw(i * 2 - (half ? 1 : 0)); };
  el.onmouseleave = () => draw(v);
  el.onclick = e => { const s = e.target.closest('.s'); if (!s) return; const i = [...el.children].indexOf(s) + 1; const nv = i * 2 - (e.offsetX < s.offsetWidth / 2 ? 1 : 0); v = nv === v ? 0 : nv; draw(v); onchange(v); };
}

// ---------- log modal ----------
const VIBES = ['cozy', 'brutal', 'atmospheric', 'big brain', 'chaotic fun', 'made me cry', 'one more run', 'beautiful', 'hidden gem', 'overrated', 'rage-inducing', 'comfort game'];
function logModal(d) {
  const g = d.game, my = d.my || {};
  let rating = my.rating || 0, liked = !!my.liked, vibes = [...(my.vibes || [])];
  const m = modal(`<div class="mhead"><div class="poster"><img src="${esc(g.poster)}" data-h="${esc(g.header)}" data-n="${esc(g.name)}" onerror="imgFb(this)"></div>
    <div style="flex:1"><div class="muted" style="font-size:11px;letter-spacing:.8px;text-transform:uppercase">${my.id ? t('Edit your log') : t('I played…')}</div>
      <div class="serif" style="font-size:24px;color:var(--white);line-height:1.2">${esc(g.name)} <span class="muted" style="font-size:15px">${g.year || ''}</span></div>
      <label>${t('Date played')}</label><input type="date" id="ld" value="${my.date || new Date().toISOString().slice(0, 10)}" style="width:170px">
    </div></div>
    <label>${t('Review')}</label><textarea id="lrv" rows="4" placeholder="${t('Add a review…')}">${esc(my.review || '')}</textarea>
    <label style="display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:13px"><input type="checkbox" id="lsp" style="width:auto" ${my.spoiler ? 'checked' : ''}> ${t('Contains spoilers')}</label>
    <label>${t('Vibe — what was it like? (up to 4)')}</label><div class="chips" id="lv">${VIBES.map(v => `<button type="button" class="chip" data-v="${v}">${t(v)}</button>`).join('')}</div>
    <div class="fire" style="grid-template-columns:1fr 1fr;margin-top:2px"><div><label>${t(d.stats.ritual.label)} <span style="text-transform:none;letter-spacing:0">(${t('optional')})</span></label><input id="lri" inputmode="numeric" value="${esc(my.ritual ?? '')}" placeholder="${t('Your count')}"></div></div>
    <div class="mrow"><div><div class="muted" style="font-size:11px;letter-spacing:.8px;text-transform:uppercase">${t('Rating')}</div><div class="rate" id="lrt"></div></div>
      <button type="button" class="btn ghost" id="lk" style="margin-inline-start:auto"><span class="hrt">♥</span> <span id="lkt"></span></button></div>
    <div class="mrow" style="margin-top:20px"><button class="btn pri" id="ls">${t('Save')}</button>${my.id ? `<button class="btn ghost" id="ld2">${t('Remove')}</button>` : ''}<div class="err" id="er" style="margin:0"></div></div>`);
  const paint = () => { m.querySelectorAll('[data-v]').forEach(b => b.classList.toggle('on', vibes.includes(b.dataset.v))); $('#lkt', m).textContent = liked ? t('Liked') : t('Like'); };
  m.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { const v = b.dataset.v; vibes = vibes.includes(v) ? vibes.filter(x => x !== v) : vibes.length < 4 ? [...vibes, v] : vibes; paint(); });
  $('#lk', m).onclick = () => { liked = !liked; paint(); };
  rateWidget($('#lrt', m), rating, v => rating = v); paint();
  $('#ls', m).onclick = async () => {
    try {
      await api('/log', 'POST', { gameId: g.id, rating, liked, vibes, review: $('#lrv', m).value, spoiler: $('#lsp', m).checked, date: $('#ld', m).value, ritual: $('#lri', m).value });
      m.close(); toast(t('Saved')); route();
    } catch (e) { $('#er', m).textContent = e.message; }
  };
  if (my.id) $('#ld2', m).onclick = async () => { await api('/log/' + g.id, 'DELETE'); m.close(); toast(t('Removed')); route(); };
}

function listPicker(g) {
  if (!needAuth()) return;
  api('/my/lists').then(ls => {
    const m = modal(`<h3>${t('Add to a list')}: ${esc(g.name)}</h3>${ls.map(l => `<button class="btn ghost" style="display:block;width:100%;text-align:start;margin-bottom:6px" data-l="${l.id}">${esc(l.title)} <span class="muted">· ${l.count}</span></button>`).join('') || `<div class="muted">${t('No lists yet.')}</div>`}
      <form class="f" style="display:flex;gap:8px;margin-top:12px"><input name="t" placeholder="${t('New list title')}"><button class="btn pri">${t('Create')}</button></form>`);
    m.querySelectorAll('[data-l]').forEach(b => b.onclick = async () => { const r = await api(`/lists/${b.dataset.l}/games`, 'POST', { gameId: g.id }); m.close(); toast(r.added ? t('Added to list') : t('Removed from list')); });
    $('form', m).onsubmit = async e => { e.preventDefault(); const v = new FormData(e.target).get('t'); if (!v.trim()) return; const l = await api('/lists', 'POST', { title: v }); await api(`/lists/${l.id}/games`, 'POST', { gameId: g.id }); m.close(); toast(t('List created')); };
  });
}

// ---------- shared components ----------
const app = $('#app');
const setNav = n => document.querySelectorAll('nav.main a').forEach(a => a.classList.toggle('on', a.dataset.n === n));

function reviewHtml(r, showGame) {
  return `<div class="rev">${avatar(r.user)}<div><div class="h">${showGame ? `<a href="#/game/${r.game.id}" class="serif" style="color:var(--white);font-size:16px">${esc(r.game.name)}</a><span>${r.game.year || ''}</span>` : ''}
    <span>${t('Review by')}</span> <b><a href="#/u/${esc(r.user)}">${esc(r.user)}</a></b>${r.demo ? `<span class="demo">${t('Demo')}</span>` : ''} ${stars(r.rating)} ${r.liked ? '<span class="hrt">♥</span>' : ''}${(r.vibes || []).map(v => `<span class="vib">${esc(t(v))}</span>`).join('')}</div>
    ${r.review ? (r.spoiler ? `<div class="spoil" onclick="this.outerHTML=this.dataset.t" data-t="<p dir=auto>${esc(r.review)}</p>">${t('This review contains spoilers. Click to reveal.')}</div>` : `<p dir="auto">${esc(r.review)}</p>`) : ''}
    <div class="ft"><button class="${r.iLike ? 'on' : ''}" data-like="${r.id}">♥ <span>${r.likes}</span> ${t('likes')}</button>
      <button data-cm="${r.id}">${t('Comments')} (${r.comments})</button><span>${fmtDate(r.date)}</span></div><div class="cms" id="cm-${r.id}" hidden></div></div></div>`;
}
function bindReviews(root) {
  root.querySelectorAll('[data-like]').forEach(b => b.onclick = async () => {
    if (!needAuth()) return; const r = await api(`/review/${b.dataset.like}/like`, 'POST');
    b.classList.toggle('on', r.iLike); b.innerHTML = `♥ <span>${r.likes}</span> ${t('likes')}`;
  });
  root.querySelectorAll('[data-cm]').forEach(b => b.onclick = async () => {
    const box = $('#cm-' + b.dataset.cm); if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false; await drawComments(box, b.dataset.cm, b);
  });
}
async function drawComments(box, id, btn) {
  const list = await api(`/review/${id}/comments`);
  box.innerHTML = list.map(c => `<div class="cm"><b><a href="#/u/${esc(c.user)}">${esc(c.user)}</a></b> <span class="muted">${ago(c.at)}</span>${c.mine ? ` <a href="#" data-del="${c.id}" class="muted">${t('Delete')}</a>` : ''}<div dir="auto">${esc(c.text)}</div></div>`).join('')
    + `<form class="f cmf"><input placeholder="${t('Write a comment…')}" maxlength="1000"><button class="btn sm">${t('Post')}</button></form>`;
  if (btn) btn.textContent = `${t('Comments')} (${list.length})`;
  $('form', box).onsubmit = async e => { e.preventDefault(); if (!needAuth()) return; const v = $('input', box).value.trim(); if (!v) return; await api(`/review/${id}/comments`, 'POST', { text: v }); drawComments(box, id, btn); };
  box.querySelectorAll('[data-del]').forEach(a => a.onclick = async e => { e.preventDefault(); await api('/comments/' + a.dataset.del, 'DELETE'); drawComments(box, id, btn); });
}
const listCardHtml = l => `<div class="lcard"><a href="#/list/${l.id}"><div class="stack">${l.covers.map((g, i) => `<div style="position:absolute;inset-inline-start:${i * 38}px;z-index:${9 - i};width:60px">${poster(g)}</div>`).join('')}</div></a>
  <div><h3><a href="#/list/${l.id}">${esc(l.title)}</a></h3><div class="muted" style="font-size:13px">${t('by')} <a href="#/u/${esc(l.user)}">${esc(l.user)}</a> · ${l.count} ${t('games')}</div><p style="margin:6px 0 0">${esc(l.desc || '')}</p></div></div>`;
const personRow = u => `<div class="person">${avatar(u.username)}<div class="pi"><a href="#/u/${esc(u.username)}" class="serif" style="color:var(--white);font-size:17px">${esc(u.username)}</a>${u.demo ? ` <span class="demo">${t('Demo')}</span>` : ''}
  <div class="muted" style="font-size:12px">${u.games} ${t('games')} · ${u.followers} ${t('followers')}${u.match != null ? ` · <span class="match">${t('{n}% taste match', { n: u.match })}</span>` : ''}</div></div>
  ${u.me ? '' : `<button class="btn sm ${u.following ? '' : 'pri'}" data-follow="${esc(u.username)}">${u.following ? t('Following') : t('Follow')}</button>`}</div>`;
function bindFollow(root) {
  root.querySelectorAll('[data-follow]').forEach(b => b.onclick = async () => {
    if (!needAuth()) return; const r = await api(`/user/${b.dataset.follow}/follow`, 'POST');
    b.textContent = r.following ? t('Following') : t('Follow'); b.classList.toggle('pri', !r.following);
  });
}

// ---------- pages ----------
async function pageHome() {
  setNav('');
  const [pop, revs, lists] = await Promise.all([api('/games?sort=popular&limit=12'), api('/reviews/recent'), api('/lists')]);
  let top = '';
  if (!me) {
    const bg = pop.games[0];
    top = `<div class="hero"><div class="bgimg" style="background-image:url('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${bg ? bg.id : 1245620}/library_hero.jpg')"></div><div class="in wrap">
      <h1>${t('Track games you’ve played.')}<br>${t('Save those you want to play.')}<br>${t('Tell the fire what’s good.')}</h1><p>${t('The social diary for people who finish (and abandon) games.')}</p>
      <button class="btn pri" id="hc" style="padding:11px 22px;font-size:15px">${t('Get started — it’s free')}</button></div></div>`;
  }
  let feed = '';
  if (me) {
    const f = await api('/feed');
    feed = sec('Activity from you and friends', `<a href="#/people">${t('Find people')}</a>`) + (f.length ? f.slice(0, 10).map(r => `<div class="rev"><div>${avatar(r.user)}</div><div><div class="h"><b><a href="#/u/${esc(r.user)}">${esc(r.user)}</a></b> <span>${t('played')}</span> <a class="serif" style="color:var(--white);font-size:15px" href="#/game/${r.game.id}">${esc(r.game.name)}</a> ${stars(r.rating)} ${r.liked ? '<span class="hrt">♥</span>' : ''}<span>${ago(r.updatedAt)}</span></div>${r.review && !r.spoiler ? `<p>${esc(r.review)}</p>` : ''}</div></div>`).join('') : `<div class="empty">${t('Log a game or follow someone to fill this feed.')}</div>`);
  }
  app.innerHTML = `${top}<div class="wrap" ${me ? 'style="padding-top:26px"' : ''}>
    ${me ? `<div class="serif" style="font-size:26px;color:var(--white)">${t('Welcome back, {u}.', { u: esc(me.username) })}</div>` : ''}
    ${feed}
    ${sec('Popular this month', `<a href="#/games">${t('All games')}</a>`)}<div class="pgrid">${pop.games.slice(0, 12).map(g => pcell(g, g.avg ? stars(Math.round(g.avg * 2)) : '')).join('')}</div>
    ${!me ? `<div class="feats"><div><b>${t('Log everything')}</b>${t('Keep a diary of every game with a date, a rating and a few words.')}</div><div><b>${t('Build a backlog')}</b>${t('Save games you want to play and never lose track again.')}</div><div><b>${t('Join the fire')}</b>${t('Every game has its own page of vibes, counters and the people who played it.')}</div></div>` : ''}
    ${sec('Recent reviews')}<div>${revs.map(r => reviewHtml(r, true)).join('') || `<div class="empty">${t('No reviews yet.')}</div>`}</div>
    ${sec('Popular lists', `<a href="#/lists">${t('More')}</a>`)}${lists.slice(0, 3).map(listCardHtml).join('')}</div>`;
  bindReviews(app); const hc = $('#hc'); if (hc) hc.onclick = () => authModal('register');
}

async function pageGames(sort = 'popular', genre = '') {
  setNav('games');
  const d = await api(`/games?sort=${sort}&genre=${encodeURIComponent(genre)}&limit=120`);
  const link = (s, g, label, on) => `<a class="${on ? 'chip on' : 'chip'}" href="#/games/${s}${g ? '/' + encodeURIComponent(g) : ''}">${label}</a>`;
  app.innerHTML = `<div class="wrap" style="padding-top:26px"><h1 class="title">${t('Games')}</h1>
    <div class="chips" style="margin:14px 0 8px">${[['popular', 'Popular'], ['rating', 'Highest rated'], ['new', 'Newest']].map(([s, l]) => link(s, genre, t(l), s === sort)).join('')}</div>
    <div class="chips" style="margin-bottom:18px">${link(sort, '', t('All genres'), !genre)}${d.genres.map(g => link(sort, g, esc(t(g)), g === genre)).join('')}</div>
    <div class="pgrid">${d.games.map(g => pcell(g, `${g.avg ? stars(Math.round(g.avg * 2)) : '<span></span>'}<span>${g.plays}</span>`)).join('') || `<div class="empty">${t('Nothing here yet.')}</div>`}</div></div>`;
}

async function pageGame(id, tab = 'reviews') {
  setNav('');
  const d = await api('/game/' + id), g = d.game, s = d.stats, my = d.my;
  document.title = `${g.name} — Campfire`;
  const max = Math.max(1, ...s.hist), hist = s.hist.map((n, i) => `<i style="height:${Math.max(3, n / max * 100)}%" title="${(i + 1) / 2}★: ${n}"></i>`).join('');
  const tabs = [['reviews', 'Reviews'], ['fire', 'The fire'], ['details', 'Details'], ['lists', 'Lists']];
  let body = '';
  if (tab === 'reviews') {
    const friends = d.friends.length ? `<h2 class="sec" style="margin-top:0"><span>${t('From people you follow')}</span></h2>` + d.friends.map(r => `<div class="fr">${avatar(r.user)}<div><b><a href="#/u/${esc(r.user)}">${esc(r.user)}</a></b> ${stars(r.rating)} ${r.liked ? '<span class="hrt">♥</span>' : ''}${r.review && !r.spoiler ? `<div class="muted">${esc(r.review.slice(0, 140))}</div>` : ''}</div></div>`).join('') : '';
    body = friends + `<h2 class="sec" style="${friends ? '' : 'margin-top:0'}"><span>${t('Popular reviews')}</span></h2>` + (d.reviews.length ? d.reviews.map(r => reviewHtml(r)).join('') : `<div class="empty">${t('No reviews yet. Be the first.')}</div>`);
  }
  if (tab === 'fire') {
    const vmax = Math.max(1, ...s.vibes.map(v => v.n));
    body = `<div class="fire"><div class="fcard"><div class="muted" style="font-size:11px;letter-spacing:.8px;text-transform:uppercase">${t(s.ritual.label)} · ${t('community total')}</div>
      <div class="big">${num(s.ritual.total)}</div><div class="muted" style="margin-top:6px">${t(s.ritual.unit)} — ${t('{n} players', { n: s.ritual.count })}. ${me ? '' : t('Sign in to add yours.')}</div></div>
      <div class="fcard"><div class="muted" style="font-size:11px;letter-spacing:.8px;text-transform:uppercase;margin-bottom:6px">${t('What it felt like')}</div>
      ${s.vibes.slice(0, 6).map(v => `<div class="bar"><span>${esc(t(v.vibe))}</span><span class="t"><i style="width:${v.n / vmax * 100}%"></i></span><span class="muted">${v.n}</span></div>`).join('') || `<div class="muted">${t('No vibes tagged yet.')}</div>`}</div></div>`;
  }
  if (tab === 'details') body = `<p style="max-width:680px">${esc(g.short)}</p><div class="chips" style="margin:10px 0">${g.genres.map(x => `<a class="chip" href="#/games/popular/${encodeURIComponent(x)}">${esc(t(x))}</a>`).join('')}${g.platforms.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>
    ${g.publishers.length ? `<p class="muted">${t('Published by')} ${g.publishers.map(esc).join(', ')}</p>` : ''}${g.metacritic ? `<p class="muted">Metacritic ${g.metacritic}</p>` : ''}
    <div class="shots">${g.shots.map(u => `<img loading="lazy" src="${esc(u)}">`).join('')}</div>`;
  if (tab === 'lists') body = d.lists.length ? d.lists.map(l => `<div class="rev" style="grid-template-columns:1fr"><div><a class="serif" style="color:var(--white);font-size:18px" href="#/list/${l.id}">${esc(l.title)}</a> <span class="muted">${t('by')} ${esc(l.user)} · ${l.count} ${t('games')}</span></div></div>`).join('') : `<div class="empty">${t('Not on any lists yet.')}</div>`;

  app.innerHTML = `<div class="gbg"><div style="background-image:url('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${g.id}/library_hero.jpg'),url('${esc(g.header)}')"></div></div>
  <div class="wrap"><div class="gwrap">
    <div>${poster(g)}</div>
    <div class="gsum"><h1 class="title">${esc(g.name)} <span class="yr">${g.year || ''}</span></h1>
      <div class="by">${g.developers.length ? t('Developed by') + ' <bdi>' + g.developers.map(esc).join(', ') + '</bdi>' : ''}</div>
      <p class="syn" dir="auto">${esc(g.short)}</p><div class="chips">${g.genres.map(x => `<span class="chip">${esc(t(x))}</span>`).join('')}</div>
      <div class="muted" style="margin-top:14px;font-size:13px">${t('{a} played · {b} liked · {c} in backlogs', { a: s.plays, b: s.likes, c: s.backlog })}</div></div>
    <div class="side">
      <div class="act"><button class="pl ${my ? 'on' : ''}" id="a-p">${EYE}<span>${my ? t('Played') : t('Play')}</span></button><button class="lk ${my && my.liked ? 'on' : ''}" id="a-l">${HEART}<span>${t('Like')}</span></button><button class="bl ${d.inBacklog ? 'on' : ''}" id="a-b">${CLOCK}<span>${t('Backlog')}</span></button></div>
      <div class="row"><div class="rl">${my && my.rating ? t('Rated') : t('Rate')}</div><div class="rate" id="a-r" style="font-size:26px"></div></div>
      <div class="row link" id="a-log">${my ? t('Edit your log') : t('Review or log…')}</div>
      <div class="row link" id="a-list">${t('Add to list…')}</div>
      <div class="row"><div class="rl">${t('Ratings')}</div>${s.avg ? `<div class="avg">${s.avg.toFixed(1)}</div>` : `<span class="muted">${t('Not enough ratings')}</span>`}
        <div class="hist" dir="ltr">${hist}</div><div class="histlab" dir="ltr"><span>★</span><span>${s.ratings} ${t('ratings')}</span><span>★★★★★</span></div></div>
    </div></div>
    <div class="tabs">${tabs.map(([k, l]) => `<a class="${k === tab ? 'on' : ''}" href="#/game/${g.id}/${k}">${t(l)}</a>`).join('')}</div>
    <div style="max-width:${tab === 'reviews' ? '700px' : '100%'}">${body}</div></div>`;
  bindReviews(app);
  const quick = async patch => { if (!needAuth()) return; await api('/log', 'POST', { gameId: g.id, rating: my ? my.rating : 0, liked: my ? my.liked : false, vibes: my ? my.vibes : [], review: my ? my.review : '', spoiler: my ? my.spoiler : false, date: my ? my.date : '', ritual: my ? my.ritual : '', ...patch }); route(); };
  $('#a-p').onclick = async () => { if (!needAuth()) return; if (my) { await api('/log/' + g.id, 'DELETE'); route(); } else quick({}); };
  $('#a-l').onclick = () => quick({ liked: !(my && my.liked) });
  $('#a-b').onclick = async () => { if (!needAuth()) return; const r = await api('/backlog/' + g.id, 'POST'); toast(r.inBacklog ? t('Added to backlog') : t('Removed from backlog')); route(); };
  rateWidget($('#a-r'), my ? my.rating : 0, v => { if (!me) { authModal('login'); return; } quick({ rating: v }); });
  $('#a-log').onclick = () => needAuth() && logModal(d);
  $('#a-list').onclick = () => listPicker(g);
}

async function pageUser(name, tab = '') {
  setNav('');
  const d = await api('/user/' + name), u = d.user, s = d.stats;
  document.title = `${u.username} — Campfire`;
  const own = me && me.username === u.username, hmax = Math.max(1, ...d.hist);
  const tabs = [['', 'Profile'], ['games', 'Diary'], ['reviews', 'Reviews'], ['backlog', 'Backlog'], ['lists', 'Lists'], ['followers', 'Followers'], ['following', 'Following']];
  let body = '';
  if (tab === '') {
    const tm = d.taste && d.taste.match != null ? `<div class="fcard" style="margin-bottom:12px"><div class="big" style="font-size:34px">${d.taste.match}%</div><div class="muted">${t('Taste match with you')} · ${t('{n} games in common', { n: d.taste.common })}</div></div>` : (d.taste ? `<div class="muted" style="margin-bottom:12px">${t('Rate 3+ of the same games to see your taste match.')}</div>` : '');
    body = `<div class="cols"><div>
      ${sec('Favorite games', own ? `<a href="#" id="ef">${t('Edit')}</a>` : '')}${d.favorites.length ? `<div class="pgrid four" style="max-width:520px">${d.favorites.map(g => pcell(g)).join('')}</div>` : `<div class="muted">${own ? t('Choose up to four favorites to show here.') : t('No favorites chosen.')}</div>`}
      ${sec('Recent activity')}<div class="pgrid five">${d.recent.map(r => pcell(r.game, stars(r.rating) + (r.liked ? '<span class="hrt">♥</span>' : ''))).join('') || `<div class="empty" style="grid-column:1/-1">${t('Nothing logged yet.')}</div>`}</div></div>
      <div>${tm}${sec('Ratings')}<div class="hist" dir="ltr" style="height:90px">${d.hist.map((n, i) => `<i style="height:${Math.max(3, n / hmax * 100)}%" title="${(i + 1) / 2}★: ${n}"></i>`).join('')}</div><div class="histlab" dir="ltr"><span>½</span><span>${s.avg ? s.avg.toFixed(2) + ' ' + t('avg') : ''}</span><span>★★★★★</span></div>
      ${u.bio ? sec('About') + `<p>${esc(u.bio)}</p>` : ''}</div></div>`;
  } else if (tab === 'games' || tab === 'reviews') {
    const ls = await api(`/user/${name}/logs?kind=${tab === 'reviews' ? 'reviews' : ''}`);
    if (tab === 'reviews') body = ls.map(r => reviewHtml(r, true)).join('') || `<div class="empty">${t('No reviews.')}</div>`;
    else {
      let last = '';
      body = ls.length ? `<table class="dy"><tr><th>${t('Month')}</th><th>${t('Day')}</th><th colspan="2">${t('Game')}</th><th>${t('Released')}</th><th>${t('Rating')}</th><th>${t('Like')}</th></tr>${ls.map(r => {
        const mo = r.date ? new Date(r.date + 'T00:00').toLocaleDateString(LOCALE(), { month: 'short', year: 'numeric' }) : ''; const show = mo !== last; last = mo;
        return `<tr><td class="mon">${show ? mo : ''}</td><td>${r.date ? new Date(r.date + 'T00:00').getDate() : ''}</td><td class="mini">${poster(r.game)}</td><td><a class="serif" style="color:var(--white);font-size:16px" href="#/game/${r.game.id}">${esc(r.game.name)}</a></td><td class="muted">${r.game.year || ''}</td><td>${stars(r.rating)}</td><td>${r.liked ? '<span class="hrt">♥</span>' : ''}</td></tr>`;
      }).join('')}</table>` : `<div class="empty">${t('Nothing logged yet.')}</div>`;
    }
  } else if (tab === 'backlog') {
    const gs = await api(`/user/${name}/backlog`);
    body = gs.length ? `<div class="pgrid">${gs.map(g => pcell(g)).join('')}</div>` : `<div class="empty">${t('Backlog is empty.')}</div>`;
  } else if (tab === 'lists') {
    const ls = await api(`/user/${name}/lists`);
    body = (own ? `<button class="btn" id="nl">+ ${t('New list')}</button>` : '') + (ls.map(listCardHtml).join('') || `<div class="empty">${t('No lists.')}</div>`);
  } else if (tab === 'followers' || tab === 'following') {
    const us = await api(`/user/${name}/follows?kind=${tab}`);
    body = `<div style="max-width:620px">${us.map(personRow).join('') || `<div class="empty">${t('Nobody here yet.')}</div>`}</div>`;
  }
  const badge = d.following && d.followsMe ? `<span class="chip on">${t('Friends')}</span>` : d.followsMe ? `<span class="chip">${t('Follows you')}</span>` : '';
  app.innerHTML = `<div class="wrap"><div class="phead">${avatar(u.username, 'lg')}<div><h1 class="title">${esc(u.username)}</h1><div class="muted" style="font-size:13px">${u.demo ? t('Demo account') + ' · ' : ''}${t('Joined')} ${fmtDate(d.joined)}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center">${me && !own ? `<button class="btn sm ${d.following ? '' : 'pri'}" id="fo">${d.following ? t('Following') : t('Follow')}</button>` : ''}${badge}</div></div>
      <div class="pstats"><div><b>${s.games}</b><span>${t('Games')}</span></div><div><b>${s.thisYear}</b><span>${t('This year')}</span></div><div><b>${s.backlog}</b><span>${t('Backlog')}</span></div><a href="#/u/${esc(u.username)}/followers"><b>${s.followers}</b><span>${t('Followers')}</span></a><a href="#/u/${esc(u.username)}/following"><b>${s.following}</b><span>${t('Following')}</span></a></div></div>
    <div class="tabs" style="margin-top:6px">${tabs.map(([k, l]) => `<a class="${k === tab ? 'on' : ''}" href="#/u/${esc(u.username)}${k ? '/' + k : ''}">${t(l)}</a>`).join('')}</div>${body}</div>`;
  bindReviews(app); bindFollow(app);
  const ef = $('#ef'); if (ef) ef.onclick = async e => {
    e.preventDefault();
    const ls = await api(`/user/${name}/logs`); let sel = d.favorites.map(g => g.id);
    if (!ls.length) { toast(t('Log some games first')); return; }
    const m = modal(`<h3>${t('Pick up to four favorites')}</h3><div class="favpick">${ls.map(r => `<div data-id="${r.game.id}" class="pcell">${poster(r.game)}</div>`).join('')}</div><div class="mrow"><button class="btn pri" id="fs">${t('Save')}</button></div>`);
    const paint = () => m.querySelectorAll('[data-id]').forEach(c => c.querySelector('.poster').classList.toggle('sel', sel.includes(c.dataset.id)));
    m.querySelectorAll('[data-id]').forEach(c => c.onclick = ev => { ev.preventDefault(); const id = c.dataset.id; sel = sel.includes(id) ? sel.filter(x => x !== id) : sel.length < 4 ? [...sel, id] : sel; paint(); });
    paint();
    $('#fs', m).onclick = async () => { await api('/profile', 'POST', { favorites: sel }); m.close(); route(); };
  };
  const fo = $('#fo'); if (fo) fo.onclick = async () => { await api(`/user/${name}/follow`, 'POST'); route(); };
  const nl = $('#nl'); if (nl) nl.onclick = () => { const m = modal(`<h3>${t('New list')}</h3><form class="f"><input name="t" placeholder="${t('Title')}"><label>${t('Description')}</label><textarea name="d" rows="3"></textarea><div class="mrow"><button class="btn pri">${t('Create')}</button></div></form>`); $('form', m).onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const l = await api('/lists', 'POST', { title: f.get('t'), desc: f.get('d') }); m.close(); location.hash = '#/list/' + l.id; }; };
}

async function pagePeople() {
  setNav('people');
  let q = '';
  const draw = async () => {
    const us = await api('/people?q=' + encodeURIComponent(q));
    $('#pl').innerHTML = us.map(personRow).join('') || `<div class="empty">${t('Nobody here yet.')}</div>`; bindFollow($('#pl'));
  };
  app.innerHTML = `<div class="wrap" style="padding-top:26px;max-width:700px"><h1 class="title">${t('People')}</h1><p class="muted">${t('Follow people to see what they play. When you follow each other, you’re friends.')}</p>
    <input id="pq" class="f" placeholder="${t('Search by username')}" style="width:100%;background:#0f1318;border:1px solid var(--line);color:var(--white);border-radius:6px;padding:10px;font:inherit;margin:10px 0 6px">
    <h2 class="sec"><span>${t(q ? 'Results' : 'Suggested for you')}</span></h2><div id="pl"></div></div>`;
  let tm; $('#pq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { q = e.target.value.trim(); draw(); }, 200); };
  draw();
}

async function pageNotifs() {
  setNav('');
  if (!needAuth()) { app.innerHTML = ''; return; }
  const ns = await api('/notifications');
  await api('/notifications/read', 'POST'); me.unread = 0; renderAuth();
  const msg = n => {
    const u = `<a href="#/u/${esc(n.from)}"><b>${esc(n.from)}</b></a>`, g = n.game ? `<a href="#/game/${n.game.id}">${esc(n.game.name)}</a>` : '';
    return n.type === 'follow' ? t('{u} started following you', { u }) : n.type === 'like' ? t('{u} liked your review of {g}', { u, g }) : t('{u} commented on your review of {g}', { u, g });
  };
  app.innerHTML = `<div class="wrap" style="padding-top:26px;max-width:700px"><h1 class="title">${t('Notifications')}</h1>
    ${ns.map(n => `<div class="rev" style="grid-template-columns:40px 1fr">${avatar(n.from)}<div style="align-self:center">${msg(n)} <span class="muted">· ${ago(n.at)}</span></div></div>`).join('') || `<div class="empty">${t('Nothing new.')}</div>`}</div>`;
}

async function pageReset(token) {
  setNav('');
  app.innerHTML = `<div class="wrap" style="padding-top:26px;max-width:420px"><h1 class="title">${t('Choose a new password')}</h1>
    <form class="f" id="rf"><label>${t('New password')}</label><input name="p" type="password" autocomplete="new-password" required dir="ltr"><div class="err" id="er"></div>
    <div class="mrow"><button class="btn pri">${t('Set password')}</button></div></form></div>`;
  $('#rf').onsubmit = async e => {
    e.preventDefault();
    try { await api('/reset', 'POST', { token, password: new FormData(e.target).get('p') }); me = null; renderAuth(); renderNotice(); toast(t('Password updated. Please sign in.')); location.hash = '#/'; authModal('login'); }
    catch (er) { $('#er').textContent = er.message; }
  };
}
async function pageVerify(token) {
  setNav('');
  let msg; try { await api('/verify', 'POST', { token }); msg = t('Email confirmed. Thank you!'); await refreshMe(); } catch (e) { msg = e.message; }
  app.innerHTML = `<div class="wrap empty" style="padding-top:60px"><h1 class="title">${esc(msg)}</h1><p><a class="btn pri" href="#/">${t('Go to Campfire')}</a></p></div>`;
}
async function pageSettings() {
  setNav('');
  if (!me) { app.innerHTML = ''; authModal('login'); return; }
  app.innerHTML = `<div class="wrap" style="padding-top:26px;max-width:480px"><h1 class="title">${t('Settings')}</h1>
    <form class="f" id="sf"><h2 class="sec"><span>${t('Email')}</span></h2>
    <input name="email" type="email" dir="ltr" value="${esc(me.email)}" placeholder="you@example.com">
    <div class="muted" style="font-size:13px;margin-top:4px">${me.email ? (me.emailVerified ? t('Confirmed') : t('Not confirmed yet')) : t('No email on this account')}</div>
    <h2 class="sec"><span>${t('Password')}</span></h2>
    <label style="margin-top:0">${t('Current password')}</label><input name="cur" type="password" autocomplete="current-password" dir="ltr">
    <label>${t('New password')} <span style="text-transform:none;letter-spacing:0">(${t('optional')})</span></label><input name="np" type="password" autocomplete="new-password" dir="ltr">
    <div class="err" id="er"></div><div class="mrow"><button class="btn pri">${t('Save')}</button></div></form></div>`;
  $('#sf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target), body = { lang: LANG, currentPassword: f.get('cur') };
    if (f.get('email') !== me.email) body.email = f.get('email');
    if (f.get('np')) body.newPassword = f.get('np');
    if (body.email === undefined && !body.newPassword) { toast(t('Nothing to change')); return; }
    try { await api('/account', 'POST', body); await refreshMe(); toast(t('Saved')); pageSettings(); }
    catch (er) { $('#er').textContent = er.message; }
  };
}

async function pageLists() {
  setNav('lists');
  const ls = await api('/lists');
  app.innerHTML = `<div class="wrap" style="padding-top:26px"><div style="display:flex;justify-content:space-between;align-items:center"><h1 class="title">${t('Lists')}</h1>${me ? `<a class="btn" href="#/u/${esc(me.username)}/lists">${t('Your lists')}</a>` : ''}</div>${ls.map(listCardHtml).join('') || `<div class="empty">${t('No lists yet. Make the first one from your profile.')}</div>`}</div>`;
}
async function pageList(id) {
  setNav('lists');
  const l = await api('/lists/' + id);
  app.innerHTML = `<div class="wrap" style="padding-top:26px"><div class="muted" style="font-size:13px">${t('List by')} <a href="#/u/${esc(l.user)}">${esc(l.user)}</a></div><h1 class="title">${esc(l.title)}</h1><p style="max-width:640px">${esc(l.desc)}</p>
    ${l.mine ? `<button class="btn ghost sm" id="dl">${t('Delete list')}</button>` : ''}<div class="pgrid" style="margin-top:18px">${l.games.map((g, i) => pcell(g, `<span>${i + 1}</span>`)).join('') || `<div class="empty" style="grid-column:1/-1">${t('Empty. Add games from any game page.')}</div>`}</div></div>`;
  const dl = $('#dl'); if (dl) dl.onclick = async () => { if (confirm(t('Delete this list?'))) { await api('/lists/' + id, 'DELETE'); location.hash = '#/lists'; } };
}

// ---------- router ----------
async function route() {
  const p = decodeURIComponent(location.hash.slice(1) || '/').split('/').filter(Boolean);
  document.title = t('Campfire — track the games you play'); window.scrollTo(0, 0);
  try {
    if (!p.length) await pageHome();
    else if (p[0] === 'games') await pageGames(p[1], p[2]);
    else if (p[0] === 'game') await pageGame(p[1], p[2]);
    else if (p[0] === 'u') await pageUser(p[1], p[2]);
    else if (p[0] === 'people') await pagePeople();
    else if (p[0] === 'notifications') await pageNotifs();
    else if (p[0] === 'reset') await pageReset(p[1]);
    else if (p[0] === 'verify') await pageVerify(p[1]);
    else if (p[0] === 'settings') await pageSettings();
    else if (p[0] === 'lists') await pageLists();
    else if (p[0] === 'list') await pageList(p[1]);
    else app.innerHTML = `<div class="wrap empty">${t('Page not found.')}</div>`;
  } catch (e) { app.innerHTML = `<div class="wrap empty">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);
(async () => { setLang(LANG); applyStatic(); renderLang(); await refreshMe(); route(); })();
