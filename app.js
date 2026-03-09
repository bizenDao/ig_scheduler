// /ig_scheduler/ 配下で動くようにベースパスを動的取得
const BASE = window.location.pathname.replace(/\/[^\/]*$/, '').replace(/\/$/, '');
let currentStage = 'draft';

const STAGE_LABELS = { draft: '下書き', proposal: '確認中', schedule: '承認済み', posted: '投稿済み' };

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  return res.json();
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

async function loadBadges() {
  for (const stage of ['draft', 'proposal', 'schedule', 'posted']) {
    const data = await api('GET', `/api/${stage}`);
    const badge = document.getElementById(`badge-${stage}`);
    badge.textContent = (data.posts || []).length;
    badge.style.display = (data.posts || []).length > 0 ? '' : 'none';
  }
}

async function loadStage(stage) {
  currentStage = stage;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.stage === stage));
  const data = await api('GET', `/api/${stage}`);
  const posts = data.posts || [];
  const content = document.getElementById('content');

  if (posts.length === 0) {
    content.innerHTML = `<div class="empty">投稿がありません</div>`;
    return;
  }

  content.innerHTML = posts.map(post => renderCard(post, stage)).join('');
  loadBadges();
}

function renderCard(post, stage) {
  const imgs = (post.images || []);
  const imgHtml = imgs.length > 0
    ? `<div class="card-images ${imgs.length === 1 ? 'single' : ''}">
        ${imgs.map(src => `<img src="${BASE}/api/img?path=${encodeURIComponent(src)}" loading="lazy" onerror="this.style.display='none'">`).join('')}
       </div>`
    : '';

  const caption = (post.caption || '').replace(/</g, '&lt;');
  const isLong = (post.caption || '').length > 80;
  const captionHtml = `
    <div class="card-caption" id="cap-${post.id}">${caption}</div>
    ${isLong ? `<button class="caption-toggle" onclick="toggleCaption('${post.id}')">もっと見る</button>` : ''}
  `;

  const canEdit = stage !== 'posted';
  const editBtn = canEdit ? `<button class="btn btn-edit" onclick="startEdit('${post.id}', '${stage}')">✏️ 編集</button>` : '';

  let actions = '';
  if (stage === 'draft') {
    actions = `
      <button class="btn btn-ok" onclick="move('${post.id}', 'draft', 'schedule')">✅ OK</button>
      <button class="btn btn-ng" onclick="remove('${post.id}', 'draft')">🗑 NG</button>
      ${editBtn}
    `;
  } else if (stage === 'proposal') {
    actions = `
      <button class="btn btn-ok" onclick="move('${post.id}', 'proposal', 'draft')">👍 採用する</button>
      <button class="btn btn-ng" onclick="remove('${post.id}', 'proposal')">👎 却下する</button>
      ${editBtn}
    `;
  } else if (stage === 'schedule') {
    actions = `
      <div class="reorder-btns">
        <button class="btn btn-ord" onclick="reorder('${post.id}', 'first')">⏫ 先頭</button>
        <button class="btn btn-ord" onclick="reorder('${post.id}', 'up')">🔼 上へ</button>
        <button class="btn btn-ord" onclick="reorder('${post.id}', 'down')">🔽 下へ</button>
        <button class="btn btn-ord" onclick="reorder('${post.id}', 'last')">⏬ 最後</button>
      </div>
      <button class="btn btn-move" onclick="move('${post.id}', 'schedule', 'draft')">↩️ 下書きに戻す</button>
      <button class="btn btn-del" onclick="remove('${post.id}', 'schedule')">🗑 取り消し</button>
    `;
  } else if (stage === 'posted') {
    const meta = post.posted_at ? `<div class="posted-meta">投稿日時: ${post.posted_at}</div>` : '';
    actions = `
      <div style="padding:4px 0">${meta}</div>
      <button class="btn btn-ok" onclick="move('${post.id}', 'posted', 'schedule')">🔁 再投稿</button>
      <button class="btn btn-del" onclick="remove('${post.id}', 'posted')">🗑 削除</button>
    `;
  }

  return `
    <div class="card" id="card-${post.id}">
      ${imgHtml}
      <div class="card-body">
        <div class="card-id">ID: ${post.id}</div>
        ${captionHtml}
      </div>
      <div class="card-actions">${actions}</div>
    </div>
  `;
}

// 編集モード（インライン）
function startEdit(id, stage) {
  const card = document.getElementById(`card-${id}`);
  const body = card.querySelector('.card-body');
  const caption = card.querySelector(`#cap-${id}`).textContent;
  const imgs = [...card.querySelectorAll('.card-images img')].map(img => {
    const url = new URL(img.src);
    return decodeURIComponent(url.searchParams.get('path') || '');
  });

  body.innerHTML = `
    <div class="edit-mode">
      <label>キャプション</label>
      <textarea id="edit-cap-${id}" rows="6">${caption}</textarea>
      <label>画像パス（1行1枚）</label>
      <textarea id="edit-imgs-${id}" rows="${Math.max(2, imgs.length)}">${imgs.join('\n')}</textarea>
      <div class="edit-actions">
        <button class="btn btn-ok" onclick="saveEdit('${id}', '${stage}')">💾 保存</button>
        <button class="btn btn-cancel" onclick="loadStage('${stage}')">❌ キャンセル</button>
      </div>
    </div>
  `;
}

async function saveEdit(id, stage) {
  const caption = document.getElementById(`edit-cap-${id}`).value;
  const imgsRaw = document.getElementById(`edit-imgs-${id}`).value;
  const images = imgsRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const res = await api('PUT', `/api/${stage}/${id}`, { caption, images });
  if (res.ok) {
    toast('保存しました');
    loadStage(stage);
  }
}

function toggleCaption(id) {
  const el = document.getElementById(`cap-${id}`);
  const btn = el.nextElementSibling;
  el.classList.toggle('expanded');
  btn.textContent = el.classList.contains('expanded') ? '閉じる' : 'もっと見る';
}

async function reorder(id, direction) {
  await api('POST', '/api/reorder', { id, direction });
  loadStage('schedule');
}

async function move(id, from, to) {
  const res = await api('POST', '/api/move', { id, from, to });
  if (res.ok) {
    toast(`${STAGE_LABELS[to]}に移動しました`);
    loadStage(from);
  }
}

async function remove(id, stage) {
  if (!confirm('削除しますか？この操作は元に戻せません。')) return;
  const res = await api('DELETE', `/api/${stage}/${id}`);
  if (res.ok) {
    toast('削除しました');
    loadStage(stage);
  }
}

// タブ切り替え
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => loadStage(tab.dataset.stage));
});

async function loadNextCron() {
  const data = await api('GET', '/api/next-cron');
  const el = document.getElementById('next-cron');
  if (data.next) el.textContent = `⏰ 次回投稿: ${data.next}`;
}

// 初期表示
loadStage('proposal');
loadBadges();
loadNextCron();
