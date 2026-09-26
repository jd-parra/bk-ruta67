// shared/ lo copia la app React Native: no puede depender de APIs de Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const CARPETA = new URL('../', import.meta.url);
const PROHIBIDO = [
  /\bBuffer\b/,
  /\bprocess\./,
  /\brequire\(/,
  /from ['"]node:/,
  /from ['"](fs|path|crypto|os|http)['"]/,
];
const IMPORTS_PERMITIDOS = /^from\s+['"](\.\/[\w.]+|tweetnacl)['"]$/;

const archivos = readdirSync(CARPETA).filter((nombre) => nombre.endsWith('.js'));

for (const nombre of archivos) {
  test(`${nombre} es JS puro`, () => {
    const codigo = sinComentarios(readFileSync(new URL(nombre, CARPETA), 'utf8'));
    for (const patron of PROHIBIDO) {
      assert.doesNotMatch(codigo, patron, `${nombre} usa algo de Node: ${patron}`);
    }
    for (const [importacion] of codigo.matchAll(/from\s+['"][^'"]+['"]/g)) {
      assert.match(
        importacion,
        IMPORTS_PERMITIDOS,
        `${nombre}: import no permitido → ${importacion}`,
      );
    }
  });
}

function sinComentarios(codigo) {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
