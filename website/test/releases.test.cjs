const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/releases.js');
const { classifyAsset, describeRelease, getRelease } = handler;
const asset = name => ({ name, browser_download_url: `https://github.com/ArneshBanerjee/memeIT/releases/download/v0.1.0/${name}`, state: 'uploaded', size: 2048 });
const release = (prerelease = false) => ({ tag_name: 'v0.1.0', published_at: '2026-11-26T00:00:00Z', draft: false, prerelease, html_url: 'https://github.com/ArneshBanerjee/memeIT/releases/tag/v0.1.0', assets: [asset('MemeIT_0.1.0_aarch64.dmg')] });
test('recognizes actual Tauri installers and excludes update/source artifacts', () => {
  for (const [name, platform, architecture] of [['MemeIT_0.1.0_aarch64.dmg', 'macos', 'arm64'], ['MemeIT_0.1.0_x64.dmg', 'macos', 'x64'], ['MemeIT_0.1.0_x64-setup.exe', 'windows', 'x64'], ['MemeIT_0.1.0_amd64.AppImage', 'linux', 'x64'], ['MemeIT_0.1.0_amd64.deb', 'linux', 'x64']]) {
    const result = classifyAsset(asset(name)); assert.equal(result.platform, platform); assert.equal(result.architecture, architecture);
  }
  for (const name of ['MemeIT.app.tar.gz', 'MemeIT.dmg.sig', 'latest.json', 'source.zip', 'MemeIT.dmg']) assert.equal(classifyAsset(asset(name)), null);
  assert.equal(classifyAsset({ ...asset('MemeIT_x64.dmg'), browser_download_url: 'https://evil.example/MemeIT_x64.dmg' }), null);
  assert.equal(classifyAsset({ ...asset('MemeIT_x64.dmg'), state: 'open' }), null);
});
test('uses stable release when available', async () => {
  const result = await getRelease(async () => ({ ok: true, status: 200, json: async () => release() }));
  assert.equal(result.channel, 'stable'); assert.equal(result.assets.length, 1);
});
test('handles first prerelease without inventing a stable release', async () => {
  let calls = 0;
  const result = await getRelease(async () => ++calls === 1 ? { status: 404 } : { ok: true, json: async () => [{ ...release(), draft: true }, release(true)] });
  assert.equal(result.channel, 'preview'); assert.equal(result.available, true);
});
test('an empty repository has no downloadable artifacts', async () => {
  let calls = 0;
  const result = await getRelease(async () => ++calls === 1 ? { status: 404 } : { ok: true, json: async () => [] });
  assert.equal(result.available, false); assert.deepEqual(result.assets, []);
});
test('upstream limits remain an error instead of masquerading as no release', async () => {
  await assert.rejects(getRelease(async () => ({ status: 403, ok: false })), /unavailable/);
});
test('malformed and credential-bearing asset URLs cannot become downloads', () => {
  for (const value of [null, {}, { ...asset('MemeIT_x64.dmg'), browser_download_url: 'https://credential@github.com/ArneshBanerjee/memeIT/releases/download/v0.1.0/MemeIT_x64.dmg' }, { ...asset('MemeIT_x64.dmg'), size: '2048' }]) assert.equal(classifyAsset(value), null);
  const result = describeRelease({ ...release(), html_url: 'https://evil.example/', assets: [null, asset('MemeIT_x64.dmg'), { name: 'SHA256SUMS.txt', size: 50, state: 'uploaded', browser_download_url: 'https://evil.example/sums' }] });
  assert.equal(result.assets.length, 1); assert.equal(result.checksums, null); assert.equal(result.url, 'https://github.com/ArneshBanerjee/memeIT/releases');
});
test('invalid or draft latest responses are rejected', async () => {
  for (const value of [null, {}, { ...release(), draft: true }, { ...release(), published_at: 'not a date' }]) {
    await assert.rejects(getRelease(async () => ({ ok: true, status: 200, json: async () => value })), /Invalid published release/);
  }
});
test('HTTP handler emits a non-cacheable fallback without leaking upstream details', async () => {
  const previous = global.fetch; global.fetch = async () => { throw new Error('private internal detail'); };
  const headers = {}; let status, body;
  const response = { setHeader(key, value) { headers[key] = value; }, status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  try { await handler({}, response); } finally { global.fetch = previous; }
  assert.equal(status, 503); assert.equal(headers['Cache-Control'], 'no-store'); assert.equal(body.available, false); assert.equal(JSON.stringify(body).includes('private internal detail'), false);
});
