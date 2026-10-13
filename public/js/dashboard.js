import { apiGet, apiPost } from '/js/api.js';
import { ActivityTracker } from '/js/tracker.js';
import { dominantMoodName, fmtMs } from '/js/ui.js';

const GENRES = [
  { key: 'romantic', label: 'Romantic', hint: 'warm, soft, intimate' },
  { key: 'energetic', label: 'Energetic', hint: 'fast, intense, upbeat' },
  { key: 'calm', label: 'Calm', hint: 'focus, ambient, relaxed' },
  { key: 'sad', label: 'Sad', hint: 'soothing, reflective' },
];

const TRACKS = {
  romantic: Array.from({ length: 9 }, (_, i) => ({ id: `track_rom_${String(i + 1).padStart(2, '0')}`, title: `Romantic Track ${i + 1}`, artist: 'MoodSphere' })),
  energetic: Array.from({ length: 9 }, (_, i) => ({ id: `track_eng_${String(i + 1).padStart(2, '0')}`, title: `Energetic Track ${i + 1}`, artist: 'MoodSphere' })),
  calm: Array.from({ length: 9 }, (_, i) => ({ id: `track_clm_${String(i + 1).padStart(2, '0')}`, title: `Calm Track ${i + 1}`, artist: 'MoodSphere' })),
  sad: Array.from({ length: 9 }, (_, i) => ({ id: `track_sad_${String(i + 1).padStart(2, '0')}`, title: `Sad Track ${i + 1}`, artist: 'MoodSphere' })),
};

const mediaIndexCache = new Map();
let displayTracks = [];

function stripExt(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return name;
  return name.slice(0, dot);
}

function prettifyFileTitle(filename) {
  return stripExt(filename)
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadMediaIndex(genre) {
  if (mediaIndexCache.has(genre)) return mediaIndexCache.get(genre);
  try {
    const idx = await apiGet(`/api/media-index/${genre}`);
    mediaIndexCache.set(genre, idx);
    return idx;
  } catch {
    const idx = { genre, audioFiles: [], coverFiles: [] };
    mediaIndexCache.set(genre, idx);
    return idx;
  }
}

function buildCoverMap(genre, coverFiles) {
  const map = new Map();
  for (const f of coverFiles || []) {
    map.set(stripExt(f), `/audio/${genre}/covers/${encodeURIComponent(f)}`);
  }
  return map;
}

function getDisplayTrackListForGenre(genre) {
  const baseList = TRACKS[genre] || [];
  const mediaIdx = mediaIndexCache.get(genre) || { audioFiles: [], coverFiles: [] };
  const coverMap = buildCoverMap(genre, mediaIdx.coverFiles);

  const moodQuery = genre === 'romantic'
    ? 'romantic,music'
    : genre === 'energetic'
      ? 'concert,headphones'
      : genre === 'calm'
        ? 'lofi,desk'
        : 'rain,piano';

  return baseList.map((t, i) => {
    const file = mediaIdx.audioFiles?.[i];
    const coverSeed = encodeURIComponent(`${genre}-${String(i + 1).padStart(2, '0')}`);
    const fallbackCoverUrl = `https://source.unsplash.com/400x250/?${moodQuery}&sig=${coverSeed}`;
    if (!file) return { ...t, displayTitle: t.title, displayArtist: t.artist, coverUrl: fallbackCoverUrl };
    const title = prettifyFileTitle(file);
    const coverUrl = coverMap.get(stripExt(file)) || fallbackCoverUrl;
    return { ...t, displayTitle: title, displayArtist: 'Local audio', coverUrl };
  });
}

const genreList = document.getElementById('genreList');
const trackGrid = document.getElementById('trackGrid');
const mainTitle = document.getElementById('mainTitle');
const whoami = document.getElementById('whoami');
const logoutBtn = document.getElementById('logoutBtn');

const openRecsLink = document.getElementById('openRecsLink');
const recsOverlay = document.getElementById('recsOverlay');
const recsOverlayBackdrop = document.getElementById('recsOverlayBackdrop');
const closeRecsBtn = document.getElementById('closeRecsBtn');
const recsFrame = document.getElementById('recsFrame');

const openPrivacyLink = document.getElementById('openPrivacyLink');
const privacyOverlay = document.getElementById('privacyOverlay');
const privacyOverlayBackdrop = document.getElementById('privacyOverlayBackdrop');
const closePrivacyBtn = document.getElementById('closePrivacyBtn');
const privacyFrame = document.getElementById('privacyFrame');

const queueList = document.getElementById('queueList');
const savePlaylistBtn = document.getElementById('savePlaylistBtn');
const clearPlaylistBtn = document.getElementById('clearPlaylistBtn');
const playlistMsg = document.getElementById('playlistMsg');

const nowCoverImg = document.getElementById('nowCoverImg');
const nowCoverSource = document.getElementById('nowCoverSource');

const nowPlaying = document.getElementById('nowPlaying');
const nowMeta = document.getElementById('nowMeta');
const moodChip = document.getElementById('moodChip');

const seek = document.getElementById('seek');
const tLeft = document.getElementById('tLeft');
const tRight = document.getElementById('tRight');

const replayBtn = document.getElementById('replayBtn');
const playToggleBtn = document.getElementById('playToggleBtn');
const skipBtn = document.getElementById('skipBtn');

const tracker = new ActivityTracker();
tracker.start();

function flushTrackingOnHide() {
  tracker.flushBeacon();
}

window.addEventListener('pagehide', flushTrackingOnHide);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushTrackingOnHide();
});

