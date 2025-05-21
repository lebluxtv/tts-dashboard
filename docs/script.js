// Adapt to your Streamer.bot setup
const client = new StreamerbotClient({
    host: '127.0.0.1',
    port: 8080,
    endpoint: '/',
    password: 'streamer.bot'
});

// --- DATA BUFFERS ---
let chatBuffer = [];      // [{time, user, message, ...}]
let timelineBuffer = [];  // [{type, time, users, messages, tts, tickN, panel, ...}]
let maxHistoryMin = 360;  // Keep up to 6h of data for demo

// --- UI SELECTORS ---
const chatDiv = document.getElementById('chat-log');
const chartCanvas = document.getElementById('timelineChart');
const statusDot = document.getElementById('status-dot');
const rangeBtns = document.querySelectorAll('.range-controls button');

let currentRange = 10; // in minutes (default 10min)

// Timeline chart
let timelineChart = null;

// --- RANGE UI ---
rangeBtns.forEach(btn => {
    btn.addEventListener('click', e => {
        rangeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        let val = btn.dataset.range;
        if (val === 'max') currentRange = maxHistoryMin;
        else if (val.endsWith('m')) currentRange = parseInt(val);
        else if (val.endsWith('h')) currentRange = 60 * parseInt(val);
        updateTimeline();
    });
});

// --- Streamer.bot Websocket Events ---
client.on('connected', () => {
    statusDot.classList.remove('offline');
    statusDot.classList.add('online');
});

client.on('disconnected', () => {
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
});

// CHAT
client.on('General.Custom', ({ event, data }) => {
    const now = Date.now();
    // Message Catcher (Chat entry)
    if (data?.widget === "tts-catcher") {
        chatBuffer.push({
            time: data.time,
            user: data.user,
            message: data.message,
            eligible: data.isEligible
        });
        if (chatBuffer.length > 2000) chatBuffer.shift();
        renderChat();
        timelineBuffer.push({
            type: 'message',
            time: data.time,
            user: data.user
        });
    }
    // Tick
    else if (data?.widget === "tts-reader-tick") {
        timelineBuffer.push({
            type: 'tick',
            time: data.time,
            users: data.users.map(u => u.user),
            messages: data.users.reduce((acc, u) => acc + (u.messages || 0), 0),
            panel: data.candidatesPanel,
            tickInfo: data
        });
        if (timelineBuffer.length > maxHistoryMin*12) timelineBuffer.shift();
        updateTimeline();
    }
    // TTS Selection
    else if (data?.widget === "tts-reader-selection") {
        timelineBuffer.push({
            type: 'tts',
            time: data.time,
            user: data.selectedUser,
            message: data.message,
            panel: data.candidatesPanel,
            ttsInfo: data
        });
        updateTimeline();
        chatBuffer.push({
            time: data.time,
            user: data.selectedUser,
            message: data.message,
            eligible: true,
            isTTS: true
        });
        renderChat();
    }
});

// --- CHAT LOG RENDER ---
function renderChat() {
    chatDiv.innerHTML = chatBuffer.slice(-100).map(msg => {
        if (msg.isTTS) {
            return `<div class="chat-msg chat-tts">[TTS] <span class="chat-usr">${msg.user}</span> : ${msg.message}</div>`;
        }
        return `<div class="chat-msg">
            <span class="chat-usr">${msg.user}</span>
            : ${msg.message} ${msg.eligible ? "" : "<span style='opacity:0.5'>(non éligible)</span>"}
        </div>`;
    }).join('');
    chatDiv.scrollTop = chatDiv.scrollHeight;
}

// --- TIMELINE HISTOGRAMME + EVENTS ---
function updateTimeline() {
    // Calcul plage à afficher (currentRange en minutes)
    let now = Date.now();
    let fromTime = now - (currentRange*60*1000);
    // On découpe en sections : 10s/barre si <5min, 30s si <30min, 1min sinon
    let barSize = 60000; // 1 min par défaut
    if (currentRange <= 1) barSize = 10000;
    else if (currentRange <= 5) barSize = 10000;
    else if (currentRange <= 30) barSize = 30000;

    // Timeline data pour histogramme
    let bins = [];
    let labelFmt = barSize === 10000 ? 'HH:mm:ss' : 'HH:mm';
    let barCount = Math.ceil((currentRange*60*1000)/barSize);

    for (let i = 0; i < barCount; i++) {
        let binStart = new Date(now - (barCount - i) * barSize);
        let binEnd = new Date(binStart.getTime() + barSize);
        bins.push({
            start: binStart,
            end: binEnd,
            count: 0,
            users: new Set(),
            tts: false,
            ticks: [],
            events: []
        });
    }

    // Place les events/messages dans les bonnes bins
    timelineBuffer.forEach(ev => {
        let t = new Date(ev.time).getTime();
        let idx = Math.floor((t - (now - barCount*barSize)) / barSize);
        if (idx < 0 || idx >= bins.length) return;
        if (ev.type === "message") {
            bins[idx].count++;
            bins[idx].users.add(ev.user);
        }
        if (ev.type === "tts") {
            bins[idx].tts = true;
            bins[idx].events.push({type: "tts", ...ev});
        }
        if (ev.type === "tick") {
            bins[idx].ticks.push(ev);
            bins[idx].events.push({type: "tick", ...ev});
        }
    });

    // Génère labels et data pour Chart.js
    let labels = bins.map(b => {
        let h = b.start.getHours().toString().padStart(2,'0');
        let m = b.start.getMinutes().toString().padStart(2,'0');
        let s = b.start.getSeconds().toString().padStart(2,'0');
        return (barSize === 10000 ? `${h}:${m}:${s}` : `${h}:${m}`);
    });
    let dataMsgs = bins.map(b => b.count);
    let dataUsers = bins.map(b => b.users.size);

    // Chart.js - destroy/redraw si besoin
    if (timelineChart) timelineChart.destroy();

    timelineChart = new Chart(chartCanvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: "Messages",
                    data: dataMsgs,
                    backgroundColor: '#45ffe577'
                },
                {
                    label: "Utilisateurs",
                    data: dataUsers,
                    backgroundColor: '#5daaff99'
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {display: true},
                tooltip: {
                    callbacks: {
                        title: (items) => `De ${labels[items[0].dataIndex]}`,
                        label: (item) => {
                            const b = bins[item.dataIndex];
                            return [
                                `Messages : ${b.count}`,
                                `Utilisateurs : ${b.users.size}`,
                                ...(b.events.length
                                    ? b.events.map(ev =>
                                        (ev.type === 'tts' ? `🔊 TTS: ${ev.user}` : `⚡ Tick`)).slice(0,4)
                                    : [])
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: false,
                    ticks: { color: "#ececec" }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: "#ececec" }
                }
            }
        }
    });
}

// --- INITIALISATION ---
renderChat();
updateTimeline();
setInterval(updateTimeline, 4000);
