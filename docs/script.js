// script.js
document.addEventListener('DOMContentLoaded', () => {
  // === 1) Références UI & variables globales ===
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
  const ttsTimerInput    = document.getElementById('tts-timer');
  const ttsTimerLabel    = document.getElementById('tts-timer-label');
const ttsCandidatesPanel = document.getElementById('tts-candidates-panel');


  let chatBuffer    = [];
  let eventsBuffer  = [];
  const maxChat     = 2000;
  const TTS_MAX     = 3 * 60 * 1000;
  let lastTtsTime, ttsProgressInterval, ttsTimeout;
  let timelineMode      = 'scale';
  let lastScaleSeconds  = 60;

  // === TIMER ACTION ID dynamique ===
  let TTS_TIMER_ACTION_ID = null;
  let lastSentTimer = null;

  // === 1) labelConfig ===
  const labelConfig = {
    tts:   { y:20, font:'10px sans-serif', color:'#ffef61' },
    chat:  { y:12, font:'10px sans-serif', color:'rgba(57,195,255,1)' },
    Follow: { y:15, font:'10px sans-serif', color:'#a7ff8e' },
    Raid:   { y:15, font:'10px sans-serif', color:'#ffae42' },
    AdRun:  { y:15, font:'10px sans-serif', color:'#ffaa00' },
    Sub:    { y:15, font:'10px sans-serif', color:'#ff41b0' },
    ReSub:  { y:15, font:'10px sans-serif', color:'#28e7d7' },
    GiftSub:{ y:15, font:'10px sans-serif', color:'#ff71ce' },
    GiftBomb:{ y:15,font:'10px sans-serif', color:'#ff1f8b' },
    Cheer:  { y:15, font:'10px sans-serif', color:'#ffd256' },
    HypeTrainStart:   { y:15, font:'10px sans-serif', color:'#ff6b6b' },
    HypeTrainUpdate:  { y:15, font:'10px sans-serif', color:'#ff5252' },
    HypeTrainLevelUp: { y:15, font:'10px sans-serif', color:'#ff3b3b' },
    HypeTrainEnd:     { y:15, font:'10px sans-serif', color:'#ff2424' },
    RewardRedemption:{ y:15, font:'10px sans-serif', color:'#8e44ad' },
    RewardCreated:    { y:15, font:'10px sans-serif', color:'#9b59b6' },
    RewardUpdated:    { y:15, font:'10px sans-serif', color:'#71368a' },
    RewardDeleted:    { y:15, font:'10px sans-serif', color:'#5e3370' },
    CommunityGoalContribution:{ y:15, font:'10px sans-serif', color:'#2ecc71' },
    CommunityGoalEnded:       { y:15, font:'10px sans-serif', color:'#27ae60' },
    PollCreated:    { y:15, font:'10px sans-serif', color:'#3498db' },
    PollUpdated:    { y:15, font:'10px sans-serif', color:'#2980b9' },
    PollEnded:      { y:15, font:'10px sans-serif', color:'#1f618d' },
    TimedAction:    { y:15, font:'10px sans-serif', color:'#95a5a6' },
    default:        { y:12, font:'10px sans-serif', color:'#ffffff' }
  };

  // === 1-bis) filtres “pills” ===
  const filterConfig = {};
  Object.keys(labelConfig).forEach(t => filterConfig[t] = { visible: true, labels: true });
  const filtersDiv = document.getElementById('event-filters');
  Object.entries(labelConfig).forEach(([type,cfg]) => {
    if (type === 'default') return;
    const btn = document.createElement('button');
    btn.textContent  = type;
    btn.dataset.type = type;
    btn.style.backgroundColor = cfg.color;
    (()=>{
      const hex = cfg.color.replace('#','');
      const r = parseInt(hex.substr(0,2),16),
            g = parseInt(hex.substr(2,2),16),
            b = parseInt(hex.substr(4,2),16);
      const yiq = (r*299 + g*587 + b*114)/1000;
      btn.style.color = yiq>=128?'#000':'#fff';
    })();
    btn.classList.add('active');
    btn.onclick = () => {
      filterConfig[type].visible = !filterConfig[type].visible;
      btn.classList.toggle('active', filterConfig[type].visible);
    };
    btn.oncontextmenu = e => {
      e.preventDefault();
      filterConfig[type].labels = !filterConfig[type].labels;
      btn.style.opacity = filterConfig[type].labels
        ? (filterConfig[type].visible ? '1' : '0.8')
        : '0.4';
    };
    btn.title = 'clic gauche: toggle barre · clic droit: toggle label';
    filtersDiv.appendChild(btn);
  });

// === 2) connexion Streamer.bot ===
const client = new StreamerbotClient({
  host:'127.0.0.1', port:8080, endpoint:'/', password:'streamer.bot',
  subscribe:'*',
  onConnect: async () => {
    statusDot.classList.replace('offline','online');
    try {
      const resp = await client.getActiveViewers();
      const n = resp.viewers.length;
      viewerCountSpan.textContent = n?`👀 ${n}`:'';
      viewerCountSpan.title = resp.viewers.map(v=>v.display).join(', ');
    } catch {
      viewerCountSpan.textContent = '';
      viewerCountSpan.title = '';
    }
    // === Récupération dynamique de l'ID de l'action TTS Timer Set ===
    try {
      const actionsObj = await client.getActions();
      const ttsTimer = actionsObj.actions.find(a => a.name === "TTS Timer Set");
      if (ttsTimer) {
        TTS_TIMER_ACTION_ID = ttsTimer.id;
      } else {
        console.warn("Action TTS Timer Set non trouvée !");
      }
    } catch(e) {
      console.warn("Erreur récupération actions :", e);
    }

    // === NEW: Récupération de la dernière valeur du cooldown (ttsCooldownMinutes) ===
    try {
      const cooldownResp = await client.getGlobal("ttsCooldownMinutes");
      if (cooldownResp && cooldownResp.status === "ok" && typeof cooldownResp.variable?.value === "number") {
        // Fix UI knob/slider
        ttsTimerInput.value = cooldownResp.variable.value;
        ttsTimerLabel.textContent = cooldownResp.variable.value + ' min';
        lastSentTimer = cooldownResp.variable.value; // Synchronisation
        if (window.$ && typeof $.fn.knob === "function" && ttsTimerInput && $(ttsTimerInput).data('knob')) {
          $(ttsTimerInput).val(cooldownResp.variable.value).trigger('change');
        }
      }
    } catch (e) {
      console.warn("Erreur récupération du cooldown ttsCooldownMinutes :", e);
    }
  },
  onDisconnect: () => {
    statusDot.classList.replace('online','offline');
    viewerCountSpan.textContent = '';
    viewerCountSpan.title = '';
  }
});

// === 2-bis) TTS Timer Control ===
function sendTtsTimer(timerValue) {
  if (!TTS_TIMER_ACTION_ID) {
    console.warn("TTS_TIMER_ACTION_ID non chargé !");
    return; // Attend que l'id soit chargé
  }
  if (timerValue == lastSentTimer) return;
  lastSentTimer = timerValue;
  client.doAction(TTS_TIMER_ACTION_ID, { timer: timerValue });
  ttsTimerLabel.textContent = timerValue + ' min';
}

// Knob jQuery (si chargé)
if (window.$ && typeof $.fn.knob === "function" && ttsTimerInput) {
  $(ttsTimerInput).knob({
    min: 1,
    max: 10,
    width: 48,
    height: 48,
    thickness: 0.4,
    fgColor: "#ffef61",
    bgColor: "#23262b",
    inputColor: "#fff",
    angleOffset: -125,
    angleArc: 250,
    displayInput: true,
    release: function(val) {
      sendTtsTimer(val);
    },
    change: function(val) {
      ttsTimerLabel.textContent = val + ' min';
    }
  });
} else if (ttsTimerInput) {
  // Fallback : slider classique
  ttsTimerInput.addEventListener('input', e => {
    ttsTimerLabel.textContent = ttsTimerInput.value + ' min';
  });
  ttsTimerInput.addEventListener('change', e => {
    sendTtsTimer(Number(ttsTimerInput.value));
  });
}


  // === 3) dispatch events ===
  client.on('*', ({event,data}) => {
    let type = null;
    const now = Date.now();
    if (event.source==='Twitch') {
      switch(event.type) {
        case 'Whisper': type='chat'; break;
        case 'Cheer':   type='Cheer'; break;
        case 'Follow':  type='Follow'; break;
        case 'Raid':    type='Raid'; break;
        case 'AdRun':   type='AdRun'; break;
        case 'Sub':     type='Sub'; break;
        case 'ReSub':   type='ReSub'; break;
        case 'GiftSub': type='GiftSub'; break;
        case 'GiftBomb':type='GiftBomb'; break;
        case 'HypeTrainStart':  type='HypeTrainStart'; break;
        case 'HypeTrainUpdate': type='HypeTrainUpdate'; break;
        case 'HypeTrainLevelUp':type='HypeTrainLevelUp'; break;
        case 'HypeTrainEnd':    type='HypeTrainEnd'; break;
        case 'RewardRedemption':type='RewardRedemption'; break;
        case 'RewardCreated':   type='RewardCreated'; break;
        case 'RewardUpdated':   type='RewardUpdated'; break;
        case 'RewardDeleted':   type='RewardDeleted'; break;
        case 'CommunityGoalContribution': type='CommunityGoalContribution'; break;
        case 'CommunityGoalEnded':        type='CommunityGoalEnded'; break;
        case 'PollCreated':    type='PollCreated'; break;
        case 'PollUpdated':    type='PollUpdated'; break;
        case 'PollEnded':      type='PollEnded'; break;
        default: return;
      }
    }
    else if (event.source==='General') {
      if (data.widget==='tts-catcher') type='chat';
      else if (data.widget==='tts-reader-selection') type='tts';
      else if (data.widget==='tts-reader-tick') type='tick';
      else return;
    }
    else if (event.source==='Misc' && event.type==='TimedAction') {
      type='TimedAction';
    } else return;

    handleCustomEvent({ type, ...data, time: now });
  });

  // === 4) resize canvas ===
  function resizeOscillo(){
    const s = document.querySelector('.timeline-section');
    oscillo.width  = s.clientWidth;
    oscillo.height = s.clientHeight;
  }
  window.addEventListener('resize', resizeOscillo);
  resizeOscillo();

  // === 5) init SmoothieChart ===
  const smoothie = new SmoothieChart({
    millisPerPixel: 60,
    grid: {
      strokeStyle:   '#233',
      fillStyle:     '#16181c',
      lineWidth:     1,
      millisPerLine: 5000,
      verticalSections: 6
    },
    labels: {
      fillStyle: '#ececec',
      fontSize: 14,
      precision: 0
    },
timestampFormatter: date => {
  // On récupère la config du mode (1, 5 ou 10 min)
  if (timelineMode === 'scale') {
    if (lastScaleSeconds === 60) { // 1 min window
      // Une grille chaque 5s, label sur chaque barre
      if (date.getSeconds() % 5 === 0) return "+5s";
    } else if (lastScaleSeconds === 300) { // 5 min window
      // Une grille chaque 5s, label chaque 30s (6 barres)
      if (date.getSeconds() % 30 === 0 && date.getSeconds() !== 0) return "+30s";
    } else if (lastScaleSeconds === 600) { // 10 min window
      // Une grille chaque 5s, label chaque 60s (12 barres)
      if (date.getSeconds() === 0) return "+1min";
    }
  }
  return '';
}

  });
  const dummy = new TimeSeries();
  smoothie.addTimeSeries(dummy, { strokeStyle:'rgba(0,0,0,0)', lineWidth:0 });
  setInterval(() => dummy.append(Date.now(),0), 1000);

  // === 6) onDraw ===
  smoothie.options.onDraw = function({ chart, chartWidth:W, chartHeight:H, options }) {
    const now = chart.currentValueTime || Date.now();
    const mpp = options.millisPerPixel;
    const ctx = chart.canvas.getContext('2d');
    const tol = 5;
    const overlaps = {};

    eventsBuffer.forEach(ev => {
      if (!filterConfig[ev.type]?.visible) return;
      let rawX = W - (now - ev.time)/mpp;

      if (rawX < 0 || rawX > W) return;

      let bucketX = rawX, idx = 0;
      if (ev.type !== 'chat') {
        bucketX = Math.round(rawX / tol) * tol;
        idx = overlaps[bucketX] || 0;
        overlaps[bucketX] = idx + 1;
      }

      const { color, width } = getStyleFor(ev.type);

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = width;
      ctx.beginPath();
      ctx.moveTo(rawX,5);
      ctx.lineTo(rawX,H-5);
      ctx.stroke();

      ctx.beginPath();
      drawIcon(ev.type, ctx, rawX, H);
      ctx.fillStyle = color;
      ctx.fill();

      if (filterConfig[ev.type].labels) {
        drawLabel(ev, ctx, rawX, idx);
      }
      ctx.restore();
    });
  };
  smoothie.streamTo(oscillo,0);

  // === 7) timeline controls ===
  function setTimelineWindow(mode, secs=60){
    timelineMode = mode;
    timelineBtns.forEach(b=>b.classList.remove('active'));
    if (mode==='scale'){
      lastScaleSeconds = secs;
      document.querySelector(`[data-scale="${secs}"]`).classList.add('active');
      smoothie.options.millisPerPixel = (secs*1000)/oscillo.width;
    } else {
      document.querySelector('[data-scale="adapt"]').classList.add('active');
      adaptTimeline();
    }
  }
  function adaptTimeline(){
    if (!chatBuffer.length || timelineMode!=='adapt') return;
    const t0  = Number(new Date(chatBuffer[0].time));
    const dur = Date.now() - t0;
    smoothie.options.millisPerPixel = Math.max(Math.floor(dur/oscillo.width),10);
  }
  setTimelineWindow('scale',60);
  setInterval(adaptTimeline,1500);
  timelineBtns.forEach(btn=>
    btn.addEventListener('click',()=>{
      const v = btn.dataset.scale;
      setTimelineWindow(v==='adapt'?'adapt':'scale',parseInt(v,10));
    })
  );

  // === 8) render chat ===
  function renderChat(){
    const atBottom = chatDiv.scrollHeight - chatDiv.scrollTop <= chatDiv.clientHeight + 20;
    if (!chatBuffer.length) {
      chatDiv.innerHTML = '<div class="chat-msg empty"><span class="chat-usr">…</span><span class="chat-text">Aucun message reçu</span></div>';
    } else {
      chatDiv.innerHTML = chatBuffer.slice(-100).map(m=>{
        const cls = m.isTTS ? 'chat-msg chat-tts' : 'chat-msg';
        return `<div class="${cls}"><span class="chat-usr">${m.user}:</span><span class="chat-text">${m.message}</span></div>`;
      }).join('');
    }
    if (atBottom) chatDiv.scrollTop = chatDiv.scrollHeight;
  }

  // === 9) setTtsHeader ===
  function setTtsHeader(user,msg){
    ttsHeader.innerHTML = `<span style="color:#a5ffef">${user}</span> : ${msg}`;
    lastTtsTime = Date.now();
    clearInterval(ttsProgressInterval);
    clearTimeout(ttsTimeout);
    ttsProgress.style.width = '100%';
    ttsProgressInterval = setInterval(()=>{
      const pct = Math.max(0,(TTS_MAX - (Date.now()-lastTtsTime))/TTS_MAX)*100;
      ttsProgress.style.width = pct+'%';
    },250);
    ttsTimeout = setTimeout(()=>{
      clearInterval(ttsProgressInterval);
      ttsProgress.style.width='0%';
    },TTS_MAX);
  }

  // === 10) event-feed ===
  function showEventFeed(html){
    eventFeed.innerHTML = html;
    eventFeed.classList.add('show');
    setTimeout(()=>eventFeed.classList.remove('show'),30000);
  }

  // === 11) save/load session ===
  document.getElementById('save-session').addEventListener('click',()=>{
    const blob = new Blob([JSON.stringify({chat:chatBuffer,events:eventsBuffer},null,2)],{type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tts-dashboard_${new Date().toISOString()}.json`;
    a.style.display='none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });
  document.getElementById('load-session').addEventListener('change',e=>{
    const f = e.target.files[0]; if(!f) return;
    clearInterval(ttsProgressInterval);
    clearTimeout(ttsTimeout);
    const r = new FileReader();
    r.onload = ev=>{
      try {
        const sess = JSON.parse(ev.target.result);
        chatBuffer   = Array.isArray(sess.chat)?sess.chat:[];
        eventsBuffer = Array.isArray(sess.events)?sess.events:[];
        renderChat();
        if (timelineMode==='adapt') adaptTimeline();
        alert('Log chargé !');
      } catch {
        alert('JSON invalide');
      }
    };
    r.readAsText(f);
  });

  // === 12) handleCustomEvent ===
  function handleCustomEvent({ type, time:eventTime, ...payload }){
    const time = eventTime || Date.now();

    if (type==='chat'){
      chatBuffer.push({ time, user:payload.user, message:payload.message, eligible:payload.isEligible });
      if (chatBuffer.length>maxChat) chatBuffer.shift();
      eventsBuffer.push({ type,time,...payload });
      if (eventsBuffer.length>1000) eventsBuffer.shift();
      renderChat();
      return;
    }

    if (type==='tts'){
      const ttsUser = payload.user||payload.selectedUser;
      setTtsHeader(ttsUser,payload.message);
      ttsPanel.classList.add('twitch-tts-glow');
      setTimeout(()=>ttsPanel.classList.remove('twitch-tts-glow'),3000);

      chatBuffer.push({ time,user:ttsUser,message:payload.message,eligible:true,isTTS:true });
      if (chatBuffer.length>maxChat) chatBuffer.shift();
      renderChat();

      eventsBuffer.push({ type,time,...payload });
      if (eventsBuffer.length>1000) eventsBuffer.shift();

// détails TTS
ttsInfoDiv.innerHTML = '';
if (Array.isArray(payload.candidatesPanel)){
  const entry = payload.candidatesPanel.find(e=>e.user===ttsUser);
  if (entry){
    const ul = document.createElement('ul');
    ul.innerHTML = `
      <li><strong>Utilisateur :</strong> ${ttsUser}</li>
      <li><strong>Messages :</strong> ${entry.messages}</li>
      <li><strong>freshnessScore :</strong> ${entry.freshnessScore.toFixed(3)}</li>
      <li><strong>activityScore :</strong> ${entry.activityScore.toFixed(3)}</li>
      <li><strong>tokenBoost :</strong> ${entry.tokenBoost.toFixed(2)}</li>
      <li><strong>weight :</strong> ${entry.weight.toFixed(3)}</li>
    `;
    ttsInfoDiv.appendChild(ul);
  }
  // Ajout du panel jauges (juste ici !)
  renderCandidatesPanel(payload.candidatesPanel, ttsUser);
} else {
  ttsInfoDiv.textContent = 'Aucune donnée détaillée disponible.';
  ttsCandidatesPanel.innerHTML = '';
}
return;

    }

    if (type==='tick'){
      eventsBuffer.push({ type,time,...payload });
      if (eventsBuffer.length>1000) eventsBuffer.shift();
      return;
    }

    eventsBuffer.push({ type,time,...payload });
    if (eventsBuffer.length>1000) eventsBuffer.shift();
  }

  // === 13) helpers ===
  function getStyleFor(type){
    let color='#888', width=2;
    switch(type){
      case 'tts': color='#ffef61'; break;
      case 'chat': color='rgba(57,195,255,0.4)'; width=1; break;
      case 'Cheer': color='#ffd256'; break;
      case 'Follow': color='#a7ff8e'; break;
      case 'Raid': color='#ffae42'; break;
      case 'AdRun': color:'#ffaa00'; break;
      case 'Sub': color:'#ff41b0'; break;
      case 'ReSub': color:'#28e7d7'; break;
      case 'GiftSub': color:'#ff71ce'; break;
      case 'GiftBomb': color:'#ff1f8b'; break;
      case 'HypeTrainStart': color:'#ff6b6b'; break;
      case 'HypeTrainUpdate':color:'#ff5252'; break;
      case 'HypeTrainLevelUp':color:'#ff3b3b'; break;
      case 'HypeTrainEnd': color:'#ff2424'; break;
      case 'RewardRedemption':color:'#8e44ad'; break;
      case 'RewardCreated': color:'#9b59b6'; break;
      case 'RewardUpdated': color:'#71368a'; break;
      case 'RewardDeleted': color:'#5e3370'; break;
      case 'CommunityGoalContribution':color:'#2ecc71'; break;
      case 'CommunityGoalEnded': color:'#27ae60'; break;
      case 'PollCreated': color:'#3498db'; break;
      case 'PollUpdated': color:'#2980b9'; break;
      case 'PollEnded': color:'#1f618d'; break;
      case 'TimedAction': color:'#95a5a6'; break;
    }
    return { color, width };
  }
function renderCandidatesPanel(candidates, selectedUser) {
  if (!Array.isArray(candidates) || !candidates.length) {
    ttsCandidatesPanel.innerHTML = '<p style="color:#888;text-align:center;margin-top:18px;">Aucun panel reçu.</p>';
    return;
  }


  // Option : limiter à 15 candidats
  const topCandidates = candidates
  .slice() // copie pour ne pas muter l’original
  .sort((a, b) => b.weight - a.weight)
  .slice(0, 15);
  // Cherche le max weight sur CEUX affichés
  const maxWeight = Math.max(...topCandidates.map(u => u.weight)) || 1; // pour éviter division par 0


  ttsCandidatesPanel.innerHTML = `
    <div class="tts-candidates-grid">
      ${topCandidates.map((u, i) => `
        <div class="tts-candidate${u.user===selectedUser ? ' selected' : ''}">
          <div class="tts-candidate-user">${u.user}</div>
          <div class="tts-candidate-bar-row">
            <span class="tts-candidate-rank">${i+1}</span>
            <div class="tts-candidate-bar-outer">
              <div class="tts-candidate-bar-inner"
                   style="width:${(u.weight/maxWeight*100).toFixed(1)}%;"></div>
            </div>
          </div>
          <div class="tts-candidate-meta">
            <span class="tts-candidate-msgs">${u.messages} msg</span>
            <span class="tts-candidate-weight">${u.weight.toFixed(3)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}


// --- Les fonctions drawIcon et drawLabel SONT EN DEHORS ! ---
function drawIcon(type, ctx, x, H){
  if (type==='tts')      ctx.arc(x,H-18, 8,0,2*Math.PI);
  else if (type==='chat')ctx.arc(x,H-12, 4,0,2*Math.PI);
  else if (type==='Follow')ctx.arc(x,H-18,6,0,2*Math.PI);
  else ctx.rect(x-6,H-25,13,13);
}

function drawLabel(ev, ctx, x, idx){
  const cfg = labelConfig[ev.type]||labelConfig.default;
  const lineHeight = parseInt(cfg.font,10)+2;
  const baseY = cfg.y + idx*lineHeight*2;
  ctx.font = cfg.font;
  ctx.textAlign = 'center';
  ctx.fillStyle = cfg.color;

  if (ev.type==='TimedAction'&&ev.name){
    ctx.fillText(ev.type,x,baseY);
    ctx.fillText(ev.name,x,baseY+lineHeight);
  }
  else if (ev.type==='Follow'&&ev.displayName){
    ctx.fillText(ev.type,x,baseY);
    ctx.fillText(ev.displayName,x,baseY+lineHeight);
  }
  else if (ev.type==='Cheer'&&ev.message&&ev.message.hasBits){
    ctx.fillText(ev.type,x,baseY);
    ctx.fillText(`${ev.message.bits} bits`,x,baseY+lineHeight);
    ctx.fillText(ev.message.displayName,x,baseY+lineHeight*2);
  }
  else {
    ctx.fillText(ev.type,x,baseY);
  }
}

  // === final init ===
  renderChat();
  resizeOscillo();

  // viewers & msgs/min & users/min
  setInterval(async()=>{
    try {
      const r = await client.getActiveViewers();
      const n = r.viewers.length;
      viewerCountSpan.textContent = n?`👀 ${n}`:'';
      viewerCountSpan.title = r.viewers.map(v=>v.display).join(', ');
    } catch {
      viewerCountSpan.textContent = '';
      viewerCountSpan.title = '';
    }
    const oneMinAgo = Date.now()-60000;
    const rec = chatBuffer.filter(m=>m.time>=oneMinAgo);
    msgsPerMinSpan.textContent = rec.length;
    usersPerMinSpan.textContent = new Set(rec.map(m=>m.user)).size;
  },10000);

  /*// msgs/s & users/s
  setInterval(()=>{
    const oneSecAgo = Date.now()-1000;
    const lastSec = chatBuffer.filter(m=>m.time>=oneSecAgo);
    document.querySelector('.osc-msg').textContent = lastSec.length;
    document.querySelector('.osc-users').textContent = new Set(lastSec.map(m=>m.user)).size;
  },1000);
*/
});
