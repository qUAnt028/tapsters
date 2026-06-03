// Tapsters — small admin helper.
//
// Loads the current user's profile.is_admin once per page and caches the
// result, then exposes a tiny API so other scripts can ask "are we admin?"
// and trigger admin-only actions.
//
//   await window.tapAdmin.isAdmin();          // -> bool
//   await window.tapAdmin.deleteItem(itemId); // RLS allows admins
//   await window.tapAdmin.deleteAccount(uid); // RPC: admin_delete_account
//
// All three return a promise. deleteItem / deleteAccount throw on error.
//
// Admin status is decided by the `is_admin` boolean on `public.profiles`,
// which is flipped manually in the Supabase SQL editor (see schema.sql).
(function () {
  let cached = null;

  async function isAdmin() {
    if (cached !== null) return cached;
    const t = window.tapsters;
    if (!t || !t.isConfigured) { cached = false; return false; }
    const user = await t.getUser();
    if (!user) { cached = false; return false; }
    const { data, error } = await t.client
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      // The most common reason is that schema.sql hasn't been re-run yet
      // and the is_admin column doesn't exist. Treat that as "not admin"
      // rather than throwing so the rest of the page still works.
      console.warn("tapAdmin.isAdmin:", error.message || error);
      cached = false;
      return false;
    }
    cached = !!(data && data.is_admin);
    return cached;
  }

  async function deleteItem(itemId) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) throw new Error("Supabase не налаштовано.");
    const { error } = await t.client.from("items").delete().eq("id", itemId);
    if (error) throw error;
  }

  async function deleteAccount(targetUserId) {
    const t = window.tapsters;
    if (!t || !t.isConfigured) throw new Error("Supabase не налаштовано.");
    const { error } = await t.client.rpc("admin_delete_account", {
      target_user: targetUserId,
    });
    if (error) throw error;
  }

  window.tapAdmin = { isAdmin, deleteItem, deleteAccount };
})();
