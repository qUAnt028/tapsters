// Tapsters — item detail page logic.
(function () {
  const $ = (s) => document.querySelector(s);

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  async function fetchItem(id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) return null;
    const { data } = await t.client
      .from("items")
      .select(`
        id, title, description, price, currency, image_url, sold, stock, seller_id, created_at,
        categories:categories ( name, slug )
      `)
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function fetchSeller(seller_id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured || !seller_id) return null;
    const { data } = await t.client
      .from("profiles")
      .select("id, username, full_name, avatar_url, created_at")
      .eq("id", seller_id)
      .maybeSingle();
    return data;
  }

  async function fetchSellerRating(seller_id) {
    const t = window.tapsters;
    if (!t || !t.isConfigured || !seller_id) return { avg: null, count: 0, total: 0 };
    const { data, error } = await t.client
      .from("reviews")
      .select("rating")
      .eq("subject_id", seller_id);
    if (error) { console.error("fetchSellerRating:", error); return { avg: null, count: 0, total: 0 }; }
    if (!data || !data.length) return { avg: null, count: 0, total: 0 };
    const rated = data.filter((r) => r.rating != null);
    const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null;
    return { avg, count: rated.length, total: data.length };
  }

  function paintStars(root, value) {
    root.innerHTML = "";
    const filled = Math.round(value || 0);
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement("span");
      s.className = "star" + (i <= filled ? " on" : "");
      s.textContent = "★";
      root.appendChild(s);
    }
  }

  function sellerDisplayName(profile) {
    if (!profile) return "Tapster";
    return profile.full_name || profile.username || "Tapster";
  }

  function sellerInitial(profile) {
    const name = sellerDisplayName(profile);
    return (name[0] || "T").toUpperCase();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) {
      $("#not-found").classList.remove("hidden");
      return;
    }

    const item = await fetchItem(id);
    if (!item) {
      $("#not-found").classList.remove("hidden");
      return;
    }

    $("#item-root").classList.remove("hidden");
    $("#item-title").textContent = item.title;
    $("#item-desc").textContent = item.description || "";
    $("#item-currency").textContent = item.currency;
    $("#item-category").textContent = item.categories ? item.categories.name : "";
    $("#item-price").textContent = window.tapCurrency.formatItem(item.price, item.currency);
    document.title = `${item.title} — Tapsters`;

    if (item.image_url) {
      $("#item-image").innerHTML = `<img src="${escapeHtml(item.image_url)}" alt="">`;
    }

    // Seller card
    const seller = await fetchSeller(item.seller_id);
    const name = sellerDisplayName(seller);
    $("#seller-link").textContent = name;
    $("#seller-avatar").textContent = sellerInitial(seller);
    const sellerHref = `seller.html?id=${encodeURIComponent(item.seller_id)}`;
    $("#seller-link").setAttribute("href", sellerHref);
    $("#seller-profile-btn").setAttribute("href", sellerHref);

    const rating = await fetchSellerRating(item.seller_id);
    if (rating.count) {
      paintStars($("#seller-stars"), rating.avg);
      const r = Math.round(rating.avg * 10) / 10;
      $("#seller-rating-text").textContent = `${r.toFixed(1)} · ${rating.count} review${rating.count === 1 ? "" : "s"}`;
    } else if (rating.total) {
      // There are reviews about the seller, just none of them carry a star
      // rating yet — surface that instead of falsely saying "No reviews yet".
      $("#seller-stars").innerHTML = "";
      $("#seller-rating-text").textContent = `${rating.total} review${rating.total === 1 ? "" : "s"} · no rating yet`;
    } else {
      $("#seller-stars").innerHTML = "";
      $("#seller-rating-text").textContent = "No reviews yet";
    }

    // Record recently viewed
    window.tapRecent.record(item);

    // Re-render price when display currency changes
    document.addEventListener("tap:currencychange", () => {
      $("#item-price").textContent = window.tapCurrency.formatItem(item.price, item.currency);
    });

    // Show delete button only to the seller; hide chat-with-seller when
    // viewing your own item (you can't chat with yourself).
    const t = window.tapsters;
    const me = t && t.isConfigured ? await t.getUser() : null;
    const isSeller = !!(me && me.id === item.seller_id);

    if (isSeller) {
      const delBtn = $("#delete-btn");
      delBtn.classList.remove("hidden");
      $("#add-cart-btn").classList.add("hidden");
      $("#buy-now-btn").classList.add("hidden");
      $("#chat-seller-btn").classList.add("hidden");

      delBtn.addEventListener("click", async () => {
        if (!confirm("Delete this listing? This can't be undone.")) return;
        delBtn.disabled = true;
        try {
          const { error } = await t.client.from("items").delete().eq("id", item.id);
          if (error) throw error;
          alert("Listing deleted.");
          location.href = "cabinet.html#listings";
        } catch (e) {
          alert(e.message || "Could not delete listing.");
          delBtn.disabled = false;
        }
      });
    }

    // Chat-with-seller button. Creates the (item, buyer) chat row if it
    // doesn't already exist, then sends the user to chat.html.
    const chatBtn = $("#chat-seller-btn");
    if (chatBtn && !isSeller) {
      chatBtn.addEventListener("click", async () => {
        if (!me) {
          location.href = `auth.html?next=${encodeURIComponent("item.html?id=" + id)}`;
          return;
        }
        chatBtn.disabled = true;
        const prevLabel = chatBtn.textContent;
        chatBtn.textContent = "Opening chat…";
        try {
          // Does a chat already exist for (this item, this buyer)?
          const { data: existing, error: selErr } = await t.client
            .from("chats")
            .select("id")
            .eq("item_id", item.id)
            .eq("buyer_id", me.id)
            .maybeSingle();
          if (selErr) throw selErr;

          let chatId = existing && existing.id;
          if (!chatId) {
            const { data: inserted, error: insErr } = await t.client
              .from("chats")
              .insert({
                item_id:    item.id,
                item_title: item.title,
                buyer_id:   me.id,
                seller_id:  item.seller_id,
              })
              .select("id")
              .single();
            if (insErr) throw insErr;
            chatId = inserted.id;
          }
          location.href = "chat.html?id=" + encodeURIComponent(chatId);
        } catch (e) {
          const errBox = $("#add-error");
          errBox.textContent = e.message || "Could not open chat with this seller.";
          errBox.classList.remove("hidden");
          chatBtn.textContent = prevLabel;
          chatBtn.disabled = false;
        }
      });
    }

    // Cart actions
    $("#add-cart-btn").addEventListener("click", async () => {
      const u = t && t.isConfigured ? await t.getUser() : null;
      if (!u) {
        alert("Please log in or sign up to add items to your cart.");
        location.href = `auth.html?next=${encodeURIComponent("item.html?id=" + id)}`;
        return;
      }
      try {
        await window.tapCart.add(item, 1);
      } catch (e) {
        const err = $("#add-error");
        err.textContent = e.message || "Could not add to cart.";
        err.classList.remove("hidden");
        return;
      }
      const cartMenu = document.getElementById("cart-menu");
      if (cartMenu) cartMenu.classList.add("open");
      document.dispatchEvent(new CustomEvent("tap:cartchange"));
    });

    $("#buy-now-btn").addEventListener("click", async () => {
      const u = t && t.isConfigured ? await t.getUser() : null;
      if (!u) {
        location.href = `auth.html?next=${encodeURIComponent("item.html?id=" + id)}`;
        return;
      }
      try { await window.tapCart.add(item, 1); } catch (e) { /* already in cart */ }
      location.href = "checkout.html";
    });
  });
})();
