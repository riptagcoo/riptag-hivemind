const HIVEMIND_URL = 'https://riptag-hivemind-production.up.railway.app';

let activeTabId = null;
let onUpdatedListener = null;
let lastQueueHash = '';
let remoteStartFired = false;

// ── Helpers ──
function hashQueue(q) { return q.join('|'); }

function removeOnUpdatedListener() {
  if (onUpdatedListener) {
    chrome.tabs.onUpdated.removeListener(onUpdatedListener);
    onUpdatedListener = null;
  }
}

async function cleanupTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { url: 'about:blank' });
    setTimeout(() => chrome.tabs.discard(tabId).catch(() => {}), 1500);
  } catch(e) {}
}

// ── Report status to hivemind server ──
async function reportStatus(running, currentStore) {
  const saved = await chrome.storage.local.get(['hivemindPC', 'hivemindGroup', 'currentIndex', 'currentStoreIndex', 'storeQueue']);
  if (!saved.hivemindPC) return;
  try {
    await fetch(`${HIVEMIND_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pcId: saved.hivemindPC,
        groupIndex: saved.hivemindGroup || 0,
        running,
        currentStore,
        listingsProcessed: saved.currentIndex || 0,
        storeIndex: saved.currentStoreIndex || 0,
        totalStores: (saved.storeQueue || []).length
      })
    });
  } catch(e) {}
}

// ── Hivemind sync: runs every minute via alarm ──
async function hivemindSync() {
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
      }
    }

    // ── Apply settings ──
    if (data.settings) {
      const PRESETS = {
        stealth:  { minDelay: 3000, maxDelay: 7000, hesitationChance: 40, hesitationDuration: 4000 },
        balanced: { minDelay: 1500, maxDelay: 4000, hesitationChance: 25, hesitationDuration: 3000 },
        fast:     { minDelay: 800,  maxDelay: 2000, hesitationChance: 10, hesitationDuration: 1500 }
      };
      const s = data.settings;
      const preset = s.speedPreset || 'balanced';
      const vals = preset !== 'custom' ? PRESETS[preset] : s;
      await chrome.storage.local.set({
        maxDays: s.maxDays || 7, maxPosts: s.maxPosts || 30,
        sessionMinutes: s.sessionMinutes || 35,
        minDelay: vals.minDelay, maxDelay: vals.maxDelay,
        hesitationChance: vals.hesitationChance, hesitationDuration: vals.hesitationDuration
      });
    }

    // ── Remote START ──
    if (data.started && !remoteStartFired && !saved.running) {
      remoteStartFired = true;
      const local = await chrome.storage.local.get(['storeQueue']);
      const queue = local.storeQueue || [];
      if (queue.length > 0) await triggerStart(queue);
    }

    // ── Remote STOP ──
    if (!data.started && saved.running) {
      remoteStartFired = false;
      await triggerStop();
    }

    if (!data.started) remoteStartFired = false;

    // ── Heartbeat while running ──
    if (saved.running) {
      const queue = saved.storeQueue || [];
      reportStatus(true, queue[saved.currentStoreIndex || 0] || null);
    }

  } catch(e) {
    console.warn('[Hivemind] Sync failed:', e.message);
  }
}

// ── Trigger start from background ──
async function triggerStart(queue) {
  const local = await chrome.storage.local.get(['sessionMinutes','maxDays','maxPosts','minDelay','maxDelay','hesitationChance','hesitationDuration']);

  await chrome.storage.local.set({
    running: true, currentIndex: 0, currentStoreIndex: 0, storeQueue: queue,
    sessionMinutes: local.sessionMinutes || 35,
    maxDays: local.maxDays || 7, maxPosts: local.maxPosts || 30,
    minDelay: local.minDelay || 1500, maxDelay: local.maxDelay || 4000,
    hesitationChance: local.hesitationChance || 25, hesitationDuration: local.hesitationDuration || 3000
  });

  // Get active tab or find a Chrome window
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    activeTabId = tabs[0].id;
    // Close extra Depop tabs
    const depopTabs = await chrome.tabs.query({ url: '*://*.depop.com/*' });
    for (const tab of depopTabs) {
      if (tab.id !== activeTabId) chrome.tabs.remove(tab.id).catch(() => {});
    }
    await startStore(activeTabId);
    reportStatus(true, queue[0]);
  }
}

// ── Trigger stop from background ──
async function triggerStop() {
  chrome.alarms.clear('storeTimer');
  removeOnUpdatedListener();
  await chrome.storage.local.set({ running: false });
  reportStatus(false, null);
  activeTabId = null;
}

// ── Navigate to store and start session ──
async function startStore(tabId) {
  const data = await chrome.storage.local.get(['storeQueue','currentStoreIndex','sessionMinutes','running']);
  if (!data.running) return;

  const queue = data.storeQueue || [];
  const idx = data.currentStoreIndex || 0;

  if (idx >= queue.length) {
    await chrome.storage.local.set({ running: false });
    chrome.runtime.sendMessage({ action: 'QUEUE_COMPLETE' }).catch(() => {});
    chrome.alarms.clear('storeTimer');
    reportStatus(false, null);
    // Notify server queue is complete
    const saved = await chrome.storage.local.get(['hivemindPC','hivemindGroup']);
    if (saved.hivemindPC) {
      fetch(`${HIVEMIND_URL}/api/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcId: saved.hivemindPC, groupIndex: saved.hivemindGroup || 0 })
      }).catch(() => {});
    }
    return;
  }

  const url = queue[idx];
  const sessionMs = (data.sessionMinutes || 10) * 60000;
  const sessionEndTime = Date.now() + sessionMs;

  await chrome.storage.local.set({ currentIndex: 0, sessionEndTime });

  removeOnUpdatedListener();
  await chrome.tabs.update(tabId, { url });

  onUpdatedListener = function(updatedTabId, changeInfo) {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      removeOnUpdatedListener();
      setTimeout(() => {
        chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
          .catch(e => console.error('Inject error:', e));
      }, 2000);
    }
  };
  chrome.tabs.onUpdated.addListener(onUpdatedListener);
  chrome.alarms.create('storeTimer', { periodInMinutes: 5 / 60 });
}

