// Tapsters — site-wide toast notifications for new chat messages.
//
// Polls every POLL_MS for messages addressed to the logged-in user (i.e.
// in chats they participate in, sent by the *other* party) that arrived
// after the last "seen at" timestamp we have on this device, and pops a
// toast in the bottom-right for each one.
//
// Behaviour:
//   - Auto-fades after AUTO_HIDE_MS.
//   - Hovering over the toast cancels the fade timer; leaving restarts it.
//   - The "×" button dismisses immediately.
//   - Clicking the body navigates to the relevant chat.
//
// We skip toasting when the user is already looking at the same chat
// (chat.html?id=X) so the page itself can handle the new message.
(function () {
  var POLL_MS = 10000;
  var AUTO_HIDE_MS = 5000;
  var FIRST_POLL_DELAY_MS = 1500;
  // Per-account so a shared device doesn't carry one user's seen-at into
  // the next user's session.
  function lastSeenKey(userId) { return "tap.notif.lastSeenAt." + userId; }

  var currentUser = null;
  var pollHandle = null;
  var inFlight = false;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[c];
    });
  }

  function displayNameFromProfile(p) {
    if (!p) return "Користувач";
    return p.full_name || p.username || "Користувач";
  }

  function activeChatId() {
    var path = (location.pathname || "").toLowerCase();
    if (!path.endsWith("/chat.html") && path !== "/chat.html") return null;
    var params = new URLSearchParams(location.search);
    return params.get("id");
  }

  function ensureStack() {
    var stack = document.getElementById("toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  function shortenForToast(text, max) {
    var s = String(text || "");
    if (s.length <= max) return s;
    return s.slice(0, max - 1).trimEnd() + "…";
  }

  function showToast(opts) {
    var stack = ensureStack();
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML =
      '<button class="toast-close" type="button" aria-label="Закрити">×</button>' +
      '<div class="toast-title">' + escapeHtml(opts.title) + "</div>" +
      (opts.subtitle ? '<div class="toast-sub">' + escapeHtml(opts.subtitle) + "</div>" : "") +
      '<div class="toast-body">' + escapeHtml(opts.body) + "</div>";
    stack.appendChild(el);
    // Force a layout cycle before adding .show so the transition fires.
    requestAnimationFrame(function () { el.classList.add("show"); });

    var hideTimer = null;

    function dismiss() {
      if (!el.parentNode) return;
      el.classList.remove("show");
      el.classList.add("hiding");
      // Match the CSS transition duration (250ms).
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 300);
    }
    function scheduleHide() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(dismiss, AUTO_HIDE_MS);
    }
    scheduleHide();

    el.addEventListener("mouseenter", function () {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    el.addEventListener("mouseleave", scheduleHide);

    el.querySelector(".toast-close").addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      dismiss();
    });
    if (opts.href) {
      el.addEventListener("click", function (ev) {
        // Don't navigate when the close button was clicked.
        if (ev.target.closest(".toast-close")) return;
        location.href = opts.href;
      });
    }
  }

  function readLastSeenAt() {
    if (!currentUser) return null;
    var saved = null;
    try { saved = localStorage.getItem(lastSeenKey(currentUser.id)); } catch (e) {}
    if (saved) return saved;
    // First visit on this device for this account: only toast messages
    // newer than the moment they signed in, so we don't blast the user
    // with a backlog of every historical message.
    var iso = new Date().toISOString();
    try { localStorage.setItem(lastSeenKey(currentUser.id), iso); } catch (e) {}
    return iso;
  }

  function writeLastSeenAt(iso) {
    if (!currentUser) return;
    try { localStorage.setItem(lastSeenKey(currentUser.id), iso); } catch (e) {}
  }

  async function poll() {
    var t = window.tapsters;
    if (!t || !t.isConfigured) return;
    if (!currentUser) return;
    if (inFlight) return;
    if (document.visibilityState === "hidden") return;
    inFlight = true;
    try {
      // 1) Find every chat the user is in. RLS already enforces this but
      //    we include the .or() so the request is explicit.
      var chatsResp = await t.client
        .from("chats")
        .select("id, item_id, item_title, buyer_id, seller_id")
        .or("buyer_id.eq." + currentUser.id + ",seller_id.eq." + currentUser.id);
      if (chatsResp.error || !chatsResp.data || !chatsResp.data.length) return;

      var chatById = {};
      var chatIds = [];
      chatsResp.data.forEach(function (c) {
        chatById[c.id] = c;
        chatIds.push(c.id);
      });

      // 2) New messages since lastSeenAt that weren't sent by us.
      var lastSeenAt = readLastSeenAt();
      var msgsResp = await t.client
        .from("messages")
        .select("id, chat_id, sender_id, content, created_at, kind")
        .in("chat_id", chatIds)
        .gt("created_at", lastSeenAt)
        .neq("sender_id", currentUser.id)
        .order("created_at", { ascending: true })
        .limit(20);
      if (msgsResp.error || !msgsResp.data || !msgsResp.data.length) return;

      var newest = lastSeenAt;
      msgsResp.data.forEach(function (m) {
        if (m.created_at > newest) newest = m.created_at;
      });

      // 3) Other-party profile per chat for the toast title.
      var otherIds = [];
      msgsResp.data.forEach(function (m) {
        var chat = chatById[m.chat_id];
        if (!chat) return;
        var otherId = chat.buyer_id === currentUser.id ? chat.seller_id : chat.buyer_id;
        if (otherIds.indexOf(otherId) === -1) otherIds.push(otherId);
      });
      var profilesById = {};
      if (otherIds.length) {
        var profilesResp = await t.client
          .from("profiles")
          .select("id, username, full_name")
          .in("id", otherIds);
        (profilesResp.data || []).forEach(function (p) { profilesById[p.id] = p; });
      }

      // 4) Pop a toast for each new message, unless the user is already
      //    viewing that specific chat.
      var hereChatId = activeChatId();
      msgsResp.data.forEach(function (m) {
        if (m.chat_id === hereChatId) return; // page handles it
        var chat = chatById[m.chat_id];
        if (!chat) return;
        var otherId = chat.buyer_id === currentUser.id ? chat.seller_id : chat.buyer_id;
        var name = displayNameFromProfile(profilesById[otherId]);
        var subtitle = chat.item_title ? "Про: " + chat.item_title : "Особисте повідомлення";
        var preview;
        if (m.kind === "order") {
          // Order-notification cards have JSON in `content`; show a
          // generic teaser instead of the raw JSON.
          preview = "🛒 New order — open to view receipt";
        } else {
          preview = shortenForToast(m.content, 140);
        }
        showToast({
          title: name,
          subtitle: subtitle,
          body: preview,
          href: "chat.html?id=" + encodeURIComponent(m.chat_id),
        });
      });

      writeLastSeenAt(newest);
    } catch (e) {
      // Silent — toasts are non-critical. Logging would spam the console
      // on every poll if the user is offline.
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (pollHandle) return;
    pollHandle = setInterval(poll, POLL_MS);
    setTimeout(poll, FIRST_POLL_DELAY_MS);
  }
  function stop() {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
  }

  async function init() {
    var t = window.tapsters;
    if (!t || !t.isConfigured) return;
    currentUser = await t.getUser();
    if (currentUser) start();
    if (typeof t.onAuth === "function") {
      t.onAuth(async function () {
        stop();
        currentUser = await t.getUser();
        if (currentUser) start();
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && currentUser) {
        // Catch up immediately when the tab comes back to the foreground.
        poll();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
  // Expose for ad-hoc testing in the console.
  window.tapNotify = { show: showToast, poll: poll };
})();
