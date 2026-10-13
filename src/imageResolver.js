const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map();

const coverCache = new Map();

function hashStringToInt(s) {
  const str = typeof s === 'string' ? s : '';
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function listLocalCoverFilesForGenre(genre) {
  const g = typeof genre === 'string' ? genre : '';
  if (!g) return [];
  if (!['romantic', 'energetic', 'calm', 'sad'].includes(g)) return [];

  const key = `covers:${g}`;
  const cached = coverCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.files;

  try {
    const dir = path.join(__dirname, '..', 'public', 'audio', g, 'covers');
    const exts = new Set(['.jpg', '.jpeg', '.png', '.webp']);
    const files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((name) => exts.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    coverCache.set(key, { files, expiresAt: Date.now() + CACHE_TTL_MS });
    return files;
  } catch {
    coverCache.set(key, { files: [], expiresAt: Date.now() + CACHE_TTL_MS });
    return [];
  }
}

function pickLocalCoverForGenre(genre, seed) {
  const files = listLocalCoverFilesForGenre(genre);
  if (!files.length) return '';
  const idx = hashStringToInt(seed) % files.length;
  return `/audio/${genre}/covers/${encodeURIComponent(files[idx])}`;
}

 function isAmazonHostname(hostname) {
   const h = (hostname || '').toLowerCase();
   return h === 'amazon.in' || h.endsWith('.amazon.in') || h === 'amazon.com' || h.endsWith('.amazon.com');
 }

 function looksLikeAmazonBotBlock(html) {
   const t = (html || '').toLowerCase();
   return t.includes('robot check') || t.includes('validatecaptcha') || t.includes('/errors/validatecaptcha');
 }

 function toJinaProxyUrl(urlStr) {
   return `https://r.jina.ai/${urlStr}`;
 }

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function requestText(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch {
      resolve('');
      return;
    }

    const allowProxy = options.allowProxy !== false;
    const isAmazon = isAmazonHostname(url.hostname);

    const req = https.request(
      {
        method: 'GET',
        protocol: url.protocol,
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'User-Agent': 'MoodSphere/1.0 (+local-dev)',
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'identity',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      (res) => {
        const status = res.statusCode || 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          const next = new URL(res.headers.location, urlStr).toString();
          resolve(requestText(next, options));
          res.resume();
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          if (allowProxy && isAmazon) {
            resolve(requestText(toJinaProxyUrl(urlStr), { allowProxy: false }));
            return;
          }
          resolve('');
          return;
        }

        const chunks = [];
        let total = 0;
        let resolved = false;
        res.on('data', (c) => {
          total += c.length;
          if (total > 512 * 1024) {
            if (!resolved) {
              resolved = true;
              const partial = Buffer.concat(chunks).toString('utf8');
              resolve(partial);
            }
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (resolved) return;
          const txt = Buffer.concat(chunks).toString('utf8');
          if (allowProxy && isAmazon && looksLikeAmazonBotBlock(txt)) {
            resolve(requestText(toJinaProxyUrl(urlStr), { allowProxy: false }));
            return;
          }
          resolve(txt);
        });
      }
    );

    req.on('error', reject);
    req.end();
  });
}

async function requestJson(urlStr) {
  const txt = await requestText(urlStr);
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function resolveMovieViaImdbSuggest(title) {
  const q = (title || '').trim();
  if (!q) return { image_url: '', imdb_id: '' };

  const norm = q.toLowerCase();
  const first = (norm.match(/[a-z0-9]/) || ['t'])[0];
  const key = `imdb_suggest:${q}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const url = `https://v2.sg.media-imdb.com/suggestion/${encodeURIComponent(first)}/${encodeURIComponent(q)}.json`;
    const json = await requestJson(url);
    const d = Array.isArray(json?.d) ? json.d : [];
    const best = d.find((x) => x && typeof x.id === 'string' && x.id.startsWith('tt'));
    const imdbID = best && typeof best.id === 'string' ? best.id : '';
    const img = best && best.i && typeof best.i.imageUrl === 'string' ? best.i.imageUrl : '';
    const out = { image_url: img || '', imdb_id: imdbID || '' };
    cacheSet(key, out);
    return out;
  } catch {
    const out = { image_url: '', imdb_id: '' };
    cacheSet(key, out);
    return out;
  }
}

function safeSlice(str, start, len) {
  const s = typeof str === 'string' ? str : '';
  return s.slice(start, start + len);
}

function extractOgImage(html) {
  if (!html) return '';

  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']og:image["'][^>]*>/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return '';
}

