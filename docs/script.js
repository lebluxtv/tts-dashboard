// script.js (corrected full version)

document.addEventListener('DOMContentLoaded', () => {
  const statusDot        = document.getElementById('status-dot');
  const viewerCountSpan  = document.getElementById('viewer-count');
  const chatDiv          = document.getElementById('chat-log');
  const oscillo          = document.getElementById('oscilloscope');
  const timelineBtns     = document.querySelectorAll('.timeline-controls button');
  const ttsHeader        = document.getElementById('tts-header');
  const ttsPanel         = document.getElementById('tts-panel');
  const ttsProgress      = document.querySelector('#tts-progress .bar');
  const eventFeed        = document.getElementById('event-feed');
  const msgsPerMinSpan   = document.getElementById('osc-msg-min');
  const usersPerMinSpan  = document.getElementById('osc-users-min');
  const ttsInfoDiv       = document.getElementById('tts-info');

  let chatBuffer    = [];
  let eventsBuffer  = [];
  const maxChat     = 2000;
  const TTS_MAX     = 3 * 60 * 1000;
  let lastTtsTime, ttsProgressInterval, ttsTimeout;
  let timelineMode = 'scale';
  let lastScaleSeconds = 60;

  const filterConfig = {};
  const labelConfig = {
    chat: { y:12, font:'10px sans-serif', color:'rgba(57,195,255,1)' },
    tts:  { y:20, font:'10px sans-serif', color:'#ffef61' },
    default: { y:12, font:'10px sans-serif', color:'#ffffff' }
  };
  Object.keys(labelConfig).forEach(t => filterConfig[t] = { visible: true, labels: true });

  const client = new StreamerbotClient({
    host:'127.0.0.1', port:8080, endpoint:'/', password:'streamer.bot',
    subscribe:'*',
    onConnect: () => statusDot.classList.replace('offline','online'),
    onDisconnect: () => statusDot.classList.replace('online','offline')
  });

  client.on('*', ({event,data}) => {
    let type = null;
    if (event.source === 'General') {
      if (data.widget === 'tts-catcher') type = 'chat';
      else if (data.widget === 'tts-reader-selection') type = 'tts';
      else return;
    } else return;

    handleCustomEvent({ type, time: Date.now(), ...data });
  });

  function handleCustomEvent({ type, time: eventTime, ...payload }) {
    const time = typeof eventTime === 'number' ? eventTime : Date.now();
    eventsBuffer.push({ type, time, xFixed: time, ...payload });

    if (type === 'chat') {
      chatBuffer.push({ time, user: payload.user, message: payload.message });
      if (chatBuffer.length > maxChat) chatBuffer.shift();
      renderChat();
    }

    if (type === 'tts') {
      const user = payload.user || payload.selectedUser;
      ttsHeader.innerHTML = `<span style="color:#a5ffef">${user}</span> : ${payload.message}`;
      ttsPanel.classList.add('twitch-tts-glow');
      setTimeout(() => ttsPanel.classList.remove('twitch-tts-glow'), 3000);
      lastTtsTime = Date.now();
      clearInterval(ttsProgressInterval);
      clearTimeout(ttsTimeout);
      ttsProgress.style.width = '100%';
      ttsProgressInterval = setInterval(() => {
        const pct = Math.max(0,(TTS_MAX - (Date.now()-lastTtsTime))/TTS_MAX)*100;
        ttsProgress.style.width = pct+'%';
      }, 250);
      ttsTimeout = setTimeout(() => {
        clearInterval(ttsProgressInterval);
        ttsProgress.style.width = '0%';
      }, TTS_MAX);
    }
  }

  const smoothie = new SmoothieChart({
    millisPerPixel: 60,
    grid: {
      strokeStyle: '#233',
      fillStyle: '#16181c',
      lineWidth: 1,
      millisPerLine: 5000,
      verticalSections: 6
    },
    labels: {
      fillStyle: '#ececec',
      fontSize: 14,
      precision: 0
    },
    timestampFormatter: date => {
      const s = date.getSeconds();
      if (timelineMode === 'scale') {
        if (lastScaleSeconds === 60 && s % 5 === 0) return `+${s}s`;
      }
      return '';
    }
  });

  smoothie.options.onDraw = function({ chart, chartWidth: W, chartHeight: H, options }) {
    const now = Date.now();
    const mpp = options.millisPerPixel;
    const ctx = chart.canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.translate(0.5, 0.5);

    const tol = 5;
    const overlaps = {};

    eventsBuffer.forEach(ev => {
      if (!ev.xFixed || !filterConfig[ev.type]?.visible) return;
      const rawX = Math.round(W - (now - ev.xFixed) / mpp);
      if (rawX < 0 || rawX > W) return;

      let bucketX = rawX, idx = 0;
      if (ev.type !== 'chat') {
        bucketX = Math.round(rawX / tol) * tol;
        idx = overlaps[bucketX] || 0;
        overlaps[bucketX] = idx + 1;
      }

      const { color, width } = { color: labelConfig[ev.type]?.color || '#ccc', width: 2 };
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(rawX, 5);
      ctx.lineTo(rawX, H - 5);
      ctx.stroke();
      ctx.restore();
    });
  };

  smoothie.streamTo(oscillo, 0);

  function renderChat() {
    const atBottom = chatDiv.scrollHeight - chatDiv.scrollTop <= chatDiv.clientHeight + 20;
    if (!chatBuffer.length) {
      chatDiv.innerHTML = '<div class="chat-msg empty"><span class="chat-usr">…</span><span class="chat-text">Aucun message reçu</span></div>';
    } else {
      chatDiv.innerHTML = chatBuffer.slice(-100).map(m => {
        return `<div class="chat-msg"><span class="chat-usr">${m.user}:</span><span class="chat-text">${m.message}</span></div>`;
      }).join('');
    }
    if (atBottom) chatDiv.scrollTop = chatDiv.scrollHeight;
  }

  renderChat();
});
