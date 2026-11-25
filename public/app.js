const TARGETS = [
  { id: "center", label: "Chính diện", userYaw: 0 },
  { id: "left-soft", label: "Trái nhẹ", userYaw: -20 },
  { id: "left-hard", label: "Trái nhiều", userYaw: -40 },
  { id: "right-soft", label: "Phải nhẹ", userYaw: 20 },
  { id: "right-hard", label: "Phải nhiều", userYaw: 40 },
];

const TOLERANCE = 8;
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";

const nameInput = document.querySelector("#name");
const keyInput = document.querySelector("#key");
const setupForm = document.querySelector("#setup-form");
const setupError = document.querySelector("#setup-error");
const startButton = document.querySelector("#start");
const screenSetup = document.querySelector("#screen-setup");
const screenCam = document.querySelector("#screen-cam");
const screenReview = document.querySelector("#screen-review");
const video = document.querySelector("#video");
const stage = document.querySelector("#stage");
const flash = document.querySelector("#flash");
const liveYaw = document.querySelector("#live-yaw");
const targetName = document.querySelector("#target-name");
const hint = document.querySelector("#hint");
const gaugeMark = document.querySelector("#gauge-mark");
const gaugeTicks = document.querySelector("#gauge-ticks");
const slots = document.querySelector("#slots");
const shutter = document.querySelector("#shutter");
const closeCam = document.querySelector("#close-cam");
const grid = document.querySelector("#grid");
const sendButton = document.querySelector("#send");
const resetButton = document.querySelector("#reset");
const status = document.querySelector("#status");

const shots = new Map();
let stream = null;
let landmarker = null;
let loopOn = false;
let activeId = TARGETS[0].id;
let samples = [];
let capturing = false;
let armedAt = 0;
let smoothYaw = null;
let slotsKey = "";
let ticksKey = "";

nameInput.value = localStorage.getItem("face-capture-name") || "";
keyInput.value = localStorage.getItem("face-capture-key") || "";

setupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startCamera();
});
shutter.addEventListener("click", () => captureActive(false));
closeCam.addEventListener("click", () => {
  stopCamera();
  if (shots.size) showReview();
  else showSetup();
});
sendButton.addEventListener("click", sendShots);
resetButton.addEventListener("click", () => {
  clearShots();
  showSetup();
});
window.addEventListener("pagehide", stopCamera);

renderSlots();
renderTicks();

function show(screen) {
  screenSetup.hidden = screen !== "setup";
  screenCam.hidden = screen !== "cam";
  screenReview.hidden = screen !== "review";
  document.body.classList.toggle("mode-cam", screen === "cam");
  document.body.classList.toggle("mode-review", screen === "review");
}

function showSetup() { show("setup"); }
function showReview() {
  renderReview();
  show("review");
}

function setSetupError(message) {
  setupError.hidden = !message;
  setupError.textContent = message || "";
}

async function startCamera() {
  const name = nameInput.value.trim();
  const key = keyInput.value.trim();
  if (!name || !key) return;
  localStorage.setItem("face-capture-name", name);
  localStorage.setItem("face-capture-key", key);
  if (!navigator.mediaDevices?.getUserMedia) {
    setSetupError("Camera chỉ mở được trên HTTPS hoặc localhost.");
    return;
  }

  setSetupError("");
  startButton.disabled = true;
  startButton.textContent = "Đang mở camera…";
  const mediaPromise = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 960 } },
  });
  const modelPromise = loadModel();

  try {
    const [nextStream] = await Promise.all([mediaPromise, modelPromise]);
    stream = nextStream;
    video.srcObject = stream;
    await video.play();
    activeId = nextTargetId() || TARGETS[0].id;
    samples = [];
    smoothYaw = null;
    armedAt = performance.now() + 600;
    show("cam");
    loopOn = true;
    requestAnimationFrame(frame);
  } catch (error) {
    stopCamera();
    showSetup();
    setSetupError(cameraMessage(error));
  } finally {
    startButton.disabled = false;
    startButton.textContent = "Bật camera";
  }
}

function cameraMessage(error) {
  if (error?.name === "NotAllowedError") return "Trình duyệt chưa được phép dùng camera.";
  if (error?.name === "NotFoundError") return "Không tìm thấy camera.";
  return error?.message || "Không mở được camera.";
}

async function loadModel() {
  if (landmarker) return landmarker;
  const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21");
  const files = await vision.FilesetResolver.forVisionTasks(WASM);
  const options = {
    baseOptions: { modelAssetPath: MODEL },
    runningMode: "VIDEO",
    numFaces: 1,
    minFaceDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  };
  try {
    landmarker = await vision.FaceLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "GPU" },
    });
  } catch {
    landmarker = await vision.FaceLandmarker.createFromOptions(files, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: "CPU" },
    });
  }
  return landmarker;
}

