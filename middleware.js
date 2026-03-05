export const config = {
  matcher: ['/((?!api/login$).*)'],
};

export default function middleware(request) {
  const expected = process.env.APP_ACCESS_TOKEN;
  if (!expected) {
    return new Response('APP_ACCESS_TOKEN not configured', { status: 500 });
  }

  const url = new URL(request.url);
  const cookie = request.headers.get('cookie') || '';
  const isAuthed = cookie.split(';').map((p) => p.trim()).some((p) => p === `app_access=${encodeURIComponent(expected)}` || p === `app_access=${expected}`);

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/login') return undefined;
    if (isAuthed) return undefined;
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (isAuthed) return undefined;

  const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Access Required</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,600&family=Outfit:wght@300;400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Outfit',system-ui,sans-serif;background:#08080c;color:#ede8e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;position:relative;overflow:hidden}
body::before{content:'';position:fixed;top:-40%;left:-20%;width:80%;height:80%;background:radial-gradient(ellipse,rgba(212,145,90,0.04) 0%,transparent 70%);pointer-events:none}
body::after{content:'';position:fixed;inset:0;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");opacity:0.03;pointer-events:none;mix-blend-mode:overlay}
.card{width:100%;max-width:400px;padding:2.5rem;background:rgba(15,15,22,0.8);border:1px solid rgba(255,255,255,0.06);border-radius:14px;backdrop-filter:blur(20px);box-shadow:0 24px 80px rgba(0,0,0,0.5);position:relative;animation:cardIn 0.5s cubic-bezier(0.16,1,0.3,1)}
@keyframes cardIn{from{opacity:0;transform:translateY(12px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}
h1{font-family:'Fraunces','Georgia',serif;font-weight:400;font-size:1.6rem;letter-spacing:-0.01em;margin-bottom:0.5rem;background:linear-gradient(135deg,#ede8e0 30%,#e8ad78 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
p{font-size:0.88rem;color:#9e9588;margin-bottom:1.5rem;font-weight:300;line-height:1.6;letter-spacing:0.01em}
form{display:flex;gap:10px}
input{flex:1;padding:0.7rem 0.85rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.055);border-radius:9px;color:#ede8e0;font-family:'Outfit',system-ui,sans-serif;font-size:0.9rem;font-weight:300;transition:all 0.3s cubic-bezier(0.16,1,0.3,1);outline:none}
input::placeholder{color:#544f47;font-style:italic;font-family:'Fraunces','Georgia',serif;font-weight:300;font-size:0.85rem}
input:focus{border-color:rgba(212,145,90,0.4);box-shadow:0 0 0 3px rgba(212,145,90,0.14),0 0 20px rgba(212,145,90,0.06);background:rgba(255,255,255,0.025)}
button{padding:0.7rem 1.25rem;background:linear-gradient(135deg,#d4915a 0%,#b87340 50%,#c07848 100%);border:none;border-radius:9px;color:#0a0806;font-family:'Fraunces','Georgia',serif;font-size:0.9rem;font-weight:600;cursor:pointer;transition:all 0.3s cubic-bezier(0.16,1,0.3,1);box-shadow:0 4px 20px rgba(212,145,90,0.28),inset 0 1px 0 rgba(255,255,255,0.25);position:relative;overflow:hidden}
button:hover{transform:translateY(-1px);box-shadow:0 8px 32px rgba(212,145,90,0.35);filter:brightness(1.08)}
button:active{transform:scale(0.97);filter:brightness(0.95)}
#m{margin-top:1rem;font-size:0.82rem;color:#d95f5f;min-height:1.2em}
::selection{background:rgba(212,145,90,0.3);color:#ede8e0}
</style></head><body>
<div class="card">
<h1>Enter access code</h1>
<p>This studio is private. Ask the owner for an access code to continue.</p>
<form id="f">
<input id="t" type="password" placeholder="Access code" autocomplete="off" />
<button type="submit">Unlock</button>
</form>
<div id="m"></div>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = document.getElementById('t').value;
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  if (r.ok) location.href = ${JSON.stringify('/')} ;
  else {
    const j = await r.json().catch(() => ({}));
    document.getElementById('m').textContent = j.error || 'Login failed';
  }
});
</script>
</div>
</body></html>`;

  return new Response(html, {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
