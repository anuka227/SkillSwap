// SkillSwap demo backend (SRS FR-01..FR-15)
// Сангүй Node.js 18+
// Ажиллуулах: node server.js
// Local: http://localhost:3000

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const EVENTS = [
  'session.confirmed',
  'session.completed',
  'session.cancelled',
  'credit.transferred'
];

// ---------- Нууц үг (NFR-03: scrypt hash) ----------

const hashPw = (
  pw,
  salt = crypto.randomBytes(16).toString('hex')
) => ({
  salt,
  hash: crypto.scryptSync(pw, salt, 32).toString('hex')
});

const checkPw = (pw, u) => {
  const a = Buffer.from(hashPw(pw, u.salt).hash);
  const b = Buffer.from(u.hash);

  return crypto.timingSafeEqual(a, b);
};

// ---------- Өгөгдөл ----------

const wide = [
  {
    start: '2026-10-01T00:00:00+08:00',
    end: '2026-12-31T23:59:00+08:00'
  }
];

const mk = (o) => ({
  role: 'user',
  skills: [],
  availability: wide,
  balance: 25,
  frozen: 0,
  rating_sum: 0,
  rating_count: 0,
  base_completed: 0,
  base_reports: 0,
  reports: [],
  restricted_until: 0,
  ...hashPw('your_account_password'),
  ...o
});

const users = {};

[
  mk({
    id: 'usr_b82e17',
    name: 'Оюунцэцэг',
    email: 'oyuntsetseg@num.edu.mn',
    phone: '99112233',
    skills: []
  }),

  mk({
    id: 'usr_4f2a91',
    name: 'Бат-Эрдэнэ',
    email: 'baterdene@num.edu.mn',
    phone: '99445566',
    balance: 40,
    skills: [
      {
        name: 'Франц хэл',
        category: 'Хэл'
      },
      {
        name: 'Код бичих',
        category: 'Программчлал'
      }
    ],
    rating_sum: 96,
    rating_count: 20,
    base_completed: 23,
    base_reports: 1
  }),

  mk({
    id: 'usr_c1d7e3',
    name: 'Сарнай',
    email: 'sarnai@num.edu.mn',
    phone: '88001122',
    skills: [
      {
        name: 'Код бичих',
        category: 'Программчлал'
      }
    ],
    rating_sum: 45,
    rating_count: 10,
    base_completed: 12
  }),

  mk({
    id: 'usr_d9a042',
    name: 'Дорж',
    email: 'dorj@num.edu.mn',
    phone: '88334455',
    skills: [
      {
        name: 'UI дизайн',
        category: 'Дизайн'
      }
    ],
    rating_sum: 39,
    rating_count: 10,
    base_completed: 8,
    availability: [
      {
        start: '2026-10-20T00:00:00+08:00',
        end: '2026-10-31T23:59:00+08:00'
      }
    ]
  }),

  mk({
    id: 'usr_adm001',
    name: 'Тэмүүлэн',
    email: 'temuulen@num.edu.mn',
    phone: '77009900',
    role: 'admin',
    balance: 0
  })
].forEach((u) => {
  users[u.id] = u;
});

const sessions = {};
const webhooks = {};
const flags = {};
const calendar = {};
const notes = [];
const ledger = [];
const audit = [];
const messages = {};

let seq = 1;

const rid = (p) =>
  `${p}_${crypto.randomBytes(3).toString('hex')}`;

// ---------- Туслахууд ----------

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const err = (status, code, message) =>
  new HttpError(status, code, message);

const send = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });

  res.end(JSON.stringify(data));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(
          err(
            400,
            'VALIDATION_ERROR',
            'JSON буруу байна.'
          )
        );
      }
    });
  });

const need = (obj, fields) => {
  const missing = fields.filter(
    (field) =>
      obj[field] === undefined ||
      obj[field] === '' ||
      obj[field] === null
  );

  if (missing.length) {
    throw err(
      400,
      'VALIDATION_ERROR',
      `Шаардлагатай талбар дутуу байна: ${missing.join(', ')}`
    );
  }
};

// ---------- JWT ----------

const b64 = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');

