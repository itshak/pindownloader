(function (root) {
  'use strict';

  var I18n = root.PinDownloaderI18n;

  function t(key, fallback) {
    return I18n && I18n.t ? I18n.t(key, fallback) : fallback;
  }

  var STYLE = [
    ':host {',
    '  all: initial;',
    '  display: block;',
    '  box-sizing: border-box;',
    '  width: 100%;',
    '  margin: 12px 0 4px 0;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
    '}',
    '*, *::before, *::after { box-sizing: border-box; }',
    '.pd-row { display: flex; flex-direction: column; gap: 6px; width: 100%; }',
    '.pd-button {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  gap: 8px;',
    '  width: 100%;',
    '  min-height: 40px;',
    '  padding: 8px 18px;',
    '  border: 0;',
    '  border-radius: 24px;',
    '  background: #e60023;',
    '  color: #fff;',
    '  font: inherit;',
    '  font-size: 14px;',
    '  font-weight: 600;',
    '  line-height: 1.2;',
    '  cursor: pointer;',
    '  transition: background-color 120ms ease, opacity 120ms ease;',
    '}',
    '.pd-button:hover { background: #ad081b; }',
    '.pd-button:focus-visible { outline: 3px solid rgba(0, 102, 255, 0.5); outline-offset: 2px; }',
    '.pd-button:disabled { cursor: wait; opacity: 0.68; }',
    '.pd-icon { width: 18px; height: 18px; flex: 0 0 auto; }',
    '.pd-status {',
    '  min-height: 0;',
    '  margin: 0;',
    '  color: #5f5f5f;',
    '  font: inherit;',
    '  font-size: 12px;',
    '  line-height: 1.35;',
    '  text-align: center;',
    '  overflow-wrap: anywhere;',
    '}',
    '.pd-status:empty { display: none; }',
    '.pd-status.pd-error { color: #b00020; }',
    '.pd-status.pd-success { color: #19733a; }',
    '@media (prefers-color-scheme: dark) {',
    '  .pd-status { color: #b8b8b8; }',
    '  .pd-status.pd-error { color: #ff8a9a; }',
    '  .pd-status.pd-success { color: #7bd99a; }',
    '}'
  ].join('\n');

  var ICON = [
    '<svg class="pd-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
    '  <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" stroke="currentColor" stroke-width="2"',
    '    stroke-linecap="round" stroke-linejoin="round"></path>',
    '  <path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" stroke="currentColor"',
    '    stroke-width="2" stroke-linecap="round"></path>',
    '</svg>'
  ].join('');

  function createButton(onClick) {
    var host = document.createElement('div');
    host.id = 'pin-downloader-host';
    host.setAttribute('data-pin-downloader', 'true');

    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = STYLE;

    var row = document.createElement('div');
    row.className = 'pd-row';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'pd-button';
    button.setAttribute('aria-label', t('downloadVideoAria', 'Download Pinterest video'));
    button.innerHTML = ICON + '<span class="pd-label"></span>';

    var status = document.createElement('p');
    status.className = 'pd-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    row.appendChild(button);
    row.appendChild(status);
    shadow.appendChild(style);
    shadow.appendChild(row);

    var busy = false;
    var resetTimer = null;
    var label = button.querySelector('.pd-label');
    label.textContent = t('downloadVideo', 'Download video');

    function clearResetTimer() {
      if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
    }

    function setState(state, message) {
      clearResetTimer();
      status.classList.remove('pd-error', 'pd-success');
      busy = state === 'busy';
      button.disabled = busy;

      if (state === 'busy') {
        label.textContent = message || t('preparing', 'Preparing\u2026');
        status.textContent = '';
      } else if (state === 'success') {
        label.textContent = t('downloadVideo', 'Download video');
        status.textContent = message || t('downloadStarted', 'Download started.');
        status.classList.add('pd-success');
        resetTimer = setTimeout(function () {
          status.textContent = '';
          status.classList.remove('pd-success');
        }, 6000);
      } else if (state === 'error') {
        label.textContent = t('tryAgain', 'Try again');
        status.textContent = message || t('genericError', 'Could not download this video.');
        status.classList.add('pd-error');
      } else {
        label.textContent = t('downloadVideo', 'Download video');
        status.textContent = '';
      }
    }

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      onClick();
    });

    return {
      host: host,
      setState: setState,
      isBusy: function () { return busy; }
    };
  }

  root.PinDownloaderUI = { createButton: createButton };
})(typeof globalThis !== 'undefined' ? globalThis : this);
