// Prayas Chat — Stage 1 (accounts, profiles, user discovery) + core of Stage 2 (private realtime chat).
import { auth, db, configured } from "./firebase.js";
import {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut,
  reauthenticateWithCredential, EmailAuthProvider, deleteUser
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit,
  getDocs, onSnapshot, writeBatch, serverTimestamp, increment, runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ---------- small helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const app = $("#app");
const PAGE = 30;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON = {
  chats: svg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  calls: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'),
  contacts: svg('<path d="M4 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4z"/><path d="M20 8h2M20 12h2M20 16h2"/><circle cx="12" cy="10" r="2.5"/><path d="M7.5 16c.6-2 2.3-3 4.5-3s3.9 1 4.5 3"/>'),
  groups: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  profile: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>')
};
const BRAND = `<div class="brand"><img src="icon.svg" width="44" height="44" alt=""><span class="wordmark">Prayas Chat</span></div>`;

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}
function friendly(err) {
  const c = err && err.code ? err.code : "";
  if (err && err.message === "username-taken") return "That username is taken. Try another one.";
  const map = {
    "auth/email-already-in-use": "This email is already registered. Log in instead.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/weak-password": "Use a password with at least 8 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.",
    "auth/network-request-failed": "No internet connection. Check it and try again.",
    "auth/requires-recent-login": "Log in again, then retry.",
    "permission-denied": "You are not allowed to do that.",
    "unavailable": "Cannot reach the server. Check your connection."
  };
  return map[c] || map[c.replace("firestore/", "")] || "Something went wrong. Try again.";
}
function setMsg(text, ok = false) {
  const el = $("#formMsg"); if (!el) return;
  el.textContent = text || ""; el.className = ok ? "msg-ok" : "msg-error";
}
const HUES = ["#4C1D95", "#6D28D9", "#7E22CE", "#5B21B6", "#86198F", "#581C87"];
function avatar(p, big) {
  const name = (p && p.displayName) || "?";
  const ch = ([...name.trim()][0] || "?").toUpperCase();
  let h = 0; for (const c of (p && p.username) || name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="avatar${big ? " big" : ""}" style="background:${HUES[h % HUES.length]}" aria-hidden="true">${esc(ch)}</span>`;
}
function fmtStamp(d) {
  if (!d) return "";
  const today = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return today ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}
function fmtList(d) {
  if (!d) return "";
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}
const byName = (a, b) => (a.displayName || "").localeCompare(b.displayName || "");

/* ---------- theme ---------- */
function syncThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  $("#themeColor").setAttribute("content", bg || "#000000");
}
function setTheme(t) {
  localStorage.setItem("prayas-theme", t);
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  syncThemeColor();
}
matchMedia("(prefers-color-scheme: light)").addEventListener("change", syncThemeColor);
syncThemeColor();

/* ---------- state ---------- */
const S = {
  ready: false, user: null, profile: null, profileError: false,
  tab: "chats", authMode: "login",
  chats: [], chat: null, contacts: [], contactIds: new Set(), lastResults: [],
  profiles: new Map()
};
let unsubChats = null, unsubMsgs = null;

function stopChats() { if (unsubChats) { unsubChats(); unsubChats = null; } }
function stopMsgs() { if (unsubMsgs) { unsubMsgs(); unsubMsgs = null; } }
function stopAll() { stopChats(); stopMsgs(); }

async function getProfile(uid) {
  if (S.profiles.has(uid)) return S.profiles.get(uid);
  try {
    const s = await getDoc(doc(db, "users", uid));
    const p = s.exists() ? { uid, ...s.data() } : { uid, displayName: "Deleted user", username: "", deleted: true };
    S.profiles.set(uid, p);
    return p;
  } catch (e) {
    console.error("profile load", e.code);
    return { uid, displayName: "Unknown user", username: "" };
  }
}
async function loadProfile() {
  try {
    const s = await getDoc(doc(db, "users", S.user.uid));
    S.profile = s.exists() ? { uid: s.id, ...s.data() } : null;
    if (S.profile) S.profiles.set(S.profile.uid, S.profile);
    S.profileError = false;
  } catch (e) {
    console.error("own profile load", e.code);
    S.profile = null; S.profileError = true;
  }
}

/* ---------- root render ---------- */
function render() {
  if (!configured) return renderSetupNeeded();
  if (!S.ready) return;
  if (!S.user) return renderAuth();
  if (!S.user.emailVerified) return renderVerify();
  if (S.profileError) return renderConnError();
  if (!S.profile) return renderProfileSetup();
  if (S.chat) return renderChat();
  renderShell();
}

function renderSetupNeeded() {
  app.innerHTML = `<div class="auth">${BRAND}
    <h1>Connect your Firebase project</h1>
    <p class="lead">This app has no backend configured yet, so sign-in and chat are switched off.</p>
    <div class="notice">Open <code>firebase-config.js</code> and paste your Firebase web-app config, then reload. Steps are in README.md (step 2).</div></div>`;
}
function renderConnError() {
  app.innerHTML = `<div class="auth">${BRAND}<h1>Cannot reach the server</h1>
    <p class="lead">Your profile could not be loaded. Check your internet connection.</p>
    <div class="stack"><button class="btn" data-act="retry">Try again</button><button class="linkbtn" data-act="logout">Log out</button></div></div>`;
}

/* ---------- auth screens ---------- */
function renderAuth() {
  const mode = S.authMode;
  const copy = {
    login: ["Welcome back", "Log in to keep chatting.", "Log in"],
    register: ["Create your account", "Use an email you can open. We will send a verification link.", "Create account"],
    reset: ["Reset your password", "Enter your email and we will send you a reset link.", "Send reset link"]
  }[mode];
  const links = {
    login: `<button class="linkbtn" data-act="auth-mode" data-mode="reset">Forgot password?</button><br><button class="linkbtn" data-act="auth-mode" data-mode="register">New here? Create an account</button>`,
    register: `<button class="linkbtn" data-act="auth-mode" data-mode="login">Already have an account? Log in</button>`,
    reset: `<button class="linkbtn" data-act="auth-mode" data-mode="login">Back to log in</button>`
  }[mode];
  app.innerHTML = `<div class="auth">${BRAND}
    <h1>${copy[0]}</h1><p class="lead">${copy[1]}</p>
    <form data-form="${mode}" novalidate>
      <div class="field"><label for="email">Email</label>
        <input id="email" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" required></div>
      ${mode === "reset" ? "" : `<div class="field"><label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required>
        ${mode === "register" ? '<p class="hint">At least 8 characters.</p>' : ""}</div>`}
      <p id="formMsg" class="msg-error" role="alert"></p>
      <button class="btn" type="submit">${copy[2]}</button>
    </form>
    <div style="margin-top:18px">${links}</div></div>`;
}

function renderVerify() {
  app.innerHTML = `<div class="auth">${BRAND}
    <h1>Verify your email</h1>
    <p class="lead">We sent a link to <strong>${esc(S.user.email)}</strong>. Open it, then come back and tap the button. Check spam if you cannot find it.</p>
    <p id="formMsg" class="msg-error" role="alert"></p>
    <div class="stack">
      <button class="btn" data-act="check-verified">I have verified my email</button>
      <button class="btn ghost" data-act="resend">Resend email</button>
      <button class="linkbtn" data-act="logout">Use a different account</button>
    </div></div>`;
}

function renderProfileSetup() {
  app.innerHTML = `<div class="auth">${BRAND}
    <h1>Set up your profile</h1>
    <p class="lead">This is how people will find and see you.</p>
    <form data-form="profileSetup" novalidate>
      <div class="field"><label for="displayName">Display name</label>
        <input id="displayName" name="displayName" type="text" maxlength="40" autocomplete="name" required></div>
      <div class="field"><label for="username">Username</label>
        <input id="username" name="username" type="text" maxlength="20" autocomplete="off" autocapitalize="none" spellcheck="false" required>
        <p class="hint">3 to 20 characters: lowercase letters, numbers, underscore. It cannot be changed later.</p></div>
      <div class="field"><label for="bio">Bio (optional)</label>
        <textarea id="bio" name="bio" maxlength="140" rows="2"></textarea></div>
      <p id="formMsg" class="msg-error" role="alert"></p>
      <button class="btn" type="submit">Continue</button>
    </form>
    <div style="margin-top:18px"><button class="linkbtn" data-act="logout">Log out</button></div></div>`;
}

/* ---------- main shell (tabs) ---------- */
function renderShell() {
  const tabs = [["chats", "Chats"], ["calls", "Calls"], ["contacts", "Contacts"], ["groups", "Groups"], ["profile", "Profile"]];
  const views = { chats: viewChats, calls: viewCalls, contacts: viewContacts, groups: viewGroups, profile: viewProfile };
  app.innerHTML = `${views[S.tab]()}
    <nav class="nav" aria-label="Main">${tabs.map(([k, label]) =>
      `<button data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ""}>${ICON[k]}<span>${label}</span></button>`).join("")}</nav>`;
  if (S.tab === "chats") { startChats(); renderChatList(); } else stopChats();
  if (S.tab === "contacts") { renderSearchResults(); loadContacts(); }
}

function viewChats() {
  return `<header class="bar"><h1>Chats</h1></header>
    <div class="searchrow"><label class="sr" for="chatSearch">Search chats</label>
      <input id="chatSearch" type="search" placeholder="Search chats" autocomplete="off"></div>
    <div class="content" id="chatList"></div>`;
}
function viewCalls() {
  return `<header class="bar"><h1>Calls</h1></header>
    <div class="content"><div class="empty"><h2>Calls are not available yet</h2>
      <p>Audio and video calls need a calling server that is not set up. They come in Stage 5. Nothing on this tab is simulated.</p></div></div>`;
}
function viewGroups() {
  return `<header class="bar"><h1>Groups</h1></header>
    <div class="content"><div class="empty"><h2>Group chats are not available yet</h2>
      <p>Groups come in Stage 4, after private chat is tested.</p></div></div>`;
}
function viewContacts() {
  return `<header class="bar"><h1>Contacts</h1>
      <button class="iconbtn" data-act="invite" aria-label="Invite friends">${ICON.share}</button></header>
    <div class="content">
      <div class="searchrow"><label class="sr" for="userSearch">Find people by username</label>
        <input id="userSearch" type="search" placeholder="Find people by username" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
      <div id="searchOut"></div>
      <div class="section-title">Your contacts</div>
      <div id="contactList"></div>
    </div>`;
}
function viewProfile() {
  const p = S.profile, theme = localStorage.getItem("prayas-theme") || "dark";
  const seg = (v, l) => `<button type="button" data-set-theme="${v}" aria-pressed="${theme === v}">${l}</button>`;
  return `<header class="bar"><h1>Profile</h1></header>
    <div class="content">
      <div class="profile-head">${avatar(p, true)}<div class="dn">${esc(p.displayName)}</div>
        <div class="un">@${esc(p.username)}</div>${p.bio ? `<div>${esc(p.bio)}</div>` : ""}</div>
      <div class="panel"><form data-form="editProfile" class="stack" novalidate>
        <div class="section-title" style="padding-left:0">Edit profile</div>
        <div class="field"><label for="displayName">Display name</label>
          <input id="displayName" name="displayName" type="text" maxlength="40" value="${esc(p.displayName)}" required></div>
        <div class="field"><label for="bio">Bio</label>
          <textarea id="bio" name="bio" maxlength="140" rows="2">${esc(p.bio || "")}</textarea></div>
        <p id="formMsg" class="msg-error" role="alert"></p>
        <button class="btn" type="submit">Save changes</button></form></div>
      <div class="panel"><div class="section-title" style="padding-left:0">Appearance</div>
        <div class="seg" role="group" aria-label="Theme">${seg("dark", "Dark")}${seg("light", "Light")}${seg("system", "System")}</div></div>
      <div class="panel stack"><div class="section-title" style="padding-left:0">Account</div>
        <p class="hint" style="color:var(--muted);font-size:14px">${esc(S.user.email)}</p>
        <button class="btn ghost" data-act="logout">Log out</button>
        <button class="btn danger" data-act="delete-account">Delete account</button></div>
    </div>`;
}

/* ---------- chat list ---------- */
function startChats() {
  if (unsubChats) return;
  const q = query(collection(db, "chats"), where("members", "array-contains", S.user.uid), limit(100));
  unsubChats = onSnapshot(q, async (snap) => {
    S.chats = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .sort((a, b) => ms(b.lastMessageAt) - ms(a.lastMessageAt));
    renderChatList();
    const missing = [...new Set(S.chats.map((c) => c.members.find((m) => m !== S.user.uid)).filter((u) => u && !S.profiles.has(u)))];
    if (missing.length) { await Promise.all(missing.map(getProfile)); renderChatList(); }
  }, (err) => { console.error("chats listener", err.code); toast("Could not load chats. Check your connection."); });
}
function renderChatList() {
  const el = $("#chatList"); if (!el) return;
  const q = (($("#chatSearch") || {}).value || "").trim().toLowerCase();
  let items = S.chats.map((c) => { const other = c.members.find((m) => m !== S.user.uid); return { c, other, p: S.profiles.get(other) }; });
  if (q) items = items.filter(({ c, p }) => ((p && p.displayName) || "").toLowerCase().includes(q)
    || ((p && p.username) || "").includes(q) || ((c.lastMessage && c.lastMessage.text) || "").toLowerCase().includes(q));
  if (!items.length) {
    el.innerHTML = q
      ? `<div class="empty"><h2>No matches</h2><p>Try a different name or word.</p></div>`
      : `<div class="empty"><h2>No chats yet</h2><p>Find someone by username in Contacts, then say hello.</p><button class="btn" data-tab="contacts">Find people</button></div>`;
    return;
  }
  el.innerHTML = `<ul class="list">${items.map(({ c, other, p }) => {
    const unread = (c.unread && c.unread[S.user.uid]) || 0;
    const last = c.lastMessage ? `${c.lastMessage.senderId === S.user.uid ? "You: " : ""}${c.lastMessage.text}` : "";
    return `<li><button class="item" data-act="open-chat" data-uid="${esc(other)}">${avatar(p)}
      <span class="body"><span class="name" style="display:block">${esc(p ? p.displayName : "…")}</span>
      <span class="preview" style="display:block">${esc(last)}</span></span>
      <span class="meta"><span>${fmtList(c.lastMessageAt && c.lastMessageAt.toDate())}</span>
      ${unread ? `<span class="badge" aria-label="${unread} unread">${unread > 99 ? "99+" : unread}</span>` : ""}</span></button></li>`;
  }).join("")}</ul>`;
}

/* ---------- contacts + discovery ---------- */
async function loadContacts() {
  try {
    const snap = await getDocs(collection(db, "users", S.user.uid, "contacts"));
    S.contactIds = new Set(snap.docs.map((d) => d.id));
    const ps = await Promise.all([...S.contactIds].map(getProfile));
    S.contacts = ps.sort(byName);
    renderContactList(); renderSearchResults();
  } catch (e) {
    console.error("contacts load", e.code);
    const el = $("#contactList"); if (el) el.innerHTML = `<div class="empty"><p>Could not load contacts. Check your connection.</p></div>`;
  }
}
function personRow(p, isContact) {
  return `<li class="item">${avatar(p)}
    <span class="body"><span class="name" style="display:block">${esc(p.displayName)}</span>
    <span class="preview" style="display:block">@${esc(p.username)}</span></span>
    <button class="btn small" data-act="open-chat" data-uid="${esc(p.uid)}">Message</button>
    ${isContact
      ? `<button class="btn ghost small" data-act="remove-contact" data-uid="${esc(p.uid)}" aria-label="Remove ${esc(p.displayName)} from contacts">Remove</button>`
      : `<button class="btn ghost small" data-act="add-contact" data-uid="${esc(p.uid)}" aria-label="Add ${esc(p.displayName)} to contacts">Add</button>`}</li>`;
}
function renderContactList() {
  const el = $("#contactList"); if (!el) return;
  el.innerHTML = S.contacts.length
    ? `<ul class="list">${S.contacts.map((p) => personRow(p, true)).join("")}</ul>`
    : `<div class="empty"><p>No contacts yet. Search for a username above.</p></div>`;
}
let searchTimer, searchSeq = 0, searchMsg = "";
async function runUserSearch() {
  const raw = (($("#userSearch") || {}).value || "").trim().toLowerCase().replace(/^@/, "");
  const seq = ++searchSeq;
  if (!raw) { S.lastResults = []; searchMsg = ""; return renderSearchResults(); }
  if (!/^[a-z0-9_]{1,20}$/.test(raw)) { S.lastResults = []; searchMsg = "Usernames use lowercase letters, numbers and underscores."; return renderSearchResults(); }
  searchMsg = "Searching…"; S.lastResults = []; renderSearchResults();
  try {
    const snap = await getDocs(query(collection(db, "users"), where("username", ">=", raw), where("username", "<=", raw + "\uf8ff"), limit(10)));
    if (seq !== searchSeq) return;
    S.lastResults = snap.docs.filter((d) => d.id !== S.user.uid).map((d) => { const p = { uid: d.id, ...d.data() }; S.profiles.set(p.uid, p); return p; });
    searchMsg = S.lastResults.length ? "" : "No one found with that username.";
  } catch (e) {
    if (seq !== searchSeq) return;
    console.error("user search", e.code); searchMsg = "Search failed. Check your connection.";
  }
  renderSearchResults();
}
function renderSearchResults() {
  const el = $("#searchOut"); if (!el) return;
  el.innerHTML = S.lastResults.length
    ? `<ul class="list">${S.lastResults.map((p) => personRow(p, S.contactIds.has(p.uid))).join("")}</ul>`
    : (searchMsg ? `<div class="empty"><p>${esc(searchMsg)}</p></div>` : "");
}
async function addContact(uid) {
  try {
    await setDoc(doc(db, "users", S.user.uid, "contacts", uid), { addedAt: serverTimestamp() });
    S.contactIds.add(uid);
    const p = S.profiles.get(uid);
    if (p && !S.contacts.some((c) => c.uid === uid)) { S.contacts.push(p); S.contacts.sort(byName); }
    renderContactList(); renderSearchResults(); toast("Contact added");
  } catch (e) { console.error("add contact", e.code); toast(friendly(e)); }
}
async function removeContact(uid) {
  try {
    await deleteDoc(doc(db, "users", S.user.uid, "contacts", uid));
    S.contactIds.delete(uid); S.contacts = S.contacts.filter((c) => c.uid !== uid);
    renderContactList(); renderSearchResults(); toast("Contact removed");
  } catch (e) { console.error("remove contact", e.code); toast(friendly(e)); }
}
async function invite() {
  const data = { title: "Prayas Chat", text: "Join me on Prayas Chat", url: location.origin + location.pathname };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); toast("Invite link copied"); }
  } catch (e) { if (e.name !== "AbortError") toast("Could not share the link."); }
}

/* ---------- private chat ---------- */
async function openChat(otherUid) {
  await getProfile(otherUid);
  const id = [S.user.uid, otherUid].sort().join("_");
  S.chat = { id, other: otherUid, limit: PAGE, msgs: [], hasMore: false, stick: true, prevCount: 0, loadingOlder: false, marking: new Set() };
  history.pushState({ chat: 1 }, "");
  render();
}
function closeChat() { stopMsgs(); S.chat = null; render(); }
window.addEventListener("popstate", () => { if (S.chat) closeChat(); });

function renderChat() {
  const c = S.chat, p = S.profiles.get(c.other) || { displayName: "Unknown user", username: "" };
  app.innerHTML = `<header class="bar"><button class="iconbtn" data-act="back" aria-label="Back">${ICON.back}</button>
      ${avatar(p)}<div><div class="title">${esc(p.displayName)}</div><div class="sub">${p.username ? "@" + esc(p.username) : ""}</div></div></header>
    <div class="msgs" id="msgs" role="log" aria-live="polite" aria-label="Messages"></div>
    <form class="composer" data-form="send"><label class="sr" for="msgInput">Message</label>
      <textarea id="msgInput" name="text" rows="1" maxlength="2000" placeholder="${p.deleted ? "This account was deleted" : "Message"}" autocomplete="off" ${p.deleted ? "disabled" : ""}></textarea>
      <button class="sendbtn" type="submit" aria-label="Send message" ${p.deleted ? "disabled" : ""}>${ICON.send}</button></form>`;
  subscribeMessages();
}
function subscribeMessages() {
  stopMsgs();
  const c = S.chat;
  const q = query(collection(db, "chats", c.id, "messages"), orderBy("createdAt", "desc"), limit(c.limit));
  unsubMsgs = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    if (S.chat !== c) return;
    c.msgs = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }), pending: d.metadata.hasPendingWrites })).reverse();
    c.hasMore = snap.docs.length >= c.limit;
    if (!snap.metadata.fromCache) c.loadingOlder = false;
    renderMessages();
    markRead();
  }, (err) => { console.error("messages listener", err.code); toast("Could not load messages. Check your connection."); });
}
function renderMessages() {
  const el = $("#msgs"), c = S.chat; if (!el || !c) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  const prevH = el.scrollHeight, prevTop = el.scrollTop, me = S.user.uid;
  let html = c.hasMore ? `<button class="btn ghost small older" data-act="older">Load older messages</button>` : "";
  if (!c.msgs.length) html += `<div class="empty"><h2>No messages yet</h2><p>Send the first one.</p></div>`;
  html += c.msgs.map((m) => {
    const mine = m.senderId === me;
    const tick = !mine ? "" : m.pending ? `<span class="tick" role="img" aria-label="Sending">…</span>`
      : m.read ? `<span class="tick read" role="img" aria-label="Read">✓✓</span>` : `<span class="tick" role="img" aria-label="Sent">✓</span>`;
    return `<div class="bubble${mine ? " me" : ""}">${esc(m.text)}<span class="t">${fmtStamp(m.createdAt && m.createdAt.toDate())} ${tick}</span></div>`;
  }).join("");
  el.innerHTML = html;
  const last = c.msgs[c.msgs.length - 1], grew = c.msgs.length > c.prevCount;
  c.prevCount = c.msgs.length;
  if (c.loadingOlder) el.scrollTop = el.scrollHeight - prevH + prevTop;
  else if (c.stick || nearBottom || (grew && last && last.senderId === me)) { el.scrollTop = el.scrollHeight; c.stick = false; }
  else el.scrollTop = prevTop;
}
function markRead() {
  const c = S.chat; if (!c || document.visibilityState !== "visible") return;
  const me = S.user.uid;
  const unread = c.msgs.filter((m) => m.senderId !== me && m.read === false && !m.pending && !c.marking.has(m.id)).slice(0, 400);
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.forEach((m) => { c.marking.add(m.id); batch.update(doc(db, "chats", c.id, "messages", m.id), { read: true }); });
  batch.update(doc(db, "chats", c.id), { [`unread.${me}`]: 0 });
  batch.commit().catch((e) => { console.error("mark read", e.code); unread.forEach((m) => c.marking.delete(m.id)); });
}
function sendMessage(form) {
  const c = S.chat, ta = form.elements.text, text = ta.value.trim();
  if (!c || !text) return;
  ta.value = ""; autosize(ta); ta.focus();
  const me = S.user.uid, batch = writeBatch(db);
  batch.set(doc(collection(db, "chats", c.id, "messages")), { senderId: me, text, createdAt: serverTimestamp(), read: false });
  batch.set(doc(db, "chats", c.id), {
    members: [me, c.other].sort(),
    lastMessage: { text: text.slice(0, 100), senderId: me },
    lastMessageAt: serverTimestamp(),
    unread: { [c.other]: increment(1) }
  }, { merge: true });
  batch.commit().catch((e) => {
    console.error("send", e.code);
    toast("Message not sent. Check your connection and try again.");
    const t = $("#msgInput"); if (t && !t.value) t.value = text;
  });
}
function autosize(t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }

/* ---------- dialogs ---------- */
function openDialog(html) { const d = $("#dlg"); d.innerHTML = html; if (!d.open) d.showModal(); }
function closeDialog() { const d = $("#dlg"); if (d.open) d.close(); }
function openDeleteDialog() {
  openDialog(`<h2>Delete your account?</h2>
    <p>This permanently deletes your login, profile, username and contacts. Messages you already sent stay in other people's chats. This cannot be undone.</p>
    <form data-form="deleteAccount" novalidate>
      <div class="field"><label for="delPw">Enter your password to confirm</label>
        <input id="delPw" name="password" type="password" autocomplete="current-password" required></div>
      <p id="dlgMsg" class="msg-error" role="alert"></p>
      <div class="row"><button class="btn danger small" type="submit">Delete account</button>
      <button class="btn ghost small" type="button" data-act="close-dialog">Cancel</button></div></form>`);
}

/* ---------- form handlers ---------- */
const forms = {
  async login(f) {
    const email = f.email.value.trim(), pw = f.password.value;
    if (!email || !pw) return setMsg("Enter your email and password.");
    await signInWithEmailAndPassword(auth, email, pw);
  },
  async register(f) {
    const email = f.email.value.trim(), pw = f.password.value;
    if (!email) return setMsg("Enter your email.");
    if (pw.length < 8) return setMsg("Use a password with at least 8 characters.");
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    try { await sendEmailVerification(cred.user); } catch (e) { console.error("verify email", e.code); }
  },
  async reset(f) {
    const email = f.email.value.trim();
    if (!email) return setMsg("Enter your email.");
    await sendPasswordResetEmail(auth, email);
    setMsg("If an account exists for that email, a reset link is on its way. Check spam too.", true);
  },
  async profileSetup(f) {
    const displayName = f.displayName.value.trim();
    const username = f.username.value.trim().toLowerCase().replace(/^@/, "");
    const bio = f.bio.value.trim();
    if (!displayName) return setMsg("Enter a display name.");
    if (!/^[a-z0-9_]{3,20}$/.test(username)) return setMsg("Username needs 3 to 20 lowercase letters, numbers or underscores.");
    const uid = S.user.uid;
    await runTransaction(db, async (tx) => {
      const uref = doc(db, "usernames", username);
      if ((await tx.get(uref)).exists()) throw new Error("username-taken");
      tx.set(uref, { uid });
      tx.set(doc(db, "users", uid), { displayName, username, bio, createdAt: serverTimestamp() });
    });
    await loadProfile();
    render();
  },
  async editProfile(f) {
    const displayName = f.displayName.value.trim(), bio = f.bio.value.trim();
    if (!displayName) return setMsg("Display name cannot be empty.");
    await updateDoc(doc(db, "users", S.user.uid), { displayName, bio });
    S.profile = { ...S.profile, displayName, bio }; S.profiles.set(S.user.uid, S.profile);
    toast("Profile saved"); render();
  },
  async send(f) { sendMessage(f); },
  async deleteAccount(f) {
    const user = auth.currentUser, uid = user.uid, username = S.profile.username;
    const err = (t) => { const el = $("#dlgMsg"); if (el) el.textContent = t; };
    if (!f.password.value) return err("Enter your password.");
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, f.password.value));
      const cs = await getDocs(collection(db, "users", uid, "contacts"));
      const batch = writeBatch(db);
      cs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, "usernames", username));
      batch.delete(doc(db, "users", uid));
      await batch.commit();
      await deleteUser(user);
      closeDialog(); toast("Account deleted");
    } catch (e) { console.error("delete account", e.code); err(friendly(e)); }
  }
};
document.addEventListener("submit", async (e) => {
  const f = e.target, name = f.dataset && f.dataset.form;
  if (!name || !forms[name]) return;
  e.preventDefault();
  const btn = f.querySelector('button[type="submit"]');
  if (name !== "send") { if (btn) btn.disabled = true; setMsg(""); }
  try { await forms[name](f); }
  catch (err) { console.error(name, err.code || err.message); if (name === "deleteAccount") return; setMsg(friendly(err)); }
  finally { if (btn && name !== "send") btn.disabled = false; }
});

/* ---------- click / input delegation ---------- */
const actions = {
  "auth-mode": (t) => { S.authMode = t.dataset.mode; render(); },
  logout: async () => { closeDialog(); await signOut(auth); },
  retry: async () => { await loadProfile(); render(); },
  resend: async () => {
    try { await sendEmailVerification(auth.currentUser); setMsg("Verification email sent. Check spam too.", true); }
    catch (e) { console.error("resend", e.code); setMsg(friendly(e)); }
  },
  "check-verified": async () => {
    const u = auth.currentUser;
    try {
      await u.reload();
      if (!u.emailVerified) return setMsg("Not verified yet. Open the link in the email, then try again.");
      await u.getIdToken(true);
      S.user = u; await loadProfile(); render();
    } catch (e) { console.error("check verified", e.code); setMsg(friendly(e)); }
  },
  "open-chat": (t) => openChat(t.dataset.uid),
  back: () => { if (history.state && history.state.chat) history.back(); else closeChat(); },
  older: () => { const c = S.chat; c.limit += PAGE; c.loadingOlder = true; setTimeout(() => { c.loadingOlder = false; }, 5000); subscribeMessages(); },
  "add-contact": (t) => addContact(t.dataset.uid),
  "remove-contact": (t) => removeContact(t.dataset.uid),
  invite,
  "delete-account": openDeleteDialog,
  "close-dialog": closeDialog
};
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act],[data-tab],[data-set-theme]");
  if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; render(); return; }
  if (t.dataset.setTheme) { setTheme(t.dataset.setTheme); render(); return; }
  const fn = actions[t.dataset.act]; if (fn) fn(t);
});
document.addEventListener("input", (e) => {
  const id = e.target.id;
  if (id === "msgInput") autosize(e.target);
  else if (id === "chatSearch") renderChatList();
  else if (id === "userSearch") { clearTimeout(searchTimer); searchTimer = setTimeout(runUserSearch, 350); }
});
document.addEventListener("keydown", (e) => {
  if (e.target.id === "msgInput" && e.key === "Enter" && !e.shiftKey && matchMedia("(pointer:fine)").matches) {
    e.preventDefault(); e.target.form.requestSubmit();
  }
});
document.addEventListener("visibilitychange", markRead);
window.addEventListener("offline", () => toast("You are offline. Messages send when you reconnect, but only while this app stays open."));

/* ---------- boot ---------- */
function hideSplash() { const s = $("#splash"); if (!s) return; s.classList.add("hide"); setTimeout(() => s.remove(), 300); }
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch((e) => console.error("sw", e));

if (!configured) { hideSplash(); render(); }
else {
  onAuthStateChanged(auth, async (u) => {
    stopAll();
    S.user = u; S.profile = null; S.profileError = false; S.chat = null; S.chats = []; S.contacts = [];
    S.contactIds = new Set(); S.lastResults = []; S.profiles.clear();
    if (!u) { S.tab = "chats"; S.authMode = "login"; }
    if (u && u.emailVerified) await loadProfile();
    S.ready = true; hideSplash(); render();
  });
}
