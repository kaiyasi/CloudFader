# CloudFader

**Multi-device synchronized music playback for live events.**  
One computer plays, any phone controls — no app required.

Developed by **[Serelix Studio](https://github.com/kaiyasi)**

[繁體中文](#繁體中文) · [日本語](#日本語) · [한국어](#한국어) · [Русский](#русский)

---

## Download

Get the latest `CloudFader.exe` from the **[Releases](https://github.com/kaiyasi/CloudFader/releases/latest)** page — no installation needed.

---

## Quick Start

1. Download `CloudFader.exe` from [Releases](https://github.com/kaiyasi/CloudFader/releases/latest)
2. Create an `audio/` folder next to the exe, place your music files inside (`.mp3` / `.m4a` / `.wav` / `.ogg`)
3. Double-click `CloudFader.exe`
4. The terminal shows a public Cloudflare URL and local LAN URLs

> First launch auto-downloads `cloudflared.exe` — internet required.

## How It Works

| Device | Role |
|--------|------|
| Playback PC / speaker device | Open `/player.html`, click **Enable** |
| Controller (phone / tablet) | Open the control console URL shown in terminal |

The controller sets playback state; all player devices sync in real time via SSE.  
Cloudflare Quick Tunnel provides a public URL so players on different networks can connect.

## Development

```
Node.js >= 18
npm install
node launcher.js
```

Build locally: `npm run build` → outputs `CloudFader.exe`

## Architecture

| File | Purpose |
|------|---------|
| `launcher.js` | Entry point — spawns server, manages Cloudflare tunnel, port rotation |
| `server.js` | HTTP + SSE state sync server |
| `public/` | Controller (`/`) and player (`/player.html`) web UI |

---

## Contributing

Issues and pull requests are welcome!  
For questions or feedback, contact **zengcode0315@gmail.com**

---

## 繁體中文

**多裝置即時同步播音系統，專為現場活動設計。**  
一台電腦播放，任何手機控制，不需安裝 app。

由 **Serelix Studio** 開發。

### 下載

前往 **[Releases](https://github.com/kaiyasi/CloudFader/releases/latest)** 頁面下載最新版 `CloudFader.exe`。

### 快速開始

1. 從 [Releases](https://github.com/kaiyasi/CloudFader/releases/latest) 下載 `CloudFader.exe`
2. 在同目錄建立 `audio/` 資料夾，放入音樂檔（`.mp3` / `.m4a` / `.wav` / `.ogg`）
3. 雙擊執行 `CloudFader.exe`
4. 終端機會顯示 Cloudflare 公開網址與 LAN 網址

> 首次啟動會自動下載 `cloudflared.exe`，需要網路連線。

### 裝置配置

| 裝置 | 角色 |
|------|------|
| 播放電腦 / 音響設備 | 開啟 `/player.html`，點擊「啟用此裝置播放」 |
| 控制端（手機 / 平板） | 開啟控制台網址 |

### 貢獻與問題回報

歡迎 Issue 與 Pull Request。  
有任何問題請聯絡 **zengcode0315@gmail.com**

---

## 日本語

**ライブイベント向けのマルチデバイス同期音楽再生システム。**  
1台のPCで再生、スマートフォンでコントロール — アプリ不要。

**Serelix Studio** が開発。

### ダウンロード

**[Releases](https://github.com/kaiyasi/CloudFader/releases/latest)** から最新版 `CloudFader.exe` をダウンロードしてください。

### クイックスタート

1. [Releases](https://github.com/kaiyasi/CloudFader/releases/latest) から `CloudFader.exe` をダウンロード
2. exe と同じ場所に `audio/` フォルダを作成し、音楽ファイルを配置（`.mp3` / `.m4a` / `.wav` / `.ogg`）
3. `CloudFader.exe` をダブルクリック
4. ターミナルに Cloudflare 公開URLとローカルLAN URLが表示されます

> 初回起動時に `cloudflared.exe` を自動ダウンロードします（インターネット接続が必要です）。

### デバイス構成

| デバイス | 役割 |
|--------|------|
| 再生PC / スピーカーデバイス | `/player.html` を開き、**有効化** をクリック |
| コントローラー（スマートフォン / タブレット） | コントロールコンソールのURLを開く |

### コントリビュート

IssueやPull Requestを歓迎します。  
お問い合わせは **zengcode0315@gmail.com** まで。

---

## 한국어

**라이브 이벤트를 위한 멀티 디바이스 동기화 음악 재생 시스템.**  
컴퓨터 한 대로 재생, 스마트폰으로 제어 — 앱 설치 불필요.

**Serelix Studio** 개발.

### 다운로드

**[Releases](https://github.com/kaiyasi/CloudFader/releases/latest)** 페이지에서 최신 `CloudFader.exe`를 다운로드하세요.

### 빠른 시작

1. [Releases](https://github.com/kaiyasi/CloudFader/releases/latest)에서 `CloudFader.exe` 다운로드
2. exe 파일과 같은 위치에 `audio/` 폴더를 만들고 음악 파일 추가 (`.mp3` / `.m4a` / `.wav` / `.ogg`)
3. `CloudFader.exe` 더블클릭
4. 터미널에 Cloudflare 공개 URL과 로컬 LAN URL이 표시됩니다

> 최초 실행 시 `cloudflared.exe`를 자동으로 다운로드합니다 (인터넷 연결 필요).

### 디바이스 구성

| 디바이스 | 역할 |
|--------|------|
| 재생 PC / 스피커 장치 | `/player.html` 열기, **활성화** 클릭 |
| 컨트롤러 (스마트폰 / 태블릿) | 컨트롤 콘솔 URL 열기 |

### 기여하기

Issue와 Pull Request를 환영합니다.  
문의사항은 **zengcode0315@gmail.com** 으로 연락해 주세요.

---

## Русский

**Система синхронизированного воспроизведения музыки для мероприятий.**  
Один компьютер воспроизводит, любой телефон управляет — без установки приложений.

Разработано **Serelix Studio**.

### Загрузка

Скачайте последнюю версию `CloudFader.exe` на странице **[Releases](https://github.com/kaiyasi/CloudFader/releases/latest)**.

### Быстрый старт

1. Скачайте `CloudFader.exe` из раздела [Releases](https://github.com/kaiyasi/CloudFader/releases/latest)
2. Создайте папку `audio/` рядом с exe-файлом и поместите туда музыкальные файлы (`.mp3` / `.m4a` / `.wav` / `.ogg`)
3. Дважды щёлкните `CloudFader.exe`
4. В терминале появятся публичный URL Cloudflare и локальные LAN-адреса

> При первом запуске автоматически загружается `cloudflared.exe` — требуется интернет.

### Конфигурация устройств

| Устройство | Роль |
|--------|------|
| Воспроизводящий ПК / акустическая система | Открыть `/player.html`, нажать **Включить** |
| Контроллер (телефон / планшет) | Открыть URL консоли управления |

### Участие в разработке

Приветствуются Issue и Pull Request.  
По вопросам пишите на **zengcode0315@gmail.com**

---

MIT License · © Serelix Studio