// ── Switch to next store ──
async function switchToNextStore() {
  const data = await chrome.storage.local.get(['currentStoreIndex','storeQueue','running']);
  if (!data.running) return;
  const nextIdx = (data.currentStoreIndex || 0) + 1;
  await chrome.storage.local.set({ currentStoreIndex: nextIdx });
  if (activeTabId) {
    await cleanupTab(activeTabId);
    setTimeout(() => startStore(activeTabId), 2000);
  }
}

// ── Alarm handler ──
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'storeTimer') {
    const data = await chrome.storage.local.get(['running','sessionEndTime']);
    if (!data.running) { chrome.alarms.clear('storeTimer'); return; }
    if (Date.now() >= data.sessionEndTime) {
      chrome.alarms.clear('storeTimer');
      await switchToNextStore();
    }
  }
  if (alarm.name === 'hivemindSync') {
    await hivemindSync();
  }
});

// ── Message handler ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_QUEUE') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        activeTabId = tabs[0].id;
        const depopTabs = await chrome.tabs.query({ url: '*://*.depop.com/*' });
        for (const tab of depopTabs) {
          if (tab.id !== activeTabId) chrome.tabs.remove(tab.id).catch(() => {});
        }
        await startStore(activeTabId);
      }
    });
    return true;
  }
  if (request.action === 'STOP_QUEUE') {
    chrome.alarms.clear('storeTimer');
    removeOnUpdatedListener();
    activeTabId = null;
    return;
  }
  if (request.action === 'NEXT_STEP') {
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
        .catch(e => console.error('Re-inject error:', e));
    }
  }
  if (request.action === 'STORE_DONE') {
    console.log('Store done — Smart Idle mode');
  }
  if (request.action === 'QUEUE_COMPLETE') {
    reportStatus(false, null);
  }
});

// ── Start hivemind sync alarm on install/startup ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('hivemindSync', { periodInMinutes: 1 });
  console.log('[Hivemind] Background sync started');
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('hivemindSync', { periodInMinutes: 1 });
});

// Also run sync immediately on service worker wake
hivemindSync();
