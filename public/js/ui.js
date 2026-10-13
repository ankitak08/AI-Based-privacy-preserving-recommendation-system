export function fmtPct(n) {
  const v = Number.isFinite(n) ? n : 0;
  return `${Math.round(v * 100)}%`;
}

export function fmtMs(ms) {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function dominantMoodName(mood) {
  const entries = Object.entries(mood || {});
  entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  return entries[0]?.[0] || '—';
}

export function renderMoodBars(container, mood) {
  const moods = ['romantic', 'energetic', 'calm', 'sad'];
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'moodBars';
  for (const m of moods) {
    const row = document.createElement('div');
    row.className = 'moodRow';

    const label = document.createElement('div');
    label.className = 'small';
    label.textContent = m;

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.style.width = `${Math.round((mood?.[m] || 0) * 100)}%`;
    bar.appendChild(fill);

    const pct = document.createElement('div');
    pct.className = 'small';
    pct.textContent = fmtPct(mood?.[m] || 0);

    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(pct);
    wrap.appendChild(row);
  }
  container.appendChild(wrap);
}
