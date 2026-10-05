"""POST /sessions: заагчид session санал болгох.

Суралцагч заагч Бат-Эрдэнэд 5 credit-тэй, 1 цагийн Франц хэлний
session санал болгоно.

Урьдчилсан нөхцөл:
- SKILLSWAP_TOKEN орчны хувьсагчид POST /auth/login-оос авсан access_token байна.
- Сервер: node backend/server.js
"""

import os

import requests


BASE_URL = os.environ.get("SKILLSWAP_URL", "http://localhost:3000")
auth_token = os.environ["SKILLSWAP_TOKEN"]

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

print(session_response.status_code)
print(session_response.json())



# Demo backend-ийн баталгаажуулсан гаралт:
# 201
# {
#     "session_id": "ses_21708e",
#     "teacher_id": "usr_4f2a91",
#     "learner_id": "usr_b82e17",
#     "skill": "Франц хэл",
#     "start_time": "2026-10-12T14:00:00+08:00",
#     "end_time": "2026-10-12T15:00:00+08:00",
#     "credits": 5,
#     "status": "proposed",
#     "proposed_by": "usr_b82e17",
#     "checkins": {
#         "teacher": False,
#         "learner": False
#     },
#     "completed_at": None,
#     "ratings": {},
#     "flag_id": None
# }