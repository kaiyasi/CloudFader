const isPlayer = document.body.dataset.mode === "player";
const audio = document.getElementById("audio");
const currentTitle = document.getElementById("currentTitle");
const syncStatus = document.getElementById("syncStatus");
const trackList = document.getElementById("trackList");
const playPause = document.getElementById("playPause");
const playIcon = document.getElementById("playIcon");
const stopButton = document.getElementById("stopButton");
const armButton = document.getElementById("armButton");
const seek = document.getElementById("seek");
const elapsed = document.getElementById("elapsed");
const duration = document.getElementById("duration");
const volume = document.getElementById("volume");
const volumeValue = document.getElementById("volumeValue");
const volumeEcho = document.getElementById("volumeEcho");
const playerHint = document.getElementById("playerHint");
const deviceList = document.getElementById("deviceList");
const leadStatus = document.getElementById("leadStatus");
const deviceSummary = document.getElementById("deviceSummary");
const devicePanel = document.getElementById("devicePanel");
const deviceToggle = document.getElementById("deviceToggle");

const deviceIdKey = "musicweb-device-id";
const deviceNameKey = "musicweb-device-name";

let deviceId = localStorage.getItem(deviceIdKey);
if (!deviceId) {
  deviceId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  localStorage.setItem(deviceIdKey, deviceId);
}

let deviceName = localStorage.getItem(deviceNameKey);
if (!deviceName) {
  deviceName = `${isPlayer ? "播放端" : "控制台"} ${deviceId.slice(0, 4)}`;
  localStorage.setItem(deviceNameKey, deviceName);
}

let tracks = [];
let state = null;
let selectedTrack = null;
let clockOffset = 0;
let measuredLatency = 0;
let armed = false;
let seeking = false;
let lastVersionApplied = 0;
let pendingTimer = 0;
let volumeSendTimer = 0;
let lastVolumeSent = null;
let lastLocalVolumeAt = 0;
let driftCheckAt = 0;
let audioContext = null;
let gainNode = null;
let mediaSource = null;

