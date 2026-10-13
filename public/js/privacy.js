import { apiGet, apiPost } from '/js/api.js';
import { renderMoodBars } from '/js/ui.js';

const logoutBtn = document.getElementById('logoutBtn');
const clearBtn = document.getElementById('clearBtn');
const clearMsg = document.getElementById('clearMsg');
const moodPanel = document.getElementById('moodPanel');

logoutBtn.addEventListener('click', async () => {
  try {
    await apiPost('/api/auth/logout', {});
  } catch {
  }
  location.replace('/auth.html');
});

clearBtn.addEventListener('click', async () => {
  clearMsg.style.display = 'none';
  try {
    await apiPost('/api/clear-profile', {});
    clearMsg.style.display = 'block';
    clearMsg.textContent = 'Cleared session profile for this user.';
    await loadMood();
  } catch (e) {
    clearMsg.style.display = 'block';
    clearMsg.textContent = `Failed: ${e.message}`;
  }
});

async function loadMood() {
  const m = await apiGet('/api/mood');
  renderMoodBars(moodPanel, m.mood);
}

async function init() {
  try {
    await apiGet('/api/auth/me');
  } catch {
    location.replace('/auth.html');
    return;
  }
  await loadMood();
}

init();
