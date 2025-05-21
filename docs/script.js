// --- Websocket Streamer.bot config ---
const client = new StreamerbotClient({
    host: '127.0.0.1',
    port: 8080,
    endpoint: '/',
    password: 'streamer.bot',
    onConnect: async (data) => {
        console.log("WebSocket connecté !", data);
        statusDot.classList.remove('offline');
        statusDot.classList.add('online');
        // Active viewers
        try {
            const resp = await client.getActiveViewers();
            if (resp && resp.viewers) {
                viewerCountSpan.textContent = "👀 " + resp.viewers.length;
                viewerCountSpan.title = resp.viewers.map(v => v.display).join(', ');
            } else {
                viewerCountSpan.textContent = "";
            }
        } catch (e) {
            viewerCountSpan.textContent = "";
        }
    },
    onDisconnect: () => {
        console.log("WebSocket déconnecté !");
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
        viewerCountSpan.textContent = "";
    }
});


// --- Data buffers ---
let chatBuffer = [];
let maxChat = 2000;
let eventsBuffer = [];
let timelineMode = "scale"; // "scale" | "adapt"
let lastScaleSeconds = 60;

let ttsTimeout = null;
let ttsProgressInterval = null;
let lastTtsTime = 0;
const TTS_MAX = 3 * 60 * 1000; // 3 minutes

// --- UI Selectors ---
const chatDiv = document.getElementById('chat-log');
const statusDot = document.getElementById('status-dot');
const viewerCountSpan = document.getElementById('viewer-count');
const timelineBtns = document.querySelectorAll('.timeline-controls button');
const oscillo = document.getElementById('oscilloscope');
const ttsHeader = document.getElementById('tts-header');
const ttsPanel = document.getElementById('tts-panel');
const ttsProgress = document.querySelector('#tts-progress .bar');
const eventFeed = document.getElementById('event-feed');

