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

  // === 2) Streamer.bot client init ===
  const client = new StreamerbotClient({
    host:     '127.0.0.1',
    port:     8080,
    endpoint: '/',
    password: 'streamer.bot',
    subscribe: '*',
    onConnect: async data => {
      statusDot.classList.replace('offline','online');
      try {
        const resp = await client.getActiveViewers();
        const n = resp.viewers.length;
        viewerCountSpan.textContent = n ? `👀 ${n}` : '';
        viewerCountSpan.title       = resp.viewers.map(v=>v.display).join(', ');
      } catch {
        viewerCountSpan.textContent = '';
        viewerCountSpan.title       = '';
      }
    },
    onDisconnect: () => {
      statusDot.classList.replace('online','offline');
      viewerCountSpan.textContent = '';
      viewerCountSpan.title       = '';
    }
  });

  // === 3) Dispatch & normalize events into `type` ===
  client.on('*', ({ event, data }) => {
    let type = null;
    const now = Date.now();

    if (event.source === 'Twitch') {
      switch (event.type) {
        case 'Whisper':     type = 'chat';    break;
        case 'Cheer':       type = 'Cheer';   break;
        case 'Follow':      type = 'Follow';  break;
        case 'Raid':        type = 'Raid';    break;
        case 'AdRun':       type = 'AdRun';   break;
        case 'Sub':         type = 'Sub';     break;
        case 'ReSub':       type = 'ReSub';   break;
        case 'GiftSub':     type = 'GiftSub'; break;
        case 'GiftBomb':    type = 'GiftBomb';break;
        case 'HypeTrainStart':  type = 'HypeTrainStart';  break;
        case 'HypeTrainUpdate': type = 'HypeTrainUpdate'; break;
        case 'HypeTrainLevelUp':type = 'HypeTrainLevelUp';break;
        case 'HypeTrainEnd':    type = 'HypeTrainEnd';    break;
        case 'RewardRedemption':type = 'RewardRedemption';break;
        case 'RewardCreated':   type = 'RewardCreated';   break;
        case 'RewardUpdated':   type = 'RewardUpdated';   break;
        case 'RewardDeleted':   type = 'RewardDeleted';   break;
        case 'CommunityGoalContribution': type = 'CommunityGoalContribution'; break;
        case 'CommunityGoalEnded':        type = 'CommunityGoalEnded';        break;
        case 'PollCreated':    type = 'PollCreated'; break;
        case 'PollUpdated':    type = 'PollUpdated'; break;
        case 'PollEnded':      type = 'PollEnded';   break;
        default: return;
      }
    }
else if (event.source === 'General') {
  if      (data.widget === 'tts-catcher')          type = 'chat';
  else if (data.widget === 'tts-reader-selection') type = 'tts';
  else if (data.widget === 'tts-reader-tick')      type = 'tick';
  else return;
}

    else if (event.source === 'Misc') {
      if (event.type === 'TimedAction') type = 'TimedAction';
      else return;
    }
    else return;
/* On spread data AVANT `time`, sinon `data.time` (string ISO) écrase notre timestamp numérique */
    handleCustomEvent({ type, ...data, time: now });
  });

  // === labelConfig: per-type label positions & styles ===
  const labelConfig = {
    tts:   { y: 20, font: '10px sans-serif', color: '#ffef61' },
    chat:  { y: 12, font: '10px sans-serif', color: 'rgba(57,195,255,1)' },
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
    TimedAction:               { y: 15, font: '10px sans-serif', color: '#95a5a6' },
    default:                   { y: 12, font: '10px sans-serif', color: '#ffffff' }
  };

  // === 4) Resize canvas ===
  function resizeOscillo() {
    const s = document.querySelector('.timeline-section');
    oscillo.width  = s.clientWidth;
    oscillo.height = s.clientHeight;
  }
  window.addEventListener('resize', resizeOscillo);
  resizeOscillo();

  // === 5) Init SmoothieChart + dummy series ===
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

