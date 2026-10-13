const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    // Initialize with all top-level collections so later code can rely on them.
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify({ users: [], movies: [], playlists: [] }, null, 2),
      'utf8'
    );
  }
}

function readDb() {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  // Backwards compatibility for older db.json files that might be missing fields.
  if (!parsed.users) parsed.users = [];
  if (!parsed.movies) parsed.movies = [];
  if (!parsed.playlists) parsed.playlists = [];
  return parsed;
}

function writeDb(db) {
  ensureDbFile();
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

module.exports = { readDb, writeDb };
