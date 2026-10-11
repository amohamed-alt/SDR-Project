import fs from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let serial = 0;
/** Execute actual route code with explicit adapters; no regex-only safety assertions. */
export async function loadRoute(path, adapters) {
  const slot = `__sdrRouteTest${serial++}`;
  globalThis[slot] = adapters;
  let output = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  output = output.replace(/import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];/g, (_all, names, specifier) => {
    if (!adapters[specifier]) { if (specifier.startsWith("@/")) throw new Error(`Missing route adapter: ${specifier}`); return _all; }
    return `const {${names.replace(/\bas\b/g, ':')}} = globalThis[${JSON.stringify(slot)}][${JSON.stringify(specifier)}];`;
  });
  output = output.replace(/from ["']next\/server["']/g, `from ${JSON.stringify(pathToFileURL(require.resolve('next/server.js')).href)}`)
    .replace(/from ["']zod["']/g, `from ${JSON.stringify(pathToFileURL(require.resolve('zod')).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}
