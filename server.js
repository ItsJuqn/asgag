const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { google } = require('googleapis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};

// --- GOOGLE DRIVE AUTH (cuenta de servicio vía variable de entorno) ---
let drive = null;
if (process.env.GOOGLE_SERVICE_ACCOUNT) {
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    drive = google.drive({ version: 'v3', auth });
    console.log('✅ Drive API lista. Cuenta:', creds.client_email);
  } catch (e) {
    console.error('❌ Error al cargar credenciales de Drive:', e.message);
  }
} else {
  console.log('⚠️  Sin GOOGLE_SERVICE_ACCOUNT. Drive usará modo iframe (sin sync).');
}

// --- ENDPOINT PROXY PARA DRIVE ---
// El navegador pide /drive/FILE_ID y nosotros le pasamos el stream de Drive
app.get('/drive/:fileId', async (req, res) => {
  if (!drive) return res.status(500).send('Drive no configurado');

  const { fileId } = req.params;
  const range = req.headers.range;

  try {
    const driveRes = await drive.files.get(
      { fileId, alt: 'media' },
      {
        responseType: 'stream',
        headers: range ? { Range: range } : {}
      }
    );

    res.setHeader('Content-Type', driveRes.headers['content-type'] || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (driveRes.headers['content-length']) res.setHeader('Content-Length', driveRes.headers['content-length']);
    if (driveRes.headers['content-range']) {
      res.status(206);
      res.setHeader('Content-Range', driveRes.headers['content-range']);
    } else {
      res.status(200);
    }

    driveRes.data.pipe(res);
  } catch (e) {
    console.error('Error Drive:', e.message);
    res.status(500).send('Error al obtener el video de Drive: ' + e.message);
  }
});

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>🎬 Cine Sync</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family:system-ui,sans-serif; }
  body { background:#0d0d1a; color:#fff; height:100vh; display:flex; flex-direction:column; overflow:hidden; }
  #login { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:14px; padding:20px; }
  #login h1 { font-size:2.5rem; background:linear-gradient(90deg,#a855f7,#ec4899); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  #login input { padding:12px; border-radius:8px; border:1px solid #333; background:#1a1a2e; color:#fff; width:300px; max-width:100%; }
  #login button { padding:12px 30px; border-radius:8px; border:none; background:linear-gradient(90deg,#a855f7,#ec4899); color:#fff; font-weight:600; cursor:pointer; }
  #login small { color:#666; text-align:center; }
  #app { display:none; flex:1; flex-direction:column; }
  header { background:#1a1a2e; padding:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; border-bottom:1px solid #2a2a3e; }
  header input { flex:1; min-width:180px; padding:8px; border-radius:6px; border:1px solid #333; background:#0d0d1a; color:#fff; }
  header button { padding:8px 14px; border-radius:6px; border:none; background:#a855f7; color:#fff; cursor:pointer; }
  header button.ghost { background:#2a2a3e; }
  main { flex:1; display:flex; overflow:hidden; }
  .video { flex:1; background:#000; display:flex; align-items:center; justify-content:center; position:relative; }
  .video video { width:100%; height:100%; background:#000; }
  .video iframe { width:100%; height:100%; border:none; background:#000; }
  .video .empty { color:#555; padding:20px; text-align:center; }
  .banner { position:absolute; top:10px; left:50%; transform:translateX(-50%); background:rgba(168,85,247,0.9); padding:6px 14px; border-radius:20px; font-size:0.75rem; color:#fff; z-index:10; }
  .banner.ok { background:rgba(34,197,94,0.9); }
  aside { width:300px; background:#1a1a2e; border-left:1px solid #2a2a3e; display:flex; flex-direction:column; }
  aside .top { padding:10px; border-bottom:1px solid #2a2a3e; font-size:0.85rem; color:#a855f7; }
  #msgs { flex:1; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:6px; }
  .m { background:#252540; padding:8px 10px; border-radius:8px; font-size:0.85rem; word-wrap:break-word; }
  .m.me { background:#a855f7; align-self:flex-end; }
  .m b { font-size:0.7rem; opacity:0.7; display:block; margin-bottom:2px; }
  .m.sys { background:#2a2a3e; font-style:italic; color:#aaa; }
  .send { display:flex; border-top:1px solid #2a2a3e; }
  .send input { flex:1; padding:10px; border:none; background:#0d0d1a; color:#fff; outline:none; }
  .send button { padding:0 16px; border:none; background:#a855f7; color:#fff; cursor:pointer; }
  @media (max-width:700px){ main{flex-direction:column;} aside{width:100%;height:40vh;} }
</style>
</head>
<body>

<div id="login">
  <h1>🎬 Cine Sync</h1>
  <input id="name" placeholder="Tu nombre" maxlength="20">
  <input id="room" placeholder="Sala (ej: cine)" maxlength="20">
  <button onclick="entrar()">Entrar</button>
  <small>Comparte el link de la sala para que otros entren</small>
</div>

<div id="app">
  <header>
    <input id="url" placeholder="Pega link de Drive, YouTube o URL MP4 directo">
    <button onclick="cargar()">▶ Cargar para todos</button>
    <button class="ghost" onclick="copiar()">🔗 Copiar link</button>
  </header>
  <main>
    <div class="video" id="video"><div class="empty">Nadie ha cargado un video todavía</div></div>
    <aside>
      <div class="top">👥 <span id="count">0</span> en línea</div>
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
let socket, nombre, sala, videoEl, ignorar = false;

function entrar() {
  nombre = document.getElementById('name').value.trim();
  sala = document.getElementById('room').value.trim() || 'cine';
  if (!nombre) return alert('Escribe tu nombre');
  socket = io();
  socket.emit('join', { name: nombre, room: sala });
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  setup();
}

function setup() {
  socket.on('users', list => document.getElementById('count').textContent = list.length);
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
  let m = url.match(/\\/d\\/([^\\/]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([^&]+)/);
  if (m) return m[1];
  return null;
}

function pintar(url, time = 0, playing = false) {
  const box = document.getElementById('video');
  box.innerHTML = '';

  // ---- GOOGLE DRIVE (vía proxy del servidor) ----
  if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
    const id = sacarDriveId(url);
    if (!id) {
      box.innerHTML = '<div class="empty">Link de Drive inválido</div>';
      return;
    }
    videoEl = document.createElement('video');
    videoEl.src = '/drive/' + id;
    videoEl.controls = true;
    videoEl.autoplay = true;
    videoEl.preload = 'auto';
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.currentTime = time || 0;
      if (playing) videoEl.play().catch(()=>{});
    });
    videoEl.addEventListener('play', () => { if (!ignorar) socket.emit('play', { room: sala, time: videoEl.currentTime }); });
    videoEl.addEventListener('pause', () => { if (!ignorar) socket.emit('pause', { room: sala, time: videoEl.currentTime }); });
    videoEl.addEventListener('seeked', () => { if (!ignorar) socket.emit('seek', { room: sala, time: videoEl.currentTime, playing: !videoEl.paused }); });
    videoEl.addEventListener('error', () => {
      box.innerHTML = '';
      const banner = document.createElement('div');
      banner.className = 'banner';
      banner.textContent = '⚠️ No se pudo cargar de Drive. ¿Compartiste el video con la cuenta de servicio?';
      const f = document.createElement('iframe');
      f.src = 'https://drive.google.com/file/d/' + id + '/preview';
      f.allow = 'autoplay; encrypted-media';
      f.allowFullscreen = true;
      box.appendChild(f);
      box.appendChild(banner);
    });
    box.appendChild(videoEl);
    const ok = document.createElement('div');
    ok.className = 'banner ok';
    ok.textContent = '✅ Drive sincronizado';
    box.appendChild(ok);
    setTimeout(() => ok.remove(), 3000);
    return;
  }

  // ---- YOUTUBE ----
  const ytMatch = url.match(/(?:youtube\\.com\\/watch\\?v=|youtu\\.be\\/|youtube\\.com\\/embed\\/)([\\w-]+)/);
  if (ytMatch) {
    const banner = document.createElement('div');
    banner.className = 'banner';
    banner.textContent = '⚠️ YouTube: cada uno controla su reproducción';
    const f = document.createElement('iframe');
    f.src = 'https://www.youtube.com/embed/' + ytMatch[1] + '?autoplay=1&enablejsapi=1';
    f.allow = 'autoplay; encrypted-media; fullscreen';
    f.allowFullscreen = true;
    box.appendChild(f);
    box.appendChild(banner);
    return;
  }

  // ---- MP4 / URL DIRECTA ----
  videoEl = document.createElement('video');
  videoEl.src = url;
  videoEl.controls = true;
  videoEl.autoplay = true;
  videoEl.preload = 'auto';
  videoEl.addEventListener('loadedmetadata', () => {
    videoEl.currentTime = time || 0;
    if (playing) videoEl.play().catch(()=>{});
  });
  videoEl.addEventListener('play', () => { if (!ignorar) socket.emit('play', { room: sala, time: videoEl.currentTime }); });
  videoEl.addEventListener('pause', () => { if (!ignorar) socket.emit('pause', { room: sala, time: videoEl.currentTime }); });
  videoEl.addEventListener('seeked', () => { if (!ignorar) socket.emit('seek', { room: sala, time: videoEl.currentTime, playing: !videoEl.paused }); });
  box.appendChild(videoEl);
}

function cargar() {
  const u = document.getElementById('url').value.trim();
  if (!u) return;
  socket.emit('load', { room: sala, url: u, name: nombre });
  document.getElementById('url').value = '';
}

function enviar() {
  const i = document.getElementById('msg');
  if (!i.value.trim()) return;
  socket.emit('chat', { room: sala, name: nombre, text: i.value.trim() });
  i.value = '';
}

function copiar() {
  const url = location.origin + '?room=' + encodeURIComponent(sala);
  navigator.clipboard.writeText(url);
  alert('Link copiado:\\n' + url);
}

function addMsg(n, t, me, sys) {
  const d = document.createElement('div');
  d.className = 'm' + (me ? ' me' : '') + (sys ? ' sys' : '');
  d.innerHTML = (sys ? '' : '<b>' + esc(n) + '</b>') + esc(t);
  const box = document.getElementById('msgs');
  box.appendChild(d);
  box.scrollTop = 99999;
}

function esc(s){ return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c])); }

window.addEventListener('load', () => {
  const r = new URLSearchParams(location.search).get('room');
  if (r) document.getElementById('room').value = r;
});
</script>
</body>
</html>`;

app.get('/', (_, res) => res.send(HTML));

io.on('connection', socket => {
  socket.on('join', ({ name, room }) => {
    if (!name || !room) return;
    socket.join(room);
    socket.data.name = name;
    socket.data.room = room;
    if (!rooms[room]) rooms[room] = { users: {}, video: null, time: 0, playing: false };
    rooms[room].users[socket.id] = name;
    io.to(room).emit('users', Object.values(rooms[room].users));
    socket.to(room).emit('chat', { n: '📢', t: name + ' entró', sys: true });
    if (rooms[room].video) {
      socket.emit('video', { url: rooms[room].video, time: rooms[room].time, playing: rooms[room].playing });
    }
  });

  socket.on('chat', ({ room, name, text }) => {
    io.to(room).emit('chat', { n: name, t: text });
  });

  socket.on('load', ({ room, url, name }) => {
    if (!rooms[room]) return;
    rooms[room].video = url;
    rooms[room].time = 0;
    rooms[room].playing = false;
    io.to(room).emit('video', { url, time: 0, playing: false });
    io.to(room).emit('chat', { n: '📢', t: name + ' cargó un video', sys: true });
  });

  socket.on('play', ({ room, time }) => {
    if (!rooms[room]) return;
    rooms[room].time = time; rooms[room].playing = true;
    socket.to(room).emit('sync', { time, playing: true });
  });

  socket.on('pause', ({ room, time }) => {
    if (!rooms[room]) return;
    rooms[room].time = time; rooms[room].playing = false;
    socket.to(room).emit('sync', { time, playing: false });
  });

  socket.on('seek', ({ room, time, playing }) => {
    if (!rooms[room]) return;
    rooms[room].time = time; rooms[room].playing = playing;
    socket.to(room).emit('sync', { time, playing });
  });

  socket.on('disconnect', () => {
    const room = socket.data.room;
    if (room && rooms[room]) {
      const n = rooms[room].users[socket.id];
      delete rooms[room].users[socket.id];
      io.to(room).emit('users', Object.values(rooms[room].users));
      if (n) socket.to(room).emit('chat', { n: '📢', t: n + ' salió', sys: true });
      if (Object.keys(rooms[room].users).length === 0) delete rooms[room];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('🎬 http://localhost:' + PORT));