let user = null;
let activeGenre = 'romantic';
let currentTrack = null;
let isPlaying = false;
let trackStartedAt = null;
let segmentStartedAt = null;
let progressMs = 0;
let progressTimer = null;
let trackLengthMs = 30000;
let playTimeReporter = null;

let audioCtx = null;
let osc = null;
let gain = null;
let audioEl = null;
let usingRealAudio = false;

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  osc = audioCtx.createOscillator();
  gain = audioCtx.createGain();
  gain.gain.value = 0.00001;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 220;
  osc.start();
}

function stopAudio() {
  if (!audioCtx) return;
  try {
    gain.gain.value = 0;
  } catch {
  }
}

function startAudio() {
  ensureAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  gain.gain.value = 0.00001;
}

function ensureHtmlAudio() {
  if (audioEl) return;
  audioEl = new Audio();
  audioEl.preload = 'metadata';
  audioEl.addEventListener('loadedmetadata', () => {
    if (!Number.isFinite(audioEl.duration) || audioEl.duration <= 0) return;
    trackLengthMs = Math.max(5000, Math.floor(audioEl.duration * 1000));
    seek.max = String(trackLengthMs);
    tRight.textContent = fmtMs(trackLengthMs);
  });
  audioEl.addEventListener('timeupdate', () => {
    if (!usingRealAudio) return;
    progressMs = Math.floor(audioEl.currentTime * 1000);
    seek.value = String(Math.min(trackLengthMs, progressMs));
    tLeft.textContent = fmtMs(progressMs);
  });
  audioEl.addEventListener('ended', () => {
    if (!usingRealAudio) return;
    finalizePlaySegment('pause');
    usingRealAudio = false;
  });
}

function audioPathFor(track) {
  return `/media/${activeGenre}/${track.id}`;
}

function playWithRealAudio(track) {
  ensureHtmlAudio();
  usingRealAudio = true;
  audioEl.src = audioPathFor(track);
  audioEl.currentTime = Math.max(0, Math.min(trackLengthMs / 1000, progressMs / 1000));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audioEl.removeEventListener('error', onErr);
    };

    const onErr = () => {
      cleanup();
      usingRealAudio = false;
      reject(new Error('audio_load_failed'));
    };

    audioEl.addEventListener('error', onErr);
    audioEl
      .play()
      .then(() => {
        cleanup();
        resolve();
      })
      .catch((e) => {
        cleanup();
        usingRealAudio = false;
        reject(e);
      });
  });
}

function emit(event_type, genre, item_id, duration_ms) {
  tracker.emit({
    event_type,
    genre,
    item_id,
    timestamp: new Date().toISOString(),
    duration_ms: duration_ms || 0,
  });
}

function setActiveGenre(g) {
  activeGenre = g;
  mainTitle.textContent = GENRES.find((x) => x.key === g)?.label || g;
  renderGenres();
  loadMediaIndex(activeGenre).then(() => renderTracks());
  emit('click_genre', activeGenre, undefined, 0);
}

function openRecommendationsOverlay() {
  if (!recsOverlay || !recsFrame) return;
  recsOverlay.classList.add('open');
  recsOverlay.setAttribute('aria-hidden', 'false');
  if (!recsFrame.src) {
    recsFrame.src = '/recommendations.html?embed=1';
  }
  if (closeRecsBtn) closeRecsBtn.focus();
}

