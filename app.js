// ═══════════════════════════════════════════════════════════════
//  VIBE SOCIAL — app.js
//  Replace the Firebase config below with your own config.
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithPopup, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updatePassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, addDoc,
  collection, query, where, orderBy, limit, getDocs,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove,
  increment, deleteDoc, writeBatch, startAfter
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ═══════════════ FIREBASE CONFIG — REPLACE THIS ═══════════════
const firebaseConfig = {
  apiKey: "AIzaSyDhZMQlIl1XOlXzxQ8Z_oKrfothx5MghjI",
  authDomain: "nexuslyzy.firebaseapp.com",
  projectId: "nexuslyzy",
  storageBucket: "nexuslyzy.firebasestorage.app",
  messagingSenderId: "367289248780",
  appId: "1:367289248780:web:1ab8bcf14701a7c59ad229"
};
// ═════════════════════════════════════════════════════════════

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ─── App State ───────────────────────────────────────────────
let currentUser = null;
let currentProfile = null; // Firestore user doc
let currentFeedTab = 'foryou';
let feedFilter = null;
let lastPostDoc = null;
let activeChatUID = null;
let activeChatUnsub = null;
let notifsUnsub = null;
let pendingWarn = null;
let pendingGoogleUID = null;

// ─── Badge definitions ───────────────────────────────────────
const BADGES = {
  veteran:  { label: 'Veteran',  icon: '🎖️',  cls: 'badge-veteran' },
  pioneer:  { label: 'Pioneer',  icon: '🚀',  cls: 'badge-pioneer' },
  creator:  { label: 'Creator',  icon: '✨',  cls: 'badge-creator' },
  vip:      { label: 'VIP',      icon: '💎',  cls: 'badge-vip' },
  staff:    { label: 'Staff',    icon: '🛡️',  cls: 'badge-staff' },
  legend:   { label: 'Legend',   icon: '🏆',  cls: 'badge-legend' },
  artist:   { label: 'Artist',   icon: '🎨',  cls: 'badge-artist' },
  mod:      { label: 'Mod',      icon: '🔧',  cls: 'badge-mod' },
};

// ─── Splash → Auth transition ────────────────────────────────
setTimeout(() => {
  document.getElementById('splash').style.display = 'none';
}, 3200);

// ─── Auth state listener ─────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showPage('auth-page');
    return;
  }
  currentUser = user;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // Brand new Google user — needs onboarding
    pendingGoogleUID = user.uid;
    showPage('onboard-page');
    return;
  }

  const data = snap.data();
  currentProfile = data;

  // Check ban
  if (data.banned) {
    document.getElementById('ban-reason').textContent = data.banReason || 'Your account has been suspended.';
    document.getElementById('ban-date').textContent = data.bannedAt
      ? 'Suspended on: ' + new Date(data.bannedAt.toDate()).toLocaleDateString()
      : '';
    showPage('ban-page');
    return;
  }

  // If profile incomplete (Google user missing username)
  if (!data.username) {
    pendingGoogleUID = user.uid;
    showPage('onboard-page');
    return;
  }

  // All good — load app
  loadApp(data);

  // Check for unacknowledged warnings after 2s
  setTimeout(() => checkWarnings(user.uid), 2000);
});

// ─── Load App ────────────────────────────────────────────────
function loadApp(profile) {
  showPage('app-page');
  currentProfile = profile;

  // Update UI elements
  const displayName = profile.displayName || profile.fullName || 'User';
  const handle = profile.username ? '@' + profile.username : '';

  setAvatar('tb-av', displayName, profile.avatar);
  setAvatar('um-av', displayName, profile.avatar);
  setAvatar('comp-av', displayName, profile.avatar);
  document.getElementById('um-name').textContent = displayName;
  document.getElementById('um-handle').textContent = handle;
  document.getElementById('comp-name').textContent = displayName.split(' ')[0];

  if (profile.isAdmin) {
    document.getElementById('um-admin-btn').classList.remove('hidden');
  }

  loadFeed();
  loadWidgets();
  loadDMList();
  subscribeNotifs();
  updatePresence(currentUser.uid, true);

  // Prefill settings
  document.getElementById('set-dn').value = displayName;
  document.getElementById('set-bio').value = profile.bio || '';
  document.getElementById('set-loc').value = profile.location || '';
  document.getElementById('set-web').value = profile.website || '';
  document.getElementById('set-av').value = profile.avatar || '';
  document.getElementById('set-bn').value = profile.banner || '';
}

// ─── Avatar helper ───────────────────────────────────────────
function setAvatar(elemId, name, url) {
  const el = document.getElementById(elemId);
  if (!el) return;
  if (url) {
    el.innerHTML = `<img src="${url}" onerror="this.parentElement.textContent='${name[0].toUpperCase()}'" />`;
  } else {
    el.textContent = name[0].toUpperCase();
  }
}

function avatarHTML(name, url, size = 40) {
  if (url) return `<img src="${url}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:50%" onerror="this.style.display='none'" />`;
  return name ? name[0].toUpperCase() : '?';
}

// ─── Show/hide pages ─────────────────────────────────────────
function showPage(id) {
  ['splash','auth-page','onboard-page','app-page','admin-page','ban-page'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(id);
  if (target) target.classList.remove('hidden');
}

// ─── Toast ───────────────────────────────────────────────────
function toast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}

// ═══════════════════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ═══════════════════════════════════════════════════════════════

window.authTab = function(tab) {
  document.getElementById('form-in').classList.toggle('hidden', tab !== 'in');
  document.getElementById('form-up').classList.toggle('hidden', tab !== 'up');
  document.getElementById('tab-in').classList.toggle('active', tab === 'in');
  document.getElementById('tab-up').classList.toggle('active', tab === 'up');
};

window.googleAuth = async function() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      // New Google user — will be caught by onAuthStateChanged
    }
  } catch (e) {
    toast('Google sign-in failed: ' + e.message);
  }
};

window.emailLogin = async function() {
  const email = document.getElementById('li-email').value.trim();
  const pass = document.getElementById('li-pass').value;
  const errEl = document.getElementById('li-err');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Please fill in all fields.'; return; }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    errEl.textContent = e.message.replace('Firebase: ','').replace(/\(.*\)/,'');
  }
};

window.emailSignup = async function() {
  const fn = document.getElementById('su-fn').value.trim();
  const ln = document.getElementById('su-ln').value.trim();
  const un = document.getElementById('su-un').value.trim().replace(/^@/,'').toLowerCase();
  const em = document.getElementById('su-em').value.trim();
  const pw = document.getElementById('su-pw').value;
  const bd = document.getElementById('su-bd').value;
  const gd = document.getElementById('su-gd').value;
  const bio = document.getElementById('su-bio').value.trim();
  const errEl = document.getElementById('su-err');
  errEl.textContent = '';

  if (!fn || !ln || !un || !em || !pw || !bd) {
    errEl.textContent = 'Please fill in all required fields.'; return;
  }
  if (pw.length < 8) { errEl.textContent = 'Password must be at least 8 characters.'; return; }
  if (un.length < 3) { errEl.textContent = 'Username must be at least 3 characters.'; return; }

  // Check username uniqueness
  const unCheck = await getDocs(query(collection(db, 'users'), where('username', '==', un)));
  if (!unCheck.empty) { errEl.textContent = 'Username already taken.'; return; }

  try {
    const cred = await createUserWithEmailAndPassword(auth, em, pw);
    await createUserDoc(cred.user.uid, {
      fullName: `${fn} ${ln}`, firstName: fn, lastName: ln,
      username: un, email: em, birthdate: bd, gender: gd, bio,
    });
  } catch (e) {
    errEl.textContent = e.message.replace('Firebase: ','').replace(/\(.*\)/,'');
  }
};

