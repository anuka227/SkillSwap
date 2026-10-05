// SkillSwap demo backend (SRS FR-01..FR-15). Сангүй Node.js 18+, өгөгдөл санах ойд.
// Ажиллуулах: node server.js  -> http://localhost:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';
const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const EVENTS = ['session.confirmed', 'session.completed', 'session.cancelled', 'credit.transferred'];

// ---------- Нууц үг (NFR-03: scrypt hash) ----------
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) =>
  ({ salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex') });
const checkPw = (pw, u) => {
  const a = Buffer.from(hashPw(pw, u.salt).hash), b = Buffer.from(u.hash);
  return crypto.timingSafeEqual(a, b);
};

// ---------- Өгөгдөл ----------
const wide = [{ start: '2026-10-01T00:00:00+08:00', end: '2026-12-31T23:59:00+08:00' }];
const mk = (o) => ({ role: 'user', skills: [], availability: wide, balance: 25, frozen: 0, rating_sum: 0,
  rating_count: 0, base_completed: 0, base_reports: 0, reports: [], restricted_until: 0, ...hashPw('your_account_password'), ...o });
const users = {};
[
  mk({ id: 'usr_b82e17', name: 'Оюунцэцэг', email: 'oyuntsetseg@num.edu.mn', phone: '99112233', skills: [] }),
  mk({ id: 'usr_4f2a91', name: 'Бат-Эрдэнэ', email: 'baterdene@num.edu.mn', phone: '99445566', balance: 40,
    skills: [{ name: 'Франц хэл', category: 'Хэл' }, { name: 'Код бичих', category: 'Программчлал' }],
    rating_sum: 96, rating_count: 20, base_completed: 23, base_reports: 1 }),
  mk({ id: 'usr_c1d7e3', name: 'Сарнай', email: 'sarnai@num.edu.mn', phone: '88001122',
    skills: [{ name: 'Код бичих', category: 'Программчлал' }], rating_sum: 45, rating_count: 10, base_completed: 12 }),
  mk({ id: 'usr_d9a042', name: 'Дорж', email: 'dorj@num.edu.mn', phone: '88334455',
    skills: [{ name: 'UI дизайн', category: 'Дизайн' }], rating_sum: 39, rating_count: 10, base_completed: 8,
    availability: [{ start: '2026-10-20T00:00:00+08:00', end: '2026-10-31T23:59:00+08:00' }] }),
  mk({ id: 'usr_adm001', name: 'Тэмүүлэн', email: 'temuulen@num.edu.mn', phone: '77009900', role: 'admin', balance: 0 }),
].forEach((u) => (users[u.id] = u));
const sessions = {}, webhooks = {}, flags = {}, calendar = {}, notes = [], ledger = [], audit = [], messages = {};
let seq = 1;
const rid = (p) => `${p}_${crypto.randomBytes(3).toString('hex')}`;

// ---------- Туслахууд ----------
class HttpError extends Error { constructor(s, c, m) { super(m); this.status = s; this.code = c; } }
const err = (s, c, m) => new HttpError(s, c, m);
const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise((ok, bad) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => { try { ok(raw ? JSON.parse(raw) : {}); } catch { bad(err(400, 'VALIDATION_ERROR', 'JSON буруу байна.')); } });
});
const need = (o, fields) => {
  const miss = fields.filter((f) => o[f] === undefined || o[f] === '' || o[f] === null);
  if (miss.length) throw err(400, 'VALIDATION_ERROR', `Шаардлагатай талбар дутуу байна: ${miss.join(', ')}`);
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const signJwt = (id) => {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
};
const verifyJwt = (t = '') => {
  const [h, p, s] = t.split('.');
  if (!h || !p || !s) return null;
  const e = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  const pl = JSON.parse(Buffer.from(p, 'base64url').toString());
  return pl.exp > Date.now() / 1000 ? pl.sub : null;
};
const authUser = (req) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const id = m && verifyJwt(m[1]);
  if (!id || !users[id]) throw err(401, 'UNAUTHORIZED', 'Нэвтрэх шаардлагатай.');
  return users[id];
};
const adminUser = (req) => {
  const u = authUser(req);
  if (u.role !== 'admin') throw err(403, 'FORBIDDEN', 'Зөвхөн admin хандана.');
  return u;
};
const log = (actor, action, target, detail = '') => audit.push({ at: new Date().toISOString(), actor, action, target, detail });
const led = (type, session_id, from, to, credits) =>
  ledger.push({ id: `led_${seq++}`, type, session_id, from, to, credits, at: new Date().toISOString() });

