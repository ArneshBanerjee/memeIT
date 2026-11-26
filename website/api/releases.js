const REPOSITORY = 'ArneshBanerjee/memeIT';
const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;

function repositoryUrl(value, suffix) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port &&
      url.pathname.startsWith(`/${REPOSITORY}/releases/${suffix}/`) ? url.href : null;
  } catch { return null; }
}

function classifyAsset(asset) {
  if (!asset || typeof asset !== 'object') return null;
  const name = typeof asset.name === 'string' ? asset.name : '';
  const url = repositoryUrl(asset.browser_download_url, 'download');
  if (!url) return null;
  let platform, architecture, format;
  if (/\.dmg$/i.test(name)) {
    platform = 'macos'; format = 'DMG';
    architecture = /aarch64|arm64/i.test(name) ? 'arm64' : /x64|x86_64|amd64/i.test(name) ? 'x64' : /universal/i.test(name) ? 'universal' : null;
  } else if (/-setup\.exe$|\.msi$/i.test(name)) {
    platform = 'windows'; format = /\.msi$/i.test(name) ? 'MSI' : 'EXE';
    architecture = /aarch64|arm64/i.test(name) ? 'arm64' : /x64|x86_64|amd64/i.test(name) ? 'x64' : null;
  } else if (/\.AppImage$|\.deb$|\.rpm$/i.test(name)) {
    platform = 'linux'; format = /\.AppImage$/i.test(name) ? 'AppImage' : /\.deb$/i.test(name) ? 'DEB' : 'RPM';
    architecture = /aarch64|arm64/i.test(name) ? 'arm64' : /x64|x86_64|amd64/i.test(name) ? 'x64' : null;
  }
  if (!platform || !architecture || asset.state !== 'uploaded' || !Number.isFinite(asset.size) || !(asset.size > 0)) return null;
  return { name, url, platform, architecture, format, size: asset.size,
    sha256: typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/i.test(asset.digest) ? asset.digest.slice(7) : null };
}

function describeRelease(release) {
  if (!release || typeof release !== 'object' || typeof release.tag_name !== 'string' ||
      typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at)) || release.draft) {
    throw new Error('Invalid published release');
  }
  const assets = (Array.isArray(release.assets) ? release.assets : []).map(classifyAsset).filter(Boolean);
  const checksum = (Array.isArray(release.assets) ? release.assets : []).find(asset => asset?.name === 'SHA256SUMS.txt' && asset.state === 'uploaded' && asset.size > 0);
  const checksumUrl = checksum?.browser_download_url;
  return {
    available: assets.length > 0,
    version: release.tag_name,
    channel: release.prerelease ? 'preview' : 'stable',
    publishedAt: release.published_at,
    url: repositoryUrl(release.html_url, 'tag') || RELEASES_URL,
    checksums: repositoryUrl(checksumUrl, 'download'),
    assets,
  };
}

async function getRelease(fetchImpl = fetch) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'MemeIT-downloads' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const request = async path => fetchImpl(`https://api.github.com/repos/${REPOSITORY}${path}`, {
    headers, signal: AbortSignal.timeout(8000),
  });
  let response = await request('/releases/latest');
  if (response.status === 404) {
    response = await request('/releases?per_page=20');
    if (!response.ok) throw new Error('Release service unavailable');
    const releases = await response.json();
    if (!Array.isArray(releases)) throw new Error('Invalid release response');
    const published = releases.filter(release => release && !release.draft && release.published_at);
    const release = published.find(release => !release.prerelease) || published[0];
    return release ? describeRelease(release) : { available: false, channel: 'preview', url: RELEASES_URL, assets: [] };
  }
  if (!response.ok) throw new Error('Release service unavailable');
  const release = await response.json();
  return describeRelease(release);
}

async function handler(_req, res) {
  try {
    const release = await getRelease();
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
    return res.status(200).json(release);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ available: false, error: 'Release information is temporarily unavailable.', url: RELEASES_URL, assets: [] });
  }
}

module.exports = handler;
module.exports.classifyAsset = classifyAsset;
module.exports.describeRelease = describeRelease;
module.exports.getRelease = getRelease;
