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

// 編集モード（インライン・下書きのみ）
function startEdit(id, stage) {
  const card = document.getElementById(`card-${id}`);
  const body = card.querySelector('.card-body');
  const caption = card.querySelector(`#cap-${id}`).textContent;
  const imgs = [...card.querySelectorAll('.card-images img')].map(img => {
    const url = new URL(img.src);
    return decodeURIComponent(url.searchParams.get('path') || '');
  });

  body.innerHTML = `
    <div class="edit-mode" id="edit-${id}">
      <label>キャプション</label>
      <textarea id="edit-cap-${id}" rows="6">${caption}</textarea>
      <label>画像</label>
      <div id="edit-imgs-${id}"></div>
      <button class="btn btn-add-img" onclick="addImgField('${id}')">＋ 画像を追加</button>
      <div class="edit-actions">
        <button class="btn btn-ok" onclick="saveEdit('${id}', '${stage}')">💾 保存</button>
        <button class="btn btn-cancel" onclick="loadStage('${stage}')">❌ キャンセル</button>
      </div>
    </div>
  `;

  // 画像フィールド初期化
  const imgContainer = document.getElementById(`edit-imgs-${id}`);
  imgs.forEach((p, i) => appendImgField(id, p, imgs.length));
  // imgが空なら1行追加
  if (imgs.length === 0) appendImgField(id, '', 0);
}

function appendImgField(postId, value, total) {
  const container = document.getElementById(`edit-imgs-${postId}`);
  const idx = container.children.length;
  const row = document.createElement('div');
  row.className = 'img-row';
  row.innerHTML = `
    <input type="text" class="img-path-input" value="${value}" placeholder="/home/ec2-user/..." />
    <button class="btn btn-del-img" onclick="removeImgField(this, '${postId}')" ${total <= 1 && idx === 0 ? 'disabled' : ''}>🗑</button>
  `;
  container.appendChild(row);
  updateDelBtns(postId);
}

function addImgField(postId) {
  appendImgField(postId, '', 99);
}

function removeImgField(btn, postId) {
  const container = document.getElementById(`edit-imgs-${postId}`);
  if (container.children.length <= 1) return; // 最後の1枚は消せない
  btn.closest('.img-row').remove();
  updateDelBtns(postId);
}

function updateDelBtns(postId) {
  const container = document.getElementById(`edit-imgs-${postId}`);
  const btns = container.querySelectorAll('.btn-del-img');
  btns.forEach(b => b.disabled = btns.length <= 1);
}

async function saveEdit(id, stage) {
  const caption = document.getElementById(`edit-cap-${id}`).value;
  const inputs = document.querySelectorAll(`#edit-imgs-${id} .img-path-input`);
  const images = [...inputs].map(i => i.value.trim()).filter(Boolean);
  if (images.length === 0) { toast('画像は最低1枚必要です'); return; }
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
