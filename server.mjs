import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.MACHIMPYO_PORT || 4187);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('MACHIMPYO_PORT must be an integer between 1 and 65535.');
  process.exit(1);
}
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function respond(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  if (process.env.MACHIMPYO_REQUEST_LOG === '1') {
    const resourcePath = (req.url || '/').split('?')[0];
    console.log(`${req.method} ${resourcePath}`);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    respond(res, 405, 'Method not allowed. This server only serves static app files.');
    return;
  }
  try {
    const decoded = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') ||
        decoded.split('/').some(segment => segment === '..' || segment.startsWith('.'))) {
      respond(res, 403, 'Forbidden');
      return;
    }
    let filename = path.resolve(root, `.${decoded}`);
    if (filename !== root && !filename.startsWith(root + path.sep)) {
      respond(res, 403, 'Forbidden');
      return;
    }
    const info = await stat(filename);
    if (info.isDirectory()) filename = path.join(filename, 'index.html');
    const actual = await realpath(filename);
    if (!actual.startsWith(root + path.sep)) {
      respond(res, 403, 'Forbidden');
      return;
    }
    const mime = mimeTypes[path.extname(actual).toLowerCase()];
    if (!mime) {
      respond(res, 404, 'Not found');
      return;
    }
    const actualInfo = await stat(actual);
    if (!actualInfo.isFile()) {
      respond(res, 404, 'Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': actualInfo.size });
    if (req.method === 'HEAD') res.end();
    else {
      const stream = createReadStream(actual);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    }
  } catch (error) {
    respond(res, error instanceof URIError ? 400 : 404,
      error instanceof URIError ? 'Invalid URL encoding' : 'Not found');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Close the other server, or set MACHIMPYO_PORT.`
    : `Unable to start server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Machimpyo: http://127.0.0.1:${port}`);
  console.log('Press Ctrl+C to stop. Submission files stay in your browser.');
});