// === 6) onDraw hook: draw bars, icons & labels ===
smoothie.options.onDraw = function({ chart, chartWidth: W, chartHeight: H, options }) {
  const now    = Date.now();
  const mpp    = options.millisPerPixel;
  const ctx    = chart.canvas.getContext('2d');
  const tolPx  = 5;
  const overlaps = {};

  eventsBuffer.forEach(ev => {
    const rawX    = W - (now - ev.time) / mpp;
    if (rawX < 0 || rawX > W) return;
    const bucketX = Math.round(rawX / tolPx) * tolPx;
    const idx     = overlaps[bucketX] || 0;
    overlaps[bucketX] = idx + 1;

    const { color, width } = getStyleFor(ev.type);

    
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = width;

    // — draw vertical bar at rawX
    ctx.beginPath();
    ctx.moveTo(rawX, 5);
    ctx.lineTo(rawX, H - 5);
    ctx.stroke();

    // — draw icon at rawX
    ctx.beginPath();
    drawIcon(ev.type, ctx, rawX, H);
    ctx.fillStyle = color;
    ctx.fill();

    // — draw label at rawX, offset by idx
    drawLabel(ev, ctx, rawX, idx);

    ctx.restore();



  });  // ← fin du forEach

};  // ← fin de la fonction onDraw

