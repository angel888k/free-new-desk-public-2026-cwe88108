import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const inFlight = new Map();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = file => lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
async function hashFile(file) {
  if (!(await lstat(file)).isFile()) throw new Error(`Build tool must be a regular file: ${file}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function treeFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await treeFiles(directory, relative));
    else if (entry.isFile()) files.push({ path: relative, sha256: await hashFile(path.join(directory, relative)) });
    else throw new Error(`Build tool bundle contains a link or special file: ${relative}`);
  }
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
async function validateTool(directory, source, wholeTree) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Build tool cache must be a regular directory');
  if (wholeTree) {
    if (digest(JSON.stringify(await treeFiles(directory))) !== source.treeSha256) throw new Error('NSIS cached bundle SHA256 mismatch');
  } else if (await hashFile(path.join(directory, source.executable)) !== source.executableSha256) {
    throw new Error('7-Zip executable SHA256 mismatch');
  }
}
async function removeTemporary(work, cache) {
  if (path.dirname(path.resolve(work)) !== path.resolve(cache) || !path.basename(work).startsWith('.prepare-')) throw new Error('Refusing build tool cleanup outside its temporary directory');
  await rm(work, { recursive: true, force: true });
}
async function prepareArchive(cache, name, source, wholeTree = false) {
  const directory = path.join(cache, name);
  if (await exists(directory)) { await validateTool(directory, source, wholeTree); return directory; }
  await mkdir(cache, { recursive: true });
  const work = await mkdtemp(path.join(cache, '.prepare-'));
  try {
    const extension = new URL(source.url).pathname.endsWith('.7z') ? '.7z' : new URL(source.url).pathname.endsWith('.tar.xz') ? '.tar.xz' : '.tar.gz';
    const cachedArchive = path.join(cache, `${source.archiveSha256}${extension}`);
    const archive = path.join(work, 'archive' + extension);
    if (await exists(cachedArchive)) await copyFile(cachedArchive, archive);
    else {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`Build tool download failed: HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    }
    if (await hashFile(archive) !== source.archiveSha256) throw new Error('Build tool archive SHA256 mismatch');
    const extracted = path.join(work, 'extracted');
    await mkdir(extracted);
    // Bootstrap with platform tar, never electron-builder's vulnerable default 7za.
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    execFileSync(tar, ['-xf', archive, '-C', extracted, ...(wholeTree ? ['--strip-components=1'] : [])], { windowsHide: true });
    await validateTool(extracted, source, wholeTree);
    if (!wholeTree && process.platform !== 'win32') await chmod(path.join(extracted, source.executable), 0o755);
    await copyFile(archive, cachedArchive);
    try { await rename(extracted, directory); }
    catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code) || !(await exists(directory))) throw error;
      await validateTool(directory, source, wholeTree);
    }
    return directory;
  } finally {
    await removeTemporary(work, cache);
  }
}
export async function prepareBuilderTools(root = repository, { nsis = process.platform === 'win32' } = {}) {
  root = path.resolve(root);
  const key = `${root}:${nsis}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const task = (async () => {
    const source = JSON.parse(await readFile(path.join(root, 'third_party/build-tools/SOURCE.json'), 'utf8'));
    const platform = `${process.platform}-${process.arch}`, sevenZipSource = source.sevenZip.platforms[platform];
    if (!sevenZipSource) throw new Error(`Pinned build tools do not support ${platform}`);
    const cache = path.join(root, 'third_party/build-tools/cache');
    const sevenZipDir = await prepareArchive(cache, `7zip-${source.sevenZip.version}-${platform}`, sevenZipSource);
    const sevenZipPath = path.join(sevenZipDir, sevenZipSource.executable);
    let nsisDir;
    if (nsis) {
      const bundle = await prepareArchive(cache, `nsis-${source.nsis.toolset}`, source.nsis, true);
      nsisDir = path.join(cache, `nsis-${source.nsis.toolset}-windows`);
      const nativeSource = { treeSha256: source.nsis.windowsTreeSha256 };
      if (!await exists(nsisDir)) {
        // Node cannot spawn the bundle's .cmd entrypoint. Use its unchanged
        // native Windows layout plus its own elevate helper, with a pinned tree.
        const work = await mkdtemp(path.join(cache, '.prepare-'));
        try {
          const native = path.join(work, 'native');
          await cp(path.join(bundle, 'windows'), native, { recursive: true });
          await copyFile(path.join(bundle, 'elevate.exe'), path.join(native, 'elevate.exe'));
          await validateTool(native, nativeSource, true);
          await rename(native, nsisDir);
        } finally { await removeTemporary(work, cache); }
      }
      await validateTool(nsisDir, nativeSource, true);
    }
    return { sevenZipPath, ...(nsisDir ? { nsisDir } : {}), versions: { sevenZip: source.sevenZip.version, nsis: source.nsis.version, nsisToolset: source.nsis.toolset } };
  })();
  inFlight.set(key, task);
  try { return await task; } finally { inFlight.delete(key); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await prepareBuilderTools(), null, 2));
