// --- Websocket natif pour indicateur de connexion et events Twitch ---
let ws;
let reconnecting = false;
const statusDot = document.getElementById('status-dot');

function connectWS() {
    ws = new WebSocket("ws://127.0.0.1:8080/");
    ws.onopen = function () {
        statusDot.className = "dot online";
        reconnecting = false;
        // Subscribe aux events Twitch
        ws.send(JSON.stringify({
            "request": "Subscribe",
            "id": "dash-main",
            "events": {
                "Twitch": ["Follow", "Cheer", "Sub", "ReSub", "GiftSub", "GiftBomb"]
            }
        }));
    };
    ws.onclose = function () {
        statusDot.className = "dot reconnecting";
        reconnecting = true;
        setTimeout(connectWS, 7000);
    };
    ws.onerror = function () { statusDot.className = "dot"; };
    ws.onmessage = function (message) {
        try {
            const json = JSON.parse(message.data);
            if (json.event && json.event.source === 'Twitch') {
                // Ajoute sur la timeline selon le type
                let kind = json.event.type;
                let user = json.data.displayName || json.data.recipientDisplayName || 'Twitch';
                let color = {
                    Sub: "#aaf",
                    ReSub: "#5af",
                    GiftSub: "#c9f",
                    GiftBomb: "#f95",
                    Follow: "#6fa",
                    Cheer: "#fa7"
                }[kind] || "#fff";
                eventsBuffer.push({ type: kind.toLowerCase(), time: new Date().toISOString(), user, color });
                if (eventsBuffer.length > 1000) eventsBuffer.shift();
            }
        } catch (e) {}
    };
}
connectWS();

// --- Data buffers ---
let chatBuffer = [];
let maxChat = 2000;
let eventsBuffer = [];
let timelineMode = "scale"; // "scale" | "adapt"
let lastScaleSeconds = 60;

// --- UI Selectors ---
const chatDiv = document.getElementById('chat-log');
const timelineBtns = document.querySelectorAll('.timeline-controls button');

// --- Panel TTS ---
const ttsHeader = document.getElementById('tts-header');
const ttsUser = document.getElementById('tts-user');
const ttsMsg = document.getElementById('tts-message');
const ttsBar = document.getElementById('tts-progress-bar');
const ttsBarFill = ttsBar.querySelector('.tts-progress-fill');
let ttsBarTimeout = null, ttsBarAnim = null;
let lastTtsTime = 0, ttsDuration = 3*60; // 3 min en secondes

function setTtsHeader(user, msg, isoTime) {
    ttsUser.textContent = user ? `[TTS] ${user}` : "Aucun TTS";
    ttsMsg.textContent = msg || "";
    // Remplit la barre et démarre l'animation de vidage
    ttsBarFill.style.width = "100%";
    lastTtsTime = isoTime ? new Date(isoTime).getTime() : Date.now();
    if (ttsBarAnim) clearInterval(ttsBarAnim);
    ttsBarAnim = setInterval(() => {
        let elapsed = (Date.now() - lastTtsTime) / 1000;
        let percent = Math.max(0, 1 - elapsed / ttsDuration);
        ttsBarFill.style.width = (percent * 100) + "%";
        if (percent <= 0) clearInterval(ttsBarAnim);
    }, 250);
}

// --- OSCILLOSCOPE (Smoothie Charts) ---
const oscillo = document.getElementById('oscilloscope');
function resizeOscillo() {
    oscillo.width = oscillo.parentElement.offsetWidth;
    oscillo.height = oscillo.parentElement.offsetHeight - 24;
}
window.addEventListener('resize', resizeOscillo);
resizeOscillo();

const smoothie = new SmoothieChart({
    millisPerPixel: 60,
    grid: { strokeStyle: '#233', fillStyle: '#16181c', lineWidth: 1, millisPerLine: 1000, verticalSections: 6 },
    labels: { fillStyle: '#ececec', fontSize: 14, precision: 0 },
    timestampFormatter: SmoothieChart.timeFormatter
});
const messagesLine = new TimeSeries();
const usersLine = new TimeSeries();

