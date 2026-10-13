const { CATALOG } = require('./catalog');

const MOODS = ['romantic', 'energetic', 'calm', 'sad'];

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function moodWeights(mood) {
  const weights = {};
  let sum = 0;
  for (const m of MOODS) {
    const w = clamp01(mood?.[m]);
    weights[m] = w;
    sum += w;
  }
  if (sum <= 0) {
    for (const m of MOODS) weights[m] = 1 / MOODS.length;
    return weights;
  }
  for (const m of MOODS) weights[m] = weights[m] / sum;
  return weights;
}

function weightedPickIndex(weights) {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) return -1;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function pickItemsLive(domainCatalog, mood, limit) {
  const weightsByMood = moodWeights(mood);

  const candidates = [];
  for (const m of MOODS) {
    const list = domainCatalog[m] || [];
    const base = weightsByMood[m];
    for (const it of list) {
      // Add more randomness: base weight + random boost
      const randomBoost = Math.random() * 0.3;
      candidates.push({ ...it, mood_tag: m, _w: Math.pow(base, 0.8) + randomBoost });
    }
  }

  // Shuffle candidates first to break deterministic ordering
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  const out = [];
  const used = new Set();

  const target = Math.min(limit, candidates.length);
  for (let k = 0; k < target; k++) {
    const available = candidates.filter((c) => !used.has(c.id));
    if (!available.length) break;
    const idx = weightedPickIndex(available.map((c) => c._w));
    if (idx < 0) break;
    const chosen = available[idx];
    used.add(chosen.id);
    const { _w, ...clean } = chosen;
    out.push(clean);
  }

  // Final shuffle for display order
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }

  return out;
}

function dominantMoods(mood) {
  const pairs = MOODS.map((m) => ({ mood: m, score: typeof mood?.[m] === 'number' ? mood[m] : 0 }));
  pairs.sort((a, b) => b.score - a.score);
  const top = pairs[0];
  const second = pairs[1];

  const out = [top.mood];
  if (second && top.score - second.score < 0.15) out.push(second.mood);
  return out;
}

function pickItems(domainCatalog, moods) {
  // Shuffle catalog order to rotate remaining items over time
  const shuffled = {};
  for (const [mood, list] of Object.entries(domainCatalog)) {
    shuffled[mood] = [...list].sort(() => Math.random() - 0.5);
  }
  const items = [];
  for (const m of moods) {
    const list = shuffled[m] || [];
    for (const it of list) items.push({ ...it, mood_tag: m });
  }
  return items.slice(0, 6);
}

function pickItemsDominantOnly(domainCatalog, mood, limit) {
  const k = typeof limit === 'number' && limit > 0 ? limit : 6;
  // Use the weighted sampler so that over time the user sees more variety,
  // but still biased by the current mood (or focus moods).
  return pickItemsLive(domainCatalog, mood, k);
}

function buildRecommendations(mood, opts = {}) {
  const focus = Array.isArray(opts.focus_moods) ? opts.focus_moods.filter((m) => MOODS.includes(m)) : [];
  const moodForSelection = focus.length ? Object.fromEntries(MOODS.map((m) => [m, focus.includes(m) ? 1 : 0])) : mood;

  const moods = focus.length ? focus : dominantMoods(mood);

  return {
    dominant_moods: moods,
    explain: {
      dominant_moods: moods,
      rule: 'Recommendations are selected from curated lists using dominant mood tags inferred from recent interaction signals.'
    },
    sections: [
      { domain: 'music', items: pickItemsDominantOnly(CATALOG.music, moodForSelection, 6) },
      { domain: 'movies', items: pickItemsDominantOnly(CATALOG.movies, moodForSelection, 6) },
      { domain: 'shopping', items: pickItemsDominantOnly(CATALOG.products, moodForSelection, 6) },
    ],
  };
}

module.exports = { buildRecommendations };
