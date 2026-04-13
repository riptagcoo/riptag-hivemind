(async () => {
    const data = await chrome.storage.local.get([
        'running', 'currentIndex', 'maxDays', 'maxPosts',
        'minDelay', 'maxDelay', 'hesitationChance', 'hesitationDuration',
        'sessionEndTime', 'sessionMinutes'
    ]);

    if (!data.running) return;

    // ── GAUSSIAN ENGINE: Timer-aware adaptive delays ──
    const hMin = data.minDelay || 1500;
    const hMax = data.maxDelay || 4000;
    const hChance = (data.hesitationChance ?? 25) / 100;
    const hDuration = data.hesitationDuration || 3000;
    const totalPosts = data.maxPosts || 30;

    const humanWait = (baseMs) => {
        const scale = baseMs / 2500;

        // Progress-based adaptive: speed up as we process more posts
        const progress = (data.currentIndex || 0) / totalPosts;
        let adaptive = 1.0 - (progress * 0.4);

        // Timer-based adaptive: if >50% of session time used, speed up further
        if (data.sessionEndTime) {
            const sessionTotal = (data.sessionMinutes || 10) * 60000;
            const elapsed = sessionTotal - (data.sessionEndTime - Date.now());
            const timeProgress = Math.max(0, Math.min(1, elapsed / sessionTotal));
            if (timeProgress > 0.5) {
                const timerPressure = (timeProgress - 0.5) * 0.8; // up to 0.4 extra reduction
                adaptive = Math.max(0.3, adaptive - timerPressure);
            }
        }

        const delay = hMin + Math.random() * (hMax - hMin);
        const scaled = delay * scale * adaptive;
        const extraHesitation = Math.random() < (hChance * adaptive) ? hDuration * adaptive : 0;
        return new Promise(res => setTimeout(res, scaled + extraHesitation));
    };

    // ── SMART IDLE: Scroll & mouse activity to stay active ──
    async function enterSmartIdle() {
        console.log("Entering Smart Idle mode...");
        const startUrl = window.location.href;

        while (true) {
            // Check if we should stop
            const check = await chrome.storage.local.get(['running', 'sessionEndTime']);
            if (!check.running) break;

            // Check if background navigated us away (timer expired, new store)
            if (window.location.href !== startUrl) break;

            // Check if session timer expired locally
            if (check.sessionEndTime && Date.now() >= check.sessionEndTime) break;

            // Random idle action
            const action = Math.random();
            if (action < 0.4) {
                // Smooth scroll to random position
                const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
                const target = Math.random() * maxScroll;
                window.scrollTo({ top: target, behavior: 'smooth' });
            } else if (action < 0.7) {
                // Scroll back up a bit
                window.scrollBy({ top: -(200 + Math.random() * 400), behavior: 'smooth' });
            } else {
                // Dispatch a subtle mouse move event
                const x = Math.random() * window.innerWidth;
                const y = Math.random() * window.innerHeight;
                document.dispatchEvent(new MouseEvent('mousemove', {
                    clientX: x, clientY: y, bubbles: true
                }));
            }

            // Wait 8-15 seconds between idle actions
            const idleWait = 8000 + Math.random() * 7000;
            await new Promise(res => setTimeout(res, idleWait));
        }

        console.log("Exiting Smart Idle mode.");
    }

    // ── PHASE 1: Process Listings ──
    const links = Array.from(document.querySelectorAll('a[href*="/products/"]'))
                       .filter(a => a.querySelector('img'));

    let i = data.currentIndex || 0;

    // HARD STOP: Post Count Limit — enter idle instead of full stop
    if (i >= data.maxPosts) {
        chrome.runtime.sendMessage({ action: "STORE_DONE" });
        await enterSmartIdle();
        return;
    }

    if (i < links.length) {
        try {
            links[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            await humanWait(2500);

            await chrome.storage.local.set({ currentIndex: i + 1 });
            links[i].click();

            // Wait for product page load
            console.log("Waiting for page load...");
            await humanWait(7500);

            // --- DATE THRESHOLD CHECK ---
            const timeElement = Array.from(document.querySelectorAll('span, p, time'))
                                     .find(el => el.innerText.toLowerCase().includes('listed'));

            if (timeElement && data.maxDays < 999) {
                const timeText = timeElement.innerText.toLowerCase();
                let daysAgo = 0;
                const val = parseInt(timeText.match(/\d+/) || 0);

                if (timeText.includes('day')) daysAgo = val;
                else if (timeText.includes('week')) daysAgo = val * 7;
                else if (timeText.includes('month')) daysAgo = val * 30;

                if (daysAgo > data.maxDays) {
                    // Date threshold hit — go back and idle
                    window.history.back();
                    await humanWait(3000);
                    chrome.runtime.sendMessage({ action: "STORE_DONE" });
                    await enterSmartIdle();
                    return;
                }
            }

            // --- LIKE LOGIC ---
            const likeBtn = document.querySelector('button[data-testid="productInteraction__likeButton"]') ||
                            document.querySelector('button[aria-label*="Like product"]');

            if (likeBtn) {
                const isFilled = likeBtn.querySelector('svg[data-testid="productInteraction__filledHeart"]');

                if (!isFilled) {
                    console.log("Found empty heart, clicking button...");
                    await humanWait(1200);
                    likeBtn.click();
                    await humanWait(2000);
                } else {
                    console.log("Item already liked. Skipping.");
                }
            }

            // --- ADD TO BAG ---
            const bagBtn = Array.from(document.querySelectorAll('button'))
                                .find(b => b.innerText.toLowerCase().includes('add to bag'));

            if (bagBtn) {
                bagBtn.click();
                console.log("Added to bag.");
                await humanWait(2500);
            }

            // --- MAKE OFFER ---
            const offerBtn = Array.from(document.querySelectorAll('button'))
                                  .find(b => b.innerText.toLowerCase().includes('make offer'));
            if (offerBtn) {
                offerBtn.click();
                await humanWait(3500);

                const recBtn = document.querySelector('button[class*="buttonRecommended"]');
                if (recBtn) {
                    recBtn.click();
                    await humanWait(2000);

                    const sendBtn = Array.from(document.querySelectorAll('button'))
                                         .find(b => b.innerText.toLowerCase().includes('send offer'));
                    if (sendBtn) {
                        await humanWait(1200);
                        sendBtn.click();
                        console.log("Offer Sent.");
                    }
                }
            }

            await humanWait(3000);
            window.history.back();
            await humanWait(5000);
            chrome.runtime.sendMessage({ action: "NEXT_STEP" });

        } catch (e) {
            console.error("Session Jitter Error:", e);
            window.history.back();
            await humanWait(5000);
            chrome.runtime.sendMessage({ action: "NEXT_STEP" });
        }
    } else {
        // No more links on page — enter Smart Idle until timer expires
        chrome.runtime.sendMessage({ action: "STORE_DONE" });
        await enterSmartIdle();
    }
})();
