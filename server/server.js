const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Persistence: read/write state to disk ──
const DATA_FILE = path.join(__dirname, 'data.json');

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch(e) {
    console.error('[Hivemind] Failed to load state:', e);
  }
  return null;
}

function saveState() {
  try {
    // Don't persist runtime-only fields
    const toSave = {
      pcs: state.pcs,
      settings: state.settings,
      dayFolders: state.dayFolders
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(toSave, null, 2));
  } catch(e) {
    console.error('[Hivemind] Failed to save state:', e);
  }
}

// ── Default state ──
const DEFAULT_STATE = {
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
  },
  dayFolders: {
    monday: '',
    tuesday: '',
    wednesday: '',
    thursday: '',
    friday: ''
  }
};

// Load persisted state on startup
const saved = loadState();
let state = {
  ...DEFAULT_STATE,
  ...(saved || {}),
  // Always reset runtime fields
  started: false,
  startedAt: null,
  status: {}
};

console.log('[Hivemind] State loaded. PCs:', Object.keys(state.pcs).length);

// ── Routes ──

app.get('/api/state', (req, res) => res.json(state));

app.post('/api/pcs', (req, res) => {
  const { pcs } = req.body;
  if (!pcs) return res.status(400).json({ error: 'missing pcs' });
  state.pcs = pcs;
  state.started = false;
  state.startedAt = null;
  state.status = {};
  saveState();
  res.json({ ok: true });
});

app.post('/api/settings', (req, res) => {
  const s = req.body;
  if (!s) return res.status(400).json({ error: 'missing settings' });
  state.settings = { ...state.settings, ...s };
  saveState();
  res.json({ ok: true });
});

app.post('/api/dayfolders', (req, res) => {
  const { dayFolders } = req.body;
  if (!dayFolders) return res.status(400).json({ error: 'missing dayFolders' });
  state.dayFolders = { ...state.dayFolders, ...dayFolders };
  saveState();
  res.json({ ok: true });
});

app.post('/api/start', (req, res) => {
  state.started = true;
  state.startedAt = Date.now();
  res.json({ ok: true });
});

app.post('/api/stop', (req, res) => {
  state.started = false;
  res.json({ ok: true });
});

app.get('/api/queue/:pcId/:groupIndex', (req, res) => {
  const { pcId, groupIndex } = req.params;
  const pc = state.pcs[pcId];
  if (!pc) return res.json({ queue: [], started: false, settings: state.settings });
  const group = pc.groups[parseInt(groupIndex)];
  const queue = group ? group.queue : [];
  res.json({ queue, started: state.started, startedAt: state.startedAt, settings: state.settings });
});

app.get('/api/pcs-list', (req, res) => {
  const list = Object.entries(state.pcs).map(([id, pc]) => ({
    id, label: pc.label, groupCount: pc.groups.length
  }));
  res.json(list);
});

app.post('/api/status', (req, res) => {
  const { pcId, groupIndex, running, currentStore, listingsProcessed, storeIndex, totalStores } = req.body;
  const key = `${pcId}-g${groupIndex}`;
  state.status[key] = { running, currentStore, listingsProcessed, storeIndex, totalStores, lastSeen: Date.now() };
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[Hivemind] Running on port ${PORT}`));