function stopCamera() {
  loopOn = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (video.srcObject) video.srcObject = null;
}

function frame(now) {
  if (!loopOn) return;
  requestAnimationFrame(frame);
  if (!landmarker || video.readyState < 2) return;
  try {
    const result = landmarker.detectForVideo(video, now);
    updateGuide(result.faceLandmarks?.[0], now);
  } catch {
    hint.textContent = "Nhận diện mặt bị lỗi";
  }
}

function updateGuide(face, now) {
  const target = TARGETS.find((item) => item.id === activeId);
  if (!face) {
    smoothYaw = null;
    samples = [];
    stage.classList.remove("ready", "hold");
    hint.textContent = "Không thấy mặt";
    shutter.disabled = true;
    return;
  }

  const rawYaw = estimateRawYaw(face);
  const userYaw = -rawYaw;
  smoothYaw = smoothYaw == null ? userYaw : smoothYaw * 0.6 + userYaw * 0.4;
  const box = faceBox(face);
  const framing = framingHint(box);
  const shown = Math.round(smoothYaw);
  liveYaw.textContent = `${shown > 0 ? "+" : ""}${shown}°`;
  gaugeMark.style.left = `${clamp(((smoothYaw + 50) / 100) * 100, 2, 98)}%`;
  targetName.textContent = target.label;

  samples.push({ yaw: smoothYaw, now });
  while (samples.length && now - samples[0].now > 500) samples.shift();

  const yawReady = Math.abs(smoothYaw - target.userYaw) <= TOLERANCE;
  const manualReady = Math.abs(smoothYaw - target.userYaw) <= 15;
  const held = yawReady && !framing && stableSamples() && now >= armedAt;
  stage.classList.toggle("ready", yawReady && !framing);
  stage.classList.toggle("hold", held);
  shutter.disabled = Boolean(framing) || capturing || !manualReady;
  hint.textContent = framing || yawHint(smoothYaw, target.userYaw);

  if (held && !capturing) captureActive(true);
  renderSlots();
  renderTicks();
}

function yawHint(yaw, targetYaw) {
  const diff = yaw - targetYaw;
  if (Math.abs(diff) <= TOLERANCE) return "Giữ yên";
  return diff > 0 ? "Xoay sang trái" : "Xoay sang phải";
}

function framingHint(box) {
  if (box.w < 0.22 || box.h < 0.28) return "Đưa mặt lại gần";
  if (box.w > 0.9 || box.h > 0.95) return "Lùi ra một chút";
  if (Math.abs(box.cx - 0.5) > 0.2 || Math.abs(box.cy - 0.46) > 0.22) return "Đưa mặt vào giữa ô";
  return "";
}

function stableSamples() {
  if (samples.length < 5) return false;
  if (samples[samples.length - 1].now - samples[0].now < 400) return false;
  const values = samples.map((sample) => sample.yaw);
  return Math.max(...values) - Math.min(...values) < 6;
}

async function captureActive(auto) {
  const target = TARGETS.find((item) => item.id === activeId);
  if (!target || capturing || !video.videoWidth) return;
  if (!auto && shutter.disabled) return;
  capturing = true;
  shutter.disabled = true;
  try {
    const rawYaw = smoothYaw == null ? 0 : -smoothYaw;
    const text = `${nameInput.value.trim()} · ${target.label} · yaw ${formatYaw(rawYaw)}°`;
    const blob = await frameBlob(text);
    if (!blob) return;
    const previous = shots.get(target.id);
    if (previous) URL.revokeObjectURL(previous.url);
    shots.set(target.id, { blob, url: URL.createObjectURL(blob), rawYaw, label: target.label, gen: Date.now() });
    flash.classList.remove("on");
    void flash.offsetWidth;
    flash.classList.add("on");
    navigator.vibrate?.(30);
    samples = [];
    armedAt = performance.now() + 700;
    const upcoming = nextTargetId();
    if (!upcoming) {
      stopCamera();
      showReview();
      return;
    }
    activeId = upcoming;
    renderSlots();
    renderTicks();
  } finally {
    capturing = false;
  }
}

function frameBlob(text) {
  const maxWidth = 1280;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  const bar = 42;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height + bar;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, width, height);
  ctx.fillStyle = "#161513";
  ctx.fillRect(0, height, width, bar);
  ctx.fillStyle = "#f7f1e8";
  ctx.textBaseline = "middle";
  let fontSize = 20;
  do {
    ctx.font = `600 ${fontSize}px sans-serif`;
    fontSize -= 1;
  } while (fontSize >= 12 && ctx.measureText(text).width > width - 32);
  ctx.fillText(text, 16, height + bar / 2);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
}

function nextTargetId() {
  return TARGETS.find((target) => !shots.has(target.id))?.id || "";
}

