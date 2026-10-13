const GENRES = ['romantic', 'energetic', 'calm', 'sad'];

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function softmax(scores) {
  const vals = GENRES.map((g) => scores[g] ?? 0);
  const max = Math.max(...vals);
  const exp = GENRES.map((g) => Math.exp((scores[g] ?? 0) - max));
  const sum = exp.reduce((a, b) => a + b, 0) || 1;
  const out = {};
  GENRES.forEach((g, i) => {
    out[g] = exp[i] / sum;
  });
  return out;
}

function normalizedByMax(valuesByGenre) {
  const max = Math.max(...GENRES.map((g) => valuesByGenre[g] ?? 0));
  if (max <= 0) {
    const out = {};
    GENRES.forEach((g) => {
      out[g] = 0;
    });
    return out;
  }
  const out = {};
  GENRES.forEach((g) => {
    out[g] = clamp01((valuesByGenre[g] ?? 0) / max);
  });
  return out;
}

function computeMoodVector(events) {
  const playTime = { romantic: 0, energetic: 0, calm: 0, sad: 0 };
  const clicks = { romantic: 0, energetic: 0, calm: 0, sad: 0 };
  const replays = { romantic: 0, energetic: 0, calm: 0, sad: 0 };
  const skips = { romantic: 0, energetic: 0, calm: 0, sad: 0 };

  for (const e of events || []) {
    const genre = GENRES.includes(e.genre) ? e.genre : null;
    if (!genre) continue;

    if (
      (e.event_type === 'pause' ||
        e.event_type === 'skip' ||
        e.event_type === 'replay' ||
        e.event_type === 'play_time') &&
      typeof e.duration_ms === 'number' &&
      e.duration_ms > 0
    ) {
      playTime[genre] += e.duration_ms;
    }

    if (e.event_type === 'click_genre') clicks[genre] += 1;
    if (e.event_type === 'replay') replays[genre] += 1;
    if (e.event_type === 'skip') skips[genre] += 1;
  }

  const lastGenreEvents = (events || [])
    .filter((e) => GENRES.includes(e.genre))
    .slice(-4)
    .map((e) => e.genre);

  const sessionBoost = { romantic: 0, energetic: 0, calm: 0, sad: 0 };
  if (lastGenreEvents.length >= 3) {
    const last3 = lastGenreEvents.slice(-3);
    const same = last3.every((g) => g === last3[0]);
    if (same) sessionBoost[last3[0]] = 1;
  }

  const nPlay = normalizedByMax(playTime);
  const nClicks = normalizedByMax(clicks);
  const nReplays = normalizedByMax(replays);
  const nSkips = normalizedByMax(skips);

  const weights = {
    play_time_genre: 0.35,
    clicks_genre: 0.25,
    replays_count: 0.1,
    skips_negative_weight: -0.15,
    consecutive_same_genre_sessions: 0.35,
  };

  const scores = {};
  GENRES.forEach((g) => {
    scores[g] =
      weights.play_time_genre * nPlay[g] +
      weights.clicks_genre * nClicks[g] +
      weights.replays_count * nReplays[g] +
      weights.skips_negative_weight * nSkips[g] +
      weights.consecutive_same_genre_sessions * sessionBoost[g];
  });

  return softmax(scores);
}

module.exports = { computeMoodVector };
