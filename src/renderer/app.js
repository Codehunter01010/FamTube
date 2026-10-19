const api = window.safetube;
const $ = (id) => document.getElementById(id);

const CATEGORIES = ['All', 'Soccer', 'Sports', 'Animals', 'Cartoons', 'Anime', 'Minecraft'];

// ---- Home shell -----------------------------------------------------------

function renderChips() {
  const chips = $('chips');
  chips.innerHTML = '';
  CATEGORIES.forEach((name, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (i === 0 ? ' active' : '');
    b.textContent = name;
    b.addEventListener('click', () => {
      chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      b.classList.add('active');
    });
    chips.appendChild(b);
  });
}

function renderPlaceholderGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="thumb"></div><div class="meta"><div class="chan"></div><div class="lines"><div class="line"></div><div class="line short"></div></div></div>';
    grid.appendChild(card);
  }
  $('empty').hidden = false;
}

$('menu-btn').addEventListener('click', () => document.body.classList.toggle('mini'));
$('logo').addEventListener('click', (e) => e.preventDefault());
$('search-form').addEventListener('submit', (e) => e.preventDefault());

// ---- Parent area (hidden entry: Ctrl+Shift+P, or hold the avatar 3 s) -----

function openPinPrompt() {
  $('pin-entry').value = '';
  $('pin-error').textContent = '';
  $('pin-dialog').showModal();
  $('pin-entry').focus();
}

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'p' && $('wizard').hidden) openPinPrompt();
});

let holdTimer = null;
const avatar = $('avatar');
const startHold = () => { holdTimer = setTimeout(openPinPrompt, 3000); };
const cancelHold = () => clearTimeout(holdTimer);
avatar.addEventListener('pointerdown', startHold);
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => avatar.addEventListener(ev, cancelHold));

$('pin-cancel').addEventListener('click', () => $('pin-dialog').close());
$('pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ok } = await api.checkPin($('pin-entry').value);
  if (!ok) {
    $('pin-error').textContent = 'Wrong PIN.';
    return;
  }
  $('pin-dialog').close();
  $('parent-key').value = '';
  setMsg('parent-key-msg', '');
  $('parent-dialog').showModal();
});

$('parent-key-save').addEventListener('click', async () => {
  setMsg('parent-key-msg', 'Checking…');
  const res = await api.setApiKey($('parent-key').value);
  setMsg('parent-key-msg', res.ok ? 'Saved. The new key works.' : res.message, res.ok);
});

$('parent-close').addEventListener('click', () => {
  api.lockParent();
  $('parent-dialog').close();
});
$('parent-dialog').addEventListener('close', () => api.lockParent());

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

$('finish').addEventListener('click', async () => {
  const res = await api.finishSetup();
  if (res.ok) $('wizard').hidden = true;
});

// ---- Start ----------------------------------------------------------------

(async function init() {
  renderChips();
  renderPlaceholderGrid();
  const state = await api.state();
  if (!state.setupDone) {
    $('wizard').hidden = false;
    // Resume where the parent left off if the app was closed mid-setup.
    showStep(state.hasPin ? (state.hasApiKey ? 3 : 2) : 0);
  }
})();
