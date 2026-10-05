"""POST /v1/webhooks/subscribe: Webhook URL бүртгэх.

Session баталгаажих, дуусах үед өөрийн сервер рүү мэдэгдэл хүлээн авна.
`callback_url` нь HTTPS бөгөөд интернэтээс хандах боломжтой байх ёстой.
"""
import os

import requests

BASE_URL = os.environ.get("SKILLSWAP_URL", "http://localhost:3000")

auth_token = "your_jwt_access_token"

webhook_payload = {
    "callback_url": "https://your-app.example.mn/hooks/skillswap",
    "events": ["session.confirmed", "session.completed"],
}

webhook_response = requests.post(
    f"{BASE_URL}/webhooks/subscribe",
    headers={"Authorization": f"Bearer {auth_token}"},
    json=webhook_payload,
)
print(webhook_response.status_code, webhook_response.json())

# Хүлээгдэх хариу:
# 201 {"webhook_id": "whk_19ab40", "callback_url": "...", "events": [...]}
