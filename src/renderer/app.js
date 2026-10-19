const api = window.safetube;
const $ = (id) => document.getElementById(id);

// The player normally runs on YouTube's privacy-enhanced domain. With the
// parent's "YouTube Premium" switch on it uses youtube.com instead, so the
// Premium account signed in to this browser removes the ads.
const PLAYER_HOSTS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];
let playerHost = PLAYER_HOSTS[0];

// ---- Formatting -----------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function compact(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(n < 1e10 ? 1 : 0).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n < 1e7 ? 1 : 0).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return String(n);
}

const views = (n) => `${compact(n)} view${n === 1 ? '' : 's'}`;

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

function duration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const avatarImg = (url, cls = 'chan') => (url ? `<img class="${cls}" src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : `<div class="${cls}"></div>`);

// ---- Cards ----------------------------------------------------------------

function gridCard(v, { showChannel = true } = {}) {
  return `<a class="card" href="#/watch/${esc(v.id)}">
    <div class="thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span class="dur">${duration(v.duration)}</span></div>
    <div class="meta">
      ${showChannel ? `<span class="chan-link" data-channel="${esc(v.channelId)}">${avatarImg(v.channelThumb)}</span>` : ''}
      <div class="lines">
        <h3 class="title">${esc(v.title)}</h3>
        ${showChannel ? `<div class="sub" data-channel="${esc(v.channelId)}">${esc(v.channelTitle)}</div>` : ''}
        <div class="sub">${views(v.views)} • ${ago(v.publishedAt)}</div>
      </div>
    </div>
  </a>`;
}

function listCard(v, cls = 'result') {
  return `<a class="${cls}" href="#/watch/${esc(v.id)}">
    <div class="thumb"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span class="dur">${duration(v.duration)}</span></div>
    <div class="lines">
      <h3 class="title">${esc(v.title)}</h3>
      ${cls === 'result'
        ? `<div class="sub">${views(v.views)} • ${ago(v.publishedAt)}</div>
           <div class="sub chan-row" data-channel="${esc(v.channelId)}">${avatarImg(v.channelThumb, 'chan small')}${esc(v.channelTitle)}</div>
           <div class="sub snippet">${esc(v.description.split('\n')[0])}</div>`
        : `<div class="sub" data-channel="${esc(v.channelId)}">${esc(v.channelTitle)}</div>
           <div class="sub">${views(v.views)} • ${ago(v.publishedAt)}</div>`}
    </div>
  </a>`;
}

// Clicking a channel name or avatar inside a card opens the channel page.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-channel]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  location.hash = `#/channel/${el.dataset.channel}`;
}, true);

// ---- Views ----------------------------------------------------------------

let currentCategory = null;

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('current', v.id === `view-${name}`));
  document.querySelectorAll('.side-item').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  document.body.classList.toggle('watching', name === 'watch');
  $('content').scrollTop = 0;
  if (name !== 'watch') stopPlayer();
}

