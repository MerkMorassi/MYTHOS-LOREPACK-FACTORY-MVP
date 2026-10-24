// SYS.AI.MAYA.SESAME - optional: inlines reference/lorepack-player.js into inspector/inspector.src.html -> inspector/inspector.html.
// The output is the single file Merk opens. Nothing else happens here: no minify, no transpile.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'inspector', 'inspector.src.html'), 'utf8');
const reader = readFileSync(join(root, 'reference', 'lorepack-player.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
writeFileSync(join(root, 'inspector', 'inspector.html'), src.replace('<script>/*@READER@*/</script>', () => '<script>' + reader + '</script>'));
console.log('inspector/inspector.html written');