const signJwt = (id) => {
  const body =
    `${b64({ alg: 'HS256', typ: 'JWT' })}.` +
    `${b64({
      sub: id,
      exp: Math.floor(Date.now() / 1000) + 3600
    })}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(body)
    .digest('base64url');

  return `${body}.${signature}`;
};

const verifyJwt = (token = '') => {
  const [header, payload, signature] = token.split('.');

  if (!header || !payload || !signature) {
    return null;
  }

  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    )
  ) {
    return null;
  }

  const data = JSON.parse(
    Buffer.from(payload, 'base64url').toString()
  );

  return data.exp > Date.now() / 1000
    ? data.sub
    : null;
};

const authUser = (req) => {
  const match = /^Bearer (.+)$/.exec(
    req.headers.authorization || ''
  );

  const id = match && verifyJwt(match[1]);

  if (!id || !users[id]) {
    throw err(
      401,
      'UNAUTHORIZED',
      'Нэвтрэх шаардлагатай.'
    );
  }

  return users[id];
};

const adminUser = (req) => {
  const user = authUser(req);

  if (user.role !== 'admin') {
    throw err(
      403,
      'FORBIDDEN',
      'Зөвхөн admin хандана.'
    );
  }

  return user;
};

const log = (
  actor,
  action,
  target,
  detail = ''
) => {
  audit.push({
    at: new Date().toISOString(),
    actor,
    action,
    target,
    detail
  });
};

const led = (
  type,
  session_id,
  from,
  to,
  credits
) => {
  ledger.push({
    id: `led_${seq++}`,
    type,
    session_id,
    from,
    to,
    credits,
    at: new Date().toISOString()
  });
};

// ---------- Статистик ----------

const stats = (u) => {
  const done = Object.values(sessions)
    .filter(
      (s) =>
        s.status === 'completed' &&
        (s.teacher_id === u.id ||
          s.learner_id === u.id)
    ).length;

  const completed =
    u.base_completed + done;

  const reports =
    u.base_reports + u.reports.length;

  return {
    avg_rating: u.rating_count
      ? Math.round(
          (u.rating_sum / u.rating_count) * 10
        ) / 10
      : null,

    rating_count: u.rating_count,

    completed_sessions: completed,

    no_show_rate:
      completed + reports
        ? Math.round(
            (reports / (completed + reports)) * 100
          ) / 100
        : 0
  };
};

const refresh = (s) => {
  const one =
    s.checkins.teacher !==
    s.checkins.learner;

  if (
    s.status === 'confirmed' &&
    one &&
    Date.now() >
      Date.parse(s.end_time) + DAY
  ) {
    s.status = 'unconfirmed';
  }

  return s;
};

const pub = ({ transferred, ...s }) =>
  refresh(s) && { ...s };

const loadSession = (id, me) => {
  const session = sessions[id];

  if (
    !session ||
    (
      me &&
      me.role !== 'admin' &&
      ![
        session.teacher_id,
        session.learner_id
      ].includes(me.id)
    )
  ) {
    throw err(
      404,
      'NOT_FOUND',
      'Session олдсонгүй.'
    );
  }

  return refresh(session);
};

// ---------- Notification / Calendar / Webhook ----------

function emit(type, session, text) {
  for (const userId of [
    session.teacher_id,
    session.learner_id
  ]) {
    notes.push({
      id: `ntf_${seq++}`,
      user_id: userId,
      kind: type,
      message: text,
      send_at: new Date().toISOString()
    });

    for (const webhook of Object.values(webhooks)) {
      if (
        webhook.owner === userId &&
        webhook.events.includes(type)
      ) {
        fetch(
          webhook.callback_url,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              event: type,
              session_id:
                session.session_id
            }),
            signal:
              AbortSignal.timeout(2000)
          }
        ).catch(() => {});
      }
    }
  }
}

function onConfirmed(session) {
  calendar[session.session_id] = {
    event_id: rid('evt'),
    session_id: session.session_id,
    title: session.skill,
    start_time: session.start_time,
    end_time: session.end_time,
    attendees: [
      session.teacher_id,
      session.learner_id
    ]
  };

  for (const [label, ms] of [
    ['24 цагийн', DAY],
    ['1 цагийн', HOUR]
  ]) {
    for (const userId of [
      session.teacher_id,
      session.learner_id
    ]) {
      notes.push({
        id: `ntf_${seq++}`,
        user_id: userId,
        kind: 'reminder',
        session_id:
          session.session_id,
        message:
          `${session.skill}: session эхлэхээс өмнөх ${label} сануулга`,
        send_at: new Date(
          Date.parse(
            session.start_time
          ) - ms
        ).toISOString()
      });
    }
  }

  emit(
    'session.confirmed',
    session,
    `${session.skill} session баталгаажлаа`
  );
}

// ---------- Route system ----------

const routes = [];

const route = (
  method,
  pattern,
  fn
) => {
  routes.push([
    method,
    new RegExp(`^${pattern}$`),
    fn
  ]);
};

// ---------- Authentication ----------

route(
  'POST',
  '/auth/register',
  async (req, res) => {
    const body = await readBody(req);

    need(body, [
      'name',
      'phone',
      'email',
      'password'
    ]);

    if (body.password.length < 8) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'Нууц үг 8-аас дээш тэмдэгттэй байх ёстой.'
      );
    }

    if (
      Object.values(users).some(
        (u) => u.email === body.email
      )
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'Энэ имэйл бүртгэлтэй байна.'
      );
    }

    const skills = (
      body.skills || []
    ).map((skill) => ({
      name: String(skill.name),
      category: String(
        skill.category || 'Бусад'
      )
    }));

    const user = mk({
      id: rid('usr'),
      name: body.name,
      phone: body.phone,
      email: body.email,
      skills,
      ...hashPw(body.password)
    });

    users[user.id] = user;

    send(res, 201, {
      user_id: user.id,
      name: user.name,
      email: user.email,
      skills: user.skills
    });
  }
);

route(
  'POST',
  '/auth/login',
  async (req, res) => {
    const body = await readBody(req);

    need(body, [
      'email',
      'password'
    ]);

    const user = Object.values(users)
      .find(
        (u) =>
          u.email === body.email
      );

    if (
      !user ||
      !checkPw(body.password, user)
    ) {
      throw err(
        401,
        'UNAUTHORIZED',
        'Имэйл эсвэл нууц үг буруу байна.'
      );
    }

    send(res, 200, {
      access_token:
        signJwt(user.id),
      token_type: 'Bearer',
      expires_in: 3600
    });
  }
);

route(
  'GET',
  '/me',
  async (req, res) => {
    const user = authUser(req);

    send(res, 200, {
      user_id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      skills: user.skills,
      restricted_until:
        user.restricted_until >
        Date.now()
          ? new Date(
              user.restricted_until
            ).toISOString()
          : null
    });
  }
);

// ---------- Users ----------

route(
  'GET',
  '/users/([^/]+)/profile',
  async (req, res, _m) => {
    authUser(req);

    const user = users[_m[1]];

    if (!user) {
      throw err(
        404,
        'NOT_FOUND',
        'Хэрэглэгч олдсонгүй.'
      );
    }

    send(res, 200, {
      user_id: user.id,
      name: user.name,
      skills: user.skills,
      ...stats(user)
    });
  }
);

// ---------- Skills ----------

route(
  'GET',
  '/skills/search',
  async (req, res, _m, url) => {
    const me = authUser(req);

    const skill =
      (
        url.searchParams.get('skill') ||
        ''
      ).toLowerCase();

    const category =
      url.searchParams.get(
        'category'
      );

    if (!skill && !category) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'skill эсвэл category параметр шаардлагатай.'
      );
    }

    const minRating = parseFloat(
      url.searchParams.get(
        'min_rating'
      ) || '0'
    );

    if (
      Number.isNaN(minRating) ||
      minRating < 0 ||
      minRating > 5
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'min_rating 0-5 хооронд байх ёстой.'
      );
    }

    const from =
      url.searchParams.get(
        'available_from'
      );

    if (
      from &&
      Number.isNaN(Date.parse(from))
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'available_from буруу огноо байна.'
      );
    }

    const results = [];

    for (const user of Object.values(
      users
    )) {
      if (
        user.id === me.id ||
        user.role === 'admin'
      ) {
        continue;
      }

      const foundSkill =
        user.skills.find(
          (item) =>
            (
              !skill ||
              item.name
                .toLowerCase()
                .includes(skill)
            ) &&
            (
              !category ||
              item.category === category
            )
        );

      const st = stats(user);

      if (
        !foundSkill ||
        (st.avg_rating ?? 0) <
          minRating
      ) {
        continue;
      }

      if (
        from &&
        !user.availability.some(
          (a) =>
            Date.parse(from) >=
              Date.parse(a.start) &&
            Date.parse(from) <=
              Date.parse(a.end)
        )
      ) {
        continue;
      }

      results.push({
        user_id: user.id,
        name: user.name,
        skill: foundSkill.name,
        category:
          foundSkill.category,
        avg_rating:
          st.avg_rating,
        completed_sessions:
          st.completed_sessions,
        no_show_rate:
          st.no_show_rate
      });
    }

    results.sort(
      (a, b) =>
        (b.avg_rating ?? 0) -
        (a.avg_rating ?? 0)
    );

    send(res, 200, {
      results
    });
  }
);

// ---------- Sessions ----------

route(
  'GET',
  '/sessions',
  async (req, res) => {
    const me = authUser(req);

    const mine = Object.values(
      sessions
    )
      .filter(
        (session) =>
          session.teacher_id ===
            me.id ||
          session.learner_id ===
            me.id
      )
      .map(pub)
      .map((session) => ({
        ...session,
        teacher_name:
          users[
            session.teacher_id
          ].name,
        learner_name:
          users[
            session.learner_id
          ].name
      }))
      .reverse();

    send(res, 200, {
      sessions: mine
    });
  }
);

route(
  'POST',
  '/sessions',
  async (req, res) => {
    const me = authUser(req);

    const body =
      await readBody(req);

    need(body, [
      'teacher_id',
      'skill',
      'start_time',
      'end_time',
      'credits'
    ]);

    if (
      !Number.isInteger(
        body.credits
      ) ||
      body.credits < 1
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'credits эерэг бүхэл тоо байх ёстой.'
      );
    }

    if (
      Number.isNaN(
        Date.parse(
          body.start_time
        )
      ) ||
      Number.isNaN(
        Date.parse(
          body.end_time
        )
      ) ||
      Date.parse(
        body.end_time
      ) <=
        Date.parse(
          body.start_time
        )
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'end_time нь start_time-аас хойш байх ёстой.'
      );
    }

    if (
      !users[body.teacher_id] ||
      body.teacher_id === me.id
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'teacher_id буруу байна.'
      );
    }

    if (
      me.restricted_until >
      Date.now()
    ) {
      throw err(
        403,
        'RESTRICTED',
        `No-show-ын улмаас ${new Date(
          me.restricted_until
        )
          .toISOString()
          .slice(0, 10)} хүртэл session захиалах боломжгүй.`
      );
    }

    if (
      me.balance <
      body.credits
    ) {
      throw err(
        403,
        'INSUFFICIENT_CREDITS',
        'Credit үлдэгдэл хүрэлцэхгүй байна.'
      );
    }

    const session = {
      session_id: rid('ses'),
      teacher_id:
        body.teacher_id,
      learner_id: me.id,
      skill: body.skill,
      start_time:
        body.start_time,
      end_time:
        body.end_time,
      credits:
        body.credits,
      status: 'proposed',
      proposed_by: me.id,
      checkins: {
        teacher: false,
        learner: false
      },
      transferred: false,
      completed_at: null,
      ratings: {},
      flag_id: null
    };

    sessions[
      session.session_id
    ] = session;

    send(
      res,
      201,
      pub(session)
    );
  }
);

route(
  'POST',
  '/sessions/([^/]+)/respond',
  async (req, res, _m) => {
    const me = authUser(req);

    const session =
      loadSession(
        _m[1],
        me
      );

    const body =
      await readBody(req);

    need(body, [
      'action'
    ]);

    if (
      session.status !==
        'proposed' ||
      session.proposed_by ===
        me.id
    ) {
      throw err(
        400,
        'INVALID_STATE',
        'Та энэ саналд хариулах боломжгүй.'
      );
    }

    if (
      body.action ===
      'accept'
    ) {
      if (
        users[
          session.learner_id
        ].balance <
        session.credits
      ) {
        throw err(
          403,
          'INSUFFICIENT_CREDITS',
          'Суралцагчийн credit хүрэлцэхгүй байна.'
        );
      }

      session.status =
        'confirmed';

      onConfirmed(session);

    } else if (
      body.action ===
      'decline'
    ) {
      session.status =
        'cancelled';

    } else if (
      body.action ===
      'counter'
    ) {
      if (
        body.credits !==
          undefined &&
        (
          !Number.isInteger(
            body.credits
          ) ||
          body.credits < 1
        )
      ) {
        throw err(
          400,
          'VALIDATION_ERROR',
          'credits буруу байна.'
        );
      }

      Object.assign(
        session,
        {
          credits:
            body.credits ??
            session.credits,

          start_time:
            body.start_time ??
            session.start_time,

          end_time:
            body.end_time ??
            session.end_time,

          proposed_by:
            me.id
        }
      );

      if (
        Date.parse(
          session.end_time
        ) <=
        Date.parse(
          session.start_time
        )
      ) {
        throw err(
          400,
          'VALIDATION_ERROR',
          'end_time нь start_time-аас хойш байх ёстой.'
        );
      }

    } else {
      throw err(
        400,
        'VALIDATION_ERROR',
        'action нь accept, decline, counter-ийн нэг байх ёстой.'
      );
    }

    send(
      res,
      200,
      pub(session)
    );
  }
);

route(
  'POST',
  '/sessions/([^/]+)/cancel',
  async (req, res, _m) => {
    const me = authUser(req);

    const session =
      loadSession(
        _m[1],
        me
      );

    if (
      ![
        'proposed',
        'confirmed'
      ].includes(
        session.status
      )
    ) {
      throw err(
        400,
        'INVALID_STATE',
        'Энэ session-ыг цуцлах боломжгүй.'
      );
    }

    session.status =
      'cancelled';

    delete calendar[
      session.session_id
    ];

    emit(
      'session.cancelled',
      session,
      `${session.skill} session цуцлагдлаа`
    );

    send(
      res,
      200,
      pub(session)
    );
  }
);

route(
  'POST',
  '/sessions/([^/]+)/check-in',
  async (req, res, _m) => {
    const me = authUser(req);

    const session =
      loadSession(
        _m[1],
        me
      );

    const body =
      await readBody(req);

    need(body, [
      'role'
    ]);

    if (
      ![
        'teacher',
        'learner'
      ].includes(body.role)
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'role нь teacher эсвэл learner байх ёстой.'
      );
    }

    if (
      session[
        `${body.role}_id`
      ] !== me.id
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'Энэ role-д та оролцогч биш байна.'
      );
    }

    if (
      session.status !==
      'confirmed'
    ) {
      throw err(
        400,
        'INVALID_STATE',
        'Зөвхөн зөвшөөрөгдсөн (confirmed) session-д check-in хийнэ.'
      );
    }

    session.checkins[
      body.role
    ] = true;

    if (
      session.checkins.teacher &&
      session.checkins.learner &&
      !session.transferred
    ) {
      const learner =
        users[
          session.learner_id
        ];

      const teacher =
        users[
          session.teacher_id
        ];

      if (
        learner.balance <
        session.credits
      ) {
        session.checkins[
          body.role
        ] = false;

        throw err(
          409,
          'INSUFFICIENT_CREDITS',
          'Суралцагчийн credit хүрэлцэхгүй байна.'
        );
      }

      learner.balance -=
        session.credits;

      teacher.balance +=
        session.credits;

      session.transferred =
        true;

      session.status =
        'completed';

      session.completed_at =
        new Date().toISOString();

      led(
        'transfer',
        session.session_id,
        learner.id,
        teacher.id,
        session.credits
      );

      log(
        'system',
        'credit.transfer',
        session.session_id,
        `${session.credits} credit`
      );

      emit(
        'session.completed',
        session,
        `${session.skill} session дууслаа`
      );

      emit(
        'credit.transferred',
        session,
        `${session.credits} credit шилжлээ`
      );
    }

    send(
      res,
      200,
      pub(session)
    );
  }
);

route(
  'POST',
  '/sessions/([^/]+)/no-show',
  async (req, res, _m) => {
    const me = authUser(req);

    const session =
      loadSession(
        _m[1],
        me
      );

    const body =
      await readBody(req);

    need(body, [
      'absent_user_id'
    ]);

    if (
      ![
        session.teacher_id,
        session.learner_id
      ].includes(
        body.absent_user_id
      ) ||
      body.absent_user_id ===
        me.id
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'absent_user_id буруу байна.'
      );
    }

    if (
      session.status !==
      'confirmed'
    ) {
      throw err(
        400,
        'INVALID_STATE',
        'Зөвхөн зөвшөөрөгдсөн session дээр no-show мэдээлнэ.'
      );
    }

    if (
      Date.now() <
      Date.parse(
        session.start_time
      )
    ) {
      throw err(
        400,
        'NO_SHOW_TOO_EARLY',
        'Session эхлээгүй байна.'
      );
    }

    if (
      Date.now() >
      Date.parse(
        session.end_time
      ) + HOUR
    ) {
      throw err(
        400,
        'NO_SHOW_WINDOW_CLOSED',
        'No-show мэдээлэх 1 цагийн хугацаа дууссан.'
      );
    }

    session.status =
      'no_show_reported';

    const absent =
      users[
        body.absent_user_id
      ];

    absent.reports.push(
      Date.now()
    );

    const recent =
      absent.reports.filter(
        (time) =>
          time >
          Date.now() -
            30 * DAY
      ).length;

    if (recent >= 3) {
      absent.restricted_until =
        Date.now() +
        7 * DAY;
    }

    log(
      me.id,
      'no_show.report',
      session.session_id,
      `${absent.id}; ${
        body.comment || ''
      }`
    );

    send(res, 200, {
      session_id:
        session.session_id,
      status:
        session.status,
      absent_user_restricted:
        recent >= 3
    });
  }
);

route(
  'POST',
  '/sessions/([^/]+)/rate',
  async (req, res, _m) => {
    const me = authUser(req);

    const session =
      loadSession(
        _m[1],
        me
      );

    const body =
      await readBody(req);

    need(body, [
      'stars'
    ]);

    if (
      !Number.isInteger(
        body.stars
      ) ||
      body.stars < 1 ||
      body.stars > 5
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'stars 1-5 бүхэл тоо байх ёстой.'
      );
    }

    if (
      session.status !==
      'completed'
    ) {
      throw err(
        400,
        'INVALID_STATE',
        'Зөвхөн дууссан session-ыг үнэлнэ.'
      );
    }

    if (
      session.ratings[me.id]
    ) {
      throw err(
        400,
        'ALREADY_RATED',
        'Та энэ session-ыг аль хэдийн үнэлсэн.'
      );
    }

    const other =
      users[
        me.id ===
        session.teacher_id
          ? session.learner_id
          : session.teacher_id
      ];

    other.rating_sum +=
      body.stars;

    other.rating_count +=
      1;

    session.ratings[
      me.id
    ] = {
      stars: body.stars,
      comment:
        body.comment || ''
    };

    send(res, 200, {
      session_id:
        session.session_id,
      rated_user:
        other.id,
      stars:
        body.stars
    });
  }
);

// ---------- Messages ----------

route(
  'GET',
  '/sessions/([^/]+)/messages',
  async (req, res, _m) => {
    const me = authUser(req);

    loadSession(
      _m[1],
      me
    );

    send(res, 200, {
      messages:
        messages[_m[1]] || []
    });
  }
);

route(
  'POST',
  '/sessions/([^/]+)/messages',
  async (req, res, _m) => {
    const me = authUser(req);

    loadSession(
      _m[1],
      me
    );

    const body =
      await readBody(req);

    need(body, [
      'text'
    ]);

    const message = {
      from: me.id,
      from_name: me.name,
      text: String(
        body.text
      ).slice(0, 500),
      at: new Date().toISOString()
    };

    (
      messages[_m[1]] ||=
      []
    ).push(message);

    send(
      res,
      201,
      message
    );
  }
);

// ---------- Flag ----------

route(
  'POST',
  '/sessions/([^/]+)/flag',
  async (req, res, _m) => {
    const me = authUser(req);

    const session =
      loadSession(
        _m[1],
        me
      );

    const body =
      await readBody(req);

    need(body, [
      'reason'
    ]);

    if (
      session.status !==
      'completed'
    ) {
      throw err(
        400,
        'INVALID_STATE',
        'Зөвхөн дууссан session-ы credit-ийг flag хийнэ.'
      );
    }

    if (
      Date.now() >
      Date.parse(
        session.completed_at
      ) +
        72 * HOUR
    ) {
      throw err(
        400,
        'FLAG_WINDOW_CLOSED',
        'Flag хийх 72 цагийн хугацаа дууссан.'
      );
    }

    if (session.flag_id) {
      throw err(
        400,
        'ALREADY_FLAGGED',
        'Энэ session аль хэдийн flag хийгдсэн.'
      );
    }

    const flag = {
      id: rid('flg'),
      session_id:
        session.session_id,
      raised_by: me.id,
      reason: body.reason,
      status: 'open',
      credits:
        session.credits
    };

    flags[flag.id] =
      flag;

    session.flag_id =
      flag.id;

    users[
      session.teacher_id
    ].balance -=
      session.credits;

    users[
      session.teacher_id
    ].frozen +=
      session.credits;

    led(
      'freeze',
      session.session_id,
      session.teacher_id,
      null,
      session.credits
    );

    log(
      me.id,
      'flag.create',
      session.session_id,
      body.reason
    );

    send(
      res,
      201,
      flag
    );
  }
);

// ---------- Credits ----------

route(
  'GET',
  '/credits/balance',
  async (req, res) => {
    const me = authUser(req);

    send(res, 200, {
      balance: me.balance,
      frozen: me.frozen
    });
  }
);

route(
  'GET',
  '/credits/ledger',
  async (req, res) => {
    const me = authUser(req);

    const mine = ledger
      .filter(
        (entry) =>
          entry.from === me.id ||
          entry.to === me.id
      )
      .reverse();

    send(res, 200, {
      entries: mine
    });
  }
);

// ---------- Notifications ----------

route(
  'GET',
  '/notifications',
  async (req, res) => {
    const me = authUser(req);

    const items = notes
      .filter(
        (note) =>
          note.user_id === me.id
      )
      .map((note) => ({
        ...note,
        state:
          Date.parse(
            note.send_at
          ) <= Date.now()
            ? 'sent'
            : 'scheduled'
      }))
      .sort(
        (a, b) =>
          Date.parse(a.send_at) -
          Date.parse(b.send_at)
      );

    const events =
      Object.values(calendar)
        .filter((event) =>
          event.attendees.includes(
            me.id
          )
        );

    send(res, 200, {
      notifications: items,
      calendar_events: events
    });
  }
);

// ---------- Webhooks ----------

route(
  'POST',
  '/webhooks/subscribe',
  async (req, res) => {
    const me = authUser(req);

    const body =
      await readBody(req);

    need(body, [
      'callback_url',
      'events'
    ]);

    let validHttps =
      false;

    try {
      validHttps =
        new URL(
          body.callback_url
        ).protocol ===
        'https:';
    } catch {
      validHttps = false;
    }

    if (!validHttps) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'callback_url нь зөв HTTPS URL байх ёстой.'
      );
    }

    if (
      !Array.isArray(
        body.events
      ) ||
      !body.events.length ||
      !body.events.every(
        (event) =>
          EVENTS.includes(event)
      )
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        `events нь дараахаас байна: ${EVENTS.join(
          ', '
        )}`
      );
    }

    const webhook = {
      webhook_id: rid('whk'),
      callback_url:
        body.callback_url,
      events:
        body.events
    };

    webhooks[
      webhook.webhook_id
    ] = {
      ...webhook,
      owner: me.id
    };

    send(
      res,
      201,
      webhook
    );
  }
);

// ---------- Admin ----------

route(
  'GET',
  '/admin/dashboard',
  async (req, res) => {
    adminUser(req);

    const name = (id) =>
      users[id].name;

    send(res, 200, {
      flags: Object.values(flags)
        .filter(
          (flag) =>
            flag.status === 'open'
        )
        .map((flag) => ({
          ...flag,
          raised_by_name:
            name(flag.raised_by)
        })),

      no_shows: Object.values(
        sessions
      )
        .filter(
          (session) =>
            session.status ===
            'no_show_reported'
        )
        .map((session) => ({
          session_id:
            session.session_id,
          teacher: name(
            session.teacher_id
          ),
          learner: name(
            session.learner_id
          ),
          skill:
            session.skill
        })),

      frozen: Object.values(
        flags
      )
        .filter(
          (flag) =>
            flag.status === 'open'
        )
        .map((flag) => ({
          session_id:
            flag.session_id,
          credits:
            flag.credits
        }))
    });
  }
);

route(
  'POST',
  '/admin/flags/([^/]+)/resolve',
  async (req, res, _m) => {
    const admin =
      adminUser(req);

    const flag =
      flags[_m[1]];

    if (
      !flag ||
      flag.status !== 'open'
    ) {
      throw err(
        404,
        'NOT_FOUND',
        'Нээлттэй flag олдсонгүй.'
      );
    }

    const body =
      await readBody(req);

    if (
      ![
        'approve',
        'reject'
      ].includes(
        body.decision
      )
    ) {
      throw err(
        400,
        'VALIDATION_ERROR',
        'decision нь approve эсвэл reject байх ёстой.'
      );
    }

    const session =
      sessions[
        flag.session_id
      ];

    const teacher =
      users[
        session.teacher_id
      ];

    const learner =
      users[
        session.learner_id
      ];

    teacher.frozen -=
      flag.credits;

    if (
      body.decision ===
      'approve'
    ) {
      learner.balance +=
        flag.credits;

      led(
        'refund',
        session.session_id,
        teacher.id,
        learner.id,
        flag.credits
      );
    } else {
      teacher.balance +=
        flag.credits;

      led(
        'release',
        session.session_id,
        null,
        teacher.id,
        flag.credits
      );
    }

    flag.status =
      body.decision ===
      'approve'
        ? 'upheld'
        : 'rejected';

    log(
      admin.id,
      `flag.${flag.status}`,
      session.session_id,
      body.note || ''
    );

    send(
      res,
      200,
      flag
    );
  }
);

route(
  'GET',
  '/admin/audit-log',
  async (req, res) => {
    adminUser(req);

    send(res, 200, {
      entries:
        [...audit].reverse()
    });
  }
);

// ---------- Home page ----------

route(
  'GET',
  '/',
  async (_req, res) => {
    const file = [
      path.join(
        __dirname,
        'public',
        'index.html'
      ),
      path.join(
        __dirname,
        'index.html'
      )
    ].find((filePath) =>
      fs.existsSync(filePath)
    );

    if (!file) {
      throw err(
        404,
        'NOT_FOUND',
        'index.html олдсонгүй. server.js-тэй ижил хавтсанд public/index.html байх ёстой.'
      );
    }

    const html =
      fs.readFileSync(file);

    res.writeHead(200, {
      'Content-Type':
        'text/html; charset=utf-8'
    });

    res.end(html);
  }
);

// ======================================================
// OpenAPI Documentation
// Swagger UI + Redoc
// ======================================================

// openapi.yaml файлыг хайна.
const findSpec = () =>
  [
    path.join(
      __dirname,
      'docs',
      'openapi',
      'openapi.yaml'
    ),

    path.join(
      __dirname,
      '..',
      'docs',
      'openapi',
      'openapi.yaml'
    ),

    path.join(
      __dirname,
      'openapi.yaml'
    )
  ].find((filePath) =>
    fs.existsSync(filePath)
  );

// HTML response helper
const sendHtml = (
  res,
  body
) => {
  res.writeHead(200, {
    'Content-Type':
      'text/html; charset=utf-8'
  });

  res.end(body);
};

// ---------- OpenAPI YAML ----------

route(
  'GET',
  '/openapi.yaml',
  async (_req, res) => {
    const file =
      findSpec();

    if (!file) {
      throw err(
        404,
        'NOT_FOUND',
        'openapi.yaml олдсонгүй.'
      );
    }

    const body =
      fs.readFileSync(file);

    res.writeHead(200, {
      'Content-Type':
        'text/yaml; charset=utf-8'
    });

    res.end(body);
  }
);

// ---------- Swagger UI ----------

const swaggerHtml = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >
  <title>SkillSwap API - Swagger UI</title>

  <link
    rel="stylesheet"
    href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"
  >
</head>

<body>
  <div id="swagger-ui"></div>

  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>

  <script>
    window.onload = () => {
      SwaggerUIBundle({
        url: '/openapi.yaml',
        dom_id: '#swagger-ui',
        persistAuthorization: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`;

// /docs
route(
  'GET',
  '/docs',
  async (_req, res) => {
    sendHtml(
      res,
      swaggerHtml
    );
  }
);

// /swagger
route(
  'GET',
  '/swagger',
  async (_req, res) => {
    sendHtml(
      res,
      swaggerHtml
    );
  }
);

// ---------- Redoc ----------

const redocHtml = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <title>SkillSwap API - Redoc</title>
</head>

<body>

  <redoc
    spec-url="/openapi.yaml"
  ></redoc>

  <script src="https://cdn.jsdelivr.net/npm/redoc@2.1.5/bundles/redoc.standalone.js"></script>

</body>
</html>`;

// /redoc
route(
  'GET',
  '/redoc',
  async (_req, res) => {
    sendHtml(
      res,
      redocHtml
    );
  }
);

// ---------- HTTP Server ----------

const server =
  http.createServer(
    async (req, res) => {
      try {
        const url =
          new URL(
            req.url,
            `http://${req.headers.host}`
          );

        for (
          const [
            method,
            regex,
            handler
          ] of routes
        ) {
          const match =
            regex.exec(
              url.pathname
            );

          if (
            match &&
            req.method === method
          ) {
            return await handler(
              req,
              res,
              match,
              url
            );
          }
        }

        throw err(
          404,
          'NOT_FOUND',
          'Endpoint олдсонгүй.'
        );

      } catch (error) {
        if (
          error instanceof
          HttpError
        ) {
          return send(
            res,
            error.status,
            {
              code:
                error.code,
              message:
                error.message
            }
          );
        }

        console.error(error);

        send(
          res,
          500,
          {
            code:
              'INTERNAL_ERROR',
            message:
              'Түр хугацаанд алдаа гарлаа. Дахин оролдоно уу.'
          }
        );
      }
    }
  );

server.listen(
  PORT,
  () => {
    console.log(
      `SkillSwap: http://localhost:${PORT}`
    );

    console.log(
      `Swagger UI: http://localhost:${PORT}/swagger`
    );

    console.log(
      `Redoc: http://localhost:${PORT}/redoc`
    );
  }
);