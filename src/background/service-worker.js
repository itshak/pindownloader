importScripts('../shared/utils.js', 'media-tracker.js');

'use strict';

const Utils = globalThis.PinDownloaderUtils;
const MediaTracker = globalThis.PinMediaTracker;

const MESSAGE_DOWNLOAD = 'PIN_DOWNLOADER_DOWNLOAD';
const MESSAGE_GET_MEDIA = 'PIN_DOWNLOADER_GET_MEDIA';
const MESSAGE_CLEAR_MEDIA = 'PIN_DOWNLOADER_CLEAR_MEDIA';
const HLS_CACHE_LIMIT = 50;
const hlsCache = new Map();

function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 20000);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

function parseMasterPlaylist(text, baseUrl) {
  const variants = [];
  let pendingAttributes = null;

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingAttributes = line;
      return;
    }
    if (line.startsWith('#')) return;

    if (pendingAttributes) {
      const resolution = pendingAttributes.match(/RESOLUTION=(\d+)x(\d+)/i);
      variants.push({
        url: new URL(line, baseUrl).href,
        width: resolution ? Number(resolution[1]) : 0,
        height: resolution ? Number(resolution[2]) : 0
      });
      pendingAttributes = null;
    }
  });

  return variants;
}

function widthFromHlsUrl(url) {
  try {
    const match = new URL(url).pathname.match(/_(\d{3,4})w\.m3u8$/i);
    return match ? Number(match[1]) : 0;
  } catch (error) {
    return 0;
  }
}

function deriveProgressiveUrl(hlsUrl, width) {
  const parsed = new URL(hlsUrl);
  const marker = '/videos/iht/hls/';
  const markerIndex = parsed.pathname.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error('Unsupported HLS media URL.');
  }

  const tail = parsed.pathname.slice(markerIndex + marker.length);
  const stem = tail.replace(/\.m3u8$/i, '');
  const parts = stem.split('/');
  const last = parts.pop().replace(/_\d{3,4}w$/i, '');
  const prefix = parts.length ? parts.join('/') + '/' : '';
  parsed.pathname = '/videos/iht/expMp4/' + prefix + last + '_' + width + 'w.mp4';
  return parsed.href;
}

async function validateMp4(url) {
  let response = await fetchWithTimeout(url, {
    method: 'HEAD',
    cache: 'no-store',
    credentials: 'omit'
  }, 15000);

  const contentType = response.headers.get('content-type') || '';
  const length = Number(response.headers.get('content-length') || 0);
  if (response.ok && (!contentType || /^video\//i.test(contentType) || /octet-stream/i.test(contentType)) && length !== 0) {
    return true;
  }

  if (response.ok) return true;

  response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    cache: 'no-store',
    credentials: 'omit'
  }, 15000);

  if (response.body) {
    try {
      await response.body.cancel();
    } catch (error) {
      // Ignore stream cancellation errors.
    }
  }

  return response.ok;
}

function cacheResolved(sourceUrl, resolved) {
  if (hlsCache.size >= HLS_CACHE_LIMIT) {
    const oldestKey = hlsCache.keys().next().value;
    if (oldestKey) hlsCache.delete(oldestKey);
  }
  hlsCache.set(sourceUrl, resolved);
}

async function resolveHlsToMp4(hlsUrl) {
  const cached = hlsCache.get(hlsUrl);
  if (cached) return cached;

  const response = await fetchWithTimeout(hlsUrl, {
    cache: 'no-store',
    credentials: 'omit'
  }, 20000);

  if (!response.ok) {
    throw new Error('Pinterest media server returned HTTP ' + response.status + '.');
  }

  const playlist = await response.text();
  const variants = parseMasterPlaylist(playlist, hlsUrl);
  variants.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  const widths = [];
  const addWidth = (value) => {
    const width = Number(value);
    if (width >= 100 && width <= 4096 && widths.indexOf(width) === -1) widths.push(width);
  };

  if (variants.length && variants[0].width) addWidth(variants[0].width);
  addWidth(widthFromHlsUrl(hlsUrl));
  [1080, 720, 540, 480, 360, 240].forEach(addWidth);

  let lastError = null;
  for (const width of widths) {
    const candidateUrl = deriveProgressiveUrl(hlsUrl, width);
    try {
      if (await validateMp4(candidateUrl)) {
        const resolved = {
          url: candidateUrl,
          width: width,
          quality: width + 'p'
        };
        cacheResolved(hlsUrl, resolved);
        return resolved;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    'This video only provides an HLS stream without a matching MP4. ' +
    'Saving it with audio would require an audio/video merge. ' +
    (lastError ? lastError.message : '')
  );
}

function normalizeQuality(value) {
  const match = String(value || '').match(/^(\d{3,4})p$/i);
  return match ? match[1] + 'p' : '';
}

function startDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: filename,
      conflictAction: 'uniquify',
      saveAs: false
    }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else if (typeof downloadId !== 'number') {
        reject(new Error('Chrome did not start the download.'));
      } else {
        resolve(downloadId);
      }
    });
  });
}

async function handleDownload(message) {
  const pinId = String(message.pinId || '');
  if (!/^\d+$/.test(pinId)) throw new Error('Invalid Pinterest pin ID.');
  if (typeof message.url !== 'string' || !Utils.isPinimgUrl(message.url)) {
    throw new Error('Invalid video URL.');
  }
  if (!/\/videos\//i.test(new URL(message.url).pathname)) {
    throw new Error('Refusing to download a non-video Pinterest asset.');
  }

  let finalUrl = message.url;
  let quality = normalizeQuality(message.quality);

  if (Utils.isHlsUrl(message.url)) {
    const resolved = await resolveHlsToMp4(message.url);
    finalUrl = resolved.url;
    quality = resolved.quality;
  }

  if (!Utils.isMp4Url(finalUrl)) {
    throw new Error('No downloadable MP4 was found for this video.');
  }

  if (!quality) quality = normalizeQuality(Utils.qualityFromUrl(finalUrl));

  const filename = Utils.buildDownloadFilename({
    title: message.title,
    pinId: pinId,
    quality: quality
  });

  const downloadId = await startDownload(finalUrl, filename);
  return {
    ok: true,
    downloadId: downloadId,
    filename: filename,
    url: finalUrl,
    quality: quality
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === MESSAGE_DOWNLOAD) {
    handleDownload(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: (error && error.message) || 'Could not download this video.'
        });
      });
    return true;
  }

  if (message.type === MESSAGE_GET_MEDIA) {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: true, media: [] });
      return false;
    }
    MediaTracker.getMedia(tabId)
      .then((media) => sendResponse({ ok: true, media: media }))
      .catch(() => sendResponse({ ok: true, media: [] }));
    return true;
  }

  if (message.type === MESSAGE_CLEAR_MEDIA) {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId === 'number') MediaTracker.clear(tabId);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
