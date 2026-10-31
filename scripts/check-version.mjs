import fs from 'node:fs';

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
if (!match) {
  console.error(`Release tag must look like v1.2.3, got: ${tag || '(missing)'}`);
  process.exit(1);
}

const expected = match[1];
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

for (const [file, version] of [
  ['package.json', packageJson.version],
  ['manifest.json', manifest.version]
]) {
  if (version !== expected) {
    console.error(`${file} version is ${version}, but tag is ${tag}`);
    process.exit(1);
  }
}

console.log(`Version ${expected} matches package.json and manifest.json`);