function closeRecommendationsOverlay() {
  if (!recsOverlay) return;
  recsOverlay.classList.remove('open');
  recsOverlay.setAttribute('aria-hidden', 'true');
}

function openPrivacyOverlay() {
  if (!privacyOverlay || !privacyFrame) return;
  privacyOverlay.classList.add('open');
  privacyOverlay.setAttribute('aria-hidden', 'false');
  if (!privacyFrame.src) {
    privacyFrame.src = '/privacy.html';
  }
  if (closePrivacyBtn) closePrivacyBtn.focus();
}

function closePrivacyOverlay() {
  if (!privacyOverlay) return;
  privacyOverlay.classList.remove('open');
  privacyOverlay.setAttribute('aria-hidden', 'true');
}

if (openRecsLink) {
  openRecsLink.addEventListener('click', (e) => {
    e.preventDefault();
    openRecommendationsOverlay();
  });
}

if (openPrivacyLink) {
  openPrivacyLink.addEventListener('click', (e) => {
    e.preventDefault();
    openPrivacyOverlay();
  });
}

if (recsOverlayBackdrop) {
  recsOverlayBackdrop.addEventListener('click', closeRecommendationsOverlay);
}

if (privacyOverlayBackdrop) {
  privacyOverlayBackdrop.addEventListener('click', closePrivacyOverlay);
}

if (closeRecsBtn) {
  closeRecsBtn.addEventListener('click', closeRecommendationsOverlay);
}

if (closePrivacyBtn) {
  closePrivacyBtn.addEventListener('click', closePrivacyOverlay);
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (recsOverlay && recsOverlay.classList.contains('open')) closeRecommendationsOverlay();
  if (privacyOverlay && privacyOverlay.classList.contains('open')) closePrivacyOverlay();
});

window.addEventListener('message', (ev) => {
  if (ev.origin !== location.origin) return;
  const data = ev.data || {};
  if (data.type === 'set_genre' && typeof data.genre === 'string') {
    if (GENRES.some((g) => g.key === data.genre)) {
      setActiveGenre(data.genre);
      closeRecommendationsOverlay();
    }
  }
});

function renderGenres() {
  genreList.innerHTML = '';
  for (const g of GENRES) {
    const btn = document.createElement('button');
    btn.className = 'genreTab' + (g.key === activeGenre ? ' active' : '');
    btn.type = 'button';
    btn.textContent = g.label;
    btn.addEventListener('click', () => setActiveGenre(g.key));
    genreList.appendChild(btn);
  }
}

function estimateDurationLabel(i) {
  const base = 180 + ((i * 29) % 160);
  const m = Math.floor(base / 60);
  const s = base % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderQueue() {
  if (!queueList) return;
  queueList.innerHTML = '';
  for (let i = 0; i < displayTracks.length; i++) {
    const t = displayTracks[i];
    const row = document.createElement('div');
    row.className = 'queueItem' + (currentTrack && currentTrack.id === t.id ? ' queueActive' : '');
    row.tabIndex = 0;
    const safeCover = t.coverUrl || '/assets/recs/placeholder.svg';
    row.innerHTML = `
      <div class="queueThumb">
        <img src="${safeCover}" alt="" onerror="this.onerror=null;this.src='/assets/recs/placeholder.svg'" />
      </div>
      <div>
        <p class="queueTitle">${t.displayTitle || t.title}</p>
        <p class="queueSub">${t.displayArtist || t.artist}</p>
      </div>
      <div class="queueDur">${estimateDurationLabel(i)}</div>
    `;
    row.addEventListener('click', () => {
      emit('view_item', activeGenre, t.id, 0);
      selectTrack(t);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      emit('view_item', activeGenre, t.id, 0);
      selectTrack(t);
    });
    queueList.appendChild(row);
  }
}

function renderTracks() {
  trackGrid.innerHTML = '';
  displayTracks = getDisplayTrackListForGenre(activeGenre);

  for (const t of displayTracks) {
    const card = document.createElement('div');
    card.className = 'trackCard';
    card.tabIndex = 0;
    const safeCover = t.coverUrl || '/assets/recs/placeholder.svg';
    const thumb = `
      <div class="thumb">
        <img class="thumbImg" src="${safeCover}" alt="" onerror="this.onerror=null;this.src='/assets/recs/placeholder.svg'" />
      </div>
    `;
    const sourceHref = typeof safeCover === 'string' ? safeCover : '';
    const sourceHtml = sourceHref
      ? `<a class="trackSource" href="${sourceHref}" target="_blank" rel="noreferrer">Image source</a>`
      : '';
    card.innerHTML = `${thumb}<div class="trackMeta"><p class="trackTitle">${t.displayTitle}</p><p class="trackArtist">${t.displayArtist}</p>${sourceHtml}</div>`;
    card.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('a.trackSource')) return;
      emit('view_item', activeGenre, t.id, 0);
      selectTrack(t);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      emit('view_item', activeGenre, t.id, 0);
      selectTrack(t);
    });
    trackGrid.appendChild(card);
  }

  renderQueue();
}

