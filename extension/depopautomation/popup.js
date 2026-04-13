const HIVEMIND_URL = 'https://riptag-hivemind-production.up.railway.app';

// ── Speed presets (UNCHANGED) ──
const PRESETS = {
  stealth:  { minDelay: 3000, maxDelay: 7000, hesitationChance: 40, hesitationDuration: 4000 },
  balanced: { minDelay: 1500, maxDelay: 4000, hesitationChance: 25, hesitationDuration: 3000 },
  fast:     { minDelay: 800,  maxDelay: 2000, hesitationChance: 10, hesitationDuration: 1500 }
};

let lastQueueHash = '';
let remoteStartFired = false;
let isSetup = false;

// ── Apply server settings into chrome.storage so content.js reads them ──
function applySettings(settings) {
  if (!settings) return;
  const preset = settings.speedPreset || 'balanced';
  const vals = preset !== 'custom' ? PRESETS[preset] : settings;
  chrome.storage.local.set({
    maxDays: settings.maxDays || 7,
    maxPosts: settings.maxPosts || 30,
    sessionMinutes: settings.sessionMinutes || 35,
    minDelay: vals.minDelay || 1500,
    maxDelay: vals.maxDelay || 4000,
    hesitationChance: vals.hesitationChance || 25,
    hesitationDuration: vals.hesitationDuration || 3000
  });
}

function hashQueue(queue) { return queue.join('|'); }

// ── Update popup UI ──
function setConnStatus(state, label) {
  const dot = document.getElementById('connDot');
  const lbl = document.getElementById('connLabel');
  dot.className = 'dot ' + state;
  lbl.innerHTML = label;
}

