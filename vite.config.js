import { copyFile, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const entryName = 'ingex.html';
const mime = { '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary' };

async function embedScene(bundle, directory) {
  const files = Object.values(bundle);
  const game = files.find(file => file.type === 'chunk' && file.isEntry);
  const stylesheet = files.find(file => file.type === 'asset' && file.fileName.endsWith('.css'));
  const css = Buffer.from(stylesheet.source).toString();
  let html = await readFile(join(directory, 'index.html'), 'utf8');

  const assets = {};
  for (const folder of ['car', 'road', 'light']) {
    const names = await readdir(join(root, 'public', folder));
    for (const name of names.sort()) {
      const type = mime[extname(name)];
      if (!type) continue;
      const url = posix.join('/', folder, name);
      const contents = await readFile(join(root, 'public', folder, name), 'base64');
      const data = 'data:' + type + ';base64,' + contents;
      if (html.includes('"' + url + '"')) {
        html = html.replaceAll('"' + url + '"', () => '"' + data + '"');
      } else {
        assets[url] = data;
      }
    }
  }

  const credits = await readFile(join(root, 'public', 'credits.html'), 'utf8');
  const sources = credits.match(/<ul>[\s\S]*?<\/ul>/)[0];
  const script = game.code.replace(/<\/script/gi, '<\\/script');
  return html
    .replace(/\s*<script id="file-entry">[\s\S]*?<\/script>/, '')
    .replace(/\s*<script\b[^>]*src="[^"]+"[^>]*><\/script>/, '')
    .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/, () => '<style>' + css + '</style>')
    .replace(/<p id="source-link">[\s\S]*?<\/p>/, () => '<details><summary>Исходные материалы</summary>' + sources + '</details>')
    .replace('</body>', () =>
      '<script id="scene-assets" type="application/json">' + JSON.stringify(assets) + '</script>\n' +
      '<script>' + script + '</script>\n</body>');
}

export default defineConfig({
  build: {
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: { output: { format: 'iife', codeSplitting: false } },
  },
  plugins: [{
    name: 'standalone-scene',
    configureServer(server) {
      // Serve the live source at the same address during development.
      server.middlewares.use((request, _response, next) => {
        request.url = request.url?.replace(/^\/ingex\.html(?=\?|$)/, '/index.html');
        next();
      });
    },
    async writeBundle({ dir }, bundle) {
      const built = join(dir, entryName);
      const local = join(root, entryName);
      await writeFile(built, await embedScene(bundle, dir));
      await copyFile(built, local + '.tmp');
      await rename(local + '.tmp', local);
    },
  }],
});
