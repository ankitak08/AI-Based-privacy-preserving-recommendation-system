/**
 * Federated Learning Server (Orchestrator)
 * Performs FedAvg aggregation across simulated clients.
 * Produces a global model compatible with the existing black-box system.
 */

const fs = require('fs');
const path = require('path');
const { trainLocal } = require('./client');

// Helper to clone weight objects
function cloneWeights(w) {
  return JSON.parse(JSON.stringify(w));
}

// FedAvg: element-wise average of weight objects
function federatedAverage(weightList) {
  if (!Array.isArray(weightList) || weightList.length === 0) {
    throw new Error('[FederatedServer] No weights to aggregate');
  }
  const keys = Object.keys(weightList[0]);
  const avg = {};
  for (const k of keys) {
    let sum = 0;
    for (const w of weightList) {
      if (typeof w[k] !== 'number') {
        throw new Error(`[FederatedServer] Non-numeric weight for key ${k}`);
      }
      sum += w[k];
    }
    avg[k] = sum / weightList.length;
  }
  return avg;
}

// Save the aggregated global model to a file that the existing system can load
function saveGlobalModel(weights, round) {
  const outDir = path.join(__dirname, 'global_models');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const modelPath = path.join(outDir, `global_model_round_${round}.json`);
  fs.writeFileSync(modelPath, JSON.stringify(weights, null, 2), 'utf8');
  console.log(`[FederatedServer] Saved global model for round ${round} to ${modelPath}`);
  return modelPath;
}

// Simulated client IDs
const CLIENT_IDS = ['client_A', 'client_B', 'client_C'];

// Main orchestration loop
async function runFederatedRounds(rounds = 3, localEpochs = 1) {
  console.log(`[FederatedServer] Starting ${rounds} rounds of federated learning with ${CLIENT_IDS.length} clients`);
  let globalWeights = null;
  for (let round = 1; round <= rounds; round++) {
    console.log(`\n=== Round ${round} ===`);
    // Train each client locally (no data sharing)
    const clientWeights = [];
    for (const clientId of CLIENT_IDS) {
      const w = trainLocal(clientId, localEpochs);
      if (w) clientWeights.push(w);
    }
    if (clientWeights.length === 0) {
      console.error('[FederatedServer] No client weights for this round; skipping aggregation');
      continue;
    }
    // Aggregate via FedAvg
    globalWeights = federatedAverage(clientWeights);
    console.log('[FederatedServer] Aggregated global weights:', globalWeights);
    // Save global model for this round
    saveGlobalModel(globalWeights, round);
    // (Optional) Distribute global weights back to clients for next round
    // In this simulation, we just continue; in a real system, clients would pull the latest global model.
  }
  console.log('\n=== Federated Learning Complete ===');
  console.log(`[FederatedServer] Final global model saved to global_models/ directory`);
  console.log('[FederatedServer] To integrate with the existing system, replace the heuristic weights in src/mood.js with the final global weights.');
  return globalWeights;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const rounds = parseInt(args[0], 10) || 3;
  const epochs = parseInt(args[1], 10) || 1;
  runFederatedRounds(rounds, epochs).catch((err) => {
    console.error('[FederatedServer] Error:', err);
    process.exit(1);
  });
}

module.exports = { runFederatedRounds, federatedAverage, saveGlobalModel };
