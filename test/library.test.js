const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library } = require('../src/library');
const { fileStorage } = require('../src/file-storage');
const yt = require('../src/youtube-api');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'safetube-lib-'));
const chan = (id, title) => ({ id, title, thumb: '', uploads: 'UU' + id.slice(2), handle: '@' + title });
const vid = (id, channelId, extra = {}) => ({ id, channelId, title: 'Video ' + id, description: '', thumb: '', duration: 600, views: 10, publishedAt: '2026-01-0' + (id.length % 9 + 1) + 'T00:00:00Z', ...extra });

function setup() {
  const lib = new Library(fileStorage(path.join(tmp(), 'library.json')));
  lib.addChannel(chan('UCaaaaaaaaaaaaaaaaaaaaaa', 'Animals'), ['Animals']);
  lib.addChannel(chan('UCbbbbbbbbbbbbbbbbbbbbbb', 'Soccer'), ['Soccer']);
  lib.setChannelVideos('UCaaaaaaaaaaaaaaaaaaaaaa', [vid('lion0000001', 'UCaaaaaaaaaaaaaaaaaaaaaa', { title: 'Lions hunting' }), vid('tiger000001', 'UCaaaaaaaaaaaaaaaaaaaaaa')]);
  lib.setChannelVideos('UCbbbbbbbbbbbbbbbbbbbbbb', [vid('goal0000001', 'UCbbbbbbbbbbbbbbbbbbbbbb', { title: 'Best goals' })]);
  return lib;
}

test('only videos from approved channels are visible', () => {
  const lib = setup();
  // A video claiming another channel is dropped even if stored under an approved one.
  lib.setChannelVideos('UCaaaaaaaaaaaaaaaaaaaaaa', [vid('lion0000001', 'UCaaaaaaaaaaaaaaaaaaaaaa'), vid('sneaky00001', 'UCzzzzzzzzzzzzzzzzzzzzzz')]);
  assert.ok(lib.isAllowed('lion0000001'));
  assert.ok(!lib.isAllowed('sneaky00001'));
  // Videos for an unapproved channel are ignored.
  lib.setChannelVideos('UCzzzzzzzzzzzzzzzzzzzzzz', [vid('other000001', 'UCzzzzzzzzzzzzzzzzzzzzzz')]);
  assert.ok(!lib.isAllowed('other000001'));
  assert.ok(!lib.feed().some((v) => v.id === 'other000001'));
});

test('removing a channel removes its videos everywhere', () => {
  const lib = setup();
  lib.removeChannel('UCbbbbbbbbbbbbbbbbbbbbbb');
  assert.ok(!lib.isAllowed('goal0000001'));
  assert.deepStrictEqual(lib.search('goals'), []);
  assert.ok(!lib.upNext('lion0000001').some((v) => v.id === 'goal0000001'));
});

test('hidden videos are never listed, searched, suggested or playable', () => {
  const lib = setup();
  lib.hideVideo('tiger000001');
  assert.ok(!lib.isAllowed('tiger000001'));
  assert.strictEqual(lib.video('tiger000001'), null);
  assert.ok(!lib.feed().some((v) => v.id === 'tiger000001'));
  assert.ok(!lib.upNext('lion0000001').some((v) => v.id === 'tiger000001'));
  assert.ok(!lib.search('video').some((v) => v.id === 'tiger000001'));
});

test('videos that cannot play outside youtube.com stay out after a sync', () => {
  const lib = setup();
  assert.ok(lib.markUnplayable('goal0000001'));
  assert.ok(!lib.markUnplayable('unknown0001'));
  lib.setChannelVideos('UCbbbbbbbbbbbbbbbbbbbbbb', [vid('goal0000001', 'UCbbbbbbbbbbbbbbbbbbbbbb')]);
  assert.ok(!lib.isAllowed('goal0000001'));
  assert.ok(!lib.feed().some((v) => v.id === 'goal0000001'));
  assert.deepStrictEqual(lib.data.hidden, []);
});

test('a channel list backup restores channels and hidden videos only', () => {
  const lib = setup();
  lib.hideVideo('tiger000001');
  const list = JSON.parse(JSON.stringify(lib.exportList()));
  const fresh = new Library(fileStorage(path.join(tmp(), 'library.json')));
  list.channels.push({ id: 'not-a-channel', uploads: 'x' });
  assert.strictEqual(fresh.importList(list), 2);
  assert.deepStrictEqual(fresh.channels.map((c) => c.categories), [['Animals'], ['Soccer']]);
  assert.deepStrictEqual(fresh.data.hidden, ['tiger000001']);
  assert.strictEqual(fresh.importList(list), 0);
  assert.throws(() => fresh.importList({}), /not a FamTube channel list/);
});

