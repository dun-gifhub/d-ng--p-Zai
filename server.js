import "dotenv/config";
import express from "express";
import crypto from "node:crypto";
import cron from "node-cron";
import {
  db, listBorrows, getBorrow, createBorrow, createBorrowForAccount, markReturned,
  listNotifications, upsertBook, queueNotification,
  findAccountByIdentifier, createAccount, getUserById, myBorrows,
} from "./src/db.js";
import { runDailyCheck, statusOf, todayISO, flushQueue } from "./src/checker.js";
import { smsConfigured, emailConfigured, smsBody, emailBody, emailSubject } from "./src/notify.js";
import { hashPassword, verifyPassword, makeToken, requireAdmin, requireAccount } from "./src/auth.js";

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(express.static("public"));  // giao dien web tai http://localhost:PORT

/* ============ Kiem tra cau hinh bat buoc ============ */
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
  console.error("Thiếu SESSION_SECRET trong tệp .env (cần ít nhất 16 ký tự). Máy chủ dừng lại.");
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.error("Thiếu ADMIN_PASSWORD trong tệp .env. Máy chủ dừng lại.");
  process.exit(1);
}
const auth = requireAdmin; // giu ten cu cho cac duong dan quan tri ben duoi

app.post("/api/dang-nhap", (req, res) => {
  const given = String(req.body?.password || "");
  const real = String(process.env.ADMIN_PASSWORD);
  const ok = given.length === real.length &&
    crypto.timingSafeEqual(Buffer.from(given.padEnd(64, "\0")), Buffer.from(real.padEnd(64, "\0")));
  if (!ok) return res.status(401).json({ error: "Mật khẩu không đúng." });
  res.json({ token: makeToken({ role: "admin" }) });
});

/* ============ Tai khoan nguoi muon (hoc sinh tu dang ky) ============ */
app.post("/api/dang-ky", (req, res) => {
  const { name, phone, email, password } = req.body || {};
  const errors = [];
  if (!name || String(name).trim().length < 2) errors.push("Họ và tên không được để trống.");
  if (!isPhone(phone)) errors.push("Số điện thoại không hợp lệ.");
  if (!isMail(email)) errors.push("Gmail không hợp lệ.");
  if (!password || String(password).length < 6) errors.push("Mật khẩu cần ít nhất 6 ký tự.");
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });

  try {
    const { salt, hash } = hashPassword(String(password));
    const id = createAccount({ name: name.trim(), phone: phone.trim(), email: email.trim().toLowerCase(), hash, salt });
    const token = makeToken({ role: "docgia", uid: id });
    res.status(201).json({ token, name: name.trim() });
  } catch (e) {
    if (e.code === "ACCOUNT_EXISTS") return res.status(409).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Không tạo được tài khoản." });
  }
});

app.post("/api/dang-nhap-doc-gia", (req, res) => {
  const { dinh_danh, password } = req.body || {};
  const acc = findAccountByIdentifier(dinh_danh);
  if (!acc || !verifyPassword(String(password || ""), acc.password_salt, acc.password_hash)) {
    return res.status(401).json({ error: "Số điện thoại/Gmail hoặc mật khẩu không đúng." });
  }
  res.json({ token: makeToken({ role: "docgia", uid: acc.id }), name: acc.name });
});

app.get("/api/toi", requireAccount, (req, res) => {
  const u = getUserById(req.uid);
  if (!u) return res.status(404).json({ error: "Không tìm thấy tài khoản." });
  res.json(u);
});

app.get("/api/toi/luot-muon", requireAccount, (req, res) => {
  const today = todayISO();
  res.json(myBorrows(req.uid).map((r) => ({ ...r, trang_thai: statusOf(r, today) })));
});

