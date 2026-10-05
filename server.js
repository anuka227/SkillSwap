// SkillSwap demo backend: docs/openapi/openapi.yaml-ийн 7 endpoint-ыг хэрэгжүүлнэ.
// Сангүй (zero-dependency) Node.js 18+. Өгөгдөл санах ойд хадгалагдана.
// Ажиллуулах: node server.js   (PORT=3000 по умолчанию)
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';

// ---- Seed өгөгдөл ----
const users = {
  usr_b82e17: { id: 'usr_b82e17', name: 'Оюунцэцэг', email: 'oyuntsetseg@num.edu.mn',
    password: 'your_account_password', balance: 25, frozen: 5 },
  usr_4f2a91: { id: 'usr_4f2a91', name: 'Бат-Эрдэнэ', email: 'baterdene@num.edu.mn',
    password: 'your_account_password', balance: 40, frozen: 0,
    skill: 'Франц хэл', avg_rating: 4.8, completed_sessions: 23, no_show_rate: 0.04 },
};
const sessions = {};
const webhooks = {};
const EVENTS = ['session.confirmed', 'session.completed', 'session.cancelled', 'credit.transferred'];

// ---- JWT (HS256) ----
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signJwt(userId) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
}
function verifyJwt(token) {
  const [h, p, s] = (token || '').split('.');
  if (!h || !p || !s) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  if (s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  return payload.exp > Date.now() / 1000 ? payload.sub : null;
}

// ---- Туслахууд ----
class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const send = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (!raw) return resolve({});
    try { resolve(JSON.parse(raw)); }
    catch { reject(new HttpError(400, 'VALIDATION_ERROR', 'JSON буруу байна.')); }
  });
});
const requireFields = (obj, fields) => {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === '');
  if (missing.length) throw new HttpError(400, 'VALIDATION_ERROR', `Шаардлагатай талбар дутуу байна: ${missing.join(', ')}`);
};
function authUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const id = m && verifyJwt(m[1]);
  if (!id || !users[id]) throw new HttpError(401, 'UNAUTHORIZED', 'Нэвтрэх шаардлагатай.');
  return users[id];
}
const loadSession = (id) => {
  if (!sessions[id]) throw new HttpError(404, 'NOT_FOUND', 'Session олдсонгүй.');
  return sessions[id];
};
const publicSession = ({ checked_in, transferred, ...s }) => s;

