'use strict';

/* =========================================================================
   Paramount Shipping — shared frontend runtime.

   Owns the things every page has: the nav, the theme, scroll reveals, card
   tilt, counters, the banner's parallax, and the forms that post to the API.
   Exposes a few helpers on window.PARAMOUNT for the per-page scripts.

   Everything here is progressive: the pages are complete static HTML, so a
   failure in this file costs motion and live values, never content.
   ========================================================================= */

(function () {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));

  async function fetchJSON(url, options) {
    const res = await fetch(url, {
      ...options,
      headers: { Accept: 'application/json', ...(options && options.headers) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  /* ------------------------------------------------------------- theme --- */

  const THEME_KEY = 'pm-theme';

  function currentTheme() {
    const set = document.documentElement.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* private mode: the choice simply does not survive a reload */
    }
  }

  const themeBtn = $('#theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    });
  }

  /* --------------------------------------------------------------- nav --- */

  /**
   * The menu is a left-hand drawer now.
   *
   * Opening it traps nothing and breaks nothing: the page behind still scrolls
   * on desktop, Escape closes it, focus moves to the panel so a keyboard lands
   * inside rather than behind it, and the scrim is clickable because that is
   * what everyone tries first.
   */
  const drawer = $('#drawer');
  const scrim = $('#drawer-scrim');
  const navToggle = $('#navtoggle');
  let lastFocus = null;

  function setDrawer(open) {
    if (!drawer || !scrim || !navToggle) return;
    drawer.classList.toggle('open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    navToggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('drawer-open', open);

    if (open) {
      lastFocus = document.activeElement;
      scrim.hidden = false;
      // Next frame, so the transition has a start state to animate from.
      requestAnimationFrame(() => scrim.classList.add('open'));
      const first = drawer.querySelector('a, button');
      if (first) first.focus({ preventScroll: true });
    } else {
      scrim.classList.remove('open');
      setTimeout(() => {
        if (!drawer.classList.contains('open')) scrim.hidden = true;
      }, 380);
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }
  }

  if (navToggle) navToggle.addEventListener('click', () => setDrawer(!drawer.classList.contains('open')));
  if (scrim) scrim.addEventListener('click', () => setDrawer(false));
  const drawerClose = $('#drawer-close');
  if (drawerClose) drawerClose.addEventListener('click', () => setDrawer(false));
  if (drawer) {
    drawer.addEventListener('click', (e) => {
      if (e.target.closest('a')) setDrawer(false);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) setDrawer(false);
  });

  const progress = $('#progress');

  /*
   * The banner's parallax.
   *
   * The photograph moves at about four fifths of the page's speed while the
   * band is on screen, so the words lift off it rather than sliding with it.
   * Kept small on purpose: enough to register as depth, not enough to notice as
   * an effect. Transform only — no layout, no paint, one property the
   * compositor already handles.
   */
  const bannerImg = $('.banner-img');
  const banner = bannerImg ? bannerImg.closest('.banner') : null;
  const PARALLAX = 0.18;

  function onScroll() {
    const y = window.scrollY;
    if (nav) nav.classList.toggle('stuck', y > 12);
    if (progress) {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = `${height > 0 ? Math.min(100, (y / height) * 100) : 0}%`;
    }
    if (banner && !reduceMotion) {
      const h = banner.offsetHeight;
      // Once the band has scrolled past there is nothing to move, and holding
      // the transform at its last value keeps the compositor layer quiet.
      if (y < h) bannerImg.style.transform = `translate3d(0, ${(y * PARALLAX).toFixed(1)}px, 0)`;
    }
  }

  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        onScroll();
        ticking = false;
      });
    },
    { passive: true }
  );
  onScroll();

  /* ------------------------------------------------------------ reveal --- */

  /**
   * Reveal on scroll, and count up any number inside the revealed block.
   *
   * One observer for both, because a counter that starts before its panel is
   * on screen has finished by the time anyone sees it.
   */
  const revealed = new WeakSet();

  function countUp(node) {
    const target = Number(node.getAttribute('data-count'));
    if (!Number.isFinite(target)) return;
    const suffix = node.getAttribute('data-suffix') || '';
    const duration = reduceMotion ? 0 : 1400;
    const started = performance.now();

    const format = (value) => {
      const rounded = target >= 1000 ? Math.round(value) : Math.round(value * 10) / 10;
      return rounded.toLocaleString('en-US') + suffix;
    };

    if (!duration) {
      node.textContent = format(target);
      return;
    }

    const tick = (now) => {
      const t = Math.min(1, (now - started) / duration);
      // Ease out, so the number settles rather than stopping dead.
      node.textContent = format(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function reveal(node) {
    if (revealed.has(node)) return;
    revealed.add(node);
    node.classList.add('in');
    $$('[data-count]', node).forEach(countUp);
    if (node.hasAttribute('data-count')) countUp(node);
  }

  const revealTargets = () => $$('[data-reveal], [data-count]');

  // The figures are written into the HTML as their final values, so the page is
  // correct without a script. They are zeroed here, once, only because they are
  // about to be animated back up.
  if (!reduceMotion) {
    $$('[data-count]').forEach((node) => {
      node.textContent = '0';
    });
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          io.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    revealTargets().forEach((node) => io.observe(node));

    // Re-scan after content is injected (tracking results, service pages).
    window.PARAMOUNT_OBSERVE = (root) => {
      $$('[data-reveal], [data-count]', root || document).forEach((node) => {
        if (!revealed.has(node)) io.observe(node);
      });
    };
  } else {
    revealTargets().forEach(reveal);
    window.PARAMOUNT_OBSERVE = (root) => $$('[data-reveal], [data-count]', root || document).forEach(reveal);
  }

  /* -------------------------------------------------------------- tilt --- */

  /**
   * Pointer-driven 3D tilt, plus the lit edge on .card.
   *
   * Delegated from the document rather than bound per card, so cards added
   * later (a tracking result, a service grid) tilt without being registered,
   * and there is one listener instead of dozens.
   */
  const MAX_TILT = 7;

  function onPointerMove(e) {
    const card = e.target.closest('.card, .tilt');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    // The lit edge follows the pointer on every card.
    card.style.setProperty('--mx', `${px * 100}%`);
    card.style.setProperty('--my', `${py * 100}%`);

    if (reduceMotion || !card.hasAttribute('data-tilt')) return;
    card.style.setProperty('--ry', `${(px - 0.5) * 2 * MAX_TILT}deg`);
    card.style.setProperty('--rx', `${(0.5 - py) * 2 * MAX_TILT}deg`);
  }

  function onPointerLeave(e) {
    const card = e.target.closest && e.target.closest('.card, .tilt');
    if (!card) return;
    card.style.setProperty('--rx', '0deg');
    card.style.setProperty('--ry', '0deg');
  }

  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerout', onPointerLeave, { passive: true });
  }

  /* ------------------------------------------------------------- forms --- */

  /**
   * Submit a form as JSON and report back in its own status line.
   *
   * Shared by the enquiry, quote and application forms: they differ in where
   * they post and what they say afterwards, not in how they behave.
   */
  function wireForm(form, { url, collect, success, validate }) {
    if (!form) return;
    const status = $('[data-form-status]', form);
    const button = $('[data-submit]', form) || $('button[type=submit]', form);

    const setStatus = (message, tone) => {
      if (!status) return;
      status.textContent = message;
      status.className = `form-status${tone ? ` ${tone}` : ''}`;
    };

    const clearErrors = () => $$('[data-err]', form).forEach((node) => (node.textContent = ''));
    const showErrors = (fields) => {
      Object.entries(fields || {}).forEach(([key, message]) => {
        const node = $(`[data-err="${key}"]`, form);
        if (node) node.textContent = message;
      });
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearErrors();

      const payload = collect ? collect(form) : Object.fromEntries(new FormData(form).entries());
      const local = validate ? validate(payload) : null;
      if (local && Object.keys(local).length) {
        showErrors(local);
        setStatus('Please check the highlighted fields.', 'bad');
        return;
      }

      const label = button ? button.innerHTML : '';
      if (button) {
        button.disabled = true;
        button.textContent = 'Sending…';
      }
      setStatus('Sending…');

      try {
        const data = await fetchJSON(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        form.reset();
        setStatus(data.message || success || 'Thank you.', 'ok');
      } catch (err) {
        if (err.body && err.body.fields) {
          showErrors(err.body.fields);
          setStatus('Please check the highlighted fields.', 'bad');
        } else {
          setStatus(err.message || 'That did not send. Please try again or email us directly.', 'bad');
        }
      } finally {
        if (button) {
          button.disabled = false;
          button.innerHTML = label;
        }
      }
    });
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  $$('[data-contact-form]').forEach((form) =>
    wireForm(form, {
      url: '/api/contact',
      success: 'Thank you. Your enquiry is with the Paramount desk.',
      validate: (v) => {
        const errors = {};
        if (!v.name || v.name.trim().length < 2) errors.name = 'Please enter your name.';
        if (!EMAIL_RE.test(v.email || '')) errors.email = 'Please enter a valid email address.';
        if (!v.message || v.message.trim().length < 10) errors.message = 'A little more detail, please.';
        return errors;
      },
    })
  );

  /* ------------------------------------------------------- live settings --- */

  /**
   * Contact details come from the API so the desk can change them without a
   * deploy. The page is already correct without this; it only overwrites a
   * value the desk has actually set.
   */
  const site = {};

  async function hydrateSite() {
    try {
      const data = await fetchJSON('/api/site');
      Object.assign(site, data);
      $$('[data-site]').forEach((node) => {
        const key = node.getAttribute('data-site');
        const value = data[key];
        if (!value) return;
        node.textContent = value;
        if (node.tagName === 'A') {
          if (node.href.startsWith('mailto:')) node.href = `mailto:${value}`;
          else if (node.href.startsWith('tel:')) node.href = `tel:${String(value).replace(/\s+/g, '')}`;
        }
      });
      if (data.chat_agent_name) {
        $$('[data-chat-agent]').forEach((node) => (node.textContent = data.chat_agent_name));
      }
    } catch (err) {
      /* the built-in details stand */
    }
  }

  hydrateSite();

  /* ------------------------------------------------------------ exports --- */

  window.PARAMOUNT = { $, $$, esc, fetchJSON, wireForm, site, reduceMotion, EMAIL_RE };
})();
