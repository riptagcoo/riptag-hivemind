const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── In-memory state ──
let state = {
  stores: [],          // Today's store URLs in order
  started: false,      // Global start flag
  startedAt: null,
  pcs: {
    pc1: { accounts: 9, groups: 3 },
    pc2: { accounts: 9, groups: 3 },
    pc3: { accounts: 6, groups: 2 },
    pc4: { accounts: 6, groups: 2 },
    pc5: { accounts: 9, groups: 3 },
    pc6: { accounts: 9, groups: 3 }
  },
  status: {}           // { "pc1-g0": { running, lastSeen, currentStore } }
};

// ── Helper: build staggered queue for a group ──
// groupIndex = 0,1,2 — offsets the starting store
function buildQueue(stores, groupIndex) {
  if (!stores.length) return [];
  const offset = groupIndex % stores.length;
  return [...stores.slice(offset), ...stores.slice(0, offset)];
}

// ── POST /api/stores — dashboard saves today's store list ──
app.post('/api/stores', (req, res) => {
  const { stores } = req.body;
  if (!Array.isArray(stores)) return res.status(400).json({ error: 'stores must be an array' });
  state.stores = stores.filter(s => s && s.trim());
  state.started = false;
  state.startedAt = null;
  state.status = {};
  console.log(`[Hivemind] Stores updated: ${state.stores.length} stores`);
  res.json({ ok: true, count: state.stores.length });
});

// ── POST /api/start — dashboard triggers global start ──
app.post('/api/start', (req, res) => {
  if (!state.stores.length) return res.status(400).json({ error: 'No stores loaded' });
  state.started = true;
  state.startedAt = Date.now();
  console.log('[Hivemind] STARTED');
  res.json({ ok: true, startedAt: state.startedAt });
});

// ── POST /api/stop — dashboard stops everything ──
app.post('/api/stop', (req, res) => {
  state.started = false;
  console.log('[Hivemind] STOPPED');
  res.json({ ok: true });
});

// ── GET /api/queue/:pcId/:groupIndex — extension polls for its queue ──
app.get('/api/queue/:pcId/:groupIndex', (req, res) => {
  const { pcId, groupIndex } = req.params;
  const gIdx = parseInt(groupIndex);
  const queue = buildQueue(state.stores, gIdx);
  res.json({
    queue,
    started: state.started,
    startedAt: state.startedAt
  });
});

// ── POST /api/status — extension reports its running status ──
app.post('/api/status', (req, res) => {
  const { pcId, groupIndex, running, currentStore } = req.body;
  const key = `${pcId}-g${groupIndex}`;
  state.status[key] = { running, currentStore, lastSeen: Date.now() };
  res.json({ ok: true });
});

// ── GET /api/state — dashboard polls full state ──
app.get('/api/state', (req, res) => {
  res.json({
    stores: state.stores,
    started: state.started,
    startedAt: state.startedAt,
    pcs: state.pcs,
    status: state.status
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Hivemind] Running on port ${PORT}`));
