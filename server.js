const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { google } = require('googleapis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const state = { users: {}, video: null, time: 0, playing: false };

// ---------- DRIVE AUTH ----------
let drive = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    drive = google.drive({ version: 'v3', auth });
    console.log('✅ Drive listo:', creds.client_email);
  } catch (e) {
    console.error('❌ Drive error:', e.message);
  }
} else {
  console.log('⚠️ Sin GOOGLE_SERVICE_ACCOUNT');
}

// ---------- PROXY DRIVE ----------
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
    console.error('Drive error:', e.message);
    res.status(500).send('Error: ' + e.message);
  }
});

// ---------- HTML ----------
const html = String.raw`<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>watch</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  :root {
    --bg-1: #1e1f22;
    --bg-2: #2b2d31;
    --bg-3: #313338;
    --bg-4: #383a40;
    --bg-hover: #35373c;
    --text: #f2f3f5;
    --text-muted: #949ba4;
    --text-dim: #6d6f78;
    --accent: #5865f2;
    --accent-hover: #4752c4;
    --green: #23a55a;
    --red: #f23f43;
    --yellow: #f0b232;
    --chat-width: 340px;
  }
  html, body { height:100%; }
  body {
    background: var(--bg-1);
    color: var(--text);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1a1b1e; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #111214; }

  /* ============ LOGIN ============ */
  #login {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100vh; gap: 20px; padding: 24px; animation: fadeIn .4s ease;
  }
  #login .card {
    background: var(--bg-2);
    padding: 32px;
    border-radius: 16px;
    width: 420px;
    max-width: 100%;
    box-shadow: 0 20px 60px rgba(0,0,0,.5);
    display: flex; flex-direction: column; gap: 16px;
  }
  #login label {
    font-size: .72rem; font-weight: 700; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: .02em; margin-bottom: 8px;
    display: block;
  }
  #login input {
    width: 100%; padding: 12px 14px;
    border-radius: 8px; border: 1px solid transparent;
    background: #1e1f22; color: var(--text);
    font-size: 1rem; outline: none;
    transition: border .15s;
  }
  #login input:focus { border-color: var(--accent); }
  #login button {
    width: 100%; padding: 12px;
    border-radius: 8px; border: none;
    background: var(--accent); color: #fff;
    font-weight: 600; font-size: 1rem; cursor: pointer;
    transition: background .15s;
  }
  #login button:hover { background: var(--accent-hover); }

  /* ============ APP ============ */
  #app { display: none; flex: 1; flex-direction: column; height: 100vh; }

  header {
    height: 48px;
    background: var(--bg-3);
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid #1f2023;
    flex-shrink: 0;
  }
  header .brand {
    display: flex; align-items: center; gap: 8px;
    color: var(--text); font-weight: 600; font-size: .95rem;
    padding-right: 12px; border-right: 1px solid #3f4147;
    white-space: nowrap;
  }
  header .brand .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: linear-gradient(135deg, #5865f2, #eb459e);
  }
  header .input-wrap {
    flex: 1;
    display: flex;
    background: #1e1f22;
    border-radius: 8px;
    overflow: hidden;
    max-width: 720px;
  }
  header input {
    flex: 1;
    padding: 8px 14px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: .875rem;
    outline: none;
  }
  header input::placeholder { color: var(--text-dim); }
  header .load-btn {
    padding: 0 16px;
    border: none;
    background: var(--accent);
    color: #fff;
    font-size: .8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s;
  }
  header .load-btn:hover { background: var(--accent-hover); }
  header .icon-btn {
    width: 32px; height: 32px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 1rem;
    transition: background .15s, color .15s;
  }
  header .icon-btn:hover { background: var(--bg-hover); color: var(--text); }
  header .online {
    display: flex; align-items: center; gap: 6px;
    color: var(--text-muted); font-size: .8rem;
    padding: 0 8px;
  }
  header .online .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 6px var(--green);
  }

  main { flex: 1; display: flex; overflow: hidden; }

  .video-area {
    flex: 1;
    background: #000;
    display: flex; align-items: center; justify-content: center;
    position: relative;
    overflow: hidden;
    min-width: 0;
  }
  .video-area video, .video-area iframe {
    width: 100%; height: 100%; border: none; background: #000;
  }
  .empty-state {
    text-align: center;
    color: var(--text-dim);
    animation: fadeIn .5s ease;
  }
  .empty-state .icon {
    font-size: 5rem;
    opacity: .2;
    margin-bottom: 12px;
  }
  .empty-state .hint {
    font-size: .85rem;
    color: var(--text-dim);
  }

  /* ===== DIVISOR ARRASTRABLE ===== */
  .divider {
    width: 6px;
    background: var(--bg-1);
    cursor: col-resize;
    position: relative;
    flex-shrink: 0;
    transition: background .15s;
    z-index: 5;
  }
  .divider::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 2px;
    height: 40px;
    background: #3f4147;
    border-radius: 1px;
    transition: background .15s, height .15s;
  }
  .divider:hover { background: var(--bg-2); }
  .divider:hover::after { background: var(--accent); height: 60px; }
  .divider.dragging { background: var(--bg-2); }
  .divider.dragging::after { background: var(--accent); height: 60px; }

  .toast {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(30,31,34,.95);
    backdrop-filter: blur(10px);
    padding: 8px 16px;
    border-radius: 8px;
    font-size: .8rem;
    color: #fff;
    border: 1px solid #3f4147;
    z-index: 10;
    animation: slideDown .3s ease;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
  }
  .toast.ok { border-color: var(--green); color: var(--green); }
  .toast.warn { border-color: var(--yellow); color: var(--yellow); }
  .toast.err { border-color: var(--red); color: var(--red); }

  aside {
    width: var(--chat-width);
    background: var(--bg-2);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    min-width: 220px;
    max-width: 70vw;
  }
  aside .chat-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #1f2023;
    flex-shrink: 0;
  }
  aside .chat-header h3 {
    font-size: .95rem;
    font-weight: 600;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  aside .chat-header h3 .hash {
    color: var(--text-dim);
    font-size: 1.2rem;
    font-weight: 400;
  }
  aside .chat-header .count {
    background: var(--bg-4);
    color: var(--text-muted);
    font-size: .72rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
  }

  #msgs {
    flex: 1;
    overflow-y: auto;
    padding: 16px 8px 8px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    scroll-behavior: smooth;
  }

  .m {
    display: flex;
    gap: 14px;
    padding: 4px 8px 4px 0;
    border-radius: 4px;
    transition: background .1s;
    animation: msgIn .2s ease;
  }
  .m:hover { background: rgba(0,0,0,.06); }
  .m .avatar {
    width: 38px; height: 38px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: .95rem;
    color: #fff;
    flex-shrink: 0;
    margin-top: 2px;
    user-select: none;
  }
  .m .body { flex: 1; min-width: 0; }
  .m .name {
    font-size: .92rem;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 2px;
    display: inline-block;
  }
  .m .name.me { color: #eb459e; }
  .m .text {
    font-size: .92rem;
    color: #dbdee1;
    line-height: 1.4;
    word-wrap: break-word;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  .m .time {
    font-size: .68rem;
    color: var(--text-dim);
    margin-left: 6px;
    font-weight: 400;
  }
  .m.sys {
    padding: 6px 8px 6px 0;
    justify-content: center;
  }
  .m.sys .text {
    color: var(--text-dim);
    font-size: .8rem;
    font-style: italic;
  }

  .composer {
    padding: 0 16px 16px;
    flex-shrink: 0;
  }
  .composer .box {
    background: var(--bg-4);
    border-radius: 8px;
    display: flex;
    align-items: flex-end;
    padding: 0 16px;
    transition: box-shadow .15s;
  }
  .composer .box:focus-within {
    box-shadow: 0 0 0 1px rgba(88,101,242,.3);
  }
  .composer textarea {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: .92rem;
    font-family: 'Inter', system-ui, sans-serif;
    resize: none;
    outline: none;
    padding: 11px 0;
    line-height: 1.4;
    max-height: 200px;
    min-height: 22px;
  }
  .composer textarea::placeholder { color: var(--text-dim); }
  .composer .send-btn {
    padding: 4px 8px;
    margin: 4px -8px 4px 8px;
    border: none;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
    font-size: 1.1rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color .15s, background .15s;
  }
  .composer .send-btn:hover { color: #fff; background: var(--accent); }

  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideDown { from { opacity: 0; transform: translate(-50%, -10px); } to { opacity: 1; transform: translate(-50%, 0); } }
  @keyframes msgIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

  /* En móvil se apila y no se puede redimensionar */
  @media (max-width: 780px) {
    main { flex-direction: column; }
    .divider { display: none; }
    aside { width: 100%; height: 45vh; border-top: 1px solid #1f2023; min-width: 0; max-width: none; }
    header .brand { display: none; }
  }
</style>
</head>
<body>

<div id="login">
  <div class="card">
    <div>
      <label>Nombre</label>
      <input id="name" placeholder="¿Cómo te llamas?" maxlength="20" autofocus>
    </div>
    <button onclick="entrar()">Entrar</button>
  </div>
</div>

<div id="app">
  <header>
    <div class="brand">
      <span class="dot"></span>
      <span>watch</span>
    </div>
    <div class="input-wrap">
      <input id="url" placeholder="Pega el link del video..." onkeydown="if(event.key==='Enter')cargar()">
      <button class="load-btn" onclick="cargar()">Reproducir</button>
    </div>
    <button class="icon-btn" onclick="copiar()" title="Copiar link">🔗</button>
    <div class="online">
      <span class="dot"></span>
      <span id="count">0</span>
    </div>
  </header>
  <main>
    <div class="video-area" id="video">
      <div class="empty-state">
        <div class="icon">📺</div>
        <div class="hint">Pega un link arriba para empezar</div>
      </div>
    </div>
    <div class="divider" id="divider"></div>
    <aside id="chat">
      <div class="chat-header">
        <h3><span class="hash">#</span> chat</h3>
        <span class="count" id="count2">0</span>
      </div>
      <div id="msgs"></div>
      <div class="composer">
        <div class="box">
          <textarea id="msg" placeholder="Escribe un mensaje..." rows="1"></textarea>
          <button class="send-btn" onclick="enviar()" title="Enviar">➤</button>
        </div>
      </div>
    </aside>
  </main>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
  let socket, nombre, videoEl, ignorar = false;
  const colores = ['#5865f2','#eb459e','#23a55a','#f0b232','#f23f43','#a855f7','#3ba55c','#e91e63','#00bcd4','#ff9800'];

  function colorFor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return colores[h % colores.length];
  }

  function inicial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

  function entrar() {
    nombre = document.getElementById('name').value.trim();
    if (!nombre) return document.getElementById('name').focus();
    socket = io();
    socket.emit('join', nombre);
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    setup();
    setTimeout(() => document.getElementById('msg').focus(), 300);
  }

  function setup() {
    socket.on('users', list => {
      document.getElementById('count').textContent = list.length;
      document.getElementById('count2').textContent = list.length;
    });
    socket.on('chat', data => addMsg(data.n, data.t, data.n === nombre, data.sys));
    socket.on('video', v => pintar(v.url, v.time, v.playing));
    socket.on('sync', s => {
      if (!videoEl) return;
      ignorar = true;
      if (Math.abs(videoEl.currentTime - s.time) > 0.8) videoEl.currentTime = s.time;
      if (s.playing && videoEl.paused) videoEl.play().catch(() => {});
      if (!s.playing && !videoEl.paused) videoEl.pause();
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

  function pintar(url, time, playing) {
    time = time || 0;
    const box = document.getElementById('video');
    box.innerHTML = '';

    if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
      const id = sacarDriveId(url);
      if (!id) { box.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div></div>'; return; }
      videoEl = document.createElement('video');
      videoEl.src = '/drive/' + id;
      videoEl.controls = true; videoEl.autoplay = true; videoEl.preload = 'auto';
      videoEl.addEventListener('loadedmetadata', () => {
        videoEl.currentTime = time;
        if (playing) videoEl.play().catch(() => {});
      });
      videoEl.addEventListener('play', () => { if (!ignorar) socket.emit('play', { time: videoEl.currentTime }); });
      videoEl.addEventListener('pause', () => { if (!ignorar) socket.emit('pause', { time: videoEl.currentTime }); });
      videoEl.addEventListener('seeked', () => { if (!ignorar) socket.emit('seek', { time: videoEl.currentTime, playing: !videoEl.paused }); });
      videoEl.addEventListener('error', () => {
        box.innerHTML = '';
        toast('Comparte el video con la cuenta de servicio', 'err');
        const f = document.createElement('iframe');
        f.src = 'https://drive.google.com/file/d/' + id + '/preview';
        f.allow = 'autoplay; encrypted-media';
        f.allowFullscreen = true;
        box.appendChild(f);
      });
      box.appendChild(videoEl);
      toast('Sincronizado', 'ok');
      return;
    }

    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]+)/);
    if (ytMatch) {
      toast('YouTube sin sincronización', 'warn');
      const f = document.createElement('iframe');
      f.src = 'https://www.youtube.com/embed/' + ytMatch[1] + '?autoplay=1&enablejsapi=1';
      f.allow = 'autoplay; encrypted-media; fullscreen';
      f.allowFullscreen = true;
      box.appendChild(f);
      return;
    }

    videoEl = document.createElement('video');
    videoEl.src = url;
    videoEl.controls = true; videoEl.autoplay = true; videoEl.preload = 'auto';
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.currentTime = time;
      if (playing) videoEl.play().catch(() => {});
    });
    videoEl.addEventListener('play', () => { if (!ignorar) socket.emit('play', { time: videoEl.currentTime }); });
    videoEl.addEventListener('pause', () => { if (!ignorar) socket.emit('pause', { time: videoEl.currentTime }); });
    videoEl.addEventListener('seeked', () => { if (!ignorar) socket.emit('seek', { time: videoEl.currentTime, playing: !videoEl.paused }); });
    box.appendChild(videoEl);
  }

  function toast(text, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = text;
    document.getElementById('video').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2000);
    setTimeout(() => t.remove(), 2400);
  }

  function cargar() {
    const u = document.getElementById('url').value.trim();
    if (!u) return;
    socket.emit('load', { url: u, name: nombre });
    document.getElementById('url').value = '';
  }

  function enviar() {
    const ta = document.getElementById('msg');
    const text = ta.value.trim();
    if (!text) return;
    socket.emit('chat', { text });
    ta.value = '';
    ta.style.height = 'auto';
  }

  function copiar() {
    navigator.clipboard.writeText(location.origin);
    toast('Link copiado', 'ok');
  }

  function addMsg(n, t, me, sys) {
    const box = document.getElementById('msgs');
    const d = document.createElement('div');

    if (sys) {
      d.className = 'm sys';
      d.innerHTML = '<div class="body"><div class="text">' + esc(t) + '</div></div>';
    } else {
      d.className = 'm';
      const color = colorFor(n);
      const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
      d.innerHTML =
        '<div class="avatar" style="background:' + color + '">' + esc(inicial(n)) + '</div>' +
        '<div class="body">' +
          '<span class="name' + (me ? ' me' : '') + '" style="color:' + (me ? '' : color) + '">' + esc(n) + '</span>' +
          '<span class="time">' + hora + '</span>' +
          '<div class="text">' + esc(t) + '</div>' +
        '</div>';
    }
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }

  function esc(s) {
    return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
  }

  // ========== DIVISOR ARRASTRABLE ==========
  function initDivider() {
    const divider = document.getElementById('divider');
    const chat = document.getElementById('chat');
    let dragging = false;

    const onMove = (e) => {
      if (!dragging) return;
      const x = e.clientX || (e.touches && e.touches[0].clientX);
      if (x == null) return;
      const width = window.innerWidth - x;
      if (width < 220 || width > window.innerWidth - 200) return;
      chat.style.width = width + 'px';
    };

    const start = (e) => {
      dragging = true;
      divider.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };
    const stop = () => {
      dragging = false;
      divider.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    divider.addEventListener('mousedown', start);
    divider.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', stop);
    document.addEventListener('touchend', stop);
  }

  // ========== INICIALIZACIÓN ==========
  window.addEventListener('load', () => {
    const ta = document.getElementById('msg');
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enviar();
      }
    });
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    });
    const nameInput = document.getElementById('name');
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') entrar();
    });
    initDivider();
  });
</script>
</body>
</html>`;

