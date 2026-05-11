# MusicWeb — 畢業典禮播音同步系統

多裝置即時同步播音，一台電腦當播放器，手機網頁當控制台。

## 快速開始（免安裝版）

1. 從 [Releases](../../releases/latest) 下載 `musicweb.exe`
2. 在同目錄建立 `audio/` 資料夾，放入音樂檔（`.mp3` / `.m4a` / `.wav` / `.ogg`）
3. 雙擊執行 `musicweb.exe`
4. 終端機會顯示公開 Cloudflare 網址與 LAN 網址

> 首次啟動會自動下載 `cloudflared.exe`，需要網路。

---

## 開發模式

```
node >= 18
npm install
node launcher.js
```

`npm run build` 可本地打包成 `musicweb.exe`（需先 `npm install`）。

---

## 架構

- `launcher.js` — 入口：啟動 HTTP 子程序、管理 Cloudflare tunnel、port 輪循
- `server.js` — HTTP + SSE 伺服器，負責狀態同步
- `public/` — 控制台（`/`）與播放端（`/player.html`）

---

MIT
