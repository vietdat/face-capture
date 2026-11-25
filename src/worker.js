const LABELS = ["Trái nhiều", "Trái nhẹ", "Chính diện", "Phải nhẹ", "Phải nhiều"];

const FILES = {
  "Trái nhiều": "trai-nhieu.jpg",
  "Trái nhẹ": "trai-nhe.jpg",
  "Chính diện": "chinh-dien.jpg",
  "Phải nhẹ": "phai-nhe.jpg",
  "Phải nhiều": "phai-nhieu.jpg",
};

const MAX_BYTES = 4_000_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function cleanName(raw) {
  return String(raw || "").replace(/[\u0000-\u001f<>&]/g, "").trim().slice(0, 60);
}

function sameKey(input, secret) {
  const a = String(input);
  const b = String(secret || "");
  if (!b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function esc(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtYaw(yaw) {
  const n = Math.round(Number(yaw));
  return n > 0 ? `+${n}` : String(n);
}

export async function handleSend(request, env, telegramFetch = fetch) {
  if (request.method !== "POST") return json({ error: "Chỉ nhận POST" }, 405);
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.CAPTURE_KEY) {
    return json({ error: "Chưa cấu hình TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID và CAPTURE_KEY" }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Thiếu dữ liệu ảnh" }, 400);
  }

  if (!sameKey(form.get("key"), env.CAPTURE_KEY)) return json({ error: "Sai mã gửi" }, 401);

  const name = cleanName(form.get("name"));
  if (!name) return json({ error: "Thiếu tên" }, 400);

  const files = form.getAll("files");
  const labels = form.getAll("labels").map(String);
  const yaws = form.getAll("yaws").map(String);
  if (files.length !== 5 || labels.length !== 5 || yaws.length !== 5) {
    return json({ error: "Cần đủ 5 ảnh" }, 400);
  }

  const seen = new Set();
  const items = [];
  for (let i = 0; i < 5; i++) {
    const label = labels[i];
    const yaw = Number(yaws[i]);
    const file = files[i];
    if (!LABELS.includes(label) || seen.has(label)) return json({ error: "Nhãn góc không hợp lệ" }, 400);
    if (!Number.isFinite(yaw) || yaw < -70 || yaw > 70) return json({ error: "Góc không hợp lệ" }, 400);
    if (!file || typeof file.arrayBuffer !== "function") return json({ error: "Ảnh không đọc được" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength < 1000 || bytes.byteLength > MAX_BYTES) {
      return json({ error: "Ảnh quá nhỏ hoặc lớn hơn 4MB" }, 400);
    }
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ error: "Chỉ nhận ảnh JPEG" }, 400);
    seen.add(label);
    items.push({
      label,
      yaw,
      filename: FILES[label],
      file: new File([bytes], FILES[label], { type: "image/jpeg" }),
    });
  }

  items.sort((a, b) => LABELS.indexOf(a.label) - LABELS.indexOf(b.label));

  const legend = items.map((item) => `• ${esc(item.label)}: yaw ${fmtYaw(item.yaw)}°`).join("\n");
  const albumCaption =
    `<b>${esc(name)}</b>\n` +
    "Năm góc mặt nguồn. yaw dương = mũi hướng về mép phải của ảnh.\n" +
    legend;

  const body = new FormData();
  body.set("chat_id", env.TELEGRAM_CHAT_ID);
  body.set(
    "media",
    JSON.stringify(
      items.map((item, index) => ({
        type: "photo",
        media: `attach://p${index}`,
        parse_mode: "HTML",
        caption: index === 0 ? albumCaption : `<b>${esc(name)}</b> · ${esc(item.label)} · yaw ${fmtYaw(item.yaw)}°`,
      })),
    ),
  );
  items.forEach((item, index) => body.set(`p${index}`, item.file, item.filename));

  let response;
  try {
    response = await telegramFetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMediaGroup`, {
      method: "POST",
      body,
    });
  } catch {
    return json({ error: "Không kết nối được Telegram" }, 502);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return json({ error: "Telegram trả về dữ liệu lạ" }, 502);
  }
  if (!payload.ok) return json({ error: `Telegram: ${payload.description || "lỗi gửi ảnh"}` }, 502);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/send") return handleSend(request, env);
    return json({ error: "Không có" }, 404);
  },
};