smoothie.streamTo(oscillo, 0);


  // === 7) Timeline controls & adapt ===
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
    setTimelineWindow(val === 'adapt' ? 'adapt' : 'scale', parseInt(val,10));
  }));

  // === 8) Chat rendering ===
  function renderChat() {
    const atBottom = chatDiv.scrollHeight - chatDiv.scrollTop <= chatDiv.clientHeight + 20;
    if (!chatBuffer.length) {
      chatDiv.innerHTML = '<div class="chat-msg empty"><span class="chat-usr">…</span><span class="chat-text">Aucun message reçu</span></div>';
    } else {
      chatDiv.innerHTML = chatBuffer.slice(-100).map(m => {
        const cls = m.isTTS ? 'chat-msg chat-tts' : 'chat-msg';
        return `<div class="${cls}"><span class="chat-usr">${m.user}:</span><span class="chat-text">${m.message}</span></div>`;
      }).join('');
    }
    if (atBottom) chatDiv.scrollTop = chatDiv.scrollHeight;
  }

  // === 9) TTS header & progress ===
  function setTtsHeader(user, msg) {
    ttsHeader.innerHTML = `<span style="color:#a5ffef">${user}</span> : ${msg}`;
    lastTtsTime = Date.now();
    clearInterval(ttsProgressInterval);
    clearTimeout(ttsTimeout);
    ttsProgress.style.width = '100%';
    ttsProgressInterval = setInterval(() => {
      const pct = Math.max(0,(TTS_MAX - (Date.now()-lastTtsTime))/TTS_MAX)*100;
      ttsProgress.style.width = pct + '%';
    },250);
    ttsTimeout = setTimeout(()=>{
      clearInterval(ttsProgressInterval);
      ttsProgress.style.width = '0%';
    }, TTS_MAX);
  }

  // === 10) Event feed snackbar ===
  function showEventFeed(html) {
    eventFeed.innerHTML = html;
    eventFeed.classList.add('show');
    setTimeout(() => eventFeed.classList.remove('show'), 30000);
  }

  // === 11) Save / load session ===
  document.getElementById('save-session').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({chat:chatBuffer,events:eventsBuffer},null,2)],{type:'application/json'});
    const a = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `tts-dashboard_${new Date().toISOString()}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
  document.getElementById('load-session').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    clearInterval(ttsProgressInterval);
    clearTimeout(ttsTimeout);
    const r = new FileReader();
    r.onload = ev => {
      try {
        const sess = JSON.parse(ev.target.result);
        chatBuffer   = Array.isArray(sess.chat)   ? sess.chat    : [];
        eventsBuffer = Array.isArray(sess.events) ? sess.events  : [];
        renderChat();
        if (timelineMode==='adapt') adaptTimeline();
        alert('Log chargé !');
      } catch {
        alert("JSON invalide");
      }
    };
    r.readAsText(f);
  });

  // === 12) Event handler with full payload ===
  function handleCustomEvent({ type, time: eventTime, ...payload }) {
console.log('EV RAW →', type, payload);
    const time = eventTime || Date.now();

    if (type === 'chat') {
      chatBuffer.push({ time, user: payload.user, message: payload.message, eligible: payload.isEligible });
      if (chatBuffer.length>maxChat) chatBuffer.shift();
      eventsBuffer.push({ type, time, ...payload });
      if (eventsBuffer.length>1000) eventsBuffer.shift();
      renderChat();
      return;
    }
    if (type === 'tts') {
      setTtsHeader(payload.user, payload.message);
      ttsPanel.classList.add('twitch-tts-glow');
      setTimeout(()=>ttsPanel.classList.remove('twitch-tts-glow'),3000);
      chatBuffer.push({ time, user:payload.user, message:payload.message, eligible:true, isTTS:true });
      if (chatBuffer.length>maxChat) chatBuffer.shift();
      renderChat();
      eventsBuffer.push({ type, time, ...payload });
      if (eventsBuffer.length>1000) eventsBuffer.shift();
      return;
    }
    if (type === 'tick') {
      eventsBuffer.push({ type, time, ...payload });
      if (eventsBuffer.length>1000) eventsBuffer.shift();
      return;
    }
    eventsBuffer.push({ type, time, ...payload });
    if (eventsBuffer.length>1000) eventsBuffer.shift();
  }

  // === 13) Helper functions ===
function getStyleFor(type) {
  let color = '#888888';
  let width = 2;

  switch (type) {
    // Custom
    case 'tts':      color = '#ffef61';      break;
    case 'chat':      color = 'rgba(57,195,255,0.7)';      width = 1;      break;

    // Twitch
    case 'Cheer':      color = '#ffd256';      break;
    case 'Follow':      color = '#a7ff8e';      break;
    case 'Raid':      color = '#ffae42';      break;
    case 'AdRun':      color = '#ffaa00';      break;
    case 'Sub':      color = '#ff41b0';      break;
    case 'ReSub':      color = '#28e7d7';      break;
    case 'GiftSub':      color = '#ff71ce';      break;
    case 'GiftBomb':      color = '#ff1f8b';      break;
    case 'HypeTrainStart':      color = '#ff6b6b';      break;
    case 'HypeTrainUpdate':      color = '#ff5252';      break;
    case 'HypeTrainLevelUp':      color = '#ff3b3b';      break;
    case 'HypeTrainEnd':      color = '#ff2424';      break;
    case 'RewardRedemption':      color = '#8e44ad';      break;
    case 'RewardCreated':      color = '#9b59b6';      break;
    case 'RewardUpdated':      color = '#71368a';      break;
    case 'RewardDeleted':      color = '#5e3370';      break;
    case 'CommunityGoalContribution':      color = '#2ecc71';      break;
    case 'CommunityGoalEnded':      color = '#27ae60';      break;
    case 'PollCreated':      color = '#3498db';      break;
    case 'PollUpdated':      color = '#2980b9';      break;
    case 'PollEnded':      color = '#1f618d';      break;

    // Misc
    case 'TimedAction':      color = '#95a5a6';      break;

    // fallback kept at defaults
  }

  return { color, width };
}

  function drawIcon(type, ctx, x, H) {
    if      (type==='tts')     ctx.arc(x, H-18,  8, 0, 2*Math.PI);
    else if (type==='chat')    ctx.arc(x, H-12,  4, 0, 2*Math.PI);
    else if (type==='Follow')  ctx.arc(x, H-18,  6, 0, 2*Math.PI);
    else                       ctx.rect(x-6, H-25, 13, 13);
  }

  function drawLabel(ev, ctx, x, idx) {
    const cfg        = labelConfig[ev.type] || labelConfig.default;
    const lineHeight = parseInt(cfg.font,10)+2;
    const baseY      = cfg.y + idx*lineHeight*2;
    ctx.font      = cfg.font;
    ctx.textAlign = 'center';
    ctx.fillStyle = cfg.color;

if (ev.type === 'chat') {
    // on affiche la barre, mais pas le label
    return;
  }
// TimedAction : 2 lignes (type + name)
   else if (ev.type==='TimedAction' && ev.name) {
      ctx.fillText(ev.type, x, baseY);
      ctx.fillText(ev.name, x, baseY + lineHeight);
    }

// Follow : 2 lignes (type + displayName)
    else if (ev.type==='Follow' && ev.displayName) {
      ctx.fillText(ev.type, x, baseY);
      ctx.fillText(ev.displayName, x, baseY + lineHeight);
    }

// Cheer : 3 lignes (type + <n> bits + displayName)
    else if (ev.type === 'Cheer' && ev.message && ev.message.hasBits) {
      ctx.fillText(ev.type, x, baseY);
      ctx.fillText(`${ev.message.bits} bits`, x, baseY + lineHeight);
      ctx.fillText(ev.message.displayName, x, baseY + lineHeight * 2);
    }
// Default : 1 ligne (type)    
    else {
      ctx.fillText(ev.type, x, baseY);
    }
  }

  // === 14) Final init calls ===
  renderChat();
  resizeOscillo();
  setInterval(async () => {
    try {
      const r = await client.getActiveViewers();
      const n = r.viewers.length;
      viewerCountSpan.textContent = n ? `👀 ${n}` : '';
      viewerCountSpan.title       = r.viewers.map(v=>v.display).join(', ');
    } catch {
      viewerCountSpan.textContent = '';
      viewerCountSpan.title       = '';
    }
  }, 10000);
});