smoothie.addTimeSeries(messagesLine, { strokeStyle: 'rgba(69,255,229,0.95)', lineWidth: 2.5 });
smoothie.addTimeSeries(usersLine, { strokeStyle: 'rgba(93,170,255,0.8)', lineWidth: 2, lineDash: [6,4] });
smoothie.streamTo(oscillo, 0);

smoothie.options.onDraw = function (chart) {
    let now = Date.now();
    let millisPerPixel = chart.options.millisPerPixel || 60;
    let windowMillis = chart.options.duration || (chart.chartWidth * millisPerPixel);
    // Events buffer : timeline markers
    eventsBuffer.forEach(ev => {
        let t = new Date(ev.time).getTime();
        let x = chart.chartWidth - ((now - t) / millisPerPixel);
        if (x < 0 || x > chart.chartWidth) return;
        chart.chart.ctx.save();
        // Couleur par event
        let color = ev.color || (ev.type === 'tts' ? '#ffef61' : '#5daaff');
        chart.chart.ctx.strokeStyle = color;
        chart.chart.ctx.lineWidth = 3.3;
        // Ligne verticale
        chart.chart.ctx.beginPath();
        chart.chart.ctx.moveTo(x, 5);
        chart.chart.ctx.lineTo(x, chart.chartHeight - 5);
        chart.chart.ctx.stroke();
        // Icône par type
        chart.chart.ctx.beginPath();
        if (ev.type === 'tts') {
            chart.chart.ctx.arc(x, chart.chartHeight - 18, 8, 0, 2 * Math.PI);
        } else if (["sub","resub","giftsub","giftbomb"].includes(ev.type)) {
            chart.chart.ctx.rect(x - 6, chart.chartHeight - 25, 13, 13);
        } else if (ev.type === "follow") {
            chart.chart.ctx.moveTo(x - 7, chart.chartHeight - 18);
            chart.chart.ctx.lineTo(x, chart.chartHeight - 25);
            chart.chart.ctx.lineTo(x + 7, chart.chartHeight - 18);
            chart.chart.ctx.closePath();
        } else if (ev.type === "cheer") {
            chart.chart.ctx.arc(x, chart.chartHeight - 22, 7, 0, Math.PI, false);
        }
        chart.chart.ctx.fillStyle = color;
        chart.chart.ctx.fill();
        chart.chart.ctx.restore();
    });
};

function updateOscLabels(msg, usr) {
    document.querySelector('.osc-msg').textContent = msg;
    document.querySelector('.osc-users').textContent = usr;
}

setInterval(() => {
    let now = Date.now();
    let messagesLastSec = chatBuffer.filter(m =>
        new Date(m.time).getTime() > (now - 1000)
    );
    let uniqueUsers = new Set(messagesLastSec.map(m => m.user)).size;
    messagesLine.append(now, messagesLastSec.length);
    usersLine.append(now, uniqueUsers);
    updateOscLabels(messagesLastSec.length, uniqueUsers);
}, 400);

function renderChat() {
    const isAtTop = chatDiv.scrollTop < 20;
    if (chatBuffer.length === 0) {
        chatDiv.innerHTML = `<div style="opacity:.5;text-align:center;">Aucun message reçu</div>`;
        return;
    }
    chatDiv.innerHTML = chatBuffer.slice(-100).reverse().map(msg => {
        if (msg.isTTS) {
            return `<div class="chat-msg chat-tts">[TTS] <span class="chat-usr">${msg.user}</span> : ${msg.message}</div>`;
        }
        return `<div class="chat-msg">
            <span class="chat-usr">${msg.user}</span>
            : ${msg.message} ${msg.eligible ? "" : "<span style='opacity:0.5'>(non éligible)</span>"}
        </div>`;
    }).join('');
    if (isAtTop) chatDiv.scrollTop = 0;
    if (chatDiv.scrollTop !== 0 && chatDiv.scrollHeight > chatDiv.clientHeight) chatDiv.scrollTop = 0;
}

