// Campfire server — zero dependencies. Node 20+.
// Game data: Steam Store API (no key). Optional IGDB later via env.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROD = process.env.NODE_ENV === 'production';
// tiny per-IP rate limit for auth endpoints
const hits = new Map();
function limited(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), now = Date.now();
  const a = (hits.get(ip) || []).filter(t => now - t < 60000); a.push(now); hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > 10;
}
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- tiny JSON db ----------
let db = { users: [], sessions: {}, games: {}, logs: [], backlog: [], lists: [], follows: [], comments: [], notifs: [], seq: 1, seeded: false };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 300);
}
const nid = () => db.seq++;
const today = () => new Date().toISOString().slice(0, 10);

// ---------- steam ----------
const CDN = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/';
const UA = { 'User-Agent': 'Campfire/0.1' };
const inflight = new Map();
function fetchGame(id) {
  id = String(id);
  if (db.games[id]) return Promise.resolve(db.games[id]);
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    try {
      const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english&cc=us`, { headers: UA });
      const j = await r.json();
      const d = j[id] && j[id].success && j[id].data;
      if (!d || d.type !== 'game') return null;
      const g = {
        id, name: d.name,
        year: d.release_date && d.release_date.date ? (String(d.release_date.date).match(/\d{4}/) || [null])[0] : null,
        genres: (d.genres || []).map(x => x.description),
        developers: d.developers || [], publishers: d.publishers || [],
        short: d.short_description || '', metacritic: d.metacritic ? d.metacritic.score : null,
        platforms: Object.keys(d.platforms || {}).filter(k => d.platforms[k]),
        header: d.header_image, poster: `${CDN}${id}/library_600x900.jpg`, hero: `${CDN}${id}/library_hero.jpg`,
        shots: (d.screenshots || []).slice(0, 6).map(s => s.path_thumbnail),
      };
      db.games[id] = g; save();
      return g;
    } catch { return null; } finally { inflight.delete(id); }
  })();
  inflight.set(id, p);
  return p;
}
const gs = g => g && ({ id: g.id, name: g.name, year: g.year, poster: g.poster, header: g.header });

// ---------- rituals: each game's "fire" has its own counter ----------
const RITUALS = {
  1245620: ['Deaths', 'Tarnished have died'], 1145360: ['Escape attempts', 'escapes attempted'],
  413150: ['In-game year', 'seasons farmed'], 367520: ['Completion %', 'avg completion'],
  632470: ['Hours of thinking', 'hours of thinking'], 1687950: ['Confidants maxed', 'bonds forged'],
  1086940: ['Hours played', 'hours spent'], 504230: ['Strawberries', 'strawberries collected'],
  374320: ['Deaths', 'deaths'], 814380: ['Deaths', 'deaths'], 2379780: ['Highest ante', 'ante reached'],
};
const ritualOf = id => RITUALS[id] || ['Hours played', 'hours spent'];

// ---------- auth ----------
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
function parseCookies(req) {
  const o = {}; (req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1)); });
  return o;
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const byEmail = e => { e = String(e || '').trim().toLowerCase(); return e && db.users.find(u => u.email === e); };
db.tokens = db.tokens || [];
function makeToken(userId, type, ttlMs, extra = {}) {
  const raw = crypto.randomBytes(32).toString('hex');
  db.tokens = db.tokens.filter(t => t.exp > Date.now() && !(t.userId === userId && t.type === type));
  db.tokens.push({ h: sha(raw), userId, type, exp: Date.now() + ttlMs, ...extra }); save();
  return raw;
}
function useToken(raw, type) {
  const h = sha(String(raw || '')), i = db.tokens.findIndex(t => t.h === h && t.type === type && t.exp > Date.now());
  if (i < 0) return null;
  const [t] = db.tokens.splice(i, 1); save(); return t;
}
const appUrl = req => (process.env.APP_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/$/, '');
// --- mail: Resend HTTP API if RESEND_API_KEY is set, otherwise log to console + data/outbox.log (dev) ---
const MAIL = {
  en: { reset: ['Reset your Campfire password', 'Someone asked to reset your Campfire password. Open this link within 1 hour:', 'If this wasn’t you, ignore this email.'], verify: ['Confirm your Campfire email', 'Confirm your email address by opening this link:', 'If you didn’t sign up, ignore this email.'] },
  fa: { reset: ['بازیابی رمز عبور کمپ‌فایر', 'درخواست بازیابی رمز عبور حساب شما ثبت شد. این لینک تا ۱ ساعت معتبر است:', 'اگر این درخواست از شما نبود، این ایمیل را نادیده بگیرید.'], verify: ['تأیید ایمیل کمپ‌فایر', 'برای تأیید ایمیل خود این لینک را باز کنید:', 'اگر ثبت‌نام نکرده‌اید، این ایمیل را نادیده بگیرید.'] },
  ar: { reset: ['إعادة تعيين كلمة مرور Campfire', 'طُلب إعادة تعيين كلمة مرور حسابك. افتح هذا الرابط خلال ساعة:', 'إذا لم تكن أنت، تجاهل هذه الرسالة.'], verify: ['تأكيد بريد Campfire', 'أكّد بريدك الإلكتروني بفتح هذا الرابط:', 'إذا لم تسجّل، تجاهل هذه الرسالة.'] },
  es: { reset: ['Restablece tu contraseña de Campfire', 'Alguien pidió restablecer tu contraseña. Abre este enlace en 1 hora:', 'Si no fuiste tú, ignora este correo.'], verify: ['Confirma tu correo de Campfire', 'Confirma tu correo abriendo este enlace:', 'Si no te registraste, ignora este correo.'] },
  tr: { reset: ['Campfire parolanı sıfırla', 'Parolanın sıfırlanması istendi. Bu bağlantıyı 1 saat içinde aç:', 'Bu sen değilsen bu e-postayı yok say.'], verify: ['Campfire e-postanı doğrula', 'E-postanı doğrulamak için bu bağlantıyı aç:', 'Kayıt olmadıysan bu e-postayı yok say.'] },
};
async function sendMail(to, kind, link, lang) {
  const [subject, line, foot] = (MAIL[lang] || MAIL.en)[kind];
  const text = `${line}\n\n${link}\n\n${foot}`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px"><h2 style="color:#ff7a3d">campfire</h2><p>${line}</p><p><a href="${link}" style="background:#ff7a3d;color:#1b0f08;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:700">${subject}</a></p><p style="color:#777;font-size:13px;word-break:break-all">${link}</p><p style="color:#777;font-size:13px">${foot}</p></div>`;
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.MAIL_FROM || 'Campfire <onboarding@resend.dev>', to: [to], subject, html, text }) });
      if (!r.ok) console.error('mail failed', r.status, await r.text());
    } catch (e) { console.error('mail error', e.message); }
    return;
  }
  const entry = `[${new Date().toISOString()}] TO: ${to}\nSUBJECT: ${subject}\n${link}\n\n`;
  console.log('\n--- DEV MAIL (set RESEND_API_KEY to send real email) ---\n' + entry);
  try { fs.appendFileSync(path.join(DATA_DIR, 'outbox.log'), entry); } catch {}
}
const userOf = req => { const s = db.sessions[parseCookies(req).sid]; return s ? db.users.find(u => u.id === s) : null; };
const pubUser = u => ({ username: u.username, bio: u.bio || '', demo: !!u.demo });
const byName = n => db.users.find(u => u.username === String(n).toLowerCase());
function setSession(res, uid) {
  const sid = crypto.randomBytes(24).toString('hex'); db.sessions[sid] = uid; save();
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 90}${PROD ? '; Secure' : ''}`);
}

// ---------- stats helpers ----------
function gameStats(gid) {
  gid = String(gid);
  const ls = db.logs.filter(l => l.gameId === gid);
  const rated = ls.filter(l => l.rating > 0);
  const hist = Array(10).fill(0); rated.forEach(l => hist[l.rating - 1]++);
  const vibes = {}; ls.forEach(l => (l.vibes || []).forEach(v => vibes[v] = (vibes[v] || 0) + 1));
  const [label, unit] = ritualOf(gid);
  const rv = ls.filter(l => l.ritual !== '' && l.ritual != null).map(l => Number(l.ritual)).filter(n => !isNaN(n));
  return {
    plays: ls.length, likes: ls.filter(l => l.liked).length, backlog: db.backlog.filter(b => b.gameId === gid).length,
    avg: rated.length ? rated.reduce((a, l) => a + l.rating, 0) / rated.length / 2 : null, ratings: rated.length, hist,
    vibes: Object.entries(vibes).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ vibe: k, n: v })),
    ritual: { label, unit, total: rv.reduce((a, b) => a + b, 0), count: rv.length },
  };
}
async function logOut(l, me) {
  const g = await fetchGame(l.gameId), u = db.users.find(x => x.id === l.userId);
  return { id: l.id, user: u ? u.username : '?', demo: !!(u && u.demo), game: gs(g), rating: l.rating, review: l.review, spoiler: l.spoiler, vibes: l.vibes, liked: l.liked, date: l.date, updatedAt: l.updatedAt, likes: l.likes.length, iLike: !!(me && l.likes.includes(me.id)), comments: db.comments.filter(c => c.logId === l.id).length };
}
const logsOut = (arr, me) => Promise.all(arr.map(l => logOut(l, me)));
const followingIds = u => new Set(db.follows.filter(f => f.from === u.id).map(f => f.to));
function notify(to, type, from, extra = {}) {
  if (to === from.id) return;
  db.notifs.push({ id: nid(), to, type, from: from.username, at: Date.now(), read: false, ...extra });
  if (db.notifs.length > 20000) db.notifs.splice(0, 5000);
}
function userCard(u, me, fset) {
  return { username: u.username, demo: !!u.demo, bio: u.bio || '', games: db.logs.filter(l => l.userId === u.id).length, followers: db.follows.filter(f => f.to === u.id).length, following: !!(fset && fset.has(u.id)), me: !!(me && me.id === u.id) };
}
// taste match: 0-100 based on rating distance across commonly rated games
function tasteMatch(a, b) {
  const rb = new Map(db.logs.filter(l => l.userId === b.id && l.rating).map(l => [l.gameId, l.rating]));
  let n = 0, d = 0;
  db.logs.filter(l => l.userId === a.id && l.rating).forEach(l => { if (rb.has(l.gameId)) { n++; d += Math.abs(l.rating - rb.get(l.gameId)); } });
  return n >= 3 ? { match: Math.round(100 - (d / n) / 9 * 100), common: n } : { match: null, common: n };
}

// ---------- routes ----------
const routes = [];
const R = (m, p, h) => routes.push([m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), h]);
const bad = (m, c = 400) => { const e = new Error(m); e.code = c; throw e; };
const need = c => c.me || bad('Sign in first', 401);

R('POST', '/api/register', async c => {
  if (limited(c.req)) bad('Too many attempts, wait a minute', 429);
  const { username, password } = c.body; const un = String(username || '').toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(un)) bad('Username: 3-20 letters, numbers or _');
  if (String(password || '').length < 6) bad('Password needs 6+ characters');
  if (byName(un)) bad('That username is taken');
  const email = String(c.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) bad('Enter a valid email address');
  if (byEmail(email)) bad('That email is already registered');
  const salt = crypto.randomBytes(16).toString('hex');
  const u = { id: nid(), username: un, salt, pw: hash(password, salt), bio: '', favorites: [], created: today(), email, emailVerified: false };
  db.users.push(u); setSession(c.res, u.id);
  sendMail(email, 'verify', `${appUrl(c.req)}/#/verify/${makeToken(u.id, 'verify', 7 * 864e5, { email })}`, c.body.lang);
  return pubUser(u);
});
R('POST', '/api/login', async c => {
  if (limited(c.req)) bad('Too many attempts, wait a minute', 429);
  const u = byName(c.body.username || '') || byEmail(c.body.username);
  if (!u || u.demo || hash(String(c.body.password || ''), u.salt) !== u.pw) bad('Wrong username or password', 401);
  setSession(c.res, u.id); return pubUser(u);
});
R('POST', '/api/logout', async c => { const s = parseCookies(c.req).sid; delete db.sessions[s]; save(); c.res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/'); return { ok: true }; });
R('GET', '/api/me', async c => c.me ? { ...pubUser(c.me), email: c.me.email || '', emailVerified: !!c.me.emailVerified, unread: db.notifs.filter(n => n.to === c.me.id && !n.read).length } : null);

// ----- password reset / email verification / account -----
const dropOtherSessions = (uid, keep) => { for (const s of Object.keys(db.sessions)) if (db.sessions[s] === uid && s !== keep) delete db.sessions[s]; };
const checkPw = pw => { if (String(pw || '').length < 6) bad('Password needs 6+ characters'); };
R('POST', '/api/forgot', async c => {
  if (limited(c.req)) bad('Too many attempts, wait a minute', 429);
  const id = String(c.body.email || '').trim().toLowerCase();
  const u = byEmail(id) || (id && byName(id));
  // same answer whether or not the account exists (no account enumeration)
  if (u && u.email && !u.demo) sendMail(u.email, 'reset', `${appUrl(c.req)}/#/reset/${makeToken(u.id, 'reset', 3600e3)}`, c.body.lang);
  return { ok: true };
});
R('POST', '/api/reset', async c => {
  if (limited(c.req)) bad('Too many attempts, wait a minute', 429);
  checkPw(c.body.password);
  const t = useToken(c.body.token, 'reset'); if (!t) bad('This link is invalid or has expired');
  const u = db.users.find(x => x.id === t.userId); if (!u) bad('This link is invalid or has expired');
  u.salt = crypto.randomBytes(16).toString('hex'); u.pw = hash(c.body.password, u.salt);
  u.emailVerified = true; // they proved control of the inbox
  dropOtherSessions(u.id, null); save(); return { ok: true };
});
R('POST', '/api/verify', async c => {
  const t = useToken(c.body.token, 'verify'); if (!t) bad('This link is invalid or has expired');
  const u = db.users.find(x => x.id === t.userId); if (!u || u.email !== t.email) bad('This link is invalid or has expired');
  u.emailVerified = true; save(); return { ok: true };
});
R('POST', '/api/resend-verify', async c => {
  const me = need(c); if (limited(c.req)) bad('Too many attempts, wait a minute', 429);
  if (!me.email || me.emailVerified) return { ok: true };
  sendMail(me.email, 'verify', `${appUrl(c.req)}/#/verify/${makeToken(me.id, 'verify', 7 * 864e5, { email: me.email })}`, c.body.lang);
  return { ok: true };
});
R('POST', '/api/account', async c => {
  const me = need(c), b = c.body;
  if (limited(c.req)) bad('Too many attempts, wait a minute', 429);
  if (!me.demo && (b.email !== undefined || b.newPassword)) {
    if (me.pw && hash(String(b.currentPassword || ''), me.salt) !== me.pw) bad('Current password is incorrect', 403);
  }
  if (b.email !== undefined) {
    const e = String(b.email).trim().toLowerCase();
    if (e !== (me.email || '')) {
      if (!EMAIL_RE.test(e)) bad('Enter a valid email address');
      if (byEmail(e)) bad('That email is already registered');
      me.email = e; me.emailVerified = false;
      sendMail(e, 'verify', `${appUrl(c.req)}/#/verify/${makeToken(me.id, 'verify', 7 * 864e5, { email: e })}`, b.lang);
    }
  }
  if (b.newPassword) {
    checkPw(b.newPassword); me.salt = crypto.randomBytes(16).toString('hex'); me.pw = hash(b.newPassword, me.salt);
    dropOtherSessions(me.id, parseCookies(c.req).sid);
  }
  save(); return { ...pubUser(me), email: me.email || '', emailVerified: !!me.emailVerified };
});

R('GET', '/api/notifications', async c => {
  const me = need(c);
  const mine = db.notifs.filter(n => n.to === me.id).sort((a, b) => b.at - a.at).slice(0, 50);
  const out = await Promise.all(mine.map(async n => ({ ...n, game: n.gameId ? gs(await fetchGame(n.gameId)) : null })));
  return out;
});
R('POST', '/api/notifications/read', async c => { const me = need(c); db.notifs.forEach(n => { if (n.to === me.id) n.read = true; }); save(); return { ok: true }; });

R('GET', '/api/people', async c => {
  const q = (c.q.q || '').toLowerCase().trim(), fset = c.me ? followingIds(c.me) : new Set();
  let us = db.users.filter(u => !c.me || u.id !== c.me.id);
  if (q) us = us.filter(u => u.username.includes(q));
  else us = us.filter(u => !fset.has(u.id));
  us = us.map(u => ({ u, n: db.logs.filter(l => l.userId === u.id).length }));
  us.sort((a, b) => b.n - a.n);
  return us.slice(0, 40).map(x => ({ ...userCard(x.u, c.me, fset), ...(c.me && !q ? tasteMatch(c.me, x.u) : {}) }));
});
R('GET', '/api/user/:name/follows', async c => {
  const u = byName(c.p.name); if (!u) bad('No such user', 404);
  const ids = c.q.kind === 'followers' ? db.follows.filter(f => f.to === u.id).map(f => f.from) : db.follows.filter(f => f.from === u.id).map(f => f.to);
  const fset = c.me ? followingIds(c.me) : new Set();
  return ids.map(id => db.users.find(x => x.id === id)).filter(Boolean).map(x => userCard(x, c.me, fset));
});

R('GET', '/api/review/:id/comments', async c => {
  return db.comments.filter(x => x.logId === Number(c.p.id)).sort((a, b) => a.at - b.at).map(x => ({ id: x.id, user: (db.users.find(u => u.id === x.userId) || {}).username, text: x.text, at: x.at, mine: !!(c.me && c.me.id === x.userId) }));
});
R('POST', '/api/review/:id/comments', async c => {
  const me = need(c), l = db.logs.find(x => x.id === Number(c.p.id)); if (!l) bad('Not found', 404);
  const text = String(c.body.text || '').trim().slice(0, 1000); if (!text) bad('Write something first');
  const cm = { id: nid(), logId: l.id, userId: me.id, text, at: Date.now() }; db.comments.push(cm);
  const owner = db.users.find(u => u.id === l.userId); if (owner) notify(owner.id, 'comment', me, { logId: l.id, gameId: l.gameId });
  save(); return { id: cm.id, user: me.username, text, at: cm.at, mine: true };
});
R('DELETE', '/api/comments/:id', async c => { const me = need(c); db.comments = db.comments.filter(x => !(x.id === Number(c.p.id) && x.userId === me.id)); save(); return { ok: true }; });

R('GET', '/api/search', async c => {
  const q = (c.q.q || '').trim(); if (q.length < 2) return [];
  const r = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=us`, { headers: UA });
  const j = await r.json();
  return (j.items || []).filter(i => i.type === 'app' && !/soundtrack|artbook|\bdlc\b|demo$|dedicated server|\bost\b/i.test(i.name)).slice(0, 12).map(i => ({ id: String(i.id), name: i.name, poster: `${CDN}${i.id}/library_600x900.jpg`, header: `${CDN}${i.id}/header.jpg` }));
});

R('GET', '/api/games', async c => {
  // browse: sort=popular|rating|new , genre
  const ids = Object.keys(db.games), now = Date.now();
  let arr = ids.map(id => {
    const g = db.games[id], s = gameStats(id);
    const recent = db.logs.filter(l => l.gameId === id && now - l.updatedAt < 30 * 864e5).length;
    return { g, s, pop: recent * 3 + s.plays + s.backlog };
  });
  if (c.q.genre) arr = arr.filter(x => x.g.genres.includes(c.q.genre));
  const sort = c.q.sort || 'popular';
  if (sort === 'rating') arr.sort((a, b) => (b.s.avg || 0) - (a.s.avg || 0));
  else if (sort === 'new') arr.sort((a, b) => (b.g.year || 0) - (a.g.year || 0));
  else arr.sort((a, b) => b.pop - a.pop);
  const genres = [...new Set(ids.flatMap(i => db.games[i].genres))].sort();
  return { genres, games: arr.slice(0, Number(c.q.limit) || 60).map(x => ({ ...gs(x.g), avg: x.s.avg, plays: x.s.plays, likes: x.s.likes })) };
});

R('GET', '/api/game/:id', async c => {
  const g = await fetchGame(c.p.id); if (!g) bad('Game not found', 404);
  const my = c.me && db.logs.find(l => l.userId === c.me.id && l.gameId === g.id);
  const reviews = db.logs.filter(l => l.gameId === g.id && l.review).sort((a, b) => b.likes.length - a.likes.length || b.updatedAt - a.updatedAt).slice(0, 30);
  const lists = db.lists.filter(l => l.gameIds.includes(g.id) && l.public !== false).slice(0, 6);
  const fids = c.me ? followingIds(c.me) : new Set();
  const friends = db.logs.filter(l => fids.has(l.userId) && l.gameId === g.id).sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    game: g, stats: gameStats(g.id), my: my || null, friends: await logsOut(friends, c.me),
    inBacklog: !!(c.me && db.backlog.find(b => b.userId === c.me.id && b.gameId === g.id)),
    reviews: await logsOut(reviews, c.me),
    lists: lists.map(l => ({ id: l.id, title: l.title, user: db.users.find(u => u.id === l.userId).username, count: l.gameIds.length })),
  };
});

R('POST', '/api/log', async c => {
  const me = need(c), b = c.body, g = await fetchGame(b.gameId); if (!g) bad('Unknown game', 404);
  let l = db.logs.find(x => x.userId === me.id && x.gameId === g.id);
  if (!l) { l = { id: nid(), userId: me.id, gameId: g.id, likes: [], created: Date.now() }; db.logs.push(l); }
  const rating = Math.max(0, Math.min(10, Math.round(Number(b.rating) || 0)));
  Object.assign(l, {
    rating, review: String(b.review || '').slice(0, 5000).trim(), spoiler: !!b.spoiler, liked: !!b.liked,
    vibes: (Array.isArray(b.vibes) ? b.vibes : []).slice(0, 4).map(String),
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : today(),
    ritual: b.ritual === '' || b.ritual == null ? '' : String(b.ritual).slice(0, 40), updatedAt: Date.now(),
  });
  db.backlog = db.backlog.filter(x => !(x.userId === me.id && x.gameId === g.id));
  save(); return logOut(l, me);
});
R('DELETE', '/api/log/:gid', async c => { const me = need(c); db.logs = db.logs.filter(l => !(l.userId === me.id && l.gameId === c.p.gid)); save(); return { ok: true }; });
R('POST', '/api/backlog/:gid', async c => {
  const me = need(c), g = await fetchGame(c.p.gid); if (!g) bad('Unknown game', 404);
  const i = db.backlog.findIndex(b => b.userId === me.id && b.gameId === g.id);
  if (i >= 0) db.backlog.splice(i, 1); else db.backlog.push({ userId: me.id, gameId: g.id, at: Date.now() });
  save(); return { inBacklog: i < 0 };
});
R('POST', '/api/review/:id/like', async c => {
  const me = need(c), l = db.logs.find(x => x.id === Number(c.p.id)); if (!l) bad('Not found', 404);
  const i = l.likes.indexOf(me.id); if (i >= 0) l.likes.splice(i, 1); else { l.likes.push(me.id); notify(l.userId, 'like', me, { logId: l.id, gameId: l.gameId }); }
  save(); return { likes: l.likes.length, iLike: i < 0 };
});

R('GET', '/api/reviews/recent', async c => {
  const ls = db.logs.filter(l => l.review).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  return logsOut(ls, c.me);
});
R('GET', '/api/feed', async c => {
  const me = need(c), ids = new Set(db.follows.filter(f => f.from === me.id).map(f => f.to)); ids.add(me.id);
  return logsOut(db.logs.filter(l => ids.has(l.userId)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30), me);
});

// profiles
R('GET', '/api/user/:name', async c => {
  const u = byName(c.p.name); if (!u) bad('No such user', 404);
  const ls = db.logs.filter(l => l.userId === u.id), rated = ls.filter(l => l.rating);
  const hist = Array(10).fill(0); rated.forEach(l => hist[l.rating - 1]++);
  const year = String(new Date().getFullYear());
  const favs = (await Promise.all((u.favorites || []).map(fetchGame))).filter(Boolean).map(gs);
  return {
    user: pubUser(u), joined: u.created, favorites: favs, hist,
    stats: { games: ls.length, thisYear: ls.filter(l => (l.date || '').startsWith(year)).length, backlog: db.backlog.filter(b => b.userId === u.id).length, lists: db.lists.filter(l => l.userId === u.id).length, followers: db.follows.filter(f => f.to === u.id).length, following: db.follows.filter(f => f.from === u.id).length, avg: rated.length ? rated.reduce((a, l) => a + l.rating, 0) / rated.length / 2 : null },
    following: !!(c.me && db.follows.find(f => f.from === c.me.id && f.to === u.id)),
    followsMe: !!(c.me && db.follows.find(f => f.from === u.id && f.to === c.me.id)),
    taste: c.me && c.me.id !== u.id ? tasteMatch(c.me, u) : null,
    recent: await logsOut(ls.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6), c.me),
  };
});
R('GET', '/api/user/:name/logs', async c => {
  const u = byName(c.p.name); if (!u) bad('No such user', 404);
  let ls = db.logs.filter(l => l.userId === u.id);
  if (c.q.kind === 'reviews') ls = ls.filter(l => l.review);
  ls.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt);
  return logsOut(ls, c.me);
});
R('GET', '/api/user/:name/backlog', async c => {
  const u = byName(c.p.name); if (!u) bad('No such user', 404);
  const gs_ = await Promise.all(db.backlog.filter(b => b.userId === u.id).sort((a, b) => b.at - a.at).map(b => fetchGame(b.gameId)));
  return gs_.filter(Boolean).map(gs);
});
R('GET', '/api/user/:name/lists', async c => {
  const u = byName(c.p.name); if (!u) bad('No such user', 404);
  return Promise.all(db.lists.filter(l => l.userId === u.id).map(listCard));
});
R('POST', '/api/user/:name/follow', async c => {
  const me = need(c), u = byName(c.p.name); if (!u || u.id === me.id) bad('Cannot follow');
  const i = db.follows.findIndex(f => f.from === me.id && f.to === u.id);
  if (i >= 0) db.follows.splice(i, 1); else { db.follows.push({ from: me.id, to: u.id }); notify(u.id, 'follow', me); }
  save(); return { following: i < 0 };
});
R('POST', '/api/profile', async c => {
  const me = need(c);
  if (typeof c.body.bio === 'string') me.bio = c.body.bio.slice(0, 200);
  if (Array.isArray(c.body.favorites)) me.favorites = c.body.favorites.map(String).slice(0, 4);
  save(); return pubUser(me);
});

// lists
async function listCard(l) {
  const gsr = (await Promise.all(l.gameIds.slice(0, 5).map(fetchGame))).filter(Boolean).map(gs);
  return { id: l.id, title: l.title, desc: l.desc, user: db.users.find(u => u.id === l.userId).username, count: l.gameIds.length, covers: gsr };
}
R('GET', '/api/lists', async c => Promise.all(db.lists.filter(l => l.gameIds.length).sort((a, b) => b.updated - a.updated).slice(0, 20).map(listCard)));
R('GET', '/api/lists/:id', async c => {
  const l = db.lists.find(x => x.id === Number(c.p.id)); if (!l) bad('Not found', 404);
  const games = (await Promise.all(l.gameIds.map(fetchGame))).filter(Boolean).map(gs);
  return { id: l.id, title: l.title, desc: l.desc, user: db.users.find(u => u.id === l.userId).username, mine: !!(c.me && c.me.id === l.userId), games };
});
R('POST', '/api/lists', async c => {
  const me = need(c), title = String(c.body.title || '').trim().slice(0, 100); if (!title) bad('Give it a title');
  const l = { id: nid(), userId: me.id, title, desc: String(c.body.desc || '').slice(0, 1000), gameIds: [], updated: Date.now() };
  db.lists.push(l); save(); return { id: l.id };
});
R('POST', '/api/lists/:id/games', async c => {
  const me = need(c), l = db.lists.find(x => x.id === Number(c.p.id) && x.userId === me.id); if (!l) bad('Not found', 404);
  const g = await fetchGame(c.body.gameId); if (!g) bad('Unknown game', 404);
  const i = l.gameIds.indexOf(g.id); if (i >= 0) l.gameIds.splice(i, 1); else l.gameIds.push(g.id);
  l.updated = Date.now(); save(); return { added: i < 0 };
});
R('DELETE', '/api/lists/:id', async c => { const me = need(c); db.lists = db.lists.filter(l => !(l.id === Number(c.p.id) && l.userId === me.id)); save(); return { ok: true }; });
R('GET', '/api/my/lists', async c => { const me = need(c); return db.lists.filter(l => l.userId === me.id).map(l => ({ id: l.id, title: l.title, has: (gid => l.gameIds.includes(gid)), count: l.gameIds.length })).map(l => ({ id: l.id, title: l.title, count: l.count })); });

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const PUB = path.join(__dirname, 'public');
function readBody(req) {
  return new Promise((ok, no) => {
    let s = ''; req.on('data', d => { s += d; if (s.length > 1e6) { req.destroy(); no(new Error('too big')); } });
    req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } });
  });
}
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    for (const [m, re, h] of routes) {
      const mt = m === req.method && re.exec(url.pathname); if (!mt) continue;
      try {
        const c = { req, res, p: mt.groups || {}, q: Object.fromEntries(url.searchParams), body: req.method === 'GET' ? {} : await readBody(req), me: userOf(req) };
        const out = await h(c);
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out === undefined ? null : out));
      } catch (e) {
        res.writeHead(e.code || 500, { 'Content-Type': 'application/json' });
        if (!e.code) console.error(e);
        return res.end(JSON.stringify({ error: e.code ? e.message : 'Server error' }));
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"not found"}');
  }
  let f = path.join(PUB, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`Campfire on http://localhost:${PORT}`));

// ---------- seed: real games from Steam + clearly-marked demo accounts ----------
const SEED_IDS = [1245620, 1145360, 413150, 632470, 367520, 1687950, 1086940, 1091500, 292030, 504230, 1145350, 620, 753640, 1174180, 374320, 814380, 2379780, 391540, 1313140, 1794680, 646570, 1868140, 2050650, 105600, 264710, 1627720, 870780, 1190460, 653530, 1092790, 1888930, 1817070];
const DEMO = ['mara_plays', 'pixel_ghost', 'ember_kid', 'slow_gamer', 'rune_farmer', 'night_cart'];
const BLURB = {
  5: ['A masterpiece. Still thinking about it weeks later.', 'Everything clicks. Rare to see this level of polish.'],
  4: ['Great stuff with a few rough edges.', 'Would happily replay. Pacing drags a little in the middle.'],
  3: ['Solid, but did not stay with me.', 'Fun in parts, forgettable in others.'],
  2: ['Wanted to like it more than I did.', 'Good ideas, uneven execution.'],
};
async function seed() {
  if (db.seeded) return;
  console.log('Seeding games from Steam...');
  for (let i = 0; i < SEED_IDS.length; i += 4) await Promise.all(SEED_IDS.slice(i, i + 4).map(fetchGame));
  const ids = Object.keys(db.games);
  const vibes = ['cozy', 'brutal', 'atmospheric', 'big brain', 'chaotic fun', 'made me cry', 'one more run'];
  let rng = 7; const rnd = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  for (const name of process.env.SEED_DEMO === '0' ? [] : DEMO) {
    if (byName(name)) continue;
    const u = { id: nid(), username: name, demo: true, salt: '', pw: '', bio: 'Demo account', favorites: [], created: today() };
    db.users.push(u);
    ids.filter(() => rnd() < 0.45).forEach(gid => {
      const r = 3 + Math.floor(rnd() * 8), star = Math.ceil(r / 2);
      const rv = rnd() < 0.5 ? BLURB[Math.max(2, Math.min(5, star))][Math.floor(rnd() * 2)] : '';
      const [lab] = ritualOf(gid);
      db.logs.push({ id: nid(), userId: u.id, gameId: gid, rating: r, review: rv, spoiler: false, liked: r >= 8, vibes: [vibes[Math.floor(rnd() * vibes.length)]], date: new Date(Date.now() - rnd() * 90 * 864e5).toISOString().slice(0, 10), ritual: lab === 'Deaths' ? String(Math.floor(rnd() * 400)) : lab === 'Hours played' ? String(Math.floor(5 + rnd() * 80)) : '', likes: [], created: Date.now(), updatedAt: Date.now() - rnd() * 90 * 864e5 });
    });
    u.favorites = db.logs.filter(l => l.userId === u.id && l.rating >= 9).slice(0, 4).map(l => l.gameId);
  }
  db.seeded = true; save(); console.log('Seed done:', ids.length, 'games');
}
seed().then(() => {
  const demos = db.users.filter(u => u.demo);
  if (db.socialSeeded || demos.length < 3) return;
  demos.forEach((a, i) => demos.forEach((b, j) => { if (a !== b && (i + j) % 2 === 0) db.follows.push({ from: a.id, to: b.id }); }));
  db.socialSeeded = true; save();
}).catch(e => console.error('seed failed', e));