// ---------- Статистик (FR-03) ----------
const stats = (u) => {
  const done = Object.values(sessions).filter((s) => s.status === 'completed' && (s.teacher_id === u.id || s.learner_id === u.id)).length;
  const completed = u.base_completed + done;
  const reports = u.base_reports + u.reports.length;
  return {
    avg_rating: u.rating_count ? Math.round((u.rating_sum / u.rating_count) * 10) / 10 : null,
    rating_count: u.rating_count, completed_sessions: completed,
    no_show_rate: completed + reports ? Math.round((reports / (completed + reports)) * 100) / 100 : 0,
  };
};
const refresh = (s) => { // FR-07: 24 цагт нэг тал л баталгаажуулбал "unconfirmed"
  const one = s.checkins.teacher !== s.checkins.learner;
  if (s.status === 'confirmed' && one && Date.now() > Date.parse(s.end_time) + DAY) s.status = 'unconfirmed';
  return s;
};
const pub = ({ transferred, ...s }) => refresh(s) && ({ ...s });
const loadSession = (id, me) => {
  const s = sessions[id];
  if (!s || (me && me.role !== 'admin' && ![s.teacher_id, s.learner_id].includes(me.id))) throw err(404, 'NOT_FOUND', 'Session олдсонгүй.');
  return refresh(s);
};

// ---------- Мэдэгдэл, Calendar, Webhook (FR-11, FR-15: симуляци) ----------
function emit(type, s, text) {
  for (const uid of [s.teacher_id, s.learner_id]) {
    notes.push({ id: `ntf_${seq++}`, user_id: uid, kind: type, message: text, send_at: new Date().toISOString() });
    for (const w of Object.values(webhooks)) {
      if (w.owner === uid && w.events.includes(type)) {
        fetch(w.callback_url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: type, session_id: s.session_id }), signal: AbortSignal.timeout(2000) }).catch(() => {});
      }
    }
  }
}
function onConfirmed(s) {
  calendar[s.session_id] = { event_id: rid('evt'), session_id: s.session_id, title: s.skill,
    start_time: s.start_time, end_time: s.end_time, attendees: [s.teacher_id, s.learner_id] };
  for (const [label, ms] of [['24 цагийн', DAY], ['1 цагийн', HOUR]]) {
    for (const uid of [s.teacher_id, s.learner_id]) {
      notes.push({ id: `ntf_${seq++}`, user_id: uid, kind: 'reminder', session_id: s.session_id,
        message: `${s.skill}: session эхлэхээс өмнөх ${label} сануулга`, send_at: new Date(Date.parse(s.start_time) - ms).toISOString() });
    }
  }
  emit('session.confirmed', s, `${s.skill} session баталгаажлаа`);
}

// ---------- Route-ууд ----------
const routes = [];
const route = (method, pattern, fn) => routes.push([method, new RegExp(`^${pattern}$`), fn]);

route('POST', '/auth/register', async (req, res) => { // FR-01
  const b = await readBody(req);
  need(b, ['name', 'phone', 'email', 'password']);
  if (b.password.length < 8) throw err(400, 'VALIDATION_ERROR', 'Нууц үг 8-аас дээш тэмдэгттэй байх ёстой.');
  if (Object.values(users).some((u) => u.email === b.email)) throw err(400, 'VALIDATION_ERROR', 'Энэ имэйл бүртгэлтэй байна.');
  const skills = (b.skills || []).map((s) => ({ name: String(s.name), category: String(s.category || 'Бусад') }));
  const u = mk({ id: rid('usr'), name: b.name, phone: b.phone, email: b.email, skills, ...hashPw(b.password) });
  users[u.id] = u;
  send(res, 201, { user_id: u.id, name: u.name, email: u.email, skills: u.skills });
});

route('POST', '/auth/login', async (req, res) => {
  const b = await readBody(req);
  need(b, ['email', 'password']);
  const u = Object.values(users).find((x) => x.email === b.email);
  if (!u || !checkPw(b.password, u)) throw err(401, 'UNAUTHORIZED', 'Имэйл эсвэл нууц үг буруу байна.');
  send(res, 200, { access_token: signJwt(u.id), token_type: 'Bearer', expires_in: 3600 });
});

