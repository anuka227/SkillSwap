"""POST /v1/sessions/{sessionId}/check-in: Session-д check-in хийх.

Суралцагч өөрийн талаас check-in хийнэ. Заагч мөн хийсэн үед session
"completed" болж, credit автоматаар шилжинэ (FR-06, FR-07).
"""
import os

import requests

BASE_URL = os.environ.get("SKILLSWAP_URL", "http://localhost:3000")

auth_token = "your_jwt_access_token"
session_id = "ses_7c31d0"

check_in_response = requests.post(
    f"{BASE_URL}/sessions/{session_id}/check-in",
    headers={"Authorization": f"Bearer {auth_token}"},
    json={"role": "learner"},
)
print(check_in_response.status_code, check_in_response.json())

# Хүлээгдэх хариу:
# 200 {"session_id": "ses_7c31d0", "status": "completed", "credits": 5, ...}
