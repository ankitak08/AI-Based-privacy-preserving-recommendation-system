const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const { readDb, writeDb } = require('./src/db');
const { computeMoodVector } = require('./src/mood');
const { buildRecommendations } = require('./src/recommendations');
const { enrichRecommendations } = require('./src/imageResolver');

const app = express();

// Password: at least 8 chars, 1 lowercase, 1 uppercase, 1 digit, 1 special
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

app.use(express.json({ limit: '64kb' }));
app.use(express.text({ type: 'text/plain', limit: '64kb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: false },
  })
);

app.use(express.static(path.join(__dirname, 'public')));

try {
  const db = readDb();
  if (db && db.mood_profiles) {
    delete db.mood_profiles;
    writeDb(db);
  }
} catch {
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const db = readDb();
  const user = db.users.find((u) => u.user_id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const role = user.role || 'user';
  if (role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

function listAudioFilesForGenre(genre) {
  const allowed = new Set(['romantic', 'energetic', 'calm', 'sad']);
  if (!allowed.has(genre)) return [];

  const dir = path.join(__dirname, 'public', 'audio', genre);
  if (!fs.existsSync(dir)) return [];

  const exts = new Set(['.mp3', '.wav', '.m4a', '.ogg']);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => exts.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function listCoverFilesForGenre(genre) {
  const allowed = new Set(['romantic', 'energetic', 'calm', 'sad']);
  if (!allowed.has(genre)) return [];

  const dir = path.join(__dirname, 'public', 'audio', genre, 'covers');
  if (!fs.existsSync(dir)) return [];

  const exts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => exts.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function parseTrackIndex(trackId) {
  if (typeof trackId !== 'string') return null;
  const m = trackId.match(/_(\d{2})$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 99) return null;
  return n;
}

function nowIso() {
  return new Date().toISOString();
}

const eventsByUser = new Map();

function getNowPlayingForUser(userId) {
  const buffer = eventsByUser.get(userId) || [];
  const candidates = buffer.filter((e) => e && (e.event_type === 'play' || e.event_type === 'play_time'));
  let last = candidates.length ? candidates[candidates.length - 1] : null;
  if (!last || typeof last.genre !== 'string') {
    const clicks = buffer.filter((e) => e && e.event_type === 'click_genre');
    last = clicks.length ? clicks[clicks.length - 1] : null;
  }
  if (!last || typeof last.genre !== 'string') return { genre: '', item_id: '', timestamp: null };
  return {
    genre: last.genre,
    item_id: typeof last.item_id === 'string' ? last.item_id : '',
    timestamp: typeof last.timestamp === 'string' ? last.timestamp : null,
  };
}

function upsertEventBuffer(userId, newEvents) {
  const existing = eventsByUser.get(userId) || [];
  const combined = [...existing, ...newEvents];
  const MAX_EVENTS = 200;
  const trimmed = combined.slice(-MAX_EVENTS);
  eventsByUser.set(userId, trimmed);
  return trimmed;
}

function getMoodForUser(userId) {
  const buffer = eventsByUser.get(userId) || [];
  if (!buffer.length) {
    return { romantic: 0.25, energetic: 0.25, calm: 0.25, sad: 0.25 };
  }
  return computeMoodVector(buffer);
}




app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    const safeName = typeof name === 'string' ? name.trim() : '';
    const safeEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const pwd = typeof password === 'string' ? password : '';

    if (!safeName) {
      return res.status(400).json({ error: 'name_required' });
    }
    if (!safeEmail) {
      return res.status(400).json({ error: 'email_required' });
    }
    if (!PASSWORD_RE.test(pwd)) {
      return res.status(400).json({ error: 'weak_password' });
    }

    const db = readDb();
    const existingEmail = db.users.find((u) => (u.email || '').toLowerCase() === safeEmail);
    if (existingEmail) {
      return res.status(409).json({ error: 'email_in_use' });
    }

    const password_hash = await bcrypt.hash(pwd, 10);
    const user_id = `u_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

    const role = db.users.length === 0 ? 'admin' : 'user';
    const created_at = new Date().toISOString();
    const username = safeName;

    db.users.push({ user_id, name: safeName, email: safeEmail, username, password_hash, role, created_at });
    writeDb(db);

    // Do not auto-login on signup; require explicit login.
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'signup_failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const safeEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const pwd = typeof password === 'string' ? password : '';

    if (!safeEmail) {
      return res.status(400).json({ error: 'email_required' });
    }

    const db = readDb();
    const user = db.users.find((u) => (u.email || '').toLowerCase() === safeEmail);
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });

    const ok = await bcrypt.compare(pwd, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    req.session.userId = user.user_id;
    req.session.role = user.role || 'user';

    res.json({ user_id: user.user_id, username: user.username || user.name || '', role: user.role || 'user' });
  } catch (e) {
    res.status(500).json({ error: 'login_failed' });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((u) => u.user_id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  res.json({
    user_id: user.user_id,
    username: user.username || user.name || '',
    name: user.name || '',
    email: user.email || '',
    role: user.role || 'user',
  });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/media/:genre/:trackId', requireAuth, (req, res) => {
  const genre = req.params.genre;
  const trackId = req.params.trackId;
  const idx = parseTrackIndex(trackId);
  if (!idx) return res.status(400).end();

  const files = listAudioFilesForGenre(genre);
  const file = files[idx - 1];
  if (!file) return res.status(404).end();

  const abs = path.join(__dirname, 'public', 'audio', genre, file);
  res.sendFile(abs);
});

app.get('/api/media-index/:genre', requireAuth, (req, res) => {
  const genre = req.params.genre;
  const audioFiles = listAudioFilesForGenre(genre);
  const coverFiles = listCoverFilesForGenre(genre);
  res.json({ genre, audioFiles, coverFiles });
});

app.post('/api/track', requireAuth, (req, res) => {
  const user_id = req.session.userId;
  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  const events = Array.isArray(body.events) ? body.events : [body];

  const sanitized = events
    .map((e) => {
      const genre = typeof e.genre === 'string' ? e.genre : '';
      const event_type = typeof e.event_type === 'string' ? e.event_type : '';
      const item_id = typeof e.item_id === 'string' ? e.item_id : undefined;
      const duration_ms = Number.isFinite(e.duration_ms) ? Math.max(0, Math.floor(e.duration_ms)) : 0;
      const timestamp = typeof e.timestamp === 'string' ? e.timestamp : nowIso();

      return {
        user_id,
        event_type,
        genre,
        item_id,
        timestamp,
        duration_ms,
      };
    })
    .filter((e) => e.event_type && e.genre);

  const buffer = upsertEventBuffer(user_id, sanitized);
  const mood = computeMoodVector(buffer);

  res.json({ ok: true, mood });
});

app.get('/api/mood', requireAuth, (req, res) => {
  const user_id = req.session.userId;
  const mood = getMoodForUser(user_id);
  const now_playing = getNowPlayingForUser(user_id);
  res.json({ user_id, mood, now_playing, timestamp: null });
});

app.get('/api/recommendations', requireAuth, async (req, res) => {
  try {
    const user_id = req.session.userId;
    const mood = getMoodForUser(user_id);
    const now_playing = getNowPlayingForUser(user_id);

    const focus_moods = now_playing && typeof now_playing.genre === 'string' && now_playing.genre ? [now_playing.genre] : [];
    const payload = buildRecommendations(mood, { focus_moods });
    const enriched = await enrichRecommendations(payload);
    res.json({ user_id, mood, now_playing, ...enriched });
  } catch {
    res.status(500).json({ error: 'recommendations_failed' });
  }
});

app.post('/api/playlist/save', requireAuth, (req, res) => {
  const user_id = req.session.userId;
  const body = req.body || {};
  const rawIds = Array.isArray(body.item_ids) ? body.item_ids : [];
  const item_ids = rawIds.filter((id) => typeof id === 'string' && id.trim().length > 0);

  const db = readDb();
  const now = new Date().toISOString();

  const existingIdx = db.playlists.findIndex((p) => p.user_id === user_id);
  if (existingIdx >= 0) {
    db.playlists[existingIdx] = {
      ...db.playlists[existingIdx],
      item_ids,
      updated_at: now,
    };
  } else {
    const id = `pl_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    db.playlists.push({ id, user_id, item_ids, created_at: now, updated_at: now });
  }

  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/playlist/clear', requireAuth, (req, res) => {
  const user_id = req.session.userId;
  const db = readDb();
  db.playlists = db.playlists.filter((p) => p.user_id !== user_id);
  writeDb(db);
  res.json({ ok: true });
});

app.post('/api/clear-profile', requireAuth, (req, res) => {
  const user_id = req.session.userId;
  eventsByUser.delete(user_id);

  const db = readDb();
  if (db.mood_profiles) {
    delete db.mood_profiles;
    writeDb(db);
  }

  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