route('GET', '/me', async (req, res) => {
  const u = authUser(req);
  send(res, 200, { user_id: u.id, name: u.name, email: u.email, role: u.role, skills: u.skills,
    restricted_until: u.restricted_until > Date.now() ? new Date(u.restricted_until).toISOString() : null });
});

route('GET', '/users/([^/]+)/profile', async (req, res, m) => { // FR-03
  authUser(req);
  const u = users[m[1]];
  if (!u) throw err(404, 'NOT_FOUND', 'Хэрэглэгч олдсонгүй.');
  send(res, 200, { user_id: u.id, name: u.name, skills: u.skills, ...stats(u) });
});

route('GET', '/skills/search', async (req, res, _m, url) => { // FR-02, FR-13
  const me = authUser(req);
  const skill = (url.searchParams.get('skill') || '').toLowerCase();
  const category = url.searchParams.get('category');
  if (!skill && !category) throw err(400, 'VALIDATION_ERROR', 'skill эсвэл category параметр шаардлагатай.');
  const minRating = parseFloat(url.searchParams.get('min_rating') || '0');
  if (Number.isNaN(minRating) || minRating < 0 || minRating > 5) throw err(400, 'VALIDATION_ERROR', 'min_rating 0-5 хооронд байх ёстой.');
  const from = url.searchParams.get('available_from');
  if (from && Number.isNaN(Date.parse(from))) throw err(400, 'VALIDATION_ERROR', 'available_from буруу огноо байна.');
  const results = [];
  for (const u of Object.values(users)) {
    if (u.id === me.id || u.role === 'admin') continue;
    const sk = u.skills.find((x) => (!skill || x.name.toLowerCase().includes(skill)) && (!category || x.category === category));
    const st = stats(u);
    if (!sk || (st.avg_rating ?? 0) < minRating) continue;
    if (from && !u.availability.some((a) => Date.parse(from) >= Date.parse(a.start) && Date.parse(from) <= Date.parse(a.end))) continue;
    results.push({ user_id: u.id, name: u.name, skill: sk.name, category: sk.category, avg_rating: st.avg_rating,
      completed_sessions: st.completed_sessions, no_show_rate: st.no_show_rate });
  }
  results.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));
  send(res, 200, { results });
});

route('GET', '/sessions', async (req, res) => {
  const me = authUser(req);
  const mine = Object.values(sessions).filter((s) => s.teacher_id === me.id || s.learner_id === me.id).map(pub)
    .map((s) => ({ ...s, teacher_name: users[s.teacher_id].name, learner_name: users[s.learner_id].name }))
    .reverse();
  send(res, 200, { sessions: mine });
});

route('POST', '/sessions', async (req, res) => { // FR-04: санал
  const me = authUser(req);
  const b = await readBody(req);
  need(b, ['teacher_id', 'skill', 'start_time', 'end_time', 'credits']);
  if (!Number.isInteger(b.credits) || b.credits < 1) throw err(400, 'VALIDATION_ERROR', 'credits эерэг бүхэл тоо байх ёстой.');
  if (Number.isNaN(Date.parse(b.start_time)) || Number.isNaN(Date.parse(b.end_time)) || Date.parse(b.end_time) <= Date.parse(b.start_time))
    throw err(400, 'VALIDATION_ERROR', 'end_time нь start_time-аас хойш байх ёстой.');
  if (!users[b.teacher_id] || b.teacher_id === me.id) throw err(400, 'VALIDATION_ERROR', 'teacher_id буруу байна.');
  if (me.restricted_until > Date.now()) throw err(403, 'RESTRICTED', `No-show-ын улмаас ${new Date(me.restricted_until).toISOString().slice(0, 10)} хүртэл session захиалах боломжгүй.`);
  if (me.balance < b.credits) throw err(403, 'INSUFFICIENT_CREDITS', 'Credit үлдэгдэл хүрэлцэхгүй байна.');
  const s = { session_id: rid('ses'), teacher_id: b.teacher_id, learner_id: me.id, skill: b.skill, start_time: b.start_time,
    end_time: b.end_time, credits: b.credits, status: 'proposed', proposed_by: me.id, checkins: { teacher: false, learner: false },
    transferred: false, completed_at: null, ratings: {}, flag_id: null };
  sessions[s.session_id] = s;
  send(res, 201, pub(s));
});

