import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const root = fileURLToPath(new URL('../', import.meta.url))
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg',
}
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const filename = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname))
    if (!filename.startsWith(root)) {
      response.writeHead(403).end()
      return
    }
    const body = await readFile(filename)
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' })
    response.end(body)
  } catch {
    response.writeHead(404).end()
  }
})
server.listen(Number(process.env.PORT || 4174), '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${server.address().port}`)
})
