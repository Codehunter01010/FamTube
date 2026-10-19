// Thin wrapper around the YouTube Data API v3.
// `fetchImpl` is injectable so tests can run without the network.
const API = 'https://www.googleapis.com/youtube/v3';

// A known public channel (Google for Developers) used only to test the key.
const PROBE_CHANNEL = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';

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

  let reason = '';
  try {
    const body = await res.json();
    reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  } catch { /* ignore */ }

  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
    return { ok: false, message: 'The key works, but "YouTube Data API v3" is not turned on yet. Go back to step 2, press Enable, wait a minute, and try again.' };
  }
  if (reason === 'quotaExceeded') {
    return { ok: false, message: "The key works but has used today's free limit. Try again tomorrow." };
  }
  return { ok: false, message: 'Google did not accept this key. Copy it again from the Credentials page and paste it here.' };
}

module.exports = { validateApiKey, API };
