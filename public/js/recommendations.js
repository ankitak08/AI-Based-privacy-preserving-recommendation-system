import { apiGet, apiPost } from '/js/api.js';
import { renderMoodBars } from '/js/ui.js';

const logoutBtn = document.getElementById('logoutBtn');
const moodPanel = document.getElementById('moodPanel');
const secMusic = document.getElementById('secMusic');
const secMovies = document.getElementById('secMovies');
const secShop = document.getElementById('secShop');
const explain = document.getElementById('explain');
const dominantChip = document.getElementById('dominantChip');
const nowPlayingChip = document.getElementById('nowPlayingChip');

const moviesCoverIcon = document.getElementById('moviesCoverIcon');
const shoppingCoverIcon = document.getElementById('shoppingCoverIcon');

const params = new URLSearchParams(location.search);
const isEmbed = params.get('embed') === '1';
const topNav = document.getElementById('topNav');

if (isEmbed && topNav) {
  topNav.style.display = 'none';
}

const pinnedByDomain = {
  movies: '',
  shopping: '',
};

const pinnedCoverByDomain = {
  movies: '',
  shopping: '',
};

const lastItemsByDomain = {
  music: [],
  movies: [],
  shopping: [],
};

function reorderPinned(items, pinnedId) {
  const list = Array.isArray(items) ? items : [];
  if (!pinnedId) return list;
  const idx = list.findIndex((x) => x && x.id === pinnedId);
  if (idx < 0) return list;
  const pinned = list[idx];
  return [pinned, ...list.slice(0, idx), ...list.slice(idx + 1)];
}

function setCoverForDomain(domain, src) {
  if (!src) return;
  if (domain === 'movies' && moviesCoverIcon) moviesCoverIcon.src = src;
  if (domain === 'shopping' && shoppingCoverIcon) shoppingCoverIcon.src = src;
  pinnedCoverByDomain[domain] = src;
}

if (!isEmbed && logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await apiPost('/api/auth/logout', {});
    } catch {
    }
    location.replace('/auth.html');
  });
}

function renderSection(container, items, domain) {
  container.innerHTML = '';
  for (const it of items || []) {
    const card = document.createElement('div');
    card.className = 'item recCard';
    card.tabIndex = 0;

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'recThumb';

    const img = document.createElement('img');
    const placeholder = '/assets/recs/placeholder.svg';
    const imageUrl = typeof it.image_url === 'string' ? it.image_url : '';
    img.src = imageUrl || placeholder;
    img.alt = '';
    img.addEventListener('error', () => {
      if (!img.src.endsWith('/assets/recs/placeholder.svg')) {
        img.src = '/assets/recs/placeholder.svg';
      }
    });
    thumbWrap.appendChild(img);

    if (!imageUrl) {
      const na = document.createElement('div');
      na.className = 'recNoImage';
      na.textContent = 'Image not available';
      thumbWrap.appendChild(na);
    }

    const body = document.createElement('div');
    body.className = 'recBody';
    const sourceA = document.createElement('a');
    sourceA.className = 'recSource';
    sourceA.target = '_blank';
    sourceA.rel = 'noreferrer';
    sourceA.textContent = 'Image source';
    sourceA.style.display = 'none';

    const setSource = (href) => {
      if (!href) {
        sourceA.style.display = 'none';
        sourceA.href = '#';
        return;
      }
      sourceA.href = href;
      sourceA.style.display = 'inline-block';
    };

    const initialSource = typeof it.image_url === 'string' && it.image_url.startsWith('http') ? it.image_url : '';
    setSource(initialSource);

    body.innerHTML = `
      <div class=\"small\">${it.mood_tag}</div>
      <p class=\"itemTitle\">${it.title}</p>
      <p class=\"itemDesc\">${it.short_desc}</p>
    `;

    body.appendChild(sourceA);

    const openTarget = () => {
      const href = it.redirect_url || '';
      if (!href || href === '#') return;

      if (isEmbed) {
        const match = href.match(/\/dashboard\.html\?genre=([^&]+)/);
        if (match && match[1]) {
          const genre = decodeURIComponent(match[1]);
          window.parent.postMessage({ type: 'set_genre', genre }, location.origin);
          return;
        }
      }

      if (href.startsWith('http')) window.open(href, '_blank', 'noreferrer');
      else location.assign(href);
    };

    card.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('a.recSource')) return;

      if (domain === 'movies' || domain === 'shopping') {
        pinnedByDomain[domain] = it.id;
        const coverSrc = img.getAttribute('src') || '';
        if (coverSrc && coverSrc !== placeholder) setCoverForDomain(domain, coverSrc);

        const nextItems = reorderPinned(lastItemsByDomain[domain], pinnedByDomain[domain]);
        renderSection(container, nextItems, domain);
      }

      openTarget();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openTarget();
    });

    card.appendChild(thumbWrap);
    card.appendChild(body);
    container.appendChild(card);
  }
}

let refreshTimer = null;
let inFlight = false;

async function refresh() {
  if (inFlight) return;
  inFlight = true;
  try {
    const rec = await apiGet('/api/recommendations');
    renderMoodBars(moodPanel, rec.mood);
    dominantChip.textContent = `Dominant: ${rec.dominant_moods.join(' + ')}`;

    const nowGenre = typeof rec?.now_playing?.genre === 'string' ? rec.now_playing.genre : '';
    if (nowPlayingChip) nowPlayingChip.textContent = `Now playing: ${nowGenre || '—'}`;

    const music = rec.sections.find((s) => s.domain === 'music');
    const movies = rec.sections.find((s) => s.domain === 'movies');
    const shop = rec.sections.find((s) => s.domain === 'shopping');

    lastItemsByDomain.music = Array.isArray(music?.items) ? music.items : [];
    lastItemsByDomain.movies = Array.isArray(movies?.items) ? movies.items : [];
    lastItemsByDomain.shopping = Array.isArray(shop?.items) ? shop.items : [];

    const moviesItems = reorderPinned(lastItemsByDomain.movies, pinnedByDomain.movies);
    const shopItems = reorderPinned(lastItemsByDomain.shopping, pinnedByDomain.shopping);

    renderSection(secMusic, lastItemsByDomain.music, 'music');
    renderSection(secMovies, moviesItems, 'movies');
    renderSection(secShop, shopItems, 'shopping');

    if (pinnedCoverByDomain.movies) setCoverForDomain('movies', pinnedCoverByDomain.movies);
    if (pinnedCoverByDomain.shopping) setCoverForDomain('shopping', pinnedCoverByDomain.shopping);

    explain.textContent = rec.explain?.rule || '';
  } finally {
    inFlight = false;
  }
}

async function init() {
  try {
    await apiGet('/api/auth/me');
  } catch {
    location.replace('/auth.html');
    return;
  }

  await refresh();

  refreshTimer = setInterval(refresh, 7000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}

init();