route('POST', '/sessions/([^/]+)/respond', async (req, res, m) => { // FR-04: зөвшөөрөх/татгалзах/counter
  const me = authUser(req);
  const s = loadSession(m[1], me);
  const b = await readBody(req);
  need(b, ['action']);
  if (s.status !== 'proposed' || s.proposed_by === me.id) throw err(400, 'INVALID_STATE', 'Та энэ саналд хариулах боломжгүй.');
  if (b.action === 'accept') {
    if (users[s.learner_id].balance < s.credits) throw err(403, 'INSUFFICIENT_CREDITS', 'Суралцагчийн credit хүрэлцэхгүй байна.');
    s.status = 'confirmed';
    onConfirmed(s);
  } else if (b.action === 'decline') {
    s.status = 'cancelled';
  } else if (b.action === 'counter') {
    if (b.credits !== undefined && (!Number.isInteger(b.credits) || b.credits < 1)) throw err(400, 'VALIDATION_ERROR', 'credits буруу байна.');
    Object.assign(s, { credits: b.credits ?? s.credits, start_time: b.start_time ?? s.start_time, end_time: b.end_time ?? s.end_time, proposed_by: me.id });
    if (Date.parse(s.end_time) <= Date.parse(s.start_time)) throw err(400, 'VALIDATION_ERROR', 'end_time нь start_time-аас хойш байх ёстой.');
  } else throw err(400, 'VALIDATION_ERROR', 'action нь accept, decline, counter-ийн нэг байх ёстой.');
  send(res, 200, pub(s));
});

route('POST', '/sessions/([^/]+)/cancel', async (req, res, m) => { // FR-15: цуцлахад Calendar event устна
  const me = authUser(req);
  const s = loadSession(m[1], me);
  if (!['proposed', 'confirmed'].includes(s.status)) throw err(400, 'INVALID_STATE', 'Энэ session-ыг цуцлах боломжгүй.');
  s.status = 'cancelled';
  delete calendar[s.session_id];
  emit('session.cancelled', s, `${s.skill} session цуцлагдлаа`);
  send(res, 200, pub(s));
});

route('POST', '/sessions/([^/]+)/check-in', async (req, res, m) => { // FR-06, FR-07
  const me = authUser(req);
  const s = loadSession(m[1], me);
  const b = await readBody(req);
  need(b, ['role']);
  if (!['teacher', 'learner'].includes(b.role)) throw err(400, 'VALIDATION_ERROR', 'role нь teacher эсвэл learner байх ёстой.');
  if (s[`${b.role}_id`] !== me.id) throw err(400, 'VALIDATION_ERROR', 'Энэ role-д та оролцогч биш байна.');
  if (s.status !== 'confirmed') throw err(400, 'INVALID_STATE', 'Зөвхөн зөвшөөрөгдсөн (confirmed) session-д check-in хийнэ.');
  s.checkins[b.role] = true;
  if (s.checkins.teacher && s.checkins.learner && !s.transferred) { // NFR-05: нэг л удаа шилжүүлнэ
    const L = users[s.learner_id], T = users[s.teacher_id];
    if (L.balance < s.credits) { s.checkins[b.role] = false; throw err(409, 'INSUFFICIENT_CREDITS', 'Суралцагчийн credit хүрэлцэхгүй байна.'); }
    L.balance -= s.credits; T.balance += s.credits;
    s.transferred = true; s.status = 'completed'; s.completed_at = new Date().toISOString();
    led('transfer', s.session_id, L.id, T.id, s.credits);
    log('system', 'credit.transfer', s.session_id, `${s.credits} credit`);
    emit('session.completed', s, `${s.skill} session дууслаа`);
    emit('credit.transferred', s, `${s.credits} credit шилжлээ`);
  }
  send(res, 200, pub(s));
});