function selectTrack(t) {
  finalizePlaySegment('pause');
  currentTrack = t;
  progressMs = 0;
  seek.value = '0';
  seek.max = String(trackLengthMs);
  nowPlaying.textContent = t.displayTitle || t.title;
  nowMeta.textContent = `${activeGenre} • ${t.displayArtist || t.artist}`;

  const safeCover = t.coverUrl || '/assets/recs/placeholder.svg';
  if (nowCoverImg) nowCoverImg.src = safeCover;
  if (nowCoverSource) nowCoverSource.href = typeof safeCover === 'string' ? safeCover : '/assets/recs/placeholder.svg';

  if (audioEl) {
    try {
      audioEl.pause();
    } catch {
    }
    usingRealAudio = false;
  }

  renderQueue();
}

function tickProgress() {
  if (usingRealAudio && audioEl) return;
  progressMs = Math.min(trackLengthMs, progressMs + 250);
  seek.value = String(progressMs);
  tLeft.textContent = fmtMs(progressMs);
  if (progressMs >= trackLengthMs) {
    finalizePlaySegment('pause');
    isPlaying = false;
    stopAudio();
    clearInterval(progressTimer);
    progressTimer = null;
    updatePlayToggleUi();
  }
}

function play() {
  if (!currentTrack) {
    if (displayTracks[0]) selectTrack(displayTracks[0]);
  }
  if (!currentTrack) return;

  if (isPlaying) return;
  isPlaying = true;
  trackStartedAt = Date.now();
  segmentStartedAt = Date.now();
  stopAudio();
  usingRealAudio = false;

  playWithRealAudio(currentTrack).catch(() => {
    usingRealAudio = false;
    startAudio();
  });
  emit('play', activeGenre, currentTrack.id, 0);

  if (!progressTimer) {
    progressTimer = setInterval(tickProgress, 250);
  }

  if (!playTimeReporter) {
    playTimeReporter = setInterval(() => {
      if (!isPlaying || !currentTrack || !segmentStartedAt) return;
      const elapsed = Math.max(0, Date.now() - segmentStartedAt);
      if (elapsed <= 0) return;
      emit('play_time', activeGenre, currentTrack.id, elapsed);
      segmentStartedAt = Date.now();
    }, 4000);
  }

  updatePlayToggleUi();
}

function finalizePlaySegment(eventType) {
  if (!currentTrack) return;
  if (!isPlaying) return;
  const elapsed = Math.max(0, Date.now() - (segmentStartedAt || Date.now()));
  emit(eventType, activeGenre, currentTrack.id, elapsed);
  isPlaying = false;
  trackStartedAt = null;
  segmentStartedAt = null;
}

function pause() {
  if (!currentTrack) return;
  finalizePlaySegment('pause');
  
  // Stop the progress timer when pausing
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  
  if (usingRealAudio && audioEl) {
    try {
      audioEl.pause();
    } catch {
    }
    usingRealAudio = false;
  } else {
    stopAudio();
  }
  updatePlayToggleUi();
}

function skip() {
  if (!currentTrack) return;
  finalizePlaySegment('skip');
  if (usingRealAudio && audioEl) {
    try {
      audioEl.pause();
    } catch {
    }
    usingRealAudio = false;
  } else {
    stopAudio();
  }
  const idx = displayTracks.findIndex((x) => x.id === currentTrack.id);
  const next = displayTracks[(idx + 1) % displayTracks.length];
  selectTrack(next);
  play();
}

