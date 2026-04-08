const https = require('https');

const TMAPI_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VybmFtZSI6IkRTQSIsIkNvbWlkIjpudWxsLCJSb2xlaWQiOm51bGwsImlzcyI6InRtYXBpIiwic3ViIjoiRFNBIiwiYXVkIjpbIiJdLCJpYXQiOjE3NDI5ODczNzB9.I2Ty0TtKYE_zHiuT071RjDgsM7x4UC7rePJD0c4qR9M';
const IMGBB_API_KEY = 'PASTE_YOUR_IMGBB_KEY_HERE';
const TMAPI_BASE = 'https://api.tmapi.top';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Only proxy images from known alicdn/1688 domains
const ALLOWED_IMAGE_HOSTS = ['cbu01.alicdn.com', 'alicdn.com', 'img.alicdn.com', '1688.com', 'aliyuncs.com'];

// Domains allowed for og:image scraping (product reference links)
const ALLOWED_SCRAPE_HOSTS = [
  'aliexpress.com', 'www.aliexpress.com', 'aliexpress.us',
  'shein.com', 'www.shein.com', 'us.shein.com', 'nl.shein.com',
  'amazon.com', 'www.amazon.com', 'amazon.nl', 'amazon.de',
  'temu.com', 'www.temu.com',
  'shopee.com', 'shopee.sg', 'shopee.co.id',
  'detail.1688.com', '1688.com',
];

// Use https.Agent with rejectUnauthorized:false — api.tmapi.top has an invalid SSL cert
const agent = new https.Agent({ rejectUnauthorized: false });

// Follow up to 5 redirects, returns final HTML body as string
function httpsGetHtml(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : `https://${parsedUrl.hostname}${res.headers.location}`;
        res.resume();
        return httpsGetHtml(next, maxRedirects - 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('scrape timeout')));
    req.end();
  });
}

// Upload base64 image to imgbb, returns public URL string
function imgbbUpload(base64Data) {
  return new Promise((resolve, reject) => {
    const body = `key=${encodeURIComponent(IMGBB_API_KEY)}&image=${encodeURIComponent(base64Data)}`;
    const req = https.request({
      hostname: 'api.imgbb.com',
      path: '/1/upload',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          const url = json?.data?.url || json?.data?.display_url || null;
          if (url) resolve(url);
          else reject(new Error('imgbb: no url in response — ' + JSON.stringify(json).slice(0, 200)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('imgbb upload timeout')));
    req.write(body);
    req.end();
  });
}

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

// Read full POST body as string
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

module.exports = async function handler(req, res) {
  console.log(`[tmapi] invoked method=${req.method} url=${req.url}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    res.end();
    return;
  }

  const { searchParams } = new URL(req.url, 'http://localhost');
  const endpoint  = searchParams.get('endpoint');
  const keyword   = searchParams.get('keyword');
  const item_id   = searchParams.get('item_id');
  const img_url   = searchParams.get('img_url');
  const url       = searchParams.get('url');
  const scrapeUrl = searchParams.get('scrape_url');

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

  // ── Upload base64 image to imgbb → get public URL ────────────────────────
  if (endpoint === 'uploadimage') {
    if (!IMGBB_API_KEY || IMGBB_API_KEY === 'PASTE_YOUR_IMGBB_KEY_HERE') {
      res.writeHead(503, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'imgbb API key not configured' }));
      return;
    }
    let base64Data = '';
    if (req.method === 'POST') {
      const body = await readBody(req);
      try { base64Data = JSON.parse(body).image || ''; } catch { base64Data = body; }
    } else {
      base64Data = searchParams.get('image') || '';
    }
    // Strip data URI prefix if present (data:image/jpeg;base64,...)
    base64Data = base64Data.replace(/^data:[^;]+;base64,/, '');
    if (!base64Data) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'image (base64) is required' }));
      return;
    }
    try {
      console.log(`[tmapi] uploading ${base64Data.length} chars of base64 to imgbb`);
      const imageUrl = await imgbbUpload(base64Data);
      console.log(`[tmapi] imgbb uploaded → ${imageUrl}`);
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ imageUrl }));
    } catch (err) {
      console.error('[tmapi] imgbb upload failed:', err.message);
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'imgbb upload failed', detail: err.message }));
    }
    return;
  }

  // ── Scrape og:image from a product reference link ─────────────────────────
  if (endpoint === 'scrapeimage') {
    if (!scrapeUrl) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'scrape_url is required' }));
      return;
    }
    let parsedScrape;
    try { parsedScrape = new URL(scrapeUrl); } catch {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid scrape_url' }));
      return;
    }
    const scrapeHostAllowed = ALLOWED_SCRAPE_HOSTS.some(
      h => parsedScrape.hostname === h || parsedScrape.hostname.endsWith('.' + h)
    );
    if (!scrapeHostAllowed) {
      res.writeHead(403, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'scrape host not allowed', host: parsedScrape.hostname }));
      return;
    }
    try {
      console.log(`[tmapi] scrapeimage → ${scrapeUrl}`);
      const html = await httpsGetHtml(scrapeUrl);
      // Try og:image first, then twitter:image, then first large img src
      const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
      const twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
      const imageUrl = ogMatch?.[1] || twMatch?.[1] || null;
      console.log(`[tmapi] scrapeimage result: ${imageUrl}`);
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ imageUrl: imageUrl || null }));
    } catch (err) {
      console.error('[tmapi] scrapeimage failed:', err.message);
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'scrape failed', detail: err.message }));
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
    upstreamUrl = `${TMAPI_BASE}/1688/search/image?img_url=${encodeURIComponent(img_url)}&apiToken=${TMAPI_TOKEN}`;

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
