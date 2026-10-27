// ===== Supabase 연결 정보 (공개 키라서 파일에 넣어도 괜찮다) =====
const SUPABASE_URL = 'https://rjpxijiqvnxvvaifysfv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eDXtegQq1L0nuMpt9dWJsw_z9-14v-l';
const BUCKET = 'resume';
const MAX_SIZE = 10 * 1024 * 1024;   // 10MB
const EXT = {                         // 올릴 수 있는 파일 종류 → 확장자
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

const $ = (id) => document.getElementById(id);

// ===== 로그인 정보(세션) 보관 =====
// 새로고침해도 로그인이 유지되도록 브라우저에 저장해 둔다.
let session = null;

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    email: data.user ? data.user.email : (session && session.email),
  };
  try { localStorage.setItem('resume_admin_session', JSON.stringify(session)); } catch (e) {}
}

function loadSession() {
  try { session = JSON.parse(localStorage.getItem('resume_admin_session')); } catch (e) { session = null; }
}

function clearSession() {
  session = null;
  try { localStorage.removeItem('resume_admin_session'); } catch (e) {}
}

// ===== Supabase Auth (로그인) =====
async function authRequest(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || '로그인 실패');
  return data;
}

async function login(email, password) {
  saveSession(await authRequest('token?grant_type=password', { email, password }));
}

// 로그인 유효 시간이 끝나 가면 새 토큰으로 바꾼다
async function refreshSession() {
  saveSession(await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token }));
}

async function logout() {
  if (session) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  clearSession();
  showView('login-view');
}

// ===== 로그인한 토큰으로 요청 보내기 =====
function sessionExpired() {
  clearSession();
  showView('login-view');
  return new Error('로그인이 끝났어요. 다시 로그인해 주세요.');
}

async function authorizedFetch(url, options = {}, retried = false) {
  if (!session) throw sessionExpired();
  if (Date.now() > session.expires_at - 60 * 1000) {
    try { await refreshSession(); } catch (e) { throw sessionExpired(); }
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 && !retried) {
    try { await refreshSession(); } catch (e) { throw sessionExpired(); }
    return authorizedFetch(url, options, true);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data.error || `요청 실패 (${res.status})`);
  }
  return res;
}

// 표(REST) 요청
function db(path, options = {}) {
  return authorizedFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
}

