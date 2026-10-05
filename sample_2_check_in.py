"""POST /sessions/{sessionId}/check-in: session-д check-in хийх.

Суралцагч өөрийн талаас check-in хийнэ. Хоёр тал check-in хийсэн
үед session "completed" болж, credit автоматаар шилжинэ.

Урьдчилсан нөхцөл:
- Session "confirmed" төлөвтэй байна.
- SKILLSWAP_TOKEN орчны хувьсагчид access_token байна.
- session_id нь POST /sessions-ийн хариунаас авсан утга байна.
"""

import os

import requests


BASE_URL = os.environ.get("SKILLSWAP_URL", "http://localhost:3000")
auth_token = os.environ["SKILLSWAP_TOKEN"]

# POST /sessions-ийн demo response-оос авсан session ID
session_id = "ses_bf8b08"

check_in_response = requests.post(
    f"{BASE_URL}/sessions/{session_id}/check-in",
    headers={"Authorization": f"Bearer {auth_token}"},
    json={"role": "learner"},
)

print(check_in_response.status_code)
print(check_in_response.json())

# Demo backend-ийн баталгаажуулсан гаралт:
# 200
# {
#     "session_id": "ses_21708e",
#     "teacher_id": "usr_4f2a91",
#     "learner_id": "usr_b82e17",
#     "skill": "Франц хэл",
#     "credits": 5,
#     "status": "confirmed",
#     "checkins": {
#         "teacher": False,
#         "learner": True
#     },
#     "completed_at": None
# }
#
# Заагч мөн check-in хийсний дараа:
# status = "completed" болж, credit шилжинэ.