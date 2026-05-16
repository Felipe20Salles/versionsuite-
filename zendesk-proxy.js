/**
 * Proxy local para integração com Zendesk (contorna CORS)
 *
 * Uso:
 *   ZENDESK_EMAIL=voce@empresa.com ZENDESK_TOKEN=seu-token node zendesk-proxy.js
 *
 * Com subdomínio fixo (restrição extra de host):
 *   ZENDESK_SUBDOMAIN=suaempresa.zendesk.com ZENDESK_EMAIL=... ZENDESK_TOKEN=... node zendesk-proxy.js
 *
 * As credenciais nunca saem do servidor — o browser não as conhece.
 */

const http  = require('http');
const https = require('https');

const PORT              = process.env.PORT || 3002;
const ZENDESK_EMAIL     = process.env.ZENDESK_EMAIL || '';
const ZENDESK_TOKEN     = process.env.ZENDESK_TOKEN || '';
const ZENDESK_SUBDOMAIN = (process.env.ZENDESK_SUBDOMAIN || '').replace(/\/+$/, '').toLowerCase();

if (!ZENDESK_EMAIL || !ZENDESK_TOKEN) {
  console.warn('⚠️  ZENDESK_EMAIL e/ou ZENDESK_TOKEN não definidos. Defina via variáveis de ambiente:');
  console.warn('   ZENDESK_EMAIL=voce@empresa.com ZENDESK_TOKEN=seu-token node zendesk-proxy.js');
  console.warn('');
}

const BASIC_AUTH = 'Basic ' + Buffer.from(ZENDESK_EMAIL + '/token:' + ZENDESK_TOKEN).toString('base64');

const CORS = {
  'Access-Control-Allow-Origin': '*',
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

      // Valida host de destino quando ZENDESK_SUBDOMAIN está definido
      if (ZENDESK_SUBDOMAIN && !d.url.toLowerCase().includes(ZENDESK_SUBDOMAIN)) {
        res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'URL de destino não permitida.' }));
        return;
      }

      const target = new URL(d.url);
      const isHttps = target.protocol === 'https:';
      const agent = isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;
      const lib = isHttps ? https : http;

      // Credenciais vêm do servidor (env vars), nunca do browser
      const safeHeaders = {
        'Content-Type': 'application/json',
        'Authorization': BASIC_AUTH
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
        console.error('ERRO ZENDESK:', e.message);
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
  console.log('✅ Proxy Zendesk rodando em http://localhost:' + PORT);
  if (ZENDESK_SUBDOMAIN) console.log('   Zendesk autorizado: ' + ZENDESK_SUBDOMAIN);
  console.log('   E-mail: ' + (ZENDESK_EMAIL ? '✓ configurado' : '✗ não configurado'));
  console.log('   Token:  ' + (ZENDESK_TOKEN ? '✓ configurado' : '✗ não configurado'));
  console.log('   Deixe esta janela aberta enquanto usar o VersionSuite.');
  console.log('   Pressione Ctrl+C para parar.');
  console.log('');
});
