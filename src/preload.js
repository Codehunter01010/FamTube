const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('safetube', {
  // Setup and PIN
  state: call('state'),
  setPin: call('set-pin'),
  checkPin: call('check-pin'),
  lockParent: call('lock-parent'),
  setApiKey: call('set-api-key'),
  finishSetup: call('finish-setup'),
  openGuideLink: call('open-guide-link'),

  settings: call('settings'),

  // Library (approved videos only)
  feed: call('feed'),
  categories: call('categories'),
  channels: call('channels'),
  channelVideos: call('channel-videos'),
  video: call('video'),
  upNext: call('up-next'),
  search: call('search'),
  onLibraryUpdated: (fn) => ipcRenderer.on('library-updated', () => fn()),

  // Parent area
  parent: {
    info: call('parent:info'),
    findChannel: call('parent:find-channel'),
    addChannel: call('parent:add-channel'),
    setCategories: call('parent:set-categories'),
    removeChannel: call('parent:remove-channel'),
    hideVideo: call('parent:hide-video'),
    unhideVideo: call('parent:unhide-video'),
    sync: call('parent:sync'),
    setPremium: call('parent:set-premium'),
  },
});
