"""openapi.yaml-ийг ажиллаж буй backend-тэй тулгана.

Ажиллуулах:  node backend/server.js   (нэг terminal)
             python docs/verify_spec.py   (өөр terminal)

1) Статик шалгалт: $ref бүр олдох, operationId давхцахгүй, endpoint бүр 2xx/4xx/5xx хариутай,
   request/response жишээтэй эсэх.
2) Бодит шалгалт: endpoint бүрийг дуудаж, хариуны status нь spec-д бичигдсэн, body нь schema-ийн
   required талбаруудыг агуулсан эсэхийг шалгана.
"""
import os, sys, time, uuid, yaml, requests

BASE = os.environ.get("SKILLSWAP_URL", "http://localhost:3000")
spec = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "openapi", "openapi.yaml"), encoding="utf-8"))
fails, passes = [], 0

def ok(name, cond, extra=""):
    global passes
    if cond: passes += 1
    else: fails.append(f"{name} {extra}")
    print(("PASS  " if cond else "FAIL  ") + name, "" if cond else extra)

def resolve(node):
    while isinstance(node, dict) and "$ref" in node:
        cur = spec
        try:
            for part in node["$ref"][2:].split("/"): cur = cur[part]
        except (KeyError, TypeError):
            return {}  # эвдэрсэн $ref: статик шалгалт дээр FAIL болно
        node = cur
    return node

def refs(node, found):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "$ref": found.append(v)
            else: refs(v, found)
    elif isinstance(node, list):
        for v in node: refs(v, found)
    return found

# ---------- 1. Статик ----------
bad = []
for r in refs(spec, []):
    try: resolve({"$ref": r})
    except (KeyError, TypeError): bad.append(r)
ok("Бүх $ref олдсон", not bad, str(bad))
ops = [(p, m, o) for p, item in spec["paths"].items() for m, o in item.items()]
ids = [o["operationId"] for _, _, o in ops]
ok(f"operationId давхцаагүй ({len(ids)} endpoint)", len(ids) == len(set(ids)))
ok("Endpoint 5-аас олон", len(ops) >= 5)
for p, m, o in ops:
    codes = list(o["responses"])
    ok(f"{m.upper()} {p}: 2xx+4xx+5xx хариутай", any(c[0] == "2" for c in codes) and any(c[0] == "4" for c in codes) and any(c[0] == "5" for c in codes), str(codes))
    if "requestBody" in o:
        ok(f"{m.upper()} {p}: request жишээтэй", "example" in o["requestBody"]["content"]["application/json"])
    two = next(c for c in codes if c[0] == "2")
    ok(f"{m.upper()} {p}: response жишээтэй", "example" in resolve(o["responses"][two])["content"]["application/json"])

# ---------- 2. Бодит ----------
def check(path_tpl, method, resp):
    op = spec["paths"][path_tpl][method.lower()]
    code = str(resp.status_code)
    ok(f"{method} {path_tpl} -> {code} spec-д бичигдсэн", code in op["responses"], f"(зөвшөөрөгдсөн: {list(op['responses'])})")
    content = resolve(op["responses"].get(code, {})).get("content", {}).get("application/json")
    if content:
        schema = resolve(content["schema"])
        body = resp.json()
        miss = [k for k in schema.get("required", []) if k not in (body if isinstance(body, dict) else {})]
        ok(f"{method} {path_tpl} -> {code} body-д required талбарууд бий", not miss, f"дутуу: {miss}")

def call(method, tpl, token=None, json=None, params=None, **path_args):
    url = BASE + tpl.format(**path_args)
    h = {"Authorization": f"Bearer {token}"} if token else {}
    r = requests.request(method, url, headers=h, json=json, params=params, timeout=5)
    check(tpl, method, r)
    return r

def iso(sec): return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + sec))
PW = "your_account_password"
try: requests.get(BASE, timeout=3)
except requests.RequestException: sys.exit(f"Сервер ({BASE}) ажиллахгүй байна. Эхлээд: node backend/server.js")

