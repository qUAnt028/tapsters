// Tapsters — single chat thread view (chat.html).
//
// Loads one chat row + all of its messages, lets the current user post a
// new message, and polls every 4s for new messages from the other party.
// (Realtime subscriptions are not strictly required and add a separate
// channel/permission surface we don't want for now.)
(function () {
  const $ = (s) => document.querySelector(s);
  const POLL_MS = 4000;

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function displayNameFromProfile(p) {
    if (!p) return "Користувач";
    return p.full_name || p.username || "Користувач";
  }

  function initialFor(name) {
    return (String(name || "T")[0] || "T").toUpperCase();
  }

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  function formatDayDivider(d) {
    const now = new Date();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return "Сьогодні";
    if (sameDay(d, y))   return "Вчора";
    return d.toLocaleDateString();
  }

  function formatTime(d) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatMoney(amount, currency) {
    if (window.tapCurrency && typeof window.tapCurrency.formatItem === "function") {
      return window.tapCurrency.formatItem(amount, currency);
    }
    return String(amount) + " " + (currency || "");
  }

  function deliveryLabel(m) {
    return ({
      nova_poshta: "Нова Пошта",
      ukrposhta:   "УкрПошта",
      meest:       "Meest",
    })[m] || m || "—";
  }
  function paymentLabel(m) {
    return ({ cod: "Наложений платіж", prepay: "Передоплата" })[m] || m || "—";
  }

  function tryParseOrderPayload(content) {
    try {
      var p = JSON.parse(content);
      if (p && p.kind === "order_notification") return p;
    } catch (_) {}
    return null;
  }

  function renderOrderBubble(m, d, mine) {
    var p = tryParseOrderPayload(m.content);
    if (!p) {
      // Fall back to plain text rendering if the JSON is malformed for
      // any reason — we never want a chat message to render as raw JSON.
      return '<div class="chat-msg ' + (mine ? "me" : "them") + '">' +
        escapeHtml(m.content) +
        '<span class="time">' + escapeHtml(formatTime(d)) + "</span>" +
        "</div>";
    }
    var moneyLine =
      p.quantity != null && p.unit_price != null && p.currency
        ? p.quantity + " × " + formatMoney(p.unit_price, p.currency)
        : "";
    var totalLine =
      p.total != null && p.total_currency
        ? formatMoney(p.total, p.total_currency)
        : "";
    var orderRef =
      p.order_id ? "Замовлення #" + String(p.order_id).slice(0, 8) : "Нове замовлення";

    var kv = "";
    if (p.item_title)       kv += '<div class="k">Товар</div><div>' + escapeHtml(p.item_title) + (moneyLine ? " · " + escapeHtml(moneyLine) : "") + "</div>";
    if (totalLine)          kv += '<div class="k">Всього</div><div>' + escapeHtml(totalLine) + "</div>";
    if (p.delivery_method)  kv += '<div class="k">Доставка</div><div>' + escapeHtml(deliveryLabel(p.delivery_method)) + "</div>";
    if (p.delivery_branch)  kv += '<div class="k">Відділення</div><div>' + escapeHtml(p.delivery_branch) + "</div>";
    if (p.delivery_address) kv += '<div class="k">Адреса</div><div>' + escapeHtml(p.delivery_address) + "</div>";
    if (p.payment_method) {
      var payTxt = paymentLabel(p.payment_method) + (p.card_last4 ? " · ••••" + p.card_last4 : "");
      kv += '<div class="k">Оплата</div><div>' + escapeHtml(payTxt) + "</div>";
    }
    if (p.buyer_name)       kv += '<div class="k">Покупець</div><div>' + escapeHtml(p.buyer_name) + "</div>";

    return (
      '<div class="chat-msg order-card ' + (mine ? "me" : "them") + '"' +
      (m.order_id ? ' data-order-id="' + escapeHtml(m.order_id) + '"' : "") +
      ">" +
        '<div class="order-head">' +
          '<span class="order-emoji">🛒</span>' +
          '<span>' + escapeHtml(orderRef) + '</span>' +
        "</div>" +
        '<div class="order-kv">' + kv + "</div>" +
        '<a class="order-cta" href="cabinet.html#orders">Переглянути повну квитанцію в кабінеті →</a>' +
        '<span class="time">' + escapeHtml(formatTime(d)) + "</span>" +
      "</div>"
    );
  }

  /** Render the full list of messages. We re-render top-to-bottom every
      time the message set grows; it's a small thread, performance is fine. */
  function renderStream(stream, messages, meId) {
    if (!messages.length) {
      stream.innerHTML = '<div class="chat-empty">Поки немає повідомлень — привітайтесь!</div>';
      return;
    }
    let lastDay = null;
    const parts = [];
    messages.forEach((m) => {
      const d = new Date(m.created_at);
      if (!lastDay || !sameDay(lastDay, d)) {
        parts.push(`<div class="day-divider">${escapeHtml(formatDayDivider(d))}</div>`);
        lastDay = d;
      }
      const mine = m.sender_id === meId;
      if (m.kind === "order") {
        parts.push(renderOrderBubble(m, d, mine));
      } else {
        parts.push(`
          <div class="chat-msg ${mine ? "me" : "them"}">
            ${escapeHtml(m.content)}
            <span class="time">${escapeHtml(formatTime(d))}</span>
          </div>
        `);
      }
    });
    stream.innerHTML = parts.join("");
    // Auto-scroll to bottom after re-render.
    stream.scrollTop = stream.scrollHeight;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const t = window.tapsters;
    const authGate = $("#auth-gate");
    const notFound = $("#not-found");
    const root = $("#chat-root");

    if (!t || !t.isConfigured) {
      authGate.classList.remove("hidden");
      return;
    }

    const me = await t.getUser();
    if (!me) {
      authGate.classList.remove("hidden");
      return;
    }

    const params = new URLSearchParams(location.search);
    const chatId = params.get("id");
    if (!chatId) {
      notFound.classList.remove("hidden");
      return;
    }

    // 1) Fetch the chat row. RLS guarantees only participants can read it.
    const { data: chat, error: chatErr } = await t.client
      .from("chats")
      .select("id, item_id, item_title, buyer_id, seller_id, created_at")
      .eq("id", chatId)
      .maybeSingle();

    if (chatErr || !chat) {
      notFound.classList.remove("hidden");
      return;
    }

    // 2) Decide who "the other person" is and load their profile.
    const otherId = chat.buyer_id === me.id ? chat.seller_id : chat.buyer_id;
    const { data: otherProfile } = await t.client
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .eq("id", otherId)
      .maybeSingle();

    const otherName = displayNameFromProfile(otherProfile);
    document.title = `Чат з ${otherName} — Tapsters`;
    $("#chat-who").textContent = otherName;
    $("#chat-avatar").textContent = initialFor(otherName);

    const aboutTxt = chat.item_title
      ? "Про: " + chat.item_title
      : "Особисте повідомлення";
    $("#chat-about").textContent = aboutTxt;

    const itemLink = $("#chat-item-link");
    if (chat.item_id) {
      itemLink.href = "item.html?id=" + encodeURIComponent(chat.item_id);
    } else {
      itemLink.classList.add("hidden");
    }

    // Delete-chat handler. RLS allows either participant to wipe the row;
    // messages cascade-delete via the FK on messages.chat_id.
    const deleteBtn = $("#chat-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Видалити цей чат? Це видалить всі повідомлення для обох учасників і це неможливо відмінити.")) return;
        deleteBtn.disabled = true;
        try {
          const { error: delErr } = await t.client.from("chats").delete().eq("id", chatId);
          if (delErr) throw delErr;
          // Stop polling before navigating so we don't fire one last request
          // against a now-gone row.
          stopPolling();
          location.replace("cabinet.html#messages");
        } catch (e) {
          alert(e.message || "Не вдалося видалити цей чат.");
          deleteBtn.disabled = false;
        }
      });
    }

    root.classList.remove("hidden");

    // 3) Load + render messages.
    const stream = $("#chat-stream");
    let messages = [];
    let lastSeenAt = null;

    async function loadMessages(initial) {
      let q = t.client
        .from("messages")
        .select("id, chat_id, sender_id, content, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });
      if (!initial && lastSeenAt) {
        q = q.gt("created_at", lastSeenAt);
      }
      const { data, error } = await q;
      if (error) {
        console.error("chat loadMessages:", error);
        return;
      }
      if (!data) return;
      if (initial) {
        messages = data;
      } else if (data.length) {
        // Merge in only new messages we don't already have (defensive vs.
        // optimistic appends below).
        const existing = new Set(messages.map((m) => m.id));
        data.forEach((m) => { if (!existing.has(m.id)) messages.push(m); });
      } else {
        return; // nothing new
      }
      if (messages.length) {
        lastSeenAt = messages[messages.length - 1].created_at;
      }
      renderStream(stream, messages, me.id);
    }

    await loadMessages(true);

    // 4) Sending a message. Optimistically append so the UI feels instant.
    const form = $("#chat-form");
    const input = $("#chat-input");
    const sendBtn = $("#chat-send");

    async function sendMessage() {
      const text = input.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      input.disabled = true;
      const optimistic = {
        id: "tmp-" + Date.now(),
        chat_id: chatId,
        sender_id: me.id,
        content: text,
        created_at: new Date().toISOString(),
      };
      messages.push(optimistic);
      renderStream(stream, messages, me.id);
      input.value = "";
      try {
        const { data, error } = await t.client
          .from("messages")
          .insert({ chat_id: chatId, sender_id: me.id, content: text })
          .select()
          .single();
        if (error) throw error;
        // Replace the optimistic entry with the real row so future polls
        // dedupe on a real UUID and the timestamp matches the server.
        const idx = messages.findIndex((m) => m.id === optimistic.id);
        if (idx >= 0 && data) messages[idx] = data;
        if (data) lastSeenAt = data.created_at;
        renderStream(stream, messages, me.id);
      } catch (e) {
        // Roll back the optimistic message and tell the user.
        messages = messages.filter((m) => m.id !== optimistic.id);
        renderStream(stream, messages, me.id);
        alert(e.message || "Не вдалося надіслати повідомлення.");
      } finally {
        sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
      }
    }

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      sendMessage();
    });

    // Submit on Enter (Shift+Enter inserts a newline).
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendMessage();
      }
    });

    // 5) Cheap polling for incoming messages from the other party.
    let polling = null;
    function startPolling() {
      stopPolling();
      polling = setInterval(() => {
        if (document.visibilityState === "visible") loadMessages(false);
      }, POLL_MS);
    }
    function stopPolling() { if (polling) { clearInterval(polling); polling = null; } }
    startPolling();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        loadMessages(false);
        startPolling();
      } else {
        stopPolling();
      }
    });

    input.focus();
  });
})();
