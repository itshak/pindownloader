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
  var MESSAGE_COPY_FILE = 'PIN_DOWNLOADER_COPY_FILE';
  var MESSAGE_COPY_PROGRESS = 'PIN_DOWNLOADER_COPY_PROGRESS';
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
  var pageDataTarget = null;
  var pageDataCheckedAt = 0;
  var pageDataCandidate = null;
  var pageFetchInFlight = false;
  var pageFetchPin = null;
  var pageFetchAt = 0;
  var pageFetchAttempts = 0;
  var downloadInFlight = false;
  var copyInFlight = false;
  var copyStage = '';

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
    pageDataTarget = null;
    pageDataCheckedAt = 0;
    pageDataCandidate = null;
    pageFetchInFlight = false;
    pageFetchPin = null;
    pageFetchAt = 0;
    pageFetchAttempts = 0;
    copyInFlight = false;
    copyStage = '';
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
      if (closeupVideos.length) videos = closeupVideos;
    }

    var candidates = videos.map(function (video, index) {
      var rect = video.getBoundingClientRect();
      var style = getComputedStyle(video);
      var visible = rect.width >= 80 && rect.height >= 80 &&
        style.visibility !== 'hidden' && style.display !== 'none' &&
        Number(style.opacity) !== 0;
      var inViewport = visible && rect.bottom > 0 && rect.top < window.innerHeight &&
        rect.right > 0 && rect.left < window.innerWidth;
      return {
        video: video,
        index: index,
        visible: visible,
        inViewport: inViewport,
        area: rect.width * rect.height,
        top: rect.top,
        playing: !video.paused && video.readyState >= 2
      };
    }).filter(function (item) { return item.visible; });

    if (!candidates.length) return null;

    var inViewport = candidates.filter(function (item) { return item.inViewport; });
    if (!inViewport.length) return null;
    candidates = inViewport;

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

  function isStoryPinElement(element) {
    for (var node = element; node && node !== document.body; node = node.parentElement) {
      var testId = node.getAttribute && node.getAttribute('data-test-id');
      var className = typeof node.className === 'string' ? node.className : '';
      if (/story[-_]?pin|full[-_]?bleed/i.test((testId || '') + ' ' + className)) return true;
    }
    return false;
  }

  function shouldFloatButton(target, targetRect) {
    var viewportHeight = window.innerHeight || 0;
    if (targetRect.bottom + 56 <= viewportHeight) return false;
    if (isStoryPinElement(target)) return true;
    return viewportHeight > 0 &&
      targetRect.height > viewportHeight * 0.6 &&
      targetRect.bottom > viewportHeight - 80;
  }

  function setButtonLayout(targetRect, floating) {
    if (floating) {
      var viewportWidth = window.innerWidth || 0;
      var viewportHeight = window.innerHeight || 0;
      var width = 320;
      var left = (viewportWidth - width) / 2;
      var top = viewportHeight - 72;

      if (targetRect && targetRect.width >= 80) {
        width = Math.max(220, Math.min(420, Math.round(targetRect.width), viewportWidth - 32));
        left = targetRect.left + (targetRect.width - width) / 2;
        top = targetRect.bottom + 8;
      }

      left = Math.max(16, Math.min(left, viewportWidth - width - 16));
      top = Math.max(16, Math.min(top, viewportHeight - 72));

      host.style.position = 'fixed';
      host.style.left = Math.round(left) + 'px';
      host.style.top = Math.round(top) + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
      host.style.width = Math.round(width) + 'px';
      host.style.maxWidth = 'calc(100vw - 32px)';
      host.style.margin = '0';
      host.style.zIndex = '2147483647';
      return;
    }

    host.style.position = '';
    host.style.right = '';
    host.style.bottom = '';
    host.style.left = '';
    host.style.top = '';
    host.style.zIndex = '';
    host.style.width = targetRect.width >= 1 ? Math.round(targetRect.width) + 'px' : '100%';
    host.style.maxWidth = '100%';
    host.style.marginLeft = 'auto';
    host.style.marginRight = 'auto';
    host.style.margin = '12px auto 4px auto';
  }

  function findDocumentPageCandidate(pinId) {
    if (pageDataCandidate && pageDataCandidate.pinId === pinId) {
      return pageDataCandidate.candidate;
    }

    var now = Date.now();
    if (now - pageDataCheckedAt < 2500) return null;
    pageDataCheckedAt = now;

    var candidate = null;
    try {
      candidate = Extractor.extractFromDocument(document, pinId);
    } catch (error) {
      return null;
    }
    if (!candidate || !candidate.matched) return null;

    pageDataCandidate = { pinId: pinId, candidate: candidate };
    return candidate;
  }

  function findPageDataTarget(pinId) {
    if (pageDataTarget && pageDataTarget.pinId === pinId && pageDataTarget.target.isConnected) {
      return pageDataTarget.target;
    }
    if (!findDocumentPageCandidate(pinId)) return null;

    var target = null;
    var roots = findCloseupRoots();
    for (var i = 0; i < roots.length; i += 1) {
      var rect = roots[i].getBoundingClientRect();
      if (rect.width >= 80 && rect.height >= 80) {
        target = roots[i];
        break;
      }
    }

    if (!target) {
      var player = document.querySelector('[data-test-id="web-video-player"]');
      var node = player;
      while (node && node !== document.body) {
        var playerRect = node.getBoundingClientRect();
        if (playerRect.width >= 80 && playerRect.height >= 80) {
          target = node;
          break;
        }
        node = node.parentElement;
      }
    }

    if (!target) return null;

    pageDataTarget = { pinId: pinId, target: target };
    return target;
  }

  function createHost() {
    if (!host) {
      ui = UI.createButton(handleDownloadClick, handleCopyClick);
      host = ui.host;
    }
    return host;
  }

  function ensureFloatingButton(target) {
    createHost();
    setButtonLayout(target ? target.getBoundingClientRect() : null, true);
    if (host.parentNode !== document.body) document.body.appendChild(host);
    hostAnchor = {
      target: null,
      parent: document.body,
      nextSibling: host.nextSibling,
      floating: true
    };
  }

  function requestPageDataButton(pinId) {
    var now = Date.now();
    if (pageFetchInFlight || pageFetchAttempts >= 3) return;
    if (pageFetchPin === pinId && now - pageFetchAt < 15000) return;

    pageFetchInFlight = true;
    pageFetchPin = pinId;
    pageFetchAt = now;
    pageFetchAttempts += 1;

    fetchPinCandidate(pinId)
      .then(function (candidate) {
        pageFetchInFlight = false;
        if (currentPinId !== pinId || !candidate || !candidate.matched) return;
        if (host && host.isConnected) return;
        if (findBestVideo()) {
          requestSync(20);
          return;
        }
        ensureFloatingButton();
      })
      .catch(function () {
        pageFetchInFlight = false;
      });
  }

  function ensureButton(target, forceFloat) {
    createHost();

    var targetRect = target.getBoundingClientRect();
    var floating = Boolean(forceFloat) || shouldFloatButton(target, targetRect);
    setButtonLayout(targetRect, floating);

    if (floating) {
      if (host.parentNode !== document.body) document.body.appendChild(host);
    } else {
      var alreadyPlaced = host.parentNode === target.parentNode &&
        host.previousElementSibling === target;
      if (!alreadyPlaced) target.insertAdjacentElement('afterend', host);
    }

    insertTarget = target;
    hostAnchor = {
      target: target,
      parent: host.parentNode,
      nextSibling: host.nextSibling,
      floating: floating
    };
  }

  function reattachHostWithoutVideo() {
    if (!host || !hostAnchor) return false;

    if (hostAnchor.floating && document.body && document.body.isConnected) {
      if (host.parentNode !== document.body) document.body.appendChild(host);
      hostAnchor.parent = document.body;
      hostAnchor.nextSibling = host.nextSibling;
      return true;
    }

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

      var fallbackTarget = findPageDataTarget(currentPinId);
      if (fallbackTarget) {
        ensureButton(fallbackTarget, true);
        return;
      }

      var anyVideo = document.querySelector('video');
      if (findDocumentPageCandidate(currentPinId) || anyVideo) {
        ensureFloatingButton(anyVideo);
        return;
      }

      requestPageDataButton(currentPinId);
      ensureFloatingButton();
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

  function createCopyError(response) {
    var error = new Error((response && response.error) || 'Could not copy the video file.');
    error.code = response && response.code;
    return error;
  }

  function friendlyCopyError(error) {
    var message = String((error && error.message) || error || '');
    var code = error && error.code;

    if (code === 'NATIVE_MISSING' || /native messaging host not found/i.test(message)) {
      return t('nativeHelperMissing', 'Clipboard helper is not installed. See native/README.md.');
    }
    if (code === 'COPY_TIMEOUT') {
      return t('copyTimedOut', 'Copying the video timed out. Please try again.');
    }
    if (code === 'NATIVE_COPY_FAILED') {
      return t('copyFileFailed', 'Could not put the video file on the clipboard.');
    }
    if (code === 'DOWNLOAD_FAILED' || /download record|interrupted/i.test(message)) {
      return t('copyDownloadFailed', 'Could not download the video for copying.');
    }
    if (message === 'NO_VIDEO' || /No downloadable video/i.test(message)) {
      return t('noVideo', 'No downloadable video was found on this pin.');
    }
    if (/only provides|HLS|merge/i.test(message)) {
      return t('hlsUnsupported', 'This video is only available as a stream that cannot be saved with audio yet.');
    }
    if (/Failed to fetch|NetworkError|HTTP|AbortError|aborted/i.test(message)) {
      return t('networkError', 'Pinterest did not return the video. Please try again.');
    }
    return t('copyFileFailed', 'Could not put the video file on the clipboard.');
  }

  function handleCopyProgress(message) {
    if (!ui || !copyInFlight) return;

    if (message.stage === 'download') {
      if (copyStage !== 'download') return;
      var percent = Number(message.percent);
      if (isFinite(percent) && percent >= 0) {
        ui.setCopyState(
          'busy',
          t('copyDownloadProgress', 'Downloading video\u2026 {percent}%')
            .replace('{percent}', String(percent))
        );
      } else {
        ui.setCopyState('busy', t('copyDownloading', 'Downloading video\u2026'));
      }
    } else if (message.stage === 'copying') {
      if (copyStage !== 'download') return;
      copyStage = 'copying';
      ui.setCopyState('busy', t('copyingToClipboard', 'Copying to clipboard\u2026'));
    }
  }

  async function handleCopyClick() {
    if (copyInFlight || downloadInFlight || !ui) return;
    var pinId = Utils.getPinId(location.href);
    if (!pinId) {
      ui.setCopyState('error', t('openPin', 'Open a Pinterest pin to download its video.'));
      return;
    }

    copyInFlight = true;
    copyStage = 'preparing';
    ui.setCopyState('busy', t('copyPreparing', 'Preparing video\u2026'));

    try {
      var candidate = await findCandidate(pinId);
      if (!candidate) throw new Error('NO_VIDEO');

      copyStage = 'download';
      var response = await sendMessage({
        type: MESSAGE_COPY_FILE,
        url: candidate.url,
        kind: candidate.kind,
        quality: candidate.quality,
        title: Utils.cleanTitle(candidate.title) || fallbackTitle(),
        pinId: pinId
      });
      if (!response || !response.ok) throw createCopyError(response);

      if (ui) ui.setCopyState('success', t('videoCopied', 'Video copied to clipboard.'));
    } catch (error) {
      if (ui) ui.setCopyState('error', friendlyCopyError(error));
    } finally {
      copyInFlight = false;
      copyStage = '';
    }
  }

  async function handleDownloadClick() {
    if (downloadInFlight || copyInFlight || !ui) return;
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

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || message.type !== MESSAGE_COPY_PROGRESS) return;
    handleCopyProgress(message);
  });

  function installObservers() {
    var observer = new MutationObserver(function () {
      requestSync(300);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('popstate', function () { requestSync(50); });
    window.addEventListener('hashchange', function () { requestSync(50); });
    window.addEventListener('resize', function () { requestSync(100); });
    window.addEventListener('scroll', function () { requestSync(120); }, { passive: true });

    setInterval(function () {
      if (location.href !== lastHref) {
        lastHref = location.href;
        requestSync(50);
      } else if (host) {
        requestSync(20);
      }
    }, 1200);
  }

  lastHref = location.href;
  installObservers();
  requestSync(0);
})();
