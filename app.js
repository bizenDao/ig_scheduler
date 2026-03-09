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
      ${editBtn}
      <button class="btn btn-ok" onclick="move('${post.id}', 'draft', 'schedule')">📅 予定に追加</button>
      <button class="btn btn-del" onclick="remove('${post.id}', 'draft')">🗑 削除</button>
    `;
  } else if (stage === 'proposal') {
    actions = `
      <button class="btn btn-ng" onclick="remove('${post.id}', 'proposal')">👎 却下する</button>
      <button class="btn btn-ok" onclick="move('${post.id}', 'proposal', 'draft')">👍 採用する</button>
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
    const u = new URL(img.src);
    return decodeURIComponent(u.searchParams.get('path') || '');
  });

  body.innerHTML = `
    <div class="edit-mode" id="edit-${id}" data-stage="${stage}">
      <label>タイプ</label>
      <select id="edit-type-${id}" class="type-select">
        <option value="">-- 選択 --</option>
        <option value="4koma">4コマ漫画</option>
        <option value="bizenlife">備前焼のある食卓</option>
        <option value="friends">友人エピソード</option>
        <option value="other">その他</option>
      </select>
      <label>キャプション</label>
      <textarea id="edit-cap-${id}" rows="6">${caption}</textarea>
      <label>画像</label>
      <div class="edit-img-grid" id="edit-imgs-${id}"></div>
      <input type="file" id="file-input-${id}" accept="image/*" style="display:none" onchange="onFileSelected('${id}', this)">
      <div class="edit-actions">
        <button class="btn btn-cancel" onclick="loadStage('${stage}')">❌ キャンセル</button>
        <button class="btn btn-ok" onclick="saveEdit('${id}', '${stage}')">💾 保存</button>
      </div>
    </div>
  `;

  const grid = document.getElementById(`edit-imgs-${id}`);
  imgs.forEach(p => addThumb(id, p));
  addUploadBtn(id);
}

function addThumb(postId, imgPath) {
  const grid = document.getElementById(`edit-imgs-${postId}`);
  const div = document.createElement('div');
  div.className = 'edit-thumb';
  div.dataset.path = imgPath;
  div.innerHTML = `
    <img src="${BASE}/api/img?path=${encodeURIComponent(imgPath)}" onerror="this.style.opacity=0.3">
    <button class="del-thumb-btn" onclick="removeThumb(this, '${postId}')">✕</button>
  `;
  // アップロードボタンの前に挿入
  const uploadBtn = grid.querySelector('.upload-btn-wrap');
  if (uploadBtn) grid.insertBefore(div, uploadBtn);
  else grid.appendChild(div);
  updateDelThumbBtns(postId);
}

function addUploadBtn(postId) {
  const grid = document.getElementById(`edit-imgs-${postId}`);
  const div = document.createElement('div');
  div.className = 'edit-thumb upload-btn-wrap';
  div.innerHTML = `<button class="upload-btn" onclick="document.getElementById('file-input-${postId}').click()">＋</button>`;
  grid.appendChild(div);
}

function removeThumb(btn, postId) {
  const grid = document.getElementById(`edit-imgs-${postId}`);
  const thumbs = grid.querySelectorAll('.edit-thumb:not(.upload-btn-wrap)');
  if (thumbs.length <= 1) return;
  if (!confirm('この画像を削除しますか？')) return;
  btn.closest('.edit-thumb').remove();
  updateDelThumbBtns(postId);
}

function updateDelThumbBtns(postId) {
  const grid = document.getElementById(`edit-imgs-${postId}`);
  const thumbs = grid.querySelectorAll('.edit-thumb:not(.upload-btn-wrap)');
  thumbs.forEach(t => {
    t.querySelector('.del-thumb-btn').disabled = thumbs.length <= 1;
  });
}

async function onFileSelected(postId, input) {
  const file = input.files[0];
  if (!file) return;
  toast('アップロード中…');
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const dataUrl = e.target.result; // data:image/jpeg;base64,... 全体を送る
      const res = await api('POST', '/api/upload', { filename: file.name, data: dataUrl });
      if (res.path) {
        addThumb(postId, res.path);
        toast('アップロード完了！');
      } else {
        toast('アップロード失敗: ' + (res.error || '不明'));
      }
    } catch(e) {
      toast('アップロード失敗…');
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

async function saveEdit(id, stage) {
  const type = document.getElementById(`edit-type-${id}`).value;
  const caption = document.getElementById(`edit-cap-${id}`).value;
  const thumbs = document.querySelectorAll(`#edit-imgs-${id} .edit-thumb:not(.upload-btn-wrap)`);
  const images = [...thumbs].map(t => t.dataset.path).filter(Boolean);
  if (images.length === 0) { toast('画像は最低1枚必要です'); return; }
  const res = await api('PUT', `/api/${stage}/${id}`, { type, caption, images });
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

// ── スキル一覧 ──────────────────────────────
async function openSkills() {
  document.getElementById('skill-modal').style.display = 'flex';
  showSkillList();
}

async function showSkillList() {
  document.getElementById('skill-list').style.display = 'block';
  document.getElementById('skill-detail').style.display = 'none';
  const skills = await api('GET', '/api/skills');
  const icons = { '4koma': '🎨', 'bizenlife': '🍽', 'akiko_diary': '📔', 'nanobanana': '🖼' };
  document.getElementById('skill-list').innerHTML = skills.map(s =>
    `<div class="skill-item" onclick="showSkillDetail('${s.name}')">
      ${icons[s.name] || '📄'} ${s.title || s.name} <span>›</span>
    </div>`
  ).join('');
}

async function showSkillDetail(name) {
  document.getElementById('skill-list').style.display = 'none';
  document.getElementById('skill-detail').style.display = 'block';
  const data = await api('GET', `/api/skills/${name}`);
  document.getElementById('skill-md').innerHTML = marked.parse(data.content);
}

function closeSkillModal() {
  document.getElementById('skill-modal').style.display = 'none';
}

function closeSkills(e) {
  if (e.target.id === 'skill-modal') closeSkillModal();
}
