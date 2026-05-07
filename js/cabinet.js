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
      <a class="card" href="item.html?id=${encodeURIComponent(it.id)}">
        <div class="thumb">${it.image_url ? `<img src="${escapeHtml(it.image_url)}" alt="">` : '<div style="font-size:42px">📦</div>'}</div>
        <div class="body">
          <div class="title">${escapeHtml(it.title)}</div>
          <div class="meta">
            <div class="price">${escapeHtml(window.tapCurrency.formatItem(it.price, it.currency))}</div>
            <div class="muted">${it.sold ? "sold" : "active"}</div>
          </div>
        </div>
      </a>
    `).join("") + '</div>';
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
    showTab(["orders", "listings", "account"].includes(initial) ? initial : "orders");

    await loadOrders(user.id);
    await loadMyListings(user.id);
    await loadAccount(user);
  });
})();
