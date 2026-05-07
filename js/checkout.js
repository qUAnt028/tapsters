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

        // Remove the purchased items from the marketplace so other shoppers
        // can't buy them again. RLS only allows deleting one's own items, so
        // we mark them as sold first; sold items are filtered everywhere.
        const itemIds = cartItems.map((it) => it.id);
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