// 고치거나 지운 결과를 돌려받아, 실제로 바뀐 줄이 없으면 "권한 없음"으로 알린다
async function dbChange(path, method, body) {
  const res = await db(path, {
    method,
    headers: { Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const rows = await res.json();
  if (method !== 'POST' && rows.length === 0) {
    throw new Error('바뀐 것이 없어요. 관리자 권한을 확인해 주세요.');
  }
  return rows;
}

async function countLikes(projectId) {
  const res = await db(`likes?project_id=eq.${projectId}&select=id`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' },
  });
  const range = res.headers.get('content-range') || '*/0';
  return Number(range.split('/')[1]) || 0;
}

// ===== 보관함(Storage)에 파일 올리기 =====
// 맞지 않는 파일이면 안내 문구를 돌려준다 (괜찮으면 빈 문자열)
function checkFile(file, allowPdf) {
  const ext = EXT[file.type];
  if (!ext || (ext === 'pdf' && !allowPdf)) {
    return allowPdf ? '이미지(PNG·JPG·WEBP·GIF)나 PDF만 올릴 수 있어요.' : '이미지(PNG·JPG·WEBP·GIF)만 올릴 수 있어요.';
  }
  if (file.size > MAX_SIZE) return '10MB가 넘는 파일은 올릴 수 없어요.';
  return '';
}

// 파일 이름은 영어·숫자로 새로 짓는다. 예: projects/1730000000000-a1b2c3.png
function newFileName(folder, file) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${folder}/${Date.now()}-${random}.${EXT[file.type]}`;
}

async function uploadFile(folder, file) {
  const path = newFileName(folder, file);
  await authorizedFetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'x-upsert': 'false' },
    body: file,
  });
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;   // 공개 주소
}

// 파일 고르기 칸 하나를 "검사 → 올리기 → 주소 받기"로 연결한다
function setupUpload(inputId, msgId, folder, allowPdf, onUploaded) {
  const input = $(inputId);
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    const problem = checkFile(file, allowPdf);
    if (problem) {
      showMsg(msgId, problem, 'error');
      return;
    }
    showMsg(msgId, '올리는 중…');
    try {
      const url = await uploadFile(folder, file);
      onUploaded(url);
      showMsg(msgId, '올렸어요. 저장을 눌러야 반영돼요.', 'ok');
    } catch (err) {
      showMsg(msgId, `올리지 못했어요: ${err.message}`, 'error');
    }
  });
}

// ===== 화면 도우미 =====
function showView(id) {
  ['login-view', 'denied-view', 'admin-view'].forEach((v) => { $(v).hidden = v !== id; });
}

function showMsg(id, text, kind = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${kind}`;
  el.hidden = !text;
}

function setBg(el, url) {
  el.style.backgroundImage = url ? `url("${encodeURI(url)}")` : '';
}

function makeButton(text, onClick, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn small ${extraClass}`;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function emptyRow(list, text) {
  list.textContent = '';
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  list.append(li);
}

// ===== 시작: 로그인 확인 → 관리자 확인 =====
async function start() {
  loadSession();
  if (!session) {
    showView('login-view');
    return;
  }
  try {
    const res = await db('admins?select=user_id');
    const rows = await res.json();
    if (rows.length === 0) {
      $('denied-email').textContent = `${session.email || ''} 계정은 관리자로 등록되어 있지 않아요.`;
      showView('denied-view');
      return;
    }
  } catch (err) {
    clearSession();
    showView('login-view');
    return;
  }
  $('who').textContent = session.email || '';
  showView('admin-view');
  loadProfile();
  loadProjects();
  loadGuestbook();
}

async function onLogin() {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email || !password) {
    showMsg('login-msg', '이메일과 비밀번호를 모두 적어 주세요.', 'error');
    return;
  }
  $('login-btn').disabled = true;
  showMsg('login-msg', '');
  try {
    await login(email, password);
    $('login-password').value = '';
    await start();
  } catch (err) {
    showMsg('login-msg', '로그인하지 못했어요. 이메일과 비밀번호를 확인해 주세요.', 'error');
  } finally {
    $('login-btn').disabled = false;
  }
}

$('login-btn').addEventListener('click', onLogin);
['login-email', 'login-password'].forEach((id) => {
  $(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) onLogin();
  });
});
document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', logout));

// ===== 프로필 =====
const PROFILE_FIELDS = ['name', 'title', 'career_badge', 'email', 'phone', 'location',
  'headline', 'intro', 'education', 'skills', 'experience', 'quote'];
let profilePhotoUrl = null;

function setProfilePhoto(url) {
  profilePhotoUrl = url;
  setBg($('p-photo-preview'), url);
}

async function loadProfile() {
  try {
    const res = await db('profile?id=eq.1&select=*');
    const p = (await res.json())[0] || {};
    PROFILE_FIELDS.forEach((f) => { $(`p-${f}`).value = p[f] || ''; });
    setProfilePhoto(p.photo_url || null);
  } catch (err) {
    showMsg('p-msg', `프로필을 불러오지 못했어요: ${err.message}`, 'error');
  }
}

setupUpload('p-photo-file', 'p-photo-msg', 'profile', false, setProfilePhoto);
$('p-photo-clear').addEventListener('click', () => {
  setProfilePhoto(null);
  showMsg('p-photo-msg', '사진을 뺐어요. 저장을 눌러야 반영돼요.', 'ok');
});

$('p-save').addEventListener('click', async () => {
  const row = { id: 1, photo_url: profilePhotoUrl, updated_at: new Date().toISOString() };
  PROFILE_FIELDS.forEach((f) => { row[f] = $(`p-${f}`).value.trim(); });

  $('p-save').disabled = true;
  try {
    // 줄이 있으면 고치고, 없으면 새로 만든다
    await db('profile?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
    showMsg('p-msg', '저장했어요. 방문자 화면에 바로 보여요.', 'ok');
    showMsg('p-photo-msg', '');
  } catch (err) {
    showMsg('p-msg', `저장하지 못했어요: ${err.message}`, 'error');
  } finally {
    $('p-save').disabled = false;
  }
});

// ===== 포트폴리오 카드 =====
let projects = [];
let editingId = null;          // 고치는 중인 카드 id (새 카드면 null)
let formThumbUrl = null;
let formFileUrl = null;

async function loadProjects() {
  try {
    const res = await db('projects?select=*&order=sort_order.asc,id.asc');
    projects = await res.json();
    const counts = await Promise.all(projects.map((p) => countLikes(p.id).catch(() => '?')));
    projects.forEach((p, i) => { p.likeCount = counts[i]; });
    renderProjects();
    renderLikes();
  } catch (err) {
    emptyRow($('proj-list'), `카드를 불러오지 못했어요: ${err.message}`);
    emptyRow($('like-list'), '');
  }
}

function renderProjects() {
  const list = $('proj-list');
  if (projects.length === 0) {
    emptyRow(list, '아직 카드가 없어요. "+ 카드 추가"를 눌러 만들어 보세요.');
    return;
  }
  list.textContent = '';
  projects.forEach((p, i) => {
    const li = document.createElement('li');
    li.className = 'proj-row';

    const thumb = document.createElement('div');
    thumb.className = 'mini-thumb';
    setBg(thumb, p.thumbnail_url);

    const info = document.createElement('div');
    info.className = 'row-info';
    const meta = document.createElement('p');
    meta.className = 'card-meta';
    meta.textContent = `${p.number} ${p.category}`;
    const title = document.createElement('p');
    title.className = 'row-title';
    title.textContent = p.title;
    const sub = document.createElement('p');
    sub.className = 'row-sub';
    sub.textContent = `♥ ${p.likeCount} · 순서 ${p.sort_order}${p.file_url ? ' · 첨부 있음' : ''}`;
    info.append(meta, title, sub);

    const btns = document.createElement('div');
    btns.className = 'row-btns';
    const up = makeButton('▲', () => move(i, -1));
    up.disabled = i === 0;
    up.setAttribute('aria-label', '위로');
    const down = makeButton('▼', () => move(i, 1));
    down.disabled = i === projects.length - 1;
    down.setAttribute('aria-label', '아래로');
    btns.append(up, down, makeButton('수정', () => openForm(p)), makeButton('삭제', () => removeProject(p), 'danger'));

    li.append(thumb, info, btns);
    list.append(li);
  });
}

// 순서 올리기·내리기: 바꾼 뒤 1, 2, 3… 으로 다시 번호를 매긴다
async function move(index, step) {
  const order = projects.slice();
  const [item] = order.splice(index, 1);
  order.splice(index + step, 0, item);
  try {
    await Promise.all(order.map((p, i) => (
      p.sort_order === i + 1 ? null : dbChange(`projects?id=eq.${p.id}`, 'PATCH', { sort_order: i + 1 })
    )));
  } catch (err) {
    alert(`순서를 바꾸지 못했어요: ${err.message}`);
  }
  loadProjects();
}

async function removeProject(p) {
  if (!confirm(`"${p.title}" 카드를 지울까요?\n이 카드의 좋아요도 함께 지워지고, 되돌릴 수 없어요.`)) return;
  try {
    await dbChange(`projects?id=eq.${p.id}`, 'DELETE');
    if (editingId === p.id) closeForm();
  } catch (err) {
    alert(`지우지 못했어요: ${err.message}`);
  }
  loadProjects();
}

// 추가·수정 폼
function setFormThumb(url) {
  formThumbUrl = url;
  setBg($('f-thumb-preview'), url);
}

function setFormFile(url) {
  formFileUrl = url;
  const now = $('f-file-now');
  now.textContent = '';
  if (url) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = url.split('/').pop();
    now.append(a);
  } else {
    now.textContent = '없음';
  }
}

function openForm(p) {
  editingId = p ? p.id : null;
  $('proj-form-title').textContent = p ? '카드 수정' : '카드 추가';
  $('f-number').value = p ? p.number : String(projects.length + 1).padStart(2, '0');
  $('f-category').value = p ? p.category : '';
  $('f-title').value = p ? p.title : '';
  $('f-description').value = p ? p.description : '';
  $('f-tags').value = p ? (p.tags || []).join(', ') : '';
  setFormThumb(p ? p.thumbnail_url : null);
  setFormFile(p ? p.file_url : null);
  ['f-msg', 'f-thumb-msg', 'f-file-msg'].forEach((id) => showMsg(id, ''));
  $('proj-form').hidden = false;
  $('proj-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('f-title').focus({ preventScroll: true });
}

function closeForm() {
  editingId = null;
  $('proj-form').hidden = true;
}

setupUpload('f-thumb-file', 'f-thumb-msg', 'projects', false, setFormThumb);
setupUpload('f-file-file', 'f-file-msg', 'projects', true, setFormFile);
$('f-thumb-clear').addEventListener('click', () => setFormThumb(null));
$('f-file-clear').addEventListener('click', () => setFormFile(null));
$('proj-add').addEventListener('click', () => openForm(null));
$('f-cancel').addEventListener('click', closeForm);

$('f-save').addEventListener('click', async () => {
  showMsg('f-msg', '');
  const title = $('f-title').value.trim();
  if (!title) {
    showMsg('f-msg', '제목을 적어 주세요.', 'error');
    return;
  }
  const row = {
    number: $('f-number').value.trim(),
    category: $('f-category').value.trim(),
    title,
    description: $('f-description').value.trim(),
    tags: $('f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    thumbnail_url: formThumbUrl,
    file_url: formFileUrl,
  };

  $('f-save').disabled = true;
  try {
    if (editingId) {
      await dbChange(`projects?id=eq.${editingId}`, 'PATCH', row);
    } else {
      const last = projects[projects.length - 1];
      row.sort_order = last ? last.sort_order + 1 : 1;   // 새 카드는 맨 뒤에
      await dbChange('projects', 'POST', row);
    }
    closeForm();
    loadProjects();
  } catch (err) {
    showMsg('f-msg', `저장하지 못했어요: ${err.message}`, 'error');
  } finally {
    $('f-save').disabled = false;
  }
});

// ===== 좋아요 =====
function renderLikes() {
  const list = $('like-list');
  if (projects.length === 0) {
    emptyRow(list, '카드가 없어요.');
    return;
  }
  list.textContent = '';
  projects.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'like-row';
    const title = document.createElement('span');
    title.className = 'row-title';
    title.textContent = `${p.number} ${p.title}`;
    const count = document.createElement('span');
    count.className = 'like-count';
    count.textContent = `♥ ${p.likeCount}`;
    const reset = makeButton('좋아요 초기화', () => resetLikes(p), 'danger');
    reset.disabled = !p.likeCount;
    li.append(title, count, reset);
    list.append(li);
  });
}

async function resetLikes(p) {
  if (!confirm(`"${p.title}" 카드의 좋아요 ${p.likeCount}개를 모두 지울까요?\n되돌릴 수 없어요.`)) return;
  try {
    await dbChange(`likes?project_id=eq.${p.id}`, 'DELETE');
  } catch (err) {
    alert(`초기화하지 못했어요: ${err.message}`);
  }
  loadProjects();
}

// ===== 방명록 =====
function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function loadGuestbook() {
  const list = $('gb-admin-list');
  try {
    const res = await db('resume_guestbook?select=*&order=created_at.desc');
    const rows = await res.json();
    if (rows.length === 0) {
      emptyRow(list, '방명록 글이 없어요.');
      return;
    }
    list.textContent = '';
    rows.forEach((row) => {
      const li = document.createElement('li');
      li.className = 'gb-row';
      const text = document.createElement('div');
      text.className = 'row-info';
      const head = document.createElement('div');
      head.className = 'gb-head';
      const nick = document.createElement('span');
      nick.className = 'gb-nick';
      nick.textContent = row.nickname;
      const date = document.createElement('span');
      date.className = 'gb-date';
      date.textContent = formatDate(row.created_at);
      head.append(nick, date);
      const msg = document.createElement('p');
      msg.className = 'gb-msg';
      msg.textContent = row.message;
      text.append(head, msg);
      li.append(text, makeButton('삭제', () => removeGuestbook(row), 'danger'));
      list.append(li);
    });
  } catch (err) {
    emptyRow(list, `방명록을 불러오지 못했어요: ${err.message}`);
  }
}

async function removeGuestbook(row) {
  if (!confirm(`${row.nickname} 님의 글을 지울까요?\n"${row.message}"\n되돌릴 수 없어요.`)) return;
  try {
    await dbChange(`resume_guestbook?id=eq.${row.id}`, 'DELETE');
  } catch (err) {
    alert(`지우지 못했어요: ${err.message}`);
  }
  loadGuestbook();
}

start();
