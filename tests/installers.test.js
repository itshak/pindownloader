const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HOST_NAME = 'com.pindownloader.clipboard';
const DEFAULT_ID = 'cgfebhkdcjiikipcinokgmboblpehomk';
const CHROME_ID = 'a'.repeat(32);
const EDGE_ID = 'b'.repeat(32);

function readManifest(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function extensionIdFromKey(key) {
  const hash = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  let id = '';
  for (let i = 0; i < 16; i += 1) {
    id += 'abcdefghijklmnop'[hash[i] >> 4];
    id += 'abcdefghijklmnop'[hash[i] & 15];
  }
  return id;
}

test('manifest key fixes the extension ID used by every installer', () => {
  const manifest = readManifest(path.join(ROOT, 'manifest.json'));
  assert.equal(extensionIdFromKey(manifest.key), DEFAULT_ID);
  for (const script of [
    'native/windows/install-windows.ps1',
    'native/macos/install-macos.sh',
    'native/linux/install-linux.sh'
  ]) {
    const source = fs.readFileSync(path.join(ROOT, script), 'utf8');
    assert.ok(source.includes(DEFAULT_ID), `${script} must default to the manifest extension ID`);
    assert.ok(!source.includes('Read-Host'), `${script} must not prompt with Read-Host`);
    assert.ok(!source.includes('ask_id'), `${script} must not prompt for an extension ID`);
    assert.ok(!source.includes('select_browser'), `${script} must not prompt for a browser`);
  }
});

function runInstaller(script, args, env) {
  execFileSync('bash', [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'pipe'
  });
}

test('Linux installer defaults to the built-in ID and both browsers', () => {
  if (process.platform !== 'linux') return;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pindownloader-linux-default-'));
  const env = {
    HOME: path.join(root, 'home'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data')
  };
  fs.mkdirSync(env.HOME);
  const script = path.join(ROOT, 'native', 'linux', 'install-linux.sh');
  const chromeManifest = path.join(env.XDG_CONFIG_HOME, 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
  const edgeManifest = path.join(env.XDG_CONFIG_HOME, 'microsoft-edge', 'NativeMessagingHosts', `${HOST_NAME}.json`);

  try {
    runInstaller(script, ['--helper', '/bin/true'], env);

    assert.deepEqual(readManifest(chromeManifest).allowed_origins, [
      `chrome-extension://${DEFAULT_ID}/`
    ]);
    assert.deepEqual(readManifest(edgeManifest).allowed_origins, [
      `chrome-extension://${DEFAULT_ID}/`
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS installer defaults to the built-in ID and both browsers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pindownloader-macos-default-'));
  const env = { HOME: path.join(root, 'home') };
  fs.mkdirSync(env.HOME);
  const script = path.join(ROOT, 'native', 'macos', 'install-macos.sh');
  const chromeManifest = path.join(
    env.HOME,
    'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`
  );
  const edgeManifest = path.join(
    env.HOME,
    'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts', `${HOST_NAME}.json`
  );

  try {
    runInstaller(script, ['--helper', '/bin/true'], env);

    assert.deepEqual(readManifest(chromeManifest).allowed_origins, [
      `chrome-extension://${DEFAULT_ID}/`
    ]);
    assert.deepEqual(readManifest(edgeManifest).allowed_origins, [
      `chrome-extension://${DEFAULT_ID}/`
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux installer registers Chrome and Edge and removes them independently', () => {
  if (process.platform !== 'linux') return;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pindownloader-linux-installer-'));
  const env = {
    HOME: path.join(root, 'home'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'data')
  };
  fs.mkdirSync(env.HOME);
  const script = path.join(ROOT, 'native', 'linux', 'install-linux.sh');
  const chromeManifest = path.join(env.XDG_CONFIG_HOME, 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
  const edgeManifest = path.join(env.XDG_CONFIG_HOME, 'microsoft-edge', 'NativeMessagingHosts', `${HOST_NAME}.json`);
  const installDir = path.join(env.XDG_DATA_HOME, 'PinDownloader', 'native');

  try {
    runInstaller(script, [
      '--browser', 'both',
      '--chrome-id', CHROME_ID,
      '--edge-id', EDGE_ID,
      '--helper', '/bin/true'
    ], env);

    const chrome = readManifest(chromeManifest);
    const edge = readManifest(edgeManifest);
    assert.deepEqual(chrome.allowed_origins, [
      `chrome-extension://${CHROME_ID}/`,
      `chrome-extension://${EDGE_ID}/`
    ]);
    assert.deepEqual(edge.allowed_origins, chrome.allowed_origins);
    assert.equal(chrome.path, path.join(installDir, 'PinDownloaderClipboard'));
    assert.ok(fs.existsSync(chrome.path));

    runInstaller(script, ['--browser', 'chrome', '--uninstall'], env);
    assert.equal(fs.existsSync(chromeManifest), false);
    assert.ok(fs.existsSync(edgeManifest));
    assert.ok(fs.existsSync(installDir));

    runInstaller(script, ['--browser', 'both', '--uninstall'], env);
    assert.equal(fs.existsSync(edgeManifest), false);
    assert.equal(fs.existsSync(installDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS installer registers Chrome and Edge with separate IDs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pindownloader-macos-installer-'));
  const env = { HOME: path.join(root, 'home') };
  fs.mkdirSync(env.HOME);
  const script = path.join(ROOT, 'native', 'macos', 'install-macos.sh');
  const chromeManifest = path.join(
    env.HOME,
    'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`
  );
  const edgeManifest = path.join(
    env.HOME,
    'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts', `${HOST_NAME}.json`
  );

  try {
    runInstaller(script, [
      '--browser', 'both',
      '--chrome-id', CHROME_ID,
      '--edge-id', EDGE_ID,
      '--helper', '/bin/true'
    ], env);

    assert.deepEqual(readManifest(chromeManifest).allowed_origins, [
      `chrome-extension://${CHROME_ID}/`,
      `chrome-extension://${EDGE_ID}/`
    ]);
    assert.deepEqual(readManifest(edgeManifest).allowed_origins, [
      `chrome-extension://${CHROME_ID}/`,
      `chrome-extension://${EDGE_ID}/`
    ]);

    runInstaller(script, ['--browser', 'edge', '--uninstall'], env);
    assert.ok(fs.existsSync(chromeManifest));
    assert.equal(fs.existsSync(edgeManifest), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
