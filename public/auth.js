/* Clerk sign-in gate. Loads clerk-js from the app's Clerk frontend API, shows the sign-in card until
   someone is signed in, then exposes window.paydirtAuth for app.js:
     paydirtAuth.ready  → resolves once a user is signed in
     paydirtAuth.token() → fresh session token for the Authorization header */
(() => {
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  window.paydirtAuth = { ready, token: async () => (await ready).session?.getToken() ?? null };

  const overlay = document.getElementById('signin');
  const fail = (msg) => { overlay.hidden = false; document.getElementById('signinBox').textContent = msg; };

  // pk_(test|live)_<base64 of "frontend-api-host$">
  const frontendApi = (pk) => atob(pk.split('_')[2]).replace(/\$$/, '');

  async function start() {
    const cfg = await fetch('/api/auth-config').then((r) => r.json());
    if (!cfg.publishableKey) return fail('Sign-in is not configured: CLERK_PUBLISHABLE_KEY is missing on the server.');
    // Clerk Core 3: the UI bundle (@clerk/ui@1) loads separately from the SDK (@clerk/clerk-js@6).
    const host = frontendApi(cfg.publishableKey);
    const load = (src, attrs = {}) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      Object.assign(s.dataset, attrs);
      s.onload = res; s.onerror = () => rej(new Error(`Could not load ${src}`));
      document.head.appendChild(s);
    });
    await load(`https://${host}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await load(`https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { clerkPublishableKey: cfg.publishableKey });
    const clerk = window.Clerk;
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });

    const show = () => {
      if (clerk.user) {
        overlay.hidden = true;
        const btn = document.getElementById('userButton');
        if (btn && !btn.dataset.mounted) { clerk.mountUserButton(btn); btn.dataset.mounted = '1'; }
        resolveReady(clerk);
      } else {
        overlay.hidden = false;
        const box = document.getElementById('signinBox');
        if (!box.dataset.mounted) { clerk.mountSignIn(box); box.dataset.mounted = '1'; }
      }
    };
    clerk.addListener(show);
    show();
  }
  start().catch((e) => fail(e.message));
})();