route('POST', '/sessions/([^/]+)/no-show', async (req, res, m) => { // FR-10
  const me = authUser(req);
  const s = loadSession(m[1], me);
  const b = await readBody(req);
  need(b, ['absent_user_id']);
  if (![s.teacher_id, s.learner_id].includes(b.absent_user_id) || b.absent_user_id === me.id) throw err(400, 'VALIDATION_ERROR', 'absent_user_id буруу байна.');
  if (s.status !== 'confirmed') throw err(400, 'INVALID_STATE', 'Зөвхөн зөвшөөрөгдсөн session дээр no-show мэдээлнэ.');
  if (Date.now() < Date.parse(s.start_time)) throw err(400, 'NO_SHOW_TOO_EARLY', 'Session эхлээгүй байна.');
  if (Date.now() > Date.parse(s.end_time) + HOUR) throw err(400, 'NO_SHOW_WINDOW_CLOSED', 'No-show мэдээлэх 1 цагийн хугацаа дууссан.');
  s.status = 'no_show_reported';
  const absent = users[b.absent_user_id];
  absent.reports.push(Date.now());
  const recent = absent.reports.filter((t) => t > Date.now() - 30 * DAY).length;
  if (recent >= 3) absent.restricted_until = Date.now() + 7 * DAY;
  log(me.id, 'no_show.report', s.session_id, `${absent.id}; ${b.comment || ''}`);
  send(res, 200, { session_id: s.session_id, status: s.status, absent_user_restricted: recent >= 3 });
});

route('POST', '/sessions/([^/]+)/rate', async (req, res, m) => { // FR-08
  const me = authUser(req);
  const s = loadSession(m[1], me);
  const b = await readBody(req);
  need(b, ['stars']);
  if (!Number.isInteger(b.stars) || b.stars < 1 || b.stars > 5) throw err(400, 'VALIDATION_ERROR', 'stars 1-5 бүхэл тоо байх ёстой.');
  if (s.status !== 'completed') throw err(400, 'INVALID_STATE', 'Зөвхөн дууссан session-ыг үнэлнэ.');
  if (s.ratings[me.id]) throw err(400, 'ALREADY_RATED', 'Та энэ session-ыг аль хэдийн үнэлсэн.');
  const other = users[me.id === s.teacher_id ? s.learner_id : s.teacher_id];
  other.rating_sum += b.stars; other.rating_count += 1;
  s.ratings[me.id] = { stars: b.stars, comment: b.comment || '' };
  send(res, 200, { session_id: s.session_id, rated_user: other.id, stars: b.stars });
});

route('GET', '/sessions/([^/]+)/messages', async (req, res, m) => { // FR-09
  const me = authUser(req);
  loadSession(m[1], me);
  send(res, 200, { messages: messages[m[1]] || [] });
});
route('POST', '/sessions/([^/]+)/messages', async (req, res, m) => {
  const me = authUser(req);
  loadSession(m[1], me);
  const b = await readBody(req);
  need(b, ['text']);
  const msg = { from: me.id, from_name: me.name, text: String(b.text).slice(0, 500), at: new Date().toISOString() };
  (messages[m[1]] ||= []).push(msg);
  send(res, 201, msg);
});

route('POST', '/sessions/([^/]+)/flag', async (req, res, m) => { // FR-12
  const me = authUser(req);
  const s = loadSession(m[1], me);
  const b = await readBody(req);
  need(b, ['reason']);
  if (s.status !== 'completed') throw err(400, 'INVALID_STATE', 'Зөвхөн дууссан session-ы credit-ийг flag хийнэ.');
  if (Date.now() > Date.parse(s.completed_at) + 72 * HOUR) throw err(400, 'FLAG_WINDOW_CLOSED', 'Flag хийх 72 цагийн хугацаа дууссан.');
  if (s.flag_id) throw err(400, 'ALREADY_FLAGGED', 'Энэ session аль хэдийн flag хийгдсэн.');
  const f = { id: rid('flg'), session_id: s.session_id, raised_by: me.id, reason: b.reason, status: 'open', credits: s.credits };
  flags[f.id] = f; s.flag_id = f.id;
  users[s.teacher_id].balance -= s.credits; users[s.teacher_id].frozen += s.credits; // царцаалт
  led('freeze', s.session_id, s.teacher_id, null, s.credits);
  log(me.id, 'flag.create', s.session_id, b.reason);
  send(res, 201, f);
});

