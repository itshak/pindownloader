(function (root) {
  'use strict';

  var RELAY_MARKER = '__PWS_RELAY_REGISTER_COMPLETED_REQUEST__';
  var MAX_SCRIPT_LENGTH = 12 * 1024 * 1024;

  function skipWhitespace(text, index) {
    while (index < text.length && /\s/.test(text[index])) index += 1;
    return index;
  }

  function scanStringEnd(text, start) {
    if (text[start] !== '"') return -1;
    for (var i = start + 1; i < text.length; i += 1) {
      if (text[i] === '\\') {
        i += 1;
      } else if (text[i] === '"') {
        return i + 1;
      }
    }
    return -1;
  }

  function scanBalancedEnd(text, start) {
    if (text[start] !== '{' && text[start] !== '[') return -1;
    var depth = 0;
    var inString = false;
    var escaped = false;

    for (var i = start; i < text.length; i += 1) {
      var char = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        depth += 1;
      } else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }

  function parseRelayPayloads(text) {
    var payloads = [];
    var cursor = 0;

    while (cursor < text.length) {
      var markerIndex = text.indexOf(RELAY_MARKER, cursor);
      if (markerIndex === -1) break;

      var openParen = text.indexOf('(', markerIndex + RELAY_MARKER.length);
      if (openParen === -1) break;

      var firstArgStart = skipWhitespace(text, openParen + 1);
      if (text[firstArgStart] !== '"') {
        cursor = openParen + 1;
        continue;
      }

      const firstArgEnd = scanStringEnd(text, firstArgStart);
      if (firstArgEnd === -1) break;

      var comma = skipWhitespace(text, firstArgEnd);
      if (text[comma] !== ',') {
        cursor = firstArgEnd;
        continue;
      }

      var objectStart = skipWhitespace(text, comma + 1);
      if (text[objectStart] !== '{') {
        cursor = comma + 1;
        continue;
      }

      var objectEnd = scanBalancedEnd(text, objectStart);
      if (objectEnd === -1) break;

      try {
        payloads.push(JSON.parse(text.slice(objectStart, objectEnd)));
      } catch (error) {
        // Ignore malformed relay payloads and keep looking.
      }
      cursor = objectEnd;
    }

    return payloads;
  }

  function normalizeId(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && /^\d+$/.test(value)) return value;
    return null;
  }

  function pickTitle(object) {
    var keys = ['gridTitle', 'description', 'gridDescription', 'title', 'seoTitle', 'altText'];
    for (var i = 0; i < keys.length; i += 1) {
      var value = object && object[keys[i]];
      if (typeof value === 'string' && value.trim().length > 1) return value.trim();
    }
    return '';
  }

  function widthFromUrl(url) {
    try {
      var match = new URL(url).pathname.match(/_(\d{3,4})w(?:\.|_)/i);
      return match ? Number(match[1]) : 0;
    } catch (error) {
      return 0;
    }
  }

  function qualityFromKey(key) {
    var match = String(key || '').match(/^v?(\d{3,4})P$/i);
    return match ? match[1] + 'p' : '';
  }

  function makeCandidate(url, options) {
    var opts = options || {};
    var Utils = root.PinDownloaderUtils;
    if (!url || !Utils || !Utils.isPinimgUrl(url)) return null;

    var parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return null;
    }

    var isHls = /\.m3u8$/i.test(parsed.pathname);
    var isMp4 = /\.mp4$/i.test(parsed.pathname);
    if (!isHls && !isMp4) return null;

    var pathname = parsed.pathname;
    var isAudioOnly = /_audio\.m3u8$/i.test(pathname);
    var isHevc = /hevc|h265/i.test(pathname) || /_t\d+\.mp4$/i.test(pathname);
    var isHlsPath = /\/videos\/iht\/hls\//i.test(pathname);

    if (isHls && (isAudioOnly || !isHlsPath)) return null;

    var width = Number(opts.width) || widthFromUrl(url);
    var height = Number(opts.height) || 0;
    var quality = width >= 100 ? width + 'p' : qualityFromKey(opts.key);
    if (!quality && Utils.qualityFromUrl) quality = Utils.qualityFromUrl(url);

    var score = width * 10000;
    if (isMp4) {
      if (/\/expMp4\//i.test(pathname)) score += 500000;
      if (isHevc) score -= 250000;
    } else {
      score += 100000;
    }

    return {
      url: url,
      kind: isHls ? 'hls' : 'mp4',
      quality: quality,
      width: width,
      height: height,
      title: opts.title || '',
      matched: Boolean(opts.matched),
      score: score,
      source: opts.source || 'page-data'
    };
  }

  function addUrl(result, url, options) {
    var candidate = makeCandidate(url, options);
    if (candidate) result.push(candidate);
  }

  function collectVideos(videos, matched, inheritedTitle, result) {
    if (!videos || typeof videos !== 'object') return;

    var title = inheritedTitle || pickTitle(videos);
    var list = videos.videoList || videos.video_list;

    if (Array.isArray(videos.videoUrls)) {
      videos.videoUrls.forEach(function (url) {
        addUrl(result, url, { matched: matched, title: title, source: 'videoUrls' });
      });
    }

    if (Array.isArray(list)) {
      list.forEach(function (entry) {
        if (typeof entry === 'string') {
          addUrl(result, entry, { matched: matched, title: title, source: 'videoList' });
        } else if (entry && typeof entry === 'object') {
          addUrl(result, entry.url || entry.videoUrl, {
            matched: matched,
            title: title,
            width: entry.width,
            height: entry.height,
            source: 'videoList'
          });
        }
      });
    } else if (list && typeof list === 'object') {
      Object.keys(list).forEach(function (key) {
        var entry = list[key];
        if (typeof entry === 'string') {
          addUrl(result, entry, {
            matched: matched,
            title: title,
            key: key,
            source: 'videoList'
          });
        } else if (entry && typeof entry === 'object') {
          addUrl(result, entry.url || entry.videoUrl, {
            matched: matched,
            title: title,
            width: entry.width,
            height: entry.height,
            key: key,
            source: 'videoList'
          });
        }
      });
    }

    if (typeof videos.url === 'string') {
      addUrl(result, videos.url, { matched: matched, title: title, source: 'videos' });
    }
    if (typeof videos.hlsUrl === 'string') {
      addUrl(result, videos.hlsUrl, { matched: matched, title: title, source: 'videos' });
    }
  }

  function collectVideoUrlStrings(value, matched, title, result) {
    if (!value || typeof value !== 'object') return;

    Object.keys(value).forEach(function (key) {
      var child = value[key];
      if (typeof child === 'string') {
        addUrl(result, child, {
          matched: matched,
          title: title,
          source: 'pin-data'
        });
      } else if (child && typeof child === 'object') {
        collectVideoUrlStrings(child, matched, title, result);
      }
    });
  }

  function collectFromPayload(payload, pinId) {
    var matched = [];
    var unmatched = [];
    var titleHints = [];

    function visit(value, inCurrentPin, inheritedTitle) {
      if (!value || typeof value !== 'object') return;

      var title = inheritedTitle;
      var isCurrent = inCurrentPin;
      var entityId = normalizeId(value.entityId) || normalizeId(value.pinId);

      if (entityId && entityId === pinId) {
        isCurrent = true;
        title = pickTitle(value) || title;
        collectVideoUrlStrings(value, true, title, matched);
      }

      if (isCurrent) {
        var ownTitle = pickTitle(value);
        if (ownTitle) titleHints.push(ownTitle);
      }

      if (value.videos) collectVideos(value.videos, isCurrent, title, isCurrent ? matched : unmatched);
      if (value.video_list) collectVideos(value, isCurrent, title, isCurrent ? matched : unmatched);

      Object.keys(value).forEach(function (key) {
        var child = value[key];
        if (child && typeof child === 'object') visit(child, isCurrent, title);
      });
    }

    visit(payload, false, '');
    return { matched: matched, unmatched: unmatched, titleHints: titleHints };
  }

  function parseLooseObjectByKey(text, key, pinId) {
    var result = [];
    var searchFrom = 0;

    while (searchFrom < text.length) {
      var keyIndex = text.indexOf(key, searchFrom);
      if (keyIndex === -1) break;

      var colon = text.indexOf(':', keyIndex + key.length);
      if (colon === -1) break;

      var objectStart = skipWhitespace(text, colon + 1);
      if (text[objectStart] !== '{') {
        searchFrom = keyIndex + key.length;
        continue;
      }

      var objectEnd = scanBalancedEnd(text, objectStart);
      if (objectEnd === -1) break;

      try {
        var object = JSON.parse(text.slice(objectStart, objectEnd));
        collectVideoUrlStrings(object, false, '', result);
      } catch (error) {
        // Ignore malformed object.
      }
      searchFrom = objectEnd;
    }

    return result;
  }

  function parseLooseVideoObjects(text, pinId) {
    var result = [];
    var searchFrom = 0;

    while (searchFrom < text.length) {
      var keyIndex = text.indexOf('"videos"', searchFrom);
      if (keyIndex === -1) break;

      var colon = text.indexOf(':', keyIndex + 8);
      if (colon === -1) break;

      var objectStart = skipWhitespace(text, colon + 1);
      if (text[objectStart] !== '{') {
        searchFrom = keyIndex + 8;
        continue;
      }

      var objectEnd = scanBalancedEnd(text, objectStart);
      if (objectEnd === -1) break;

      try {
        var videos = JSON.parse(text.slice(objectStart, objectEnd));
        collectVideos(videos, false, '', result);
      } catch (error) {
        // Ignore malformed object.
      }
      searchFrom = objectEnd;
    }

    return result;
  }

  function dedupeAndSort(candidates) {
    var byUrl = new Map();
    candidates.forEach(function (candidate) {
      var existing = byUrl.get(candidate.url);
      if (!existing || existing.score < candidate.score) byUrl.set(candidate.url, candidate);
    });

    return Array.from(byUrl.values()).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.url.localeCompare(b.url);
    });
  }

  function chooseBest(candidates) {
    if (!candidates.length) return null;
    var matched = candidates.filter(function (candidate) { return candidate.matched; });
    var pool = matched.length ? matched : candidates;
    var sorted = dedupeAndSort(pool);
    var best = sorted[0];
    if (!best) return null;

    if (best.kind === 'hls') {
      var directMp4 = sorted.find(function (candidate) { return candidate.kind === 'mp4'; });
      if (directMp4) {
        best.mp4FallbackUrl = directMp4.url;
        best.mp4FallbackQuality = directMp4.quality;
      }
    }
    return best;
  }

  function extractFromDomVideo(doc, pinId) {
    var videos = doc.querySelectorAll('video');
    var candidates = [];

    Array.prototype.forEach.call(videos, function (video) {
      var urls = [];
      if (video.currentSrc) urls.push(video.currentSrc);
      if (video.src) urls.push(video.src);
      Array.prototype.forEach.call(video.querySelectorAll('source'), function (source) {
        if (source.src) urls.push(source.src);
      });

      urls.forEach(function (url) {
        addUrl(candidates, url, {
          matched: true,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          source: 'video-element'
        });
      });
    });

    return chooseBest(candidates);
  }

  function extractFromDocument(doc, pinId) {
    var candidates = [];
    var titleHints = [];
    var scripts = doc.querySelectorAll('script');

    Array.prototype.forEach.call(scripts, function (script) {
      var text = script.textContent || '';
      if (!text || text.length > MAX_SCRIPT_LENGTH) return;
      if (text.indexOf(RELAY_MARKER) === -1 && text.indexOf('"videos"') === -1) return;

      if (text.indexOf(RELAY_MARKER) !== -1) {
        parseRelayPayloads(text).forEach(function (payload) {
          var collected = collectFromPayload(payload, pinId);
          candidates = candidates.concat(collected.matched, collected.unmatched);
          titleHints = titleHints.concat(collected.titleHints);
        });
      }

      if (text.indexOf('"videos"') !== -1) {
        candidates = candidates.concat(parseLooseVideoObjects(text, pinId));
      }

      if (text.indexOf('"storyPinData"') !== -1) {
        candidates = candidates.concat(parseLooseObjectByKey(text, '"storyPinData"', pinId));
      }
    });

    var best = chooseBest(candidates);
    if (!best) best = extractFromDomVideo(doc, pinId);
    if (!best) return null;

    var fallbackTitle = '';
    if (titleHints.length) {
      fallbackTitle = titleHints.find(function (title) { return title && title.length > 1; }) || '';
    }
    if (!fallbackTitle && doc.title) fallbackTitle = doc.title;
    if (!fallbackTitle) {
      var meta = doc.querySelector('meta[property="og:title"]');
      if (meta) fallbackTitle = meta.getAttribute('content') || '';
    }

    best.title = best.title || fallbackTitle;
    best.pinId = pinId;
    return best;
  }

  root.PinDownloaderExtractor = {
    extractFromDocument: extractFromDocument,
    extractFromDomVideo: extractFromDomVideo,
    parseRelayPayloads: parseRelayPayloads,
    chooseBest: chooseBest
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
