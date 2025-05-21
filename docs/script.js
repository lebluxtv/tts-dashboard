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
let timelineMode = "scale"; // "scale" | "adapt"
let lastScaleSeconds = 60;

// --- UI Selectors ---
const chatDiv = document.getElementById('chat-log');
const statusDot = document.getElementById('status-dot');
const timelineBtns = document.querySelectorAll('.timeline-controls button');

// --- OSCILLOSCOPE (Smoothie Charts) ---
const oscillo = document.getElementById('oscilloscope');
const smoothie = new SmoothieChart({
    millisPerPixel: 60,    // 1min par 1000px par défaut (modifiable)
    grid: { strokeStyle: '#233', fillStyle: '#16181c', lineWidth: 1, millisPerLine: 1000, verticalSections: 6 },
    labels: { fillStyle: '#ececec', fontSize: 14, precision: 0 },
    timestampFormatter: SmoothieChart.timeFormatter
});
const messagesLine = new TimeSeries();
const usersLine = new TimeSeries();

smoothie.addTimeSeries(messagesLine, { strokeStyle: 'rgba(69,255,229,0.95)', lineWidth: 3 });
smoothie.addTimeSeries(usersLine, { strokeStyle: 'rgba(93,170,255,0.9)', lineWidth: 2, lineDash: [6,4] });
smoothie.streamTo(oscillo, 0);

// --- Marqueurs events sur la timeline (Ticks/TTS) ---
smoothie.options.onDraw = function (chart) {
    let now = Date.now();
    let millisPerPixel = chart.options.millisPerPixel || 60;
    let windowMillis = chart.options.duration || (chart.chartWidth * millisPerPixel);

    eventsBuffer.forEach(ev => {
        let t = new Date(ev.time).getTime();
        let x = chart.chartWidth - ((now - t) / millisPerPixel);
        if (x < 0 || x > chart.chartWidth) return;
        let color = ev.type === 'tts' ? '#ffef61' : '#5daaff';
        chart.chart.ctx.save();
        chart.chart.ctx.strokeStyle = color;
        chart.chart.ctx.lineWidth = 3;
        // Ligne verticale
        chart.chart.ctx.beginPath();
        chart.chart.ctx.moveTo(x, 5);
        chart.chart.ctx.lineTo(x, chart.chartHeight - 5);
        chart.chart.ctx.stroke();
        // Icône
        chart.chart.ctx.beginPath();
        if (ev.type === 'tts') {
            chart.chart.ctx.arc(x, chart.chartHeight - 18, 7, 0, 2 * Math.PI);
        } else {
            chart.chart.ctx.rect(x - 6, chart.chartHeight - 25, 12, 12);
        }
        chart.chart.ctx.fillStyle = color;
        chart.chart.ctx.fill();
        chart.chart.ctx.restore();
    });
};

// Affiche la valeur en live
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
}, 400);

// --- Affichage chat “dernier en haut” + auto-scroll top ---
function renderChat() {
    const isAtTop = chatDiv.scrollTop < 20;
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

// --- Contrôle timeline (zoom, adaptatif) ---
function setTimelineWindow(mode, seconds = 60) {
    timelineMode = mode;
    timelineBtns.forEach(btn => btn.classList.remove('active'));
    if (mode === "scale") {
        let btn = Array