async function renderHome() {
  showView('home');
  const cats = await api.categories();
  if (currentCategory && !cats.includes(currentCategory)) currentCategory = null;
  $('chips').innerHTML = ['All', ...cats]
    .map((c) => `<button class="chip${(c === 'All' ? !currentCategory : c === currentCategory) ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
    .join('');
  const vids = await api.feed(currentCategory);
  if (vids.length) {
    $('grid').innerHTML = vids.map((v) => gridCard(v)).join('');
    $('empty').hidden = true;
  } else {
    $('grid').innerHTML = Array.from({ length: 12 }, () => '<div class="card skeleton"><div class="thumb"></div><div class="meta"><div class="chan"></div><div class="lines"><div class="line"></div><div class="line short"></div></div></div></div>').join('');
    $('empty').hidden = false;
  }
}

$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  currentCategory = b.dataset.cat === 'All' ? null : b.dataset.cat;
  renderHome();
});

async function renderSearch(q) {
  showView('search');
  $('search-input').value = q;
  const vids = await api.search(q);
  $('results').innerHTML = vids.length
    ? vids.map((v) => listCard(v)).join('')
    : '<p class="no-results">No results found<br><span>Try different keywords</span></p>';
}

async function renderChannel(id) {
  showView('channel');
  const channels = await api.channels();
  const c = channels.find((x) => x.id === id);
  if (!c) return go('#/');
  const vids = await api.channelVideos(id);
  $('channel-head').innerHTML = `${avatarImg(c.thumb, 'chan big')}
    <div><h1>${esc(c.title)}</h1><div class="sub">${esc(c.handle)}${c.subscribers ? ` • ${compact(c.subscribers)} subscribers` : ''} • ${vids.length} videos</div>
    <button class="subscribed">Subscribed</button></div>`;
  $('channel-grid').innerHTML = vids.map((v) => gridCard(v, { showChannel: false })).join('');
}

async function renderSubscriptions() {
  showView('subscriptions');
  const channels = await api.channels();
  $('sub-row').innerHTML = channels
    .map((c) => `<a class="sub-chan" href="#/channel/${esc(c.id)}">${avatarImg(c.thumb, 'chan big')}<span>${esc(c.title)}</span></a>`)
    .join('');
  const all = (await Promise.all(channels.map((c) => api.channelVideos(c.id)))).flat();
  all.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  $('sub-grid').innerHTML = all.slice(0, 60).map((v) => gridCard(v)).join('');
}

// ---- Watch page and player ------------------------------------------------

let playing = null;

async function renderWatch(id) {
  const v = await api.video(id);
  if (!v) return go('#/'); // not approved, hidden, or removed
  showView('watch');
  playing = v;
  $('endscreen').hidden = true;
  const params = new URLSearchParams({ autoplay: '1', rel: '0', playsinline: '1', iv_load_policy: '3', enablejsapi: '1', modestbranding: '1', origin: location.origin });
  playerHost = (await api.settings()).premium ? PLAYER_HOSTS[1] : PLAYER_HOSTS[0];
  $('player').src = `${playerHost}/embed/${encodeURIComponent(v.id)}?${params}`;

  $('watch-title').textContent = v.title;
  const channels = await api.channels();
  const c = channels.find((x) => x.id === v.channelId) || {};
  $('watch-channel').innerHTML = `<a class="chan-row" href="#/channel/${esc(v.channelId)}">${avatarImg(v.channelThumb)}<div><div class="name">${esc(v.channelTitle)}</div>${c.subscribers ? `<div class="sub">${compact(c.subscribers)} subscribers</div>` : ''}</div></a>
    <button class="subscribed">Subscribed</button>
    ${parentOpen ? `<button class="btn-hide" id="hide-this">Hide this video</button>` : ''}`;
  const hideBtn = $('hide-this');
  if (hideBtn) hideBtn.addEventListener('click', async () => {
    await api.parent.hideVideo(v.id);
    go('#/');
  });

  const desc = v.description.trim();
  $('description').innerHTML = `<div class="desc-meta">${Number(v.views).toLocaleString()} views • ${ago(v.publishedAt)}</div>
    <div class="desc-text collapsed" id="desc-text">${esc(desc)}</div>
    ${desc.length > 200 || desc.split('\n').length > 3 ? '<button class="more" id="desc-more">...more</button>' : ''}`;
  const more = $('desc-more');
  if (more) more.addEventListener('click', () => {
    $('desc-text').classList.remove('collapsed');
    more.remove();
  });

  const next = await api.upNext(v.id);
  $('up-next').innerHTML = next.map((x) => listCard(x, 'compact')).join('');
  $('endscreen-grid').innerHTML = next.slice(0, 6).map((x) => `<a class="end-card" href="#/watch/${esc(x.id)}"><img src="${esc(x.thumb)}" alt=""><span>${esc(x.title)}</span></a>`).join('');
}

function stopPlayer() {
  if ($('player').src) $('player').src = 'about:blank';
  playing = null;
}

// Listen to the embedded player so our own end screen (approved videos only)
// covers YouTube's when a video finishes. Nothing autoplays.
$('player').addEventListener('load', () => {
  const frame = $('player').contentWindow;
  if (frame && playing) frame.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), playerHost);
});

window.addEventListener('message', (e) => {
  if (e.origin !== playerHost) return;
  let data;
  try {
    data = JSON.parse(e.data);
  } catch {
    return;
  }
  // If the player switches video by itself (e.g. a click on YouTube's own
  // suggestions), follow it only when that video is approved.
  const newId = data?.info?.videoData?.video_id;
  if (playing && newId && newId !== playing.id) {
    const wanted = newId;
    api.video(wanted).then((v) => (v ? go(`#/watch/${wanted}`) : playing && renderWatch(playing.id)));
    return;
  }
  const state = data?.info?.playerState ?? (data?.event === 'onStateChange' ? data.info : undefined);
  if (state === 0) $('endscreen').hidden = false;
  if (state === 1) $('endscreen').hidden = true;
});

