const HIVEMIND_URL = 'https://riptag-hivemind-production.up.railway.app';

// ── Setup: load PC list ──
async function loadPCList() {
  try {
    const res = await fetch(`${HIVEMIND_URL}/api/pcs-list`);
    const list = await res.json();
    const sel = document.getElementById('pcSelect');
    sel.innerHTML = '<option value="">Select PC...</option>';
    list.forEach(pc => {
      const o = document.createElement('option');
      o.value = pc.id; o.textContent = pc.label; o.dataset.groups = pc.groupCount;
      sel.appendChild(o);
    });
  } catch(e) {
    document.getElementById('pcSelect').innerHTML = '<option>Cannot reach server</option>';
  }
}

document.getElementById('pcSelect').onchange = function() {
  const opt = this.options[this.selectedIndex];
  const groupCount = opt ? parseInt(opt.dataset.groups || 1) : 1;
  const sel = document.getElementById('groupSelect');
  sel.innerHTML = '';
  for (let i = 0; i < groupCount; i++) {
    const o = document.createElement('option');
    o.value = i; o.textContent = `Group ${i + 1}`;
    sel.appendChild(o);
  }
};

document.getElementById('saveSetup').onclick = async () => {
  const pcId = document.getElementById('pcSelect').value;
  const groupIndex = document.getElementById('groupSelect').value;
  if (!pcId) return;
  await chrome.storage.local.set({ hivemindPC: pcId, hivemindGroup: groupIndex });
  showStatus(pcId, groupIndex);
};

document.getElementById('resetLink').onclick = (e) => {
  e.preventDefault();
  chrome.storage.local.remove(['hivemindPC', 'hivemindGroup']);
  document.getElementById('setupSection').style.display = 'block';
  document.getElementById('statusSection').style.display = 'none';
};

document.getElementById('localStop').onclick = () => {
  chrome.storage.local.set({ running: false });
  chrome.runtime.sendMessage({ action: 'STOP_QUEUE' });
  updateRunningUI(false);
};

function showStatus(pcId, groupIndex) {
  document.getElementById('setupSection').style.display = 'none';
  document.getElementById('statusSection').style.display = 'block';
  document.getElementById('identityLabel').textContent = `${pcId.toUpperCase()} / Group ${parseInt(groupIndex) + 1}`;
}

function setConn(state, label) {
  document.getElementById('connDot').className = 'dot ' + state;
  document.getElementById('connLabel').innerHTML = label;
}

function updateRunningUI(running) {
  document.getElementById('localStop').style.display = running ? 'block' : 'none';
  document.getElementById('timerDisplay').style.display = running ? 'block' : 'none';
  if (!running) {
    document.getElementById('storeDisplay').textContent = 'Not running';
    document.getElementById('storeDisplay').className = 'store-name';
    document.getElementById('storeProgress').textContent = '';
  }
}

// ── Poll storage for display updates ──
let timerInterval = null;

function startPolling() {
  timerInterval = setInterval(async () => {
    const data = await chrome.storage.local.get(['running', 'sessionEndTime', 'currentStoreIndex', 'storeQueue', 'currentIndex', 'hivemindPC']);

    if (!data.hivemindPC) return;

    const running = data.running;
    setConn(running ? 'running' : 'synced', running ? '<b>Running</b>' : 'Synced');
    updateRunningUI(running);

    const queue = data.storeQueue || [];
    document.getElementById('queueCount').textContent = queue.length || '—';

    if (running) {
      const idx = data.currentStoreIndex || 0;
      document.getElementById('storeProgress').textContent = `Store ${idx + 1} of ${queue.length}`;

      if (queue[idx]) {
        try {
          const name = new URL(queue[idx]).pathname.replace(/\/$/, '').split('/').pop();
          document.getElementById('storeDisplay').textContent = '▶ ' + name;
          document.getElementById('storeDisplay').className = 'store-name active';
        } catch { document.getElementById('storeDisplay').textContent = queue[idx]; }
      }

      if (data.sessionEndTime) {
        const r = Math.max(0, data.sessionEndTime - Date.now());
        const m = Math.floor(r / 60000);
        const s = Math.floor((r % 60000) / 1000);
        document.getElementById('timerDisplay').textContent = `${m}:${String(s).padStart(2, '0')}`;
      }
    }
  }, 1000);
}

// ── Init ──
(async () => {
  const saved = await chrome.storage.local.get(['hivemindPC', 'hivemindGroup', 'running', 'storeQueue']);

  if (saved.hivemindPC) {
    showStatus(saved.hivemindPC, saved.hivemindGroup || 0);
    document.getElementById('queueCount').textContent = (saved.storeQueue || []).length || '—';
    if (saved.running) updateRunningUI(true);
    setConn('synced', 'Syncing...');
  } else {
    loadPCList();
  }

  startPolling();
})();
