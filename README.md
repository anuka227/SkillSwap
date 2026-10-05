# SkillSwap demo (backend + вэб интерфэйс)

SRS-ийн FR-01..FR-15, NFR-03/05-ыг хэрэгжүүлсэн жижиг төсөл. Сангүй, Node.js 18+ хэрэгтэй.
Өгөгдөл санах ойд хадгалагдах тул restart хийхэд арилна.

    node backend/server.js      # http://localhost:3000 (вэб интерфэйс нь мөн энд)
    node backend/test.js        # 34 шалгалт (сервер асаалттай байх үед)

Туршилтын хэрэглэгчид (нууц үг хоёуланд `your_account_password`):
suralcagch oyuntsetseg@num.edu.mn, zaagch baterdene@num.edu.mn, admin temuulen@num.edu.mn

| FR | Хэрэгжилт |
|----|-----------|
| 01 | POST /auth/register (нууц үг scrypt hash) |
| 02, 13 | GET /skills/search (skill, category, min_rating, available_from) |
| 03 | GET /users/{id}/profile |
| 04 | POST /sessions, /sessions/{id}/respond (accept, decline, counter) |
| 05 | GET /credits/balance, /credits/ledger |
| 06, 07 | POST /sessions/{id}/check-in (хоёр тал -> completed -> credit нэг удаа шилжинэ; 24 цагт нэг тал бол unconfirmed) |
| 08 | POST /sessions/{id}/rate |
| 09 | GET, POST /sessions/{id}/messages (WebSocket биш, polling) |
| 10 | POST /sessions/{id}/no-show (1 цагийн цонх, 30 хоногт 3 удаа -> 7 хоног хязгаарлалт) |
| 11, 15 | Симуляци: сануулга товлох, Calendar event үүсгэх/устгах (GET /notifications). Жинхэнэ FCM, Google Calendar холбоогүй |
| 12 | POST /sessions/{id}/flag (72 цаг, credit царцаана) |
| 14 | GET /admin/dashboard, POST /admin/flags/{id}/resolve, GET /admin/audit-log |

Хялбаршуулсан зүйлс: check-in-ийг цагийн хязгаарлалтгүй зөвшөөрнө, session-ы өнгөрсөн цагийг
оруулж болно (демо хийхэд). `docs/openapi/openapi.yaml` нь эхний 7 endpoint-ыг л тайлбарласан.
