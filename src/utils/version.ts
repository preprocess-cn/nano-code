import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 从 src/utils/ 或 dist/utils/ 两级上到项目根目录
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'),
);

export function getPackageVersion(): string {
  return pkg.version;
}

export function getPackageName(): string {
  return pkg.name;
}
