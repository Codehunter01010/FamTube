// The allowlist and the cached videos of approved channels.
// Every video the app shows or plays comes out of this class, so the rule
// "only approved channels, never hidden videos, never Shorts" lives here.
const fs = require('fs');
const path = require('path');
const { isShort } = require('./youtube-api');

const CATEGORIES = ['Soccer', 'Sports', 'Animals', 'Cartoons', 'Anime', 'Minecraft', 'Learning', 'Music'];

class Library {
  constructor(dir) {
    this.file = path.join(dir, 'library.json');
    this.data = { channels: [], hidden: [], videos: {}, lastSync: 0 };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      // First run.
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // ---- Parent actions ----

  get channels() {
    return this.data.channels;
  }

  channel(id) {
    return this.data.channels.find((c) => c.id === id) || null;
  }

  addChannel(channel, categories = []) {
    const existing = this.channel(channel.id);
    const cats = categories.filter((c) => CATEGORIES.includes(c));
    if (existing) {
      Object.assign(existing, channel, { categories: cats });
    } else {
      this.data.channels.push({ ...channel, categories: cats, addedAt: Date.now() });
    }
    this.save();
  }

  setCategories(channelId, categories) {
    const c = this.channel(channelId);
    if (!c) return;
    c.categories = categories.filter((x) => CATEGORIES.includes(x));
    this.save();
  }

  removeChannel(channelId) {
    this.data.channels = this.data.channels.filter((c) => c.id !== channelId);
    delete this.data.videos[channelId];
    this.save();
  }

  hideVideo(videoId) {
    if (!this.data.hidden.includes(videoId)) this.data.hidden.push(videoId);
    this.save();
  }

  unhideVideo(videoId) {
    this.data.hidden = this.data.hidden.filter((v) => v !== videoId);
    this.save();
  }

  setChannelVideos(channelId, videos) {
    // Ignore results for a channel that was removed while it was syncing.
    if (!this.channel(channelId)) return;
    this.data.videos[channelId] = videos.filter((v) => v.channelId === channelId);
    this.save();
  }

  markSynced() {
    this.data.lastSync = Date.now();
    this.save();
  }

  // ---- What the child can see ----

  allVideos() {
    const hidden = new Set(this.data.hidden);
    const out = [];
    for (const c of this.data.channels) {
      for (const v of this.data.videos[c.id] || []) {
        if (v.channelId !== c.id || hidden.has(v.id) || isShort(v)) continue;
        out.push({ ...v, channelTitle: c.title, channelThumb: c.thumb, categories: c.categories });
      }
    }
    return out;
  }

  isAllowed(videoId) {
    return this.allVideos().some((v) => v.id === videoId);
  }

  video(videoId) {
    return this.allVideos().find((v) => v.id === videoId) || null;
  }

  categories() {
    const used = new Set(this.data.channels.flatMap((c) => c.categories || []));
    return CATEGORIES.filter((c) => used.has(c));
  }

  // Home feed: the newest uploads mixed with random older ones, so it feels
  // fresh without any watch-time optimisation.
  feed(category, rand = Math.random) {
    let vids = this.allVideos();
    if (category) vids = vids.filter((v) => v.categories.includes(category));
    vids.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const newest = vids.slice(0, 12);
    const rest = shuffle(vids.slice(12), rand);
    return interleave(shuffle(newest, rand), rest).slice(0, 120);
  }

  channelVideos(channelId) {
    return this.allVideos()
      .filter((v) => v.channelId === channelId)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }

  search(query) {
    const words = normalize(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    return this.allVideos()
      .map((v) => {
        const title = normalize(v.title);
        const text = title + ' ' + normalize(v.channelTitle) + ' ' + normalize(v.description);
        if (!words.every((w) => text.includes(w))) return null;
        const score = words.filter((w) => title.includes(w)).length * 2 + (normalize(v.channelTitle).includes(words.join(' ')) ? 3 : 0);
        return { v, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.v.publishedAt.localeCompare(a.v.publishedAt))
      .slice(0, 100)
      .map((x) => x.v);
  }

  upNext(videoId, rand = Math.random) {
    const current = this.video(videoId);
    if (!current) return [];
    const all = this.allVideos().filter((v) => v.id !== videoId);
    const sameChannel = shuffle(all.filter((v) => v.channelId === current.channelId), rand).slice(0, 10);
    const sameCat = shuffle(
      all.filter((v) => v.channelId !== current.channelId && v.categories.some((c) => current.categories.includes(c))),
      rand,
    ).slice(0, 10);
    const others = sameChannel.length + sameCat.length < 12 ? shuffle(all, rand).slice(0, 8) : [];
    const seen = new Set();
    return [...interleave(sameChannel, sameCat), ...others].filter((v) => !seen.has(v.id) && seen.add(v.id)).slice(0, 20);
  }
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

module.exports = { Library, CATEGORIES };