window.completeOnboard = async function() {
  const un = document.getElementById('ob-un').value.trim().replace(/^@/,'').toLowerCase();
  const bd = document.getElementById('ob-bd').value;
  const gd = document.getElementById('ob-gd').value;
  const bio = document.getElementById('ob-bio').value.trim();
  const errEl = document.getElementById('ob-err');
  errEl.textContent = '';

  if (!un || !bd) { errEl.textContent = 'Username and birthdate are required.'; return; }
  if (un.length < 3) { errEl.textContent = 'Username must be at least 3 characters.'; return; }

 const unCheck = await getDocs(query(collection(db, 'users'), where('username', '==', un)));
 const taken = unCheck.docs.some(d => d.id !== uid);
  if (taken) { errEl.textContent = 'Username taken. Try another.'; return; }

  const uid = pendingGoogleUID || currentUser.uid;
  await createUserDoc(uid, {
    fullName: currentUser.displayName || un,
    username: un, email: currentUser.email,
    birthdate: bd, gender: gd, bio,
    avatar: currentUser.photoURL || '',
  });
  pendingGoogleUID = null;
};

async function createUserDoc(uid, extra = {}) {
  const userDoc = {
    uid,
    fullName: extra.fullName || '',
    displayName: extra.fullName || '',
    username: extra.username || '',
    email: extra.email || '',
    birthdate: extra.birthdate || '',
    gender: extra.gender || '',
    bio: extra.bio || '',
    avatar: extra.avatar || '',
    banner: '',
    location: '',
    website: '',
    isAdmin: false,
    isVerified: false,
    badges: [],
    followers: [],
    following: [],
    postsCount: 0,
    banned: false,
    banReason: '',
    bannedAt: null,
    bannedBy: '',
    warnings: [],
    mutedUntil: null,
    createdAt: serverTimestamp(),
    lastSeen: serverTimestamp(),
    online: true,
  };
  Object.assign(userDoc, extra);
  await setDoc(doc(db, 'users', uid), userDoc);
}

window.doLogout = async function() {
  if (currentUser) await updatePresence(currentUser.uid, false);
  await signOut(auth);
  currentUser = null; currentProfile = null;
  if (activeChatUnsub) activeChatUnsub();
  if (notifsUnsub) notifsUnsub();
  showPage('auth-page');
};

// ═══════════════════════════════════════════════════════════════
//  PRESENCE
// ═══════════════════════════════════════════════════════════════
async function updatePresence(uid, online) {
  try {
    await updateDoc(doc(db, 'users', uid), {
      online,
      lastSeen: serverTimestamp(),
    });
  } catch (_) {}
}
window.addEventListener('beforeunload', () => {
  if (currentUser) updatePresence(currentUser.uid, false);
});

// ═══════════════════════════════════════════════════════════════
//  FEED & POSTS
// ═══════════════════════════════════════════════════════════════

window.goHome = function() {
  feedFilter = null;
  document.getElementById('feed-hdr-title') && (document.getElementById('feed-hdr-title').textContent = '✦ Home Feed');
  const titleEl = document.getElementById('feed-title');
  if (titleEl) titleEl.textContent = '✦ Home Feed';
  loadFeed();
};

window.goExplore = function() {
  feedFilter = 'explore';
  const titleEl = document.getElementById('feed-title');
  if (titleEl) titleEl.textContent = '⚡ Explore';
  loadFeed();
};

window.filterFeed = function(type) {
  feedFilter = type;
  const titles = { trending: '🔥 Trending', following: '👥 Following', media: '🖼️ Media' };
  const titleEl = document.getElementById('feed-title');
  if (titleEl) titleEl.textContent = titles[type] || '✦ Feed';
  loadFeed();
};

window.setFeedTab = function(tab, btn) {
  currentFeedTab = tab;
  document.querySelectorAll('.feed-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadFeed();
};

async function loadFeed() {
  const area = document.getElementById('posts-area');
  area.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--muted)">Loading posts…</div>';
  lastPostDoc = null;

  try {
    let q;
    if (feedFilter === 'following' && currentProfile?.following?.length) {
      q = query(collection(db, 'posts'), where('uid', 'in', currentProfile.following.slice(0,10)), where('audience','==','public'), orderBy('createdAt','desc'), limit(20));
    } else if (feedFilter === 'media') {
      q = query(collection(db, 'posts'), where('hasImage','==',true), orderBy('createdAt','desc'), limit(20));
    } else if (feedFilter === 'trending') {
      q = query(collection(db, 'posts'), where('audience','==','public'), orderBy('likes','desc'), orderBy('createdAt','desc'), limit(20));
    } else {
      q = query(collection(db, 'posts'), where('audience','==','public'), orderBy('createdAt','desc'), limit(20));
    }

    const snaps = await getDocs(q);
    area.innerHTML = '';

    // Pinned announcements first
    const annSnap = await getDocs(query(collection(db, 'announcements'), where('pinned','==',true), orderBy('createdAt','desc'), limit(3)));
    annSnap.forEach(d => {
      area.insertAdjacentHTML('beforeend', renderAnnouncement(d.id, d.data()));
    });

    if (snaps.empty) {
      area.innerHTML += '<div style="text-align:center;padding:3rem;color:var(--muted)">No posts yet. Be the first to post! 🎉</div>';
      return;
    }

    snaps.forEach(d => {
      area.insertAdjacentHTML('beforeend', renderPost(d.id, d.data()));
    });

    lastPostDoc = snaps.docs[snaps.docs.length - 1];
    const loadMoreEl = document.getElementById('load-more-wrap');
    if (loadMoreEl) loadMoreEl.classList.toggle('hidden', snaps.docs.length < 20);

  } catch (e) {
    area.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--red)">Error loading posts. Check Firestore indexes.<br><small>${e.message}</small></div>`;
  }
}

window.loadMorePosts = async function() {
  if (!lastPostDoc) return;
  const q = query(collection(db, 'posts'), where('audience','==','public'), orderBy('createdAt','desc'), startAfter(lastPostDoc), limit(20));
  const snaps = await getDocs(q);
  const area = document.getElementById('posts-area');
  snaps.forEach(d => area.insertAdjacentHTML('beforeend', renderPost(d.id, d.data())));
  lastPostDoc = snaps.docs[snaps.docs.length - 1];
  if (snaps.docs.length < 20) document.getElementById('load-more-wrap')?.classList.add('hidden');
};

