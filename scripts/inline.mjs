// docs/index.html의 JS·CSS를 본문에 넣어 더블클릭(file://)으로 열 수 있는 단일 HTML을 만든다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'docs');
const out = join(root, '붕당.html');

let html = readFileSync(join(dist, 'index.html'), 'utf8');
const read = (src) => readFileSync(join(dist, src.replace(/^(\/bungdang)?\.?\//, '')), 'utf8');

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>\n${read(href)}\n</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const js = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});

if (/src="\/assets|href="\/assets/.test(html)) throw new Error('인라인하지 못한 자산이 남아 있다');
writeFileSync(out, html);
console.log(`만들었다: ${out} (${Math.round(html.length / 1024)} KB)`);
