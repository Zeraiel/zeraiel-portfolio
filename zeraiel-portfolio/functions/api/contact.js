const MAX_BODY_BYTES = 20000;
const TYPES = {
  site: "Сайт-визитка или лендинг",
  catalog: "Сайт-каталог",
  task: "Небольшая задача или правка",
  other: "Другое",
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function clean(value, singleLine = true) {
  if (typeof value !== "string") return "";
  const withoutControls = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return (singleLine ? withoutControls.replace(/\s+/g, " ") : withoutControls).trim();
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export async function onRequestPost({ request, env }) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return json({ ok: false, error: "not_configured" }, 500);
  }

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin) {
    try {
      if (new URL(origin).host !== url.host) {
        return json({ ok: false, error: "forbidden_origin" }, 403);
      }
    } catch {
      return json({ ok: false, error: "forbidden_origin" }, 403);
    }
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ ok: false, error: "unsupported_media_type" }, 415);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ ok: false, error: "too_large" }, 413);
  }

  let data;
  try { data = JSON.parse(raw); } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Silently accept honeypot submissions without forwarding them.
  if (clean(data.company)) return json({ ok: true });

  const name = clean(data.name);
  const contact = clean(data.contact);
  const budget = clean(data.budget);
  const message = clean(data.message, false);
  const type = typeof data.type === "string" ? data.type : "";
  const lang = data.lang === "en" ? "en" : "ru";

  const fields = {};
  const checks = [
    ["name", name, 2, 80],
    ["contact", contact, 3, 120],
    ["message", message, 10, 2000],
  ];
  for (const [field, value, min, max] of checks) {
    if (!value.length) fields[field] = "required";
    else if ([...value].length < min) fields[field] = "too_short";
    else if ([...value].length > max) fields[field] = "too_long";
  }
  if ([...budget].length > 80) fields.budget = "too_long";
  if (!Object.prototype.hasOwnProperty.call(TYPES, type)) fields.type = "invalid";
  if (Object.keys(fields).length) return json({ ok: false, error: "validation", fields }, 422);

  if (!Number.isFinite(Number(data.elapsed)) || Number(data.elapsed) < 2500) {
    return json({ ok: false, error: "too_fast" }, 422);
  }

  let text = `<b>Новая заявка с сайта</b>\n\n`;
  text += `<b>Имя:</b> ${escapeHtml(name)}\n`;
  text += `<b>Контакт:</b> ${escapeHtml(contact)}\n`;
  text += `<b>Тип:</b> ${escapeHtml(TYPES[type])}\n`;
  if (budget) text += `<b>Бюджет и сроки:</b> ${escapeHtml(budget)}\n`;
  text += `\n<b>Сообщение:</b>\n${escapeHtml(message)}`;
  text += `\n\n<i>Язык сайта: ${lang}</i>`;
  if ([...text].length > 4000) text = [...text].slice(0, 3990).join("") + "…";

  let telegramResponse;
  try {
    telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch {
    return json({ ok: false, error: "delivery_failed" }, 502);
  }

  let telegramData;
  try { telegramData = await telegramResponse.json(); } catch { telegramData = null; }
  if (!telegramResponse.ok || !telegramData?.ok) {
    // Do not log or return the Telegram URL because it contains the bot token.
    console.error("Contact form: Telegram API rejected the request", telegramResponse.status);
    return json({ ok: false, error: "delivery_failed" }, 502);
  }
  return json({ ok: true });
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Allow": "POST, OPTIONS" } });
  }
  return json({ ok: false, error: "method_not_allowed" }, 405, { "Allow": "POST" });
}
