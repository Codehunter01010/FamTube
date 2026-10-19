// Thin wrapper around the YouTube Data API v3.
// `fetchImpl` is injectable so tests can run without the network.
const API = 'https://www.googleapis.com/youtube/v3';

// A known public channel (Google for Developers) used only to test the key.
const PROBE_CHANNEL = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';

// Videos shorter than this are treated as Shorts and never shown.
const MIN_SECONDS = 180;

// How many of a channel's most recent uploads to keep (50 per API page).
const MAX_PAGES = 4;

async function validateApiKey(key, fetchImpl = fetch) {
  key = (key || '').trim();
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(key)) {
    return { ok: false, message: "That doesn't look like an API key. It usually starts with \"AIza\" and is about 39 characters long." };
  }
  let res;
  try {
    res = await fetchImpl(`${API}/channels?part=id&id=${PROBE_CHANNEL}&key=${encodeURIComponent(key)}`);
  } catch {
    return { ok: false, message: 'Could not reach YouTube. Check the internet connection and try again.' };
  }
  if (res.ok) return { ok: true, key };
  const reason = await errorReason(res);
  return { ok: false, message: friendlyError(reason) };
}

async function errorReason(res) {
  try {
    const body = await res.json();
    return body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  } catch {
    return '';
  }
}

function friendlyError(reason) {
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
    return 'The key works, but "YouTube Data API v3" is not turned on yet. Open the YouTube API page, press Enable, wait a minute, and try again.';
  }
  if (reason === 'quotaExceeded') return "The key has used today's free limit. Try again tomorrow.";
  return 'Google did not accept this key. Copy it again from the Credentials page and paste it here.';
}

class ApiError extends Error {}

async function get(path, params, key, fetchImpl) {
  const qs = new URLSearchParams({ ...params, key });
  let res;
  try {
    res = await fetchImpl(`${API}/${path}?${qs}`);
  } catch {
    throw new ApiError('Could not reach YouTube. Check the internet connection.');
  }
  if (!res.ok) throw new ApiError(friendlyError(await errorReason(res)));
  return res.json();
}

// Accepts a channel URL, an @handle, or a channel ID and returns what kind it is.
function parseChannelInput(input) {
  const s = (input || '').trim();
  let m = s.match(/(?:^|\/channel\/)(UC[A-Za-z0-9_-]{22})(?:[/?#]|$)/);
  if (m) return { id: m[1] };
  m = s.match(/(?:^|youtube\.com\/)(@[A-Za-z0-9._-]{3,100})(?:[/?#]|$)/);
  if (m) return { handle: m[1] };
  return null;
}

function bestThumb(thumbnails = {}) {
  const t = thumbnails.maxres || thumbnails.standard || thumbnails.high || thumbnails.medium || thumbnails.default;
  return t ? t.url : '';
}

function toChannel(item) {
  return {
    id: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl || '',
    thumb: item.snippet.thumbnails?.default?.url || '',
    uploads: item.contentDetails?.relatedPlaylists?.uploads || 'UU' + item.id.slice(2),
    subscribers: Number(item.statistics?.subscriberCount || 0),
  };
}

async function getChannel(input, key, fetchImpl = fetch) {
  const parsed = parseChannelInput(input);
  if (!parsed) return null;
  const params = { part: 'snippet,contentDetails,statistics' };
  if (parsed.id) params.id = parsed.id;
  else params.forHandle = parsed.handle;
  const data = await get('channels', params, key, fetchImpl);
  return data.items?.length ? toChannel(data.items[0]) : null;
}

// Finds channels by name, for the parent area. Costs 100 quota units per call,
// so it's only used when the parent types a name instead of a link.
async function searchChannels(query, key, fetchImpl = fetch) {
  const data = await get('search', { part: 'snippet', type: 'channel', q: query, maxResults: '8' }, key, fetchImpl);
  const ids = (data.items || []).map((i) => i.snippet.channelId).filter(Boolean);
  if (!ids.length) return [];
  const full = await get('channels', { part: 'snippet,contentDetails,statistics', id: ids.join(',') }, key, fetchImpl);
  const byId = new Map((full.items || []).map((i) => [i.id, toChannel(i)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// "PT1H2M3S" -> 3723
function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x || 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

function isShort(v) {
  return v.duration < MIN_SECONDS || /#shorts?\b/i.test(v.title + ' ' + v.description);
}

// Fetches a channel's recent uploads, with Shorts and live streams removed.
async function getChannelVideos(channel, key, fetchImpl = fetch) {
  const ids = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = { part: 'contentDetails', playlistId: channel.uploads, maxResults: '50' };
    if (pageToken) params.pageToken = pageToken;
    const data = await get('playlistItems', params, key, fetchImpl);
    for (const item of data.items || []) ids.push(item.contentDetails.videoId);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await get('videos', { part: 'snippet,contentDetails,statistics,status', id: ids.slice(i, i + 50).join(',') }, key, fetchImpl);
    for (const item of data.items || []) {
      const s = item.snippet;
      // Only videos that belong to this channel, are public, embeddable and finished.
      if (s.channelId !== channel.id) continue;
      if (item.status?.privacyStatus !== 'public' || item.status?.embeddable === false) continue;
      if (s.liveBroadcastContent && s.liveBroadcastContent !== 'none') continue;
      const v = {
        id: item.id,
        channelId: s.channelId,
        title: s.title,
        description: (s.description || '').slice(0, 1500),
        thumb: bestThumb(s.thumbnails),
        duration: parseDuration(item.contentDetails.duration),
        views: Number(item.statistics?.viewCount || 0),
        publishedAt: s.publishedAt,
      };
      if (!isShort(v)) videos.push(v);
    }
  }
  return videos;
}

module.exports = {
  API,
  ApiError,
  validateApiKey,
  parseChannelInput,
  parseDuration,
  isShort,
  getChannel,
  searchChannels,
  getChannelVideos,
};
