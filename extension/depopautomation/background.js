// ── Track the active tab for queue navigation ──
let activeTabId = null;

// ── Navigate to a store and start its session timer ──
async function startStore(tabId) {
    const data = await chrome.storage.local.get(['storeQueue', 'currentStoreIndex', 'sessionMinutes', 'running']);
    if (!data.running) return;

    const queue = data.storeQueue || [];
    const idx = data.currentStoreIndex || 0;

    if (idx >= queue.length) {
        // All stores done
        await chrome.storage.local.set({ running: false });
        chrome.runtime.sendMessage({ action: "QUEUE_COMPLETE" }).catch(() => {});
        chrome.alarms.clear("storeTimer");
        return;
    }

    const url = queue[idx];
    const sessionMs = (data.sessionMinutes || 10) * 60000;
    const sessionEndTime = Date.now() + sessionMs;

    // Reset per-store state
    await chrome.storage.local.set({ currentIndex: 0, sessionEndTime });

    // Navigate to the store URL
    await chrome.tabs.update(tabId, { url });

    // Wait for page to load before injecting content script
    chrome.tabs.onUpdated.addListener(function onLoad(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(onLoad);
            setTimeout(() => {
                chrome.scripting.executeScript({
                    target: { tabId },
                    files: ['content.js']
                }).catch(e => console.error("Inject error:", e));
            }, 2000);
        }
    });

    // Start the alarm timer (fires every 5 seconds to check expiry)
    chrome.alarms.create("storeTimer", { periodInMinutes: 5 / 60 });
}

// ── Switch to next store ──
async function switchToNextStore() {
    const data = await chrome.storage.local.get(['currentStoreIndex', 'storeQueue', 'running']);
    if (!data.running) return;

    const nextIdx = (data.currentStoreIndex || 0) + 1;
    await chrome.storage.local.set({ currentStoreIndex: nextIdx });

    if (activeTabId) {
        await startStore(activeTabId);
    }
}

// ── Alarm handler: check if session timer expired ──
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== "storeTimer") return;

    const data = await chrome.storage.local.get(['running', 'sessionEndTime']);
    if (!data.running) {
        chrome.alarms.clear("storeTimer");
        return;
    }

    if (Date.now() >= data.sessionEndTime) {
        console.log("Session timer expired — switching to next store");
        chrome.alarms.clear("storeTimer");
        await switchToNextStore();
    }
});

// ── Message handler ──
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_QUEUE") {
        // Get active tab and start first store
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]) {
                activeTabId = tabs[0].id;
                await startStore(activeTabId);
            }
        });
        return true;
    }

    if (request.action === "STOP_QUEUE") {
        chrome.alarms.clear("storeTimer");
        activeTabId = null;
        return;
    }

    if (request.action === "NEXT_STEP") {
        // Re-inject content.js for next product on same store
        const tabId = sender.tab?.id;
        if (tabId) {
            chrome.scripting.executeScript({
                target: { tabId },
                files: ['content.js']
            }).catch(e => console.error("Re-inject error:", e));
        }
    }

    if (request.action === "STORE_DONE") {
        // Content script finished all listings for this store.
        // Do NOT switch yet — content.js enters Smart Idle mode.
        // The alarm timer will trigger the switch when time is up.
        console.log("Store listings done — content.js is now in Smart Idle mode");
    }
});
