const TMAPI_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VybmFtZSI6IkRTQSIsIkNvbWlkIjpudWxsLCJSb2xlaWQiOm51bGwsImlzcyI6InRtYXBpIiwic3ViIjoiRFNBIiwiYXVkIjpbIiJdLCJpYXQiOjE3NDI5ODczNzB9.I2Ty0TtKYE_zHiuT071RjDgsM7x4UC7rePJD0c4qR9M';
const TMAPI_BASE = 'https://api.tmapi.top';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Only proxy images from known alicdn/1688 domains
const ALLOWED_IMAGE_HOSTS = ['cbu01.alicdn.com', 'alicdn.com', 'img.alicdn.com', '1688.com', 'aliyuncs.com'];

async function tmapiFetch(url) {
  const logUrl = url.replace(TMAPI_TOKEN, '[TOKEN]');
  console.log(`[tmapi] FETCH → ${logUrl}`);
  let upstream;
  try {
    upstream = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TMAPI_TOKEN}` },
    });
  } catch (err) {
    console.error(`[tmapi] fetch() threw for ${logUrl}:`, err.message, err.stack);
    throw err;
  }
  const rawText = await upstream.text();
  console.log(`[tmapi] status=${upstream.status} body=${rawText.slice(0, 500)}`);
  return { status: upstream.status, rawText };
}

// CommonJS export — required when there is no "type":"module" in package.json
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
  const text     = searchParams.get('text');
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
      const imgRes = await fetch(url, {
        headers: { 'Referer': 'https://www.1688.com/', 'User-Agent': 'Mozilla/5.0' },
      });
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      const buffer = await imgRes.arrayBuffer();
      res.writeHead(imgRes.status, {
        ...CORS_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(Buffer.from(buffer));
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
    // Translate keyword to Chinese before searching
    let searchKeyword = keyword;
    try {
      const trUrl = `${TMAPI_BASE}/tools/translate?text=${encodeURIComponent(keyword)}&target_lang=zh&apiToken=${TMAPI_TOKEN}`;
      const { status, rawText } = await tmapiFetch(trUrl);
      if (status === 200) {
        const trJson = JSON.parse(rawText);
        const translated =
          trJson?.data?.translated_text ||
          trJson?.data?.text ||
          (typeof trJson?.data === 'string' ? trJson.data : null) ||
          trJson?.translated_text ||
          trJson?.text || '';
        if (translated && typeof translated === 'string' && translated.trim()) {
          searchKeyword = translated.trim();
          console.log(`[tmapi] translated "${keyword}" → "${searchKeyword}"`);
        }
      }
    } catch (err) {
      console.warn('[tmapi] translation failed, using original keyword:', err.message);
    }
    upstreamUrl = `${TMAPI_BASE}/1688/search/items?keyword=${encodeURIComponent(searchKeyword)}&apiToken=${TMAPI_TOKEN}`;

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

  } else if (endpoint === 'translate') {
    if (!text) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'text is required' }));
      return;
    }
    upstreamUrl = `${TMAPI_BASE}/tools/translate?text=${encodeURIComponent(text)}&target_lang=zh&apiToken=${TMAPI_TOKEN}`;

  } else {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'endpoint must be "search", "imgsearch", "detail", "translate", or "image"' }));
    return;
  }

  try {
    const { status, rawText } = await tmapiFetch(upstreamUrl);
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