// ---- Route handlers ----
const routes = [
  ['POST', /^\/auth\/login$/, async (req, res) => {
    const b = await readBody(req);
    requireFields(b, ['email', 'password']);
    const u = Object.values(users).find((x) => x.email === b.email && x.password === b.password);
    if (!u) throw new HttpError(401, 'UNAUTHORIZED', 'Имэйл эсвэл нууц үг буруу байна.');
    send(res, 200, { access_token: signJwt(u.id), token_type: 'Bearer', expires_in: 3600 });
  }],

  ['GET', /^\/skills\/search$/, async (req, res, _m, url) => {
    authUser(req);
    const skill = url.searchParams.get('skill');
    if (!skill) throw new HttpError(400, 'VALIDATION_ERROR', 'skill параметр шаардлагатай.');
    const minRating = parseFloat(url.searchParams.get('min_rating') || '0');
    if (Number.isNaN(minRating) || minRating < 0 || minRating > 5)
      throw new HttpError(400, 'VALIDATION_ERROR', 'min_rating 1-5 хооронд байх ёстой.');
    const results = Object.values(users)
      .filter((u) => u.skill && u.skill.toLowerCase().includes(skill.toLowerCase()) && u.avg_rating >= minRating)
      .sort((a, b) => b.avg_rating - a.avg_rating)
      .map((u) => ({ user_id: u.id, name: u.name, skill: u.skill, avg_rating: u.avg_rating,
        completed_sessions: u.completed_sessions, no_show_rate: u.no_show_rate }));
    send(res, 200, { results });
  }],

  ['POST', /^\/sessions$/, async (req, res) => {
    const me = authUser(req);
    const b = await readBody(req);
    requireFields(b, ['teacher_id', 'skill', 'start_time', 'end_time', 'credits']);
    if (!Number.isInteger(b.credits) || b.credits < 1) throw new HttpError(400, 'VALIDATION_ERROR', 'credits эерэг бүхэл тоо байх ёстой.');
    if (Number.isNaN(Date.parse(b.start_time)) || Number.isNaN(Date.parse(b.end_time)) || Date.parse(b.end_time) <= Date.parse(b.start_time))
      throw new HttpError(400, 'VALIDATION_ERROR', 'Цаг буруу байна (end_time нь start_time-аас хойш байх ёстой).');
    if (!users[b.teacher_id] || b.teacher_id === me.id) throw new HttpError(400, 'VALIDATION_ERROR', 'teacher_id буруу байна.');
    if (me.balance < b.credits) throw new HttpError(403, 'INSUFFICIENT_CREDITS', 'Credit үлдэгдэл хүрэлцэхгүй байна.');
    const id = `ses_${crypto.randomBytes(3).toString('hex')}`;
    sessions[id] = { session_id: id, teacher_id: b.teacher_id, learner_id: me.id, skill: b.skill,
      start_time: b.start_time, end_time: b.end_time, credits: b.credits, status: 'proposed',
      checked_in: {}, transferred: false };
    send(res, 201, publicSession(sessions[id]));
  }],

  ['POST', /^\/sessions\/([^/]+)\/check-in$/, async (req, res, m) => {
    const me = authUser(req);
    const s = loadSession(m[1]);
    const b = await readBody(req);
    requireFields(b, ['role']);
    if (!['teacher', 'learner'].includes(b.role)) throw new HttpError(400, 'VALIDATION_ERROR', 'role нь teacher эсвэл learner байх ёстой.');
    if (s[`${b.role}_id`] !== me.id) throw new HttpError(400, 'VALIDATION_ERROR', 'Энэ role-д та оролцогч биш байна.');
    s.checked_in[b.role] = true;
    s.status = s.checked_in.teacher && s.checked_in.learner ? 'completed' : 'confirmed';
    if (s.status === 'completed' && !s.transferred) { // idempotent: зөвхөн нэг удаа шилжүүлнэ (NFR-05)
      users[s.learner_id].balance -= s.credits;
      users[s.teacher_id].balance += s.credits;
      s.transferred = true;
    }
    send(res, 200, publicSession(s));
  }],

  ['POST', /^\/sessions\/([^/]+)\/no-show$/, async (req, res, m) => {
    const me = authUser(req);
    const s = loadSession(m[1]);
    const b = await readBody(req);
    requireFields(b, ['absent_user_id']);
    if (![s.teacher_id, s.learner_id].includes(me.id)) throw new HttpError(404, 'NOT_FOUND', 'Session олдсонгүй.');
    if (![s.teacher_id, s.learner_id].includes(b.absent_user_id) || b.absent_user_id === me.id)
      throw new HttpError(400, 'VALIDATION_ERROR', 'absent_user_id буруу байна.');
    if (Date.now() > Date.parse(s.end_time) + 3600 * 1000)
      throw new HttpError(400, 'NO_SHOW_WINDOW_CLOSED', 'No-show мэдээлэх 1 цагийн хугацаа дууссан.');
    s.status = 'no_show_reported';
    send(res, 200, { session_id: s.session_id, status: s.status });
  }],

  ['GET', /^\/credits\/balance$/, async (req, res) => {
    const me = authUser(req);
    send(res, 200, { balance: me.balance, frozen: me.frozen });
  }],

  ['POST', /^\/webhooks\/subscribe$/, async (req, res) => {
    authUser(req);
    const b = await readBody(req);
    requireFields(b, ['callback_url', 'events']);
    let ok = false;
    try { ok = new URL(b.callback_url).protocol === 'https:'; } catch { /* ok=false */ }
    if (!ok) throw new HttpError(400, 'VALIDATION_ERROR', 'callback_url нь зөв HTTPS URL байх ёстой.');
    if (!Array.isArray(b.events) || !b.events.length || !b.events.every((e) => EVENTS.includes(e)))
      throw new HttpError(400, 'VALIDATION_ERROR', `events нь дараахаас байна: ${EVENTS.join(', ')}`);
    const id = `whk_${crypto.randomBytes(3).toString('hex')}`;
    webhooks[id] = { webhook_id: id, callback_url: b.callback_url, events: b.events };
    send(res, 201, webhooks[id]);
  }],
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    for (const [method, pattern, handler] of routes) {
      const m = pattern.exec(url.pathname);
      if (m && req.method === method) return await handler(req, res, m, url);
    }
    throw new HttpError(404, 'NOT_FOUND', 'Endpoint олдсонгүй.');
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { code: err.code, message: err.message });
    console.error(err);
    send(res, 500, { code: 'INTERNAL_ERROR', message: 'Түр хугацаанд алдаа гарлаа. Дахин оролдоно уу.' });
  }
});
server.listen(PORT, () => console.log(`SkillSwap API: http://localhost:${PORT}`));
