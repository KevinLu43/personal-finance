# 讓手機 / 其他電腦直接開網址使用(資料存在你的 Google 試算表)

App 是純靜態網頁,部署後打開網址 → 用 Google 登入 → 資料讀寫你自己 Google Drive 裡的「個人財務資料」試算表。
程式不會看到你 Drive 的其他檔案(權限只有 `drive.file`)。

## 1. 推到 GitHub 並開啟 Pages
1. 在 GitHub 建一個 repo(注意:GitHub Pages 免費版需要 **public** repo;程式碼公開但**資料不在裡面**,資料在你的 Google 試算表)。
2. 在專案資料夾:`git remote add origin <repo 網址>`、`git push -u origin main`。
3. repo → Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
4. 到 Actions 分頁等部署完成,網址通常是 `https://<帳號>.github.io/<repo 名>/`。

## 2. 建立 Google OAuth Client ID(只需要「公開的 Client ID」,不需要任何密鑰)
1. 到 <https://console.cloud.google.com/> 建立一個專案。
2. 「API 和服務」→「程式庫」:啟用 **Google Sheets API** 與 **Google Drive API**。
3. 「OAuth 同意畫面」:User Type 選 **外部**,填 App 名稱與你的 email;「測試使用者」加入**你自己的 Google 帳號**(維持「測試中」狀態即可,不用送審)。
4. 「憑證」→ 建立憑證 → **OAuth 用戶端 ID** → 應用程式類型 **網頁應用程式**。
   「已授權的 JavaScript 來源」加入:
   - 部署網址的**來源**(只到網域,例如 `https://<帳號>.github.io`,不含路徑與結尾斜線)
   - 本機測試用 `http://localhost:8642`
5. 複製產生的 Client ID(`xxxx.apps.googleusercontent.com`)。

## 3. 填入 Client ID
把 `app/js/config.js` 的 `googleClientId` 填上,commit 並 push,等 Pages 重新部署。
(Client ID 本來就是公開資訊,放進 repo 沒問題。)

> 「測試中」狀態的登入授權大約 7 天會過期,屆時只是需要重新按一次登入。

## 4. 把現有資料搬過去
1. 在原本的電腦開 `http://localhost:8642/?local=1`(`?local=1` 代表用舊的本機儲存),到「帳戶」頁匯出備份。
2. 打開部署後的網址並登入 Google,到「帳戶」頁匯入剛剛的備份檔。
3. 之後手機、其他電腦開同一網址、登入同一個 Google 帳號即可看到相同資料。
   (本機的舊資料保留在瀏覽器裡,不會被刪除。)

## 注意
- 需要網路;斷線時修改會暫存並在恢復後重試,右上/右下角的狀態列會顯示「同步中 / 已同步 / 同步失敗」。
- 兩台裝置同時編輯同一筆資料時,後寫入者覆蓋前者(個人使用通常不會遇到)。
- 切回 App 時會自動重新讀取試算表,看到其他裝置的變更。
- 不要手動改試算表第一列(表頭)與第一欄(id);可以放心手動查看、下載或備份這份試算表。
