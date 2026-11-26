// Build-time only. No user descriptions or credentials are sent to a service.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'models', 'minilm');
const revision = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41';
const base = `https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/${revision}`;
const files = [
  ['config.json', 612, '953f9c0d463486b10a6871cc2fd59f223b2c70184f49815e7efbcab5d8908b41'],
  ['tokenizer.json', 466247, 'be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037'],
  ['model.safetensors', 90868376, '53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db'],
  ['README.md', 10502, 'dcd602d2fd35c203a247304a06fec6654a12f7941b739f9221a064fe8dc3b7f0'],
];
async function verified(filename, size, expected) {
  try {
    if ((await stat(filename)).size !== size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex') === expected;
  } catch { return false; }
}
await mkdir(directory, { recursive: true });
for (const [name, size, expected] of files) {
  const destination = path.join(directory, name);
  if (await verified(destination, size, expected)) continue;
  console.log(`Preparing local semantic search: ${name} (${Math.ceil(size / 1024 / 1024)} MB)`);
  const temporary = `${destination}.${process.pid}.tmp`;
  const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error(`Model download failed: HTTP ${response.status}`);
  const handle = await open(temporary, 'wx');
  const hash = createHash('sha256');
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += chunk.length;
      if (received > size) throw new Error(`Model ${name} exceeds its pinned size`);
      hash.update(chunk);
      await handle.writeFile(chunk);
    }
    if (received !== size || hash.digest('hex') !== expected) throw new Error(`Model ${name} failed SHA-256 verification`);
    await handle.sync();
    await handle.close();
    await rename(temporary, destination);
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}
await copyFile(path.join(root, 'licenses', 'MiniLM-APACHE-2.0.txt'), path.join(directory, 'LICENSE'));
console.log(`Local MiniLM model verified at revision ${revision}.`);
