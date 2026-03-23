import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const packageRoot = process.cwd();
const prebuildsRoot = path.join(packageRoot, 'prebuilds');
const tuples = await readdir(prebuildsRoot, { withFileTypes: true }).catch(() => []);

if (tuples.length === 0) {
  throw new Error('No prebuilds were found.');
}

for (const entry of tuples) {
  if (!entry.isDirectory()) {
    continue;
  }

  const tupleDir = path.join(prebuildsRoot, entry.name);
  await assertNodeFile(path.join(tupleDir, 'nodedc.node'));
  await assertNodeFile(path.join(tupleDir, 'nodedc_train.node'));
}

async function assertNodeFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error(`Expected a prebuilt binary at ${filePath}`);
  }
}
