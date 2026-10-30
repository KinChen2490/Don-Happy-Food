const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const crypto = require("node:crypto");

const spreadsheetId = "18VwTlEAQXZHK0dG77hqewO1rIdZXCojOHtBFXw52gB4";
const gmailUser = defineSecret("GMAIL_USER");
const gmailAppPassword = defineSecret("GMAIL_APP_PASSWORD");
const lineChannelAccessToken = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
const lineTargetId = defineSecret("LINE_TARGET_ID");
const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets"] });

function isEnabled(value) { return [true, "true", "TRUE", "1", "是"].includes(value); }
function item(row, imageIndex, source) {
  return { name: String(row[0] || "").trim(), price: Number(row[1]) || 0, enabled: isEnabled(row[2]),
    sort: Number(row[3]) || 9999, category: String(row[4] || "其他").trim(), purpose: String(row[5] || "").trim(),
    multiple: isEnabled(row[6]), imageUrl: String(row[imageIndex] || "").trim(), source };
}
function sheets() { return google.sheets({ version: "v4", auth }); }
async function readMenu() {
  const result = await sheets().spreadsheets.values.batchGet({
    spreadsheetId, ranges: ["主食菜單!A2:F", "加購品項!A2:H", "單點品項!A2:H"] });
  const ranges = result.data.valueRanges.map((range) => range.values || []);
  const mains = ranges[0].map((row) => item(row, 5, "main")).filter((x) => x.name && x.enabled);
  const addOns = ranges[1].map((row) => item(row, 7, "addOn"))
    .concat(ranges[2].map((row) => item(row, 7, "single"))).filter((x) => x.name && x.enabled);
  const sort = (a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-Hant");
  return { mains: mains.sort(sort), addOns: addOns.sort(sort) };
}
function text(value, max) { return String(value || "").trim().replace(/[\r\n]+/g, " ").slice(0, max || 500); }
function summary(lines) { return lines.map((x) => text(x.name, 120) + " x" + Math.min(Math.max(Number(x.quantity) || 1, 1), 99)).join("；"); }
function money(value) { return "NT$ " + Number(value).toLocaleString("zh-TW"); }
async function repriceOrder(order) {
  const menu = await readMenu();
  const known = new Map(menu.mains.concat(menu.addOns).map((x) => [x.name, x]));
  const validPurpose = {
    main: (x) => x.source === "main",
    package: (x) => x.purpose === "套餐",
    packageOption: (x) => x.purpose === "套餐選項",
    extra: (x) => x.purpose === "主餐加購",
    single: (x) => x.purpose === "單點加購" || x.source === "single",
  };
  const lines = (order.lines || []).map((line) => {
    const catalogName = text(line.catalogName || line.name, 120);
    const product = known.get(catalogName);
    const quantity = Number(line.quantity);
    if (!product || !validPurpose[line.type] || !validPurpose[line.type](product) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error("訂單包含無效或已下架的品項，請重新整理菜單後再送出。");
    }
    return { name: text(line.name, 160), catalogName, price: product.price, quantity, type: line.type };
  });
  const mainQuantity = lines.filter((line) => line.type === "main").reduce((sum, line) => sum + line.quantity, 0);
  const packageQuantity = lines.filter((line) => line.type === "package").reduce((sum, line) => sum + line.quantity, 0);
  if (packageQuantity > mainQuantity) throw new Error("每份主食最多只能搭配一份套餐。");
  order.lines = lines;
  order.total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
}
function validate(order) {
  const c = order.customer || {}, time = text(order.pickupTime, 10), total = Number(order.total);
  if (!text(c.name, 60) || !text(c.phone, 30) || !text(c.email, 160)) throw new Error("請完整填寫姓名、手機號碼與 Email。");
  if (!/^\S+@\S+\.\S+$/.test(c.email)) throw new Error("Email 格式不正確。");
  if (!/^([01]\d|2[0-1]):[0-5]\d$/.test(time)) throw new Error("取餐時間格式不正確。");
  const parts = time.split(":").map(Number);
  if (order.pickupMethod !== "自取" || parts[0] < 11 || parts[0] > 21 || (parts[0] === 21 && parts[1] > 0)) throw new Error("目前僅開放 11:00–21:00 自取。");
  if (new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(new Date()) === "Wed") {
    throw new Error("每週三公休，暫不接受訂單。");
  }
  if (!Array.isArray(order.lines) || !order.lines.length || !Number.isInteger(total) || total <= 0) throw new Error("請加入餐點，且訂單總額必須大於 0。");
}
async function appendOrder(order, id, notificationStatus) {
  const client = sheets();
  const headers = (await client.spreadsheets.values.get({ spreadsheetId, range: "丼樂食線上點餐清單!1:1" })).data.values?.[0] || [];
  if (!headers.length) throw new Error("找不到「丼樂食線上點餐清單」的欄位標題列。");
  const lines = order.lines;
  const values = {
    "訂單時間": new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date()),
    "訂單編號": id, "訂餐人姓名": text(order.customer.name, 60), "手機號碼": text(order.customer.phone, 30),
    "訂購人 Email": text(order.customer.email, 160), "取餐方式": "自取", "取餐時間": text(order.pickupTime, 10),
    "訂單品項明細": summary(lines), "主食數量明細": summary(lines.filter((x) => x.type === "main")),
    "套餐明細": summary(lines.filter((x) => x.type === "package" || x.type === "packageOption")),
    "額外加購明細": summary(lines.filter((x) => x.type === "extra" || x.type === "single")),
    "調味需求": text(order.seasoning), "特別需求": text(order.specialRequest), "其他備註": text(order.note),
    "訂單總額": order.total, "訂單狀態": "已送出", "通知狀態": notificationStatus };
  await client.spreadsheets.values.append({ spreadsheetId, range: "丼樂食線上點餐清單!A:ZZ", valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers.map((header) => values[String(header).trim()] || "")] } });
}
async function sendEmail(order, id) {
  const user = gmailUser.value(), password = gmailAppPassword.value();
  if (!user || !password) return "Email 尚未設定";
  const body = ["訂單編號：" + id, "訂餐人：" + order.customer.name, "電話：" + order.customer.phone,
    "取餐方式：自取", "取餐時間：" + order.pickupTime, "餐點：" + summary(order.lines),
    "訂單總額：" + money(order.total), order.note ? "備註：" + order.note : ""].filter(Boolean).join("\n");
  const mailer = nodemailer.createTransport({ service: "gmail", auth: { user, pass: password } });
  await mailer.sendMail({ from: "丼樂食訂餐系統 <" + user + ">", to: [user, order.customer.email],
    subject: "【丼樂食】訂單已送出 " + id, text: body });
  return "Email 已發送";
}
async function sendLine(order, id) {
  const token = lineChannelAccessToken.value(), target = lineTargetId.value();
  if (!token || !target) return "LINE 尚未設定";
  const message = "🍚 丼樂食新訂單\n訂單：" + id + "\n" + order.customer.name + "／" + order.customer.phone + "\n自取 " + order.pickupTime + "\n" + summary(order.lines) + "\n" + money(order.total);
  const result = await fetch("https://api.line.me/v2/bot/message/push", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ to: target, messages: [{ type: "text", text: message }] }) });
  if (!result.ok) throw new Error("LINE 通知失敗：" + await result.text());
  return "LINE 已發送";
}
function cors(res) { res.set("Access-Control-Allow-Origin", "*"); res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.set("Access-Control-Allow-Headers", "Content-Type"); }
exports.api = onRequest({ region: "asia-east1", cors: false, secrets: [gmailUser, gmailAppPassword, lineChannelAccessToken, lineTargetId] }, async (req, res) => {
  cors(res); if (req.method === "OPTIONS") return res.status(204).send("");
  try {
    if (req.method === "GET" && req.path === "/menu") return res.json(await readMenu());
    if (req.method === "POST" && req.path === "/orders") {
      const order = req.body || {}; await repriceOrder(order); validate(order);
      const id = "DL" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
      let email = "Email 尚未設定", line = "LINE 尚未設定";
      try { email = await sendEmail(order, id); } catch (error) { email = "Email 失敗：" + error.message; }
      try { line = await sendLine(order, id); } catch (error) { line = "LINE 失敗：" + error.message; }
      await appendOrder(order, id, email + "；" + line);
      return res.status(201).json({ orderId: id, message: "訂單已送出", notificationStatus: email + "；" + line });
    }
    return res.status(404).json({ error: "找不到 API 路徑。" });
  } catch (error) { console.error(error); return res.status(400).json({ error: error.message || "訂單處理失敗。" }); }
});
