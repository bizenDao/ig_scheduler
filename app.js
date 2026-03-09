// /ig_scheduler/ 配下で動くようにベースパスを動的取得
const BASE = window.location.pathname.replace(/\/[^\/]*$/, '').replace(/\/$/, '');
let currentStage = 'draft';
let pendingModId = null;

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

  let actions = '';
  if (stage === 'draft') {
    actions = `
      <button class="btn btn-ok" onclick="move('${post.id}', 'draft', 'schedule')">✅ OK</button>
      <button class="btn btn-mod" onclick="openModal('${post.id}')">✏️ 修正</button>
      <button class="btn btn-ng" onclick="remove('${post.id}', 'draft')">🗑 NG</button>
    `;
  } else if (stage === 'proposal') {
    actions = `
      <button class="btn btn-ok" onclick="move('${post.id}', 'proposal', 'draft')">👍 採用する</button>
      <button class="btn btn-ng" onclick="remove('${post.id}', 'proposal')">👎 却下する</button>
    `;
  } else if (stage === 'schedule') {
    actions = `
      <button class="btn btn-move" onclick="move('${post.id}', 'schedule', 'draft')">↩️ 下書きに戻す</button>
      <button class="btn btn-del" onclick="remove('${post.id}', 'schedule')">🗑 取り消し</button>
    `;
  } else if (stage === 'posted') {
    const meta = post.posted_at ? `<div class="posted-meta">投稿日時: ${post.posted_at}</div>` : '';
    actions = `<div style="padding:4px 0">${meta}</div>`;
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

function toggleCaption(id) {
  const el = document.getElementById(`cap-${id}`);
  const btn = el.nextElementSibling;
  el.classList.toggle('expanded');
  btn.textContent = el.classList.contains('expanded') ? '閉じる' : 'もっと見る';
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

function openModal(id) {
  pendingModId = id;
  document.getElementById('modal-text').value = '';
  document.getElementById('modal-overlay').classList.add('show');
}

function closeModal() {
  pendingModId = null;
  document.getElementById('modal-overlay').classList.remove('show');
}

async function submitMod() {
  const text = document.getElementById('modal-text').value.trim();
  if (!text) return;
  // 修正依頼をTelegramに送る（サーバー経由）
  await api('POST', '/api/request_mod', { id: pendingModId, message: text });
  toast('修正依頼を送りました');
  closeModal();
}

// タブ切り替え
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => loadStage(tab.dataset.stage));
});

// モーダル外クリックで閉じる
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
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
