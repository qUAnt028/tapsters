// Tapsters — cart helpers. Uses Supabase for logged-in users, localStorage for guests.
// Note: checkout is allowed only for logged-in users (see checkout.js).
(function () {
  const KEY = "tapsters.cart";

  function readGuest() {
    try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
    catch (e) { return []; }
  }
  function writeGuest(list) {
    localStorage.setItem(KEY, JSON.stringify(list));
    document.dispatchEvent(new CustomEvent("tap:cartchange"));
  }

  async function list() {
    const t = window.tapsters;
    if (!t || !t.isConfigured) return readGuest();
    const user = await t.getUser();
    if (!user) return readGuest();
    const { data, error } = await t.client
      .from("cart_items")
      .select(`
        id, quantity, item_id,
        items:items ( id, title, price, currency, image_url, sold, stock, seller_id )
      `)
      .order("created_at", { ascending: false });
    if (error) { console.error(error); return []; }
    return (data || [])
      .filter((row) => row.items)
      .map((row) => ({
        id: row.items.id,
        title: row.items.title,
        price: row.items.price,
        currency: row.items.currency,
        image_url: row.items.image_url,
        seller_id: row.items.seller_id,
        quantity: row.quantity,
        cart_id: row.id,
      }));
  }

  async function add(item, qty = 1) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) return addGuest(item, qty);
    const user = await t.getUser();
    if (!user) return addGuest(item, qty);
    if (item.seller_id && item.seller_id === user.id) {
      throw new Error("Ви не можете додати власне оголошення до кошика.");
    }
    const { data: existing } = await t.client
      .from("cart_items")
      .select("id, quantity")
      .eq("user_id", user.id)
      .eq("item_id", item.id)
      .maybeSingle();
    if (existing) {
      const { error } = await t.client
        .from("cart_items")
        .update({ quantity: existing.quantity + qty })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await t.client
        .from("cart_items")
        .insert({ user_id: user.id, item_id: item.id, quantity: qty });
      if (error) throw error;
    }
    document.dispatchEvent(new CustomEvent("tap:cartchange"));
  }

  function addGuest(item, qty) {
    const list = readGuest();
    const idx = list.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      list[idx].quantity += qty;
    } else {
      list.push({
        id: item.id,
        title: item.title,
        price: item.price,
        currency: item.currency,
        image_url: item.image_url || null,
        seller_id: item.seller_id || null,
        quantity: qty,
      });
    }
    writeGuest(list);
  }

  async function setQty(itemId, qty) {
    const t = window.tapsters;
    if (qty <= 0) return remove(itemId);
    if (!t || !t.isConfigured) {
      const list = readGuest();
      const found = list.find((i) => i.id === itemId);
      if (found) found.quantity = qty;
      writeGuest(list);
      return;
    }
    const user = await t.getUser();
    if (!user) {
      const list = readGuest();
      const found = list.find((i) => i.id === itemId);
      if (found) found.quantity = qty;
      writeGuest(list);
      return;
    }
    const { error } = await t.client
      .from("cart_items")
      .update({ quantity: qty })
      .eq("user_id", user.id)
      .eq("item_id", itemId);
    if (error) console.error(error);
    document.dispatchEvent(new CustomEvent("tap:cartchange"));
  }

  async function remove(itemId) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) {
      writeGuest(readGuest().filter((i) => i.id !== itemId));
      return;
    }
    const user = await t.getUser();
    if (!user) {
      writeGuest(readGuest().filter((i) => i.id !== itemId));
      return;
    }
    const { error } = await t.client
      .from("cart_items")
      .delete()
      .eq("user_id", user.id)
      .eq("item_id", itemId);
    if (error) console.error(error);
    document.dispatchEvent(new CustomEvent("tap:cartchange"));
  }

  async function clear() {
    const t = window.tapsters;
    writeGuest([]);
    if (!t || !t.isConfigured) return;
    const user = await t.getUser();
    if (!user) return;
    await t.client.from("cart_items").delete().eq("user_id", user.id);
    document.dispatchEvent(new CustomEvent("tap:cartchange"));
  }

  // Merge guest cart into the logged-in user's cart, then drop the guest cart.
  async function mergeGuestCart() {
    const t = window.tapsters;
    if (!t || !t.isConfigured) return;
    const user = await t.getUser();
    if (!user) return;
    const guest = readGuest();
    if (!guest.length) return;
    for (const it of guest) {
      try { await add({ id: it.id, seller_id: it.seller_id, title: it.title, price: it.price, currency: it.currency, image_url: it.image_url }, it.quantity); }
      catch (e) { /* ignore individual failures */ }
    }
    writeGuest([]);
  }

  async function count() {
    const items = await list();
    return items.reduce((sum, i) => sum + (i.quantity || 0), 0);
  }

  window.tapCart = { list, add, setQty, remove, clear, count, mergeGuestCart };
})();
