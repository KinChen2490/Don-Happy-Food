const { onRequest } = require("firebase-functions/v2/https");
const { google } = require("googleapis");
const nodemailer = require("nodemailer");
const axios = require("axios");

// 初始化 Google Sheets 認證（需在 GCP 啟用 Sheets API 並使用服務帳戶）
const auth = new google.auth.GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

exports.submitOrder = onRequest({ cors: true }, async (req, res) => {
  const { item, user } = req.body;
  const sheets = google.sheets({ version: "v4", auth });
  
  try {
    // 1. 寫入 Google 試算表
    await sheets.spreadsheets.values.append({
      spreadsheetId: "YOUR_SPREADSHEET_ID", // 替換為您的試算表 ID
      range: "Sheet1!A:C",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[new Date().toLocaleString("zh-TW"), user, item]] },
    });

    // 2. 發送 LINE 通知
    await axios.post("https://notify-api.line.me/api/notify", 
      `message=\n🌸 新訂單通知！\n顧客：${user}\n餐點：${item}`,
      { headers: { Authorization: "Bearer YOUR_LINE_NOTIFY_TOKEN" } }
    );

    // 3. 發送 Gmail 通知
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: "YOUR_GMAIL", pass: "YOUR_GMAIL_APP_PASSWORD" } // 填入 Gmail 與應用程式密碼
    });
    await transporter.sendMail({
      from: "YOUR_GMAIL",
      to: "YOUR_GMAIL",
      subject: "【和食處】系統有新訂單！",
      text: `顧客 ${user} 已下單：${item}`
    });

    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ error: err.toString() });
  }
});
