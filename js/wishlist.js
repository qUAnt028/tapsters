// Tapsters — wishlist helpers. Stored in Supabase, available to logged-in
// users only (guests are redirected to auth by the calling pages).
(function () {
  async function getUser() {
    const t = window.tapsters;
    if (!t || !t.isConfigured) return null;
    return await t.getUser();
  }

  function notify() {
    document.dispatchEvent(new CustomEvent("tap:wishlistchange"));
  }

  // Set of item ids in the current user's wishlist.
  async function ids() {
    const t = window.tapsters;
    const user = await getUser();
    if (!user) return new Set();
    const { data, error } = await t.client
      .from("wishlist_items")
      .select("item_id")
      .eq("user_id", user.id);
    if (error) { console.error(error); return new Set(); }
    return new Set((data || []).map((r) => r.item_id));
  }

  // Full item rows for the wishlist page.
  async function list() {
    const t = window.tapsters;
    const user = await getUser();
    if (!user) return [];
    const { data, error } = await t.client
      .from("wishlist_items")
      .select(`
        id, item_id, created_at,
        items:items ( id, title, price, currency, image_url, sold, seller_id )
      `)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) { console.error(error); return []; }
    return (data || []).filter((r) => r.items).map((r) => r.items);
  }

  async function has(itemId) {
    const t = window.tapsters;
    const user = await getUser();
    if (!user) return false;
    const { data } = await t.client
      .from("wishlist_items")
      .select("id")
      .eq("user_id", user.id)
      .eq("item_id", itemId)
      .maybeSingle();
    return !!data;
  }

  async function add(itemId) {
    const t = window.tapsters;
    const user = await getUser();
    if (!user) throw new Error("Будь ласка, увійдіть в акаунт.");
    const { error } = await t.client
      .from("wishlist_items")
      .insert({ user_id: user.id, item_id: itemId });
    if (error && error.code !== "23505") throw error; // ignore duplicates
    notify();
  }

  async function remove(itemId) {
    const t = window.tapsters;
    const user = await getUser();
    if (!user) return;
    const { error } = await t.client
      .from("wishlist_items")
      .delete()
      .eq("user_id", user.id)
      .eq("item_id", itemId);
    if (error) throw error;
    notify();
  }

  // Returns true when the item ends up IN the wishlist.
  async function toggle(itemId) {
    if (await has(itemId)) {
      await remove(itemId);
      return false;
    }
    await add(itemId);
    return true;
  }

  window.tapWishlist = { ids, list, has, add, remove, toggle };
})();
