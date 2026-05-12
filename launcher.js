'use strict';

if (process.argv.includes('--server')) {
  require('./server');
  return;
}

const { spawn } = require('node:child_process');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const IS_PKG = typeof process.pkg !== 'undefined';
const APP_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname;

const TOOLS_DIR = path.join(APP_DIR, 'tools');
const LOGS_DIR = path.join(APP_DIR, 'logs');
const AUDIO_DIR = process.env.AUDIO_DIR || path.join(APP_DIR, 'audio');
const CLOUDFLARED = path.join(TOOLS_DIR, 'cloudflared.exe');
const TRY_PORTS = [4173, 4174, 4175, 4176];
const CLOUDFLARE_URL_PATTERN = /https:\/\/[-a-zA-Z0-9.]+\.trycloudflare\.com/;

fs.mkdirSync(TOOLS_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });

const color = (code, text) => `\x1b[${code}m${text}\x1b[0m`;
const ok = (text) => console.log(`${color(32, '  [OK]')} ${text}`);
const info = (text) => console.log(`${color(90, '  [..]')} ${text}`);
const warn = (text) => console.log(`${color(33, '  [!!]')} ${text}`);
const fail = (text) => console.log(`${color(31, '  [XX]')} ${text}`);
const row = (label, value) => console.log(`${color(90, `  ${label.padEnd(14)}`)}${color(97, value)}`);

function banner() {
  console.log('');
  console.log(color(36, '  CloudFader'));
  console.log(color(90, '  Synchronized browser playback for live events'));
  console.log('');
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => item.address);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = await new Promise((resolve) => {
      http
        .get(url, (res) => {
          res.resume();
          resolve(res.statusCode < 500);
        })
        .on('error', () => resolve(false));
    });
    if (alive) return true;
    await sleep(300);
  }
  return false;
}

function openBrowser(url) {
  try {
    spawn('cmd', ['/c', 'start', '', url], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  } catch {}
}

function copyToClipboard(value) {
  try {
    spawn('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value '${value.replaceAll("'", "''")}'`], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  } catch {}
}

function download(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'CloudFader/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        download(res.headers.location, destination, redirectsLeft - 1).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const temp = `${destination}.tmp`;
      const file = fs.createWriteStream(temp);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(temp, destination);
          resolve();
        });
      });
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function ensureCloudflared() {
  if (fs.existsSync(CLOUDFLARED)) return true;

  info('Downloading cloudflared.exe...');
  try {
    await download(
      'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
      CLOUDFLARED
    );
    ok('cloudflared.exe is ready');
    return true;
  } catch (error) {
    warn(`Cloudflare tunnel is unavailable: ${error.message}`);
    return false;
  }
}

function spawnServer(port) {
  const args = IS_PKG ? ['--server'] : [path.join(__dirname, 'server.js')];
  return spawn(process.execPath, args, {
    env: { ...process.env, PORT: String(port), AUDIO_DIR },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function spawnCloudflared(port) {
  return spawn(CLOUDFLARED, [
    'tunnel',
    '--no-autoupdate',
    '--protocol',
    'http2',
    '--url',
    `http://localhost:${port}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function waitForCloudflareUrl(process, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const onData = (chunk) => {
      const match = chunk.toString().match(CLOUDFLARE_URL_PATTERN);
      if (!match) return;
      clearTimeout(timer);
      process.stdout.off('data', onData);
      process.stderr.off('data', onData);
      resolve(match[0]);
    };

    process.stdout.on('data', onData);
    process.stderr.on('data', onData);
    process.on('exit', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

async function verifyTunnel(url, attempts = 4, waitSeconds = 7) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      info(`Verifying tunnel (${attempt}/${attempts})...`);
      await sleep(waitSeconds * 1000);
    }

    const alive = await new Promise((resolve) => {
      https
        .get(url, (res) => {
          res.resume();
          resolve(res.statusCode < 500);
        })
        .on('error', () => resolve(false));
    });
    if (alive) return true;
  }
  return false;
}

function showLocalUrls(port) {
  row('Controller', `http://localhost:${port}/`);
  row('Player', `http://localhost:${port}/player.html`);
  for (const address of getLanAddresses()) {
    row('LAN', `http://${address}:${port}/`);
  }
  console.log('');
}

function showPublicUrl(url) {
  console.log('');
  ok(`Public URL: ${url}`);
  copyToClipboard(url);
  info('The public URL was copied to the clipboard when possible.');
  console.log('');
}

async function main() {
  banner();

  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    warn(`Created audio folder: ${AUDIO_DIR}`);
    warn('Add audio files, then restart CloudFader.');
  }

  const audioCount = fs.readdirSync(AUDIO_DIR).filter((file) => /\.(m4a|mp3|wav|ogg)$/i.test(file)).length;
  row('Audio files', String(audioCount));
  row('Audio folder', AUDIO_DIR);
  row('Ports', TRY_PORTS.join(', '));
  console.log('');

  const hasCloudflared = await ensureCloudflared();
  let serverProcess = null;
  let tunnelProcess = null;
  let activePort = null;
  let publicUrl = null;

  const cleanup = () => {
    try { if (tunnelProcess) tunnelProcess.kill(); } catch {}
    try { if (serverProcess) serverProcess.kill(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  for (const port of TRY_PORTS) {
    info(`Starting local server on port ${port}...`);
    serverProcess = spawnServer(port);
    serverProcess.stderr.on('data', (chunk) => {
      fs.appendFileSync(path.join(LOGS_DIR, 'server.err.log'), chunk);
    });

    const serverReady = await Promise.race([
      waitHttp(`http://localhost:${port}/api/state`, 12_000),
      new Promise((resolve) => serverProcess.once('exit', () => resolve(false))),
    ]);

    if (!serverReady) {
      warn(`Port ${port} failed; trying the next port.`);
      try { serverProcess.kill(); } catch {}
      serverProcess = null;
      continue;
    }

    activePort = port;
    ok(`Local server is running on port ${port}`);
    showLocalUrls(port);

    if (!hasCloudflared) break;

    info('Starting Cloudflare Quick Tunnel...');
    tunnelProcess = spawnCloudflared(port);
    const tunnelUrl = await waitForCloudflareUrl(tunnelProcess, 25_000);

    if (tunnelUrl) {
      info('Waiting for Cloudflare tunnel propagation...');
      await sleep(10_000);
      if (await verifyTunnel(`${tunnelUrl}/api/state`)) {
        publicUrl = `${tunnelUrl}/`;
        showPublicUrl(publicUrl);
        break;
      }
      warn('Cloudflare URL was created but did not pass verification.');
    } else {
      warn('Cloudflare did not return a URL in time.');
    }

    try { tunnelProcess.kill(); } catch {}
    try { serverProcess.kill(); } catch {}
    tunnelProcess = null;
    serverProcess = null;
    activePort = null;
  }

  if (!serverProcess) {
    fail('No local port was available.');
    process.exit(1);
  }

  if (!publicUrl) {
    warn('Use the LAN URLs above for devices on the same network.');
  }

  openBrowser(`http://localhost:${activePort}/player.html`);
  info('Press Ctrl+C to stop CloudFader.');

  await new Promise(() => {});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