$('replay').addEventListener('click', () => {
  if (playing) renderWatch(playing.id);
});

// ---- Routing --------------------------------------------------------------

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function route() {
  const [, view, ...rest] = (location.hash || '#/').split('/');
  const arg = decodeURIComponent(rest.join('/'));
  if (view === 'watch') return renderWatch(arg);
  if (view === 'channel') return renderChannel(arg);
  if (view === 'search') return renderSearch(arg);
  if (view === 'subscriptions') return renderSubscriptions();
  if (view === 'you') return showView('you');
  return renderHome();
}

window.addEventListener('hashchange', route);
$('menu-btn').addEventListener('click', () => document.body.classList.toggle('mini'));
$('logo').addEventListener('click', (e) => {
  e.preventDefault();
  currentCategory = null;
  go('#/');
});
$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('search-input').value.trim();
  if (q) go(`#/search/${encodeURIComponent(q)}`);
});
// Mouse back/forward buttons and Alt+arrows, like a browser.
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) history.back();
  if (e.button === 4) history.forward();
});
document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key === 'ArrowLeft') history.back();
  if (e.altKey && e.key === 'ArrowRight') history.forward();
});

api.onLibraryUpdated(() => {
  // Refresh lists in place, but never interrupt a video that's playing.
  if (!document.body.classList.contains('watching')) route();
  if (parentOpen) renderParent();
});

// ---- Parent area (opened from the account menu, behind the PIN) ----------

let parentOpen = false;
// Where the parent area should open after the PIN: 'add' or 'settings'.
let parentTarget = 'add';

function openPinPrompt(target = 'add') {
  parentTarget = target;
  closeAccountMenu();
  $('pin-entry').value = '';
  $('pin-error').textContent = '';
  $('pin-dialog').showModal();
  $('pin-entry').focus();
}

function closeAccountMenu() {
  $('account-menu').hidden = true;
  $('avatar').setAttribute('aria-expanded', 'false');
}

$('avatar').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('account-menu');
  menu.hidden = !menu.hidden;
  $('avatar').setAttribute('aria-expanded', String(!menu.hidden));
});
$('menu-add').addEventListener('click', () => openPinPrompt('add'));
$('menu-settings').addEventListener('click', () => openPinPrompt('settings'));
document.addEventListener('click', (e) => {
  if (!e.target.closest('#account-menu')) closeAccountMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAccountMenu();
});

$('pin-cancel').addEventListener('click', () => $('pin-dialog').close());
$('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ok } = await api.checkPin($('pin-entry').value);
  if (!ok) {
    $('pin-error').textContent = 'Wrong PIN.';
    return;
  }
  $('pin-dialog').close();
  openParent(parentTarget);
});

function openParent(target = 'add') {
  parentOpen = true;
  ['find-input', 'hide-input', 'parent-key'].forEach((id) => ($(id).value = ''));
  ['find-msg', 'hide-msg', 'sync-msg', 'premium-msg', 'parent-key-msg'].forEach((id) => setMsg(id, ''));
  $('found').innerHTML = '';
  $('parent-dialog').showModal();
  renderParent();
  showParentTab(target === 'settings' ? 'settings' : 'channels');
}

function showParentTab(name) {
  document.querySelectorAll('.parent-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
    t.setAttribute('aria-selected', String(t.dataset.tab === name));
  });
  document.querySelectorAll('.parent-panel').forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  $('parent-dialog').scrollTop = 0;
  if (name === 'channels') $('find-input').focus();
}

