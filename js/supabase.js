// Tapsters — Supabase client + auth helpers (UMD CDN build).
// Loaded as a non-module script. Exposes `window.tapsters`.
(function () {
  const cfg = window.TAPSTERS_CONFIG || {};
  const isPlaceholder =
    !cfg.SUPABASE_URL ||
    !cfg.SUPABASE_ANON_KEY ||
    cfg.SUPABASE_URL.startsWith("YOUR_") ||
    cfg.SUPABASE_ANON_KEY.startsWith("YOUR_");

  // The supabase-js UMD bundle exposes window.supabase with createClient.
  const lib = window.supabase;
  if (!lib || !lib.createClient) {
    console.error("Supabase JS library failed to load.");
  }

  let client = null;
  if (!isPlaceholder && lib && lib.createClient) {
    client = lib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
      },
    });
  }

  // ---------- helpers ----------
  function showConfigBanner() {
    if (document.getElementById("tap-config-banner")) return;
    const div = document.createElement("div");
    div.id = "tap-config-banner";
    div.className = "config-banner";
    div.innerHTML =
      'Tapsters is not connected to Supabase yet. Edit <code>js/config.js</code> with your project URL and anon key. ' +
      'See <a href="docs/SETUP.md">docs/SETUP.md</a>.';
    document.body.prepend(div);
  }

  if (isPlaceholder) {
    document.addEventListener("DOMContentLoaded", showConfigBanner);
  }

  async function getSession() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session || null;
  }

  async function getUser() {
    const sess = await getSession();
    return sess ? sess.user : null;
  }

  async function getProfile() {
    const u = await getUser();
    if (!u || !client) return null;
    const { data } = await client
      .from("profiles")
      .select("id, username, full_name, avatar_url, created_at")
      .eq("id", u.id)
      .single();
    return data;
  }

  // Pretty error messages — and especially make sure "no such account" maps to
  // the same generic "Invalid email or password" so it's not possible (and not
  // distinguishable) to log into a non-existent account.
  function authErrorMessage(err) {
    if (!err) return "";
    const msg = (err.message || "").toLowerCase();
    if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
      return "Invalid email or password. The account may not exist.";
    }
    if (msg.includes("email not confirmed")) {
      return "Please confirm your email address before logging in.";
    }
    if (msg.includes("user already registered")) {
      return "An account with this email already exists. Try logging in instead.";
    }
    return err.message || "Something went wrong.";
  }

  async function signUp({ email, password, username, full_name }) {
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { data: { username, full_name } },
    });
    if (error) throw error;
    return data;
  }

  async function signIn({ email, password }) {
    if (!client) throw new Error("Supabase is not configured.");
    // Supabase already returns "Invalid login credentials" for a missing user,
    // which is exactly what we want — the requirement is that you cannot log
    // into a non-existent account, and the error is indistinguishable from a
    // wrong password (preventing user enumeration).
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  // Subscribe to auth changes (returns unsubscribe).
  function onAuth(cb) {
    if (!client) return () => {};
    const { data: sub } = client.auth.onAuthStateChange((_e, session) => cb(session));
    return () => sub.subscription.unsubscribe();
  }

  window.tapsters = {
    client,
    isConfigured: !isPlaceholder && !!client,
    getSession,
    getUser,
    getProfile,
    signUp,
    signIn,
    signOut,
    onAuth,
    authErrorMessage,
  };
})();
