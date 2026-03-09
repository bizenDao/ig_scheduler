const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8801;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = __dirname;
const STAGES = ['draft', 'proposal', 'schedule', 'posted'];

function dataFile(stage) {
  return path.join(DATA_DIR, `${stage}.json`);
}

function readStage(stage) {
  try {
    return JSON.parse(fs.readFileSync(dataFile(stage), 'utf8'));
  } catch {
    return { posts: [] };
  }
}

function writeStage(stage, data) {
  fs.writeFileSync(dataFile(stage), JSON.stringify(data, null, 2));
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(); } });
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // Static files
  if (method === 'GET' && !pathname.startsWith('/api/')) {
    const file = pathname === '/' ? '/index.html' : pathname;
    return serveStatic(res, path.join(PUBLIC_DIR, file));
  }

  // GET /api/:stage — 一覧取得
  if (method === 'GET' && pathname.match(/^\/api\/(\w+)$/)) {
    const stage = pathname.split('/')[2];
    if (!STAGES.includes(stage)) return json(res, { error: 'invalid stage' }, 400);
    return json(res, readStage(stage));
  }

  // POST /api/:stage — 追加
  if (method === 'POST' && pathname.match(/^\/api\/(\w+)$/)) {
    const stage = pathname.split('/')[2];
    if (!STAGES.includes(stage)) return json(res, { error: 'invalid stage' }, 400);
    const body = await bodyJson(req).catch(() => null);
    if (!body) return json(res, { error: 'invalid body' }, 400);
    if (!body.id) body.id = `post_${Date.now()}`;
    const data = readStage(stage);
    data.posts.push(body);
    writeStage(stage, data);
    return json(res, { ok: true, id: body.id });
  }

  // POST /api/move — ステージ間移動
  if (method === 'POST' && pathname === '/api/move') {
    const body = await bodyJson(req).catch(() => null);
    if (!body) return json(res, { error: 'invalid body' }, 400);
    const { id, from, to } = body;
    if (!STAGES.includes(from) || !STAGES.includes(to)) return json(res, { error: 'invalid stage' }, 400);
    const fromData = readStage(from);
    const idx = fromData.posts.findIndex(p => p.id === id);
    if (idx === -1) return json(res, { error: 'not found' }, 404);
    const [post] = fromData.posts.splice(idx, 1);
    writeStage(from, fromData);
    const toData = readStage(to);
    toData.posts.push(post);
    writeStage(to, toData);
    return json(res, { ok: true });
  }

  // DELETE /api/:stage/:id — 削除
  if (method === 'DELETE' && pathname.match(/^\/api\/(\w+)\/(.+)$/)) {
    const [, , stage, id] = pathname.split('/');
    if (!STAGES.includes(stage)) return json(res, { error: 'invalid stage' }, 400);
    const data = readStage(stage);
    const before = data.posts.length;
    data.posts = data.posts.filter(p => p.id !== id);
    if (data.posts.length === before) return json(res, { error: 'not found' }, 404);
    writeStage(stage, data);
    return json(res, { ok: true });
  }

  json(res, { error: 'not found' }, 404);
});

server.listen(PORT, () => {
  console.log(`ig_scheduler server running on http://localhost:${PORT}`);
});