document.querySelectorAll('.parent-tab').forEach((t) => t.addEventListener('click', () => showParentTab(t.dataset.tab)));

function closeParent() {
  parentOpen = false;
  api.lockParent();
  if ($('parent-dialog').open) $('parent-dialog').close();
  route();
}

$('parent-close').addEventListener('click', closeParent);
$('parent-dialog').addEventListener('cancel', (e) => {
  e.preventDefault();
  closeParent();
});

let categoryList = [];

function categoryPicker(selected, name) {
  return `<div class="cat-pick">${categoryList
    .map((c) => `<label class="cat"><input type="checkbox" name="${esc(name)}" value="${esc(c)}"${selected.includes(c) ? ' checked' : ''}><span>${esc(c)}</span></label>`)
    .join('')}</div>`;
}

async function renderParent() {
  const info = await api.parent.info();
  if (!info.ok) return closeParent();
  categoryList = info.categories;
  $('approved-count').textContent = info.channels.length ? `(${info.channels.length})` : '';
  $('approved').innerHTML = info.channels.length
    ? info.channels
        .map((c) => `<div class="ch-row" data-id="${esc(c.id)}">
          ${avatarImg(c.thumb)}
          <div class="grow"><div class="name">${esc(c.title)}</div><div class="sub">${c.videoCount} videos</div>${categoryPicker(c.categories || [], 'cat-' + c.id)}</div>
          <button class="btn-text danger" data-remove="${esc(c.id)}">Remove</button>
        </div>`)
        .join('')
    : '<p class="hint">No channels yet. Search for one above.</p>';
  $('hidden-list').innerHTML = info.hidden.map((id) => `<div class="row center"><span class="grow mono">${esc(id)}</span><button class="btn-text" data-unhide="${esc(id)}">Unhide</button></div>`).join('');
  $('premium').checked = !!info.premium;
  $('sync-info').textContent = info.syncing ? 'Checking for new videos…' : info.lastSync ? `Last checked ${ago(new Date(info.lastSync).toISOString())}. The app also checks by itself every 6 hours.` : 'Not checked yet.';
}

$('find-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('find-input').value.trim();
  if (!q) return;
  setMsg('find-msg', 'Searching…');
  $('found').innerHTML = '';
  const res = await api.parent.findChannel(q);
  if (!res.ok) return setMsg('find-msg', res.message, false);
  if (!res.results.length) return setMsg('find-msg', 'No channels found. Try another name, or paste the channel link.', false);
  setMsg('find-msg', 'Tick the categories that fit, then press Add.');
  $('found').innerHTML = res.results
    .map((c) => `<div class="ch-row" data-id="${esc(c.id)}">
      ${avatarImg(c.thumb)}
      <div class="grow"><div class="name">${esc(c.title)}</div><div class="sub">${esc(c.handle)}${c.subscribers ? ` • ${compact(c.subscribers)} subscribers` : ''}</div>
      ${c.approved ? '' : categoryPicker([], 'new-' + c.id)}</div>
      ${c.approved ? '<span class="sub">Already approved</span>' : `<button class="btn-primary" data-add="${esc(c.id)}">Add</button>`}
    </div>`)
    .join('');
});

$('parent-dialog').addEventListener('click', async (e) => {
  const add = e.target.closest('[data-add]');
  const remove = e.target.closest('[data-remove]');
  const unhide = e.target.closest('[data-unhide]');
  if (add) {
    const id = add.dataset.add;
    const cats = [...document.querySelectorAll(`input[name="new-${CSS.escape(id)}"]:checked`)].map((i) => i.value);
    add.disabled = true;
    add.textContent = 'Adding…';
    const res = await api.parent.addChannel(id, cats);
    if (!res.ok) {
      add.disabled = false;
      add.textContent = 'Add';
      return setMsg('find-msg', res.message, false);
    }
    add.closest('.ch-row').remove();
    setMsg('find-msg', `Added, with ${res.videoCount} videos.`, true);
    renderParent();
  }
  if (remove) {
    const row = remove.closest('.ch-row');
    if (!confirm(`Remove ${row.querySelector('.name').textContent}? Its videos will disappear from the app.`)) return;
    await api.parent.removeChannel(remove.dataset.remove);
    renderParent();
  }
  if (unhide) {
    await api.parent.unhideVideo(unhide.dataset.unhide);
    renderParent();
  }
});

