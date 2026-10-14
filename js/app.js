/* Ummah Chat — real-time client (Supabase) */
(function () {
  "use strict";

  const cfg = window.APP_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("PASTE-YOUR");

  const $ = (id) => document.getElementById(id);
  const AVATAR_COLORS = ["#127245", "#8e5aa8", "#b7791f", "#2b6cb0", "#c0392b", "#0e7c7b", "#6d28d9"];

  const state = {
    supabase: null,
    user: null,
    profile: null,
    isAdmin: false,
    adminIds: new Set(),
    rooms: [],
    roomId: null,
    msgChannel: null,
    presenceChannel: null,
    onlineUsers: new Map(), // presenceKey -> {username, typing}
    typingTimer: null,
    mode: "login",
  };

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    $("toast-wrap").appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return new Date(ts).toLocaleDateString();
  }
  function colorFor(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  /* ---------- boot ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    if (!configured) {
      $("setup-notice").classList.remove("hidden");
      $("auth-view").classList.remove("hidden");
      $("auth-submit").disabled = true;
      $("auth-submit").textContent = "Configure Supabase first";
      return;
    }
    const { createClient } = window.supabase;
    state.supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    wireAuth();
    wireApp();

    state.supabase.auth.onAuthStateChange(async (_evt, session) => {
      if (session && session.user) await enterApp(session.user);
      else showAuth();
    });
    state.supabase.auth.getSession().then(async ({ data }) => {
      if (data.session && data.session.user) await enterApp(data.session.user);
      else showAuth();
    });
  });

  /* ---------- auth ---------- */
  function wireAuth() {
    $("tab-login").onclick = () => setMode("login");
    $("tab-signup").onclick = () => setMode("signup");
    $("auth-form").onsubmit = onAuthSubmit;
  }
  function setMode(mode) {
    state.mode = mode;
    $("tab-login").classList.toggle("active", mode === "login");
    $("tab-signup").classList.toggle("active", mode === "signup");
    $("username-wrap").classList.toggle("hidden", mode === "login");
    $("auth-submit").textContent = mode === "login" ? "Log in" : "Create account";
    $("auth-error").classList.add("hidden");
  }
  function authFail(msg) {
    const e = $("auth-error");
    e.textContent = msg;
    e.classList.remove("hidden");
  }
  async function onAuthSubmit(ev) {
    ev.preventDefault();
    const email = $("email").value.trim();
    const password = $("password").value;
    const btn = $("auth-submit");
    btn.disabled = true;
    try {
      if (state.mode === "signup") {
        const username = $("username").value.trim();
        if (!username) return authFail("Please choose a display name.");
        const { data, error } = await state.supabase.auth.signUp({
          email, password, options: { data: { username } },
        });
        if (error) throw error;
        if (data.user) await ensureProfile(data.user, username);
        toast("Account created — welcome! 🌙");
      } else {
        const { error } = await state.supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      authFail(err.message || "Something went wrong.");
    } finally {
      btn.disabled = false;
    }
  }
  async function ensureProfile(user, username) {
    const name = username || user.user_metadata?.username || user.email.split("@")[0];
    const { error } = await state.supabase.from("profiles").upsert(
      { id: user.id, username: name },
      { onConflict: "id" }
    );
    if (error) console.warn("profile upsert:", error.message);
  }
  function showAuth() {
    $("app-view").classList.add("hidden");
    $("auth-view").classList.remove("hidden");
    leaveRoom();
  }

  /* ---------- app shell ---------- */
  async function enterApp(user) {
    state.user = user;
    await ensureProfile(user);
    const { data: profile } = await state.supabase
      .from("profiles").select("username").eq("id", user.id).maybeSingle();
    state.profile = profile || { username: user.email.split("@")[0] };
    const { data: adminRows } = await state.supabase.from("admins").select("user_id");
    state.adminIds = new Set((adminRows || []).map((r) => r.user_id));
    state.isAdmin = state.adminIds.has(user.id);

    $("me-line").textContent = "Signed in as " + state.profile.username + (state.isAdmin ? " · admin" : "");
    $("auth-view").classList.add("hidden");
    $("app-view").classList.remove("hidden");

    const { data: rooms, error } = await state.supabase
      .from("rooms").select("*").order("sort_order");
    if (error) { toast("Could not load rooms: " + error.message); return; }
    state.rooms = rooms || [];
    renderRooms();
    if (state.rooms.length) selectRoom(state.rooms[0].id);
  }

  function wireApp() {
    $("menu-btn").onclick = () => { $("sidebar").classList.add("open"); $("sidebar-scrim").classList.remove("hidden"); };
    $("sidebar-scrim").onclick = closeSidebar;
    $("users-btn").onclick = () => { $("users-panel").classList.add("open"); $("users-scrim").classList.remove("hidden"); };
    $("users-close").onclick = closeUsers;
    $("users-scrim").onclick = closeUsers;
    $("logout-btn").onclick = async () => { await state.supabase.auth.signOut(); };
    $("account-btn").onclick = () => {
      $("acc-email").value = state.user.email;
      $("acc-username").value = state.profile.username;
      $("acc-uid").value = state.user.id;
      $("account-modal").classList.remove("hidden");
    };
    $("account-close").onclick = () => $("account-modal").classList.add("hidden");
    $("account-modal").onclick = (e) => { if (e.target.id === "account-modal") $("account-modal").classList.add("hidden"); };
    $("copy-uid").onclick = async () => {
      try { await navigator.clipboard.writeText(state.user.id); toast("User ID copied"); }
      catch { toast("Copy failed — select the text manually"); }
    };
    $("send-form").onsubmit = onSend;
    $("message-input").addEventListener("input", onTyping);
  }
  function closeSidebar() { $("sidebar").classList.remove("open"); $("sidebar-scrim").classList.add("hidden"); }
  function closeUsers() { $("users-panel").classList.remove("open"); $("users-scrim").classList.add("hidden"); }

  /* ---------- rooms ---------- */
  function renderRooms() {
    const list = $("room-list");
    list.innerHTML = "";
    for (const r of state.rooms) {
      const b = document.createElement("button");
      b.className = "room-btn" + (r.id === state.roomId ? " active" : "");
      b.innerHTML =
        '<span class="room-icon">' + esc(r.icon || "💬") + "</span>" +
        '<span class="room-names"><span class="room-title">' + esc(r.name) + "</span><br>" +
        '<span class="room-desc">' + esc(r.description || "") + "</span></span>";
      b.onclick = () => { selectRoom(r.id); closeSidebar(); };
      list.appendChild(b);
    }
  }

  async function selectRoom(roomId) {
    if (state.roomId === roomId) return;
    leaveRoom();
    state.roomId = roomId;
    renderRooms();
    const room = state.rooms.find((r) => r.id === roomId);
    $("room-name").textContent = (room.icon || "") + " " + room.name;

    const box = $("messages");
    box.innerHTML = '<div class="empty-chat">Loading messages…</div>';
    const { data, error } = await state.supabase
      .from("messages")
      .select("id, user_id, username, content, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .limit(80);
    if (error) { box.innerHTML = '<div class="empty-chat">Could not load messages.</div>'; return; }
    box.innerHTML = "";
    if (!data.length) box.innerHTML = '<div class="empty-chat">No messages yet — be the first to say salaam! 🌙</div>';
    for (const m of data) appendMessage(m, false);

    subscribeRoom(roomId);
    joinPresence(roomId);
  }

  function leaveRoom() {
    if (state.msgChannel) { state.supabase.removeChannel(state.msgChannel); state.msgChannel = null; }
    if (state.presenceChannel) { state.supabase.removeChannel(state.presenceChannel); state.presenceChannel = null; }
    state.onlineUsers.clear();
    renderOnline();
    state.roomId = null;
  }

  /* ---------- messages: realtime ---------- */
  function subscribeRoom(roomId) {
    state.msgChannel = state.supabase
      .channel("room:" + roomId)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "room_id=eq." + roomId },
        (payload) => appendMessage(payload.new, true))
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const el = document.querySelector('[data-msg-id="' + payload.old.id + '"]');
          if (el) el.remove();
        })
      .subscribe();
  }

  function canDelete(msg) {
    return msg.user_id === state.user.id || state.isAdmin;
  }

  function appendMessage(m, scroll) {
    const box = $("messages");
    const empty = box.querySelector(".empty-chat");
    if (empty) empty.remove();
    if (document.querySelector('[data-msg-id="' + m.id + '"]')) return;

    const own = m.user_id === state.user.id;
    const div = document.createElement("div");
    div.className = "msg" + (own ? " own" : "");
    div.dataset.msgId = m.id;
    div.innerHTML =
      '<div class="avatar" style="background:' + colorFor(m.username) + '">' + esc(m.username[0].toUpperCase()) + "</div>" +
      '<div class="msg-body">' +
        '<div class="msg-head"><span class="msg-user">' + esc(m.username) + "</span>" +
        (state.adminIds.has(m.user_id) ? ' <span class="admin-badge">ADMIN</span>' : "") +
        '<span class="msg-time" title="' + esc(new Date(m.created_at).toLocaleString()) + '">' + timeAgo(m.created_at) + "</span></div>" +
        '<div class="msg-text">' + esc(m.content) + "</div>" +
        '<div class="msg-actions">' +
          (canDelete(m) ? '<button class="link-btn" data-act="del">Delete</button>' : "") +
          (!own ? '<button class="link-btn" data-act="rep">Report</button>' : "") +
        "</div>" +
      "</div>";

    div.querySelectorAll(".link-btn").forEach((btn) => {
      btn.onclick = () => {
        if (btn.dataset.act === "del") deleteMessage(m.id);
        else reportMessage(m.id);
      };
    });
    box.appendChild(div);
    if (scroll) box.scrollTop = box.scrollHeight;
  }

  async function onSend(ev) {
    ev.preventDefault();
    const input = $("message-input");
    const content = input.value.trim();
    if (!content || !state.roomId) return;
    input.value = "";
    setTyping(false);
    const { error } = await state.supabase.from("messages").insert({
      room_id: state.roomId,
      user_id: state.user.id,
      username: state.profile.username,
      content,
    });
    if (error) toast("Could not send: " + error.message);
    else { const box = $("messages"); box.scrollTop = box.scrollHeight; }
  }

  async function deleteMessage(id) {
    if (!confirm("Delete this message?")) return;
    const { error } = await state.supabase.from("messages").delete().eq("id", id);
    if (error) toast("Delete failed: " + error.message);
  }

  async function reportMessage(id) {
    const reason = prompt("Why are you reporting this message? (optional)");
    if (reason === null) return;
    const { error } = await state.supabase.from("reports").insert({
      message_id: id, reporter_id: state.user.id, reason: reason.trim() || "no reason given",
    });
    toast(error ? "Report failed: " + error.message : "Thanks — moderators will review it.");
  }

  /* ---------- presence: online users + typing ---------- */
  function joinPresence(roomId) {
    const key = state.user.id;
    state.presenceChannel = state.supabase.channel("presence:" + roomId, {
      config: { presence: { key } },
    });
    state.presenceChannel
      .on("presence", { event: "sync" }, () => {
        const s = state.presenceChannel.presenceState();
        state.onlineUsers.clear();
        for (const k of Object.keys(s)) {
          const metas = s[k];
          if (metas && metas.length) {
            const m = metas[0];
            state.onlineUsers.set(k, { username: m.username, typing: !!m.typing });
          }
        }
        renderOnline();
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await state.presenceChannel.track({ username: state.profile.username, typing: false });
        }
      });
  }

  function renderOnline() {
    const users = [...state.onlineUsers.values()];
    $("online-count").textContent = users.length + " online";
    const list = $("online-list");
    list.innerHTML = "";
    users.sort((a, b) => a.username.localeCompare(b.username));
    for (const u of users) {
      const li = document.createElement("li");
      li.innerHTML = '<span class="dot' + (u.typing ? " typing" : "") + '"></span><span>' + esc(u.username) + "</span>";
      list.appendChild(li);
    }
    const typers = users.filter((u) => u.typing && u.username !== state.profile.username);
    const bar = $("typing-bar");
    if (typers.length) {
      bar.textContent = typers.map((u) => u.username).join(", ") + (typers.length === 1 ? " is" : " are") + " typing…";
      bar.classList.remove("hidden");
    } else bar.classList.add("hidden");
    const room = state.rooms.find((r) => r.id === state.roomId);
    if (room) $("room-meta").textContent = users.length + " online · " + (room.description || "");
  }

  function onTyping() {
    setTyping(true);
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => setTyping(false), 2500);
  }
  function setTyping(v) {
    if (state.presenceChannel) state.presenceChannel.track({ username: state.profile.username, typing: v });
  }
})();
