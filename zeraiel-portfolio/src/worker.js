import { handleContact } from './contact.js';


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
