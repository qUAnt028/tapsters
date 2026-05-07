// Tapsters — recently viewed items, stored in localStorage.
(function () {
  const KEY = "tapsters.recentlyViewed";
  const MAX = 12;

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch (e) {
      return [];
    }
  }
  function write(list) {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
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
      viewed_at: new Date().toISOString(),
    });
    write(list);
  }

  function list() { return read(); }
  function clear() { write([]); }

  window.tapRecent = { record, list, clear };
})();