function renderSlots() {
  const ordered = [...TARGETS].sort((a, b) => a.userYaw - b.userYaw);
  const key = ordered.map((target) => {
    const shot = shots.get(target.id);
    return `${target.id}:${shot?.gen || 0}:${target.id === activeId ? 1 : 0}`;
  }).join("|");
  if (key === slotsKey) return;
  slotsKey = key;
  slots.replaceChildren();
  for (const target of ordered) {
    const shot = shots.get(target.id);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = shot ? "done" : target.id === activeId ? "on" : "";
    if (shot) {
      const img = document.createElement("img");
      img.src = shot.url;
      img.alt = "";
      button.append(img);
    }
    button.append(document.createTextNode(target.label));
    button.addEventListener("click", () => retake(target.id));
    item.append(button);
    slots.append(item);
  }
}

function renderTicks() {
  const ordered = [...TARGETS].sort((a, b) => a.userYaw - b.userYaw);
  const key = ordered.map((target) => `${target.id}:${shots.has(target.id) ? 1 : 0}:${target.id === activeId ? 1 : 0}`).join("|");
  if (key === ticksKey) return;
  ticksKey = key;
  gaugeTicks.replaceChildren();
  for (const target of ordered) {
    const tick = document.createElement("span");
    tick.textContent = target.userYaw === 0 ? "0°" : `${target.userYaw}°`;
    tick.className = shots.has(target.id) ? "done" : target.id === activeId ? "on" : "";
    gaugeTicks.append(tick);
  }
}

function retake(id) {
  const shot = shots.get(id);
  if (shot) URL.revokeObjectURL(shot.url);
  shots.delete(id);
  activeId = id;
  slotsKey = "";
  ticksKey = "";
  status.hidden = true;
  if (screenCam.hidden) startCamera();
  else {
    samples = [];
    armedAt = performance.now() + 600;
    renderSlots();
    renderTicks();
  }
}

function renderReview() {
  grid.replaceChildren();
  for (const target of [...TARGETS].sort((a, b) => a.userYaw - b.userYaw)) {
    const shot = shots.get(target.id);
    const card = document.createElement("article");
    card.className = "card";
    const img = document.createElement("img");
    img.alt = target.label;
    if (shot) img.src = shot.url;
    const caption = document.createElement("p");
    caption.textContent = shot ? `${target.label} · yaw ${formatYaw(shot.rawYaw)}°` : `${target.label} · chưa chụp`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.textContent = "Chụp lại";
    button.addEventListener("click", () => retake(target.id));
    card.append(img, caption, button);
    grid.append(card);
  }
  sendButton.disabled = shots.size !== TARGETS.length;
  sendButton.textContent = "Gửi Telegram";
}

async function sendShots() {
  if (shots.size !== TARGETS.length) return;
  sendButton.disabled = true;
  sendButton.textContent = "Đang gửi…";
  status.hidden = true;
  status.classList.remove("error");
  const form = new FormData();
  form.set("name", nameInput.value.trim());
  form.set("key", keyInput.value.trim());
  for (const target of TARGETS) {
    const shot = shots.get(target.id);
    form.append("files", shot.blob, `${target.id}.jpg`);
    form.append("labels", target.label);
    form.append("yaws", String(Math.round(shot.rawYaw)));
  }
  try {
    const response = await fetch("/api/send", { method: "POST", body: form });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Gửi thất bại");
    status.hidden = false;
    status.textContent = "Đã gửi 5 ảnh vào Telegram.";
  } catch (error) {
    status.hidden = false;
    status.classList.add("error");
    status.textContent = error.message || "Không gửi được.";
    sendButton.disabled = false;
    sendButton.textContent = "Gửi lại";
    return;
  }
  sendButton.disabled = false;
  sendButton.textContent = "Gửi lại";
}

function clearShots() {
  for (const shot of shots.values()) URL.revokeObjectURL(shot.url);
  shots.clear();
  activeId = TARGETS[0].id;
  slotsKey = "";
  ticksKey = "";
  status.hidden = true;
  status.classList.remove("error");
  renderSlots();
  renderTicks();
}

function estimateRawYaw(landmarks) {
  const nose = landmarks[1];
  const a = landmarks[234];
  const b = landmarks[454];
  if (!nose || !a || !b) return 0;
  const left = a.x < b.x ? a : b;
  const right = a.x < b.x ? b : a;
  const dxLeft = Math.abs(nose.x - left.x);
  const dxRight = Math.abs(right.x - nose.x);
  const ratio = (dxLeft - dxRight) / (dxLeft + dxRight + 1e-6);
  return clamp(ratio * 80, -60, 60);
}

function faceBox(landmarks) {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function formatYaw(yaw) {
  const n = Math.round(yaw);
  return n > 0 ? `+${n}` : String(n);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
