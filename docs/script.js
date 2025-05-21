// --- Websocket Streamer.bot config ---
const client = new StreamerbotClient({
    host: '127.0.0.1',
    port: 8080,
    endpoint: '/',
    password: 'streamer.bot'
});

// --- Data buffers ---
let chatBuffer = []; // [{time, user, message, ...}]
let maxChat = 2000;

// --- UI Selectors ---
const chatDiv = document.getElementById('chat-log');
const statusDot = document.getElementById('status-dot');

// --- OSCILLOSCOPE (Smoothie Charts) ---
const oscillo = document.getElementById('oscilloscope');
const smoothie = new SmoothieChart({
    millisPerPixel: 40,    // vitesse défilement (plus petit = plus rapide)
    grid: { strokeStyle: '#233', fillStyle: '#16181c', lineWidth: 1, millisPerLine: 1000, verticalSections: 6 },
    labels: { fillStyle: '#ececec', fontSize: 14, precision: 0 },
    timestampFormatter: SmoothieChart.timeFormatter
});
const messagesLine = new TimeSeries();
const usersLine = new TimeSeries();

// Ajoute les courbes
smoothie.addTimeSeries(messagesLine, { strokeStyle: 'rgba(69,255,229,0.95)', lineWidth: 3 });
smoothie.addTimeSeries(usersLine, { strokeStyle: 'rgba(93,170,255,0.9)', lineWidth: 2, lineDash: [6,4] });
smoothie.streamTo(oscillo, 0);

// Affiche la valeur en live
function updateOscLabels(msg, usr) {
    document.querySelector('.osc-msg').textContent = msg;
    document.querySelector('.osc-users').textContent = usr;
}

// --- Alimentation de l'oscilloscope en direct ---
setInterval(() => {
    let now = Date.now();
    // Messages de la dernière seconde
    let messagesLastSec = chatBuffer.filter(m =>
        new Date(m.time).getTime() > (now - 1000)
    );
    let uniqueUsers = new Set(messagesLastSec.map(m => m.user)).size;

    messagesLine.append(now, messagesLastSec.length);
    usersLine.append(now, uniqueUsers);
    updateOscLabels(messagesLastSec.length, uniqueUsers);
}, 400);

// --- Affichage chat minimal avec auto-scroll intelligent ---
function renderChat() {
    const isAtBottom =
        chatDiv.scrollHeight - chatDiv.clientHeight - chatDiv.scrollTop < 50;
    chatDiv.innerHTML = chatBuffer.slice(-100).map(msg => {
        if (msg.isTTS) {
            return `<div class="chat-msg chat-tts">[TTS] <span class="chat-usr">${msg.user}</span> : ${msg.message}</div>`;
        }
        return `<div class="chat-msg">
            <span class="chat-usr">${msg.user}</span>
            : ${msg.message} ${msg.eligible ? "" : "<span style='opacity:0.5'>(non éligible)</span>"}
        </div>`;
    }).join('');
    if (isAtBottom) chatDiv.scrollTop = chatDiv.scrollHeight;
}

// --- Websocket Events ---
client.on('connected', () => {
    statusDot.classList.remove('offline');
    statusDot.classList.add('online');
});

client.on('disconnected', () => {
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
});

client.on('General.Custom', ({ event, data }) => {
    // Message Catcher (Chat entry)
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
    // TTS Selection
    else if (data?.widget === "tts-reader-selection") {
        chatBuffer.push({
            time: data.time,
            user: data.selectedUser,
            message: data.message,
            eligible: true,
            isTTS: true
        });
        if (chatBuffer.length > maxChat) chatBuffer.shift();
        renderChat();
    }
});
