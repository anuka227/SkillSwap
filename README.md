# SkillSwap demo backend

Spec (`docs/openapi/openapi.yaml`)-ийн 7 endpoint-ыг хэрэгжүүлсэн жижиг сервер.
Сангүй, Node.js 18+ хэрэгтэй. Өгөгдөл санах ойд хадгалагдах тул restart хийхэд арилна.

    node backend/server.js          # http://localhost:3000

Туршилтын хэрэглэгчид (нууц үг хоёуланд `your_account_password`):
- oyuntsetseg@num.edu.mn (суралцагч, 25 credit)
- baterdene@num.edu.mn (заагч, 40 credit)

Кодын жишээ: `docs/samples/*.py`-д `your_jwt_access_token`-ийн оронд
`POST /auth/login`-оос авсан token-оо тавина.
