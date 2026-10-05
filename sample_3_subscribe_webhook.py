"""POST /webhooks/subscribe: webhook URL бүртгэх.

Session баталгаажих болон дуусах үед өөрийн сервер рүү
мэдэгдэл хүлээн авах webhook бүртгэнэ.

Урьдчилсан нөхцөл:
- SKILLSWAP_TOKEN орчны хувьсагчид access_token байна.
- callback_url нь HTTPS байх ёстой.
"""

import os

import requests


BASE_URL = os.environ.get("SKILLSWAP_URL", "http://localhost:3000")
auth_token = os.environ["SKILLSWAP_TOKEN"]

webhook_payload = {
    "callback_url": "https://skillswap.example.mn/hooks/session-events",
    "events": [
        "session.confirmed",
        "session.completed",
    ],
}

webhook_response = requests.post(
    f"{BASE_URL}/webhooks/subscribe",
    headers={"Authorization": f"Bearer {auth_token}"},
    json=webhook_payload,
)

print(webhook_response.status_code)
print(webhook_response.json())

# Demo backend-ийн баталгаажуулсан гаралт:
# 201
# {
#     "webhook_id": "whk_a4024e",
#     "callback_url": "https://skillswap.example.mn/hooks/session-events",
#     "events": [
#         "session.confirmed",
#         "session.completed"
#     ]
# }