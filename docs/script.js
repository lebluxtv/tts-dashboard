// script.js
document.addEventListener('DOMContentLoaded', () => {
  // === 1) UI refs ===
  const statusDot       = document.getElementById('status-dot');
  const viewerCountSpan = document.getElementById('viewer-count');
  const chatDiv         = document.getElementById('chat-log');
  const oscillo         = document.getElementById('oscilloscope');
  const timelineBtns    = document.querySelectorAll('.timeline-controls button');
  const ttsHeader       = document.getElementById('tts-header');
  const ttsPanel        = document.getElementById('tts-panel');
  const ttsProgress     = document.querySelector('#tts-progress .bar');
  const eventFeed       = document.getElementById('event-feed');

  let chatBuffer   = [];
  let eventsBuffer = [];
  const maxChat    = 2000;
  const TTS_MAX    = 3 * 60 * 1000;
  let lastTtsTime, ttsProgressInterval, ttsTimeout;
  let timelineMode     = 'scale';
  let lastScaleSeconds = 60;

  // === 2) Streamer.bot client, subscribe à tous les events ===
  const client = new StreamerbotClient({
    host:     '127.0.0.1',
    port:     8080,
    endpoint: '/',
    password: 'streamer.bot',
    subscribe: '*',
    onConnect: async data => {
      console.log("✅ WebSocket connecté !", data);
      statusDot.classList.replace('offline', 'online');
      try {
        const resp = await client.getActiveViewers();
        const n = resp.viewers.length;
        viewerCountSpan.textContent = n ? `👀 ${n}` : '';
        viewerCountSpan.title = resp.viewers.map(v => v.display).join(', ');
      } catch {
        viewerCountSpan.textContent = '';
        viewerCountSpan.title       = '';
      }
    },
    onDisconnect: () => {
      console.log("🔌 WebSocket déconnecté !");
      statusDot.classList.replace('online', 'offline');
      viewerCountSpan.textContent = '';
      viewerCountSpan.title       = '';
    }
  });

  // === 3) Dispatch centralisé et normalisation en `type` ===
  client.on('*', ({ event, data }) => {
    let type = null;
    const now = Date.now();

    if (event.source === 'Twitch') {
      switch (event.type) {
        // — Chat
        //case 'ChatMessage': type = 'chat';    break;
        case 'Whisper':     type = 'chat';    break;
        // — Bits / Cheers
        case 'Cheer':                type = 'Cheer';               break;
        // — Follows / Raids
        case 'Follow':               type = 'Follow';              break;
        case 'Raid':                 type = 'Raid';                break;
        // — Ads
        case 'AdRun':                type = 'AdRun';               break;
        // — Subs
        case 'Sub':       type = 'Sub';         break;
        case 'ReSub':     type = 'ReSub';       break;
        case 'GiftSub':   type = 'GiftSub';     break;
        case 'GiftBomb':  type = 'GiftBomb';    break;
        // — Hype train
        case 'HypeTrainStart':   type = 'HypeTrainStart';    break;
        case 'HypeTrainUpdate':  type = 'HypeTrainUpdate';   break;
        case 'HypeTrainLevelUp': type = 'HypeTrainLevelUp';  break;
        case 'HypeTrainEnd':     type = 'HypeTrainEnd';      break;
        // — Channel points
        case 'RewardRedemption': type = 'RewardRedemption';  break;
        case 'RewardCreated':    type = 'RewardCreated';     break;
        case 'RewardUpdated':    type = 'RewardUpdated';     break;
        case 'RewardDeleted':    type = 'RewardDeleted';     break;
        // — Community goals
        case 'CommunityGoalContribution': type = 'CommunityGoalContribution'; break;
        case 'CommunityGoalEnded':        type = 'CommunityGoalEnded';        break;
        // — Polls
        case 'PollCreated': type = 'PollCreated'; break;
        case 'PollUpdated': type = 'PollUpdated'; break;
        case 'PollEnded':   type = 'PollEnded';   break;

        default:
          console.debug(`Twitch non mappé : ${event.type}`);
          return;
      }
    }
    else if (event.source === 'General') {
      if      (data.widget === 'tts-catcher')              type = 'chat';
      else if (data.widget === 'tts-reader-selection')     type = 'tts';
      else if (data.widget === 'tts-reader-tick')          type = 'tick';
      else return;
    }
    else if (event.source === 'Misc') {
      if (event.type === 'TimedAction') type = 'TimedAction';
      else return;
    }
    else return;

    handleCustomEvent({
      type,
      time: now,
      ...data
    });
  });
// -----------------------------------------------------------------------------------------
const labelConfig = {
  // Custom
  tts:   { y: 20, font: '10px sans-serif', color: '#ffef61' },
  chat:  { y: 12, font: '10px sans-serif', color: 'rgba(57,195,255,1)' },

  // Twitch
  Follow:                    { y: 15, font: '10px sans-serif', color: '#a7ff8e' },
  Raid:                      { y: 15, font: '10px sans-serif', color: '#ffae42' },
  AdRun:                     { y: 15, font: '10px sans-serif', color: '#ffaa00' },
  Sub:                       { y: 15, font: '10px sans-serif', color: '#ff41b0' },
  ReSub:                     { y: 15, font: '10px sans-serif', color: '#28e7d7' },
  GiftSub:                   { y: 15, font: '10px sans-serif', color: '#ff71ce' },
  GiftBomb:                  { y: 15, font: '10px sans-serif', color: '#ff1f8b' },
  Cheer:                     { y: 15, font: '10px sans-serif', color: '#ffd256' },
  HypeTrainStart:            { y: 15, font: '10px sans-serif', color: '#ff6b6b' },
  HypeTrainUpdate:           { y: 15, font: '10px sans-serif', color: '#ff5252' },
  HypeTrainLevelUp:          { y: 15, font: '10px sans-serif', color: '#ff3b3b' },
  HypeTrainEnd:              { y: 15, font: '10px sans-serif', color: '#ff2424' },
  RewardRedemption:          { y: 15, font: '10px sans-serif', color: '#8e44ad' },
  RewardCreated:             { y: 15, font: '10px sans-serif', color: '#9b59b6' },
  RewardUpdated:             { y: 15, font: '10px sans-serif', color: '#71368a' },
  RewardDeleted:             { y: 15, font: '10px sans-serif', color: '#5e3370' },
  CommunityGoalContribution: { y: 15, font: '10px sans-serif', color: '#2ecc71' },
  CommunityGoalEnded:        { y: 15, font: '10px sans-serif', color: '#27ae60' },
  PollCreated:               { y: 15, font: '10px sans-serif', color: '#3498db' },
  PollUpdated:               { y: 15, font: '10px sans-serif', color: '#2980b9' },
  PollEnded:                 { y: 15, font: '10px sans-serif', color: '#1f618d' },

  // Misc
  TimedAction:               { y: 15, font: '10px sans-serif', color: '#95a5a6' },

  // fallback
  default:                   { y: 12, font: '10px sans-serif', color: '#ffffff' }
};

  // === 4) Resize canvas to fill its container ===
  function resizeOscillo() {
    const s = document.querySelector('.timeline-section');
    oscillo.width  = s.clientWidth;
    oscillo.height = s.clientHeight;
  }
  window.addEventListener('resize', resizeOscillo);
  resizeOscillo();

  // === 5) Init SmoothieChart and dummy series to keep it active ===
  const smoothie = new SmoothieChart({
    millisPerPixel: 60,
    grid: {
      strokeStyle:      '#233',
      fillStyle:        '#16181c',
      lineWidth:        1,
      millisPerLine:    1000,
      verticalSections: 6
    },
    labels: { fillStyle: '#ececec', fontSize: 14, precision: 0 },
    timestampFormatter: SmoothieChart.timeFormatter
  });
  const dummy = new TimeSeries();
  smoothie.addTimeSeries(dummy, { strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0 });
  setInterval(() => dummy.append(Date.now(), 0), 1000);

  //=== 6) onDraw hook: draw event bars, icons and labels ===
  smoothie.options.onDraw = function({ chart, chartWidth: W, chartHeight: H, options }) {
    const now = Date.now();
    const mpp = options.millisPerPixel;
    const ctx = chart.canvas.getContext('2d');

    eventsBuffer.forEach(ev => {
      const t = Number(new Date(ev.time));
      const x = W - (now - t) / mpp;
      if (x < 0 || x > W) return;

     // default style
    let color = "#888888";
    let width = 2;

      switch (ev.type) {
        // Custom
        case 'tts':                       color = '#ffef61'; break;
        case "chat":                      color = "rgba(57, 195, 255, 0.4)";   width = 1;   break;
        // Twitch
        case 'Follow':                    color = '#a7ff8e'; break;
        case 'Raid':                      color = '#ffae42'; break;
        case 'AdRun':                     color = '#ffaa00'; break;
        case 'Sub':                       color = '#ff41b0'; break;
        case 'ReSub':                     color = '#28e7d7'; break;
        case 'GiftSub':                   color = '#ff71ce'; break;
        case 'GiftBomb':                  color = '#ff1f8b'; break;
        case 'Cheer':                     color = '#ffd256'; break;
        case 'HypeTrainStart':            color = '#ff6b6b'; break;
        case 'HypeTrainUpdate':           color = '#ff5252'; break;
        case 'HypeTrainLevelUp':          color = '#ff3b3b'; break;
        case 'HypeTrainEnd':              color = '#ff2424'; break;
        case 'RewardRedemption':          color = '#8e44ad'; break;
        case 'RewardCreated':             color = '#9b59b6'; break;
        case 'RewardUpdated':             color = '#71368a'; break;
        case 'RewardDeleted':             color = '#5e3370'; break;
        case 'CommunityGoalContribution': color = '#2ecc71'; break;
        case 'CommunityGoalEnded':        color = '#27ae60'; break;
        case 'PollCreated':               color = '#3498db'; break;
        case 'PollUpdated':               color = '#2980b9'; break;
        case 'PollEnded':                 color = '#1f618d'; break;
        // Misc
        case 'TimedAction':               color = '#95a5a6'; break;
        default:                          color = '#888888';
      }

      // === draw vertical bar ===
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = width;
      ctx.beginPath();
      ctx.moveTo(x, 5);
      ctx.lineTo(x, H - 5);
      ctx.stroke();

      // === draw event icon ===
      ctx.beginPath();
      if      (ev.type === 'tts')    ctx.arc(x, H - 18, 8, 0, 2 * Math.PI);
      else if (ev.type === 'chat')   ctx.arc(x, H - 12, 4, 0, 2 * Math.PI);
      else if (ev.type === 'Follow') ctx.arc(x, H - 18, 6, 0, 2 * Math.PI);
      else                           ctx.rect(x - 6, H - 25, 13, 13);
      ctx.fillStyle = color;
      ctx.fill();


// -- ajout du label à la hauteur définie dans labelConfig --
const cfg = labelConfig[ev.type] || labelConfig.default;
ctx.font      = cfg.font;
ctx.textAlign = 'center';

if (ev.type === 'TimedAction' && ev.name) {
  // TimedAction : type + name sur deux lignes
  ctx.fillStyle = cfg.color;
  ctx.fillText(ev.type, x, cfg.y);
  const lineHeight = parseInt(cfg.font, 10) + 2;
  ctx.fillText(ev.name, x, cfg.y + lineHeight);
}
else if (ev.type === 'Follow' && ev.displayName) {
  // Follow : type + displayName sur deux lignes
  ctx.fillStyle = cfg.color;
  ctx.fillText(ev.type, x, cfg.y);
  const lineHeight = parseInt(cfg.font, 10) + 2;
  ctx.fillText(ev.displayName, x, cfg.y);
}
else {
  // cas par défaut : un seul label (type)
  ctx.fillStyle = cfg.color;
  ctx.fillText(ev.type, x, cfg.y);
}

      ctx.restore();
    });
  };
  smoothie.streamTo(oscillo, 0);

  // --- timeline controls ---
  function setTimelineWindow(mode, secs = 60) {
    timelineMode = mode;
    timelineBtns.forEach(b => b.classList.remove('active'));

    if (mode === 'scale') {
      lastScaleSeconds = secs;
      document.querySelector(`[data-scale="${secs}"]`).classList.add('active');
      smoothie.options.millisPerPixel = (secs * 1000) / oscillo.width;
    } else {
      document.querySelector('[data-scale="adapt"]').classList.add('active');
      adaptTimeline();
    }
  }
  function adaptTimeline() {
    if (!chatBuffer.length || timelineMode !== 'adapt') return;
    const t0       = Number(new Date(chatBuffer[0].time));
    const duration = Date.now() - t0;
    smoothie.options.millisPerPixel = Math.max(duration / oscillo.width, 10);
  }
  setTimelineWindow('scale', 60);
  setInterval(adaptTimeline, 1500);
  timelineBtns.forEach(btn => btn.addEventListener('click', () => {
    const val = btn.dataset.scale;
    setTimelineWindow(val === 'adapt' ? 'adapt' : 'scale', parseInt(val, 10));
  }));


// --- chat rendering helper ---
function renderChat() {
  const atBottom = chatDiv.scrollHeight - chatDiv.scrollTop <= chatDiv.clientHeight + 20;
  if (!chatBuffer.length) {
    chatDiv.innerHTML = '<div class="chat-msg empty"><span class="chat-usr">…</span><span class="chat-text">Aucun message reçu</span></div>';
  } else {
    chatDiv.innerHTML = chatBuffer.slice(-100).map(m => {
      const cls = m.isTTS ? 'chat-msg chat-tts' : 'chat-msg';
      return '<div class="' + cls + '">' +
               '<span class="chat-usr">' + m.user + ':</span>' +
               '<span class="chat-text">' + m.message + '</span>' +
             '</div>';
    }).join('');
  }
  if (atBottom) chatDiv.scrollTop = chatDiv.scrollHeight;
}

  // --- TTS header + progress bar ---
  function setTtsHeader(user, msg) {
    ttsHeader.innerHTML = `<span style="color:#a5ffef">${user}</span> : ${msg}`;
    lastTtsTime = Date.now();
    clearInterval(ttsProgressInterval);
    clearTimeout(ttsTimeout);
    ttsProgress.style.width = '100%';

    // Met à jour la barre
    ttsProgressInterval = setInterval(() => {
      const pct = Math.max(0, (TTS_MAX - (Date.now() - lastTtsTime)) / TTS_MAX) * 100;
      ttsProgress.style.width = pct + '%';
    }, 250);

    // Après TTS_MAX, on arrête tout
    ttsTimeout = setTimeout(() => {
      clearInterval(ttsProgressInterval);
      ttsProgress.style.width = '0%';
    }, TTS_MAX);
  }

  // --- event feed briefly at top ---
  function showEventFeed(html) {
    eventFeed.innerHTML = html;
    eventFeed.classList.add('show');
    setTimeout(() => eventFeed.classList.remove('show'), 30000);
  }

  // --- save / load session ---
  document.getElementById('save-session').addEventListener('click', () => {
    const blob = new Blob(
      [JSON.stringify({ chat: chatBuffer, events: eventsBuffer }, null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href        = URL.createObjectURL(blob);
    a.download    = `tts-dashboard_${new Date().toISOString()}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  document.getElementById('load-session').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;

    // Stoppe tous les timers existants
    clearInterval(ttsProgressInterval);
    clearTimeout(ttsTimeout);

    const r = new FileReader();
    r.onload = ev => {
      try {
        const sess = JSON.parse(ev.target.result);
        chatBuffer   = Array.isArray(sess.chat)   ? sess.chat    : [];
        eventsBuffer = Array.isArray(sess.events) ? sess.events  : [];
        renderChat();
        if (timelineMode === 'adapt') adaptTimeline();
        alert('Log chargé !');
      } catch (err) {
        console.error(err);
        alert("Erreur : le fichier n'est pas un JSON valide.");
      }
    };
    r.readAsText(f);
  });

  // --- handle incoming normalized events ---
  function handleCustomEvent({ type, time: eventTime, user, message, isEligible }) {
    const time = eventTime || Date.now();

    // Chat classique
    if (type === 'chat') {
      chatBuffer.push({ time, user, message, eligible: isEligible });
      if (chatBuffer.length > maxChat) chatBuffer.shift();
      eventsBuffer.push({ type, time });
      if (eventsBuffer.length > 1000) eventsBuffer.shift();
      renderChat();
      return;
    }

    // TTS
    if (type === 'tts') {
      setTtsHeader(user, message);
      ttsPanel.classList.add('twitch-tts-glow');
      setTimeout(() => ttsPanel.classList.remove('twitch-tts-glow'), 3000);

      chatBuffer.push({ time, user, message, eligible: true, isTTS: true });
      if (chatBuffer.length > maxChat) chatBuffer.shift();
      renderChat();

      eventsBuffer.push({ type, time });
      if (eventsBuffer.length > 1000) eventsBuffer.shift();
      return;
    }

    // Tick interne TTS
    if (type === 'tick') {
      eventsBuffer.push({ type, time });
      if (eventsBuffer.length > 1000) eventsBuffer.shift();
      return;
    }

    // Tous les autres events graphés
    eventsBuffer.push({ type, time });
    if (eventsBuffer.length > 1000) eventsBuffer.shift();
  }

  // --- final init calls ---
  renderChat();
  resizeOscillo();
  setInterval(async () => {
    try {
      const r = await client.getActiveViewers();
      const n = r.viewers.length;
      viewerCountSpan.textContent = n ? `👀 ${n}` : '';
      viewerCountSpan.title       = r.viewers.map(v => v.display).join(', ');
    } catch {
      viewerCountSpan.textContent = '';
      viewerCountSpan.title       = '';
    }
  }, 10000);
});
