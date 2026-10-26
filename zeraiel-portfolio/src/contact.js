
const MAX_BODY_BYTES = 20000;
const MIN_FILL_MS = 2500;
const MAX_PER_HOUR = 5;
const MIN_INTERVAL_SECONDS = 20;

const TYPES = {
  site: 'Сайт-визитка или лендинг',
  catalog: 'Сайт-каталог',
  task: 'Небольшая задача или правка',
  other: 'Другое',
};

function respond(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function textLength(text) {
  return Array.from(text).length;
}

function textCut(text, length) {
  return Array.from(text).slice(0, length).join('');
}

function cleanText(value, singleLine) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let result = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (singleLine) result = result.replace(/\s+/g, ' ');
  return result.trim();
}

function tgEscape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}


async function rateLimit(request, env) {
  const kv = env.RATE_LIMIT;
  if (!kv || typeof kv.get !== 'function') return null;

  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = 'rl:' + (await sha256Hex(ip + ':' + env.TELEGRAM_BOT_TOKEN));
    const now = Math.floor(Date.now() / 1000);

    let times = [];
    const stored = await kv.get(key);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) times = parsed.filter((t) => Number.isInteger(t) && now - t < 3600);
      } catch (error) {
        times = [];
      }
    }

    let retry = null;
    if (times.length >= MAX_PER_HOUR) {
      retry = 3600 - (now - Math.min(...times));
    } else if (times.length && now - Math.max(...times) < MIN_INTERVAL_SECONDS) {
      retry = MIN_INTERVAL_SECONDS - (now - Math.max(...times));
    } else {
      times.push(now);
    }

    await kv.put(key, JSON.stringify(times), { expirationTtl: 3600 });
    return retry;
  } catch (error) {
    console.error('contact form: rate limit storage failed');
    return null; // не блокируем настоящих посетителей из-за сбоя хранилища
  }
}

async function telegramSend(env, text) {
  const base = (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
  const url = base + '/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage';
  const fields = new URLSearchParams({
    chat_id: String(env.TELEGRAM_CHAT_ID),
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: 'true',
  });

  let status = 0;
  let decoded = null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields,
      signal: AbortSignal.timeout(10000),
    });
    status = response.status;
    decoded = await response.json().catch(() => null);
  } catch (error) {
    // Адрес не логируем: в нём токен бота.
    console.error('contact form: Telegram request failed (network or timeout)');
    return false;
  }

  if (status !== 200 || !decoded || !decoded.ok) {
    console.error('contact form: Telegram request failed, HTTP status ' + status);
    return false;
  }
  return true;
}

export async function handleContact(request, env) {
  if (request.method !== 'POST') {
    return respond(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST' });
  }

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('contact form: bot token or chat id is not configured');
    return respond(500, { ok: false, error: 'not_configured' });
  }

  // Принимаем форму только с этого же сайта (или из ALLOWED_ORIGINS).
  const origin = request.headers.get('Origin') || '';
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch (error) {
      originHost = '';
    }
    const sameSite = originHost !== '' && originHost.toLowerCase() === new URL(request.url).host.toLowerCase();
    const allowed = String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!sameSite && !allowed.includes(origin)) {
      return respond(403, { ok: false, error: 'forbidden_origin' });
    }
  }

  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return respond(415, { ok: false, error: 'unsupported_media_type' });
  }

  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) {
    return respond(413, { ok: false, error: 'too_large' });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return respond(413, { ok: false, error: 'too_large' });
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    data = null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return respond(400, { ok: false, error: 'bad_request' });
  }

  if (cleanText(data.company, true) !== '') {
    return respond(200, { ok: true });
  }

  const name = cleanText(data.name, true);
  const contact = cleanText(data.contact, true);
  const budget = cleanText(data.budget, true);
  let message = cleanText(data.message, false);
  const type = typeof data.type === 'string' ? data.type : '';
  const lang = data.lang === 'en' ? 'en' : 'ru';

  const limits = {
    name: [name, 2, 80],
    contact: [contact, 3, 120],
    message: [message, 10, 2000],
  };

  const errors = {};
  for (const [field, [value, min, max]] of Object.entries(limits)) {
    const length = textLength(value);
    if (length === 0) errors[field] = 'required';
    else if (length < min) errors[field] = 'too_short';
    else if (length > max) errors[field] = 'too_long';
  }
  if (textLength(budget) > 80) errors.budget = 'too_long';
  if (!Object.prototype.hasOwnProperty.call(TYPES, type)) errors.type = 'invalid';

  if (Object.keys(errors).length) {
    return respond(422, { ok: false, error: 'validation', fields: errors });
  }

  const elapsed = Number.isFinite(Number(data.elapsed)) ? Math.trunc(Number(data.elapsed)) : 0;
  if (elapsed < MIN_FILL_MS) {
    return respond(422, { ok: false, error: 'too_fast' });
  }

  const retry = await rateLimit(request, env);
  if (retry !== null) {
    return respond(429, { ok: false, error: 'rate_limited', retry_after: retry }, { 'Retry-After': String(retry) });
  }

  const build = (messageText) => {
    let text = '<b>Новая заявка с сайта</b>\n\n';
    text += '<b>Имя:</b> ' + tgEscape(name) + '\n';
    text += '<b>Контакт:</b> ' + tgEscape(contact) + '\n';
    text += '<b>Тип:</b> ' + tgEscape(TYPES[type]) + '\n';
    if (budget !== '') text += '<b>Бюджет и сроки:</b> ' + tgEscape(budget) + '\n';
    text += '\n<b>Сообщение:</b>\n' + tgEscape(messageText);
    text += '\n\n<i>Язык сайта: ' + lang + '</i>';
    return text;
  };

  // Лимит Telegram: 4096 символов в сообщении. Укорачиваем текст с запасом.
  let text = build(message);
  while (textLength(text) > 4000 && textLength(message) > 10) {
    message = textCut(message, Math.floor(textLength(message) * 0.9));
    text = build(message + '…');
  }

  if (!(await telegramSend(env, text))) {
    return respond(502, { ok: false, error: 'delivery_failed' });
  }
  return respond(200, { ok: true });
}
