// Tapsters — checkout page logic.
(function () {
  const $ = (s) => document.querySelector(s);

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  let currentUser = null;
  let cartItems = [];

  function showError(msg) {
    const e = $("#form-error");
    e.textContent = msg;
    e.classList.remove("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function clearError() { $("#form-error").classList.add("hidden"); }

  function paintSummary() {
    const root = $("#cart-summary");
    const display = window.tapCurrency.getDisplay();
    if (!cartItems.length) {
      root.innerHTML = '<div class="empty">Your cart is empty.</div>';
      $("#grand-total").textContent = "—";
      return;
    }
    root.innerHTML = cartItems
      .map((it) => {
        const line = window.tapCurrency.formatItem(it.price * it.quantity, it.currency);
        return `<div class="between" style="padding:6px 0;border-bottom:1px solid var(--purple-100)">
          <div>
            <div style="font-weight:600">${escapeHtml(it.title)}</div>
            <div class="muted">${it.quantity} × ${window.tapCurrency.formatItem(it.price, it.currency)}</div>
          </div>
          <div class="price">${line}</div>
        </div>`;
      })
      .join("");

    let totalUSD = 0;
    cartItems.forEach((it) => {
      totalUSD += window.tapCurrency.convert(it.price * it.quantity, it.currency, "USD");
    });
    const total = window.tapCurrency.convert(totalUSD, "USD", display);
    $("#grand-total").textContent = window.tapCurrency.format(total, display);
  }

  function wireOptionCards(rootSel, name) {
    const root = document.querySelector(rootSel);
    const cards = root.querySelectorAll(".option-card");
    function updateActive() {
      cards.forEach((c) => {
        const input = c.querySelector("input");
        c.classList.toggle("active", input.checked);
      });
    }
    cards.forEach((card) => {
      card.addEventListener("click", () => {
        cards.forEach((c) => {
          const i = c.querySelector("input");
          i.checked = c === card;
        });
        updateActive();
        if (name === "payment") togglePaymentFields();
      });
    });
    updateActive();
  }

  function togglePaymentFields() {
    const value = document.querySelector('input[name="payment"]:checked').value;
    $("#card-fields").classList.toggle("hidden", value !== "prepay");
  }

  function formatCardNumber(v) {
    const digits = v.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(.{4})/g, "$1 ").trim();
  }
  function formatExpiry(v) {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    if (digits.length < 3) return digits;
    return digits.slice(0, 2) + "/" + digits.slice(2);
  }

  function validate(payment) {
    if (payment === "prepay") {
      const number = $("#card-number").value.replace(/\s/g, "");
      const name = $("#card-name").value.trim();
      const exp = $("#card-expiry").value.trim();
      const cvv = $("#card-cvv").value.trim();
      if (number.length < 13 || number.length > 19) return "Enter a valid card number.";
      if (!name) return "Enter the cardholder name.";
      if (!/^\d{2}\/\d{2}$/.test(exp)) return "Enter expiry as MM/YY.";
      if (!/^\d{3,4}$/.test(cvv)) return "Enter a valid CVV.";
    }
    if (!cartItems.length) return "Cart is empty.";
    return null;
  }

  // Sends one chat message per purchased item to the corresponding
  // seller, using a JSON payload so the chat UI can render it as a
  // receipt card. We upsert the chat first (the (item_id, buyer_id) pair
  // is unique), then insert the message. RLS only allows inserting
  // messages as the auth'd user, so the buyer is always the sender.
  async function notifySellersAboutOrder(ctx) {
    const t = window.tapsters;
    if (!t || !t.isConfigured || !currentUser) return;

    // Pull the buyer's display name once so each notification renders it.
    let buyerName = "Buyer";
    try {
      const { data: prof } = await t.client
        .from("profiles")
        .select("username, full_name")
        .eq("id", currentUser.id)
        .maybeSingle();
      if (prof) buyerName = prof.full_name || prof.username || buyerName;
    } catch (_) { /* fall through */ }

    for (const it of ctx.cartItems) {
      const sellerId = ctx.sellerByItem[it.id];
      if (!sellerId || sellerId === currentUser.id) continue; // skip self-orders / missing seller

      // 1) Ensure a chat row exists for (item, buyer).
      let chatId = null;
      try {
        const existing = await t.client
          .from("chats")
          .select("id")
          .eq("item_id", it.id)
          .eq("buyer_id", currentUser.id)
          .maybeSingle();
        if (existing.data && existing.data.id) {
          chatId = existing.data.id;
        } else {
          const created = await t.client
            .from("chats")
            .insert({
              item_id: it.id,
              item_title: it.title,
              buyer_id: currentUser.id,
              seller_id: sellerId,
            })
            .select("id")
            .single();
          if (created.error) throw created.error;
          chatId = created.data.id;
        }
      } catch (e) {
        // Some other client may have raced us to create the chat; try to
        // recover by re-selecting.
        try {
          const recover = await t.client
            .from("chats")
            .select("id")
            .eq("item_id", it.id)
            .eq("buyer_id", currentUser.id)
            .maybeSingle();
          chatId = recover.data && recover.data.id;
        } catch (_) {}
        if (!chatId) continue;
      }

      // 2) Build the receipt payload — a JSON blob the chat renderer
      //    recognises and renders as a card. Everything the seller needs
      //    is embedded here so they don't have to fetch the order row
      //    (and RLS wouldn't let them anyway — `orders` is read-self).
      const payload = {
        kind: "order_notification",
        order_id: ctx.order_id,
        item_id: it.id,
        item_title: it.title,
        quantity: it.quantity,
        unit_price: it.price,
        currency: it.currency,
        total: Number((it.price * it.quantity).toFixed(2)),
        total_currency: it.currency,
        delivery_method: ctx.delivery,
        delivery_branch: ctx.branch || null,
        delivery_address: ctx.address || null,
        payment_method: ctx.payment,
        card_last4: ctx.card_last4 || null,
        buyer_name: buyerName,
      };

      try {
        await t.client.from("messages").insert({
          chat_id: chatId,
          sender_id: currentUser.id,
          content: JSON.stringify(payload),
          kind: "order",
          order_id: ctx.order_id,
        });
      } catch (e) {
        // If the schema hasn't been migrated for `kind` / `order_id` we
        // fall back to a plain-text notification so the seller still
        // gets a message — they just won't see the rich card.
        try {
          await t.client.from("messages").insert({
            chat_id: chatId,
            sender_id: currentUser.id,
            content:
              "🛒 New order from " + buyerName +
              " — " + it.quantity + "× " + it.title +
              " for " + window.tapCurrency.format(it.price * it.quantity, it.currency) +
              ". Delivery: " + (ctx.delivery || "—") +
              (ctx.branch ? ", " + ctx.branch : "") +
              (ctx.address ? ", " + ctx.address : "") +
              ". Payment: " + (ctx.payment === "prepay" ? "Prepayment" : "Cash on delivery") + ".",
          });
        } catch (_) { /* give up silently */ }
      }
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const t = window.tapsters;
    const gate = $("#auth-gate");
    const empty = $("#empty-cart");
    const grid = $("#checkout-grid");

    currentUser = t && t.isConfigured ? await t.getUser() : null;

    if (!currentUser) {
      gate.classList.remove("hidden");
      return;
    }

    cartItems = await window.tapCart.list();
    if (!cartItems.length) {
      empty.classList.remove("hidden");
      return;
    }

    grid.classList.remove("hidden");
    paintSummary();
    document.addEventListener("tap:currencychange", paintSummary);

    wireOptionCards("#delivery-cards", "delivery");
    wireOptionCards("#payment-cards", "payment");

    $("#card-number").addEventListener("input", (e) => {
      e.target.value = formatCardNumber(e.target.value);
    });
    $("#card-expiry").addEventListener("input", (e) => {
      e.target.value = formatExpiry(e.target.value);
    });

    $("#checkout-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      clearError();

      const delivery = document.querySelector('input[name="delivery"]:checked').value;
      const payment  = document.querySelector('input[name="payment"]:checked').value;
      const branch  = $("#branch").value.trim();
      const address = $("#address").value.trim();

      if (!branch && !address) {
        showError("Please enter a branch or delivery address.");
        return;
      }

      const err = validate(payment);
      if (err) { showError(err); return; }

      const submit = $("#submit-btn");
      submit.disabled = true;

      try {
        // We need to know each item's seller_id to (a) open a chat with
        // each seller and (b) so the order_items insert can be linked
        // back to the right account. The cart payload doesn't carry the
        // seller id, so fetch it now in a single query.
        const itemIds = cartItems.map((it) => it.id);
        const { data: sellerRows } = await t.client
          .from("items")
          .select("id, seller_id, title")
          .in("id", itemIds);
        const sellerByItem = {};
        (sellerRows || []).forEach((r) => { sellerByItem[r.id] = r.seller_id; });

        // Total is stored in USD for consistency.
        let totalUSD = 0;
        cartItems.forEach((it) => {
          totalUSD += window.tapCurrency.convert(it.price * it.quantity, it.currency, "USD");
        });

        const card_last4 =
          payment === "prepay"
            ? $("#card-number").value.replace(/\s/g, "").slice(-4)
            : null;

        const { data: order, error } = await t.client
          .from("orders")
          .insert({
            user_id: currentUser.id,
            total: Number(totalUSD.toFixed(2)),
            currency: "USD",
            status: payment === "prepay" ? "paid" : "pending",
            delivery_method: delivery,
            delivery_branch: branch || null,
            delivery_address: address || null,
            payment_method: payment,
            card_last4,
          })
          .select("id")
          .single();

        if (error) throw error;

        const lines = cartItems.map((it) => ({
          order_id: order.id,
          item_id: it.id,
          title: it.title,
          price: it.price,
          currency: it.currency,
          quantity: it.quantity,
        }));
        const { error: liErr } = await t.client.from("order_items").insert(lines);
        if (liErr) throw liErr;

        // Notify each seller via chat. The buyer is the message sender
        // (so RLS allows the insert) and the chat is created on demand.
        // Non-fatal: if any of this fails, the order is still placed and
        // the user sees a success screen.
        try {
          await notifySellersAboutOrder({
            order_id: order.id,
            cartItems,
            sellerByItem,
            delivery,
            payment,
            branch,
            address,
            card_last4,
            totalUSD,
          });
        } catch (notifyErr) {
          // Best-effort — the order is the source of truth and exists in
          // the cabinet either way.
          console.warn("order notification:", notifyErr);
        }

        // Remove the purchased items from the marketplace so other shoppers
        // can't buy them again. RLS only allows deleting one's own items, so
        // we mark them as sold first; sold items are filtered everywhere.
        try {
          await t.client.from("items").update({ sold: true }).in("id", itemIds);
        } catch (_) { /* non-fatal */ }
        try {
          await t.client.from("items").delete().in("id", itemIds);
        } catch (_) { /* non-fatal — the items are still hidden by sold=true */ }

        await window.tapCart.clear();

        $("#checkout-grid").classList.add("hidden");
        $("#success-card").classList.remove("hidden");
        $("#success-msg").textContent = `Order #${order.id.slice(0, 8)} placed. Status: ${payment === "prepay" ? "paid" : "pending"}.`;
      } catch (e) {
        showError(e.message || "Could not place order.");
        submit.disabled = false;
      }
    });
  });
})();
