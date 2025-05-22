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
  let timelineMode = 'scale', lastScaleSeconds = 60;

  // === 2) Streamer.bot client, subscribe à tous les events ===
  const client = new StreamerbotClient({
    host: '127.0.0.1',
    port: 8080,
    endpoint: '/',
    password: 'streamer.bot',
    subscribe: '*', // tout
    onConnect: async data => {
      console.log("✅ WebSocket connecté !", data);
      statusDot.classList.replace('offline','online');
      try {
        const resp = await client.getActiveViewers();
        viewerCountSpan.textContent = resp.viewers.length ? `👀 ${resp.viewers.length}` : '';
        viewerCountSpan.title = resp.viewers.map(v=>v.display).join(', ');
      } catch {
        viewerCountSpan.textContent = '';
      }
    },
    onDisconnect: () => {
      console.log("🔌 WebSocket déconnecté !");
      statusDot.classList.replace('online','offline');
      viewerCountSpan.textContent = '';
    }
  });

  // === 3) Dispatch centralisé et normalisation en `type` ===
  client.on('*', ({ event, data }) => {
    let type = null;

if (event.source === 'Twitch') {
  switch (event.type) {
    // — Chat
    //case 'ChatMessage':          type = 'chat';    break;
    //case 'Whisper':              type = 'chat';    break;

    // — Bits / Cheers
    case 'Cheer':                type = 'Cheer';   break;

    // — Follows / Raids
    case 'Follow':               type = 'Follow';  break;
    case 'Raid':                 type = 'Raid';    break;

    // — Ads
    case 'AdRun':                type = 'AdRun';   break;

    // — Subs
    case 'Sub':         type = 'Sub'; break;
    case 'Resub':                type = 'ReSub';   break;
    case 'GiftSub':              type = 'GiftSub'; break;
    case 'GiftBomb':             type = 'GiftBomb'; break;

    // — Hype train
    case 'HypeTrainStart':       type = 'HypeTrainStart';  break;
    case 'HypeTrainUpdate':      type = 'HypeTrainUpdate'; break;
    case 'HypeTrainLevelUp':     type = 'HypeTrainLevelUp';break;
    case 'HypeTrainEnd':         type = 'HypeTrainEnd';    break;

    // — Channel points
    case 'RewardRedemption':     type = 'RewardRedemption';break;
    case 'RewardCreated':        type = 'RewardCreated';   break;
    case 'RewardUpdated':        type = 'RewardUpdated';   break;
    case 'RewardDeleted':        type = 'RewardDeleted';   break;

    // — Community goals
    case 'CommunityGoalContribution': type = 'CommunityGoalContribution'; break;
    case 'CommunityGoalEnded':        type = 'CommunityGoalEnded';        break;

    // — Polls
    case 'PollCreated':          type = 'PollCreated'; break;
    case 'PollUpdated':          type = 'PollUpdated'; break;
    case 'PollEnded':            type = 'PollEnded';   break;

    default:
      console.debug(`Twitch non mappé : ${event.type}`);
      return;
  }
}

    else if (event.source === 'General') {
      if (data.widget === 'tts-catcher')              type = 'chat';
      else if (data.widget === 'tts-reader-selection') type = 'tts';
      else if (data.widget === 'tts-reader-tick')      type = 'tick';
      else return;
    }
    else if (event.source === 'Misc') {
      if (event.type === 'TimedAction') type = 'TimedAction';
      else return;
    }
    else return;

    // dispatch vers ton handler
    handleCustomEvent({ type, ...data });
  });

  // === 4) resize canvas ===
  function resizeOscillo() {
    const s = document.querySelector('.timeline-section');
    oscillo.width  = s.clientWidth;
    oscillo.height = s.clientHeight;
  }
  window.addEventListener('resize', resizeOscillo);
  resizeOscillo();

  // === 5) SmoothieChart + dummy series ===
  const smoothie = new SmoothieChart({
    millisPerPixel: 60,
    grid: {
      strokeStyle:    '#233',
      fillStyle:      '#16181c',
      lineWidth:      1,
      millisPerLine:  1000,
      verticalSections: 6
    },
    labels: { fillStyle:'#ececec', fontSize:14, precision:0 },
    timestampFormatter: SmoothieChart.timeFormatter
  });
  const dummy = new TimeSeries();
  smoothie.addTimeSeries(dummy, { strokeStyle:'rgba(0,0,0,0)', lineWidth:0 });
  setInterval(()=> dummy.append(Date.now(),0), 1000);

  // === 6) onDraw hook (avant streamTo) ===
  smoothie.options.onDraw = function({ chart, chartWidth: W, chartHeight: H, options }) {
    const now = Date.now();
    const mpp = options.millisPerPixel;
    const ctx = chart.canvas.getContext('2d');

    eventsBuffer.forEach(ev => {
      const t = new Date(ev.time).getTime();
      const x = W - (now - t) / mpp;
      if (x < 0 || x > W) return;

      let color;
      switch (ev.type) {
//--- Custom
        case "tts":    color = "#ffef61"; break;
        case "chat":   color = "#39c3ff"; break;
//--- Twitch
        case "Follow": color = "#a7ff8e"; break;
        case "Raid":   color = "#ffae42"; break;
        case "AdRun":  color = "#ffaa00"; break;
        case "Sub":      color = "#ff41b0"; break;
        case "ReSub":    color = "#28e7d7"; break;
        case "GiftSub":  color = "#ff71ce"; break;
        case "GiftBomb": color = "#ff1f8b"; break;
        case "Cheer":    color = "#ffd256"; break;
        case "HypeTrainStart":   color = "#ff6b6b"; break;
        case "HypeTrainUpdate":  color = "#ff5252"; break;
        case "HypeTrainLevelUp": color = "#ff3b3b"; break;
        case "HypeTrainEnd":     color = "#ff2424"; break;
        case "RewardRedemption": color = "#8e44ad"; break;
        case "RewardCreated":    color = "#9b59b6"; break;
        case "RewardUpdated":    color = "#71368a"; break;
        case "RewardDeleted":    color = "#5e3370"; break;
        case "CommunityGoalContribution": color = "#2ecc71"; break;
        case "CommunityGoalEnded":        color = "#27ae60"; break;
        case "PollCreated": color = "#3498db"; break;
        case "PollUpdated": color = "#2980b9"; break;
        case "PollEnded":   color = "#1f618d"; break;
//--- Misc
        case "TimedAction": color = "#95a5a6"; break;
        default:            color = "#888888";
      }

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = (ev.type==='chat') ? 2 : 3;
      ctx.beginPath();
      ctx.moveTo(x, 5);
      ctx.lineTo(x, H-5);
      ctx.stroke();

      ctx.beginPath();
      if      (ev.type==='tts')    ctx.arc(x, H-18, 8, 0, 2*Math.PI);
      else if (ev.type==='chat')   ctx.arc(x, H-12, 4, 0, 2*Math.PI);
      else if (ev.type==='Follow') ctx.arc(x, H-18, 6, 0, 2*Math.PI);
      else                          ctx.rect(x-6, H-25, 13,13);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    });
  };

  smoothie.streamTo(oscillo, 0);



  // --- timeline controls ---
  function setTimelineWindow(mode, secs=60){
    timelineMode = mode;
    timelineBtns.forEach(b=>b.classList.remove('active'));
    if(mode==='scale'){
      lastScaleSeconds=secs;
      document.querySelector(`[data-scale="${secs}"]`).classList.add('active');
      smoothie.options.millisPerPixel = (secs*1000)/oscillo.width;
    } else {
      document.querySelector(`[data-scale="adapt"]`).classList.add('active');
      adaptTimeline();
    }
  }
  function adaptTimeline(){
    if(!chatBuffer.length||timelineMode!=='adapt') return;
    const t0 = new Date(chatBuffer[0].time).getTime();
    const duration = Date.now()-t0;
    smoothie.options.millisPerPixel = Math.max(duration/oscillo.width,10);
  }
  setTimelineWindow('scale',60);
  setInterval(adaptTimeline,1500);
  timelineBtns.forEach(btn => btn.addEventListener('click',()=>{
    const val = btn.dataset.scale;
    setTimelineWindow(val==='adapt'?'adapt':'scale', parseInt(val));
  }));


  // --- chat rendering helper ---
