// --- Websocket Streamer.bot config ---
const client = new StreamerbotClient({
    host: '127.0.0.1',
    port: 8080,
    endpoint: '/',
    password: 'streamer.bot',
    onConnect: async (data) => {
        console.log("✅ WebSocket connecté !", data);
        statusDot.classList.remove('offline');
        statusDot.classList.add('online');

        try {
            await client.subscribe('General.Custom');
            console.log("📡 Subscriptions General.Custom envoyées.");
        } catch (err) {
            console.warn("⚠️ Abonnement manuel échoué :", err.message);
        }

        try {
            const resp = await client.getActiveViewers();
            if (resp && resp.viewers) {
                viewerCountSpan.textContent = "👀 " + resp.viewers.length;
                viewerCountSpan.title = resp.viewers.map(v => v.display).join(', ');
            }
        } catch (e) {
            viewerCountSpan.textContent = "";
        }
    },
    onDisconnect: () => {
        console.log("🔌 WebSocket déconnecté !");
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
        viewerCountSpan.textContent = "";
    }
});

// --- Buffers & UI ---
let chatBuffer = [];
let eventsBuffer = [];
let maxChat = 2000;
let timelineMode = "scale";
let lastScaleSeconds = 60;
let ttsTimeout = null;
let ttsProgressInterval = null;
let lastTtsTime = 0;
const TTS_MAX = 3 * 60 * 1000;

const chatDiv = document.getElementById('chat-log');
const statusDot = document.getElementById('status-dot');
const viewerCountSpan = document.getElementById('viewer-count');
const timelineBtns = document.querySelectorAll('.timeline-controls button');
const oscillo = document.getElementById('oscilloscope');
const ttsHeader = document.getElementById('tts-header');
const ttsPanel = document.getElementById('tts-panel');
const ttsProgress = document.querySelector('#tts-progress .bar');
const eventFeed = document.getElementById('event-feed');

// --- Timeline / Smoothie ---
function resizeOscillo() {
    const section = document.querySelector('.timeline-section');
    oscillo.width = section.clientWidth;
    oscillo.height = section.clientHeight;
}
window.addEventListener('resize', resizeOscillo);
resizeOscillo();

const smoothie = new SmoothieChart({
    millisPerPixel: 60,
    grid: { strokeStyle: '#233', fillStyle: '#16181c', lineWidth: 1, millisPerLine: 1000, verticalSections: 6 },
    labels: { fillStyle: '#ececec', fontSize: 14, precision: 0 },
    timestampFormatter: SmoothieChart.timeFormatter
});
smoothie.streamTo(oscillo, 0);

smoothie.options.onDraw = function (chart) {
    const now = Date.now();
    const px = chart.chartWidth;
    const mp = chart.options.millisPerPixel || 60;
    const ctx = chart.chart.ctx;

    // DEBUG:
    console.log("🟢 [onDraw] Chart draw", {
        chartWidth: px,
        millisPerPixel: mp,
        eventsCount: eventsBuffer.length
    });

    eventsBuffer.forEach(ev => {
        if (!ev?.time || !ev.type) return;

        const t = new Date(ev.time).getTime();
        const x = px - ((now - t) / mp);
        if (isNaN(x)) {
            console.warn("⚠️ [onDraw] Invalid timestamp for event:", ev);
            return;
        }
        if (x < 0 || x > px) return;

        let color = "#5daaff";
        switch (ev.type) {
            case "tts": color = "#ffef61"; break;
            case "chat": color = "#39c3ff"; break;
            case "Follow": color = "#a7ff8e"; break;
            case "Sub": case "GiftSub": case "GiftBomb": color = "#ff41b0"; break;
            case "ReSub": color = "#28e7d7"; break;
            case "Cheer": color = "#ffd256"; break;
        }

        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = (ev.type === "chat") ? 2 : 3;
        ctx.beginPath();
        ctx.moveTo(x, 5);
        ctx.lineTo(x, chart.chartHeight - 5);
        ctx.stroke();

        ctx.beginPath();
        if (ev.type === "tts") {
            ctx.arc(x, chart.chartHeight - 18, 8, 0, 2 * Math.PI);
        } else if (ev.type === "chat") {
            ctx.arc(x, chart.chartHeight - 12, 4, 0, 2 * Math.PI);
        } else if (ev.type === "Follow") {
            ctx.arc(x, chart.chartHeight - 18, 6, 0, 2 * Math.PI);
        } else {
            ctx.rect(x - 6, chart.chartHeight - 25, 13, 13);
        }

        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    });
};

// --- Timeline Mode ---
function setTimelineWindow(mode, seconds = 60) {
    timelineMode = mode;
    timelineBtns.forEach(btn => btn.classList.remove('active'));
    if (mode === "scale") {
        document.querySelector(`[data-scale="${seconds}"]`)?.classList.add('active');
        lastScaleSeconds = seconds;
        smoothie.options.millisPerPixel = (seconds * 1000) / oscillo.width;
    } else if (mode === "adapt") {
        document.querySelector(`[data-scale="adapt"]`)?.classList.add('active');
        adaptTimeline();
    }
}
function adaptTimeline() {
    if (chatBuffer.length === 0 || timelineMode !== "adapt") return;
    const min = new Date(chatBuffer[0].time).getTime();
    const duration = Date.now() - min;
    smoothie.options.millisPerPixel = Math.max(duration / oscillo.width, 10);
}
setInterval(adaptTimeline, 1500);
timelineBtns.forEach(btn => btn.addEventListener('click', () => {
    const val = btn.dataset.scale;
    setTimelineWindow(val === "adapt" ? "adapt" : "scale", parseInt(val));
}));

