const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── State ──
// pcs = { pc1: { label: 'PC 1', groups: [ { queue: [...] }, ... ] }, ... }
let state = {
  pcs: {},
  started: false,
  startedAt: null,
  status: {}  // { 'pc1-g0': { running, lastSeen, currentStore } }
};

// ── GET /api/state ── dashboard polls this
app.get('/api/state', (req, res) => res.json(state));

// ── POST /api/pcs ── save full PC config from dashboard
app.post('/api/pcs', (req, res) => {
  const { pcs } = req.body;
  if (!pcs) return res.status(400).json({ error: 'missing pcs' });
  state.pcs = pcs;
  state.started = false;
  state.startedAt = null;
  state.status = {};
  res.json({ ok: true });
});

// ── POST /api/start ──
app.post('/api/start', (req, res) => {
  state.started = true;
  state.startedAt = Date.now();
  res.json({ ok: true });
});

// ── POST /api/stop ──
app.post('/api/stop', (req, res) => {
  state.started = false;
  res.json({ ok: true });
});

// ── GET /api/queue/:pcId/:groupIndex ── extension polls this
app.get('/api/queue/:pcId/:groupIndex', (req, res) => {
  const { pcId, groupIndex } = req.params;
  const pc = state.pcs[pcId];
  if (!pc) return res.json({ queue: [], started: false });
  const group = pc.groups[parseInt(groupIndex)];
  const queue = group ? group.queue : [];
  res.json({ queue, started: state.started, startedAt: state.startedAt });
});

// ── GET /api/pcs-list ── extension fetches available PCs for dropdowns
app.get('/api/pcs-list', (req, res) => {
  const list = Object.entries(state.pcs).map(([id, pc]) => ({
    id,
    label: pc.label,
    groupCount: pc.groups.length
  }));
  res.json(list);
});

// ── POST /api/status ── extension reports status
app.post('/api/status', (req, res) => {
  const { pcId, groupIndex, running, currentStore } = req.body;
  const key = `${pcId}-g${groupIndex}`;
  state.status[key] = { running, currentStore, lastSeen: Date.now() };
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Hivemind] Running on port ${PORT}`));