function serverNow() {
  return Date.now() + clockOffset;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const safe = Math.max(0, seconds);
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function roleLabel(role) {
  return role === "player" ? "播放端" : "控制台";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    cache: "no-store",
    ...options,
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function sendControl(input) {
  const next = await api("/api/control", {
    method: "POST",
    body: JSON.stringify(input),
  });
  applyState(next);
}

function scheduleVolumeSync(immediate = false) {
  if (isPlayer) return;
  const nextVolume = uiVolumeToGain();
  if (nextVolume === lastVolumeSent && !immediate) return;

  window.clearTimeout(volumeSendTimer);
  const send = () => {
    lastVolumeSent = nextVolume;
    sendControl({ volume: nextVolume }).catch(() => {});
  };

  if (immediate) {
    send();
    return;
  }

  volumeSendTimer = window.setTimeout(send, 35);
}

function uiVolumeToGain() {
  return Math.min(2, Math.max(0, Number(volume.value) / 100));
}

function gainToUiVolume(gain) {
  return Math.round(Math.min(2, Math.max(0, gain ?? 0.85)) * 100);
}

function applyOutputGain(gain) {
  const safeGain = Math.min(2, Math.max(0, gain ?? 0.85));
  if (gainNode) {
    gainNode.gain.setTargetAtTime(safeGain, audioContext.currentTime, 0.015);
    audio.volume = 1;
    return;
  }
  audio.volume = Math.min(1, safeGain);
}

async function ensureAudioGraph() {
  if (!isPlayer) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    applyOutputGain(state?.volume ?? 0.85);
    return;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass({ latencyHint: "interactive" });
    gainNode = audioContext.createGain();
    mediaSource = audioContext.createMediaElementSource(audio);
    mediaSource.connect(gainNode);
    gainNode.connect(audioContext.destination);
  }

  if (audioContext.state !== "running") await audioContext.resume();
  applyOutputGain(state?.volume ?? 0.85);
}

async function syncClock(rounds = 5) {
  let best = null;
  for (let i = 0; i < rounds; i += 1) {
    const t0 = Date.now();
    const data = await api("/api/time");
    const t1 = Date.now();
    const latency = t1 - t0;
    const offset = data.serverNow + latency / 2 - t1;
    if (!best || latency < best.latency) best = { latency, offset };
    await new Promise((resolve) => setTimeout(resolve, 45));
  }

  if (!best) return;
  measuredLatency = best.latency;
  clockOffset = clockOffset ? clockOffset * 0.72 + best.offset * 0.28 : best.offset;
}

async function reportDevice() {
  await api("/api/device", {
    method: "POST",
    body: JSON.stringify({
      id: deviceId,
      name: deviceName,
      role: isPlayer ? "player" : "controller",
      armed,
      latencyMs: measuredLatency,
      clockOffsetMs: clockOffset,
    }),
  }).catch(() => {});
}

function renderTracks() {
  trackList.innerHTML = "";
  tracks.forEach((track, index) => {
    const button = document.createElement("button");
    button.className = "track";
    button.type = "button";
    button.dataset.trackId = track.id;
    button.innerHTML = `
      <span class="trackIndex">${index + 1}</span>
      <span>
        <strong>${escapeHtml(track.title)}</strong>
        <span class="trackFile">${escapeHtml(track.file)}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      if (isPlayer) return;
      sendControl({ action: "stop", trackId: track.id, volume: uiVolumeToGain() });
    });
    trackList.appendChild(button);
  });
}

function renderDevices() {
  const devices = state?.devices || [];
  const lead = state?.recommendedLeadMs || 500;
  const playerCount = devices.filter((device) => device.role === "player").length;
  const armedCount = devices.filter((device) => device.role === "player" && device.armed).length;

  leadStatus.textContent = `${lead} ms`;
  if (deviceSummary) deviceSummary.textContent = `${armedCount}/${playerCount} 台`;
  deviceList.innerHTML = "";

  if (!devices.length) {
    deviceList.innerHTML = `<div class="device"><div><strong>尚無裝置</strong><span>播放端開啟頁面後會出現在這裡</span></div><div class="deviceMetrics">--</div></div>`;
    return;
  }

  devices.forEach((device) => {
    const activeAge = Math.max(0, Date.now() - device.lastSeen);
    const fresh = activeAge < 7000;
    const node = document.createElement("div");
    node.className = `device ${device.role} ${fresh ? "online" : "offline"}`;
    node.innerHTML = `
      <div>
        <strong>${escapeHtml(device.name)}${device.id === deviceId ? "（本機）" : ""}</strong>
        <span>${roleLabel(device.role)} · ${device.armed ? "已啟用" : "未啟用"} · ${fresh ? "在線" : "離線"}</span>
      </div>
      <div class="deviceMetrics">
        RTT ${device.latencyMs || 0} ms<br />
        offset ${device.clockOffsetMs || 0} ms
      </div>
    `;
    deviceList.appendChild(node);
  });
}

function setTrack(track) {
  if (!track || selectedTrack?.id === track.id) return;
  selectedTrack = track;
  audio.src = track.url;
  audio.preload = "auto";
  audio.load();
}

function statePosition(s = state) {
  if (!s) return 0;
  if (s.status !== "playing") return s.position || 0;
  return Math.max(0, (s.position || 0) + (serverNow() - s.startedAt) / 1000);
}

function playFromSyncedPosition() {
  if (!state || state.status !== "playing" || !armed) return;
  audio.playbackRate = 1;
  audio.currentTime = statePosition(state);
  audio.play().catch(() => {
    armed = false;
    updateStatus("需要啟用");
    reportDevice();
  });
}

function preciseStartLoop() {
  if (!state || state.status !== "playing" || !armed) return;
  const remaining = state.startedAt - serverNow();

  if (remaining > 18) {
    requestAnimationFrame(preciseStartLoop);
    return;
  }

  playFromSyncedPosition();
}

function correctPlaybackDrift() {
  if (!isPlayer || !state || !armed || state.status !== "playing" || audio.paused) return;
  const now = performance.now();
  if (now - driftCheckAt < 200) return;
  driftCheckAt = now;

  const expected = statePosition(state);
  const drift = audio.currentTime - expected;
  const absDrift = Math.abs(drift);

  if (absDrift > 0.18) {
    audio.currentTime = expected;
    audio.playbackRate = 1;
    return;
  }

  if (absDrift > 0.035) {
    audio.playbackRate = drift > 0 ? 0.982 : 1.018;
    return;
  }

  if (audio.playbackRate !== 1) audio.playbackRate = 1;
}

function schedulePlayback() {
  window.clearTimeout(pendingTimer);
  if (!isPlayer || !state || !selectedTrack || !armed) return;

  applyOutputGain(state.volume);

  if (state.status !== "playing") {
    audio.pause();
    audio.playbackRate = 1;
    audio.currentTime = state.position || 0;
    return;
  }

  const delay = state.startedAt - serverNow();
  const targetPosition = Math.max(0, statePosition(state));
  const drift = Math.abs(audio.currentTime - targetPosition);
  if (drift > 0.1) audio.currentTime = targetPosition;

  if (delay > 20) {
    audio.pause();
    pendingTimer = window.setTimeout(preciseStartLoop, Math.max(0, delay - 160));
    return;
  }

  playFromSyncedPosition();
}

function updateStatus(text) {
  syncStatus.textContent = text;
}

function applyState(next) {
  state = next;
  tracks = next.tracks || tracks;
  const track = tracks.find((item) => item.id === next.trackId) || tracks[0];

  if (!trackList.children.length) renderTracks();
  setTrack(track);

  currentTitle.textContent = track?.title || "無曲目";
  const remoteVolume = gainToUiVolume(next.volume);
  const keepLocalVolume = !isPlayer && Date.now() - lastLocalVolumeAt < 400;
  if (!keepLocalVolume) volume.value = remoteVolume;
  volumeValue.textContent = `${volume.value}%`;
  if (volumeEcho) volumeEcho.textContent = `音量 ${volume.value}%`;
  if (isPlayer) applyOutputGain(next.volume ?? 0.85);
  if (playIcon) playIcon.textContent = next.status === "playing" ? "Ⅱ" : "▶";
  document.body.classList.toggle("is-playing", next.status === "playing");
  updateStatus(next.status === "playing" ? "播放中" : "待命");
  renderDevices();

  document.querySelectorAll(".track").forEach((node) => {
    node.classList.toggle("active", node.dataset.trackId === next.trackId);
  });

  if (next.version !== lastVersionApplied) {
    lastVersionApplied = next.version;
    schedulePlayback();
  }
}

function tick() {
  correctPlaybackDrift();
  const pos = statePosition();
  elapsed.textContent = formatTime(pos);
  duration.textContent = formatTime(audio.duration);
  if (!seeking && Number.isFinite(audio.duration) && audio.duration > 0) {
    seek.value = Math.min(1000, Math.max(0, Math.round((pos / audio.duration) * 1000)));
  }
  requestAnimationFrame(tick);
}

function connectEvents() {
  const events = new EventSource("/events");
  events.addEventListener("open", () => {
    lastVersionApplied = -1;
    clockOffset = 0; // discard stale offset on reconnect; syncClock will remeasure fresh
    syncClock(7).catch(() => {});
    updateStatus(state?.status === "playing" ? "播放中" : "已連線");
  });
  events.addEventListener("state", (event) => applyState(JSON.parse(event.data)));
  events.addEventListener("error", () => updateStatus("重連中"));
}

if (playPause) {
  playPause.addEventListener("click", () => {
    if (!state) return;
    const action = state.status === "playing" ? "pause" : "play";
    const position = action === "play" ? state.position || 0 : undefined;
    sendControl({
      action,
      position,
      volume: uiVolumeToGain(),
      leadMs: state.recommendedLeadMs || 500,
    });
  });
}

if (stopButton) {
  stopButton.addEventListener("click", () => sendControl({ action: "stop" }));
}

if (armButton) {
  armButton.addEventListener("click", async () => {
    armed = true;
    audio.muted = false;
    try {
      await ensureAudioGraph();
      await audio.play();
      audio.pause();
      document.body.classList.add("armed");
      armButton.textContent = "✓ 此裝置已啟用";
      if (playerHint) playerHint.textContent = "等待控制台指令。";
      await reportDevice();
      schedulePlayback();
    } catch {
      armed = false;
      document.body.classList.remove("armed");
      if (playerHint) playerHint.textContent = "啟用失敗，請再點一次。";
      await reportDevice();
    }
  });
}

if (deviceToggle && devicePanel) {
  deviceToggle.addEventListener("click", () => {
    const isOpen = devicePanel.classList.toggle("open");
    deviceToggle.classList.toggle("active", isOpen);
  });
}

volume.addEventListener("input", () => {
  lastLocalVolumeAt = Date.now();
  volumeValue.textContent = `${volume.value}%`;
  if (volumeEcho) volumeEcho.textContent = `音量 ${volume.value}%`;
  if (isPlayer) applyOutputGain(uiVolumeToGain());
  scheduleVolumeSync(false);
});

volume.addEventListener("change", () => {
  scheduleVolumeSync(true);
});

seek.addEventListener("pointerdown", () => {
  seeking = true;
});

seek.addEventListener("pointerup", () => {
  seeking = false;
});

seek.addEventListener("change", () => {
  if (!state || !Number.isFinite(audio.duration) || isPlayer) return;
  const position = (Number(seek.value) / 1000) * audio.duration;
  sendControl({ action: "seek", position });
});

audio.addEventListener("loadedmetadata", () => {
  duration.textContent = formatTime(audio.duration);
});

audio.addEventListener("canplaythrough", () => {
  if (isPlayer && armed) reportDevice();
});

audio.addEventListener("ended", () => {
  if (!isPlayer) sendControl({ action: "stop" });
});

(async function boot() {
  await syncClock(9);
  const initial = await api("/api/state");
  applyState(initial);
  await reportDevice();
  connectEvents();
  tick();

  window.setInterval(async () => {
    await syncClock(state?.status === "playing" ? 5 : 3);
    await reportDevice();
  }, 1800);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    clockOffset = 0;
    syncClock(7).then(() => {
      lastVersionApplied = -1;
      if (state) applyState(state);
    }).catch(() => {});
  });
})();
