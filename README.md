# Máy chủ thư viện — gửi SMS và Gmail thật

Phần này lo việc mà trình duyệt không làm được: lưu dữ liệu trong cơ sở dữ liệu SQLite, tự kiểm tra hạn trả mỗi ngày và **gửi SMS, Gmail thật** tới người mượn.

Nguyên tắc xuyên suốt: một thông báo chỉ được đánh dấu **Đã gửi** khi nhà cung cấp dịch vụ xác nhận. Chưa cấu hình thì ghi **Chưa cấu hình**; gửi lỗi thì ghi **Gửi thất bại** kèm lý do cụ thể.

---

## 1. Cài đặt

Cần Node.js 18 trở lên (`node -v` để kiểm tra).

```bash
cd thu-vien-server
npm install
cp .env.example .env
```

Mở tệp `.env` và điền ít nhất hai dòng sau:

```
ADMIN_PASSWORD=mat-khau-cua-ban
SESSION_SECRET=mot-chuoi-ngau-nhien-that-dai-32-ky-tu-tro-len
```

Chạy máy chủ:

```bash
npm start
```

Mở trình duyệt vào **http://localhost:4000** — giao diện website hiện ra, đăng nhập bằng đúng mật khẩu `ADMIN_PASSWORD` vừa đặt. Từ đây dùng như bình thường: mượn sách, danh sách, kho sách, thông báo, thống kê.

Muốn dùng từ điện thoại trong cùng mạng Wi-Fi: xem địa chỉ IP của máy tính (`ipconfig` trên Windows, `ifconfig` trên macOS) rồi vào `http://192.168.x.x:4000` trên điện thoại. Máy tính phải đang bật và đang chạy `npm start`.

---

## 2. Đưa website lên mạng để dùng ở mọi nơi (không chỉ máy này)

Website này gồm một **máy chủ Node.js thật sự** (lưu dữ liệu SQLite, gửi SMS/Gmail), nên **không thể** host trên GitHub Pages — GitHub Pages chỉ phục vụ file tĩnh (HTML/CSS/JS), không chạy được Node.js. Cần một nơi cho thuê máy chủ Node miễn phí, ví dụ **Render.com**.

Việc đăng ký/đăng nhập tài khoản (mục `/api/dang-ky`, `/api/dang-nhap-doc-gia`) đã có sẵn trong mã nguồn và lưu vào cơ sở dữ liệu trên máy chủ — nghĩa là **hễ máy chủ chạy ở một địa chỉ công khai thì bất kỳ ai, từ bất kỳ thiết bị nào, cũng đăng ký/đăng nhập lại được**, không cần đúng máy tính này. Vấn đề hiện tại chỉ là máy chủ đang chạy ở `localhost` — chỉ máy đang bật `npm start` mới thấy được.

### Các bước với Render (miễn phí)

1. Đưa toàn bộ thư mục `thu-vien-server` lên một **repository GitHub** (tạo repo mới trên github.com, rồi `git init`, `git add .`, `git commit`, `git push`).
2. Vào **render.com**, đăng nhập bằng tài khoản GitHub, chọn **New → Blueprint**, trỏ vào repo vừa tạo. Render sẽ tự đọc file `render.yaml` đã có sẵn trong dự án và tạo đúng dịch vụ (kèm ổ đĩa lưu dữ liệu lâu dài cho SQLite).
3. Khi được hỏi, điền hai biến bắt buộc: `ADMIN_PASSWORD` và `SESSION_SECRET` (chuỗi ngẫu nhiên dài). Đây là hai giá trị được đánh dấu "cần nhập tay" trong `render.yaml`.
4. Bấm **Apply/Deploy**. Sau vài phút, Render cấp một địa chỉ dạng `https://thu-vien-lop.onrender.com` — đây là địa chỉ dùng ở mọi nơi, mọi thiết bị, thay cho `localhost:4000`.
5. Từ nay, mỗi lần `git push` lên GitHub, Render tự động triển khai lại bản mới (không cần thao tác thủ công).

Lưu ý: gói miễn phí của Render sẽ "ngủ" sau một thời gian không có ai truy cập và mất khoảng 30–60 giây để "thức dậy" ở lượt truy cập đầu tiên — vẫn hoạt động bình thường, chỉ chậm ở lần đầu.

---

## 3. Cấu hình SMS

### Cách A — Twilio (gửi được quốc tế, dễ thử nghiệm)