function renderChat() {
  const atBottom = chatDiv.scrollHeight - chatDiv.scrollTop <= chatDiv.clientHeight + 20;
  if (!chatBuffer.length) {
    chatDiv.innerHTML = `<div class="chat-msg empty">Aucun message reçu</div>`;
  } else {
    chatDiv.innerHTML = chatBuffer.slice(-100).map(m => {
      if (m.isTTS) {
        return `
        <div class="chat-msg chat-tts">
          <div class="chat-usr">${m.user}:</div>
          <div class="chat-text">${m.message}</div>
        </div>`;
      }
      return `
      <div class="chat-msg">
        <div class="chat-usr">${m.user}:</div>
        <div class="chat-text">${m.message}</div>
      </div>`;
    }).join('');
  }
  if (atBottom) chatDiv.scrollTop = chatDiv.scrollHeight;
}





  // --- TTS header + progress bar ---
  function setTtsHeader(user,msg){
    ttsHeader.innerHTML = `<span style="color:#a5ffef">${user}</span> : ${msg}`;
    lastTtsTime = Date.now();
    clearInterval(ttsProgressInterval);
    clearTimeout(ttsTimeout);
    ttsProgress.style.width='100%';
    ttsProgressInterval = setInterval(()=>{
      const pct = Math.max(0,(TTS_MAX - (Date.now()-lastTtsTime))/TTS_MAX)*100;
      ttsProgress.style.width = pct+'%';
    },250);
  }


  // --- event feed briefly at top ---
  function showEventFeed(html){
    eventFeed.innerHTML = html;
    eventFeed.classList.add('show');
    setTimeout(()=>{
      eventFeed.classList.remove('show');
    },30000);
  }


  // --- save / load session ---
  document.getElementById('save-session').addEventListener('click',()=>{
    const blob = new Blob([JSON.stringify({chat:chatBuffer,events:eventsBuffer},null,2)],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tts-dashboard_${new Date().toISOString()}.json`;
    a.click();
  });
  document.getElementById('load-session').addEventListener('change',e=>{
    const f = e.target.files[0];
    if(!f) return;
    const r = new FileReader();
    r.onload = ev => {
      const sess = JSON.parse(ev.target.result);
      chatBuffer   = sess.chat   || [];
      eventsBuffer = sess.events || [];
      renderChat();
      if(timelineMode==='adapt') adaptTimeline();
      alert('Log chargé !');
    };
    r.readAsText(f);
  });


// --- handle incoming normalized events ---
function handleCustomEvent({ type, time, user, message, isEligible }) {
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

  // Tick interne TTS (tu n’en as peut-être plus besoin si tu gères tout via '*')
  if (type === 'tick') {
    eventsBuffer.push({ type, time });
    if (eventsBuffer.length > 1000) eventsBuffer.shift();
    return;
  }

  // Tous les autres events trackés sur le graph
  // (Follow, Sub, GiftSub, GiftBomb, ReSub, Cheer, Raid, AdRun, etc.)
  // On n’ajoute pas de chatBuffer, mais bien un marqueur visuel
  eventsBuffer.push({ type, time });
  if (eventsBuffer.length > 1000) eventsBuffer.shift();

  // Optionnel : si tu veux aussi afficher un message temporaire
  // showEventFeed(`${type} by ${user || 'system'}`);
}


  // --- final init calls ---
  renderChat();
  resizeOscillo();
  setInterval(async ()=>{
    try {
      const r = await client.getActiveViewers();
      viewerCountSpan.textContent = `👀 ${r.viewers.length}`;
      viewerCountSpan.title = r.viewers.map(v=>v.display).join(', ');
    } catch {
      viewerCountSpan.textContent='';
    }
  }, 10000);

});
