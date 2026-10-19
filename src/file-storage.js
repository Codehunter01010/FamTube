// JSON-file storage for the desktop app.
const fs = require('fs');
const path = require('path');

function fileStorage(file) {
  return {
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null; // first run
      }
    },
    save(data) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    },
  };
}

module.exports = { fileStorage };