function renderPost(id, data) {
  const isOwn = data.uid === currentUser?.uid;
  const isLiked = data.likedBy?.includes(currentUser?.uid);
  const time = data.createdAt ? timeAgo(data.createdAt.toDate()) : 'just now';
  const name = data.authorName || 'User';
  const handle = data.authorHandle ? '@' + data.authorHandle : '';

  let badgesHTML = '';
  if (data.authorBadges?.length) {
    data.authorBadges.forEach(b => {
      if (BADGES[b]) badgesHTML += `<span class="badge-chip ${BADGES[b].cls}">${BADGES[b].icon} ${BADGES[b].label}</span>`;
    });
  }

  let mediaHTML = '';
  if (data.imageURL) mediaHTML = `<div class="post-image"><img src="${data.imageURL}" alt="Post image" onclick="openDetailModal('${id}')" loading="lazy" /></div>`;

  let feelingHTML = '';
  if (data.feeling) feelingHTML = `<span class="post-feeling-badge">— feeling ${data.feeling}</span>`;

  let pollHTML = '';
  if (data.poll && data.poll.options) {
    const totalVotes = data.poll.votes ? Object.values(data.poll.votes).reduce((a,b)=>a+b,0) : 0;
    pollHTML = `<div class="post-poll">`;
    data.poll.options.forEach((opt, i) => {
      const votes = data.poll.votes?.[i] || 0;
      const pct = totalVotes ? Math.round(votes/totalVotes*100) : 0;
      const voted = data.poll.userVotes?.[currentUser?.uid] === i;
      pollHTML += `<div class="poll-option ${voted?'voted':''}" onclick="votePoll('${id}',${i})">
        <div class="poll-bar" style="width:${pct}%"></div>
        <div class="poll-option-text"><span>${opt}</span><span class="poll-pct">${pct}%</span></div>
      </div>`;
    });
    pollHTML += `<div style="font-size:0.75rem;color:var(--muted);margin-top:0.3rem">${totalVotes} vote${totalVotes!==1?'s':''}</div></div>`;
  }

  const optionsBtn = isOwn
    ? `<button class="post-options-btn" onclick="deletePost('${id}')">🗑️</button>`
    : `<button class="post-options-btn" onclick="reportPost('${id}','${name}')">⋯</button>`;

  return `
<div class="post-card" id="post-${id}">
  <div class="post-header">
    <div class="post-av" onclick="openProfileByUID('${data.uid}')">${data.authorAvatar ? `<img src="${data.authorAvatar}" />` : name[0].toUpperCase()}</div>
    <div class="post-meta">
      <div class="post-author-row">
        <span class="post-author" onclick="openProfileByUID('${data.uid}')">${escHTML(name)}</span>
        ${data.authorVerified ? '<span class="check-verified" title="Verified">✓</span>' : ''}
        ${badgesHTML}
        ${feelingHTML}
        <span class="post-time">${time}</span>
      </div>
      <div class="post-handle">${handle}</div>
    </div>
    ${optionsBtn}
  </div>
  <div class="post-body">
    ${data.text ? `<div class="post-text">${escHTML(data.text)}</div>` : ''}
    ${mediaHTML}
    ${pollHTML}
  </div>
  <div class="post-actions">
    <button class="pact-btn ${isLiked?'liked':''}" onclick="toggleLike('${id}',this)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="${isLiked?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
      <span class="count">${data.likes || 0}</span>
    </button>
    <button class="pact-btn" onclick="toggleComments('${id}')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
      <span class="count">${data.commentsCount || 0}</span>
    </button>
    <button class="pact-btn" onclick="sharePost('${id}')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
    </button>
  </div>
  <div class="post-comments hidden" id="comments-${id}"></div>
</div>`;
}

function renderAnnouncement(id, data) {
  const time = data.createdAt ? timeAgo(data.createdAt.toDate()) : '';
  return `
<div class="post-card post-announcement">
  <div class="post-pinned-badge">📌 System Announcement</div>
  <div class="post-text" style="font-size:0.92rem">${escHTML(data.text)}</div>
  <div style="font-size:0.75rem;color:var(--muted);margin-top:0.4rem">${time}</div>
</div>`;
}

window.toggleLike = async function(postId, btn) {
  if (!currentUser) return;
  const ref = doc(db, 'posts', postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  const liked = data.likedBy?.includes(currentUser.uid);
  await updateDoc(ref, {
    likes: increment(liked ? -1 : 1),
    likedBy: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
  });
  btn.classList.toggle('liked', !liked);
  const count = btn.querySelector('.count');
  if (count) count.textContent = Math.max(0, (data.likes || 0) + (liked ? -1 : 1));

  if (!liked && data.uid !== currentUser.uid) {
    sendNotification(data.uid, 'like', currentProfile?.displayName || 'Someone', postId);
  }
};

window.toggleComments = async function(postId) {
  const el = document.getElementById('comments-' + postId);
  if (!el) return;
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden') && !el.dataset.loaded) {
    el.dataset.loaded = 'true';
    await loadComments(postId);
  }
};

async function loadComments(postId) {
  const el = document.getElementById('comments-' + postId);
  if (!el) return;
  const q = query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt','asc'), limit(20));
  const snaps = await getDocs(q);
  let html = '';
  snaps.forEach(d => {
    const c = d.data();
    const time = c.createdAt ? timeAgo(c.createdAt.toDate()) : '';
    html += `<div class="comment-item">
      <div class="cmt-av">${c.authorAvatar ? `<img src="${c.authorAvatar}"/>` : (c.authorName||'?')[0].toUpperCase()}</div>
      <div class="cmt-body">
        <div class="cmt-meta">
          <span class="cmt-author" onclick="openProfileByUID('${c.uid}')">${escHTML(c.authorName||'User')}</span>
          <span class="cmt-time">${time}</span>
        </div>
        <div class="cmt-text">${escHTML(c.text)}</div>
      </div>
    </div>`;
  });
  html += `<div class="comment-input-row">
    <div class="cmt-av">${currentProfile?.avatar ? `<img src="${currentProfile.avatar}"/>` : (currentProfile?.displayName||'?')[0].toUpperCase()}</div>
    <input type="text" id="cmt-inp-${postId}" placeholder="Write a comment…" onkeydown="if(event.key==='Enter')submitComment('${postId}')" />
    <button class="btn-cmt-send" onclick="submitComment('${postId}')">↩</button>
  </div>`;
  el.innerHTML = html;
}

window.submitComment = async function(postId) {
  const inp = document.getElementById('cmt-inp-' + postId);
  if (!inp || !inp.value.trim()) return;
  const text = inp.value.trim();
  inp.value = '';
  await addDoc(collection(db, 'posts', postId, 'comments'), {
    uid: currentUser.uid,
    authorName: currentProfile?.displayName || 'User',
    authorHandle: currentProfile?.username || '',
    authorAvatar: currentProfile?.avatar || '',
    text, createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'posts', postId), { commentsCount: increment(1) });
  const el = document.getElementById('comments-' + postId);
  if (el) el.dataset.loaded = '';
  await loadComments(postId);

  // Notify post author
  const postSnap = await getDoc(doc(db, 'posts', postId));
  if (postSnap.exists() && postSnap.data().uid !== currentUser.uid) {
    sendNotification(postSnap.data().uid, 'comment', currentProfile?.displayName || 'Someone', postId);
  }
};

window.votePoll = async function(postId, optionIndex) {
  if (!currentUser) return;
  const ref = doc(db, 'posts', postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.poll?.userVotes?.[currentUser.uid] !== undefined) { toast('Already voted!'); return; }
  await updateDoc(ref, {
    [`poll.votes.${optionIndex}`]: increment(1),
    [`poll.userVotes.${currentUser.uid}`]: optionIndex,
  });
  toast('Vote cast! 🗳️');
  loadFeed();
};

window.deletePost = async function(postId) {
  if (!confirm('Delete this post?')) return;
  await deleteDoc(doc(db, 'posts', postId));
  document.getElementById('post-' + postId)?.remove();
  toast('Post deleted.');
};

window.reportPost = async function(postId, authorName) {
  const reason = prompt(`Report post by ${authorName}?\nReason (optional):`);
  if (reason === null) return;
  await addDoc(collection(db, 'reports'), {
    postId, reportedBy: currentUser.uid,
    reason: reason || 'No reason given',
    authorName, status: 'open',
    createdAt: serverTimestamp(),
  });
  toast('Post reported. Thank you!');
};

window.sharePost = function(postId) {
  const url = `${location.origin}${location.pathname}?post=${postId}`;
  navigator.clipboard.writeText(url).then(() => toast('Link copied! 🔗'));
};

// ═══════════════════════════════════════════════════════════════
//  POST COMPOSE MODAL
// ═══════════════════════════════════════════════════════════════

let postImageData = null;
let postFeeling = null;

window.openPostModal = function(type) {
  if (!currentProfile) return;
  document.getElementById('post-modal').classList.remove('hidden');
  document.getElementById('post-text').value = '';
  document.getElementById('post-img-prev').innerHTML = '';
  document.getElementById('post-feeling-tag').innerHTML = '';
  document.getElementById('poll-build').classList.add('hidden');
  document.getElementById('feeling-grid').classList.add('hidden');
  document.getElementById('char-count').textContent = '0 / 500';
  postImageData = null; postFeeling = null;

  const name = currentProfile.displayName || currentProfile.fullName || 'User';
  setAvatar('post-compose-av', name, currentProfile.avatar);
  document.getElementById('post-compose-name').textContent = name;

  if (type === 'photo') document.querySelector('.ctool input[type="file"]').click();
  if (type === 'feeling') toggleFeelings();
  if (type === 'poll') togglePoll();
  setTimeout(() => document.getElementById('post-text').focus(), 100);
};

