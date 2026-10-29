(function () {
  'use strict';

  var Utils = globalThis.PinDownloaderUtils;
  var Extractor = globalThis.PinDownloaderExtractor;
  var UI = globalThis.PinDownloaderUI;
  var I18n = globalThis.PinDownloaderI18n;
  if (!Utils || !Extractor || !UI) return;

  function t(key, fallback) {
    return I18n && I18n.t ? I18n.t(key, fallback) : fallback;
  }

  var MESSAGE_DOWNLOAD = 'PIN_DOWNLOADER_DOWNLOAD';
  var MESSAGE_GET_MEDIA = 'PIN_DOWNLOADER_GET_MEDIA';
  var MESSAGE_CLEAR_MEDIA = 'PIN_DOWNLOADER_CLEAR_MEDIA';

  var currentPinId = null;
  var currentVideo = null;
  var host = null;
  var ui = null;
  var insertTarget = null;
  var hostAnchor = null;
  var syncTimer = null;
  var lastHref = location.href;
  var pageCache = null;
  var downloadInFlight = false;

  function sendMessage(message) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          var error = chrome.runtime.lastError;
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

  function requestSync(delay) {
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      syncTimer = null;
      sync();
    }, typeof delay === 'number' ? delay : 250);
  }

  function clearTabMedia() {
    sendMessage({ type: MESSAGE_CLEAR_MEDIA }).catch(function () {
      // The service worker may be starting up; this is best-effort cleanup.
    });
  }

  function resetForPin(pinId) {
    currentPinId = pinId;
    currentVideo = null;
    pageCache = null;
    removeHost();
    clearTabMedia();
  }

  function removeHost() {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    ui = null;
    insertTarget = null;
    hostAnchor = null;
  }

  function videoArea(video) {
    var rect = video.getBoundingClientRect();
    return Math.max(0, rect.width) * Math.max(0, rect.height);
  }

  function findCloseupRoots() {
    var selectors = [
      '[data-test-id="CloseupMainPin"]',
      '[data-test-id="pin-closeup"]',
      '[data-test-id*="closeup" i]'
    ];
    var roots = [];
    selectors.forEach(function (selector) {
      Array.prototype.forEach.call(document.querySelectorAll(selector), function (element) {
        if (!roots.some(function (root) { return root === element || root.contains(element); })) {
          roots.push(element);
        }
      });
    });
    return roots;
  }

  function findBestVideo() {
    var videos = Array.prototype.slice.call(document.querySelectorAll('video'));
    var roots = findCloseupRoots();
    if (roots.length) {
      var closeupVideos = videos.filter(function (video) {
        return roots.some(function (root) { return root.contains(video); });
      });
      if (!closeupVideos.length) return null;
      videos = closeupVideos;
    }

    var candidates = videos.map(function (video, index) {
      var rect = video.getBoundingClientRect();
      var style = getComputedStyle(video);
      var visible = rect.width >= 80 && rect.height >= 80 &&
        style.visibility !== 'hidden' && style.display !== 'none' &&
        Number(style.opacity) !== 0;
      return {
        video: video,
        index: index,
        visible: visible,
        area: rect.width * rect.height,
        top: rect.top,
        playing: !video.paused && video.readyState >= 2
      };
    }).filter(function (item) { return item.visible; });

    if (!candidates.length) return null;

    candidates.sort(function (a, b) {
      if (a.playing !== b.playing) return a.playing ? -1 : 1;
      if (b.area !== a.area) return b.area - a.area;
      return a.index - b.index;
    });

    return candidates[0].video;
  }

  function findInsertTarget(video) {
    var element = video;
    var best = video;

    for (var depth = 0; depth < 8; depth += 1) {
      var parent = element.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;

      var elementRect = element.getBoundingClientRect();
      var parentRect = parent.getBoundingClientRect();
      if (elementRect.width < 1 || elementRect.height < 1) break;
      if (parentRect.width < 1 || parentRect.height < 1) break;

      var widthSlack = Math.max(16, elementRect.width * 0.08);
      var heightSlack = Math.max(24, elementRect.height * 0.12);
      var wrapsPlayer = parentRect.width >= elementRect.width - 2 &&
        parentRect.width <= elementRect.width + widthSlack &&
        parentRect.height >= elementRect.height - 2 &&
        parentRect.height <= elementRect.height + heightSlack;

      if (!wrapsPlayer) break;
      best = parent;
      element = parent;
    }

    return best;
  }

  function ensureButton(target) {
    if (!host) {
      ui = UI.createButton(handleDownloadClick);
      host = ui.host;
    }

    var targetRect = target.getBoundingClientRect();
    if (targetRect.width >= 1) {
      host.style.width = Math.round(targetRect.width) + 'px';
      host.style.maxWidth = '100%';
      host.style.marginLeft = 'auto';
      host.style.marginRight = 'auto';
    }

    var alreadyPlaced = host.parentNode === target.parentNode &&
      host.previousElementSibling === target;

    if (!alreadyPlaced) {
      target.insertAdjacentElement('afterend', host);
    }
    insertTarget = target;
    hostAnchor = {
      target: target,
      parent: host.parentNode,
      nextSibling: host.nextSibling
    };
  }

  function reattachHostWithoutVideo() {
    if (!host || !hostAnchor) return false;

    if (hostAnchor.target && hostAnchor.target.isConnected && hostAnchor.target.parentNode) {
      hostAnchor.target.insertAdjacentElement('afterend', host);
      hostAnchor.parent = host.parentNode;
      hostAnchor.nextSibling = host.nextSibling;
      return true;
    }

    if (hostAnchor.parent && hostAnchor.parent.isConnected) {
      if (hostAnchor.nextSibling && hostAnchor.nextSibling.isConnected &&
          hostAnchor.nextSibling.parentNode === hostAnchor.parent) {
        hostAnchor.parent.insertBefore(host, hostAnchor.nextSibling);
      } else {
        hostAnchor.parent.appendChild(host);
      }
      hostAnchor.nextSibling = host.nextSibling;
      return true;
    }

    var roots = findCloseupRoots();
    if (roots.length && roots[0].isConnected) {
      roots[0].appendChild(host);
      hostAnchor = { target: null, parent: roots[0], nextSibling: null };
      return true;
    }

    return false;
  }

  function sync() {
    var pinId = Utils.getPinId(location.href);
    if (!pinId) {
      if (currentPinId !== null) resetForPin(null);
      removeHost();
      currentPinId = null;
      currentVideo = null;
      return;
    }

    if (pinId !== currentPinId) resetForPin(pinId);

    var video = findBestVideo();
    if (!video) {
      currentVideo = null;
      if (host && host.isConnected) return;
      if (reattachHostWithoutVideo()) return;
      removeHost();
      return;
    }

    currentVideo = video;
    var target = findInsertTarget(video);
    if (!target || !target.parentNode) {
      removeHost();
      return;
    }
    ensureButton(target);
  }

  function isFreshCacheValid(pinId) {
    return pageCache && pageCache.pinId === pinId &&
      Date.now() - pageCache.timestamp < 60000;
  }

  async function fetchPinCandidate(pinId) {
    if (isFreshCacheValid(pinId)) return pageCache.candidate;

    var url = location.origin + '/pin/' + pinId + '/';
    var response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'text/html,application/xhtml+xml' }
    });

    if (!response.ok) throw new Error('Pinterest returned HTTP ' + response.status + '.');

    var html = await response.text();
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var candidate = Extractor.extractFromDocument(doc, pinId);
    pageCache = { pinId: pinId, timestamp: Date.now(), candidate: candidate };
    return candidate;
  }

  async function getNetworkCandidate(pinId) {
    var response = await sendMessage({ type: MESSAGE_GET_MEDIA });
    if (!response || !response.ok || !Array.isArray(response.media)) return null;

    for (var i = 0; i < response.media.length; i += 1) {
      var url = response.media[i] && response.media[i].url;
      if (!url) continue;

      if (Utils.isMp4Url(url)) {
        return {
          url: url,
          kind: 'mp4',
          quality: Utils.qualityFromUrl(url),
          title: document.title,
          matched: true,
          source: 'network'
        };
      }

      if (Utils.isHlsUrl(url)) {
        return {
          url: url,
          kind: 'hls',
          quality: Utils.qualityFromUrl(url),
          title: document.title,
          matched: true,
          source: 'network'
        };
      }
    }

    return null;
  }

  function fallbackTitle() {
    return Utils.cleanTitle(
      document.title ||
      (document.querySelector('meta[property="og:title"]') || {}).content ||
      'Pinterest video'
    );
  }

  async function findCandidate(pinId) {
    var fromPage = Extractor.extractFromDocument(document, pinId);
    if (fromPage && fromPage.matched) return fromPage;

    var directVideo = Extractor.extractFromDomVideo
      ? Extractor.extractFromDomVideo(document, pinId)
      : null;
    if (directVideo && directVideo.kind === 'mp4') return directVideo;

    try {
      var fresh = await fetchPinCandidate(pinId);
      if (fresh) return fresh;
    } catch (error) {
      // Fall through to the network tracker.
    }

    var fromNetwork = await getNetworkCandidate(pinId);
    if (fromNetwork) return fromNetwork;

    return null;
  }

  function friendlyError(error) {
    var message = String((error && error.message) || error || '');
    if (message === 'NO_VIDEO' || /No downloadable video/i.test(message)) {
      return t('noVideo', 'No downloadable video was found on this pin.');
    }
    if (/only provides|HLS|merge/i.test(message)) {
      return t('hlsUnsupported', 'This video is only available as a stream that cannot be saved with audio yet.');
    }
    if (/Failed to fetch|NetworkError|HTTP|AbortError|aborted/i.test(message)) {
      return t('networkError', 'Pinterest did not return the video. Please try again.');
    }
    return t('genericError', 'Could not download this video.');
  }

  async function downloadCandidate(candidate, pinId) {
    var response = await sendMessage({
      type: MESSAGE_DOWNLOAD,
      url: candidate.url,
      kind: candidate.kind,
      quality: candidate.quality,
      title: Utils.cleanTitle(candidate.title) || fallbackTitle(),
      pinId: pinId
    });

    if (!response || !response.ok) {
      throw new Error((response && response.error) || 'Download failed.');
    }
    return response;
  }

  async function handleDownloadClick() {
    if (downloadInFlight || !ui) return;
    var pinId = Utils.getPinId(location.href);
    if (!pinId) {
      ui.setState('error', t('openPin', 'Open a Pinterest pin to download its video.'));
      return;
    }

    downloadInFlight = true;
    ui.setState('busy', t('preparing', 'Preparing\u2026'));

    try {
      var candidate = await findCandidate(pinId);
      if (!candidate) {
        throw new Error('NO_VIDEO');
      }

      ui.setState('busy', t('downloading', 'Downloading\u2026'));
      try {
        await downloadCandidate(candidate, pinId);
      } catch (error) {
        if (candidate.mp4FallbackUrl) {
          await downloadCandidate({
            url: candidate.mp4FallbackUrl,
            kind: 'mp4',
            quality: candidate.mp4FallbackQuality,
            title: candidate.title
          }, pinId);
        } else {
          throw error;
        }
      }

      if (ui) ui.setState('success', t('downloadStarted', 'Download started.'));
    } catch (error) {
      if (ui) ui.setState('error', friendlyError(error));
    } finally {
      downloadInFlight = false;
    }
  }

  function installObservers() {
    var observer = new MutationObserver(function () {
      requestSync(300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('popstate', function () { requestSync(50); });
    window.addEventListener('hashchange', function () { requestSync(50); });
    window.addEventListener('resize', function () { requestSync(100); });

    setInterval(function () {
      if (location.href !== lastHref) {
        lastHref = location.href;
        requestSync(50);
      }
    }, 800);
  }

  lastHref = location.href;
  installObservers();
  requestSync(0);
})();
