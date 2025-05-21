// --- Websocket Streamer.bot config ---
const client = new StreamerbotClient({
    host: '127.0.0.1',
    port: 8080,
    endpoint: '/',
    password: 'streamer.bot'
});

// --- Data buffers ---
let chatBuffer = [];
let maxChat = 2000;
let eventsBuffer = [];
let timelineMode = "scale";
let lastScaleSeconds = 60;

// --- UI Selectors ---
const chatDiv = document.getElementById('chat-log');
const statusDot = document.getElementById('status-dot');
const timelineBtns = document.querySelectorAll('.timeline-controls button');

// --- OSCILLOSCOPE (Smoothie Charts) ---
const oscillo = document.getElementById('oscilloscope');
function resizeOscillo() {
    oscillo.width = oscillo.parentElement.offsetWidth;
    oscillo.height = oscillo.parentElement.offsetHeight || 300;
}
window.addEventListener('resize', resizeOscillo);
resizeOscillo();

const smoothie = new SmoothieChart({
    millisPerPixel: 50,
    grid: { strokeStyle: '#233', fillStyle: '#16181c', lineWidth: 1, millisPerLine: 1000, verticalSections: 6 },
    labels: { fillStyle: '#ececec', fontSize: 14, precision: 0 },
    timestampFormatter: SmoothieChart.timeFormatter
});
const messagesLine = new TimeSeries();
const usersLine = new TimeSeries();

function getLineWidth() {
    // thinner lines on big time windows
    if (timelineMode === "scale") {
        if (lastScaleSeconds > 600) return 1.3;
        if (lastScaleSeconds > 120) return 1.7;
        return 3;
    } else {
        return 2;
    }
}

function updateSeriesStyles() {
    smoothie.removeTimeSeries(messagesLine);
    smoothie.removeTimeSeries(usersLine);
    smoothie.addTimeSeries(messagesLine, {
        strokeStyle: 'rgba(69,255,229,0.95)',
        lineWidth: getLineWidth()
    });
    smoothie.addTimeSeries(usersLine, {
        strokeStyle: 'rgba(93,170,255,0.9)',
        lineWidth: Math.max(1, getLineWidth()-0.7),
        lineDash: [6, 4]
    });
}
updateSeriesStyles();
smoothie.streamTo(oscillo, 0);

// Marqueurs event sur la timeline (TTS/tick et Twitch events)
smoothie.options.onDraw = function (chart) {
    let now = Date.now();
    let millisPerPixel = chart.options.millisPerPixel || 60;
    eventsBuffer.forEach(ev => {
        let t = new Date(ev.time).getTime();
        let x = chart.chartWidth - ((now - t) / millisPerPixel);
        if (x < 0 || x > chart.chartWidth) return;
        let color = '#ffe47d';
        let icon = '';
        switch (ev.type) {
            case 'tts': color = '#ffe47d'; icon = '🗣'; break;
            case 'tick': color = '#60d6ff'; icon = '⏱'; break;
            case 'sub': color = '#ffba40'; icon = '🌟'; break;
            case 'giftsub': color = '#40a1ff'; icon = '🎁'; break;
            case 'giftbomb': color = '#a040ff'; icon = '💣'; break;
            case 'cheer': color = '#ff40a1'; icon = '💎'; break;
            case 'follow': color = '#47ff77'; icon = '➕'; break;
            default: color = '#b5b6ff';
        }
        chart.chart.ctx.save();
        chart.chart.ctx.strokeStyle = color;
        chart.chart.ctx.lineWidth = 3;
        // Ligne verticale
        chart.chart.ctx.beginPath();
        chart.chart.ctx.moveTo(x, 7);
        chart.chart.ctx.lineTo(x, chart.chartHeight - 8);
        chart.chart.ctx.stroke();
        // Icone au dessus
        chart.chart.ctx.font = "bold 19px sans-serif";
        chart.chart.ctx.textAlign = "center";
        chart.chart.ctx.globalAlpha = 0.86;
        chart.chart.ctx.fillStyle = color;
        chart.chart.ctx.fillText(icon, x, 22);
        chart.chart.ctx.globalAlpha = 1;
        chart.chart.ctx.restore();
    });
};

function updateOscLabels(msg, usr) {
    document.querySelector('.osc-msg').textContent = msg;
    document.querySelector('.osc-users').textContent = usr;
}

// --- Alimentation de l'oscilloscope en direct ---
setInterval(() => {
    let now = Date.now();
    let messagesLastSec = chatBuffer.filter(m =>
        new Date(m.time).getTime() > (now - 1000)
    );
    let uniqueUsers = new Set(messagesLastSec.map(m => m.user)).size;
    messagesLine.append(now, messagesLastSec.length);
    usersLine.append(now, uniqueUsers);
    updateOscLabels(messagesLastSec.length, uniqueUsers);
}, 350);

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