// --- Chat Rendering ---
function renderChat() {
    const isAtBottom = chatDiv.scrollHeight - chatDiv.scrollTop <= chatDiv.clientHeight + 20;

    if (chatBuffer.length === 0) {
        chatDiv.innerHTML = `<div style="opacity:.5;text-align:center;">Aucun message reçu</div>`;
        return;
    }

    chatDiv.innerHTML = chatBuffer.slice(-100).map(msg => {
        if (msg.isTTS) {
            return `<div class="chat-msg chat-tts">[TTS] <span class="chat-usr">${msg.user}</span> : ${msg.message}</div>`;
        }
        return `<div class="chat-msg"><span class="chat-usr">${msg.user}</span> : ${msg.message}${msg.eligible ? "" : " <span style='opacity:0.5'>(non éligible)</span>"}</div>`;
    }).join('');

    // Auto-scroll si on est déjà en bas
    if (isAtBottom) chatDiv.scrollTop = chatDiv.scrollHeight;
}

// --- TTS Display ---
function setTtsHeader(user, message, time) {
    ttsHeader.innerHTML = `<span style="color:#a5ffef;">${user}</span> : <span>${message}</span>`;
    lastTtsTime = Date.now();
    updateTtsProgressBar();
    clearTimeout(ttsTimeout);
    clearInterval(ttsProgressInterval);
    ttsProgress.style.width = '100%';
    ttsProgressInterval = setInterval(updateTtsProgressBar, 250);
}
function updateTtsProgressBar() {
    const elapsed = Date.now() - lastTtsTime;
    const percent = Math.max(0, (TTS_MAX - elapsed) / TTS_MAX) * 100;
    ttsProgress.style.width = percent + '%';
}

// --- Event Feed Display ---
function showEventFeed(msg) {
    eventFeed.innerHTML = msg;
    eventFeed.classList.add('show');
    eventFeed.style.display = "block";
    setTimeout(() => {
        eventFeed.classList.remove('show');
        eventFeed.style.display = "none";
    }, 30000);
}

// --- Save / Load Logs ---
document.getElementById('save-session').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ chat: chatBuffer, events: eventsBuffer }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tts-dashboard-session_${new Date().toISOString().replace(/:/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('load-session').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
        try {
            const session = JSON.parse(evt.target.result);
            chatBuffer = session.chat || [];
            eventsBuffer = session.events || [];
            renderChat();
            if (timelineMode === "adapt") adaptTimeline();
            alert("Log chargé avec succès !");
        } catch (err) {
            alert("Erreur au chargement du log : " + err);
        }
    };
    reader.readAsText(file);
});

// --- Event Handlers ---
function handleCustomEvent(data) {
    try {
        if (!data?.widget) return;
        if (data.widget === "tts-catcher") {
            chatBuffer.push({ time: data.time, user: data.user, message: data.message, eligible: data.isEligible });
            if (chatBuffer.length > maxChat) chatBuffer.shift();
            eventsBuffer.push({ type: 'chat', time: data.time, user: data.user, message: data.message });
            if (eventsBuffer.length > 1000) eventsBuffer.shift();
            renderChat();
        } else if (data.widget === "tts-reader-selection") {
            setTtsHeader(data.selectedUser, data.message, data.time);
            ttsPanel.classList.remove('twitch-tts-glow', 'fade');
            void ttsPanel.offsetWidth;
            ttsPanel.classList.add('twitch-tts-glow');
            setTimeout(() => ttsPanel.classList.add('fade'), 10);
            setTimeout(() => ttsPanel.classList.remove('twitch-tts-glow', 'fade'), 3010);
            chatBuffer.push({ time: data.time, user: data.selectedUser, message: data.message, eligible: true, isTTS: true });
            if (chatBuffer.length > maxChat) chatBuffer.shift();
            renderChat();
            eventsBuffer.push({ type: 'tts', time: data.time, user: data.selectedUser, message: data.message });
            if (eventsBuffer.length > 1000) eventsBuffer.shift();
        } else if (data.widget === "tts-reader-tick") {
            eventsBuffer.push({ type: 'tick', time: data.time });
            if (eventsBuffer.length > 1000) eventsBuffer.shift();
        }
    } catch (err) {
        console.error("❌ Erreur dans handleCustomEvent:", err, data);
    }
}

// --- Subscribed Event Handlers ---
client.on('General.Custom', ({ event, data }) => {
    console.log("📨 [General.Custom] RECU :", data);
    handleCustomEvent(data);
});
client.on('Broadcast.Custom', ({ event, data }) => {
    console.log("📨 [Broadcast.Custom] RECU :", data);
    handleCustomEvent(data);
});

// --- Init ---
setTimelineWindow("scale", 60);
renderChat();
resizeOscillo();
setInterval(() => {
    client.getActiveViewers().then(resp => {
        viewerCountSpan.textContent = resp?.viewers?.length ? `👀 ${resp.viewers.length}` : "";
        viewerCountSpan.title = resp?.viewers?.map(v => v.display).join(', ') ?? "";
    }).catch(() => viewerCountSpan.textContent = "");
}, 10000);
