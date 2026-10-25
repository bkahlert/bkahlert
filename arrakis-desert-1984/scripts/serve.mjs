import process from 'node:process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Starts a loopback static server rooted at this independently copyable project. */
export async function serve(port = 0) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const types = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.json': 'application/json', '.txt': 'text/plain',
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const target = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
      if (!target.startsWith(root.endsWith(sep) ? root : root + sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(target);
      response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await serve(Number(process.env.PORT || 4185));
  console.log(`Arrakis desert: http://127.0.0.1:${server.address().port}`);
}
