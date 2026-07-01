const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 8765;

// A-share tickers → Tencent API code
const A_STOCKS = {
  'sh600519': '贵州茅台', 'sz000001': '平安银行', 'sz002714': '牧原股份',
  'sh601318': '中国平安', 'sz002027': '分众传媒',
  'sh601398': '工商银行', 'sh601288': '农业银行', 'sh601988': '中国银行',
  'sh601939': '建设银行', 'sh601328': '交通银行', 'sh600036': '招商银行',
  'sh600941': '中国移动', 'sh601728': '中国电信', 'sh601088': '中国神华',
  'sz300750': '宁德时代', 'sh688981': '中芯国际'
};

// HK tickers → Sina API code
const HK_STOCKS = {
  'hk00700': '腾讯控股', 'hk01810': '小米集团', 'hk03968': '招商银行',
  'hk01398': '工商银行', 'hk01288': '农业银行', 'hk03988': '中国银行',
  'hk00939': '建设银行', 'hk03328': '交通银行', 'hk00941': '中国移动',
  'hk00762': '中国联通', 'hk07267': '中国华融'
};

function fetchUrl(url, encoding = 'utf-8') {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'Referer': 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0'
      },
      timeout: 8000
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(Buffer.concat(chunks).toString(encoding));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function parseTencent(raw) {
  const results = {};
  const lines = raw.split(';').filter(l => l.includes('='));
  for (const line of lines) {
    const match = line.match(/v_(\w+)="(.+)"/);
    if (!match) continue;
    const code = match[1];
    const fields = match[2].split('~');
    if (fields.length < 10) continue;
    results[code] = {
      name: A_STOCKS[code] || fields[1],
      code: code,
      price: parseFloat(fields[3]) || 0,
      prevClose: parseFloat(fields[4]) || 0,
      open: parseFloat(fields[5]) || 0,
      high: parseFloat(fields[33]) || 0,
      low: parseFloat(fields[34]) || 0,
      volume: parseInt(fields[6]) || 0,
      change: parseFloat(fields[31]) || 0,
      changePct: parseFloat(fields[32]) || 0,
      time: fields[30] || ''
    };
  }
  return results;
}

function parseSinaHK(raw) {
  const results = {};
  const lines = raw.split(';').filter(l => l.includes('='));
  for (const line of lines) {
    const match = line.match(/hq_str_(\w+)="(.+)"/);
    if (!match) continue;
    const code = match[1];
    const fields = match[2].split(',');
    if (fields.length < 10) continue;
    results[code] = {
      name: HK_STOCKS[code] || fields[0],
      code: code,
      price: parseFloat(fields[6]) || 0,
      prevClose: parseFloat(fields[2]) || 0,
      open: parseFloat(fields[3]) || 0,
      high: parseFloat(fields[4]) || 0,
      low: parseFloat(fields[5]) || 0,
      change: parseFloat(fields[7]) || 0,
      changePct: parseFloat(fields[8]) || 0,
      time: fields[17] + ' ' + fields[18] || ''
    };
  }
  return results;
}

let cache = { data: null, ts: 0 };

async function fetchAll() {
  if (cache.data && Date.now() - cache.ts < 15000) return cache.data;

  const aCodes = Object.keys(A_STOCKS).join(',');
  const hkCodes = Object.keys(HK_STOCKS).join(',');

  try {
    const [aRaw, hkRaw] = await Promise.all([
      fetchUrl(`https://qt.gtimg.cn/q=${aCodes}`).catch(() => ''),
      fetchUrl(`https://hq.sinajs.cn/list=${hkCodes}`, 'latin1').catch(() => '')
    ]);

    const aData = aRaw ? parseTencent(aRaw) : {};
    const hkData = hkRaw ? parseSinaHK(hkRaw) : {};

    cache = { data: { a: aData, hk: hkData, ts: Date.now() }, ts: Date.now() };
    return cache.data;
  } catch(e) {
    console.error('Fetch error:', e.message);
    return cache.data || { a: {}, hk: {}, ts: Date.now() };
  }
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.url === '/api/prices') {
    try {
      const data = await fetchAll();
      res.end(JSON.stringify(data));
    } catch(e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
  } else if (req.url === '/health') {
    res.end('ok');
  } else {
    // Serve static files
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);
    const ext = path.extname(filePath);
    const mimeTypes = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.ico':'image/x-icon' };
    try {
      const content = fs.readFileSync(filePath);
      res.setHeader('Content-Type', (mimeTypes[ext]||'text/plain') + '; charset=utf-8');
      res.end(content);
    } catch(e) {
      res.statusCode = 404;
      res.end('not found');
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Stock price API running on http://0.0.0.0:${PORT}`);
});
