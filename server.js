const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { google } = require('googleapis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const state = { users: {}, video: null, time: 0, playing: false };

// --- DRIVE AUTH ---
let drive = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    drive = google.drive({ version: 'v3', auth });
    console.log('✅ Drive API lista:', creds.client_email);
  } catch (e) {
    console.error('❌ Error Drive:', e.message);
  }
} else {
  console.log('⚠️  Sin GOOGLE_SERVICE_ACCOUNT');
}

// --- PROXY DRIVE ---
app.get('/drive/:fileId', async (req, res) => {
  if (!drive) return res.status(500).send('Drive no configurado');
  const { fileId } = req.params;
  const range = req.headers.range;
  try {
    const driveRes = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream', headers: range ? { Range: range } : {} }
    );
    res.setHeader('Content-Type', driveRes.headers['content-type'] || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (driveRes.headers['content-length']) res.setHeader('Content-Length', driveRes.headers['content-length']);
    if (driveRes.headers['content-range']) {
      res.status(206);
      res.setHeader('Content-Range', driveRes.headers['content-range']);
    } else res.status(200);
    driveRes.data.pipe(res);
  } catch (e) {
    console.error('Error Drive:', e.message);
    res.status(500).send('Error: ' + e.message);
  }
});

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🎬</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  body {
    background: radial-gradient(ellipse at top left, #1a0d2e 0%, #0a0a14 45%) fixed,
                radial-gradient(ellipse at bottom right, #0d1a2e 0%, transparent 50%) fixed;
    color:#f5f5f7; height:100vh; display:flex; flex-direction:column; overflow:hidden;
  }

  /* ---------- LOGIN ---------- */
  #login {
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    height:100vh; gap:18px; padding:24px; animation:fadeIn .5s ease;
  }
  #login .logo {
    font-size:3.5rem; font-weight:700; letter-spacing:-.03em;
    background:linear-gradient(135deg,#a855f7,#ec4899);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent;
  }
  #login input {
    padding:14px 18px; border-radius:12px; border:1px solid rgba(168,85,247,.15);
    background:rgba(20,20,35,.8); color:#fff; width:320px; max-width:100%;
    font-size:1rem; outline:none; transition:border .2s, box-shadow .2s;
  }
  #login input:focus { border-color:#a855f7; box-shadow:0 0 0 3px rgba(168,85,247,.15); }
  #login button {
    padding:14px 40px; border-radius:12px; border:none;
    background:linear-gradient(135deg,#a855f7,#ec4899);
    color:#fff; font-weight:600; font-size:1rem; cursor:pointer;
    width:320px; max-width:100%; transition:transform .15s, box-shadow .2s;
    box-shadow:0 8px 24px rgba(168,85,247,.25);
  }
  #login button:hover { transform:translateY(-2px); box-shadow:0 12px 32px rgba(168,85,247,.4); }

  /* ---------- APP ---------- */
  #app { display:none; flex:1; flex-direction:column; animation:fadeIn .4s ease; }

  header {
    background:rgba(20,20,35,.75); backdrop-filter:blur(16px);
    -webkit-backdrop-filter:blur(16px);
    padding:12px 16px; display:flex; gap:10px; align-items:center;
    flex-wrap:wrap; border-bottom:1px solid rgba(168,85,247,.15); z-index:5;
  }
  header .input-wrap { flex:1; min-width:180px; display:flex; }
  header input {
    flex:1; padding:10px 14px; border-radius:10px 0 0 10px;
    border:1px solid rgba(168,85,247,.15); border-right:none;
    background:rgba(10,10,20,.7); color:#fff; font-size:.85rem;
    outline:none; transition:border .2s;
  }
  header input:focus { border-color:#a855f7; }
  header .load-btn {
    padding:10px 18px; border-radius:0 10px 10px 0; border:1px solid transparent;
    background:linear-gradient(135deg,#a855f7,#ec4899);
    color:#fff; font-weight:600; font-size:.85rem; cursor:pointer;
    white-space:nowrap; transition:opacity .2s;
  }
  header .load-btn:hover { opacity:.9; }
  header .ghost {
    padding:10px 14px; border-radius:10px; border:1px solid rgba(168,85,247,.15);
    background:transparent; color:#f5f5f7; font-size:.85rem; cursor:pointer;
    transition:background .2s; white-space:nowrap;
  }
  header .ghost:hover { background:rgba(168,85,247,.1); }
  header .online {
    display:flex; align-items:center; gap:6px; font-size:.85rem;
    color:#8a8a9a; padding:0 8px;
  }
  header .online .dot {
    width:8px; height:8px; border-radius:50%; background:#22c55e;
    box-shadow:0 0 8px #22c55e; animation:pulse 2s infinite;
  }

  main { flex:1; display:flex; overflow:hidden; }

  .video-area {
    flex:1; background:#000; display:flex; align-items:center; justify-content:center;
    position:relative; overflow:hidden;
  }
  .video-area video, .video-area iframe { width:100%; height:100%; border:none; background:#000; }
  .empty-state { text-align:center; color:#8a8a9a; padding:40px; }
  .empty-state .icon { font-size:4rem; margin-bottom:12px; opacity:.5; }

  .banner {
    position:absolute; top:16px; left:50%; transform:translateX(-50%);
    background:rgba(168,85,247,.95); backdrop-filter:blur(10px);
    padding:8px 18px; border-radius:30px; font-size:.78rem; font-weight:500;
    color:#fff; z-index:10; box-shadow:0 8px 24px rgba(0,0,0,.3);
    animation:slideDown .4s ease;
  }
  .banner.ok { background:rgba(34,197,94,.95); }
  .banner.warn { background:rgba(245,158,11,.95); }

  /* ---------- CHAT ---------- */
  aside {
    width:320px; background:rgba(18,18,31,.85);
    backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);
    border-left:1px solid rgba(168,85,247,.15);
    display:flex; flex-direction:column;
  }
  aside .header {
    padding:14px 16px; border-bottom:1px solid rgba(168,85,247,.15);
    display:flex; align-items:center; justify-content:space-between;
  }
  aside .header h3 { font-size:.9rem; font-weight:600; }
  aside .header .count {
    background:rgba(168,85,247,.15); color:#a855f7; font-size:.75rem;
    font-weight:700; padding:2px 8px; border-radius:20px;
  }

  #msgs {
    flex:1; overflow-y:auto; padding:12px 14px;
    display:flex; flex-direction:column; gap:8px; scroll-behavior:smooth;
  }
  #msgs::-webkit-scrollbar { width:6px; }
  #msgs::-webkit-scrollbar-thumb { background:rgba(168,85,247,.3); border-radius:3px; }

  .m {
    background:rgba(37,37,64,.7); padding:8px 12px; border-radius:12px;
    font-size:.85rem; word-wrap:break-word; max-width:90%;
    animation:msgIn .25s ease;
  }
  .m.me {
    background:linear-gradient(135deg,#a855f7,#ec4899);
    align-self:flex-end; border-bottom-right-radius:4px;
  }
  .m:not(.me) { border-bottom-left-radius:4px; }
  .m b { font-size:.7rem; font-weight:700; opacity:.75; display:block; margin-bottom:3px; }
  .m.sys {
    background:transparent; font-style:italic; color:#8a8a9a;
    font-size:.78rem; text-align:center; align-self:center; max-width:100%;
  }

  .send {
    display:flex; border-top:1px solid rgba(168,85,247,.15);
    background:rgba(10,10,20,.5); padding:8px; gap:6px;
  }
  .send input {
    flex:1; padding:10px 14px; border-radius:10px;
    border:1px solid rgba(168,85,247,.15); background:rgba(10,10,20,.8);
    color:#fff; outline:none; font-size:.85rem; transition:border .2s;
  }
  .send input:focus { border-color:#a855f7; }
  .send button {
    padding:0 16px; border-radius:10px; border:none;
    background:linear-gradient(135deg,#a855f7,#ec4899);
    color:#fff; font-weight:700; cursor:pointer; transition:transform .15s;
  }
  .send button:hover { transform:scale(1.05); }

  @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
  @keyframes slideDown { from { opacity:0; transform:translate(-50%,-10px); } to { opacity:1; transform:translate(-50%,0); } }
  @keyframes msgIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }

  @media (max-width:780px) {
    main { flex-direction:column; }
    aside { width:100%; height:42vh; border-left:none; border-top:1px solid rgba(168,85,247,.15); }
  }
</style>
</head>
<body>

<div id="login">
  <div class="logo">🎬</div>
  <input id="name" placeholder="Tu nombre" maxlength="20" autofocus onkeydown="if(event.key==='Enter')entrar()">
  <button onclick="entrar()">Entrar</button>
</div>

<div id="app">
  <header>
    <div class="input-wrap">
      <input id="url" placeholder="Pega un link..." onkeydown="if(event.key==='Enter')cargar()">
      <button class="load-btn" onclick="cargar()">▶</button>
    </div>
    <button class="ghost" onclick="copiar()">🔗</button>
    <div class="online"><span class="dot"></span><span id="count">0</span></div>
  </header>
  <main>
    <div class="video-area" id="video">
      <div class="empty-state"><div class="icon">📺</div></div>
    </div>
    <aside>
      <div class="header">
        <h3>Chat</h3>
        <span class="count" id="count2">0</span>
      </div>
      <div id="msgs"></div>
      <div class="send">
        <input id="msg" placeholder="Mensaje..." onkeydown="if(event.key==='Enter')enviar()">
        <button onclick="enviar()">➤</button>
      </div>
    </aside>
  </main>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
let socket, nombre, videoEl, ignorar = false;

function entrar() {
  nombre = document.getElementById('name').value.trim();
  if (!nombre) return document.getElementById('name').focus();
  socket = io();
  socket.emit('join', nombre);
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  setup();
}

function setup() {
  socket.on('users', list => {
    document.getElementById('count').textContent = list.length;
    document.getElementById('count2').textContent = list.length;
  });
  socket.on('chat', ({ n, t, sys }) => addMsg(n, t, n === nombre, sys));
  socket.on('video', ({ url, time, playing }) => pintar(url, time, playing));
  socket.on('sync', ({ time, playing }) => {
    if (!videoEl) return;
    ignorar = true;
    if (Math.abs(videoEl.currentTime - time) > 0.8) videoEl.currentTime = time;
    if (playing && videoEl.paused) videoEl.play().catch(()=>{});
    if (!playing && !videoEl.paused) videoEl.pause();
    setTimeout(() => ignorar = false, 200);
  });
}

function sacarDriveId(url) {
  let m = url.match(/\/d\/([^\/]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([^&]+)/);
  if (m) return m[1];
  return null;
}

function pintar(url, time = 0, playing = false) {
  const box = document.getElementById('video');
  box.innerHTML = '';

  if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
    const id = sacarDriveId(url);
    if (!id) { box.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div></div>'; return; }
    videoEl = document.createElement('video');
    videoEl.src = '/drive/' + id;
    videoEl.controls = true; videoEl.autoplay = true; videoEl.preload = 'auto';
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.currentTime = time || 0;
      if (playing) videoEl.play().catch(()=>{});
    });
    videoEl.addEventListener('play', () => { if (!ignorar) socket.emit('play', { time: videoEl.currentTime }); });
    videoEl.addEventListener('pause', () => { if (!ignorar) socket.emit('pause', { time: videoEl.currentTime }); });
    videoEl.addEventListener('seeked', () => { if (!ignorar) socket.emit('seek', { time: videoEl.currentTime, playing: !videoEl.paused }); });
    videoEl.addEventListener('error', () => {
      box.innerHTML = '';
      const b = document.createElement('div');
      b.className = 'banner warn';
      b.textContent = '⚠️ Comparte el video con la cuenta de servicio';
      const f = document.createElement('iframe');
      f.src = 'https://drive.google.com/file/d/' + id + '/preview';
      f.allow = 'autoplay; encrypted-media';
      f.allowFullscreen = true;
      box.appendChild(f);
      box.appendChild(b);
    });
    box.appendChild(videoEl);
    const ok = document.createElement('div');
    ok.className = 'banner ok';
    ok.textContent = '✅ Sincronizado';
    box.appendChild(ok);
    setTimeout(() => ok.remove(), 2500);
    return;
  }

  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/);
  if (ytMatch) {
    const b = document.createElement('div');
    b.className = 'banner warn';
    b.textContent = '⚠️ YouTube: sin sync';
    const f = document.createElement('iframe');
    f.src = 'https://www.youtube.com/embed/' + ytMatch[1] + '?autoplay=1&enablejsapi=1';
    f.allow = 'autoplay; encrypted-media; fullscreen';
    f.allowFullscreen = true;
    box.appendChild(f);
    box.appendChild(b);
    return;
  }

  videoEl = document.createElement('video');
  videoEl.src = url;
  videoEl.controls = true; videoEl.autoplay = true; videoEl.preload = 'auto';
  videoEl.addEventListener('loadedmetadata', () => {
    videoEl.currentTime = time || 0;
    if (playing) videoEl.play().catch(()=>{});
  });
  videoEl.addEventListener('play', () => { if (!ignorar) socket.emit('play', { time: videoEl.currentTime }); });
  videoEl.addEventListener('pause', () => { if (!ignorar) socket.emit('pause', { time: videoEl.currentTime }); });
  videoEl.addEventListener('seeked', () => { if (!ignorar) socket.emit('seek', { time: videoEl.currentTime, playing: !videoEl.paused }); });
  box.appendChild(videoEl);
}

function cargar() {
  const u = document.getElementById('url').value.trim();
  if (!u) return;
  socket.emit('load', { url: u, name: nombre });
  document.getElementById('url').value = '';
}

function enviar() {
  const i = document.getElementById('msg');
  if (!i.value.trim()) return;
  socket.emit('chat', { text: i.value.trim() });
  i.value = '';
}

function copiar() {
  navigator.clipboard.writeText(location.origin);
  alert('Link copiado:\n' + location.origin);
}

function addMsg(n, t, me, sys) {
  const d = document.createElement('div');
  d.className = 'm' + (me ? ' me' : '') + (sys ? ' sys' : '');
  d.innerHTML = (sys ? '' : '<b>' + esc(n) + '</b>') + esc(t);
  const box = document.getElementById('msgs');
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}

function esc(s){ return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }
</script>
</body>
</html>`;

app.get('/', (_, res) => res.send(HTML));

io.on('connection', socket => {
  socket.on('join', name => {
    if (!name) return;
    state.users[socket.id] = name;
    io.emit('users', Object.values(state.users));
    socket.broadcast.emit('chat', { n: '📢', t: name + ' entró', sys: true });
    if (state.video) socket.emit('video', { url: state.video, time: state.time, playing: state.playing });
  });

  socket.on('chat', ({ text }) => {
    io.emit('chat', { n: state.users[socket.id] || 'Anónimo', t: text });
  });

  socket.on('load', ({ url, name }) => {
    state.video = url; state.time = 0; state.playing = false;
    io.emit('video', { url, time: 0, playing: false });
    io.emit('chat', { n: '📢', t: name + ' cargó un video', sys: true });
  });

  socket.on('play', ({ time }) => {
    state.time = time; state.playing = true;
    socket.broadcast.emit('sync', { time, playing: true });
  });

  socket.on('pause', ({ time }) => {
    state.time = time; state.playing = false;
    socket.broadcast.emit('sync', { time, playing: false });
  });

  socket.on('seek', ({ time, playing }) => {
    state.time = time; state.playing = playing;
    socket.broadcast.emit('sync', { time, playing });
  });

  socket.on('disconnect', () => {
    const n = state.users[socket.id];
    delete state.users[socket.id];
    io.emit('users', Object.values(state.users));
    if (n) socket.broadcast.emit('chat', { n: '📢', t: n + ' salió', sys: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎬 ' + PORT));