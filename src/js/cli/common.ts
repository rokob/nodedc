import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

export function parseInteger(value: string | undefined, flagName: string): number {
  if (!value) {
    fail(`Missing value for ${flagName}.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    fail(`Invalid integer for ${flagName}: ${value}`);
  }
  return parsed;
}

export interface SampleFile {
  readonly path: string;
  readonly size: number;
}

export function walkSamples(inputPaths: readonly string[]): SampleFile[] {
  const samples: SampleFile[] = [];

  const visit = (currentPath: string): void => {
    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      const entries = readdirSync(currentPath).sort((a, b) => a.localeCompare(b));
      for (const entry of entries) {
        visit(path.join(currentPath, entry));
      }
      return;
    }
    if (stats.isFile()) {
      samples.push({ path: currentPath, size: stats.size });
    }
  };

  for (const inputPath of inputPaths) {
    visit(path.resolve(inputPath));
  }

  if (samples.length === 0) {
    fail('No sample files were found.');
  }

  return samples;
}

export function sampleBuffers(samples: readonly SampleFile[]): Buffer[] {
  return samples.map((sample) => readFileSync(sample.path));
}

export function writeOutput(outputPath: string, dictionary: Buffer, metadataPath: string, metadata: object): void {
  ensureParentDir(outputPath);
  ensureParentDir(metadataPath);
  writeFileSync(outputPath, dictionary);
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}
