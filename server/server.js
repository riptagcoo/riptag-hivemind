const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── State ──
let state = {
  pcs: {},
  started: false,
  startedAt: null,
  status: {},
  settings: {
    sessionMinutes: 35,
    maxDays: 7,
    maxPosts: 30,
    speedPreset: 'balanced',
    minDelay: 1500,
    maxDelay: 4000,
    hesitationChance: 25,
    hesitationDuration: 3000
  }
};

// ── GET /api/state ──
app.get('/api/state', (req, res) => res.json(state));

// ── POST /api/pcs ──
app.post('/api/pcs', (req, res) => {
  const { pcs } = req.body;
  if (!pcs) return res.status(400).json({ error: 'missing pcs' });
  state.pcs = pcs;
  state.started = false;
  state.startedAt = null;
  state.status = {};
  res.json({ ok: true });
});

// ── POST /api/settings ── dashboard saves global settings
app.post('/api/settings', (req, res) => {
  const s = req.body;
  if (!s) return res.status(400).json({ error: 'missing settings' });
  state.settings = { ...state.settings, ...s };
  console.log('[Hivemind] Settings updated:', state.settings);
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

// ── GET /api/queue/:pcId/:groupIndex ── returns queue + settings
app.get('/api/queue/:pcId/:groupIndex', (req, res) => {
  const { pcId, groupIndex } = req.params;
  const pc = state.pcs[pcId];
  if (!pc) return res.json({ queue: [], started: false, settings: state.settings });
  const group = pc.groups[parseInt(groupIndex)];
  const queue = group ? group.queue : [];
  res.json({ queue, started: state.started, startedAt: state.startedAt, settings: state.settings });
});

// ── GET /api/pcs-list ──
app.get('/api/pcs-list', (req, res) => {
  const list = Object.entries(state.pcs).map(([id, pc]) => ({
    id, label: pc.label, groupCount: pc.groups.length
  }));
  res.json(list);
});

// ── POST /api/status ──
app.post('/api/status', (req, res) => {
  const { pcId, groupIndex, running, currentStore } = req.body;
  const key = `${pcId}-g${groupIndex}`;
  state.status[key] = { running, currentStore, lastSeen: Date.now() };
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Hivemind] Running on port ${PORT}`));
