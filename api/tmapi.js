const https = require('https');

const TMAPI_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VybmFtZSI6IkRTQSIsIkNvbWlkIjpudWxsLCJSb2xlaWQiOm51bGwsImlzcyI6InRtYXBpIiwic3ViIjoiRFNBIiwiYXVkIjpbIiJdLCJpYXQiOjE3NDI5ODczNzB9.I2Ty0TtKYE_zHiuT071RjDgsM7x4UC7rePJD0c4qR9M';
const TMAPI_BASE = 'https://api.tmapi.top';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Only proxy images from known alicdn/1688 domains
const ALLOWED_IMAGE_HOSTS = ['cbu01.alicdn.com', 'alicdn.com', 'img.alicdn.com', '1688.com', 'aliyuncs.com'];

// Use https.Agent with rejectUnauthorized:false — api.tmapi.top has an invalid SSL cert
const agent = new https.Agent({ rejectUnauthorized: false });

function httpsGet(url, reqHeaders) {
  const logUrl = url.replace(TMAPI_TOKEN, '[TOKEN]');
  console.log(`[tmapi] FETCH → ${logUrl}`);
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers: reqHeaders }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        console.log(`[tmapi] status=${res.statusCode} body=${body.slice(0, 500).toString()}`);
        resolve({ status: res.statusCode, headers: res.headers, buffer: body });
      });
    });
    req.on('error', (err) => {
      console.error(`[tmapi] request error for ${logUrl}:`, err.message);
      reject(err);
    });
    req.setTimeout(25000, () => { req.destroy(new Error('Request timed out')); });
  });
}

module.exports = async function handler(req, res) {
  console.log(`[tmapi] invoked method=${req.method} url=${req.url}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const { searchParams } = new URL(req.url, 'http://localhost');
  const endpoint = searchParams.get('endpoint');
  const keyword  = searchParams.get('keyword');
  const item_id  = searchParams.get('item_id');
  const img_url  = searchParams.get('img_url');
  const url      = searchParams.get('url');

  console.log(`[tmapi] endpoint=${endpoint} keyword=${keyword} item_id=${item_id}`);

  // ── Image proxy ──────────────────────────────────────────────────────────
  if (endpoint === 'image') {
    if (!url) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'url is required' }));
      return;
    }
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid url' }));
      return;
    }
    const allowed = ALLOWED_IMAGE_HOSTS.some(h => parsedUrl.hostname === h || parsedUrl.hostname.endsWith('.' + h));
    if (!allowed) {
      res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'image host not allowed', host: parsedUrl.hostname }));
      return;
    }
    try {
      console.log(`[tmapi] image proxy → ${url}`);
      const { status, headers, buffer } = await httpsGet(url, {
        'Referer': 'https://www.1688.com/',
        'User-Agent': 'Mozilla/5.0',
      });
      const contentType = headers['content-type'] || 'image/jpeg';
      res.writeHead(status, {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(buffer);
    } catch (err) {
      console.error('[tmapi] image fetch failed:', err.message);
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'image fetch failed', detail: err.message }));
    }
    return;
  }

  // ── JSON endpoints ────────────────────────────────────────────────────────
  let upstreamUrl;

  if (endpoint === 'search') {
    if (!keyword) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'keyword is required' }));
      return;
    }
    upstreamUrl = `${TMAPI_BASE}/1688/search/items?keyword=${encodeURIComponent(keyword)}&apiToken=${TMAPI_TOKEN}`;

  } else if (endpoint === 'imgsearch') {
    if (!img_url) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'img_url is required' }));
      return;
    }
    upstreamUrl = `${TMAPI_BASE}/1688/global/search/image/v2?img_url=${encodeURIComponent(img_url)}&apiToken=${TMAPI_TOKEN}`;

  } else if (endpoint === 'detail') {
    if (!item_id) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'item_id is required' }));
      return;
    }
    upstreamUrl = `${TMAPI_BASE}/1688/item_detail?item_id=${encodeURIComponent(item_id)}&apiToken=${TMAPI_TOKEN}`;

  } else {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'endpoint must be "search", "imgsearch", "detail", or "image"' }));
    return;
  }

  try {
    const { status, buffer } = await httpsGet(upstreamUrl, { 'Authorization': `Bearer ${TMAPI_TOKEN}` });
    const rawText = buffer.toString();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error('[tmapi] non-JSON response:', rawText.slice(0, 200));
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Non-JSON response from TMAPI', body: rawText.slice(0, 500) }));
      return;
    }
    if (status >= 400) console.error(`[tmapi] upstream ${status}:`, JSON.stringify(data));
    res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error('[tmapi] unhandled error:', err.message, err.stack);
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: err.message }));
  }
};