1. Đăng ký tại `https://www.twilio.com/try-twilio`.
2. Vào Console, chép **Account SID** và **Auth Token**.
3. Mua hoặc nhận số dùng thử ở mục Phone Numbers, chép số dạng `+1...`.
4. Điền vào `.env`:

```
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM=+12025550123
```

Lưu ý: tài khoản dùng thử của Twilio chỉ gửi được tới số đã xác minh trong mục Verified Caller IDs. Số điện thoại Việt Nam được hệ thống tự chuyển sang dạng `+84` trước khi gửi.

### Cách B — eSMS.vn (gửi trong nước, cần brandname)

1. Đăng ký tại `https://esms.vn`, nạp tiền và đăng ký brandname (ví dụ `THUVIEN`).
2. Vào **Quản lý API** lấy **ApiKey** và **SecretKey**.
3. Điền vào `.env`:

```
SMS_PROVIDER=esms
ESMS_API_KEY=...
ESMS_SECRET_KEY=...
ESMS_BRANDNAME=THUVIEN
ESMS_SMS_TYPE=2
```

`ESMS_SMS_TYPE=2` là tin chăm sóc khách hàng theo brandname. Nếu eSMS cấp loại khác cho tài khoản của bạn thì sửa lại theo hướng dẫn của họ.

---

## 4. Cấu hình Gmail

Gmail **không cho dùng mật khẩu đăng nhập thường** để gửi thư tự động. Phải tạo mật khẩu ứng dụng:

1. Bật xác minh 2 bước: `https://myaccount.google.com/security`.
2. Vào `https://myaccount.google.com/apppasswords`, tạo mật khẩu ứng dụng mới.
3. Chép chuỗi 16 ký tự (bỏ dấu cách) vào `.env`:

```
EMAIL_PROVIDER=gmail
GMAIL_USER=thuvienlop@gmail.com
GMAIL_APP_PASSWORD=abcdefghijklmnop
MAIL_FROM_NAME=Thư viện lớp
```

Nếu dùng dịch vụ thư khác, đặt `EMAIL_PROVIDER=smtp` rồi điền `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.

---

## 5. Kiểm tra đã gửi được thật chưa

Điền `TEST_PHONE` và `TEST_EMAIL` trong `.env` (số và email của chính bạn), rồi chạy:

```bash
npm run test-send
```

Kết quả in ra là phản hồi thật từ nhà cung cấp, không phải giả lập:

```
SMS   : DA GUI THAT toi 0912345678 (id SM1234...)
EMAIL : THAT BAI — Gửi email thất bại: Invalid login: 535 Username and Password not accepted
```

Gặp lỗi `535` nghĩa là mật khẩu ứng dụng sai hoặc chưa bật xác minh 2 bước.

---

## 6. Tiến trình tự động hằng ngày

Máy chủ tự chạy theo `CRON_SCHEDULE` (mặc định 8 giờ sáng, giờ Việt Nam). Mỗi lần chạy:

1. Lấy ngày hiện tại.
2. So với ngày trả của từng lượt đang mượn.
3. Xác định mốc nhắc: trước 3 ngày, trước 1 ngày, đúng ngày trả, hoặc quá hạn.
4. Tạo thông báo và gửi qua SMS / Gmail.
5. Ghi lại kết quả từng lần gửi.

Lượt mượn đã được xác nhận trả thì không sinh thông báo nữa. Mỗi mốc chỉ gửi một lần mỗi ngày, kể cả khi máy chủ khởi động lại (ràng buộc UNIQUE trong bảng `notifications`).

Bật tắt từng mốc trong `.env`:

```
NOTIFY_BEFORE_3=1
NOTIFY_BEFORE_1=1
NOTIFY_ON_DUE=1
NOTIFY_OVERDUE=1
```

Muốn chạy ngay không chờ tới giờ:

```bash
npm run check-now
```

---

## 7. Tài khoản học sinh tự mượn sách

Từ phiên bản này, học sinh có thể tự đăng ký tài khoản và tự mượn sách, không cần thầy cô nhập hộ.

- Mở **http://localhost:4000/hoc-sinh.html** (có sẵn liên kết ở góc dưới bên trái trang quản trị).
- Học sinh bấm **Đăng ký tài khoản**, điền họ tên, số điện thoại, Gmail và đặt mật khẩu (ít nhất 6 ký tự).
- Lần sau chỉ cần **Đăng nhập** bằng số điện thoại hoặc Gmail đã đăng ký.
- Sau khi đăng nhập, học sinh thấy sách nào đang có sẵn, tự nhập mã sách và ngày trả để mượn, và xem lại lịch sử mượn của chính mình.
- Hệ thống vẫn chặn mượn trùng mã sách như trước, dù là quản trị viên hay học sinh tạo lượt mượn.
- **Xác nhận đã trả sách vẫn chỉ quản trị viên làm được** — học sinh không tự đóng được lượt mượn của mình, để tránh khai man đã trả. Học sinh trả sách thì báo trực tiếp với thầy cô phụ trách.
- Mật khẩu được băm bằng scrypt trước khi lưu, không lưu dạng chữ thường (plain text). Tài khoản học sinh và tài khoản quản trị dùng hai loại phiếu đăng nhập riêng, không dùng lẫn được.

## 8. Danh sách API

Mọi đường dẫn (trừ `/api/dang-nhap` và `/api/trang-thai`) cần tiêu đề
`Authorization: Bearer <token>` lấy từ lần đăng nhập.

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| POST | `/api/dang-nhap` | Đăng nhập bằng `ADMIN_PASSWORD`, trả về token dùng 12 giờ |
| GET | `/api/trang-thai` | Tình trạng cấu hình SMS / Email |
| GET | `/api/muon?q=` | Danh sách lượt mượn, có tìm kiếm |
| POST | `/api/muon` | Thêm lượt mượn |
| PUT | `/api/muon/:id` | Sửa lượt mượn |
| DELETE | `/api/muon/:id` | Xóa lượt mượn |
| POST | `/api/muon/:id/tra-sach` | Xác nhận đã trả |
| POST | `/api/muon/:id/gui-lai` | Gửi lại thông báo ngay |
| GET | `/api/sach` · POST `/api/sach` | Kho sách |
| GET | `/api/thong-bao` | Lịch sử thông báo |
| POST | `/api/kiem-tra-ngay` | Chạy kiểm tra hạn trả ngay |
| GET | `/api/thong-ke` | Số liệu tổng hợp |

Ví dụ thêm lượt mượn:

```bash
curl -X POST http://localhost:4000/api/muon \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Nguyễn Văn A","phone":"0912345678","email":"a@gmail.com",
       "book_code":"BOOK001","book_name":"Dế Mèn phiêu lưu ký",
       "borrow_date":"2026-09-15","due_date":"2026-09-20"}'
