# Federated Learning Layer (Isolated)

This folder contains a **standalone federated learning simulation** that treats the existing MoodSphere app as a black box. It **does not modify any original code**. It produces a global model compatible with the existing system.

## How It Works

1. **Client-side local training** (`client.js`)
   - Wraps a simple trainable model mirroring the heuristic weights used in `src/mood.js`.
   - Each client trains **locally** on its own events (no raw data leaves the client).
   - Outputs only weight updates.

2. **Orchestrator (FedAvg)** (`server.js`)
   - Collects weight updates from all simulated clients.
   - Performs element-wise averaging (FedAvg) to produce a **global model**.
   - Saves the global model per round to `global_models/`.

3. **Simulated client datasets** (`data/`)
   - `client_A.json`, `client_B.json`, `client_C.json` mimic realistic user activity.
   - You can add more clients by creating new `client_X.json` files and updating `CLIENT_IDS` in `server.js`.

## Integration with Existing System (Zero-Disruption)

- The existing app (`src/mood.js`) uses hardcoded heuristic weights.
- After federated training, replace those weights with the **final global model**:
  - Open `src/mood.js`
  - Replace the `weights` object inside `computeMoodVector` with the values from `global_models/global_model_round_<N>.json`
  - No other code changes required.

## Running the Federated Training

```bash
# From project root
cd federated_layer
node server.js <rounds> <local_epochs>
```

Example:
```bash
node server.js 5 2
```

This runs:
- 5 federated rounds
- Each client trains locally for 2 epochs per round
- Produces `global_models/global_model_round_1.json` … `global_model_round_5.json`

## Applying the Global Model

After training, pick the final round’s JSON and copy its weight values into `src/mood.js`:

```javascript
// In src/mood.js, replace the weights object:
const weights = {
  play_time_genre: 0.512,
  clicks_genre: 0.198,
  replays_count: 0.147,
  skips_negative_weight: -0.103,
  consecutive_same_genre_sessions: 0.052,
};
```

Restart the server. The app will now use the **federated-learned global weights** while all other inference and APIs remain unchanged.

## Privacy Guarantees

- **No raw data sharing**: clients only send weight vectors.
- **Local training only**: each client updates are computed on-device.
- **FedAvg aggregation**: only weight averages are transmitted.
- **Isolation**: the existing MoodSphere app is untouched; federated learning is a separate orchestration layer.

## Extending

- Add real client data: replace `data/client_X.json` with actual event streams.
- Add more clients: create `client_D.json`, update `CLIENT_IDS` in `server.js`.
- Swap aggregation: replace `federatedAverage` with FedProx, etc., without touching client code.