app.post("/api/toi/muon", requireAccount, (req, res) => {
  const b = { ...(req.body || {}), book_code: String(req.body?.book_code || "").trim().toUpperCase() };
  const errors = [];
  if (!b.book_code) errors.push("Thiếu mã sách.");
  if (!isDate(b.borrow_date)) errors.push("Ngày mượn không hợp lệ.");
  if (!isDate(b.due_date)) errors.push("Ngày trả không hợp lệ.");
  if (isDate(b.borrow_date) && isDate(b.due_date) && b.due_date < b.borrow_date)
    errors.push("Ngày trả không được trước ngày mượn.");
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  try {
    const id = createBorrowForAccount(req.uid, b);
    res.status(201).json(getBorrow.get(id));
  } catch (e) {
    if (e.code === "BOOK_BUSY") return res.status(409).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Không lưu được lượt mượn." });
  }
});

/** Danh sach sach cong khai (khong lo thong tin ca nhan) de hoc sinh chon ma sach truoc khi dang nhap. */
app.get("/api/sach-cong-khai", (req, res) => {
  res.json(db.prepare("SELECT book_code, book_name, author, category, status FROM books ORDER BY book_code").all());
});

/* ============ Kiem tra du lieu ============ */
const isPhone = (p) => /^(0|\+?84)\d{8,10}$/.test(String(p).replace(/[\s.-]/g, ""));
const isMail = (m) => /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(m));
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d));

function validateBorrow(b) {
  const e = [];
  if (!b.name || String(b.name).trim().length < 2) e.push("Họ và tên không được để trống.");
  if (!isPhone(b.phone)) e.push("Số điện thoại không hợp lệ.");
  if (!isMail(b.email)) e.push("Gmail không hợp lệ.");
  if (!b.book_code) e.push("Thiếu mã sách.");
  if (!isDate(b.borrow_date)) e.push("Ngày mượn không hợp lệ.");
  if (!isDate(b.due_date)) e.push("Ngày trả không hợp lệ.");
  if (isDate(b.borrow_date) && isDate(b.due_date) && b.due_date < b.borrow_date)
    e.push("Ngày trả không được trước ngày mượn.");
  return e;
}

/* ============ API ============ */
app.get("/api/trang-thai", (req, res) => {
  res.json({
    ngay_hom_nay: todayISO(),
    sms: smsConfigured() ? "da-cau-hinh" : "chua-cau-hinh",
    email: emailConfigured() ? "da-cau-hinh" : "chua-cau-hinh",
    lich_chay: process.env.CRON_SCHEDULE || "0 8 * * *",
  });
});

app.get("/api/muon", auth, (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  const today = todayISO();
  let rows = listBorrows.all().map((r) => ({ ...r, trang_thai: statusOf(r, today) }));
  if (q) rows = rows.filter((r) => [r.name, r.phone, r.email, r.book_code, r.book_name].join(" ").toLowerCase().includes(q));
  res.json(rows);
});

app.post("/api/muon", auth, (req, res) => {
  const errors = validateBorrow(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  try {
    const id = createBorrow(req.body);
    res.status(201).json(getBorrow.get(id));
  } catch (e) {
    if (e.code === "BOOK_BUSY") return res.status(409).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: "Không lưu được lượt mượn." });
  }
});

app.put("/api/muon/:id", auth, (req, res) => {
  const rec = getBorrow.get(req.params.id);
  if (!rec) return res.status(404).json({ error: "Không tìm thấy lượt mượn." });
  const merged = { ...rec, ...req.body };
  const errors = validateBorrow(merged);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  db.prepare("UPDATE users SET name=?, phone=?, email=? WHERE id=?")
    .run(merged.name, merged.phone, merged.email, rec.user_id);
  db.prepare("UPDATE borrow_records SET borrow_date=?, due_date=? WHERE id=?")
    .run(merged.borrow_date, merged.due_date, rec.id);
  res.json(getBorrow.get(rec.id));
});

app.post("/api/muon/:id/tra-sach", auth, (req, res) => {
  const out = markReturned(req.params.id, {
    actual_return_date: req.body?.actual_return_date || todayISO(),
    confirmed_by: req.body?.confirmed_by || "Quản trị viên",
  });
  if (!out) return res.status(404).json({ error: "Không tìm thấy lượt mượn." });
  res.json(out);
});