window.closePostModal = function() {
  document.getElementById('post-modal').classList.add('hidden');
};

window.updateCharCount = function() {
  const len = document.getElementById('post-text').value.length;
  const el = document.getElementById('char-count');
  el.textContent = `${len} / 500`;
  el.style.color = len > 450 ? 'var(--red)' : 'var(--muted)';
};

window.previewPostImg = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    postImageData = e.target.result;
    document.getElementById('post-img-prev').innerHTML = `<img src="${postImageData}" style="max-width:100%;max-height:200px;border-radius:var(--radius);margin-top:0.5rem" />`;
  };
  reader.readAsDataURL(file);
};

window.toggleFeelings = function() {
  document.getElementById('feeling-grid').classList.toggle('hidden');
  document.getElementById('poll-build').classList.add('hidden');
};

window.togglePoll = function() {
  document.getElementById('poll-build').classList.toggle('hidden');
  document.getElementById('feeling-grid').classList.add('hidden');
};

window.pickFeeling = function(feeling) {
  postFeeling = feeling;
  document.getElementById('post-feeling-tag').innerHTML = `<span class="feeling-badge">feeling ${feeling}</span>`;
  document.getElementById('feeling-grid').classList.add('hidden');
};

window.submitPost = async function() {
  const text = document.getElementById('post-text').value.trim();
  const audience = document.getElementById('post-audience').value;
  const pollO1 = document.getElementById('poll-o1')?.value.trim();
  const pollO2 = document.getElementById('poll-o2')?.value.trim();
  const pollO3 = document.getElementById('poll-o3')?.value.trim();
  const hasPoll = !document.getElementById('poll-build').classList.contains('hidden');

  if (!text && !postImageData && !hasPoll) { toast('Write something first!'); return; }
  if (hasPoll && (!pollO1 || !pollO2)) { toast('Polls need at least 2 options.'); return; }

  // Mute check
  if (currentProfile?.mutedUntil && currentProfile.mutedUntil.toDate() > new Date()) {
    toast(`You're muted until ${currentProfile.mutedUntil.toDate().toLocaleString()}`);
    return;
  }

  const btn = document.getElementById('post-submit-btn');
  btn.disabled = true; btn.textContent = 'Posting…';

  try {
    const postData = {
      uid: currentUser.uid,
      authorName: currentProfile.displayName || currentProfile.fullName || 'User',
      authorHandle: currentProfile.username || '',
      authorAvatar: currentProfile.avatar || '',
      authorVerified: currentProfile.isVerified || false,
      authorBadges: currentProfile.badges || [],
      text, audience,
      feeling: postFeeling || null,
      imageURL: postImageData || null,
      hasImage: !!postImageData,
      likes: 0, likedBy: [], commentsCount: 0,
      poll: hasPoll ? {
        options: [pollO1, pollO2, ...(pollO3 ? [pollO3] : [])],
        votes: {}, userVotes: {},
      } : null,
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, 'posts'), postData);
    await updateDoc(doc(db, 'users', currentUser.uid), { postsCount: increment(1) });
    closePostModal();
    toast('Post shared! ✨');
    loadFeed();
  } catch (e) {
    toast('Failed to post: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Post';
  }
};

// ═══════════════════════════════════════════════════════════════
//  POST DETAIL MODAL
// ═══════════════════════════════════════════════════════════════

window.openDetailModal = async function(postId) {
  const snap = await getDoc(doc(db, 'posts', postId));
  if (!snap.exists()) return;
  document.getElementById('detail-body').innerHTML = renderPost(postId, snap.data());
  document.getElementById('detail-modal').classList.remove('hidden');
};
window.closeDetailModal = function() { document.getElementById('detail-modal').classList.add('hidden'); };

// ═══════════════════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════════════════

window.showMyProfile = function() {
  if (!currentUser) return;
  openProfileByUID(currentUser.uid);
};

window.openProfileByUID = async function(uid) {
  openPanel('profile');
  const body = document.getElementById('pp-body');
  body.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">Loading…</div>';

  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) { body.innerHTML = '<div style="padding:2rem;color:var(--muted)">User not found.</div>'; return; }
  const data = snap.data();
  document.getElementById('pp-title').textContent = data.displayName || data.fullName || 'Profile';

  const isOwn = uid === currentUser.uid;
  const isFollowing = currentProfile?.following?.includes(uid);
  const name = data.displayName || data.fullName || 'User';

  let badgesHTML = '';
  (data.badges || []).forEach(b => {
    if (BADGES[b]) badgesHTML += `<span class="badge-chip ${BADGES[b].cls}">${BADGES[b].icon} ${BADGES[b].label}</span>`;
  });

  let metaHTML = '';
  if (data.location) metaHTML += `<span>📍 ${escHTML(data.location)}</span>`;
  if (data.website) metaHTML += `<span>🔗 <a href="${data.website}" target="_blank" rel="noopener">${escHTML(data.website)}</a></span>`;
  if (data.createdAt) metaHTML += `<span>📅 Joined ${new Date(data.createdAt.toDate()).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</span>`;

  body.innerHTML = `
    <div class="profile-banner" style="${data.banner ? `background-image:url('${data.banner}');background-size:cover;background-position:center` : ''}">
      <div class="profile-av-wrap">
        <div class="profile-av">${data.avatar ? `<img src="${data.avatar}" />` : name[0].toUpperCase()}</div>
      </div>
    </div>
    <div class="profile-info-row">
      <div class="profile-name-block">
        <div class="profile-name">
          ${escHTML(name)}
          ${data.isVerified ? '<span class="check-verified" title="Verified Account">✓</span>' : ''}
        </div>
        <div class="profile-handle">${data.username ? '@' + data.username : ''}</div>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
        ${isOwn
          ? `<button class="btn-secondary sm" onclick="openPanel('settings');closePanel('profile')">Edit Profile</button>`
          : `<button class="btn-primary sm" id="follow-btn" onclick="toggleFollow('${uid}')">${isFollowing ? 'Following' : 'Follow'}</button>
             <button class="btn-secondary sm" onclick="openDMWith('${uid}','${name}','${data.avatar||''}','${data.username||''}')">Message</button>`
        }
      </div>
    </div>
    ${data.bio ? `<div class="profile-bio">${escHTML(data.bio)}</div>` : ''}
    ${metaHTML ? `<div class="profile-meta-row">${metaHTML}</div>` : ''}
    <div class="profile-stats">
      <div class="pstat"><div class="pstat-val">${data.postsCount || 0}</div><div class="pstat-lbl">Posts</div></div>
      <div class="pstat"><div class="pstat-val">${(data.followers||[]).length}</div><div class="pstat-lbl">Followers</div></div>
      <div class="pstat"><div class="pstat-val">${(data.following||[]).length}</div><div class="pstat-lbl">Following</div></div>
    </div>
    ${badgesHTML ? `<div class="profile-badges-row">${badgesHTML}</div>` : ''}
    <div class="profile-posts" id="profile-posts-area">
      <div style="padding:1rem;text-align:center;color:var(--muted)">Loading posts…</div>
    </div>`;

  // Load user's posts
  try {
    const postsQ = query(collection(db, 'posts'), where('uid','==',uid), orderBy('createdAt','desc'), limit(10));
    const postsSnap = await getDocs(postsQ);
    const postsArea = document.getElementById('profile-posts-area');
    if (postsArea) {
      postsArea.innerHTML = '';
      if (postsSnap.empty) {
        postsArea.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">No posts yet.</div>';
      } else {
        postsSnap.forEach(d => postsArea.insertAdjacentHTML('beforeend', renderPost(d.id, d.data())));
      }
    }
  } catch(_) {}
};

