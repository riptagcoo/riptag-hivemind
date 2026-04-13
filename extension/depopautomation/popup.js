// ── HIVEMIND CONFIG (set once per account) ──
// Change these two values when loading the extension on each Chrome profile
const HIVEMIND_URL = 'https://your-railway-url.railway.app'; // ← update after deploying
const PC_ID        = 'pc1';   // ← pc1, pc2, pc3, pc4, pc5, pc6
const GROUP_INDEX  = '0';     // ← 0, 1, or 2 (which group of 3 accounts this is)

// ── Speed preset definitions (UNCHANGED) ──
const PRESETS = {
  stealth:  { minDelay: 3000, maxDelay: 7000, hesitationChance: 40, hesitationDuration: 4000 },
  balanced: { minDelay: 1500, maxDelay: 4000, hesitationChance: 25, hesitationDuration: 3000 },
  fast:     { minDelay: 800,  maxDelay: 2000, hesitationChance: 10, hesitationDuration: 1500 }
};

const BASE_STEPS_TOTAL = 2500 + 7500 + 1200 + 2000 + 2500 + 3500 + 2000 + 1200 + 3000 + 5000;

function getHumanizeValues() {
  const preset = document.getElementById('speedPreset').value;
  if (preset !== 'custom') return PRESETS[preset];
  return {
    minDelay: parseFloat(document.getElementById('minDelay').value) * 1000,
    maxDelay: parseFloat(document.getElementById('maxDelay').value) * 1000,
    hesitationChance: parseInt(document.getElementById('hesitationChance').value),
    hesitationDuration: parseFloat(document.getElementById('hesitationDuration').value) * 1000
  };
}

function updateETA() {
  const posts = parseInt(document.getElementById('maxPosts').value) || 30;
  const h = getHumanizeValues();
  const avgDelay = (h.minDelay + h.maxDelay) / 2;
  const avgHesitation = (h.hesitationChance / 100) * h.hesitationDuration;
  const scaleSum = BASE_STEPS_TOTAL / 2500;
  const perPost = scaleSum * (avgDelay + avgHesitation);
  const totalMs = perPost * posts;
  const totalMin = Math.ceil(totalMs / 60000);
  document.getElementById('eta').innerText = `Est. ~${totalMin} min per store for ${posts} posts`;
}

document.getElementById('speedPreset').onchange = () => {
  const isCustom = document.getElementById('speedPreset').value === 'custom';
  document.getElementById('customSettings').style.display = isCustom ? 'block' : 'none';
  updateETA();
};

['maxPosts', 'minDelay', 'maxDelay', 'hesitationChance', 'hesitationDuration'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.oninput = updateETA;
});

updateETA();

// ── Live Timer Polling (UNCHANGED) ──
let timerInterval = null;