route('GET', '/credits/balance', async (req, res) => { // FR-05
  const me = authUser(req);
  send(res, 200, { balance: me.balance, frozen: me.frozen });
});
route('GET', '/credits/ledger', async (req, res) => {
  const me = authUser(req);
  const mine = ledger.filter((l) => l.from === me.id || l.to === me.id).reverse();
  send(res, 200, { entries: mine });
});

route('GET', '/notifications', async (req, res) => { // FR-11 (симуляци)
  const me = authUser(req);
  const items = notes.filter((n) => n.user_id === me.id)
    .map((n) => ({ ...n, state: Date.parse(n.send_at) <= Date.now() ? 'sent' : 'scheduled' }))
    .sort((a, b) => Date.parse(a.send_at) - Date.parse(b.send_at));
  const events = Object.values(calendar).filter((e) => e.attendees.includes(me.id)); // FR-15 (симуляци)
  send(res, 200, { notifications: items, calendar_events: events });
});

route('POST', '/webhooks/subscribe', async (req, res) => {
  const me = authUser(req);
  const b = await readBody(req);
  need(b, ['callback_url', 'events']);
  let ok = false;
  try { ok = new URL(b.callback_url).protocol === 'https:'; } catch { /* ok=false */ }
  if (!ok) throw err(400, 'VALIDATION_ERROR', 'callback_url нь зөв HTTPS URL байх ёстой.');
  if (!Array.isArray(b.events) || !b.events.length || !b.events.every((e) => EVENTS.includes(e)))
    throw err(400, 'VALIDATION_ERROR', `events нь дараахаас байна: ${EVENTS.join(', ')}`);
  const w = { webhook_id: rid('whk'), callback_url: b.callback_url, events: b.events };
  webhooks[w.webhook_id] = { ...w, owner: me.id };
  send(res, 201, w);
});

route('GET', '/admin/dashboard', async (req, res) => { // FR-14
  adminUser(req);
  const name = (id) => users[id].name;
  send(res, 200, {
    flags: Object.values(flags).filter((f) => f.status === 'open').map((f) => ({ ...f, raised_by_name: name(f.raised_by) })),
    no_shows: Object.values(sessions).filter((s) => s.status === 'no_show_reported')
      .map((s) => ({ session_id: s.session_id, teacher: name(s.teacher_id), learner: name(s.learner_id), skill: s.skill })),
    frozen: Object.values(flags).filter((f) => f.status === 'open').map((f) => ({ session_id: f.session_id, credits: f.credits })),
  });
});
route('POST', '/admin/flags/([^/]+)/resolve', async (req, res, m) => {
  const admin = adminUser(req);
  const f = flags[m[1]];
  if (!f || f.status !== 'open') throw err(404, 'NOT_FOUND', 'Нээлттэй flag олдсонгүй.');
  const b = await readBody(req);
  if (!['approve', 'reject'].includes(b.decision)) throw err(400, 'VALIDATION_ERROR', 'decision нь approve эсвэл reject байх ёстой.');
  const s = sessions[f.session_id], T = users[s.teacher_id], L = users[s.learner_id];
  T.frozen -= f.credits;
  if (b.decision === 'approve') { L.balance += f.credits; led('refund', s.session_id, T.id, L.id, f.credits); } // flag үндэслэлтэй: буцаана
  else { T.balance += f.credits; led('release', s.session_id, null, T.id, f.credits); } // татгалзсан: заагчид чөлөөлнө
  f.status = b.decision === 'approve' ? 'upheld' : 'rejected';
  log(admin.id, `flag.${f.status}`, f.session_id, b.note || '');
  send(res, 200, f);
});
route('GET', '/admin/audit-log', async (req, res) => { adminUser(req); send(res, 200, { entries: [...audit].reverse() }); });

route('GET', '/', async (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    for (const [method, re, fn] of routes) {
      const m = re.exec(url.pathname);
      if (m && req.method === method) return await fn(req, res, m, url);
    }
    throw err(404, 'NOT_FOUND', 'Endpoint олдсонгүй.');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { code: e.code, message: e.message });
    console.error(e);
    send(res, 500, { code: 'INTERNAL_ERROR', message: 'Түр хугацаанд алдаа гарлаа. Дахин оролдоно уу.' });
  }
});
server.listen(PORT, () => console.log(`SkillSwap: http://localhost:${PORT}`));
