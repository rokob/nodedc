import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const packageRoot = process.cwd();
const platform = process.env.PREBUILD_PLATFORM || os.platform();
const arch = process.env.PREBUILD_ARCH || os.arch();
const tupleDir = path.join(packageRoot, 'prebuilds', `${platform}-${arch}`);
const releaseDir = path.join(packageRoot, 'build', 'Release');
const runtimeTarget = path.join(tupleDir, 'nodedc.node');
const trainingSource = path.join(releaseDir, 'nodedc_train.node');
const trainingTarget = path.join(tupleDir, 'nodedc_train.node');

await run('npx', ['prebuildify', '--napi', '--strip', '--name', 'nodedc']);

await mkdir(tupleDir, { recursive: true });
await copyFile(trainingSource, trainingTarget);
await stripIfSupported(trainingTarget);
await ensureFile(runtimeTarget);
await ensureFile(trainingTarget);

async function ensureFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Expected a file at ${filePath}`);
  }
}

async function stripIfSupported(filePath) {
  if (platform === 'darwin') {
    await run('strip', [filePath, '-Sx']);
    return;
  }

  if (platform === 'linux') {
    await run('strip', [filePath, '--strip-all']);
  }
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code ?? 'unknown'}`));
    });
  });
}