function setTimelineWindow(mode, seconds = 60) {
    timelineMode = mode;
    timelineBtns.forEach(btn => btn.classList.remove('active'));
    if (mode === "scale") {
        let btn = Array.from(timelineBtns).find(b => b.dataset.scale == seconds);
        if (btn) btn.classList.add('active');
        lastScaleSeconds = seconds;
        let px = oscillo.width;
        smoothie.options.millisPerPixel = (seconds * 1000) / px;
    } else if (mode === "adapt") {
        let btn = Array.from(timelineBtns).find(b => b.dataset.scale === "adapt");
        if (btn) btn.classList.add('active');
        adaptTimeline();
    }
}
timelineBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.dataset.scale === "adapt") {
            setTimelineWindow("adapt");
        } else {
            setTimelineWindow("scale", parseInt(btn.dataset.scale));
        }
    });
});
function adaptTimeline() {
    if (timelineMode !== "adapt") return;
    if (chatBuffer.length === 0) return;
    let minTime = new Date(chatBuffer[0].time).getTime();
    let maxTime = Date.now();
    let duration = maxTime - minTime;
    let px = oscillo.width;
    smoothie.options.millisPerPixel = Math.max(duration / px, 10);
}
setInterval(adaptTimeline, 1500);

function saveSession() {
    const data = {
        generatedAt: new Date().toISOString(),
        chat: chatBuffer,
        events: eventsBuffer
    };
    const str = JSON.stringify(data, null, 2);
    const blob = new Blob([str], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tts-dashboard-session_" + (new Date().toISOString().replace(/:/g, '-')) + ".json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
document.getElementById('save-session').addEventListener('click', saveSession);

document.getElementById('load-session').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
        try {
            const session = JSON.parse(evt.target.result);
            if (session && Array.isArray(session.chat) && Array.isArray(session.events)) {
                chatBuffer = session.chat;
                eventsBuffer = session.events;
                renderChat();
                if (timelineMode === "adapt") adaptTimeline();
                alert("Log chargé avec succès ! (mode analyse)");
            } else {
                alert("Fichier de log invalide.");
            }
        } catch (err) {
            alert("Erreur au chargement du log : " + err);
        }
    };
    reader.readAsText(file);
});

// --- Streamer.bot client events TTS/CATCHER ---
window.StreamerbotClient && (() => {
    const client = new StreamerbotClient({
        host: '127.0.0.1',
        port: 8080,
        endpoint: '/',
        password: 'streamer.bot'
    });
    client.on('General.Custom', ({ event, data }) => {
        if (data?.widget === "tts-catcher") {
            chatBuffer.push({
                time: data.time,
                user: data.user,
                message: data.message,
                eligible: data.isEligible
            });
            if (chatBuffer.length > maxChat) chatBuffer.shift();
            renderChat();
        }
        else if (data?.widget === "tts-reader-selection") {
            setTtsHeader(data.selectedUser, data.message, data.time);
            chatBuffer.push({
                time: data.time,
                user: data.selectedUser,
                message: data.message,
                eligible: true,
                isTTS: true
            });
            if (chatBuffer.length > maxChat) chatBuffer.shift();
            renderChat();
            eventsBuffer.push({ type: 'tts', time: data.time, user: data.selectedUser, message: data.message, color: "#ffef61" });
            if (eventsBuffer.length > 1000) eventsBuffer.shift();
        }
        else if (data?.widget === "tts-reader-tick") {
            eventsBuffer.push({ type: 'tick', time: data.time });
            if (eventsBuffer.length > 1000) eventsBuffer.shift();
        }
    });
})();

setTimelineWindow("scale", 60);
