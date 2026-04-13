// ── HIVEMIND SERVER URL — only thing hardcoded ──
const HIVEMIND_URL = 'https://riptag-hivemind-production.up.railway.app';

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
  document.getElementById('queueProgress').style.display = 'block';
  timerInterval = setInterval(async () => {
    const data = await chrome.storage.local.get(['running', 'sessionEndTime', 'currentStoreIndex', 'storeQueue']);
    if (!data.running) { stopTimerPolling(); return; }
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

// ── HIVEMIND: Load PC list into dropdown ──
async function loadPCList() {
  try {
    const res = await fetch(`${HIVEMIND_URL}/api/pcs-list`);
    const list = await res.json();
    const pcSelect = document.getElementById('pcSelect');
    pcSelect.innerHTML = '<option value="">Select PC...</option>';
    list.forEach(pc => {
      const opt = document.createElement('option');
      opt.value = pc.id;
      opt.textContent = pc.label;
      opt.dataset.groups = pc.groupCount;
      pcSelect.appendChild(opt);
    });

    // Restore saved selection
    const saved = await chrome.storage.local.get(['hivemindPC', 'hivemindGroup']);
    if (saved.hivemindPC) {
      pcSelect.value = saved.hivemindPC;
      updateGroupDropdown(saved.hivemindPC, parseInt(saved.hivemindGroup || 0));
    }
  } catch(e) {
    document.getElementById('hmStatus').textContent = 'Cannot reach Hivemind server';
  }
}

function updateGroupDropdown(pcId, selectedGroup) {
  const pcSelect = document.getElementById('pcSelect');
  const opt = Array.from(pcSelect.options).find(o => o.value === pcId);
  const groupCount = opt ? parseInt(opt.dataset.groups || 1) : 1;
  const groupSelect = document.getElementById('groupSelect');
  groupSelect.innerHTML = '';
  for (let i = 0; i < groupCount; i++) {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `Group ${i + 1}`;
    groupSelect.appendChild(o);
  }
  if (selectedGroup !== undefined) groupSelect.value = selectedGroup;
}

document.getElementById('pcSelect').onchange = function() {
  updateGroupDropdown(this.value);
};

// ── HIVEMIND: Connect button — fetch queue + save selection ──
document.getElementById('connectBtn').onclick = async () => {
  const pcId = document.getElementById('pcSelect').value;
  const groupIndex = document.getElementById('groupSelect').value;
  if (!pcId) { document.getElementById('hmStatus').textContent = 'Select a PC first'; return; }

  document.getElementById('hmStatus').textContent = 'Connecting...';
  document.getElementById('hmStatus').className = '';

  try {
    const res = await fetch(`${HIVEMIND_URL}/api/queue/${pcId}/${groupIndex}`);
    const data = await res.json();

    if (data.queue && data.queue.length > 0) {
      document.getElementById('storeQueue').value = data.queue.join('\n');
    }

    // Save selection for next popup open
    await chrome.storage.local.set({ hivemindPC: pcId, hivemindGroup: groupIndex });

    document.getElementById('hmStatus').textContent = `✓ Connected — ${data.queue.length} stores loaded`;
    document.getElementById('hmStatus').className = 'connected';
  } catch(e) {
    document.getElementById('hmStatus').textContent = 'Failed to connect';
  }
};

// ── HIVEMIND: Report status back ──
async function reportStatus(running, currentStore) {
  const saved = await chrome.storage.local.get(['hivemindPC', 'hivemindGroup']);
  if (!saved.hivemindPC) return;
  try {
    await fetch(`${HIVEMIND_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pcId: saved.hivemindPC,
        groupIndex: saved.hivemindGroup || 0,
        running,
        currentStore
      })
    });
  } catch(e) {}
}

// ── HIVEMIND: Poll for remote start ──
let remoteStartFired = false;
let hivemindPollInterval = null;

async function pollForStart() {
  const saved = await chrome.storage.local.get(['hivemindPC', 'hivemindGroup']);
  if (!saved.hivemindPC) return;
  try {
    const res = await fetch(`${HIVEMIND_URL}/api/queue/${saved.hivemindPC}/${saved.hivemindGroup || 0}`);
    const data = await res.json();
    if (data.started && !remoteStartFired) {
      const local = await chrome.storage.local.get(['running']);
      if (!local.running) {
        remoteStartFired = true;
        document.getElementById('start').click();
      }
    }
    if (!data.started) remoteStartFired = false;
  } catch(e) {}
}

// ── START BUTTON (UNCHANGED logic) ──
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
    running: true, currentIndex: 0, currentStoreIndex: 0,
    storeQueue, sessionMinutes,
    maxDays: parseInt(days), maxPosts: parseInt(limit),
    minDelay: h.minDelay, maxDelay: h.maxDelay,
    hesitationChance: h.hesitationChance, hesitationDuration: h.hesitationDuration
  });

  chrome.runtime.sendMessage({ action: "START_QUEUE" });
  startTimerPolling();
  reportStatus(true, storeQueue[0]);
};

// ── STOP BUTTON (UNCHANGED logic) ──
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

// ── Init ──
(async () => {
  await loadPCList();

  const data = await chrome.storage.local.get(['running']);
  if (data.running) {
    document.getElementById('status').innerText = "Status: Running...";
    startTimerPolling();
    reportStatus(true, null);
  }

  hivemindPollInterval = setInterval(pollForStart, 3000);
})();