test('Shorts never appear even if cached', () => {
  const lib = setup();
  lib.setChannelVideos('UCaaaaaaaaaaaaaaaaaaaaaa', [vid('short000001', 'UCaaaaaaaaaaaaaaaaaaaaaa', { duration: 45 }), vid('short000002', 'UCaaaaaaaaaaaaaaaaaaaaaa', { title: 'Wow #shorts' })]);
  assert.strictEqual(lib.allVideos().filter((v) => v.channelId === 'UCaaaaaaaaaaaaaaaaaaaaaa').length, 0);
});

test('categories filter the feed and only list used categories', () => {
  const lib = setup();
  assert.deepStrictEqual(lib.categories(), ['Soccer', 'Animals']);
  assert.ok(lib.feed('Soccer').every((v) => v.channelId === 'UCbbbbbbbbbbbbbbbbbbbbbb'));
});

test('search is local and matches words in any order', () => {
  const lib = setup();
  assert.deepStrictEqual(lib.search('hunting lions').map((v) => v.id), ['lion0000001']);
  assert.deepStrictEqual(lib.search('skibidi'), []);
});

test('library persists to disk', () => {
  const dir = tmp();
  const a = new Library(fileStorage(path.join(dir, 'library.json')));
  a.addChannel(chan('UCaaaaaaaaaaaaaaaaaaaaaa', 'Animals'), ['Animals', 'NotACategory']);
  const b = new Library(fileStorage(path.join(dir, 'library.json')));
  assert.deepStrictEqual(b.channel('UCaaaaaaaaaaaaaaaaaaaaaa').categories, ['Animals']);
});

test('channel input parsing', () => {
  assert.deepStrictEqual(yt.parseChannelInput('https://www.youtube.com/@TomandJerry'), { handle: '@TomandJerry' });
  assert.deepStrictEqual(yt.parseChannelInput('@natgeo'), { handle: '@natgeo' });
  assert.deepStrictEqual(yt.parseChannelInput('https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw/videos'), { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' });
  assert.strictEqual(yt.parseChannelInput('tom and jerry'), null);
});

test('duration parsing and Shorts detection', () => {
  assert.strictEqual(yt.parseDuration('PT1H2M3S'), 3723);
  assert.strictEqual(yt.parseDuration('PT59S'), 59);
  assert.ok(yt.isShort({ duration: 59, title: '', description: '' }));
  assert.ok(!yt.isShort({ duration: 600, title: 'Minecraft castle', description: '' }));
});

test('getChannelVideos drops Shorts, live, private and foreign videos', async () => {
  const C = 'UCaaaaaaaaaaaaaaaaaaaaaa';
  const fake = async (url) => {
    const u = new URL(url);
    const p = u.pathname.split('/').pop();
    let body;
    if (p === 'playlistItems') body = { items: ['a', 'b', 'c', 'd', 'e'].map((x) => ({ contentDetails: { videoId: x } })) };
    else body = { items: [
      { id: 'a', snippet: { channelId: C, title: 'Long', description: '', publishedAt: '2026-01-01T00:00:00Z', liveBroadcastContent: 'none', thumbnails: {} }, contentDetails: { duration: 'PT10M' }, statistics: { viewCount: '5' }, status: { privacyStatus: 'public', embeddable: true } },
      { id: 'b', snippet: { channelId: C, title: 'Short', description: '', publishedAt: '2026-01-01T00:00:00Z', thumbnails: {} }, contentDetails: { duration: 'PT30S' }, status: { privacyStatus: 'public' } },
      { id: 'c', snippet: { channelId: C, title: 'Live', description: '', publishedAt: '2026-01-01T00:00:00Z', liveBroadcastContent: 'live', thumbnails: {} }, contentDetails: { duration: 'PT10M' }, status: { privacyStatus: 'public' } },
      { id: 'd', snippet: { channelId: C, title: 'Private', description: '', publishedAt: '2026-01-01T00:00:00Z', thumbnails: {} }, contentDetails: { duration: 'PT10M' }, status: { privacyStatus: 'unlisted' } },
      { id: 'e', snippet: { channelId: 'UCother', title: 'Foreign', description: '', publishedAt: '2026-01-01T00:00:00Z', thumbnails: {} }, contentDetails: { duration: 'PT10M' }, status: { privacyStatus: 'public' } },
    ] };
    return { ok: true, json: async () => body };
  };
  const vids = await yt.getChannelVideos({ id: C, uploads: 'UUaaaaaaaaaaaaaaaaaaaaaa' }, 'k', fake);
  assert.deepStrictEqual(vids.map((v) => v.id), ['a']);
});