window.toggleFollow = async function(uid) {
  if (!currentUser || uid === currentUser.uid) return;
  const isFollowing = currentProfile?.following?.includes(uid);
  await updateDoc(doc(db, 'users', currentUser.uid), {
    following: isFollowing ? arrayRemove(uid) : arrayUnion(uid),
  });
  await updateDoc(doc(db, 'users', uid), {
    followers: isFollowing ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
  });
  if (currentProfile) {
    currentProfile.following = isFollowing
      ? currentProfile.following.filter(id => id !== uid)
      : [...(currentProfile.following||[]), uid];
  }
  const btn = document.getElementById('follow-btn');
  if (btn) btn.textContent = isFollowing ? 'Follow' : 'Following';
  if (!isFollowing) sendNotification(uid, 'follow', currentProfile?.displayName || 'Someone', null);
  toast(isFollowing ? 'Unfollowed.' : 'Following! 🎉');
};

// ═══════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════

window.saveSettings = async function() {
  const dn = document.getElementById('set-dn').value.trim();
  const bio = document.getElementById('set-bio').value.trim();
  const loc = document.getElementById('set-loc').value.trim();
  const web = document.getElementById('set-web').value.trim();
  const av = document.getElementById('set-av').value.trim();
  const bn = document.getElementById('set-bn').value.trim();
  await updateDoc(doc(db, 'users', currentUser.uid), { displayName: dn, bio, location: loc, website: web, avatar: av, banner: bn });
  Object.assign(currentProfile, { displayName: dn, bio, location: loc, website: web, avatar: av, banner: bn });
  setAvatar('tb-av', dn, av);
  setAvatar('um-av', dn, av);
  setAvatar('comp-av', dn, av);
  document.getElementById('um-name').textContent = dn;
  document.getElementById('comp-name').textContent = dn.split(' ')[0];
  toast('Profile updated ✅');
};

window.changePassword = async function() {
  const pw = document.getElementById('set-pw').value;
  if (!pw || pw.length < 8) { toast('Password must be 8+ chars.'); return; }
  try {
    await updatePassword(auth.currentUser, pw);
    toast('Password updated ✅');
    document.getElementById('set-pw').value = '';
  } catch (e) { toast('Error: ' + e.message); }
};

window.deactivateAccount = async function() {
  if (!confirm('Deactivate your account? You can reactivate by signing in.')) return;
  await updateDoc(doc(db, 'users', currentUser.uid), { deactivated: true });
  doLogout();
  toast('Account deactivated.');
};

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

