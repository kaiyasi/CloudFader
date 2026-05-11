'use strict';

// ── Server mode（由 launcher spawn 自身時觸發）─────────────────────────────
if (process.argv.includes('--server')) {
  require('./server');
  return;
}

// ── Launcher mode ──────────────────────────────────────────────────────────────
const { spawn } = require('child_process');
const http      = require('http');
const https     = require('https');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');

const IS_PKG  = typeof process.pkg !== 'undefined';
const EXE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

const TOOLS_DIR   = path.join(EXE_DIR, 'tools');
const LOGS_DIR    = path.join(EXE_DIR, 'logs');
const AUDIO_DIR   = process.env.AUDIO_DIR || path.join(EXE_DIR, 'audio');
const CLOUDFLARED = path.join(TOOLS_DIR, 'cloudflared.exe');
const TRY_PORTS   = [4173, 4174, 4175, 4176];
const CF_PAT      = /https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/;

fs.mkdirSync(TOOLS_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR,  { recursive: true });

// ── Terminal ───────────────────────────────────────────────────────────────────
const W = 54;
const Z = '\x1b[0m';
const cc = (n, s) => `\x1b[${n}m${s}${Z}`;

const ok   = s => console.log(cc(32,  '  [OK]') + ' ' + s);
const inf  = s => console.log(cc(90,  '  [..]') + ' ' + s);
const warn = s => console.log(cc(33,  '  [!!]') + ' ' + s);
const err  = s => console.log(cc(31,  '  [XX]') + ' ' + s);
const row  = (l, v) => console.log(cc(90, '  ' + l.padEnd(14)) + cc(97, v));
const hr   = (c = '─') => console.log('  ' + cc(96, c.repeat(W)));

function section(text) {
  const d = W - 4 - text.length;
  console.log('\n  ' + cc(36, `── ${text} ${'─'.repeat(Math.max(0, d))}`));
}

function banner() {
  const title = 'CloudFader  ·  現場活動播音同步系統  ·  Serelix Studio';
  const pad   = ' '.repeat(Math.max(0, W - title.length - 3));
  console.log('');
  console.log('  ' + cc(96, '═'.repeat(W)));
  console.log('  ' + cc(36, `║  ${title}${pad}║`));
  console.log('  ' + cc(96, '═'.repeat(W)));
  console.log('');
}

function showPublicUrl(url) {
  const inner = url + ' ';
  const pad   = ' '.repeat(Math.max(0, W - inner.length - 3));
  console.log('');
  hr('═');
  console.log('  ' + cc(32, `║  公開網址 (Cloudflare)${' '.repeat(W - 22)}║`));
  hr('─');
  console.log('  ' + cc(36, `║  ${inner}${pad}║`));
  hr('═');
  console.log('');
  try {
    spawn('powershell', ['-Command', `Set-Clipboard -Value '${url}'`],
          { stdio: 'ignore', detached: true }).unref();
    console.log(cc(90, '  已複製到剪貼簿。'));
  } catch {}
  console.log('');
}

function showLocalUrls(port) {
  console.log('');
  row('本機控制台', `http://localhost:${port}/`);
  for (const ip of getLanIPs()) row('LAN 控制台', `http://${ip}:${port}/`);
  row('本機播放端', `http://localhost:${port}/player.html`);
  console.log('');
}

function showLanFallback(port) {
  console.log('');
  warn('Cloudflare 全部失敗。同一 Wi-Fi 可用以下 LAN 網址：');
  console.log('');
  for (const ip of getLanIPs()) row('LAN', `http://${ip}:${port}/`);
  console.log('');
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function getLanIPs() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = await new Promise(resolve => {
      http.get(url, res => { res.resume(); resolve(res.statusCode < 500); })
          .on('error', () => resolve(false));
    });
    if (alive) return true;
    await sleep(300);
  }
  return false;
}

