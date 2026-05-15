/**
 * Proxy local para integração com Redmine (contorna CORS)
 * Uso: node redmine-proxy.js
 * Deixe rodando enquanto usar o VersionSuite com Redmine.
 */

const http  = require('http');
const https = require('https');

const PORT = 3001;

// Lê a URL base do Redmine via variável de ambiente ou deixa aberto (qualquer host)
// Exemplo de uso restrito: REDMINE_URL=https://redmine.empresa.com node redmine-proxy.js
const ALLOWED_HOST = (process.env.REDMINE_URL || '').replace(/\/+$/, '').toLowerCase();

const CORS = {
  'Access-Control-Allow-Origin': 'null, http://localhost, https://versionsuite.netlify.app',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const server = http.createServer((req, res) => {
  // Bloqueia conexões que não sejam do próprio localhost
  const clientIp = req.socket.remoteAddress;
  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== '::ffff:127.0.0.1') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Acesso negado: apenas localhost.' }));
    return;
  }

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

      // Valida que a URL de destino é o Redmine configurado (quando REDMINE_URL está definido)
      if (ALLOWED_HOST && !d.url.toLowerCase().startsWith(ALLOWED_HOST)) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'URL de destino não permitida.' }));
        return;
      }

      const target = new URL(d.url);
      const isHttps = target.protocol === 'https:';

      // Desabilita verificação de certificado apenas para o agente desta requisição,
      // não globalmente — necessário para servidores internos com certificado autoassinado.
      const agent = isHttps
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

      const lib = isHttps ? https : http;
      const opts = {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: d.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(d.headers || {}) },
        agent
      };

      console.log(`→ ${opts.method} ${d.url}`);

      const proxyReq = lib.request(opts, proxyRes => {
        let rb = '';
        proxyRes.on('data', c => rb += c);
        proxyRes.on('end', () => {
          console.log(`← ${proxyRes.statusCode}`);
          res.writeHead(proxyRes.statusCode, { ...CORS, 'Content-Type': 'application/json' });
          res.end(rb);
        });
      });

      proxyReq.on('error', e => {
        console.error('ERRO REDMINE:', e.message);
        res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
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

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('✅ Proxy Redmine rodando em http://localhost:' + PORT);
  if (ALLOWED_HOST) console.log('   Redmine autorizado: ' + ALLOWED_HOST);
  console.log('   Deixe esta janela aberta enquanto usar o VersionSuite.');
  console.log('   Pressione Ctrl+C para parar.');
  console.log('');
});