```

---

## 9. Nạp dữ liệu từ trang web

Ở trang **Danh sách mượn** của website, bấm **Tải CSV**, hoặc ở trang **Thông báo** bấm **Tải hàng chờ gửi (JSON)**. Với tệp JSON danh sách lượt mượn:

```bash
npm run import danh-sach.json
```

---

## 10. Bảo mật

- Tệp `.env` chứa khóa API và mật khẩu — không đưa lên GitHub, không gửi qua chat. Đã có sẵn `.gitignore`.
- Mật khẩu quản trị được so sánh theo kiểu chống dò thời gian; token phiên ký bằng HMAC-SHA256 và hết hạn sau 12 giờ.
- Số điện thoại và Gmail của người mượn chỉ trả về cho yêu cầu đã đăng nhập.
- Dữ liệu nằm trong `data/thu-vien.db`. Nên sao lưu tệp này định kỳ.
- Khi mở ra Internet, hãy đặt máy chủ sau HTTPS (Caddy, Nginx hoặc dịch vụ như Railway, Render).

---

## 11. Cấu trúc thư mục

```
thu-vien-server/
  public/index.html      Giao diện website (mở tại http://localhost:4000)
  public/style.css       Giao diện: màu sắc, bố cục, bản cho điện thoại
  server.js              API, đăng nhập, phục vụ giao diện, lịch chạy tự động
  src/db.js              Bảng dữ liệu và truy vấn SQLite
  src/notify.js          Gửi SMS (Twilio, eSMS) và Email (Gmail, SMTP)
  src/checker.js         Tính trạng thái, tạo hàng chờ, gửi và ghi kết quả
  scripts/test-send.js   Gửi thử SMS và email thật
  scripts/check-now.js   Chạy kiểm tra hạn trả ngay
  scripts/import-queue.js Nạp lượt mượn từ tệp JSON
  .env.example           Mẫu cấu hình
  data/thu-vien.db       Cơ sở dữ liệu (tự tạo khi chạy lần đầu)
```