function openBrowser(url) {
  try {
    spawn('cmd', ['/c', 'start', '', url],
          { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

// ── Download helper（支援 redirect）───────────────────────────────────────────
function download(url, dest, hops = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'MusicWeb/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops > 0) {
        res.resume();
        return download(res.headers.location, dest, hops - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const tmp = dest + '.tmp';
      const file = fs.createWriteStream(tmp);
      res.pipe(file);
      file.on('finish', () => { fs.renameSync(tmp, dest); resolve(); });
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

// ── Cloudflared management ─────────────────────────────────────────────────────
async function ensureCloudflared() {
  if (fs.existsSync(CLOUDFLARED)) return true;
  inf('cloudflared.exe 未找到，下載中...');
  try {
    await download(
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
      CLOUDFLARED
    );
    ok('cloudflared.exe 下載完成。');
    return true;
  } catch (e) {
    warn(`下載失敗：${e.message}`);
    return false;
  }
}

function spawnCloudflared(port) {
  return spawn(CLOUDFLARED, [
    'tunnel', '--no-autoupdate', '--protocol', 'http2',
    '--url', `http://localhost:${port}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function waitForCfUrl(proc, timeoutMs) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const onData = chunk => {
      const m = chunk.toString().match(CF_PAT);
      if (!m) return;
      clearTimeout(timer);
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onData);
      resolve(m[0]);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', () => { clearTimeout(timer); resolve(null); });
  });
}

async function verifyTunnel(url, attempts = 4, waitSec = 7) {
  for (let i = 1; i <= attempts; i++) {
    if (i > 1) { inf(`尚未連通，重試 (${i}/${attempts})...`); await sleep(waitSec * 1000); }
    const alive = await new Promise(resolve => {
      https.get(url, res => { res.resume(); resolve(res.statusCode < 500); })
           .on('error', () => resolve(false));
    });
    if (alive) return true;
  }
  return false;
}

// ── Server spawn ───────────────────────────────────────────────────────────────
function spawnServer(port) {
  // When packaged: spawn self with --server flag
  // When dev: spawn node server.js
  const args = IS_PKG
    ? ['--server']
    : [path.join(__dirname, 'server.js')];

  const proc = spawn(process.execPath, args, {
    env: { ...process.env, PORT: String(port), AUDIO_DIR },
    stdio: 'pipe',
  });
  proc.stderr.on('data', () => {}); // suppress stderr noise
  return proc;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  banner();

  // Audio folder check
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    warn(`audio/ 資料夾不存在，已自動建立：`);
    warn(AUDIO_DIR);
    warn('請放入音樂檔後重新啟動。');
  }
  const audioCount = fs.readdirSync(AUDIO_DIR).filter(f => /\.(m4a|mp3|wav|ogg)$/i.test(f)).length;
  row('音樂檔', audioCount > 0 ? `${audioCount} 首` : cc(33, '尚無音樂檔'));
  row('音訊位置', AUDIO_DIR);
  row('Port 輪循', TRY_PORTS.join(' → '));
  console.log('');

  const hasCf = await ensureCloudflared();

  let serverProc = null;
  let cfProc     = null;
  let activePort = null;
  let publicUrl  = null;

  // Graceful shutdown
  const cleanup = () => {
    try { if (cfProc)     cfProc.kill();     } catch {}
    try { if (serverProc) serverProc.kill(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT',  cleanup);
  process.on('SIGTERM', cleanup);

  // Port rotation loop
  for (const port of TRY_PORTS) {
    section(`本機服務 (port ${port})`);

    serverProc = spawnServer(port);
    inf('等待伺服器啟動...');

    const up = await Promise.race([
      waitHttp(`http://localhost:${port}/api/state`, 12000),
      new Promise(resolve => serverProc.once('exit', () => resolve(false))),
    ]);

    if (!up) {
      err(`Port ${port} 啟動失敗，嘗試下一個...`);
      try { serverProc.kill(); } catch {}
      serverProc = null;
      continue;
    }

    ok(`伺服器已啟動 (port ${port})`);
    activePort = port;
    showLocalUrls(port);

    if (!hasCf) {
      warn('cloudflared.exe 不可用，僅限 LAN 模式。');
      break;
    }

    section(`Cloudflare Tunnel (port ${port})`);
    cfProc = spawnCloudflared(port);

    inf('等待 Cloudflare URL（最多 25 秒）...');
    const cfUrl = await waitForCfUrl(cfProc, 25000);

    if (cfUrl) {
      ok('URL 已取得，等待隧道穩定（10 秒）...');
      await sleep(10000);
      inf('驗證連線中...');
      if (await verifyTunnel(`${cfUrl}/api/state`)) {
        ok('連線驗證通過。');
        publicUrl = cfUrl + '/';
        showPublicUrl(publicUrl);
        break;
      }
      warn('重試後仍無法連通。');
    } else {
      warn(`25 秒內未出現 Cloudflare URL (port ${port})。`);
    }

    try { cfProc.kill(); }     catch {}
    try { serverProc.kill(); } catch {}
    cfProc = null; serverProc = null; activePort = null;
    inf('嘗試下一個 port...');
  }

  if (!serverProc) {
    err('所有 port 均無法啟動。');
    process.exit(1);
  }

  if (!publicUrl) showLanFallback(activePort);

  openBrowser(`http://localhost:${activePort}/player.html`);

  hr('─');
  console.log(cc(90, '  保持此視窗開啟。按 Ctrl+C 關閉 MusicWeb。'));
  hr('─');
  console.log('');

  // Keep alive
  await new Promise(() => {});
}

main().catch(e => { console.error(e); process.exit(1); });