function replay() {
  if (!currentTrack) return;
  finalizePlaySegment('replay');
  progressMs = 0;
  seek.value = '0';
  tLeft.textContent = fmtMs(0);
  if (usingRealAudio && audioEl) {
    try {
      audioEl.currentTime = 0;
    } catch {
    }
  }
  play();
}

seek.addEventListener('input', () => {
  const next = Number(seek.value);
  const delta = Math.abs(next - progressMs);
  progressMs = next;
  tLeft.textContent = fmtMs(progressMs);
  if (usingRealAudio && audioEl) {
    try {
      audioEl.currentTime = Math.max(0, Math.min(trackLengthMs / 1000, progressMs / 1000));
    } catch {
    }
  }
  if (currentTrack) emit('seek', activeGenre, currentTrack.id, delta);
});

if (playToggleBtn) {
  playToggleBtn.addEventListener('click', () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  });
}

skipBtn.addEventListener('click', skip);
replayBtn.addEventListener('click', replay);

logoutBtn.addEventListener('click', async () => {
  try {
    await apiPost('/api/auth/logout', {});
  } catch {
  }
  location.replace('/auth.html');
});

async function loadUser() {
  user = await apiGet('/api/auth/me');
  whoami.textContent = `Signed in: ${user.username}`;
}

async function pollMood() {
  try {
    const m = await apiGet('/api/mood');
    const dom = dominantMoodName(m.mood);
    moodChip.textContent = `Mood: ${dom}`;
  } catch {
  }
}

async function init() {
  try {
    await loadUser();
  } catch {
    location.replace('/auth.html');
    return;
  }

  const params = new URLSearchParams(location.search);
  const desiredGenre = params.get('genre');
  if (desiredGenre && GENRES.some((g) => g.key === desiredGenre)) {
    activeGenre = desiredGenre;
    mainTitle.textContent = GENRES.find((x) => x.key === activeGenre)?.label || activeGenre;
  }

  renderGenres();
  await loadMediaIndex(activeGenre);
  renderTracks();

  if (displayTracks[0]) selectTrack(displayTracks[0]);

  tLeft.textContent = fmtMs(0);
  tRight.textContent = fmtMs(trackLengthMs);
  seek.max = String(trackLengthMs);

  pollMood();
  const moodTimer = setInterval(pollMood, 2500);

  window.addEventListener('beforeunload', () => {
    clearInterval(moodTimer);
    if (progressTimer) clearInterval(progressTimer);
    if (playTimeReporter) clearInterval(playTimeReporter);
    flushTrackingOnHide();
  });
}

init();

function updatePlayToggleUi() {
  if (!playToggleBtn) return;
  if (isPlaying) {
    playToggleBtn.textContent = '⏸';
    playToggleBtn.setAttribute('aria-label', 'Pause');
  } else {
    playToggleBtn.textContent = '▶';
    playToggleBtn.setAttribute('aria-label', 'Play');
  }
}

function showPlaylistMessage(msg, isError) {
  if (!playlistMsg) return;
  if (!msg) {
    playlistMsg.style.display = 'none';
    playlistMsg.textContent = '';
    return;
  }
  playlistMsg.style.display = 'block';
  playlistMsg.textContent = msg;
  playlistMsg.classList.toggle('noticeError', !!isError);
}

if (savePlaylistBtn) {
  savePlaylistBtn.addEventListener('click', async () => {
    if (!displayTracks.length) {
      showPlaylistMessage('No items in queue to save.', true);
      return;
    }
    showPlaylistMessage('Saving playlist...', false);
    savePlaylistBtn.disabled = true;
    try {
      const item_ids = displayTracks.map((t) => t.id);
      await apiPost('/api/playlist/save', { item_ids });
      showPlaylistMessage('Playlist saved successfully.', false);
    } catch (e) {
      showPlaylistMessage('Failed to save playlist.', true);
    } finally {
      savePlaylistBtn.disabled = false;
    }
  });
}

if (clearPlaylistBtn) {
  clearPlaylistBtn.addEventListener('click', async () => {
    showPlaylistMessage('Clearing playlist...', false);
    clearPlaylistBtn.disabled = true;
    try {
      await apiPost('/api/playlist/clear', {});
      showPlaylistMessage('Playlist cleared.', false);
    } catch (e) {
      showPlaylistMessage('Failed to clear playlist.', true);
    } finally {
      clearPlaylistBtn.disabled = false;
    }
  });
}
