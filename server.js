const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 4173);
const AUDIO_DIR =
  process.env.AUDIO_DIR ||
  path.join(__dirname, "audio");
const PUBLIC_DIR = path.join(__dirname, "public");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".svg": "image/svg+xml",
};

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  console.warn(`Created empty audio directory at ${AUDIO_DIR}. Add audio files and restart.`);
}

const tracks = fs
  .readdirSync(AUDIO_DIR, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(m4a|mp3|wav|ogg)$/i.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant-u-kn-true"))
  .map((entry, index) => {
    const title = entry.name.replace(/\.[^.]+$/, "").replace(/^\d+\.\s*/, "");
    return {
      id: String(index + 1),
      title,
      file: entry.name,
      url: `/audio/${encodeURIComponent(entry.name)}`,
    };
  });

let state = {
  trackId: tracks[0]?.id || null,
  status: "paused",
  volume: 0.85,
  startedAt: 0,
  position: 0,
  updatedAt: Date.now(),
  version: 1,
};

const clients = new Set();
const devices = new Map();

function visibleDevices() {
  const now = Date.now();
  for (const [id, device] of devices) {
    if (now - device.lastSeen > 20_000) devices.delete(id);
  }
  return [...devices.values()]
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "player" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hant-u-kn-true");
    })
    .map((device) => ({
      id: device.id,
      name: device.name,
      role: device.role,
      armed: Boolean(device.armed),
      latencyMs: Math.round(device.latencyMs || 0),
      clockOffsetMs: Math.round(device.clockOffsetMs || 0),
      lastSeen: device.lastSeen,
    }));
}

function recommendedLeadMs() {
  const players = visibleDevices().filter((device) => device.role === "player");
  const armedPlayers = players.filter((device) => device.armed);
  const maxLatency = Math.max(0, ...players.map((device) => device.latencyMs || 0));
  if (armedPlayers.length <= 1) return Math.min(1200, Math.max(320, Math.ceil(maxLatency * 1.4 + 220)));
  return Math.min(3500, Math.max(760, Math.ceil(maxLatency * 2 + 420)));
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function currentPosition(now = Date.now()) {
  if (state.status !== "playing") return state.position;
  return Math.max(0, state.position + (now - state.startedAt) / 1000);
}

function publicState() {
  return {
    ...state,
    serverNow: Date.now(),
    tracks,
    devices: visibleDevices(),
    recommendedLeadMs: recommendedLeadMs(),
  };
}

function broadcast() {
  const payload = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`;
  for (const client of clients) client.write(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function safeJoin(base, name) {
  const relativeName = String(name).replace(/^[\\/]+/, "");
  const filePath = path.resolve(base, relativeName);
  const basePath = path.resolve(base);
  if (!filePath.startsWith(basePath + path.sep)) return null;
  return filePath;
}

function serveAudio(req, res, pathname) {
  const fileName = decodeURIComponent(pathname.replace(/^\/audio\//, ""));
  const filePath = safeJoin(AUDIO_DIR, fileName);
  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = mime[ext] || "application/octet-stream";
  const range = req.headers.range;

  res.setHeader("accept-ranges", "bytes");
  res.setHeader("cache-control", "public, max-age=31536000, immutable");

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      res.writeHead(416, { "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      "content-type": type,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${stat.size}`,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    "content-type": type,
    "content-length": stat.size,
  });
  fs.createReadStream(filePath).pipe(res);
}

function serveStatic(res, pathname) {
  const route = pathname === "/" ? "/index.html" : pathname;
  const filePath = safeJoin(PUBLIC_DIR, decodeURIComponent(route));
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": mime[ext] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleControl(req, res) {
  try {
    const input = await readBody(req);
    const now = Date.now();
    const next = { ...state };

    if (typeof input.volume === "number") {
      next.volume = Math.min(2, Math.max(0, input.volume));
    }

    if (input.trackId && tracks.some((track) => track.id === input.trackId)) {
      if (input.trackId !== next.trackId) next.position = 0;
      next.trackId = input.trackId;
    }

    if (input.action === "play") {
      next.status = "playing";
      next.position = Math.max(0, Number(input.position ?? next.position) || 0);
      next.startedAt = now + Math.min(3500, Math.max(250, Number(input.leadMs) || recommendedLeadMs()));
    }

    if (input.action === "pause") {
      next.position = currentPosition(now);
      next.status = "paused";
      next.startedAt = 0;
    }

    if (input.action === "seek") {
      next.position = Math.max(0, Number(input.position) || 0);
      if (next.status === "playing") next.startedAt = now + 700;
    }

    if (input.action === "stop") {
      next.status = "paused";
      next.position = 0;
      next.startedAt = 0;
    }

    state = {
      ...next,
      updatedAt: now,
      version: state.version + 1,
    };
    broadcast();
    json(res, 200, publicState());
  } catch (error) {
    json(res, 400, { error: error.message });
  }
}

async function handleDevice(req, res) {
  try {
    const input = await readBody(req);
    if (!input.id) return json(res, 400, { error: "missing device id" });

    const existing = devices.get(input.id) || {};
    const device = {
      ...existing,
      id: String(input.id),
      name: String(input.name || existing.name || "未命名裝置").slice(0, 40),
      role: input.role === "player" ? "player" : "controller",
      armed: Boolean(input.armed),
      latencyMs: Math.max(0, Math.min(5000, Number(input.latencyMs) || 0)),
      clockOffsetMs: Math.max(-300_000, Math.min(300_000, Number(input.clockOffsetMs) || 0)),
      lastSeen: Date.now(),
    };
    devices.set(device.id, device);
    broadcast();
    json(res, 200, { ok: true, devices: visibleDevices(), recommendedLeadMs: recommendedLeadMs() });
  } catch (error) {
    json(res, 400, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/state") return json(res, 200, publicState());
  if (url.pathname === "/api/time") return json(res, 200, { serverNow: Date.now() });
  if (url.pathname === "/api/control" && req.method === "POST") return handleControl(req, res);
  if (url.pathname === "/api/device" && req.method === "POST") return handleDevice(req, res);

  if (url.pathname === "/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (url.pathname.startsWith("/audio/")) return serveAudio(req, res, url.pathname);
  return serveStatic(res, url.pathname);
});

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((info) => info && info.family === "IPv4" && !info.internal)
    .map((info) => info.address);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MusicWeb running at http://localhost:${PORT}`);
  for (const address of localAddresses()) {
    console.log(`LAN: http://${address}:${PORT}`);
  }
  console.log(`Audio source: ${AUDIO_DIR}`);
});
