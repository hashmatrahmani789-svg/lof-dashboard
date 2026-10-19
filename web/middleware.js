// Password protection for the whole site. Set APP_PASSWORD in Vercel → Settings → Environment Variables.
export const config = {
  matcher: ['/((?!login\\.html|api/login|api/scan|favicon\\.svg|manifest\\.json).*)'],
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const next = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

export default async function middleware(request) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return next();
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)lof_auth=([a-f0-9]{64})/);
  if (m && m[1] === await sha256(pw + ':lof-dashboard')) return next();
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return Response.redirect(new URL('/login.html', request.url), 302);
}
