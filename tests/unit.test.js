const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

require('../src/shared/utils.js');
require('../src/content/extractor.js');

const Utils = globalThis.PinDownloaderUtils;
const Extractor = globalThis.PinDownloaderExtractor;

function makeDocument(scriptText, title) {
  return {
    title: title || '',
    querySelectorAll(selector) {
      if (selector === 'script') return [{ textContent: scriptText }];
      return [];
    },
    querySelector() {
      return null;
    }
  };
}

function relayCall(payload) {
  return 'window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("%7B%7D", ' +
    JSON.stringify(payload) + ');';
}

const SAMPLE_VIDEO_URL =
  'https://v1.pinimg.com/videos/iht/expMp4/12/44/3b/12443b48e72212384cc5bceb4961866a_720w.mp4';
const SAMPLE_HLS_URL =
  'https://v1.pinimg.com/videos/iht/hls/12/44/3b/12443b48e72212384cc5bceb4961866a.m3u8';

test('extracts the current pin progressive MP4 from relay page data', () => {
  const payload = {
    data: {
      v3GetPinQueryv2: {
        data: {
          entityId: '529524868708976544',
          gridTitle: 'Feliz día de la madre',
          videos: {
            videoList: {
              vHLSV4: { url: SAMPLE_HLS_URL, width: 720, height: 1280 },
              v720P: { url: SAMPLE_VIDEO_URL, width: 720, height: 1280 }
            }
          }
        }
      }
    }
  };

  const doc = makeDocument(relayCall(payload), 'Feliz día de la madre | Pinterest');
  const candidate = Extractor.extractFromDocument(doc, '529524868708976544');

  assert.ok(candidate, 'candidate should be extracted');
  assert.equal(candidate.url, SAMPLE_VIDEO_URL);
  assert.equal(candidate.kind, 'mp4');
  assert.equal(candidate.quality, '720p');
  assert.equal(candidate.matched, true);
  assert.equal(candidate.title, 'Feliz día de la madre');
});

test('extracts story pin HLS from videoDataV2 data', () => {
  const storyHlsUrl =
    'https://v1.pinimg.com/videos/iht/hls/6c/51/c7/6c51c7c629c88b11e24cfda24476fa97.m3u8';
  const payload = {
    data: {
      v3GetPinQueryv2: {
        data: {
          entityId: '1040753795155689812',
          seoTitle: 'Рыжие котята | Милый мультфильм',
          videos: null,
          storyPinData: {
            pages: [{
              blocks: [{
                videoDataV2: {
                  videoList: {
                    vHLSV3MOBILE: {
                      url: storyHlsUrl,
                      width: 1080,
                      height: 1920
                    }
                  },
                  v_hlsv4_video_list: {
                    vHLSV4: { url: storyHlsUrl, width: 1080, height: 1920 }
                  }
                }
              }]
            }]
          }
        }
      }
    }
  };

  const doc = makeDocument(relayCall(payload), 'Рыжие котята | Pinterest');
  const candidate = Extractor.extractFromDocument(doc, '1040753795155689812');

  assert.ok(candidate, 'story pin candidate should be extracted');
  assert.equal(candidate.url, storyHlsUrl);
  assert.equal(candidate.kind, 'hls');
  assert.equal(candidate.matched, true);
  assert.equal(candidate.title, 'Рыжие котята | Милый мультфильм');
});

test('keeps HLS as a fallback when no progressive MP4 exists', () => {
  const payload = {
    data: {
      pin: {
        entityId: '529524868708976544',
        videos: {
          videoList: {
            vHLSV4: { url: SAMPLE_HLS_URL, width: 720, height: 1280 }
          }
        }
      }
    }
  };

  const doc = makeDocument(relayCall(payload), 'HLS pin');
  const candidate = Extractor.extractFromDocument(doc, '529524868708976544');

  assert.ok(candidate);
  assert.equal(candidate.url, SAMPLE_HLS_URL);
  assert.equal(candidate.kind, 'hls');
});

test('does not match a different pin in the same payload', () => {
  const payload = {
    data: {
      pin: {
        entityId: '111111111111111111',
        videos: { videoList: { v720P: { url: SAMPLE_VIDEO_URL, width: 720 } } }
      }
    }
  };

  const doc = makeDocument(relayCall(payload), 'Other pin');
  const candidate = Extractor.extractFromDocument(doc, '529524868708976544');

  if (candidate) assert.equal(candidate.matched, false);
});

test('parses pin URLs and rejects search pages or foreign hosts', () => {
  assert.equal(Utils.getPinId('https://www.pinterest.com/pin/529524868708976544/'), '529524868708976544');
  assert.equal(Utils.getPinId('https://www.pinterest.com/pin/529524868708976544/sent/'), '529524868708976544');
  assert.equal(Utils.getPinId('https://www.pinterest.com/search/pins/?q=cats'), null);
  assert.equal(Utils.getPinId('https://example.com/pin/529524868708976544/'), null);
});

test('validates media URLs and reads quality from CDN filenames', () => {
  assert.equal(Utils.isPinimgUrl(SAMPLE_VIDEO_URL), true);
  assert.equal(Utils.isMp4Url(SAMPLE_VIDEO_URL), true);
  assert.equal(Utils.isHlsUrl(SAMPLE_HLS_URL), true);
  assert.equal(Utils.isPinimgUrl('https://example.com/video.mp4'), false);
  assert.equal(Utils.qualityFromUrl(SAMPLE_VIDEO_URL), '720p');
});

test('builds a safe download filename', () => {
  const filename = Utils.buildDownloadFilename({
    title: 'A/B: "test" <video>? [Video] | Pinterest',
    pinId: '529524868708976544',
    quality: '720p'
  });
  assert.equal(filename, 'Pinterest/A B test video_529524868708976544_720p.mp4');
  assert.ok(!/[\\:*?"<>|]/.test(filename));
});

function loadI18n(fakeChrome, fakeNavigator) {
  const source = fs.readFileSync(path.join(__dirname, '../src/shared/i18n.js'), 'utf8');
  const sandbox = {
    chrome: fakeChrome,
    navigator: fakeNavigator
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.PinDownloaderI18n;
}

test('uses Russian when the browser locale is Russian', () => {
  const i18n = loadI18n(
    { i18n: { getUILanguage: () => 'en-US' } },
    { languages: ['ru-RU', 'en-US'], language: 'ru-RU' }
  );
  assert.equal(i18n.language, 'ru');
  assert.equal(i18n.t('downloadVideo'), 'Скачать видео');
  assert.equal(i18n.t('downloadStarted'), 'Загрузка началась.');
});

test('uses the OS language when Chrome exposes it', () => {
  const i18n = loadI18n(
    {
      i18n: {
        getSystemLanguage: () => 'ru-RU',
        getUILanguage: () => 'en-US'
      }
    },
    { languages: ['en-US'], language: 'en-US' }
  );
  assert.equal(i18n.language, 'ru');
});

test('falls back to English for non-Russian locales', () => {
  const i18n = loadI18n(
    { i18n: { getUILanguage: () => 'de-DE' } },
    { languages: ['de-DE'], language: 'de-DE' }
  );
  assert.equal(i18n.language, 'en');
  assert.equal(i18n.t('downloadVideo'), 'Download video');
});
