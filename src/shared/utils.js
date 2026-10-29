(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PinDownloaderUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var PIN_PATH_RE = /^\/pin\/(\d+)(?:\/|$)/;
  var PINIMG_HOST_RE = /(^|\.)pinimg\.com$/i;
  var PINTEREST_HOST_RE = /(^|\.)pinterest\.com$/i;

  function getPinId(url) {
    try {
      var parsed = new URL(url || '');
      if (!PINTEREST_HOST_RE.test(parsed.hostname)) return null;
      var match = parsed.pathname.match(PIN_PATH_RE);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  function isPinPage(url) {
    return getPinId(url) !== null;
  }

  function isPinimgUrl(url) {
    try {
      var parsed = new URL(url);
      return parsed.protocol === 'https:' && PINIMG_HOST_RE.test(parsed.hostname);
    } catch (error) {
      return false;
    }
  }

  function isMp4Url(url) {
    if (!isPinimgUrl(url)) return false;
    try {
      return /\.mp4$/i.test(new URL(url).pathname);
    } catch (error) {
      return false;
    }
  }

  function isHlsUrl(url) {
    if (!isPinimgUrl(url)) return false;
    try {
      return /\.m3u8$/i.test(new URL(url).pathname);
    } catch (error) {
      return false;
    }
  }

  function qualityFromUrl(url) {
    try {
      var pathname = new URL(url).pathname;
      var match = pathname.match(/_(\d{3,4})w(?:\.|_)/i) || pathname.match(/\/(\d{3,4})w(?:\.|_)/i);
      return match ? match[1] + 'p' : '';
    } catch (error) {
      return '';
    }
  }

  function sanitizeFilename(value, maxLength) {
    var limit = maxLength || 90;
    var text = String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .trim();

    if (!text) text = 'pinterest_video';
    if (text.length > limit) text = text.slice(0, limit).replace(/[.\s]+$/g, '');
    return text || 'pinterest_video';
  }

  function cleanTitle(value) {
    return String(value || '')
      .replace(/\s*\|\s*Pinterest\s*$/i, '')
      .replace(/\s*\[Video\]\s*/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildDownloadFilename(options) {
    var opts = options || {};
    var pinId = /^\d+$/.test(String(opts.pinId || '')) ? String(opts.pinId) : 'unknown';
    var quality = /^\d{3,4}p$/.test(String(opts.quality || '')) ? String(opts.quality) : '';
    var title = sanitizeFilename(cleanTitle(opts.title), 80);
    var suffix = '_' + pinId + (quality ? '_' + quality : '');
    var maxTitle = Math.max(20, 180 - suffix.length - 4);
    if (title.length > maxTitle) title = title.slice(0, maxTitle).replace(/[.\s]+$/g, '');
    return 'Pinterest/' + (title || 'pinterest_video') + suffix + '.mp4';
  }

  return {
    getPinId: getPinId,
    isPinPage: isPinPage,
    isPinimgUrl: isPinimgUrl,
    isMp4Url: isMp4Url,
    isHlsUrl: isHlsUrl,
    qualityFromUrl: qualityFromUrl,
    sanitizeFilename: sanitizeFilename,
    cleanTitle: cleanTitle,
    buildDownloadFilename: buildDownloadFilename
  };
});
