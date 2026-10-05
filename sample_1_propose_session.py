"""POST /v1/sessions: Session санал болгох.

Суралцагч заагчид 5 credit-тэй, 1 цагийн Франц хэлний session санал болгоно.
Урьдчилсан нөхцөл: `auth_token` нь POST /auth/login-оос авсан JWT байх ёстой.
"""
import os

import requests

BASE_URL = os.environ.get("SKILLSWAP_URL", "http://localhost:3000")

auth_token = "your_jwt_access_token"

session_payload = {
    "teacher_id": "usr_4f2a91",
    "skill": "Франц хэл",
    "start_time": "2026-10-12T14:00:00+08:00",
    "end_time": "2026-10-12T15:00:00+08:00",
    "credits": 5,
}

session_response = requests.post(
    f"{BASE_URL}/sessions",
    headers={"Authorization": f"Bearer {auth_token}"},
    json=session_payload,
)
print(session_response.status_code, session_response.json())

# Хүлээгдэх хариу (Prism mock / бодит сервер дээр ажиллуулж баталгаажуулсан):
# 201 {"session_id": "ses_7c31d0", "status": "proposed", ...}
