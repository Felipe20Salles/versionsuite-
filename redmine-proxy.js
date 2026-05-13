/**
 * Proxy local para integração com Redmine (contorna CORS)
 * Uso: node redmine-proxy.js
 * Deixe rodando enquanto usar o VersionSuite com Redmine.
 */
const http = require('http');
const https = require('https');

const PORT = 3001;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const d = JSON.parse(body);
      if (!d.url) throw new Error('Campo "url" obrigatório');

      const target = new URL(d.url);
      const lib = target.protocol === 'https:' ? https : http;
      const defaultPort = target.protocol === 'https:' ? 443 : 80;

      const opts = {
        hostname: target.hostname,
        port: target.port || defaultPort,
        path: target.pathname + target.search,
        method: d.method || 'GET',
        headers: {
  'Content-Type': 'application/json',
  ...(d.headers || {})
}
      };

      const proxyReq = lib.request(opts, proxyRes => {
        let rb = '';
        proxyRes.on('data', c => rb += c);
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, { ...CORS, 'Content-Type': 'application/json' });
          res.end(rb);
        });
      });

      proxyReq.on('error', e => {
        res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erro ao conectar ao Redmine: ' + e.message }));
      });

      if (d.body && d.method !== 'GET') {
        proxyReq.write(JSON.stringify(d.body));
      }
      proxyReq.end();

    } catch (e) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('✅ Proxy Redmine rodando em http://localhost:' + PORT);
  console.log('   Deixe esta janela aberta enquanto usar o VersionSuite.');
  console.log('   Pressione Ctrl+C para parar.');
  console.log('');
});
