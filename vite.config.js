import { copyFile, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const entryNames = ['index.html', 'ingex.html'];
const mime = { '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary' };

async function embedScene(bundle, directory) {
  const files = Object.values(bundle);
  const game = files.find(file => file.type === 'chunk' && file.isEntry);
  const stylesheet = files.find(file => file.type === 'asset' && file.fileName.endsWith('.css'));
  const css = Buffer.from(stylesheet.source).toString();
  let html = await readFile(join(directory, 'src/scene.html'), 'utf8');

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
    .replace(/\s*<script\b[^>]*src="[^"]+"[^>]*><\/script>/, '')
    .replace(/<link\b[^>]*rel="stylesheet"[^>]*>/, () => '<style>' + css + '</style>')
    .replace(/<p id="source-link">[\s\S]*?<\/p>/, () => '<details><summary>Исходные материалы</summary>' + sources + '</details>')
    .replace('</body>', () =>
      '<script id="scene-assets" type="application/json">' + JSON.stringify(assets) + '</script>\n' +
      '<script>' + script + '</script>\n</body>');
}

export default defineConfig({
  optimizeDeps: { entries: ['src/scene.html'] },
  build: {
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: {
      input: join(root, 'src/scene.html'),
      output: { format: 'iife', codeSplitting: false },
    },
  },
  plugins: [{
    name: 'standalone-scene',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        request.url = request.url?.replace(/^\/(?:index\.html|ingex\.html)?(?=\?|$)/, '/src/scene.html');
        next();
      });
    },
    async writeBundle({ dir }, bundle) {
      const html = await embedScene(bundle, dir);
      for (const name of entryNames) {
        const built = join(dir, name);
        const local = join(root, name);
        await writeFile(built, html);
        await copyFile(built, local + '.tmp');
        await rename(local + '.tmp', local);
      }
    },
  }],
});