app.delete("/api/muon/:id", auth, (req, res) => {
  const rec = getBorrow.get(req.params.id);
  if (!rec) return res.status(404).json({ error: "Không tìm thấy lượt mượn." });
  db.prepare("DELETE FROM notifications WHERE borrow_record_id = ?").run(rec.id);
  db.prepare("DELETE FROM borrow_records WHERE id = ?").run(rec.id);
  if (rec.status === "borrowing") db.prepare("UPDATE books SET status='available' WHERE id=?").run(rec.book_id);
  res.json({ ok: true });
});

app.get("/api/sach", auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM books ORDER BY book_code").all());
});

app.post("/api/sach", auth, (req, res) => {
  if (!req.body?.book_code) return res.status(400).json({ error: "Thiếu mã sách." });
  const id = upsertBook(req.body);
  res.status(201).json(db.prepare("SELECT * FROM books WHERE id = ?").get(id));
});

app.get("/api/thong-bao", auth, (req, res) => res.json(listNotifications.all()));

/** Gui lai thong bao cho mot luot muon, ngay lap tuc */
app.post("/api/muon/:id/gui-lai", auth, async (req, res) => {
  const rec = getBorrow.get(req.params.id);
  if (!rec) return res.status(404).json({ error: "Không tìm thấy lượt mượn." });
  if (rec.status === "returned") return res.status(400).json({ error: "Lượt mượn này đã trả sách." });
  const today = todayISO();
  const overdue = rec.due_date < today;
  const stamp = `thucong-${Date.now()}`;
  if ((process.env.SMS_PROVIDER || "none") !== "none")
    queueNotification({ borrow_record_id: rec.id, type: "sms", rule_key: stamp, run_date: today,
      recipient: rec.phone, subject: null, body: smsBody(rec, overdue) });
  if ((process.env.EMAIL_PROVIDER || "none") !== "none")
    queueNotification({ borrow_record_id: rec.id, type: "email", rule_key: stamp, run_date: today,
      recipient: rec.email, subject: emailSubject(rec), body: emailBody(rec, overdue).text });
  res.json(await flushQueue());
});

/** Chay kiem tra han tra ngay lap tuc (khong cho toi gio cron) */
app.post("/api/kiem-tra-ngay", auth, async (req, res) => res.json(await runDailyCheck()));

app.get("/api/thong-ke", auth, (req, res) => {
  const today = todayISO();
  const rows = listBorrows.all();
  const c = { tong_sach: db.prepare("SELECT COUNT(*) n FROM books").get().n, dang_muon: 0, sap_den_han: 0, hom_nay: 0, qua_han: 0, da_tra: 0 };
  for (const r of rows) {
    const s = statusOf(r, today);
    if (s === "returned") c.da_tra++;
    else { c.dang_muon++; if (s === "due_soon") c.sap_den_han++; else if (s === "due_today") c.hom_nay++; else if (s === "overdue") c.qua_han++; }
  }
  res.json(c);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Máy chủ gặp lỗi khi xử lý yêu cầu." });
});

/* ============ Tien trinh tu dong hang ngay ============ */
const schedule = process.env.CRON_SCHEDULE || "0 8 * * *";
if (cron.validate(schedule)) {
  cron.schedule(schedule, () => { runDailyCheck().catch(console.error); },
    { timezone: process.env.TIMEZONE || "Asia/Ho_Chi_Minh" });
  console.log(`Tiến trình tự động đã bật: chạy theo lịch "${schedule}" (${process.env.TIMEZONE || "Asia/Ho_Chi_Minh"}).`);
} else {
  console.warn(`CRON_SCHEDULE "${schedule}" không hợp lệ, tiến trình tự động chưa bật.`);
}

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Mở trình duyệt tại http://localhost:${port} để dùng website.`);
  console.log(`SMS: ${smsConfigured() ? "đã cấu hình" : "CHƯA cấu hình"} · Email: ${emailConfigured() ? "đã cấu hình" : "CHƯA cấu hình"}`);
});