// --- TTS PANEL HEADER ---
let ttsTimeout = null;
function setTtsHeader(user, message, time) {
    document.getElementById('tts-header').textContent = `[TTS] ${user} : ${message}`;
    // Bar full, se vide en 180s
    const bar = document.createElement('div');
    bar.className = 'bar';
    document.getElementById('tts-progress').innerHTML = '';
    document.getElementById('tts-progress').appendChild(bar);
    bar.style.width = '100%';
    let duration = 180;
    let t0 = Date.now();
    function animateBar() {
        let elapsed = (Date.now() - t0) / 1000;
        let perc = Math.max(0, 1 - elapsed / duration);
        bar.style.width = (perc * 100) + '%';
        if (perc > 0) requestAnimationFrame(animateBar);
    }
    animateBar();
    clearTimeout(ttsTimeout);
    ttsTimeout = setTimeout(() => {
        document.getElementById('tts-header').textContent = 'Aucun TTS';
        bar.style.width = '0%';
    }, 180 * 1000);
}

// --- Event Feed ---
let eventFeedTimeout = null;
function showEventFeed(html) {
    const feed = document.getElementById('event-feed');
    feed.innerHTML = html;
    feed.classList.add('active');
    feed.style.display = 'block';
    clearTimeout(eventFeedTimeout);
    eventFeedTimeout = setTimeout(() => {
        feed.classList.remove('active');
        setTimeout(() => { feed.style.display = 'none'; }, 350);
    }, 30000); // 30 sec
}

// --- Timeline window (scale/adapt) ---
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
    updateSeriesStyles();
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
    updateSeriesStyles();
}
setInterval(adaptTimeline, 1200);

// --- Save/Load session ---
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

// --- WebSocket/Streamer.bot events ---
client.on('connected', () => {
    statusDot.classList.remove('offline');
    statusDot.classList.add('online');
    updateViewers();
});
client.on('disconnected', () => {
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
    document.getElementById('viewer-count').textContent = '';
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
        eventsBuffer.push({ type: 'tts', time: data.time, user: data.selectedUser, message: data.message });
        if (eventsBuffer.length > 1000) eventsBuffer.shift();
    }
    else if (data?.widget === "tts-reader-tick") {
        eventsBuffer.push({ type: 'tick', time: data.time });
        if (eventsBuffer.length > 1000) eventsBuffer.shift();
    }
});

// --- Twitch events (Sub, Gift, Cheer, Follow) ---
client.on('Twitch.Sub', ({ data }) => {
    eventsBuffer.push({ type: 'sub', time: Date.now(), user: data.displayName });
    showEventFeed(`<span class="event-icon event-type-sub">🌟</span> <span class="event-user">${data.displayName}</span> s’est abonné(e) !`);
});
client.on('Twitch.GiftSub', ({ data }) => {
    eventsBuffer.push({ type: 'giftsub', time: Date.now(), user: data.recipientDisplayName });
    showEventFeed(`<span class="event-icon event-type-gift">🎁</span> <span class="event-user">${data.recipientDisplayName}</span> a reçu un sub cadeau !`);
});
client.on('Twitch.GiftBomb', ({ data }) => {
    eventsBuffer.push({ type: 'giftbomb', time: Date.now(), user: data.displayName, gifts: data.gifts });
    showEventFeed(`<span class="event-icon event-type-bomb">💣</span> <span class="event-user">${data.displayName ?? "Anonyme"}</span> a offert <span class="event-amount">${data.gifts}</span> subs !`);
});
client.on('Twitch.Follow', ({ data }) => {
    eventsBuffer.push({ type: 'follow', time: Date.now(), user: data.displayName });
    showEventFeed(`<span class="event-icon event-type-follow">➕</span> <span class="event-user">${data.displayName}</span> vient de follow !`);
});
client.on('Twitch.Cheer', ({ data }) => {
    eventsBuffer.push({ type: 'cheer', time: Date.now(), user: data.message.displayName, bits: data.message.bits });
    showEventFeed(`<span class="event-icon event-type-cheer">💎</span> <span class="event-user">${data.message.displayName}</span> a envoyé <span class="event-amount">${data.message.bits}</span> bits !`);
});

// --- Viewers actifs ---
async function updateViewers() {
    try {
        const response = await client.getActiveViewers();
        document.getElementById('viewer-count').textContent = `👁 ${response.count}`;
    } catch (e) { }
}
setInterval(updateViewers, 15000);

// --- INIT ---
setTimelineWindow("scale", 60);
renderChat();
