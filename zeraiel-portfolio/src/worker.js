import { handleContact } from './contact.js';

/**
 * Worker запускается только для адресов /api/* (см. run_worker_first в wrangler.jsonc).
 * Все остальные запросы Cloudflare отдаёт напрямую как статичные файлы сайта.
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/contact') {
      return handleContact(request, env);
    }

    return new Response(JSON.stringify({ ok: false, error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};