function subscribeNotifs() {
  if (notifsUnsub) notifsUnsub();
  const q = query(collection(db, 'users', currentUser.uid, 'notifications'), orderBy('createdAt','desc'), limit(30));
  notifsUnsub = onSnapshot(q, snap => {
    const unread = snap.docs.filter(d => !d.data().read).length;
    const dot = document.getElementById('notif-dot');
    if (dot) dot.classList.toggle('hidden', unread === 0);
    renderNotifs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

function renderNotifs(notifs) {
  const el = document.getElementById('notif-list');
  if (!el) return;
  if (!notifs.length) { el.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--muted)">No notifications yet.</div>'; return; }
  const icons = { like: '❤️', comment: '💬', follow: '👤', announcement: '📢' };
  el.innerHTML = notifs.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-icon">${icons[n.type] || '🔔'}</div>
      <div>
        <div class="notif-text">${formatNotifText(n)}</div>
        <div class="notif-time">${n.createdAt ? timeAgo(n.createdAt.toDate()) : ''}</div>
      </div>
    </div>`).join('');
}

function formatNotifText(n) {
  if (n.type === 'like') return `<b>${escHTML(n.fromName)}</b> liked your post.`;
  if (n.type === 'comment') return `<b>${escHTML(n.fromName)}</b> commented on your post.`;
  if (n.type === 'follow') return `<b>${escHTML(n.fromName)}</b> started following you.`;
  return n.text || 'New notification.';
}

async function sendNotification(toUID, type, fromName, postId) {
  try {
    await addDoc(collection(db, 'users', toUID, 'notifications'), {
      type, fromUID: currentUser.uid, fromName, postId: postId || null,
      read: false, createdAt: serverTimestamp(),
    });
  } catch (_) {}
}

window.markNotifsRead = async function() {
  if (!currentUser) return;
  const q = query(collection(db, 'users', currentUser.uid, 'notifications'), where('read','==',false));
  const snaps = await getDocs(q);
  const batch = writeBatch(db);
  snaps.forEach(d => batch.update(d.ref, { read: true }));
  await batch.commit();
};

// ═══════════════════════════════════════════════════════════════
//  MESSAGES / DMs
// ═══════════════════════════════════════════════════════════════

async function loadDMList() {
  const q = query(collection(db, 'dms'), where('participants', 'array-contains', currentUser.uid), orderBy('lastAt','desc'), limit(20));
  try {
    const snap = await getDocs(q);
    const el = document.getElementById('dm-list');
    if (!el) return;
    if (snap.empty) { el.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:0.5rem">No conversations yet.</div>'; return; }
    el.innerHTML = '';
    snap.forEach(d => {
      const data = d.data();
      const otherId = data.participants.find(id => id !== currentUser.uid);
      const otherName = data.names?.[otherId] || 'User';
      const otherAvatar = data.avatars?.[otherId] || '';
      const unread = data.unreadBy?.includes(currentUser.uid);
      el.insertAdjacentHTML('beforeend', `
        <div class="dm-item" onclick="openChatWith('${d.id}','${otherId}','${escAttr(otherName)}','${escAttr(otherAvatar)}')">
          <div class="dm-av">${otherAvatar ? `<img src="${otherAvatar}" />` : otherName[0].toUpperCase()}</div>
          <div class="dm-info">
            <div class="dm-name">${escHTML(otherName)}</div>
            <div class="dm-preview">${escHTML(data.lastMessage || '…')}</div>
          </div>
          ${unread ? '<div class="dm-unread"></div>' : ''}
        </div>`);
    });
  } catch (_) {}
}

window.searchConvos = function(val) {
  // Basic client filter
  document.querySelectorAll('#dm-list .dm-item').forEach(item => {
    item.style.display = item.querySelector('.dm-name')?.textContent.toLowerCase().includes(val.toLowerCase()) ? '' : 'none';
  });
};

window.openDMWith = async function(uid, name, avatar, username) {
  // Find or create DM thread
  const participants = [currentUser.uid, uid].sort();
  const q = query(collection(db, 'dms'), where('participants','==',participants));
  const snap = await getDocs(q);
  let threadId;
  if (snap.empty) {
    const ref = await addDoc(collection(db, 'dms'), {
      participants,
      names: { [currentUser.uid]: currentProfile?.displayName || 'Me', [uid]: name },
      avatars: { [currentUser.uid]: currentProfile?.avatar || '', [uid]: avatar },
      lastMessage: '', lastAt: serverTimestamp(), unreadBy: [],
    });
    threadId = ref.id;
  } else {
    threadId = snap.docs[0].id;
  }
  openPanel('messages');
  openChatWith(threadId, uid, name, avatar);
};

window.openChatWith = function(threadId, uid, name, avatar) {
  activeChatUID = uid;
  const cw = document.getElementById('chat-win');
  const dmList = document.getElementById('dm-list');
  const panel = document.getElementById('panel-messages');
  if (!cw) return;

  cw.classList.remove('hidden');
  cw.style.display = 'flex';
  if (dmList) dmList.style.display = 'none';
  const spHeader = panel.querySelector('.sp-header');
  if (spHeader) spHeader.style.display = 'none';

  document.getElementById('cw-name').textContent = name;
  document.getElementById('cw-status').textContent = '';
  const cwAv = document.getElementById('cw-av');
  if (cwAv) cwAv.innerHTML = avatar ? `<img src="${avatar}" />` : name[0].toUpperCase();

  const msgs = document.getElementById('cw-msgs');
  msgs.innerHTML = '';

  if (activeChatUnsub) activeChatUnsub();
  const q = query(collection(db, 'dms', threadId, 'messages'), orderBy('createdAt','asc'), limit(50));
  activeChatUnsub = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const d = change.doc.data();
        const mine = d.uid === currentUser.uid;
        const time = d.createdAt ? timeAgo(d.createdAt.toDate()) : '';
        msgs.insertAdjacentHTML('beforeend', `
          <div class="msg-bubble ${mine ? 'msg-mine' : 'msg-theirs'}">
            ${escHTML(d.text)}
            <div class="msg-time">${time}</div>
          </div>`);
        msgs.scrollTop = msgs.scrollHeight;
      }
    });
  });

  document.getElementById('cw-inp').dataset.thread = threadId;

  // Mark as read
  updateDoc(doc(db, 'dms', threadId), { unreadBy: arrayRemove(currentUser.uid) }).catch(_=>_);
};

window.closeChatWin = function() {
  const cw = document.getElementById('chat-win');
  const dmList = document.getElementById('dm-list');
  const panel = document.getElementById('panel-messages');
  if (cw) { cw.classList.add('hidden'); cw.style.display = 'none'; }
  if (dmList) dmList.style.display = '';
  const spHeader = panel?.querySelector('.sp-header');
  if (spHeader) spHeader.style.display = '';
  if (activeChatUnsub) { activeChatUnsub(); activeChatUnsub = null; }
};

window.sendDM = async function() {
  const inp = document.getElementById('cw-inp');
  if (!inp || !inp.value.trim()) return;
  const threadId = inp.dataset.thread;
  if (!threadId) return;
  const text = inp.value.trim();
  inp.value = '';
  await addDoc(collection(db, 'dms', threadId, 'messages'), {
    uid: currentUser.uid,
    text, createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'dms', threadId), {
    lastMessage: text, lastAt: serverTimestamp(),
    unreadBy: arrayUnion(activeChatUID),
  });
};

// ═══════════════════════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════════════════════

let searchTimeout = null;
window.runSearch = function(val) {
  clearTimeout(searchTimeout);
  const drop = document.getElementById('search-drop');
  if (!val.trim()) { drop.innerHTML = ''; drop.style.display = 'none'; return; }
  drop.style.display = 'block';
  drop.innerHTML = '<div style="padding:0.6rem 1rem;color:var(--muted);font-size:0.85rem">Searching…</div>';
  searchTimeout = setTimeout(() => doSearch(val), 350);
};

window.closeSearch = function() {
  setTimeout(() => {
    const drop = document.getElementById('search-drop');
    if (drop) { drop.innerHTML = ''; drop.style.display = 'none'; }
  }, 200);
};

async function doSearch(val) {
  const drop = document.getElementById('search-drop');
  if (!drop) return;
  const v = val.toLowerCase().replace(/^@/,'');
  try {
    const q = query(collection(db, 'users'), where('username','>=',v), where('username','<=',v+'\uf8ff'), limit(6));
    const snap = await getDocs(q);
    if (snap.empty) { drop.innerHTML = '<div style="padding:0.6rem 1rem;color:var(--muted);font-size:0.85rem">No results found.</div>'; return; }
    drop.innerHTML = '';
    snap.forEach(d => {
      const u = d.data();
      const name = u.displayName || u.fullName || 'User';
      drop.insertAdjacentHTML('beforeend', `
        <div class="search-item" onclick="openProfileByUID('${d.id}');closeSearch()">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;color:#0d0f14;overflow:hidden;flex-shrink:0">
            ${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover"/>` : name[0].toUpperCase()}
          </div>
          <div>
            <div style="font-size:0.88rem;font-weight:600">${escHTML(name)} ${u.isVerified ? '<span class="check-verified">✓</span>' : ''}</div>
            <div style="font-size:0.75rem;color:var(--muted)">@${u.username}</div>
          </div>
        </div>`);
    });
  } catch (_) { drop.innerHTML = '<div style="padding:0.6rem 1rem;color:var(--red);font-size:0.85rem">Search unavailable.</div>'; }
}

// ═══════════════════════════════════════════════════════════════
//  WIDGETS
// ═══════════════════════════════════════════════════════════════

async function loadWidgets() {
  // Trending hashtags (static demo + real counts)
  const trendingEl = document.getElementById('w-trending');
  if (trendingEl) {
    const topics = ['#vibecheck','#trending','#photos','#music','#gaming','#art','#food','#travel'];
    trendingEl.innerHTML = topics.slice(0,6).map((t,i) => `
      <div class="trending-item" onclick="filterFeed('trending')">
        <div class="trending-tag">${t}</div>
        <div class="trending-count">${Math.floor(Math.random()*900+100)} posts</div>
      </div>`).join('');
  }

  // Suggested users
  const suggestEl = document.getElementById('w-suggest');
  if (suggestEl) {
    try {
      const q = query(collection(db, 'users'), orderBy('postsCount','desc'), limit(5));
      const snap = await getDocs(q);
      suggestEl.innerHTML = '';
      snap.forEach(d => {
        if (d.id === currentUser.uid) return;
        const u = d.data();
        const name = u.displayName || u.fullName || 'User';
        const isFollowing = currentProfile?.following?.includes(d.id);
        suggestEl.insertAdjacentHTML('beforeend', `
          <div class="suggest-item">
            <div class="suggest-av" onclick="openProfileByUID('${d.id}')" style="cursor:pointer">
              ${u.avatar ? `<img src="${u.avatar}" />` : name[0].toUpperCase()}
            </div>
            <div class="suggest-info">
              <div class="suggest-name">${escHTML(name)}</div>
              <div class="suggest-handle">@${u.username}</div>
            </div>
            <button class="btn-follow ${isFollowing?'following':''}" onclick="toggleFollow('${d.id}')">${isFollowing ? 'Following' : 'Follow'}</button>
          </div>`);
      });
    } catch (_) {}
  }

  // Online users
  const onlineEl = document.getElementById('w-online');
  if (onlineEl) {
    try {
      const q = query(collection(db, 'users'), where('online','==',true), limit(8));
      const snap = await getDocs(q);
      onlineEl.innerHTML = '';
      snap.forEach(d => {
        if (d.id === currentUser.uid) return;
        const u = d.data();
        const name = u.displayName || u.fullName || 'User';
        onlineEl.insertAdjacentHTML('beforeend', `
          <div class="suggest-item" style="cursor:pointer" onclick="openProfileByUID('${d.id}')">
            <div class="suggest-av" style="position:relative">
              ${u.avatar ? `<img src="${u.avatar}" />` : name[0].toUpperCase()}
              <div class="online-ring"></div>
            </div>
            <div class="suggest-info">
              <div class="suggest-name">${escHTML(name)}</div>
              <div class="suggest-handle">🟢 Online</div>
            </div>
          </div>`);
      });
      if (snap.empty) onlineEl.innerHTML = '<div style="color:var(--muted);font-size:0.82rem">No one online right now.</div>';
    } catch (_) {}
  }
}

// ═══════════════════════════════════════════════════════════════
//  WARNINGS
// ═══════════════════════════════════════════════════════════════

async function checkWarnings(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return;
  const warnings = snap.data().warnings || [];
  const unacked = warnings.find(w => !w.acknowledged);
  if (unacked) {
    pendingWarn = { uid, warnings, warn: unacked, idx: warnings.indexOf(unacked) };
    const warnedCount = warnings.filter(w => !w.acknowledged).length;
    document.getElementById('warn-reason').textContent = unacked.reason || 'Violation of community guidelines.';
    document.getElementById('warn-count').textContent = `Warning ${warnings.length} — ${warnings.length >= 3 ? '⚠️ Final warning before ban' : `${3 - warnings.length} warning(s) remaining before ban`}`;
    document.getElementById('warn-modal').classList.remove('hidden');
  }
}

window.acknowledgeWarn = async function() {
  if (!pendingWarn) return;
  const { uid, warnings, idx } = pendingWarn;
  warnings[idx].acknowledged = true;
  warnings[idx].acknowledgedAt = new Date().toISOString();
  await updateDoc(doc(db, 'users', uid), { warnings });
  document.getElementById('warn-modal').classList.add('hidden');
  pendingWarn = null;
};

// ═══════════════════════════════════════════════════════════════
//  PANELS + NAV UI HELPERS
// ═══════════════════════════════════════════════════════════════

window.openPanel = function(name) {
  closeAllPanels();
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('open');
  const backdrop = document.getElementById('backdrop');
  if (backdrop) backdrop.classList.remove('hidden');
  if (name === 'notifications') renderNotifs; // already subscribed
};

window.closePanel = function(name) {
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.remove('open');
  const backdrop = document.getElementById('backdrop');
  if (backdrop) backdrop.classList.add('hidden');
};

window.closeAllPanels = function() {
  document.querySelectorAll('.slide-panel').forEach(p => p.classList.remove('open'));
  const backdrop = document.getElementById('backdrop');
  if (backdrop) backdrop.classList.add('hidden');
};

window.setTbn = function(id) {
  document.querySelectorAll('.tbn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('tbn-' + id);
  if (btn) btn.classList.add('active');
};

window.setRail = function(id) {
  document.querySelectorAll('.rail-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('rl-' + id);
  if (btn) btn.classList.add('active');
};

window.toggleUserMenu = function(e) {
  e.stopPropagation();
  const menu = document.getElementById('user-menu');
  menu.classList.toggle('hidden');
};
window.closeUserMenu = function() {
  document.getElementById('user-menu')?.classList.add('hidden');
};
document.addEventListener('click', (e) => {
  const menu = document.getElementById('user-menu');
  if (menu && !menu.classList.contains('hidden') && !document.getElementById('tb-av-btn')?.contains(e.target)) {
    menu.classList.add('hidden');
  }
});

// ═══════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ═══════════════════════════════════════════════════════════════

window.enterAdmin = function() {
  if (!currentProfile?.isAdmin) { toast('Access denied.'); return; }
  showPage('admin-page');
  loadAdminOverview();
};

window.exitAdmin = function() {
  showPage('app-page');
};

window.showAdmTab = function(tab, btn) {
  document.querySelectorAll('.adm-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.adm-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('adm-' + tab)?.classList.add('active');
  btn.classList.add('active');
  const loaders = { users: loadAdmUsers, posts: loadAdmPosts, reports: loadAdmReports, badges: ()=>{}, overview: loadAdminOverview };
  if (loaders[tab]) loaders[tab]();
};

async function loadAdminOverview() {
  try {
    const [uSnap, pSnap, rSnap] = await Promise.all([
      getDocs(query(collection(db,'users'), limit(500))),
      getDocs(query(collection(db,'posts'), limit(500))),
      getDocs(query(collection(db,'reports'), where('status','==','open'), limit(500))),
    ]);
    const verified = uSnap.docs.filter(d => d.data().isVerified).length;
    document.getElementById('as-users').textContent = uSnap.size;
    document.getElementById('as-posts').textContent = pSnap.size;
    document.getElementById('as-reports').textContent = rSnap.size;
    document.getElementById('as-verified').textContent = verified;

    // Recent posts
    const recentSnap = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc'), limit(5)));
    const el = document.getElementById('adm-recent');
    if (el) el.innerHTML = recentSnap.docs.map(d => {
      const p = d.data();
      return `<div class="adm-user-row">
        <div><div style="font-size:0.85rem;font-weight:600">${escHTML(p.authorName||'?')}</div>
        <div style="font-size:0.78rem;color:var(--muted)">${escHTML((p.text||'').slice(0,80))}…</div></div>
        <button class="adm-action-btn danger" onclick="admDeletePost('${d.id}')">Delete</button>
      </div>`;
    }).join('');
  } catch (_) {}
}

async function loadAdmUsers() {
  const el = document.getElementById('adm-user-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted)">Loading…</div>';
  const snap = await getDocs(query(collection(db,'users'), orderBy('createdAt','desc'), limit(50)));
  renderAdmUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

function renderAdmUsers(users) {
  const el = document.getElementById('adm-user-list');
  if (!el) return;
  el.innerHTML = users.map(u => {
    const name = u.displayName || u.fullName || 'User';
    const statusBadges = [
      u.banned ? `<span class="adm-status-banned">BANNED</span>` : '',
      (u.warnings||[]).length ? `<span class="adm-status-warned">⚠️ ${u.warnings.length} warn</span>` : '',
      u.mutedUntil ? `<span class="adm-status-muted">MUTED</span>` : '',
    ].filter(Boolean).join('');
    const badgesHTML = (u.badges||[]).map(b => BADGES[b] ? `<span class="badge-chip ${BADGES[b].cls}">${BADGES[b].icon}</span>` : '').join('');
    return `
    <div class="adm-user-row">
      <div class="adm-user-av">${u.avatar ? `<img src="${u.avatar}" />` : name[0].toUpperCase()}</div>
      <div class="adm-user-info">
        <div class="adm-user-name">
          ${escHTML(name)}
          ${u.isVerified ? '<span class="check-verified">✓</span>' : ''}
          ${badgesHTML}
        </div>
        <div class="adm-user-handle">@${u.username || '—'} · ${u.email}</div>
        <div class="adm-status-badges">${statusBadges}</div>
      </div>
      <div class="adm-user-actions">
        <button class="adm-action-btn" onclick="admToggleVerify('${u.id}','${u.isVerified?'true':'false'}')">${u.isVerified ? '✓ Unverify' : 'Verify'}</button>
        <button class="adm-action-btn warn" onclick="admWarn('${u.id}','${escAttr(name)}')">⚠️ Warn</button>
        <button class="adm-action-btn" onclick="admMute('${u.id}','${escAttr(name)}')">${u.mutedUntil ? 'Unmute' : '🔇 Mute'}</button>
        ${u.banned
          ? `<button class="adm-action-btn success" onclick="admUnban('${u.id}','${escAttr(name)}')">✅ Unban</button>`
          : `<button class="adm-action-btn danger" onclick="admBan('${u.id}','${escAttr(name)}')">🔨 Ban</button>`
        }
        ${u.isAdmin ? '' : `<button class="adm-action-btn" onclick="admMakeAdmin('${u.id}','${escAttr(name)}')">🛡️ Admin</button>`}
      </div>
    </div>`;
  }).join('');
}

window.admSearchUsers = async function(val) {
  if (!val.trim()) { loadAdmUsers(); return; }
  const v = val.toLowerCase();
  const snap = await getDocs(query(collection(db,'users'), limit(100)));
  const users = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u =>
    (u.username||'').toLowerCase().includes(v) ||
    (u.displayName||u.fullName||'').toLowerCase().includes(v) ||
    (u.email||'').toLowerCase().includes(v)
  );
  renderAdmUsers(users);
};

window.admToggleVerify = async function(uid, currentlyVerified) {
  await updateDoc(doc(db,'users',uid), { isVerified: currentlyVerified !== 'true' });
  toast(currentlyVerified !== 'true' ? 'User verified ✓' : 'Verification removed.');
  loadAdmUsers();
};

window.admWarn = async function(uid, name) {
  const reason = prompt(`Warn ${name}?\nEnter reason:`);
  if (!reason) return;
  const snap = await getDoc(doc(db,'users',uid));
  const warnings = snap.data()?.warnings || [];
  warnings.push({ reason, issuedAt: new Date().toISOString(), issuedBy: currentProfile?.username || 'admin', acknowledged: false });
  await updateDoc(doc(db,'users',uid), { warnings });
  toast(`Warning issued to ${name}.`);
  if (warnings.length >= 3) {
    if (confirm(`${name} has 3+ warnings. Auto-ban?`)) admBan(uid, name, 'Reached warning limit.');
  }
  loadAdmUsers();
};

window.admBan = async function(uid, name, autoReason) {
  const reason = autoReason || prompt(`Ban ${name}?\nReason:`);
  if (!reason) return;
  await updateDoc(doc(db,'users',uid), {
    banned: true, banReason: reason,
    bannedAt: serverTimestamp(), bannedBy: currentProfile?.username || 'admin',
  });
  toast(`${name} has been banned.`);
  loadAdmUsers();
};

window.admUnban = async function(uid, name) {
  await updateDoc(doc(db,'users',uid), { banned: false, banReason: '', bannedAt: null, bannedBy: '' });
  toast(`${name} has been unbanned.`);
  loadAdmUsers();
};

window.admMute = async function(uid, name) {
  const snap = await getDoc(doc(db,'users',uid));
  if (snap.data()?.mutedUntil) {
    await updateDoc(doc(db,'users',uid), { mutedUntil: null });
    toast(`${name} unmuted.`);
  } else {
    const hours = prompt(`Mute ${name} for how many hours?`, '24');
    if (!hours || isNaN(hours)) return;
    const until = new Date(Date.now() + parseInt(hours) * 3600000);
    await updateDoc(doc(db,'users',uid), { mutedUntil: until });
    toast(`${name} muted for ${hours}h.`);
  }
  loadAdmUsers();
};

window.admMakeAdmin = async function(uid, name) {
  if (!confirm(`Make ${name} an admin?`)) return;
  await updateDoc(doc(db,'users',uid), { isAdmin: true });
  toast(`${name} is now an admin.`);
  loadAdmUsers();
};

async function loadAdmPosts() {
  const el = document.getElementById('adm-post-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted)">Loading…</div>';
  const snap = await getDocs(query(collection(db,'posts'), orderBy('createdAt','desc'), limit(50)));
  el.innerHTML = snap.docs.map(d => {
    const p = d.data();
    return `<div class="adm-user-row">
      <div class="adm-user-info">
        <div class="adm-user-name">${escHTML(p.authorName||'?')}</div>
        <div style="font-size:0.82rem;color:var(--muted2)">${escHTML((p.text||'[No text]').slice(0,120))}</div>
        <div style="font-size:0.75rem;color:var(--muted)">❤️ ${p.likes||0} · 💬 ${p.commentsCount||0}</div>
      </div>
      <button class="adm-action-btn danger" onclick="admDeletePost('${d.id}')">Delete</button>
    </div>`;
  }).join('');
}

window.admDeletePost = async function(postId) {
  if (!confirm('Delete this post?')) return;
  await deleteDoc(doc(db,'posts',postId));
  toast('Post deleted.');
  loadAdmPosts();
};

async function loadAdmReports() {
  const el = document.getElementById('adm-report-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted)">Loading…</div>';
  const snap = await getDocs(query(collection(db,'reports'), where('status','==','open'), orderBy('createdAt','desc'), limit(50)));
  if (snap.empty) { el.innerHTML = '<div style="color:var(--green);padding:1rem">✅ No open reports!</div>'; return; }
  el.innerHTML = snap.docs.map(d => {
    const r = d.data();
    return `<div class="adm-user-row">
      <div class="adm-user-info">
        <div class="adm-user-name">Report on post by ${escHTML(r.authorName||'?')}</div>
        <div style="font-size:0.82rem;color:var(--muted2)">Reason: ${escHTML(r.reason||'—')}</div>
      </div>
      <div style="display:flex;gap:0.4rem">
        <button class="adm-action-btn danger" onclick="admDeletePost('${r.postId}');admResolveReport('${d.id}')">Delete Post</button>
        <button class="adm-action-btn success" onclick="admResolveReport('${d.id}')">Dismiss</button>
      </div>
    </div>`;
  }).join('');
}

window.admResolveReport = async function(reportId) {
  await updateDoc(doc(db,'reports',reportId), { status: 'resolved' });
  toast('Report resolved.');
  loadAdmReports();
};

// Badge manager
window.admBadgeSearch = async function(val) {
  if (!val.trim()) { document.getElementById('adm-badge-results').innerHTML = ''; return; }
  const v = val.toLowerCase().replace(/^@/,'');
  const snap = await getDocs(query(collection(db,'users'), where('username','>=',v), where('username','<=',v+'\uf8ff'), limit(8)));
  const el = document.getElementById('adm-badge-results');
  el.innerHTML = snap.docs.map(d => {
    const u = d.data();
    const name = u.displayName || u.fullName || 'User';
    return `<div class="adm-user-row" style="cursor:pointer" onclick="openBadgeEditor('${d.id}','${escAttr(name)}','${JSON.stringify(u.badges||[]).replace(/'/g,"\\'")}')">
      <div class="adm-user-av">${u.avatar ? `<img src="${u.avatar}" />` : name[0].toUpperCase()}</div>
      <div class="adm-user-info">
        <div class="adm-user-name">${escHTML(name)} ${u.isVerified ? '<span class="check-verified">✓</span>' : ''}</div>
        <div class="adm-user-handle">@${u.username}</div>
      </div>
    </div>`;
  }).join('') || '<div style="color:var(--muted);padding:0.5rem">No users found.</div>';
};

window.openBadgeEditor = function(uid, name, badgesJson) {
  const currentBadges = JSON.parse(badgesJson.replace(/\\'/g,"'"));
  const el = document.getElementById('adm-badge-editor');
  el.classList.remove('hidden');
  const badgeList = Object.entries(BADGES).map(([key, b]) => {
    const has = currentBadges.includes(key);
    return `<button class="badge-toggle ${has ? 'on' : ''}" data-key="${key}" data-uid="${uid}" onclick="admToggleBadge('${uid}','${key}',this)">
      ${b.icon} ${b.label}
    </button>`;
  }).join('');
  el.innerHTML = `<div style="margin-top:1rem;padding:1rem;background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border)">
    <div style="font-weight:700;margin-bottom:0.8rem">Badges for ${escHTML(name)}</div>
    <div class="badge-grid">${badgeList}</div>
  </div>`;
};

window.admToggleBadge = async function(uid, badge, btn) {
  const snap = await getDoc(doc(db,'users',uid));
  const currentBadges = snap.data()?.badges || [];
  const has = currentBadges.includes(badge);
  await updateDoc(doc(db,'users',uid), { badges: has ? arrayRemove(badge) : arrayUnion(badge) });
  btn.classList.toggle('on', !has);
  toast(has ? `Badge "${badge}" removed.` : `Badge "${badge}" awarded! 🎉`);
};

window.sendAnnouncement = async function(type) {
  const text = document.getElementById('adm-ann').value.trim();
  if (!text) { toast('Write something first.'); return; }
  await addDoc(collection(db,'announcements'), {
    text, pinned: type === 'pinned',
    postedBy: currentProfile?.username || 'admin',
    createdAt: serverTimestamp(),
  });
  document.getElementById('adm-ann').value = '';
  toast('Announcement sent! 📢');
};

window.saveAdmSettings = async function() {
  const signups = document.getElementById('adm-signups')?.value;
  const postLen = document.getElementById('adm-postlen')?.value;
  const maintenance = document.getElementById('adm-maintenance')?.value;
  await setDoc(doc(db,'settings','platform'), { allowSignups: signups === 'yes', maxPostLength: parseInt(postLen), maintenance: maintenance === 'yes' }, { merge: true });
  toast('Settings saved ✅');
};

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════

function timeAgo(date) {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs/60)}m`;
  if (secs < 86400) return `${Math.floor(secs/3600)}h`;
  if (secs < 604800) return `${Math.floor(secs/86400)}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escHTML(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function escAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g,"\\'").replace(/"/g,'&quot;');
}
