// ── Track active tab and listener state ──
let activeTabId = null;
let onUpdatedListener = null; // single listener reference — prevents stacking

// ── Clean up tab memory after each store ──
async function cleanupTab(tabId) {
  try {
    // Navigate to blank page to flush page memory/cache
    await chrome.tabs.update(tabId, { url: 'about:blank' });
    // Small delay then discard to release renderer memory
    setTimeout(() => {
      chrome.tabs.discard(tabId).catch(() => {});
    }, 1500);
  } catch(e) {}
}

// ── Remove any existing onUpdated listener before adding a new one ──
function removeOnUpdatedListener() {
  if (onUpdatedListener) {
    chrome.tabs.onUpdated.removeListener(onUpdatedListener);
    onUpdatedListener = null;
  }
}

// ── Navigate to a store and start its session timer ──
async function startStore(tabId) {
  const data = await chrome.storage.local.get(['storeQueue', 'currentStoreIndex', 'sessionMinutes', 'running']);
  if (!data.running) return;

  const queue = data.storeQueue || [];
  const idx = data.currentStoreIndex || 0;

  if (idx >= queue.length) {
    // All stores done
    await chrome.storage.local.set({ running: false });
    chrome.runtime.sendMessage({ action: 'QUEUE_COMPLETE' }).catch(() => {});
    chrome.alarms.clear('storeTimer');
    return;
  }

  const url = queue[idx];
  const sessionMs = (data.sessionMinutes || 10) * 60000;
  const sessionEndTime = Date.now() + sessionMs;

  await chrome.storage.local.set({ currentIndex: 0, sessionEndTime });

  // ── Remove any stale listener before adding new one ──
  removeOnUpdatedListener();

  // Navigate to store
  await chrome.tabs.update(tabId, { url });

  // Wait for page load — single listener, stored by reference
  onUpdatedListener = function(updatedTabId, changeInfo) {
    if (updatedTabId === tabId && changeInfo.status === 'complete') {
      removeOnUpdatedListener(); // clean up immediately
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        }).catch(e => console.error('Inject error:', e));
      }, 2000);
    }
  };
  chrome.tabs.onUpdated.addListener(onUpdatedListener);

  // Start alarm timer
  chrome.alarms.create('storeTimer', { periodInMinutes: 5 / 60 });
}

// ── Switch to next store ──
async function switchToNextStore() {
  const data = await chrome.storage.local.get(['currentStoreIndex', 'storeQueue', 'running']);
  if (!data.running) return;

  const nextIdx = (data.currentStoreIndex || 0) + 1;
  await chrome.storage.local.set({ currentStoreIndex: nextIdx });

  if (activeTabId) {
    // Clean up current tab memory before loading next store
    await cleanupTab(activeTabId);
    // Brief pause after cleanup before loading next store
    setTimeout(() => startStore(activeTabId), 2000);
  }
}

// ── Alarm handler ──
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'storeTimer') return;

  const data = await chrome.storage.local.get(['running', 'sessionEndTime']);
  if (!data.running) { chrome.alarms.clear('storeTimer'); return; }

  if (Date.now() >= data.sessionEndTime) {
    console.log('Session timer expired — switching to next store');
    chrome.alarms.clear('storeTimer');
    await switchToNextStore();
  }
});

// ── Message handler ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_QUEUE') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]) {
        activeTabId = tabs[0].id;

        // Close all extra Depop tabs before starting — only keep active tab
        const allTabs = await chrome.tabs.query({ url: '*://*.depop.com/*' });
        for (const tab of allTabs) {
          if (tab.id !== activeTabId) {
            chrome.tabs.remove(tab.id).catch(() => {});
          }
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
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      }).catch(e => console.error('Re-inject error:', e));
    }
  }

  if (request.action === 'STORE_DONE') {
    console.log('Store listings done — content.js entering Smart Idle mode');
  }
});
