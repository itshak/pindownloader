importScripts('../shared/utils.js', 'media-tracker.js');

'use strict';

const Utils = globalThis.PinDownloaderUtils;
const MediaTracker = globalThis.PinMediaTracker;

const MESSAGE_DOWNLOAD = 'PIN_DOWNLOADER_DOWNLOAD';
const MESSAGE_COPY_FILE = 'PIN_DOWNLOADER_COPY_FILE';
const MESSAGE_COPY_PROGRESS = 'PIN_DOWNLOADER_COPY_PROGRESS';
const MESSAGE_GET_MEDIA = 'PIN_DOWNLOADER_GET_MEDIA';
const MESSAGE_CLEAR_MEDIA = 'PIN_DOWNLOADER_CLEAR_MEDIA';
const NATIVE_HOST = 'com.pindownloader.clipboard';
const COPY_TIMEOUT_MS = 10 * 60 * 1000;
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

async function resolveMediaUrl(message) {
  const pinId = String(message.pinId || '');
  if (!/^\d+$/.test(pinId)) throw new Error('Invalid Pinterest pin ID.');
  if (typeof message.url !== 'string' || !Utils.isPinimgUrl(message.url)) {
    throw new Error('Invalid video URL.');
  }
  if (!/\/videos\//i.test(new URL(message.url).pathname)) {
    throw new Error('Refusing to use a non-video Pinterest asset.');
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
  return { url: finalUrl, quality: quality };
}

async function handleDownload(message) {
  const pinId = String(message.pinId || '');
  const resolved = await resolveMediaUrl(message);
  const filename = Utils.buildDownloadFilename({
    title: message.title,
    pinId: pinId,
    quality: resolved.quality
  });

  const downloadId = await startDownload(resolved.url, filename);
  return {
    ok: true,
    downloadId: downloadId,
    filename: filename,
    url: resolved.url,
    quality: resolved.quality
  };
}

function createCodedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function pingNativeHelper() {
  try {
    const response = await sendNativeMessage({ action: 'ping' });
    if (!response || !response.ok) {
      throw new Error((response && response.error) || 'The clipboard helper did not respond.');
    }
    return response;
  } catch (error) {
    throw createCodedError(
      'NATIVE_MISSING',
      (error && error.message) || 'The clipboard helper is not installed.'
    );
  }
}

function getDownloadItem(downloadId) {
  return new Promise((resolve, reject) => {
    chrome.downloads.search({ id: downloadId }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items && items.length ? items[0] : null);
    });
  });
}

function sendCopyProgress(tabId, payload) {
  if (typeof tabId !== 'number') return;
  try {
    chrome.tabs.sendMessage(
      tabId,
      Object.assign({ type: MESSAGE_COPY_PROGRESS }, payload),
      function () {
        void chrome.runtime.lastError;
      }
    );
  } catch (error) {
    // The tab may have closed while the download was running.
  }
}

async function waitForDownload(downloadId, tabId) {
  const startedAt = Date.now();
  let lastPercent = -1;

  sendCopyProgress(tabId, {
    stage: 'download',
    receivedBytes: 0,
    totalBytes: 0
  });

  while (Date.now() - startedAt < COPY_TIMEOUT_MS) {
    const item = await getDownloadItem(downloadId);
    if (!item) {
      throw createCodedError('DOWNLOAD_FAILED', 'The Chrome download record disappeared.');
    }

    if (item.state === 'complete') {
      return item;
    }
    if (item.state === 'interrupted') {
      throw createCodedError(
        'DOWNLOAD_FAILED',
        item.error || 'Chrome could not finish downloading the video.'
      );
    }

    const receivedBytes = Number(item.bytesReceived) || 0;
    const totalBytes = Number(item.totalBytes) || Number(item.fileSize) || 0;
    const percent = totalBytes > 0
      ? Math.min(99, Math.max(0, Math.floor((receivedBytes / totalBytes) * 100)))
      : null;

    if (percent !== lastPercent) {
      lastPercent = percent;
      sendCopyProgress(tabId, {
        stage: 'download',
        receivedBytes: receivedBytes,
        totalBytes: totalBytes,
        percent: percent
      });
    }

    await delay(400);
  }

  throw createCodedError('COPY_TIMEOUT', 'Copying the video timed out.');
}

async function handleCopyFile(message, sender) {
  await pingNativeHelper();

  const resolved = await resolveMediaUrl(message);
  const pinId = String(message.pinId || '');
  const filename = Utils.buildDownloadFilename({
    title: message.title,
    pinId: pinId,
    quality: resolved.quality
  });
  const downloadId = await startDownload(resolved.url, filename);
  const tabId = sender.tab && sender.tab.id;
  const download = await waitForDownload(downloadId, tabId);

  if (!download.filename) {
    throw createCodedError('COPY_FAILED', 'Chrome did not report the downloaded file path.');
  }

  sendCopyProgress(tabId, { stage: 'copying' });

  let nativeResult;
  try {
    nativeResult = await sendNativeMessage({
      action: 'copyFile',
      path: download.filename
    });
  } catch (error) {
    const messageText = (error && error.message) || 'The clipboard helper failed.';
    const code = /native messaging host not found/i.test(messageText)
      ? 'NATIVE_MISSING'
      : 'NATIVE_COPY_FAILED';
    throw createCodedError(code, messageText);
  }

  if (!nativeResult || !nativeResult.ok) {
    throw createCodedError(
      'NATIVE_COPY_FAILED',
      (nativeResult && nativeResult.error) || 'The clipboard helper could not copy the file.'
    );
  }

  return {
    ok: true,
    downloadId: downloadId,
    filename: download.filename,
    bytes: Number(download.fileSize) || Number(download.bytesReceived) || Number(nativeResult.bytes) || 0,
    url: resolved.url,
    quality: resolved.quality
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

  if (message.type === MESSAGE_COPY_FILE) {
    handleCopyFile(message, sender)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          code: (error && error.code) || 'COPY_FAILED',
          error: (error && error.message) || 'Could not copy the video file.'
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
