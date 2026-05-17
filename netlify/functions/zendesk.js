const https = require('https');

const PATHS = {
  me:         '/api/v2/users/me.json',
  categories: '/api/v2/help_center/pt-br/categories.json',
  articles:   '/api/v2/help_center/pt-br/articles.json',
  explore:    '/api/v2/explore/export'
};

function zendeskRequest(sub, email, token, path, method, body) {
  return new Promise(function(resolve) {
    var auth = Buffer.from(email + '/token:' + token).toString('base64');
    var hostname = sub.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    var bodyStr = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: hostname,
      path: path,
      method: method || 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json',
        'Content-Length': bodyStr ? Buffer.byteLength(bodyStr) : 0
      }
    };
    var req = https.request(opts, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });
    req.on('error', function(e) {
      resolve({ statusCode: 502, body: JSON.stringify({ error: e.message }) });
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

exports.handler = async function(event) {
  var sub   = process.env.ZENDESK_SUBDOMAIN;
  var email = process.env.ZENDESK_EMAIL;
  var token = process.env.ZENDESK_TOKEN;

  var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (!sub || !email || !token) {
    return {
      statusCode: 503,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Zendesk não configurado. Defina ZENDESK_SUBDOMAIN, ZENDESK_EMAIL e ZENDESK_TOKEN nas variáveis de ambiente do Netlify.' })
    };
  }

  var params = event.queryStringParameters || {};
  var type   = params.type || 'me';
  var path   = PATHS[type] || PATHS['me'];

  var extra = Object.keys(params)
    .filter(function(k) { return k !== 'type'; })
    .map(function(k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');
  if (extra) path += (path.indexOf('?') > -1 ? '&' : '?') + extra;

  var body = null;
  if (event.httpMethod === 'POST' && event.body) {
    try { body = JSON.parse(event.body); } catch(e) {}
  }

  var result = await zendeskRequest(sub, email, token, path, event.httpMethod, body);

  return {
    statusCode: result.statusCode,
    headers: corsHeaders,
    body: result.body
  };
};
