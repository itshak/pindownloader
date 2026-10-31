(function (root) {
  'use strict';

  var DICTIONARIES = {
    en: {
      downloadVideo: 'Download video',
      downloadVideoAria: 'Download Pinterest video',
      copyVideo: 'Copy',
      copyVideoAria: 'Copy video to clipboard',
      copyPreparing: 'Preparing video\u2026',
      copyDownloading: 'Downloading video\u2026',
      copyDownloadProgress: 'Downloading video\u2026 {percent}%',
      copyingToClipboard: 'Copying to clipboard\u2026',
      videoCopied: 'Video copied to clipboard.',
      nativeHelperMissing: 'Clipboard helper is not installed. See native/README.md.',
      copyFileFailed: 'Could not put the video file on the clipboard.',
      copyDownloadFailed: 'Could not download the video for copying.',
      copyTimedOut: 'Copying the video timed out. Please try again.',
      preparing: 'Preparing\u2026',
      downloading: 'Downloading\u2026',
      downloadStarted: 'Download started.',
      tryAgain: 'Try again',
      openPin: 'Open a Pinterest pin to download its video.',
      noVideo: 'No downloadable video was found on this pin.',
      hlsUnsupported: 'This video is only available as a stream that cannot be saved with audio yet.',
      networkError: 'Pinterest did not return the video. Please try again.',
      genericError: 'Could not download this video.'
    },
    ru: {
      downloadVideo: 'Скачать видео',
      downloadVideoAria: 'Скачать видео из Pinterest',
      copyVideo: 'Копировать',
      copyVideoAria: 'Скопировать видео в буфер обмена',
      copyPreparing: 'Подготовка видео\u2026',
      copyDownloading: 'Скачивание видео\u2026',
      copyDownloadProgress: 'Скачивание видео\u2026 {percent}%',
      copyingToClipboard: 'Копирование в буфер обмена\u2026',
      videoCopied: 'Видео скопировано в буфер обмена.',
      nativeHelperMissing: 'Помощник буфера обмена не установлен. См. native/README.md.',
      copyFileFailed: 'Не удалось поместить видеофайл в буфер обмена.',
      copyDownloadFailed: 'Не удалось скачать видео для копирования.',
      copyTimedOut: 'Время копирования видео истекло. Попробуйте ещё раз.',
      preparing: 'Подготовка\u2026',
      downloading: 'Загрузка\u2026',
      downloadStarted: 'Загрузка началась.',
      tryAgain: 'Попробовать снова',
      openPin: 'Откройте страницу пина Pinterest, чтобы скачать видео.',
      noVideo: 'На этой странице не найдено видео для скачивания.',
      hlsUnsupported: 'Это видео доступно только в виде потока, который пока нельзя сохранить со звуком.',
      networkError: 'Pinterest не вернул видео. Попробуйте ещё раз.',
      genericError: 'Не удалось скачать это видео.'
    }
  };

  function detectLanguage() {
    var codes = [];

    try {
      if (typeof chrome !== 'undefined' && chrome.i18n) {
        if (typeof chrome.i18n.getSystemLanguage === 'function') {
          codes.push(chrome.i18n.getSystemLanguage());
        }
        if (typeof chrome.i18n.getUILanguage === 'function') {
          codes.push(chrome.i18n.getUILanguage());
        }
      }
    } catch (error) {
      // Fall back to navigator languages.
    }

    if (typeof navigator !== 'undefined') {
      if (Array.isArray(navigator.languages)) {
        codes = codes.concat(navigator.languages);
      }
      if (navigator.language) codes.push(navigator.language);
    }

    for (var i = 0; i < codes.length; i += 1) {
      if (/^ru(?:[-_]|$)/i.test(String(codes[i] || ''))) return 'ru';
    }
    return 'en';
  }

  var language = detectLanguage();
  var dictionary = DICTIONARIES[language] || DICTIONARIES.en;

  function t(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
    if (Object.prototype.hasOwnProperty.call(DICTIONARIES.en, key)) return DICTIONARIES.en[key];
    return fallback || key;
  }

  root.PinDownloaderI18n = {
    language: language,
    detectLanguage: detectLanguage,
    t: t
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