function startTimerPolling() {
  const progressEl = document.getElementById('queueProgress');
  progressEl.style.display = 'block';

  timerInterval = setInterval(async () => {
    const data = await chrome.storage.local.get(['running', 'sessionEndTime', 'currentStoreIndex', 'storeQueue']);
    if (!data.running) {
      stopTimerPolling();
      return;
    }

    const queue = data.storeQueue || [];
    const idx = data.currentStoreIndex || 0;
    document.getElementById('storeLabel').innerText = `Store ${idx + 1}/${queue.length}`;

    if (data.sessionEndTime) {
      const remaining = Math.max(0, data.sessionEndTime - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      document.getElementById('timerDisplay').innerText = `${mins}:${String(secs).padStart(2, '0')} remaining`;
    }
  }, 1000);
}

function stopTimerPolling() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// ── HIVEMIND: Fetch queue from server and pre-fill ──
async function fetchHivemindQueue() {
  try {
    const res = await fetch(`${HIVEMIND_URL}/api/queue/${PC_ID}/${GROUP_INDEX}`);
    const data = await res.json();
    if (data.queue && data.queue.length > 0) {
      document.getElementById('storeQueue').value = data.queue.join('\n');
      document.getElementById('status').innerText = `Status: Queue loaded (${data.queue.length} stores)`;
    }
    return data;
  } catch (e) {
    console.warn('[Hivemind] Could not reach server:', e);
    return null;
  }
}

// ── HIVEMIND: Report status back to server ──
async function reportStatus(running, currentStore) {
  try {
    await fetch(`${HIVEMIND_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pcId: PC_ID, groupIndex: GROUP_INDEX, running, currentStore })
    });
  } catch (e) { /* silent */ }
}

// ── HIVEMIND: Poll for remote start signal ──
let hivemindPollInterval = null;
let remoteStartFired = false;

async function pollForStart() {
  try {
    const res = await fetch(`${HIVEMIND_URL}/api/queue/${PC_ID}/${GROUP_INDEX}`);
    const data = await res.json();

    // If server says started and we haven't fired yet, trigger start
    if (data.started && !remoteStartFired) {
      const localData = await chrome.storage.local.get(['running']);
      if (!localData.running) {
        remoteStartFired = true;
        document.getElementById('start').click();
      }
    }

    // Reset flag if server is stopped
    if (!data.started) {
      remoteStartFired = false;
    }
  } catch (e) { /* silent */ }
}

// ── START BUTTON (UNCHANGED logic, added status reporting) ──
document.getElementById('start').onclick = async () => {
  const days = document.getElementById('timeframe').value;
  const limit = document.getElementById('maxPosts').value;
  const sessionMinutes = parseInt(document.getElementById('sessionMinutes').value) || 10;

  const rawQueue = document.getElementById('storeQueue').value;
  const storeQueue = rawQueue.split('\n').map(u => u.trim()).filter(u => u.length > 0);

  if (storeQueue.length === 0) {
    document.getElementById('status').innerText = "Error: Add at least one store URL";
    return;
  }

  document.getElementById('doneEmblem').style.display = 'none';
  document.getElementById('status').innerText = "Status: Running...";

  const h = getHumanizeValues();

  await chrome.storage.local.set({
    running: true,
    currentIndex: 0,
    currentStoreIndex: 0,
    storeQueue,
    sessionMinutes,
    maxDays: parseInt(days),
    maxPosts: parseInt(limit),
    minDelay: h.minDelay,
    maxDelay: h.maxDelay,
    hesitationChance: h.hesitationChance,
    hesitationDuration: h.hesitationDuration
  });

  chrome.runtime.sendMessage({ action: "START_QUEUE" });
  startTimerPolling();
  reportStatus(true, storeQueue[0]);
};

// ── STOP BUTTON (UNCHANGED logic, added status reporting) ──
document.getElementById('stop').onclick = () => {
  chrome.storage.local.set({ running: false }, () => {
    document.getElementById('status').innerText = "Status: Stopped.";
    stopTimerPolling();
    document.getElementById('queueProgress').style.display = 'none';
  });
  chrome.runtime.sendMessage({ action: "STOP_QUEUE" });
  reportStatus(false, null);
};

// ── Messages from background (UNCHANGED) ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === "QUEUE_COMPLETE") {
    document.getElementById('status').innerText = "Status: All Stores Done!";
    document.getElementById('doneEmblem').style.display = 'block';
    stopTimerPolling();
    document.getElementById('queueProgress').style.display = 'none';
    reportStatus(false, null);
  }
  if (msg.action === "TASK_COMPLETE") {
    document.getElementById('status').innerText = "Status: Finished Threshold";
    document.getElementById('doneEmblem').style.display = 'block';
    stopTimerPolling();
    document.getElementById('queueProgress').style.display = 'none';
    reportStatus(false, null);
  }
});

// ── Init: load queue from hivemind + restore state ──
(async () => {
  // Pull queue from hivemind
  const hivemindData = await fetchHivemindQueue();

  // Restore running state
  const localData = await chrome.storage.local.get(['running']);
  if (localData.running) {
    document.getElementById('status').innerText = "Status: Running...";
    startTimerPolling();
    reportStatus(true, null);
  }

  // Start polling for remote start (every 3 seconds)
  hivemindPollInterval = setInterval(pollForStart, 3000);
})();
