// Tapsters — personal cabinet (orders, listings, account info).
(function () {
  const $ = (s) => document.querySelector(s);
  const escapeHtml = (s) =>
    String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));

  function deliveryLabel(m) {
    return ({
      nova_poshta: "Nova Poshta",
      ukrposhta:   "Ukrposhta",
      meest:       "Meest",
    })[m] || m;
  }
  function paymentLabel(m) {
    return ({ cod: "Cash on delivery", prepay: "Prepayment" })[m] || m;
  }

  function showTab(name) {
    document.querySelectorAll(".tabs .tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.tab === name)
    );
    document.querySelectorAll(".tab-pane").forEach((p) =>
      p.classList.toggle("hidden", p.id !== "tab-" + name)
    );
    history.replaceState(null, "", "#" + name);
  }

  async function loadOrders(userId) {
    const t = window.tapsters;
    const root = $("#orders-list");
    root.innerHTML = '<div class="empty">Loading…</div>';
    const { data: orders, error } = await t.client
      .from("orders")
      .select("id, total, currency, status, delivery_method, delivery_branch, delivery_address, payment_method, card_last4, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) { root.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'; return; }
    if (!orders.length) { root.innerHTML = '<div class="empty">No orders yet.</div>'; return; }

    // fetch line items
    const ids = orders.map((o) => o.id);
    const { data: lines } = await t.client
      .from("order_items")
      .select("order_id, title, price, currency, quantity")
      .in("order_id", ids);

    const byOrder = {};
    (lines || []).forEach((l) => {
      (byOrder[l.order_id] = byOrder[l.order_id] || []).push(l);
    });

    root.innerHTML = orders.map((o) => {
      const items = byOrder[o.id] || [];
      return `
        <div class="order-row">
          <header>
            <div>
              <div>Order #${escapeHtml(o.id.slice(0, 8))}</div>
              <div class="muted">${new Date(o.created_at).toLocaleString()}</div>
            </div>
            <span class="status ${escapeHtml(o.status)}">${escapeHtml(o.status)}</span>
          </header>
          <div class="kv">
            <div class="k">Delivery</div><div>${escapeHtml(deliveryLabel(o.delivery_method))}</div>
            <div class="k">Branch</div><div>${escapeHtml(o.delivery_branch || "—")}</div>
            <div class="k">Address</div><div>${escapeHtml(o.delivery_address || "—")}</div>
            <div class="k">Payment</div>
            <div>${escapeHtml(paymentLabel(o.payment_method))}${o.card_last4 ? " · ••••" + escapeHtml(o.card_last4) : ""}</div>
          </div>
          <div class="order-items">
            ${items.map((li) => `
              <div>
                <span>${escapeHtml(li.title)} × ${li.quantity}</span>
                <span>${escapeHtml(window.tapCurrency.format(li.price * li.quantity, li.currency))}</span>
              </div>
            `).join("")}
            <div class="between" style="margin-top:6px">
              <strong>Total</strong>
              <strong>${escapeHtml(window.tapCurrency.format(o.total, o.currency))}</strong>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  async function loadMyListings(userId) {
    const t = window.tapsters;
    const root = $("#listings-list");
    root.innerHTML = '<div class="empty">Loading…</div>';
    const { data, error } = await t.client
      .from("items")
      .select("id, title, price, currency, image_url, sold, created_at")
      .eq("seller_id", userId)
      .order("created_at", { ascending: false });
    if (error) { root.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>'; return; }
    if (!data.length) {
      root.innerHTML = '<div class="empty">You have no listings yet. <a href="create-listing.html">Create one</a>.</div>';
      return;
    }
    root.innerHTML = '<div class="grid">' + data.map((it) => `
      <div class="card" data-id="${escapeHtml(it.id)}">
        <a href="item.html?id=${encodeURIComponent(it.id)}">
          <div class="thumb">${it.image_url ? `<img src="${escapeHtml(it.image_url)}" alt="">` : '<div style="font-size:42px">📦</div>'}</div>
          <div class="body">
            <div class="title">${escapeHtml(it.title)}</div>
            <div class="meta">
              <div class="price">${escapeHtml(window.tapCurrency.formatItem(it.price, it.currency))}</div>
              <div class="muted">${it.sold ? "sold" : "active"}</div>
            </div>
          </div>
        </a>
        <div class="row" style="padding:0 12px 12px; gap:8px">
          <button class="btn danger small js-delete-listing" data-id="${escapeHtml(it.id)}">Delete</button>
        </div>
      </div>
    `).join("") + '</div>';

    root.querySelectorAll(".js-delete-listing").forEach((btn) => {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = btn.getAttribute("data-id");
        if (!confirm("Delete this listing? This can't be undone.")) return;
        btn.disabled = true;
        try {
          const { error: delErr } = await t.client.from("items").delete().eq("id", id);
          if (delErr) throw delErr;
          await loadMyListings(userId);
        } catch (e) {
          alert(e.message || "Could not delete listing.");
          btn.disabled = false;
        }
      });
    });
  }

  function displayNameFromProfile(p) {
    if (!p) return "Tapster";
    return p.full_name || p.username || "Tapster";
  }
  function initialFor(name) {
    return (String(name || "T")[0] || "T").toUpperCase();
  }

  async function loadMessages(userId) {
    const t = window.tapsters;
    const root = $("#messages-list");
    root.innerHTML = '<div class="empty">Loading…</div>';

    // RLS filters to chats where the current user is buyer OR seller, but
    // we add an explicit .or() so the query is unambiguous to the planner.
    const { data: chats, error } = await t.client
      .from("chats")
      .select("id, item_id, item_title, buyer_id, seller_id, created_at, last_message_at")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
      .order("last_message_at", { ascending: false });

    if (error) {
      root.innerHTML = '<div class="error">' + escapeHtml(error.message) + '</div>';
      return;
    }
    if (!chats || !chats.length) {
      root.innerHTML = '<div class="empty">No messages yet. Open a product page and tap “Написати продавцю” to start a chat with a seller.</div>';
      return;
    }

    // Fan-out: load the "other party" profile for each chat in one batch.
    const otherIds = Array.from(new Set(
      chats.map((c) => (c.buyer_id === userId ? c.seller_id : c.buyer_id))
    ));
    const profilesById = {};
    if (otherIds.length) {
      const { data: profiles } = await t.client
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .in("id", otherIds);
      (profiles || []).forEach((p) => { profilesById[p.id] = p; });
    }

    root.innerHTML = '<div class="chat-list">' + chats.map((c) => {
      const otherId = c.buyer_id === userId ? c.seller_id : c.buyer_id;
      const other = profilesById[otherId];
      const name = displayNameFromProfile(other);
      const about = c.item_title
        ? "About: " + c.item_title
        : "Direct message";
      const when = new Date(c.last_message_at).toLocaleString();
      return `
        <a class="chat-row" href="chat.html?id=${encodeURIComponent(c.id)}">
          <div class="chat-avatar">${escapeHtml(initialFor(name))}</div>
          <div class="chat-body">
            <div class="chat-who">${escapeHtml(name)}</div>
            <div class="chat-about">${escapeHtml(about)}</div>
          </div>
          <div class="chat-meta">${escapeHtml(when)}</div>
        </a>
      `;
    }).join("") + '</div>';
  }

  async function loadAccount(user) {
    const t = window.tapsters;
    const { data: profile } = await t.client
      .from("profiles")
      .select("username, full_name")
      .eq("id", user.id)
      .maybeSingle();

    $("#account-email").value = user.email || "";
    $("#account-username").value = (profile && profile.username) || "";
    $("#account-name").value = (profile && profile.full_name) || "";

    $("#account-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("#account-error").classList.add("hidden");
      $("#account-success").classList.add("hidden");
      const username = $("#account-username").value.trim();
      const full_name = $("#account-name").value.trim();
      try {
        const { error } = await t.client
          .from("profiles")
          .upsert({ id: user.id, username: username || null, full_name: full_name || null }, { onConflict: "id" });
        if (error) throw error;
        const s = $("#account-success");
        s.textContent = "Saved.";
        s.classList.remove("hidden");
      } catch (e) {
        const er = $("#account-error");
        er.textContent = e.message || "Could not save changes.";
        er.classList.remove("hidden");
      }
    }, { once: false });

    $("#logout-btn").addEventListener("click", async () => {
      await t.signOut();
      location.href = "index.html";
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const t = window.tapsters;
    if (!t || !t.isConfigured) {
      $("#auth-gate").classList.remove("hidden");
      return;
    }
    const user = await t.getUser();
    if (!user) { $("#auth-gate").classList.remove("hidden"); return; }
    $("#cabinet-root").classList.remove("hidden");

    document.querySelectorAll(".tabs .tab").forEach((tab) =>
      tab.addEventListener("click", () => showTab(tab.dataset.tab))
    );

    const initial = (location.hash || "#orders").slice(1);
    showTab(["orders", "listings", "messages", "account"].includes(initial) ? initial : "orders");

    await loadOrders(user.id);
    await loadMyListings(user.id);
    await loadMessages(user.id);
    await loadAccount(user);
  });
})();