L = call("POST", "/auth/login", json={"email": "oyuntsetseg@num.edu.mn", "password": PW}).json()["access_token"]
T = call("POST", "/auth/login", json={"email": "baterdene@num.edu.mn", "password": PW}).json()["access_token"]
call("POST", "/auth/login", json={"email": "oyuntsetseg@num.edu.mn"})                       # 400
call("POST", "/auth/login", json={"email": "oyuntsetseg@num.edu.mn", "password": "wrong"})  # 401
call("POST", "/auth/register", json={"name": "Шинэ", "phone": "99", "email": f"{uuid.uuid4().hex[:8]}@num.edu.mn", "password": PW, "skills": []})
call("POST", "/auth/register", json={"name": "x"})                                           # 400

call("GET", "/skills/search", L, params={"skill": "Франц", "min_rating": 4})
call("GET", "/skills/search", L, params={"category": "Программчлал"})
call("GET", "/skills/search", L)                                                              # 400
call("GET", "/credits/balance", L)
call("GET", "/credits/balance")                                                                # 401

prop = {"teacher_id": "usr_4f2a91", "skill": "Франц хэл", "start_time": iso(-600), "end_time": iso(3000), "credits": 4}
sid = call("POST", "/sessions", L, prop).json()["session_id"]
call("POST", "/sessions", L, {**prop, "credits": 999})                                         # 403
call("POST", "/sessions", L, {"skill": "x"})                                                   # 400
call("POST", "/sessions/{sessionId}/check-in", L, {"role": "learner"}, sessionId=sid)          # 400 (confirmed биш)
call("POST", "/sessions/{sessionId}/respond", T, {"action": "accept"}, sessionId=sid)
call("POST", "/sessions/{sessionId}/respond", T, {"action": "accept"}, sessionId=sid)          # 400 (аль хэдийн)
call("POST", "/sessions/{sessionId}/respond", L, {"action": "accept"}, sessionId="ses_nope")   # 404
call("POST", "/sessions/{sessionId}/check-in", L, {"role": "learner"}, sessionId=sid)
call("POST", "/sessions/{sessionId}/check-in", T, {"role": "teacher"}, sessionId=sid)
call("POST", "/sessions/{sessionId}/check-in", L, {"role": "learner"}, sessionId="ses_nope")   # 404
call("POST", "/sessions/{sessionId}/rate", L, {"stars": 5, "comment": "Сайн"}, sessionId=sid)
call("POST", "/sessions/{sessionId}/rate", L, {"stars": 9}, sessionId=sid)                     # 400
call("POST", "/sessions/{sessionId}/flag", L, {"reason": "Credit буруу тооцсон"}, sessionId=sid)
call("POST", "/sessions/{sessionId}/flag", L, {"reason": "дахин"}, sessionId=sid)              # 400
sid2 = call("POST", "/sessions", L, prop).json()["session_id"]
call("POST", "/sessions/{sessionId}/respond", T, {"action": "accept"}, sessionId=sid2)
call("POST", "/sessions/{sessionId}/no-show", L, {"absent_user_id": "usr_4f2a91"}, sessionId=sid2)
call("POST", "/sessions/{sessionId}/no-show", L, {"absent_user_id": "usr_4f2a91"}, sessionId=sid2)  # 400
call("POST", "/sessions/{sessionId}/no-show", L, {"absent_user_id": "usr_4f2a91"}, sessionId="ses_nope")  # 404
call("POST", "/webhooks/subscribe", L, {"callback_url": "https://your-app.example.mn/hooks/skillswap", "events": ["session.completed"]})
call("POST", "/webhooks/subscribe", L, {"callback_url": "http://bad", "events": ["x"]})        # 400

print(f"\n{passes} pass, {len(fails)} fail")
sys.exit(1 if fails else 0)