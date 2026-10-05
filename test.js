// Урсгалын тест: node server.js асаасны дараа `node test.js`
const B = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };
const call = async (method, p, token, body) => {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const login = async (email) => (await call('POST', '/auth/login', null, { email, password: 'your_account_password' })).body.access_token;
const now = Date.now(), iso = (ms) => new Date(ms).toISOString();

(async () => {
  const L = await login('oyuntsetseg@num.edu.mn'), T = await login('baterdene@num.edu.mn'), A = await login('temuulen@num.edu.mn');
  const reg = await call('POST', '/auth/register', null, { name: 'Шинэ', phone: '99000000', email: 'new@num.edu.mn', password: 'longpassword', skills: [{ name: 'Гитар', category: 'Хөгжим' }] });
  ok('FR-01 бүртгэл 201', reg.status === 201);
  ok('FR-01 нууц үг богино бол 400', (await call('POST', '/auth/register', null, { name: 'x', phone: '1', email: 'q@q.mn', password: '123' })).status === 400);
  ok('NFR-03 нууц үг хариунд гарахгүй', !JSON.stringify(reg.body).includes('longpassword'));

  const s1 = await call('GET', '/skills/search?skill=' + encodeURIComponent('Код'), L);
  ok('FR-02 үнэлгээгээр эрэмбэ (4.8 эхэнд)', s1.body.results[0].user_id === 'usr_4f2a91' && s1.body.results[1].user_id === 'usr_c1d7e3');
  const s2 = await call('GET', '/skills/search?category=' + encodeURIComponent('Дизайн') + '&min_rating=3&available_from=2026-10-25T10:00:00%2B08:00', L);
  ok('FR-13 ангилал+үнэлгээ+цаг шүүлт', s2.body.results.length === 1 && s2.body.results[0].user_id === 'usr_d9a042');
  const s3 = await call('GET', '/skills/search?category=' + encodeURIComponent('Дизайн') + '&available_from=2026-10-10T10:00:00%2B08:00', L);
  ok('FR-13 боломжгүй цагт хоосон', s3.body.results.length === 0);
  const pr = await call('GET', '/users/usr_4f2a91/profile', L);
  ok('FR-03 профайл статистик', pr.body.avg_rating === 4.8 && pr.body.completed_sessions === 23 && pr.body.no_show_rate === 0.04);

  const prop = await call('POST', '/sessions', L, { teacher_id: 'usr_4f2a91', skill: 'Франц хэл', start_time: iso(now - 600000), end_time: iso(now + 3000000), credits: 5 });
  const sid = prop.body.session_id;
  ok('FR-04 санал 201', prop.status === 201 && prop.body.status === 'proposed');
  ok('FR-07 confirmed биш үед check-in 400', (await call('POST', `/sessions/${sid}/check-in`, L, { role: 'learner' })).status === 400);
  ok('FR-04 санал гаргагч өөрөө хариулж болохгүй', (await call('POST', `/sessions/${sid}/respond`, L, { action: 'accept' })).status === 400);
  const ctr = await call('POST', `/sessions/${sid}/respond`, T, { action: 'counter', credits: 4 });
  ok('FR-04 counter (4 credit, proposed_by=заагч)', ctr.body.credits === 4 && ctr.body.proposed_by === 'usr_4f2a91');
  const acc = await call('POST', `/sessions/${sid}/respond`, L, { action: 'accept' });
  ok('FR-04 accept -> confirmed', acc.body.status === 'confirmed');
  const nt = await call('GET', '/notifications', L);
  ok('FR-11 24ц/1ц сануулга төлөвлөгдсөн', nt.body.notifications.filter((n) => n.kind === 'reminder').length === 2);
  ok('FR-15 Calendar event үүссэн', nt.body.calendar_events.length === 1);

  ok('FR-09 мессеж илгээх', (await call('POST', `/sessions/${sid}/messages`, L, { text: 'Сайн уу' })).status === 201);
  ok('FR-09 гуравдагч этгээд уншихгүй', (await call('GET', `/sessions/${sid}/messages`, await login('dorj@num.edu.mn'))).status === 404);

  const c1 = await call('POST', `/sessions/${sid}/check-in`, L, { role: 'learner' });
  ok('FR-07 нэг тал check-in -> confirmed хэвээр', c1.body.status === 'confirmed');
  await call('POST', `/sessions/${sid}/check-in`, T, { role: 'teacher' });
  await call('POST', `/sessions/${sid}/check-in`, T, { role: 'teacher' });
  const bl = (await call('GET', '/credits/balance', L)).body.balance, bt = (await call('GET', '/credits/balance', T)).body.balance;
  ok('FR-06/NFR-05 нэг удаа л шилжсэн (25->21, 40->44)', bl === 21 && bt === 44, `${bl}/${bt}`);

  ok('FR-08 үнэлгээ 1-5 хязгаар', (await call('POST', `/sessions/${sid}/rate`, L, { stars: 9 })).status === 400);
  ok('FR-08 үнэлгээ өгөх', (await call('POST', `/sessions/${sid}/rate`, L, { stars: 5, comment: 'Маш сайн' })).status === 200);
  ok('FR-08 давхар үнэлэхгүй', (await call('POST', `/sessions/${sid}/rate`, L, { stars: 5 })).status === 400);

  const fl = await call('POST', `/sessions/${sid}/flag`, L, { reason: 'Credit буруу тооцсон' });
  ok('FR-12 flag -> заагчийн 4 credit царцсан', fl.status === 201 && (await call('GET', '/credits/balance', T)).body.frozen === 4);
  ok('FR-14 admin биш хэрэглэгчид 403', (await call('GET', '/admin/dashboard', L)).status === 403);
  const dash = await call('GET', '/admin/dashboard', A);
  ok('FR-14 dashboard-д flag харагдана', dash.body.flags.length === 1 && dash.body.frozen.length === 1);
  await call('POST', `/admin/flags/${fl.body.id}/resolve`, A, { decision: 'approve', note: 'Үндэслэлтэй' });
  ok('FR-12 approve -> суралцагчид буцсан (25), заагч 40', (await call('GET', '/credits/balance', L)).body.balance === 25 && (await call('GET', '/credits/balance', T)).body.balance === 40);
  const au = await call('GET', '/admin/audit-log', A);
  ok('FR-14 audit log үүссэн', au.body.entries.some((e) => e.action === 'flag.upheld') && au.body.entries.some((e) => e.action === 'flag.create'));

  // FR-10: 3 no-show -> 7 хоногийн хязгаарлалт
  for (let i = 0; i < 3; i++) {
    const p = await call('POST', '/sessions', T, { teacher_id: 'usr_c1d7e3', skill: 'Код бичих', start_time: iso(now - 600000), end_time: iso(now + 600000), credits: 1 });
    await call('POST', `/sessions/${p.body.session_id}/respond`, await login('sarnai@num.edu.mn'), { action: 'accept' });
    const r = await call('POST', `/sessions/${p.body.session_id}/no-show`, await login('sarnai@num.edu.mn'), { absent_user_id: 'usr_4f2a91' });
    ok(`FR-10 no-show #${i + 1} 200`, r.status === 200);
  }
  const blocked = await call('POST', '/sessions', T, { teacher_id: 'usr_c1d7e3', skill: 'x', start_time: iso(now), end_time: iso(now + 3600000), credits: 1 });
  ok('FR-10 3 удаа -> 403 RESTRICTED', blocked.status === 403 && blocked.body.code === 'RESTRICTED');
  const fut = await call('POST', '/sessions', L, { teacher_id: 'usr_c1d7e3', skill: 'Код бичих', start_time: iso(now + 86400000), end_time: iso(now + 90000000), credits: 1 });
  await call('POST', `/sessions/${fut.body.session_id}/respond`, await login('sarnai@num.edu.mn'), { action: 'accept' });
  ok('FR-10 эхлээгүй session дээр no-show 400', (await call('POST', `/sessions/${fut.body.session_id}/no-show`, L, { absent_user_id: 'usr_c1d7e3' })).body.code === 'NO_SHOW_TOO_EARLY');
  await call('POST', `/sessions/${fut.body.session_id}/cancel`, L, {});
  const ev = (await call('GET', '/notifications', L)).body.calendar_events;
  ok('FR-15 цуцлахад тухайн session-ы Calendar event устсан', !ev.some((e) => e.session_id === fut.body.session_id));

  ok('Webhook бүртгэл 201', (await call('POST', '/webhooks/subscribe', L, { callback_url: 'https://your-app.example.mn/h', events: ['session.completed'] })).status === 201);
  ok('Token-гүй 401', (await call('GET', '/credits/balance')).status === 401);
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