app.get('/', (_, res) => res.send(html));

io.on('connection', socket => {
  socket.on('join', name => {
    if (!name) return;
    state.users[socket.id] = name;
    io.emit('users', Object.values(state.users));
    socket.broadcast.emit('chat', { n: '📢', t: name + ' se unió', sys: true });
    if (state.video) socket.emit('video', { url: state.video, time: state.time, playing: state.playing });
  });

  socket.on('chat', data => {
    io.emit('chat', { n: state.users[socket.id] || 'Anónimo', t: data.text });
  });

  socket.on('load', data => {
    state.video = data.url;
    state.time = 0;
    state.playing = false;
    io.emit('video', { url: data.url, time: 0, playing: false });
    io.emit('chat', { n: '📢', t: data.name + ' cargó un video', sys: true });
  });

  socket.on('play', d => {
    state.time = d.time;
    state.playing = true;
    socket.broadcast.emit('sync', { time: d.time, playing: true });
  });

  socket.on('pause', d => {
    state.time = d.time;
    state.playing = false;
    socket.broadcast.emit('sync', { time: d.time, playing: false });
  });

  socket.on('seek', d => {
    state.time = d.time;
    state.playing = d.playing;
    socket.broadcast.emit('sync', { time: d.time, playing: d.playing });
  });

  socket.on('disconnect', () => {
    const n = state.users[socket.id];
    delete state.users[socket.id];
    io.emit('users', Object.values(state.users));
    if (n) socket.broadcast.emit('chat', { n: '📢', t: n + ' salió', sys: true });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎬 http://localhost:' + PORT));