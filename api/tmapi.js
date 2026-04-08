const TMAPI_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJVc2VybmFtZSI6IkRTQSIsIkNvbWlkIjpudWxsLCJSb2xlaWQiOm51bGwsImlzcyI6InRtYXBpIiwic3ViIjoiRFNBIiwiYXVkIjpbIiJdLCJpYXQiOjE3NDI5ODczNzB9.I2Ty0TtKYE_zHiuT071RjDgsM7x4UC7rePJD0c4qR9M';
const TMAPI_BASE = 'https://api.tmapi.io';

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
    upstreamUrl = `${TMAPI_BASE}/1688/search/items?keyword=${encodeURIComponent(keyword)}&apiToken=${TMAPI_TOKEN}`;
  } else if (endpoint === 'imgsearch') {
    const img_url = searchParams.get('img_url');
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
    upstreamUrl = `${TMAPI_BASE}/translate/text?text=${encodeURIComponent(text)}&target_lang=zh&apiToken=${TMAPI_TOKEN}`;
  } else {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'endpoint must be "search", "imgsearch", "detail", or "translate"' }));
    return;
  }

  // Log URL with token redacted for security
  const logUrl = upstreamUrl.replace(TMAPI_TOKEN, '[TOKEN]');
  console.log(`[tmapi] ${endpoint} → ${logUrl}`);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        'Authorization': `Bearer ${TMAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const rawText = await upstream.text();
    console.log(`[tmapi] ${endpoint} status=${upstream.status} body=${rawText}`);

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      // TMAPI returned non-JSON — surface it as a readable error
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Non-JSON response from TMAPI', body: rawText }));
      return;
    }

    if (!upstream.ok) {
      console.error(`[tmapi] ${endpoint} upstream error:`, JSON.stringify(data));
    }

    res.writeHead(upstream.status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (err) {
    console.error(`[tmapi] ${endpoint} fetch threw:`, err.message);
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: err.message }));
  }
}
