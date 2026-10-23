import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBuilderTools } from './prepare-builder-tools.mjs';
import {verifyWindowsIcons} from './verify-windows-icons.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
export function windowsPackageArguments(args) {
  const signed = args.includes('--signed');
  if(args.includes('--config.win.signAndEditExecutable=false'))throw new Error('Keep executable icon resource editing enabled; use signExecutable=false for unsigned builds');
  return { signed, args: ['--win', 'nsis', 'portable', '--x64', '--publish', 'never', ...(signed ? ['--config.forceCodeSigning=true'] : ['--config.win.signExecutable=false']), ...args.filter(arg => arg !== '--signed')] };
}
async function run(file, args, env) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => signal ? reject(new Error(`Packaging terminated: ${signal}`)) : resolve(code));
  });
  if (code !== 0) throw new Error(`Packaging command failed: exit ${code}`);
}
export async function packageWindows(args = process.argv.slice(2)) {
  if (process.platform !== 'win32') throw new Error('This packaging wrapper requires Windows');
  const { signed, args: builderArgs } = windowsPackageArguments(args);
  const tools = await prepareBuilderTools(root, { nsis: true });
  const env = { ...process.env, ELECTRON_BUILDER_7ZIP_PATH: tools.sevenZipPath, ELECTRON_BUILDER_NSIS_DIR: tools.nsisDir, ELECTRON_BUILDER_NSIS_RESOURCES_DIR: tools.nsisDir, ELECTRON_BUILDER_CACHE: path.join(root, 'third_party/build-tools/cache/electron-builder') };
  const output = args.findLast(arg => arg.startsWith('--config.directories.output='));
  if (output) env.FND_RELEASE_DIR = output.slice('--config.directories.output='.length);
  await run(process.execPath, [path.join(root, 'scripts/release-manifest.mjs'), '--prepare'], env);
  await run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), ...builderArgs], env);
  const outDir=path.resolve(root,env.FND_RELEASE_DIR||'dist/releases');
  console.log(JSON.stringify(await verifyWindowsIcons([path.join(outDir,'win-unpacked','Free New Desk.exe')],path.join(root,'assets/app-icon.ico'))));
  await run(process.execPath, [path.join(root, 'scripts/release-manifest.mjs'), ...(signed ? ['--signed'] : [])], env);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packageWindows();
