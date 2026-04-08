const TMAPI_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VybmFtZSI6IkRTQSIsIkNvbWlkIjpudWxsLCJSb2xlaWQiOm51bGwsImlzcyI6InRtYXBpIiwic3ViIjoiRFNBIiwiYXVkIjpbIiJdLCJpYXQiOjE3NDI5ODczNzB9.I2Ty0TtKYE_zHiuT071RjDgsM7x4UC7rePJD0c4qR9M';
const TMAPI_BASE = 'https://api.tmapi.top';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  // Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Parse query params with the modern URL constructor — avoids deprecated url.parse()
  const { searchParams } = new URL(req.url, 'http://localhost');
  const endpoint = searchParams.get('endpoint');
  const keyword  = searchParams.get('keyword');
  const item_id  = searchParams.get('item_id');
  const text     = searchParams.get('text');

  let upstreamUrl;

  if (endpoint === 'search') {
    if (!keyword) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'keyword is required' }));
      return;
    }
    upstreamUrl = `${TMAPI_BASE}/ali/search/items?keyword=${encodeURIComponent(keyword)}&apiToken=${TMAPI_TOKEN}`;
  } else if (endpoint === 'detail') {
    if (!item_id) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'item_id is required' }));
      return;
    }
    upstreamUrl = `${TMAPI_BASE}/ali/item_detail?item_id=${encodeURIComponent(item_id)}&apiToken=${TMAPI_TOKEN}`;
  } else if (endpoint === 'translate') {
    if (!text) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'text is required' }));
      return;
    }
    upstreamUrl = `${TMAPI_BASE}/translate/text?text=${encodeURIComponent(text)}&target_lang=zh&apiToken=${TMAPI_TOKEN}`;
  } else {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'endpoint must be "search", "detail", or "translate"' }));
    return;
  }

  try {
    const upstream = await fetch(upstreamUrl);
    const data = await upstream.json();

    res.writeHead(upstream.status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (err) {
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: err.message }));
  }
}
