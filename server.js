const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec } = require('child_process');

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

  // GET /api/img?path=... — ローカル画像を配信（許可ディレクトリのみ）
  if (method === 'GET' && pathname === '/api/img') {
    const imgPath = parsed.query.path || '';
    const allowed = ['/home/ec2-user/workspace', '/home/ec2-user/generates', '/home/ec2-user/projects/ig_scheduler'];
    if (!allowed.some(d => imgPath.startsWith(d))) return json(res, { error: 'forbidden' }, 403);
    const ext = path.extname(imgPath).toLowerCase();
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
    try {
      const img = fs.readFileSync(imgPath);
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      return res.end(img);
    } catch {
      res.writeHead(404); return res.end('Not found');
    }
  }

  // GET /api/next-cron — 次回cron実行時刻（JST）
  if (method === 'GET' && pathname === '/api/next-cron') {
    // 1日3回: JST 8:05 / 12:00 / 18:00
    const slots = [{ h: 8, m: 5 }, { h: 12, m: 0 }, { h: 18, m: 0 }];
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60000);
    const jstH = jstNow.getUTCHours(), jstM = jstNow.getUTCMinutes();
    let next = null;
    for (const s of slots) {
      if (s.h > jstH || (s.h === jstH && s.m > jstM)) { next = s; break; }
    }
    if (!next) next = slots[0]; // 翌日の最初
    return json(res, { next: `${String(next.h).padStart(2,'0')}:${String(next.m).padStart(2,'0')} JST` });
  }

  // GET /api/:stage — 一覧取得
  if (method === 'GET' && pathname.match(/^\/api\/(\w+)$/)) {
    const stage = pathname.split('/')[2];
    if (!STAGES.includes(stage)) return json(res, { error: 'invalid stage' }, 400);
    return json(res, readStage(stage));
  }

  // POST /api/request_mod — 修正依頼を彰子にsystem eventで転送
  if (method === 'POST' && pathname === '/api/request_mod') {
    const body = await bodyJson(req).catch(() => null);
    if (!body) return json(res, { error: 'invalid body' }, 400);
    const { id, message } = body;
    const text = `【ig_scheduler 修正依頼】投稿ID: ${id} の修正依頼が届きました。\n\n修正内容:\n${message}\n\ndraft.jsonの該当投稿を修正して、ひのちゃん(7107850192)にTelegramで「修正しました！確認お願いします🙏」と報告してください。`;
    exec(`openclaw system event --text ${JSON.stringify(text)} --mode now`, (err) => {
      if (err) console.error('system event error:', err);
    });
    return json(res, { ok: true });
  }

  // POST /api/reorder — schedule内の並び替え
  if (method === 'POST' && pathname === '/api/reorder') {
    const body = await bodyJson(req).catch(() => null);
    if (!body) return json(res, { error: 'invalid body' }, 400);
    const { id, direction } = body; // direction: 'up' | 'down' | 'first' | 'last'
    const data = readStage('schedule');
    const idx = data.posts.findIndex(p => p.id === id);
    if (idx === -1) return json(res, { error: 'not found' }, 404);
    const [post] = data.posts.splice(idx, 1);
    if (direction === 'first') data.posts.unshift(post);
    else if (direction === 'last') data.posts.push(post);
    else if (direction === 'up') data.posts.splice(Math.max(0, idx - 1), 0, post);
    else if (direction === 'down') data.posts.splice(Math.min(data.posts.length, idx + 1), 0, post);
    else data.posts.splice(idx, 0, post);
    writeStage('schedule', data);
    return json(res, { ok: true });
  }

  // POST /api/move — ステージ間移動（先に判定）
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

  // PUT /api/:stage/:id — キャプション・画像更新
  if (method === 'PUT' && pathname.match(/^\/api\/(\w+)\/(.+)$/)) {
    const [, , stage, id] = pathname.split('/');
    if (!STAGES.includes(stage)) return json(res, { error: 'invalid stage' }, 400);
    const body = await bodyJson(req).catch(() => null);
    if (!body) return json(res, { error: 'invalid body' }, 400);
    const data = readStage(stage);
    const post = data.posts.find(p => p.id === id);
    if (!post) return json(res, { error: 'not found' }, 404);
    if (body.caption !== undefined) post.caption = body.caption;
    if (body.images !== undefined) post.images = body.images;
    writeStage(stage, data);
    return json(res, { ok: true });
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
