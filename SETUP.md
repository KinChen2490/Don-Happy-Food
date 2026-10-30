# 丼樂食上線設定

## 試算表欄位

主食菜單建立 A:F：品項名稱、售價、啟用、排序、分類、圖片網址。

加購品項與單點品項建立 A:H：品項名稱、售價、啟用、排序、分類、用途、複選、圖片網址。啟用與複選統一使用 TRUE 或 FALSE。

用途固定填寫如下：

- 套餐：每一份主食最多選一份。
- 套餐選項：僅在已選套餐時出現；相同分類為一組。例：分類填湯品濃淡或小菜，複選填 FALSE。
- 主餐加購：顯示於主食設定，選取後按主食份數計價。
- 單點加購：顯示於單點區。

在「丼樂食線上點餐清單」標題列，於「手機號碼」後新增「訂購人 Email」。後端依標題名稱寫入，不依賴欄位位置。

## Google Sheets 權限

在 Google Cloud 專案啟用 Google Sheets API，並將試算表的編輯權限授予 Cloud Functions 的預設 Compute Engine service account。

## 通知密鑰

於專案根目錄執行下列四個命令，Gmail 請使用已啟用兩步驟驗證的應用程式密碼：

    firebase functions:secrets:set GMAIL_USER
    firebase functions:secrets:set GMAIL_APP_PASSWORD
    firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
    firebase functions:secrets:set LINE_TARGET_ID

LINE 尚未設定時不會阻擋訂單回寫與 Email；通知狀態會記錄在試算表。

## 部署與測試

    Set-Location functions
    npm install
    npm run lint
    Set-Location ..
    firebase deploy --only functions,hosting

Firebase 專案必須採用 Blaze 方案才可部署第 2 代 Cloud Functions。上線前請送出一筆測試訂單，確認試算表回寫、店家信箱與客戶信箱皆正確。
