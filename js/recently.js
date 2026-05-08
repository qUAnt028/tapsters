// Tapsters — recently viewed items, scoped per logged-in user.
// Each account gets its own bucket in localStorage so the list does not
// leak between accounts when switching users on the same browser.
(function () {
  const PREFIX = "tapsters.recentlyViewed";
  const GUEST_KEY = PREFIX + ".__guest__";
  const MAX = 12;

  // Active user id, or null for "guest". Pages should call setUser() once they
  // know who is logged in (see js/main.js / js/header.js).
  let currentUserId = null;

  function key() {
    return currentUserId ? PREFIX + "." + currentUserId : GUEST_KEY;
  }

  function read() {
    try {
      return JSON.parse(localStorage.getItem(key()) || "[]");
    } catch (e) {
      return [];
    }
  }
  function write(items) {
    localStorage.setItem(key(), JSON.stringify(items.slice(0, MAX)));
  }

  function record(item) {
    if (!item || !item.id) return;
    const list = read().filter((i) => i.id !== item.id);
    list.unshift({
      id: item.id,
      title: item.title,
      price: item.price,
      currency: item.currency,
      image_url: item.image_url || null,
      seller_id: item.seller_id || null,
      viewed_at: new Date().toISOString(),
    });
    write(list);
  }

  function list() { return read(); }
  function clear() { write([]); }

  // Switch to a user-scoped bucket (or guest if userId is null/undefined).
  // Returns true if the active scope changed.
  function setUser(userId) {
    const next = userId || null;
    if (next === currentUserId) return false;
    currentUserId = next;
    return true;
  }

  // Wipe the guest bucket. Useful right after logout so guests on this device
  // don't inherit the previous user's history.
  function clearGuest() {
    localStorage.removeItem(GUEST_KEY);
  }

  window.tapRecent = { record, list, clear, setUser, clearGuest };
})();
