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
    '.pd-actions { display: flex; gap: 8px; width: 100%; }',
    '.pd-button {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  gap: 8px;',
    '  flex: 1 1 auto;',
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
    '.pd-copy-button {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  gap: 6px;',
    '  flex: 0 0 auto;',
    '  min-height: 40px;',
    '  padding: 8px 12px;',
    '  border: 1px solid #d0d0d0;',
    '  border-radius: 24px;',
    '  background: #fff;',
    '  color: #111;',
    '  font: inherit;',
    '  font-size: 13px;',
    '  font-weight: 600;',
    '  line-height: 1.2;',
    '  cursor: pointer;',
    '  transition: background-color 120ms ease, opacity 120ms ease;',
    '}',
    '.pd-copy-button:hover { background: #f3f3f3; }',
    '.pd-copy-button:focus-visible { outline: 3px solid rgba(0, 102, 255, 0.5); outline-offset: 2px; }',
    '.pd-copy-button:disabled { cursor: wait; opacity: 0.68; }',
    '.pd-copy-label { white-space: nowrap; }',
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
    '  .pd-copy-button { background: #222; color: #fff; border-color: #555; }',
    '  .pd-copy-button:hover { background: #333; }',
    '}'
  ].join('\n');

  var ICON_COPY = [
    '<svg class="pd-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
    '  <rect x="8" y="8" width="11" height="12" rx="2"',
    '    stroke="currentColor" stroke-width="2"></rect>',
    '  <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2"',
    '    stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
    '</svg>'
  ].join('');

  var ICON = [
    '<svg class="pd-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
    '  <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" stroke="currentColor" stroke-width="2"',
    '    stroke-linecap="round" stroke-linejoin="round"></path>',
    '  <path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" stroke="currentColor"',
    '    stroke-width="2" stroke-linecap="round"></path>',
    '</svg>'
  ].join('');

  function createButton(onClick, onCopy) {
    var host = document.createElement('div');
    host.id = 'pin-downloader-host';
    host.setAttribute('data-pin-downloader', 'true');

    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = STYLE;

    var row = document.createElement('div');
    row.className = 'pd-row';

    var actions = document.createElement('div');
    actions.className = 'pd-actions';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'pd-button';
    button.setAttribute('aria-label', t('downloadVideoAria', 'Download Pinterest video'));
    button.innerHTML = ICON + '<span class="pd-label"></span>';

    var copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'pd-copy-button';
    copyButton.setAttribute('aria-label', t('copyVideoAria', 'Copy video to clipboard'));
    copyButton.title = t('copyVideoAria', 'Copy video to clipboard');
    copyButton.innerHTML = ICON_COPY + '<span class="pd-copy-label"></span>';

    var status = document.createElement('p');
    status.className = 'pd-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    actions.appendChild(button);
    actions.appendChild(copyButton);
    row.appendChild(actions);
    row.appendChild(status);
    shadow.appendChild(style);
    shadow.appendChild(row);

    var busy = false;
    var copyBusy = false;
    var resetTimer = null;
    var label = button.querySelector('.pd-label');
    var copyLabel = copyButton.querySelector('.pd-copy-label');
    label.textContent = t('downloadVideo', 'Download video');
    copyLabel.textContent = t('copyVideo', 'Copy');

    function clearResetTimer() {
      if (resetTimer !== null) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
    }

    function showTemporaryStatus(message, type) {
      clearResetTimer();
      status.classList.remove('pd-error', 'pd-success');
      status.textContent = message;
      if (type) status.classList.add(type);
      resetTimer = setTimeout(function () {
        status.textContent = '';
        status.classList.remove('pd-error', 'pd-success');
      }, 6000);
    }

    function setCopyState(state, message) {
      copyBusy = state === 'busy';
      copyButton.disabled = copyBusy;
      button.disabled = copyBusy || busy;
      copyButton.setAttribute('aria-busy', copyBusy ? 'true' : 'false');

      if (state === 'busy') {
        clearResetTimer();
        status.classList.remove('pd-error', 'pd-success');
        status.textContent = message || t('copyingToClipboard', 'Copying to clipboard\u2026');
      } else if (state === 'success') {
        showTemporaryStatus(message || t('videoCopied', 'Video copied to clipboard.'), 'pd-success');
      } else if (state === 'error') {
        showTemporaryStatus(message || t('copyFileFailed', 'Could not copy the video file.'), 'pd-error');
      } else {
        clearResetTimer();
        status.classList.remove('pd-error', 'pd-success');
        status.textContent = '';
      }
    }

    function setState(state, message) {
      clearResetTimer();
      status.classList.remove('pd-error', 'pd-success');
      busy = state === 'busy';
      button.disabled = busy;
      copyButton.disabled = busy || copyBusy;

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
      if (busy || copyBusy) return;
      onClick();
    });

    copyButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (busy || copyBusy || !onCopy) return;
      onCopy();
    });

    return {
      host: host,
      setState: setState,
      setCopyState: setCopyState,
      isBusy: function () { return busy; }
    };
  }

  root.PinDownloaderUI = { createButton: createButton };
})(typeof globalThis !== 'undefined' ? globalThis : this);
