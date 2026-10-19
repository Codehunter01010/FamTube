// Local settings store: a JSON file in the app's user-data folder.
// No server is involved; everything lives on this computer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = { setupDone: false, pinSalt: null, pinHash: null, apiKey: null };

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      this.data = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      // First run or unreadable file: start from defaults.
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get publicState() {
    return { setupDone: this.data.setupDone, hasPin: !!this.data.pinHash, hasApiKey: !!this.data.apiKey };
  }

  setPin(pin) {
    if (!/^\d{4,8}$/.test(pin)) throw new Error('The PIN must be 4 to 8 digits.');
    const salt = crypto.randomBytes(16).toString('hex');
    this.data.pinSalt = salt;
    this.data.pinHash = hashPin(pin, salt);
    this.save();
  }

  checkPin(pin) {
    if (!this.data.pinHash || typeof pin !== 'string') return false;
    const a = Buffer.from(hashPin(pin, this.data.pinSalt), 'hex');
    const b = Buffer.from(this.data.pinHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  setApiKey(key) {
    this.data.apiKey = key;
    this.save();
  }

  finishSetup() {
    if (!this.data.pinHash || !this.data.apiKey) throw new Error('Set a PIN and an API key first.');
    this.data.setupDone = true;
    this.save();
  }
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString('hex');
}

module.exports = { Store };
