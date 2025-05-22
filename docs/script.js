// script.js
document.addEventListener('DOMContentLoaded', () => {

  // === 1) Monkey-patch SmoothieChart to expose an onDraw(chart) hook ===
  (function patchSmoothieOnDraw() {
    if (typeof SmoothieChart === 'undefined' || !SmoothieChart.prototype.render) {
      return setTimeout(patchSmoothieOnDraw, 100);
    }

    const origStart = SmoothieChart.prototype.start;
    SmoothieChart.prototype.start = function() {
      const self = this;
      const oldRender = self.render.bind(self);
      self.render = function(canvas, time) {
        oldRender(canvas, time);
        if (typeof self.options.onDraw === 'function') {
          self.options.onDraw(self);
        }
      };
      origStart.call(self);
    };

    // If chart is already running, re-patch its render immediately
    const origRender = SmoothieChart.prototype.render;
    SmoothieChart.prototype.render = function(canvas, time) {
      origRender.call(this, canvas, time);
      if (typeof this.options.onDraw === 'function') {
        this.options.onDraw(this);
      }
    };

    console.log('✅ SmoothieChart patched for onDraw(chart)');
  })();


  // === 2) Your existing Streamer.bot + UI wiring ===

  const client = new StreamerbotClient({
    host: '127.0.0.1',
    port: 8080,
    endpoint: '/',
    password: 'streamer.bot',
    onConnect: async data => {
      console.log("✅ WebSocket connecté !", data);
      statusDot.classList.replace('offline','online');
      try {
        await client.subscribe('General.Custom');
        console.log("📡 Subscriptions General.Custom envoyées.");
      } catch (e) {
        console.warn("⚠️ Abonnement manuel échoué :", e.message);
      }
      try {
        const resp = await client.getActiveViewers();
        viewerCountSpan.textContent = resp.viewers.length ? `👀 ${resp.viewers.length}` : '';
        viewerCountSpan.title = resp.viewers.map(v=>v.display).join(', ');
      } catch { viewerCountSpan.textContent = ''; }
    },
    onDisconnect: () => {
      console.log("🔌 WebSocket déconnecté !");
      statusDot.classList.replace('online','offline');
      viewerCountSpan.textContent = '';
    }
  });

  // UI refs
  const statusDot      = document.getElementById('status-dot');
  const viewerCountSpan= document.getElementById('viewer-count');
  const chatDiv        = document.getElementById('chat-log');
  const oscillo        = document.getElementById('oscilloscope');
  const timelineBtns   = document.querySelectorAll('.timeline-controls button');
  const ttsHeader      = document.getElementById('tts-header');
  const ttsPanel       = document.getElementById('tts-panel');
  const ttsProgress    = document.querySelector('#tts-progress .bar');
  const eventFeed      = document.getElementById('event-feed');

  let chatBuffer   = [];
  let eventsBuffer = [];
  const maxChat    = 2000;
  const TTS_MAX    = 3*60*1000;
  let lastTtsTime, ttsProgressInterval, ttsTimeout;
  let timelineMode = 'scale', lastScaleSeconds = 60;


  // --- resize oscilloscope canvas ---
  function resizeOscillo() {
    const s = document.querySelector('.timeline-section');
    oscillo.width  = s.clientWidth;
    oscillo.height = s.clientHeight;
  }
  window.addEventListener('resize', resizeOscillo);
  resizeOscillo();


  // --- create & start smoothie chart ---
  const smoothie = new SmoothieChart({
    millisPerPixel: 60,
    grid: {
      strokeStyle: '#233',
      fillStyle:   '#16181c',
      lineWidth:   1,
      millisPerLine: 1000,
      verticalSections: 6
    },
    labels: { fillStyle:'#ececec', fontSize:14, precision:0 },
    timestampFormatter: SmoothieChart.timeFormatter
  });

  // dummy series to keep it animating
  const dummy = new TimeSeries();
  smoothie.addTimeSeries(dummy,{ strokeStyle:'rgba(0,0,0,0)', lineWidth:0 });
  setInterval(()=> dummy.append(Date.now(),0), 1000);

  // === YOUR onDraw hook ===
  smoothie.options.onDraw = chart => {
    const ctx    = chart.canvas.getContext('2d');
    const W      = chart.canvas.width;
    const H      = chart.canvas.height;
    const now    = Date.now();
    const mpp    = chart.options.millisPerPixel;

    eventsBuffer.forEach(ev => {
      const t = new Date(ev.time).getTime();
      const x = W - (now - t)/mpp;
      if (x<0||x>W) return;

      // pick a color
      let color = '#5daaff';
      switch(ev.type){
        case 'tts':      color='#ffef61'; break;
        case 'chat':     color='#39c3ff'; break;
        case 'Follow':   color='#a7ff8e'; break;
        case 'Sub':
        case 'GiftSub':
        case 'GiftBomb': color='#ff41b0'; break;
        case 'ReSub':    color='#28e7d7'; break;
        case 'Cheer':    color='#ffd256'; break;
      }

      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = ev.type==='chat'?2:3;
      // vertical line
      ctx.beginPath();
      ctx.moveTo(x,5);
      ctx.lineTo(x,H-5);
      ctx.stroke();

      // shape at bottom
      ctx.beginPath();
      if (ev.type==='tts')      ctx.arc(x,H-18,8,0,2*Math.PI);
      else if (ev.type==='chat') ctx.arc(x,H-12,4,0,2*Math.PI);
      else if (ev.type==='Follow') ctx.arc(x,H-18,6,0,2*Math.PI);
      else                      ctx.rect(x-6,H-25,13,13);

      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    });
  };

  smoothie.streamTo(oscillo, /*delay=*/0);


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
  function renderChat(){
    const atBottom = chatDiv.scrollHeight - chatDiv.scrollTop <= chatDiv.clientHeight+20;
    if(!chatBuffer.length){
      chatDiv.innerHTML = `<div style="opacity:.5;text-align:center;">Aucun message reçu</div>`;
    } else {
      chatDiv.innerHTML = chatBuffer.slice(-100).map(m=>{
        if(m.isTTS){
          return `<div class="chat-msg chat-tts">[TTS] 
            <span class="chat-usr">${m.user}</span> : ${m.message}
          </div>`;
        }
        return `<div class="chat-msg">
          <span class="chat-usr">${m.user}</span> : ${m.message}
          ${m.eligible? '' : '<span style="opacity:.5;">(non éligible)</span>'}
        </div>`;
      }).join('');
    }
    if(atBottom) chatDiv.scrollTop = chatDiv.scrollHeight;
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


  // --- handle incoming events ---
  function handleCustomEvent(data){
    if(!data?.widget) return;
    if(data.widget==='tts-catcher'){
      chatBuffer.push({ time:data.time, user:data.user, message:data.message, eligible:data.isEligible });
      if(chatBuffer.length>maxChat) chatBuffer.shift();
      eventsBuffer.push({ type:'chat', time:data.time });
      if(eventsBuffer.length>1000) eventsBuffer.shift();
      renderChat();

    } else if(data.widget==='tts-reader-selection'){
      setTtsHeader(data.selectedUser, data.message);
      ttsPanel.classList.add('twitch-tts-glow');
      setTimeout(()=>ttsPanel.classList.remove('twitch-tts-glow'), 3000);
      chatBuffer.push({ time:data.time, user:data.selectedUser, message:data.message, eligible:true, isTTS:true });
      if(chatBuffer.length>maxChat) chatBuffer.shift();
      renderChat();
      eventsBuffer.push({ type:'tts', time:data.time });
      if(eventsBuffer.length>1000) eventsBuffer.shift();

    } else if(data.widget==='tts-reader-tick'){
      eventsBuffer.push({ type:'tick', time:data.time });
      if(eventsBuffer.length>1000) eventsBuffer.shift();
    }
  }

  client.on('General.Custom',   ({ data })=> handleCustomEvent(data));
  client.on('Broadcast.Custom', ({ data })=> handleCustomEvent(data));


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