// ── Report status to server ──
async function reportStatus(running, currentStore) {
  const saved = await chrome.storage.local.get(['hivemindPC', 'hivemindGroup']);
  if (!saved.hivemindPC) return;
  try {
    const local = await chrome.storage.local.get(['currentIndex', 'currentStoreIndex', 'storeQueue']);
    await fetch(`${HIVEMIND_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pcId: saved.hivemindPC,
        groupIndex: saved.hivemindGroup || 0,
        running,
        currentStore,
        listingsProcessed: local.currentIndex || 0,
        storeIndex: local.currentStoreIndex || 0,
        totalStores: (local.storeQueue || []).length
      })
    });
  } catch(e) {}
}

// ── Main sync loop — runs every 3 seconds ──
async function syncWithHivemind() {
  const saved = await chrome.storage.local.get(['hivemindPC', 'hivemindGroup', 'running', 'storeQueue', 'currentStoreIndex']);
  if (!saved.hivemindPC) return;

  try {
    const res = await fetch(`${HIVEMIND_URL}/api/queue/${saved.hivemindPC}/${saved.hivemindGroup || 0}`);
    const data = await res.json();

    // ── Sync queue if changed and not running ──
    if (data.queue && data.queue.length > 0) {
      const newHash = hashQueue(data.queue);
      if (newHash !== lastQueueHash && !saved.running) {
        lastQueueHash = newHash;
        await chrome.storage.local.set({ storeQueue: data.queue, currentIndex: 0, currentStoreIndex: 0 });
        document.getElementById('queueCount').textContent = data.queue.length;
      }
    }

    // ── Always apply latest settings ──
    applySettings(data.settings);

    // ── Remote START ──
    if (data.started && !remoteStartFired && !saved.running) {
      remoteStartFired = true;
      await triggerStart(saved.hivemindPC, saved.hivemindGroup);
    }

    // ── Remote STOP ──
    if (!data.started && saved.running) {
      remoteStartFired = false;
      triggerStop();
    }

    if (!data.started) remoteStartFired = false;

    setConnStatus(saved.running ? 'running' : 'synced', saved.running ? '<strong>Running</strong>' : 'Synced');

    // Update queue count display
    const queue = data.queue || [];
    document.getElementById('queueCount').textContent = queue.length;

    // Heartbeat while running
    if (saved.running) {
      const queue = saved.storeQueue || [];
      const idx = saved.currentStoreIndex || 0;
      reportStatus(true, queue[idx] || null);
    }

  } catch(e) {
    setConnStatus('offline', 'Offline');
  }
}

// ── Trigger start — sets storage then tells background ──
async function triggerStart(pcId, groupIndex) {
  const local = await chrome.storage.local.get(['storeQueue', 'sessionMinutes', 'maxDays', 'maxPosts', 'minDelay', 'maxDelay', 'hesitationChance', 'hesitationDuration']);
  const storeQueue = local.storeQueue || [];
  if (!storeQueue.length) return;

  await chrome.storage.local.set({
    running: true,
    currentIndex: 0,
    currentStoreIndex: 0,
    storeQueue,
    sessionMinutes: local.sessionMinutes || 35,
    maxDays: local.maxDays || 7,
    maxPosts: local.maxPosts || 30,
    minDelay: local.minDelay || 1500,
    maxDelay: local.maxDelay || 4000,
    hesitationChance: local.hesitationChance || 25,
    hesitationDuration: local.hesitationDuration || 3000
  });

  chrome.runtime.sendMessage({ action: 'START_QUEUE' });
  reportStatus(true, storeQueue[0]);
  updateRunningUI(true);
}

// ── Trigger stop ──
function triggerStop() {
  chrome.storage.local.set({ running: false });
  chrome.runtime.sendMessage({ action: 'STOP_QUEUE' });
  reportStatus(false, null);
  updateRunningUI(false);
}

function updateRunningUI(running) {
  document.getElementById('localStop').style.display = running ? 'block' : 'none';
  document.getElementById('timerDisplay').style.display = running ? 'block' : 'none';
  const storeEl = document.getElementById('storeDisplay');
  if (!running) {
    storeEl.textContent = 'Not running';
    storeEl.className = 'store-display';
    document.getElementById('storeProgress').textContent = '';
  }
}

// ── Timer polling for display ──
let timerInterval = null;

function startTimerPolling() {
  timerInterval = setInterval(async () => {
    const data = await chrome.storage.local.get(['running', 'sessionEndTime', 'currentStoreIndex', 'storeQueue', 'currentIndex']);
    if (!data.running) { stopTimerPolling(); updateRunningUI(false); return; }

    const queue = data.storeQueue || [];
    const idx = data.currentStoreIndex || 0;
    document.getElementById('storeProgress').textContent = `Store ${idx + 1} of ${queue.length}`;

    const storeEl = document.getElementById('storeDisplay');
    if (queue[idx]) {
      try {
        const name = new URL(queue[idx]).pathname.replace(/\/$/, '').split('/').pop();
        storeEl.textContent = '▶ ' + name;
        storeEl.className = 'store-display active';
      } catch { storeEl.textContent = queue[idx]; }
    }

    if (data.sessionEndTime) {
      const remaining = Math.max(0, data.sessionEndTime - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      document.getElementById('timerDisplay').style.display = 'block';
      document.getElementById('timerDisplay').textContent = `${mins}:${String(secs).padStart(2, '0')}`;
    }
  }, 1000);
}

function stopTimerPolling() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

// ── Local stop button ──
document.getElementById('localStop').onclick = () => triggerStop();

// ── Messages from background (UNCHANGED) ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'QUEUE_COMPLETE' || msg.action === 'TASK_COMPLETE') {
    updateRunningUI(false);
    stopTimerPolling();
    reportStatus(false, null);
  }
});

// ── Setup: load PC list ──
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
  } catch(e) {
    document.getElementById('pcSelect').innerHTML = '<option>Cannot reach server</option>';
  }
}

document.getElementById('pcSelect').onchange = function() {
  const opt = this.options[this.selectedIndex];
  const groupCount = opt ? parseInt(opt.dataset.groups || 1) : 1;
  const groupSelect = document.getElementById('groupSelect');
  groupSelect.innerHTML = '';
  for (let i = 0; i < groupCount; i++) {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = `Group ${i + 1}`;
    groupSelect.appendChild(o);
  }
};

document.getElementById('saveSetup').onclick = async () => {
  const pcId = document.getElementById('pcSelect').value;
  const groupIndex = document.getElementById('groupSelect').value;
  if (!pcId) return;
  await chrome.storage.local.set({ hivemindPC: pcId, hivemindGroup: groupIndex });
  showStatusSection(pcId, groupIndex);
  syncWithHivemind();
};

document.getElementById('resetLink').onclick = (e) => {
  e.preventDefault();
  chrome.storage.local.remove(['hivemindPC', 'hivemindGroup']);
  document.getElementById('setupSection').style.display = 'block';
  document.getElementById('statusSection').style.display = 'none';
};

function showStatusSection(pcId, groupIndex) {
  document.getElementById('setupSection').style.display = 'none';
  document.getElementById('statusSection').style.display = 'block';
  document.getElementById('identityLabel').textContent = `${pcId.toUpperCase()} / Group ${parseInt(groupIndex) + 1}`;
}

// ── Init ──
(async () => {
  const saved = await chrome.storage.local.get(['hivemindPC', 'hivemindGroup', 'running']);

  if (saved.hivemindPC) {
    // Already set up — go straight to status
    showStatusSection(saved.hivemindPC, saved.hivemindGroup || 0);
    setConnStatus('synced', 'Syncing...');

    if (saved.running) {
      updateRunningUI(true);
      startTimerPolling();
    }

    syncWithHivemind();
  } else {
    // First time — show setup
    loadPCList();
  }

  // Sync every 3 seconds forever
  setInterval(syncWithHivemind, 3000);
  // Heartbeat status report every 5 seconds
  setInterval(async () => {
    const local = await chrome.storage.local.get(['running', 'storeQueue', 'currentStoreIndex']);
    if (local.running) {
      const queue = local.storeQueue || [];
      reportStatus(true, queue[local.currentStoreIndex || 0] || null);
    }
  }, 5000);
  // Start timer polling if running
  if (saved && saved.running) startTimerPolling();
})();
