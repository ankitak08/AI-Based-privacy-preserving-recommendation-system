/**
 * Federated Learning Client
 * Wraps the existing mood inference model and performs local training on client data.
 * No raw data leaves the client; only weight updates are sent.
 */

const fs = require('fs');
const path = require('path');

// Helper to clone simple weight objects
function cloneWeights(w) {
  return JSON.parse(JSON.stringify(w));
}

// Simple linear regression-like model matching the existing heuristic scoring
// This mirrors computeMoodVector logic but in a trainable form
class LocalMoodModel {
  constructor() {
    // Initialize weights to match the existing heuristic weights
    this.weights = {
      play_time_genre: 0.5,
      clicks_genre: 0.2,
      replays_count: 0.15,
      skips_negative_weight: -0.1,
      consecutive_same_genre_sessions: 0.05,
    };
    // Learning rate for local SGD
    this.lr = 0.01;
  }

  // Forward pass: compute mood scores given aggregated features
  forward(features) {
    const scores = {};
    const genres = ['romantic', 'energetic', 'calm', 'sad'];
    for (const g of genres) {
      scores[g] =
        this.weights.play_time_genre * features.playTime[g] +
        this.weights.clicks_genre * features.clicks[g] +
        this.weights.replays_count * features.replays[g] +
        this.weights.skips_negative_weight * features.skips[g] +
        this.weights.consecutive_same_genre_sessions * features.sessionBoost[g];
    }
    // Apply softmax (same as original)
    const max = Math.max(...Object.values(scores));
    const exp = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.exp(v - max)]));
    const sum = Object.values(exp).reduce((a, b) => a + b, 0) || 1;
    const probs = Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, v / sum]));
    return probs;
  }

  // Simple SGD step to minimize MSE between predicted mood and observed distribution
  localUpdate(features, targetMood) {
    // Simple heuristic target: increase weight of the dominant genre in targetMood
    const dominant = Object.keys(targetMood).reduce((a, b) => (targetMood[a] > targetMood[b] ? a : b));
    // Compute a tiny gradient: if dominant genre is high, increase its contributing weights slightly
    const grad = {
      play_time_genre: this.lr * (features.playTime[dominant] - 0.25) * 0.001,
      clicks_genre: this.lr * (features.clicks[dominant] - 0.25) * 0.001,
      replays_count: this.lr * (features.replays[dominant] - 0.25) * 0.001,
      skips_negative_weight: this.lr * (features.skips[dominant] - 0.25) * -0.001,
      consecutive_same_genre_sessions: this.lr * (features.sessionBoost[dominant] - 0.25) * 0.001,
    };
    // Update weights
    for (const k of Object.keys(this.weights)) {
      this.weights[k] += grad[k] || 0;
    }
  }

  getWeights() {
    return cloneWeights(this.weights);
  }

  setWeights(w) {
    this.weights = cloneWeights(w);
  }
}

// Load client data from simulated local datasets
function loadClientData(clientId) {
  const candidates = [
    path.join(__dirname, 'data', `${clientId}.json`),
    path.join(__dirname, 'data', `client_${clientId}.json`),
  ];

  const dataPath = candidates.find((p) => fs.existsSync(p));
  if (!dataPath) return null;
  const raw = fs.readFileSync(dataPath, 'utf8');
  return JSON.parse(raw);
}

// Extract features from client events (same as computeMoodVector expects)
function extractFeatures(events) {
  const playTime = { romantic: 0, energetic: 0, calm: 0, sad: 0 };
  const clicks = { romantic: 0, energetic: 0, calm: 0, sad: 0 };
  const replays = { romantic: 0, energetic: 0, calm: 0, sad: 0 };
  const skips = { romantic: 0, energetic: 0, calm: 0, sad: 0 };
  const sessionBoost = { romantic: 0, energetic: 0, calm: 0, sad: 0 };

  for (const e of events || []) {
    const genre = ['romantic', 'energetic', 'calm', 'sad'].includes(e.genre) ? e.genre : null;
    if (!genre) continue;
    if (['pause', 'skip', 'replay', 'play_time'].includes(e.event_type) && typeof e.duration_ms === 'number' && e.duration_ms > 0) {
      playTime[genre] += e.duration_ms;
    }
    if (e.event_type === 'click_genre') clicks[genre] += 1;
    if (e.event_type === 'replay') replays[genre] += 1;
    if (e.event_type === 'skip') skips[genre] += 1;
  }

  const lastGenreEvents = (events || [])
    .filter((e) => ['romantic', 'energetic', 'calm', 'sad'].includes(e.genre))
    .slice(-4)
    .map((e) => e.genre);
  if (lastGenreEvents.length >= 3) {
    const last3 = lastGenreEvents.slice(-3);
    const same = last3.every((g) => g === last3[0]);
    if (same) sessionBoost[last3[0]] = 1;
  }

  return { playTime, clicks, replays, skips, sessionBoost };
}

// Train locally on client data for one epoch
function trainLocal(clientId, epochs = 1) {
  const model = new LocalMoodModel();
  const data = loadClientData(clientId);
  if (!data || !Array.isArray(data.events) || data.events.length === 0) {
    console.error(`[FederatedClient] No data for client ${clientId}`);
    return null;
  }
  const features = extractFeatures(data.events);
  // Use a simple target: the empirical mood distribution from this client
  const totalPlay = Object.values(features.playTime).reduce((a, b) => a + b, 0);
  const targetMood = {
    romantic: (features.playTime.romantic / totalPlay) || 0.25,
    energetic: (features.playTime.energetic / totalPlay) || 0.25,
    calm: (features.playTime.calm / totalPlay) || 0.25,
    sad: (features.playTime.sad / totalPlay) || 0.25,
  };
  for (let epoch = 0; epoch < epochs; epoch++) {
    model.localUpdate(features, targetMood);
  }
  console.log(`[FederatedClient] Client ${clientId} trained locally for ${epochs} epoch(s)`);
  return model.getWeights();
}

module.exports = { trainLocal };
