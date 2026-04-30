// The worker module has no public TypeScript surface — it's a
// side-effect-only service-worker bundle the consumer serves as a
// static asset. Drop a hand-written declaration stub so the package's
// `./worker` exports map still resolves cleanly under `moduleResolution:
// "Bundler"` when consumers reference the path via a `?url` import or
// `import.meta.resolve`.
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const target = resolve(HERE, '..', 'dist', 'worker.d.ts');
await writeFile(target, 'export {};\n', 'utf8');
