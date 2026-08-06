const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const root = __dirname;
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const rawPath = decodeURIComponent(req.url.split('?')[0]);
  const requested = rawPath === '/' ? '/index.html' : rawPath;
  const safePath = path.normalize(requested).replace(/^([.][.][/\\])+/, '');
  let filePath = path.join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (statErr, stat) => {
    if (!statErr && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) {
        fs.readFile(path.join(root, 'index.html'), (fallbackErr, fallback) => {
          if (fallbackErr) {
            res.writeHead(404);
            return res.end('Not found');
          }
          res.writeHead(200, { 'Content-Type': mime['.html'] });
          res.end(fallback);
        });
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mime[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
      });
      res.end(data);
    });
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`C.Valor 360 rodando na porta ${port}`);
});
