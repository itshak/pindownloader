(function () {
  'use strict';

  var MAX_ENTRIES = 16;
  var MAX_AGE_MS = 15 * 60 * 1000;
  var KEY_PREFIX = 'pinDownloaderMedia:';
  var memory = new Map();

  function isTrackableMedia(url) {
    try {
      var parsed = new URL(url);
      if (!/(^|\.)pinimg\.com$/i.test(parsed.hostname)) return false;
      if (!/\/videos\//i.test(parsed.pathname)) return false;
      if (/\.mp4$/i.test(parsed.pathname)) return true;
      if (/\.m3u8$/i.test(parsed.pathname) && /\/videos\/iht\/hls\//i.test(parsed.pathname)) {
        return !/_audio\.m3u8$/i.test(parsed.pathname);
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  function kindOf(url) {
    return /\.m3u8$/i.test(url) ? 'hls' : 'mp4';
  }

  function storageKey(tabId) {
    return KEY_PREFIX + tabId;
  }

  function prune(list) {
    var cutoff = Date.now() - MAX_AGE_MS;
    return list
      .filter(function (entry) { return entry && entry.url && entry.ts >= cutoff; })
      .slice(0, MAX_ENTRIES);
  }

  function persist(tabId, list) {
    var data = {};
    data[storageKey(tabId)] = list;
    return chrome.storage.session.set(data).catch(function () {
      // Session storage is a best-effort fallback for service-worker restarts.
    });
  }

  function record(tabId, url) {
    if (!isTrackableMedia(url)) return;

    var list = memory.get(tabId) || [];
    list = list.filter(function (entry) { return entry.url !== url; });
    list.unshift({ url: url, kind: kindOf(url), ts: Date.now() });
    list = prune(list);
    memory.set(tabId, list);
    persist(tabId, list);
  }

  function priority(entry) {
    try {
      var pathname = new URL(entry.url).pathname;
      if (/\/expMp4\//i.test(pathname)) return 0;
      if (entry.kind === 'mp4') return 1;
      if (/_audio\.m3u8$/i.test(pathname)) return 5;
      if (/_\d{3,4}w\.m3u8$/i.test(pathname)) return 3;
      return 2;
    } catch (error) {
      return 4;
    }
  }

  async function getMedia(tabId) {
    var list = memory.get(tabId) || [];
    if (!list.length) {
      try {
        var key = storageKey(tabId);
        var stored = await chrome.storage.session.get(key);
        list = Array.isArray(stored[key]) ? stored[key] : [];
      } catch (error) {
        list = [];
      }
    }

    list = prune(list);
    return list.slice().sort(function (a, b) {
      var byPriority = priority(a) - priority(b);
      if (byPriority !== 0) return byPriority;
      return b.ts - a.ts;
    });
  }

  function clear(tabId) {
    memory.delete(tabId);
    try {
      chrome.storage.session.remove(storageKey(tabId)).catch(function () {});
    } catch (error) {
      // Ignore session storage cleanup failures.
    }
  }

  chrome.webRequest.onBeforeRequest.addListener(
    function (details) {
      if (details.tabId < 0) return;
      record(details.tabId, details.url);
    },
    {
      urls: ['*://*.pinimg.com/*'],
      types: ['media', 'xmlhttprequest', 'other']
    }
  );

  globalThis.PinMediaTracker = {
    getMedia: getMedia,
    clear: clear
  };
})();
