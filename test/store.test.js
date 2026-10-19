const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/store');
const { validateApiKey } = require('../src/youtube-api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'safetube-'));

test('PIN is stored hashed and checked correctly', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.setPin('1234');
  assert.ok(!fs.readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('1234'));
  const again = new Store(dir);
  assert.ok(again.checkPin('1234'));
  assert.ok(!again.checkPin('4321'));
});

test('PIN must be 4-8 digits', () => {
  const s = new Store(tmp());
  assert.throws(() => s.setPin('12'));
  assert.throws(() => s.setPin('abcd'));
});

test('setup cannot finish without PIN and key', () => {
  const s = new Store(tmp());
  assert.throws(() => s.finishSetup());
  s.setPin('5555');
  s.setApiKey('AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE123');
  s.finishSetup();
  assert.ok(s.publicState.setupDone);
});

const key = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE1';
const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body });

test('valid key accepted', async () => {
  assert.ok((await validateApiKey(key, reply(200, {}))).ok);
});

test('API not enabled gives a specific message', async () => {
  const r = await validateApiKey(key, reply(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } }));
  assert.ok(!r.ok && /Enable/.test(r.message));
});

test('malformed key rejected without a network call', async () => {
  let called = false;
  const r = await validateApiKey('hello', async () => { called = true; });
  assert.ok(!r.ok && !called);
});