$('approved').addEventListener('change', async (e) => {
  const row = e.target.closest('.ch-row');
  if (!row) return;
  const cats = [...row.querySelectorAll('input:checked')].map((i) => i.value);
  await api.parent.setCategories(row.dataset.id, cats);
});

$('hide-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await api.parent.hideVideo($('hide-input').value);
  setMsg('hide-msg', res.ok ? 'Hidden.' : res.message, res.ok);
  if (res.ok) {
    $('hide-input').value = '';
    renderParent();
  }
});

$('sync-btn').addEventListener('click', async () => {
  $('sync-btn').disabled = true;
  setMsg('sync-msg', 'Checking every channel for new videos…');
  const res = await api.parent.sync();
  $('sync-btn').disabled = false;
  if (!res.ok) return setMsg('sync-msg', res.message, false);
  setMsg('sync-msg', res.errors?.length ? `Some channels could not be checked: ${res.errors.join('; ')}` : 'Up to date.', !res.errors?.length);
  renderParent();
});

$('premium').addEventListener('change', async () => {
  const res = await api.parent.setPremium($('premium').checked);
  setMsg('premium-msg', res.ok ? 'Saved.' : res.message, res.ok);
});

$('key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('parent-key-msg', 'Checking…');
  const res = await api.setApiKey($('parent-key').value);
  setMsg('parent-key-msg', res.ok ? 'Saved. The new key works.' : res.message, res.ok);
});

function setMsg(id, text, ok) {
  const el = $(id);
  el.textContent = text;
  el.className = 'msg' + (ok === true ? ' ok' : ok === false ? ' bad' : '');
}

// ---- First-run wizard -----------------------------------------------------

const sections = [...document.querySelectorAll('.wizard section')];
let step = 0;

function showStep(n) {
  step = n;
  sections.forEach((s) => s.classList.toggle('current', Number(s.dataset.step) === n));
  $('wizard-dots').innerHTML = sections.map((_, i) => `<span class="${i <= n ? 'done' : ''}"></span>`).join('');
  const first = sections[n].querySelector('input');
  if (first) first.focus();
}

document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => showStep(step + 1)));
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => api.openGuideLink(b.dataset.open)));

$('pin-save').addEventListener('click', async () => {
  const p1 = $('pin1').value;
  const p2 = $('pin2').value;
  if (!/^\d{4,8}$/.test(p1)) {
    $('pin-setup-error').textContent = 'Use 4 to 8 numbers.';
    return;
  }
  if (p1 !== p2) {
    $('pin-setup-error').textContent = "The two PINs don't match.";
    return;
  }
  const res = await api.setPin(p1);
  if (!res.ok) {
    $('pin-setup-error').textContent = res.message;
    return;
  }
  sessionPin = p1;
  showStep(2);
});

$('key-check').addEventListener('click', async () => {
  const btn = $('key-check');
  btn.disabled = true;
  setMsg('key-msg', 'Checking with Google…');
  const res = await api.setApiKey($('api-key').value);
  btn.disabled = false;
  if (!res.ok) {
    setMsg('key-msg', res.message, false);
    return;
  }
  setMsg('key-msg', 'The key works.', true);
  setTimeout(() => showStep(3), 700);
});

// The PIN typed during setup, so the parent area can open straight after.
let sessionPin = null;

$('finish').addEventListener('click', async () => {
  const res = await api.finishSetup();
  if (!res.ok) return;
  $('wizard').hidden = true;
  if (sessionPin && (await api.checkPin(sessionPin)).ok) openParent();
  else openPinPrompt();
  sessionPin = null;
});

// ---- Start ----------------------------------------------------------------

(async function init() {
  const state = await api.state();
  route();
  if (!state.setupDone) {
    $('wizard').hidden = false;
    // Resume where the parent left off if the app was closed mid-setup.
    showStep(state.hasPin ? (state.hasApiKey ? 3 : 2) : 0);
  }
})();