// --- Graph Setup (Smoothie Charts) ---
function resizeOscillo() {
    const timelineSection = document.querySelector('.timeline-section');
    const oscillo = document.getElementById('oscilloscope');
    // Récupère largeur et hauteur de la section (padding/marges retirés)
    oscillo.width = timelineSection.clientWidth;
    oscillo.height = timelineSection.clientHeight;
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
    let now = Date.now();
    let millisPerPixel = chart.options.millisPerPixel || 60;
    let windowMillis = chart.options.duration || (chart.chartWidth * millisPerPixel);

    // Events (ex: TTS, Twitch events)
    eventsBuffer.forEach(ev => {
    let t = new Date(ev.time).getTime();
    let x = chart.chartWidth - ((now - t) / millisPerPixel);
    if (x < 0 || x > chart.chartWidth) return;

    let color;
    let iconType = ev.type;
    switch (iconType) {
        case "tts":      color = "#ffef61"; break;       // Jaune pour TTS
        case "chat":     color = "#39c3ff"; break;       // BLEU VIF pour chat
        case "Sub":      color = "#42b0ff"; break;
        case "ReSub":    color = "#28e7d7"; break;
        case "GiftSub":  color = "#ff41b0"; break;
        case "GiftBomb": color = "#ff41b0"; break;
        case "Follow":   color = "#a7ff8e"; break;
        case "Cheer":    color = "#ffd256"; break;
        default:         color = "#5daaff";
    }

    chart.chart.ctx.save();
    chart.chart.ctx.strokeStyle = color;
    chart.chart.ctx.lineWidth = (iconType === "chat") ? 2 : 3;
    chart.chart.ctx.beginPath();
    chart.chart.ctx.moveTo(x, 5);
    chart.chart.ctx.lineTo(x, chart.chartHeight - 5);
    chart.chart.ctx.stroke();

    // Dessin icône/marqueur
    chart.chart.ctx.beginPath();
    if (iconType === "tts") {
        chart.chart.ctx.arc(x, chart.chartHeight - 18, 8, 0, 2 * Math.PI);
    } else if (iconType === "chat") {
        chart.chart.ctx.arc(x, chart.chartHeight - 12, 4, 0, 2 * Math.PI); // petit point bleu
    } else if (iconType === "Follow") {
        chart.chart.ctx.arc(x, chart.chartHeight - 18, 6, 0, 2 * Math.PI);
    } else {
        chart.chart.ctx.rect(x - 6, chart.chartHeight - 25, 13, 13);
    }
    chart.chart.ctx.fillStyle = color;
    chart.chart.ctx.fill();
    chart.chart.ctx.restore();
});


function updateOscLabels(msg, usr) {
    document.querySelector('.osc-msg').textContent = msg;
    document.querySelector('.osc-users').textContent = usr;
}



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

// Redimensionne le canvas au resize (optionnel, adaptatif)
window.addEventListener('resize', () => {
    oscillo.width = oscillo.parentElement.offsetWidth;
});

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

// -- TTS Header + Progress
function setTtsHeader(user, message, time) {
    ttsHeader.innerHTML = `<span style="color:#a5ffef;">${user}</span> : <span>${message}</span>`;
    lastTtsTime = Date.now();
    updateTtsProgressBar();
    if (ttsTimeout) clearTimeout(ttsTimeout);
    if (ttsProgressInterval) clearInterval(ttsProgressInterval);

    // Remplir la barre à fond, puis la vider en 3 min
    ttsProgress.style.width = '100%';
    ttsProgressInterval = setInterval(updateTtsProgressBar, 250);
}

function updateTtsProgressBar() {
    let now = Date.now();
    let elapsed = now - lastTtsTime;
    let remaining = Math.max(0, TTS_MAX - elapsed);
    let percent = Math.max(0, remaining / TTS_MAX) * 100;
    ttsProgress.style.width = percent + '%';
}

// -- Event Feed
function showEventFeed(msg) {
    eventFeed.innerHTML = msg;
    eventFeed.classList.add('show');
    eventFeed.style.display = "block";
    setTimeout(() => {
        eventFeed.classList.remove('show');
        eventFeed.style.display = "none";
    }, 30000);
}

// -- Save/Load session
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







// -- MAIN CUSTOM EVENTS: CHAT, TTS, ETC --
client.on('General.Custom', ({ event, data }) => {
    if (data?.widget === "tts-catcher") {
        chatBuffer.push({
            time: data.time,
            user: data.user,
            message: data.message,
            eligible: data.isEligible
        });
        if (chatBuffer.length > maxChat) chatBuffer.shift();
        // -------- AJOUT DU PLOT SUR LE GRAPH -----------
        eventsBuffer.push({
            type: 'chat',
            time: data.time,
            user: data.user,
            message: data.message
        });
        if (eventsBuffer.length > 1000) eventsBuffer.shift();
        renderChat();
    }
    else if (data?.widget === "tts-reader-selection") {
        setTtsHeader(data.selectedUser, data.message, data.time);
// Bordure animée TTS
    ttsPanel.classList.remove('twitch-tts-glow', 'fade'); // reset au cas où
    void ttsPanel.offsetWidth; // force reflow (pour relancer l’animation si déjà active)
    ttsPanel.classList.add('twitch-tts-glow');
    setTimeout(() => {
        ttsPanel.classList.add('fade');
    }, 10); // commence à estomper immédiatement
    setTimeout(() => {
        ttsPanel.classList.remove('twitch-tts-glow', 'fade');
    }, 3010); // retire tout après 3s
        chatBuffer.push({
            time: data.time,
            user: data.selectedUser,
            message: data.message,
            eligible: true,
            isTTS: true
        });
        if (chatBuffer.length > maxChat) chatBuffer.shift();
        renderChat();
 console.log("TTS event ajouté au graph", data.time, data.selectedUser);
        eventsBuffer.push({ type: 'tts', time: data.time, user: data.selectedUser, message: data.message });
        if (eventsBuffer.length > 1000) eventsBuffer.shift();
    }
    else if (data?.widget === "tts-reader-tick") {
        eventsBuffer.push({ type: 'tick', time: data.time });
        if (eventsBuffer.length > 1000) eventsBuffer.shift();
    }
});

setTimelineWindow("scale", 60);
resizeOscillo();
renderChat();
// --- Refresh viewers count every 10 seconds ---
async function refreshViewers() {
    try {
        const resp = await client.getActiveViewers();
        if (resp && resp.viewers) {
            viewerCountSpan.textContent = "👀 " + resp.viewers.length;
            viewerCountSpan.title = resp.viewers.map(v => v.display).join(', ');
        } else {
            viewerCountSpan.textContent = "";
        }
    } catch (e) {
        viewerCountSpan.textContent = "";
    }
}
setInterval(refreshViewers, 10000);
}
