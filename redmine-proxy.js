/**
 * Proxy local para integração com Redmine (contorna CORS)
 *
 * Uso básico:
 *   REDMINE_KEY=sua-chave-api node redmine-proxy.js
 *
 * Com restrição de host:
 *   REDMINE_URL=http://10.0.0.50/redmine REDMINE_KEY=sua-chave-api node redmine-proxy.js
 *
 * A chave API nunca sai do servidor — o browser não precisa conhecê-la.
 */

const http  = require('http');
const https = require('https');

const PORT        = process.env.PORT || 3001;
const REDMINE_KEY = process.env.REDMINE_KEY || '';
const ALLOWED_HOST = (process.env.REDMINE_URL || '').replace(/\/+$/, '').toLowerCase();

if (!REDMINE_KEY) {
  console.warn('⚠️  REDMINE_KEY não definida. Defina via variável de ambiente:');
  console.warn('   REDMINE_KEY=sua-chave node redmine-proxy.js');
  console.warn('');
}

const CORS = {
  'Access-Control-Allow-Origin': 'null, http://localhost, https://versionsuite.netlify.app',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

const server = http.createServer((req, res) => {
  // Aceita conexões apenas do próprio localhost
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

      // Valida host de destino quando REDMINE_URL está definido
      if (ALLOWED_HOST && !d.url.toLowerCase().startsWith(ALLOWED_HOST)) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'URL de destino não permitida.' }));
        return;
      }

      const target = new URL(d.url);
      const isHttps = target.protocol === 'https:';
      const agent = isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;
      const lib = isHttps ? https : http;

      // A chave vem do servidor (env var), nunca do browser
      // Qualquer X-Redmine-API-Key enviado pelo browser é descartado e substituído
      const safeHeaders = {
        'Content-Type': 'application/json',
        'X-Redmine-API-Key': REDMINE_KEY
      };

      const opts = {
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: d.method || 'GET',
        headers: safeHeaders,
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
  console.log('   Chave API: ' + (REDMINE_KEY ? '✓ configurada via REDMINE_KEY' : '✗ não configurada'));
  console.log('   Deixe esta janela aberta enquanto usar o VersionSuite.');
  console.log('   Pressione Ctrl+C para parar.');
  console.log('');
});
