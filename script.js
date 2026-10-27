// ===== Supabase 연결 정보 (공개 키라서 파일에 넣어도 괜찮다) =====
const SUPABASE_URL = 'https://rjpxijiqvnxvvaifysfv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eDXtegQq1L0nuMpt9dWJsw_z9-14v-l';

// Supabase 표에 요청을 보내는 함수
async function api(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`요청 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res;
}

// ===== 이 브라우저의 이름표(client_id) =====
// 처음 온 브라우저면 새로 만들어 저장하고, 다음부터는 저장된 것을 쓴다.
function getClientId() {
  let id = null;
  try { id = localStorage.getItem('resume_client_id'); } catch (e) {}
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
    try { localStorage.setItem('resume_client_id', id); } catch (e) {}
  }
  return id;
}
const CLIENT_ID = getClientId();

// 글자를 넣을 때는 항상 textContent 를 쓴다 (방문자가 쓴 글이 코드로 실행되지 않도록)
function setText(id, value) {
  document.getElementById(id).textContent = value || '';
}

// ===== 1. 프로필 =====
async function loadProfile() {
  const res = await api('profile?id=eq.1&select=*');
  const rows = await res.json();
  const p = rows[0];
  if (!p) return;

  setText('name', p.name);
  setText('title', p.title);
  setText('c-name', p.name);
  setText('c-email', p.email);
  setText('c-phone', p.phone);
  setText('c-location', p.location);
  setText('intro', p.intro);
  setText('education', p.education);
  setText('skills', p.skills);
  setText('experience', p.experience);
  setText('quote', p.quote);

  const badge = document.getElementById('badge');
  badge.textContent = p.career_badge || '';
  badge.hidden = !p.career_badge;

  if (p.photo_url) {
    document.getElementById('photo').style.backgroundImage = `url("${encodeURI(p.photo_url)}")`;
  }

  // 한 줄 소개: 그 안에 있는 이름에만 파란 밑줄
  const headline = document.getElementById('headline');
  headline.textContent = '';
  const text = p.headline || '';
  const at = p.name ? text.indexOf(p.name) : -1;
  if (at === -1) {
    headline.textContent = text;
  } else {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'hl-name';
    nameSpan.textContent = p.name;
    headline.append(text.slice(0, at), nameSpan, text.slice(at + p.name.length));
  }

  if (p.name) document.title = `${p.name} | 포트폴리오`;
}

// ===== 2. 포트폴리오 카드 =====
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z"/></svg>';

// 카드 하나의 좋아요 수 (줄 수만 세어 온다)
async function countLikes(projectId) {
  const res = await api(`likes?project_id=eq.${projectId}&select=id`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' },
  });
  const range = res.headers.get('content-range') || '*/0';   // 예: "0-4/5"
  return Number(range.split('/')[1]) || 0;
}

// 이 브라우저가 이미 좋아요 누른 카드 번호들
async function loadMyLikes() {
  const res = await api(`likes?client_id=eq.${encodeURIComponent(CLIENT_ID)}&select=project_id`);
  const rows = await res.json();
  return new Set(rows.map((r) => r.project_id));
}

async function loadProjects() {
  const box = document.getElementById('cards');
  const res = await api('projects?select=*&order=sort_order.asc,id.asc');
  const projects = await res.json();

  if (projects.length === 0) {
    box.innerHTML = '<p class="empty">아직 등록된 프로젝트가 없습니다.</p>';
    return;
  }

  const [counts, mine] = await Promise.all([
    Promise.all(projects.map((p) => countLikes(p.id).catch(() => 0))),
    loadMyLikes().catch(() => new Set()),
  ]);

  box.textContent = '';
  projects.forEach((p, i) => box.append(makeCard(p, counts[i], mine.has(p.id))));
}

function makeCard(p, likeCount, alreadyLiked) {
  const card = document.createElement('article');
  card.className = 'card';

  // 썸네일 (브라우저 창 모양)
  const browser = document.createElement('div');
  browser.className = 'browser';
  browser.innerHTML = '<div class="browser-bar"><i></i><i></i><i></i></div><div class="browser-view"></div>';
  if (p.thumbnail_url) {
    browser.querySelector('.browser-view').style.backgroundImage = `url("${encodeURI(p.thumbnail_url)}")`;
  }

  const body = document.createElement('div');
  body.className = 'card-body';

  const meta = document.createElement('p');
  meta.className = 'card-meta';
  const num = document.createElement('b');
  num.textContent = p.number;
  meta.append(num, p.category);

  const title = document.createElement('h4');
  title.className = 'card-title';
  title.textContent = p.title;

  const desc = document.createElement('p');
  desc.className = 'card-desc';
  desc.textContent = p.description;

  const tags = document.createElement('div');
  tags.className = 'tags';
  (p.tags || []).forEach((t) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = t;
    tags.append(tag);
  });

  // 좋아요 버튼
  const like = document.createElement('button');
  like.type = 'button';
  like.className = 'like';
  like.innerHTML = `${HEART}<span></span>`;
  const countEl = like.querySelector('span');
  countEl.textContent = likeCount;
  setLiked(like, alreadyLiked);

  like.addEventListener('click', async (event) => {
    event.stopPropagation();          // 카드가 새 탭으로 열리지 않게
    if (like.classList.contains('liked')) return;

    setLiked(like, true);
    countEl.textContent = Number(countEl.textContent) + 1;
    try {
      await api('likes', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ project_id: p.id, client_id: CLIENT_ID }),
      });
    } catch (err) {
      if (err.status === 409) {
        // 이미 누른 적이 있었다 → 숫자는 원래대로
        countEl.textContent = Number(countEl.textContent) - 1;
      } else {
        setLiked(like, false);
        countEl.textContent = Number(countEl.textContent) - 1;
        alert('좋아요를 저장하지 못했어요. 잠시 후 다시 눌러 주세요.');
      }
    }
  });

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  foot.append(tags, like);

  body.append(meta, title, desc, foot);
  card.append(browser, body);

  // 카드를 누르면 첨부 파일, 없으면 썸네일을 새 탭으로
  const link = p.file_url || p.thumbnail_url;
  if (link) {
    card.classList.add('clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    const open = () => window.open(link, '_blank', 'noopener');
    card.addEventListener('click', open);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') open();
    });
  }

  return card;
}

function setLiked(button, liked) {
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', liked ? 'true' : 'false');
  button.setAttribute('aria-label', liked ? '좋아요 누름' : '좋아요');
}

// ===== 3. 방명록 =====
function formatDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeEntry(row) {
  const li = document.createElement('li');
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
  li.append(head, msg);
  return li;
}

function showEmptyGuestbook(list, text) {
  list.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  list.append(li);
}

async function loadGuestbook() {
  const list = document.getElementById('gb-list');
  const res = await api('resume_guestbook?select=*&order=created_at.desc&limit=100');
  const rows = await res.json();
  if (rows.length === 0) {
    showEmptyGuestbook(list, '첫 번째 글을 남겨 주세요.');
    return;
  }
  list.textContent = '';
  rows.forEach((row) => list.append(makeEntry(row)));
}

async function submitGuestbook() {
  const nickInput = document.getElementById('gb-nickname');
  const msgInput = document.getElementById('gb-message');
  const button = document.getElementById('gb-submit');
  const error = document.getElementById('gb-error');
  const nickname = nickInput.value.trim();
  const message = msgInput.value.trim();

  error.hidden = true;
  if (!nickname || !message) {
    error.textContent = '별명과 한마디를 모두 적어 주세요.';
    error.hidden = false;
    return;
  }

  button.disabled = true;
  try {
    const res = await api('resume_guestbook', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ nickname, message }),
    });
    const [row] = await res.json();
    const list = document.getElementById('gb-list');
    const empty = list.querySelector('.empty');
    if (empty) empty.remove();
    list.prepend(makeEntry(row));      // 목록 맨 위에 바로 보이기
    msgInput.value = '';
  } catch (err) {
    error.textContent = '저장하지 못했어요. 잠시 후 다시 시도해 주세요.';
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

document.getElementById('gb-submit').addEventListener('click', submitGuestbook);
// 입력칸에서 엔터를 눌러도 남기기
document.getElementById('gb-form').addEventListener('submit', (e) => e.preventDefault());
['gb-nickname', 'gb-message'].forEach((id) => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      submitGuestbook();
    }
  });
});

// ===== 시작 =====
loadProfile().catch(() => setText('headline', '프로필을 불러오지 못했어요.'));
loadProjects().catch(() => {
  document.getElementById('cards').innerHTML = '<p class="empty">프로젝트를 불러오지 못했어요.</p>';
});
loadGuestbook().catch(() => showEmptyGuestbook(document.getElementById('gb-list'), '방명록을 불러오지 못했어요.'));
