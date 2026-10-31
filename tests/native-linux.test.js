const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const HELPER = process.env.NATIVE_HELPER || path.join('dist', 'linux-x64', 'PinDownloaderClipboard');

class FrameReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
  }

  async fill(count) {
    while (this.buffer.length < count) {
      const { value, done } = await this.iterator.next();
      if (done) throw new Error('Native helper closed stdout unexpectedly.');
      this.buffer = Buffer.concat([this.buffer, value]);
    }
  }

  async read() {
    await this.fill(4);
    const length = this.buffer.readUInt32LE(0);
    await this.fill(4 + length);
    const body = this.buffer.subarray(4, 4 + length);
    this.buffer = this.buffer.subarray(4 + length);
    return JSON.parse(body.toString('utf8'));
  }
}

function send(stream, message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  stream.write(Buffer.concat([header, body]));
}

test('Linux native helper handles ping, file copy, and invalid paths', { timeout: 15000 }, async () => {
  if (process.platform !== 'linux') return;

  const helperPath = path.resolve(HELPER);
  assert.ok(fs.existsSync(helperPath), `Build the Linux helper first: ${helperPath}`);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pindownloader-native-'));
  const binDir = path.join(root, 'bin');
  const capturePath = path.join(root, 'clipboard.txt');
  const videoPath = path.join(root, 'video with spaces.mp4');
  fs.mkdirSync(binDir);
  fs.writeFileSync(videoPath, 'fake mp4 bytes');
  fs.writeFileSync(
    path.join(binDir, 'wl-copy'),
    '#!/bin/sh\ncat > "$PINDL_CAPTURE"\n',
    { mode: 0o755 }
  );

  const child = spawn(helperPath, [], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH || ''}`,
      WAYLAND_DISPLAY: 'wayland-test',
      PINDL_CAPTURE: capturePath
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const reader = new FrameReader(child.stdout);
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    send(child.stdin, { action: 'ping' });
    const ping = await reader.read();
    assert.equal(ping.ok, true);
    assert.equal(ping.platform, 'linux');

    send(child.stdin, { action: 'copyFile', path: videoPath });
    const copied = await reader.read();
    assert.equal(copied.ok, true, copied.error);
    assert.equal(copied.path, videoPath);
    assert.equal(copied.bytes, 14);

    const captured = fs.readFileSync(capturePath, 'utf8');
    assert.equal(captured, `${pathToFileURL(videoPath).href}\r\n`);

    send(child.stdin, { action: 'copyFile', path: path.join(root, 'missing.mp4') });
    const missing = await reader.read();
    assert.equal(missing.ok, false);
    assert.match(missing.error, /not found/i);
  } finally {
    child.stdin.end();
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(stderr, '');
  }
});
