const test = require('node:test');
const assert = require('node:assert/strict');

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