function decodeHtmlEntitiesLite(s) {
  return (s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&#47;/g, '/');
}

function extractAmazonImageFromProductHtml(html) {
  if (!html) return '';

  const hires = html.match(/data-old-hires=["']([^"']+)["']/i);
  if (hires && hires[1] && hires[1].includes('m.media-amazon.com/images')) return hires[1];

  const dyn = html.match(/data-a-dynamic-image=["']([^"']+)["']/i);
  if (dyn && dyn[1]) {
    const decoded = decodeHtmlEntitiesLite(dyn[1]);
    const urlMatch = decoded.match(/https?:\/\/m\.media-amazon\.com\/images\/I\/[^"\\]+\.(?:jpg|jpeg|png|webp)/i);
    if (urlMatch && urlMatch[0]) return urlMatch[0];

    try {
      const obj = JSON.parse(decoded);
      const keys = obj && typeof obj === 'object' ? Object.keys(obj) : [];
      const first = keys.find((k) => typeof k === 'string' && k.includes('m.media-amazon.com/images/I/'));
      if (first) return first;
    } catch {
    }
  }

  const landing = html.match(/id=["']landingImage["'][^>]+src=["']([^"']+)["']/i);
  if (landing && landing[1] && landing[1].includes('m.media-amazon.com/images')) return landing[1];

  const direct = html.match(/https?:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9%._+-]+\.(?:jpg|jpeg|png|webp)/i);
  if (direct && direct[0]) return direct[0];

  return '';
}

function resolveMaybeRelativeUrl(baseUrl, candidate) {
  const c = (candidate || '').trim();
  if (!c) return '';
  try {
    if (c.startsWith('//')) return new URL(`https:${c}`).toString();
    return new URL(c, baseUrl).toString();
  } catch {
    return '';
  }
}

function isAmazonHost(hostname) {
  return isAmazonHostname(hostname);
}

function extractAmazonAsinFromHtml(html) {
  if (!html) return '';
  const patterns = [
    /\/dp\/([A-Z0-9]{10})/i,
    /data-asin=["']([A-Z0-9]{10})["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return m[1].toUpperCase();
  }
  return '';
}

function extractAmazonImageFromResultHtml(resultHtml) {
  if (!resultHtml) return '';

  const direct = resultHtml.match(/https?:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9%._+-]+\.(?:jpg|jpeg|png|webp)/i);
  if (direct && direct[0]) return direct[0];

  const patterns = [
    /<img[^>]+src=["'](https?:\/\/[^"']+)["'][^>]*>/i,
    /<img[^>]+data-src=["'](https?:\/\/[^"']+)["'][^>]*>/i,
    /<img[^>]+srcset=["']([^"']+)["'][^>]*>/i,
    /data-a-dynamic-image=["']\{&quot;(https?:\/\/[^&]+?)&quot;:/i,
  ];

  for (const re of patterns) {
    const m = resultHtml.match(re);
    if (!m || !m[1]) continue;
    const v = m[1].trim();
    if (!v) continue;
    if (v.includes('m.media-amazon.com/images')) {
      if (v.includes(' ')) return v.split(' ')[0];
      return v;
    }
  }
  return '';
}

function extractAmazonFirstSearchResult(html) {
  if (!html) return { asin: '', image_url: '' };

  const re = /data-asin=["']([A-Z0-9]{10})["']/gi;
  let asinMatch = null;
  let m;
  while ((m = re.exec(html)) !== null) {
    const candidate = (m[1] || '').toUpperCase();
    if (!candidate) continue;
    if (candidate === '0000000000') continue;
    asinMatch = { index: m.index, asin: candidate };
    break;
  }

  const asin = asinMatch && asinMatch.asin ? asinMatch.asin : '';
  if (!asin) return { asin: '', image_url: '' };

  const start = asinMatch.index || 0;
  const windowHtml = safeSlice(html, start, 6000);
  const img = extractAmazonImageFromResultHtml(windowHtml);
  return { asin, image_url: img };
}

async function resolveAmazonProductFromSearch(searchUrl) {
  const key = `amz_search:${searchUrl}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const html = await requestText(searchUrl);
    const first = extractAmazonFirstSearchResult(html);
    const asin = first.asin || extractAmazonAsinFromHtml(html);
    if (!asin) {
      const out = { redirect_url: '', image_url: '' };
      cacheSet(key, out);
      return out;
    }

    const u = new URL(searchUrl);
    const productUrl = new URL(`/dp/${asin}`, `${u.protocol}//${u.host}`).toString();

    let imageUrl = first.image_url || '';
    if (!imageUrl) {
      const og = await resolveOgImage(productUrl);
      imageUrl = og || '';
    }
    if (!imageUrl) {
      const html = await requestText(productUrl);
      imageUrl = extractAmazonImageFromProductHtml(html);
    }

    const out = { redirect_url: productUrl, image_url: imageUrl || '' };
    cacheSet(key, out);
    return out;
  } catch {
    const out = { redirect_url: '', image_url: '' };
    cacheSet(key, out);
    return out;
  }
}

async function resolveOgImage(url) {
  const key = `og:${url}`;
  const cached = cacheGet(key);
  if (cached !== null) return cached;

  try {
    const html = await requestText(url);
    const og = extractOgImage(html);
    const out = resolveMaybeRelativeUrl(url, og);
    cacheSet(key, out);
    return out;
  } catch {
    cacheSet(key, '');
    return '';
  }
}

function isSearchLikeProductUrl(url) {
  if (typeof url !== 'string') return true;
  if (!url.startsWith('http')) return true;

  const lower = url.toLowerCase();
  if (lower.includes('/s?')) return true;
  if (lower.includes('search?')) return true;
  if (lower.includes('find?')) return true;
  if (lower.includes('?k=')) return true;
  return false;
}

async function resolveMoviePosterViaOmdb(title) {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return { image_url: '', imdb_id: '' };

  const q = (title || '').trim();
  if (!q) return { image_url: '', imdb_id: '' };

  const key = `omdb:${q}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&t=${encodeURIComponent(q)}&type=movie`;
    const json = await requestJson(url);
    const poster = json && typeof json.Poster === 'string' && json.Poster !== 'N/A' ? json.Poster : '';
    const imdbID = json && typeof json.imdbID === 'string' ? json.imdbID : '';
    const out = { image_url: poster, imdb_id: imdbID };
    cacheSet(key, out);
    return out;
  } catch {
    const out = { image_url: '', imdb_id: '' };
    cacheSet(key, out);
    return out;
  }
}

async function enrichItem(domain, it) {
  const base = { ...it };

  const redirect_url = typeof it.url === 'string' ? it.url : '';
  base.redirect_url = redirect_url;

  if (domain === 'music') {
    const genre = typeof it.mood_tag === 'string' ? it.mood_tag : '';
    const localCover = genre ? pickLocalCoverForGenre(genre, String(it.id || it.title || '')) : '';
    base.image_url = localCover || (typeof it.thumbnail === 'string' ? it.thumbnail : '');
    return base;
  }

  if (domain === 'movies') {
    const r = await resolveMoviePosterViaOmdb(it.title);
    const r2 = (!r.image_url || !r.imdb_id) ? await resolveMovieViaImdbSuggest(it.title) : { image_url: '', imdb_id: '' };

    base.image_url = r.image_url || r2.image_url || '';

    const imdbId = r.imdb_id || r2.imdb_id || '';
    if (imdbId) {
      base.redirect_url = `https://www.imdb.com/title/${imdbId}/`;
      base.imdb_id = imdbId;
    }

    return base;
  }

  if (domain === 'shopping') {
    if (isSearchLikeProductUrl(base.redirect_url)) {
      try {
        const u = new URL(base.redirect_url);
        if (isAmazonHost(u.hostname)) {
          const r = await resolveAmazonProductFromSearch(base.redirect_url);
          if (r.redirect_url) base.redirect_url = r.redirect_url;
          base.image_url = r.image_url;
          return base;
        }
      } catch {
      }
      base.image_url = '';
      return base;
    }

    let og = await resolveOgImage(base.redirect_url);
    base.image_url = og || '';

    if (!base.image_url) {
      try {
        const u = new URL(base.redirect_url);
        if (isAmazonHost(u.hostname)) {
          const html = await requestText(base.redirect_url);
          base.image_url = extractAmazonImageFromProductHtml(html);
        }
      } catch {
      }
    }

    return base;
  }

  return base;
}

async function enrichRecommendations(payload) {
  const out = { ...payload };
  const sections = Array.isArray(payload?.sections) ? payload.sections : [];

  const enrichedSections = [];
  for (const sec of sections) {
    const domain = sec?.domain;
    const items = Array.isArray(sec?.items) ? sec.items : [];

    const enrichedItems = await Promise.all(items.map((it) => enrichItem(domain, it)));

    enrichedSections.push({ ...sec, items: enrichedItems });
  }

  out.sections = enrichedSections;
  return out;
}

module.exports = { enrichRecommendations };
