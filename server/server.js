const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hivemind_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )
  `);
  console.log('[Hivemind] DB ready');
}

async function dbGet(key) {
  try {
    const res = await pool.query('SELECT value FROM hivemind_state WHERE key = $1', [key]);
    return res.rows.length ? res.rows[0].value : null;
  } catch(e) { console.error('[DB] Get error:', e.message); return null; }
}

async function dbSet(key, value) {
  try {
    await pool.query(`
      INSERT INTO hivemind_state (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $2
    `, [key, JSON.stringify(value)]);
  } catch(e) { console.error('[DB] Set error:', e.message); }
}

let runtime = { started: false, startedAt: null, status: {} };

const DEFAULT_SETTINGS = {
  sessionMinutes: 35, maxDays: 7, maxPosts: 30, speedPreset: 'balanced',
  minDelay: 1500, maxDelay: 4000, hesitationChance: 25, hesitationDuration: 3000
};

const DEFAULT_DAY_FOLDERS = {
  monday:    { g0: '', g1: '', g2: '' },
  tuesday:   { g0: '', g1: '', g2: '' },
  wednesday: { g0: '', g1: '', g2: '' },
  thursday:  { g0: '', g1: '', g2: '' },
  friday:    { g0: '', g1: '', g2: '' }
};

async function getFullState() {
  const [pcs, settings, dayFolders] = await Promise.all([
    dbGet('pcs'), dbGet('settings'), dbGet('dayFolders')
  ]);
  return {
    pcs: pcs || {},
    settings: settings || DEFAULT_SETTINGS,
    dayFolders: dayFolders || DEFAULT_DAY_FOLDERS,
    started: runtime.started,
    startedAt: runtime.startedAt,
    status: runtime.status
  };
}

app.get('/api/state', async (req, res) => res.json(await getFullState()));

app.post('/api/pcs', async (req, res) => {
  const { pcs } = req.body;
  if (!pcs) return res.status(400).json({ error: 'missing pcs' });
  await dbSet('pcs', pcs);
  runtime.status = {};
  res.json({ ok: true });
});

app.post('/api/settings', async (req, res) => {
  const s = req.body;
  if (!s) return res.status(400).json({ error: 'missing settings' });
  const current = await dbGet('settings') || DEFAULT_SETTINGS;
  await dbSet('settings', { ...current, ...s });
  res.json({ ok: true });
});

app.post('/api/dayfolders', async (req, res) => {
  const { dayFolders } = req.body;
  if (!dayFolders) return res.status(400).json({ error: 'missing dayFolders' });
  const current = await dbGet('dayFolders') || DEFAULT_DAY_FOLDERS;
  await dbSet('dayFolders', { ...current, ...dayFolders });
  res.json({ ok: true });
});

app.post('/api/start', (req, res) => {
  runtime.started = true;
  runtime.startedAt = Date.now();
  res.json({ ok: true });
});

app.post('/api/stop', (req, res) => {
  runtime.started = false;
  res.json({ ok: true });
});

app.get('/api/queue/:pcId/:groupIndex', async (req, res) => {
  const { pcId, groupIndex } = req.params;
  const [pcs, settings] = await Promise.all([dbGet('pcs'), dbGet('settings')]);
  const pc = (pcs || {})[pcId];
  if (!pc) return res.json({ queue: [], started: runtime.started, settings: settings || DEFAULT_SETTINGS });
  const group = pc.groups[parseInt(groupIndex)];
  const queue = group ? group.queue : [];
  res.json({ queue, started: runtime.started, startedAt: runtime.startedAt, settings: settings || DEFAULT_SETTINGS });
});

app.get('/api/pcs-list', async (req, res) => {
  const pcs = await dbGet('pcs') || {};
  res.json(Object.entries(pcs).map(([id, pc]) => ({ id, label: pc.label, groupCount: pc.groups.length })));
});

app.post('/api/status', (req, res) => {
  const { pcId, groupIndex, running, currentStore, listingsProcessed, storeIndex, totalStores } = req.body;
  const key = `${pcId}-g${groupIndex}`;
  runtime.status[key] = { running, currentStore, listingsProcessed, storeIndex, totalStores, lastSeen: Date.now() };
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`[Hivemind] Running on port ${PORT}`));
}).catch(err => { console.error('[Hivemind] DB init failed:', err); process.exit(1); });
