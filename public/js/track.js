'use strict';

/* =========================================================================
   Consignment tracking, visitor side.

   The console appears twice — full, with its result panel, on the landing
   page, and cut down in the header of every page. Both behave identically:
   submit, call GET /api/track/:number, render the result underneath. The
   header copy has no result container, so a lookup there sends the visitor to
   the landing page with the number in the query string, which is also what
   makes a tracking link emailable.
   ========================================================================= */

(function () {
  const helpers = window.PARAMOUNT || {};
  const view = window.PARAMOUNT_TRACK_VIEW;
  const $ = helpers.$ || ((sel, ctx = document) => ctx.querySelector(sel));
  const $$ = helpers.$$ || ((sel, ctx = document) => Array.from(ctx.querySelectorAll(sel)));
  const esc = (view && view.esc) || ((s) => String(s == null ? '' : s));

  const forms = $$('[data-track-form]');
  if (!forms.length || !view) return;

  const resultBox = $('[data-track-result]');
  const RECENT_KEY = 'pm-recent-tracking';

  /* ------------------------------------------------------------ storage --- */

  const recent = {
    read() {
      try {
        const raw = localStorage.getItem(RECENT_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.slice(0, 4) : [];
      } catch (e) {
        return [];
      }
    },
    add(number) {
      try {
        const list = [number, ...recent.read().filter((n) => n !== number)].slice(0, 4);
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      } catch (e) {
        /* private mode: recent numbers simply are not remembered */
      }
    },
  };

  function paintRecent() {
    const list = recent.read();
    $$('[data-track-recent]').forEach((box) => {
      box.hidden = !list.length;
      box.innerHTML = list
        .map((n) => `<button type="button" data-recall="${esc(n)}">${esc(n)}</button>`)
        .join('');
    });
  }

  function paint(html) {
    if (!resultBox) return;
    resultBox.innerHTML = html;
    resultBox.hidden = false;

    // The bar animates from zero, so it is set after the node is in the DOM.
    requestAnimationFrame(() => {
      $$('[data-progress]', resultBox).forEach((node) => {
        node.style.width = `${Math.max(3, Number(node.getAttribute('data-progress')) || 0)}%`;
      });
    });

    if (window.PARAMOUNT_OBSERVE) window.PARAMOUNT_OBSERVE(resultBox);
  }

  function paintError(message, title) {
    paint(`
      <div class="result-note bad" data-reveal>
        <strong>${esc(title || 'Not found')}</strong>
        <span class="muted">${esc(message)}</span>
        <span class="muted">Still stuck? <a class="link" href="/contact">Talk to the desk</a> — we can trace a consignment from the booking reference or the consignee address.</span>
      </div>`);
  }

  /* ------------------------------------------------------------- lookup --- */

  let inFlight = false;

  async function lookup(number, { push = true } = {}) {
    if (!number || inFlight) return;
    inFlight = true;

    $$('[data-track-error]').forEach((node) => (node.textContent = ''));
    $$('[data-track-submit]').forEach((btn) => {
      btn.disabled = true;
    });
    if (resultBox) {
      paint('<div class="result-note" data-reveal><strong>Looking it up…</strong><span class="muted">Reading the consignment file.</span></div>');
    }

    try {
      const data = await fetch(`/api/track/${encodeURIComponent(number)}`, {
        headers: { Accept: 'application/json' },
      });
      const body = await data.json().catch(() => ({}));

      if (!data.ok) {
        paintError(body.message || 'We could not look that up.', data.status === 404 ? 'No consignment found' : 'Check that number');
        return;
      }

      recent.add(body.shipment.tracking_number);
      paintRecent();
      paint(view.render(body.shipment));

      if (push && window.history && window.history.replaceState) {
        const url = `${window.location.pathname}?number=${encodeURIComponent(body.shipment.tracking_number)}#track`;
        window.history.replaceState({ number: body.shipment.tracking_number }, '', url);
      }
    } catch (err) {
      paintError('The tracking service did not answer. Check your connection and try again.', 'Service unavailable');
    } finally {
      inFlight = false;
      $$('[data-track-submit]').forEach((btn) => {
        btn.disabled = false;
      });
    }
  }

  /* --------------------------------------------------------------- wire --- */

  forms.forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('input[name="number"]', form);
      const number = (input ? input.value : '').trim();
      const errorNode = $('[data-track-error]', form);

      if (!number) {
        if (errorNode) errorNode.textContent = 'Enter a tracking number.';
        if (input) input.focus();
        return;
      }

      // On a page with nowhere to show a result — the header console on every
      // page but the landing page — the lookup happens on the landing page,
      // which is also the link people share.
      if (!resultBox) {
        window.location.href = `/?number=${encodeURIComponent(number)}#track`;
        return;
      }

      lookup(number);
      if (resultBox.scrollIntoView) {
        resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Recent numbers, and the sample in the hint, fill the box rather than
  // submitting on their own: the visitor stays in control of the lookup.
  document.addEventListener('click', (event) => {
    const recall = event.target.closest('[data-recall]');
    if (recall) {
      const number = recall.getAttribute('data-recall');
      $$('[data-track-form] input[name="number"]').forEach((input) => (input.value = number));
      lookup(number);
      return;
    }

    const copy = event.target.closest('[data-copy]');
    if (copy && navigator.clipboard) {
      navigator.clipboard.writeText(copy.getAttribute('data-copy')).then(
        () => {
          const original = copy.textContent;
          copy.textContent = 'Copied';
          setTimeout(() => (copy.textContent = original), 1600);
        },
        () => {}
      );
    }
  });

  paintRecent();

  // A number in the query string (an emailed tracking link, or a hand-off from
  // the landing page) is looked up on load.
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('number') || params.get('tracking');
  if (initial) {
    $$('[data-track-form] input[name="number"]').forEach((input) => (input.value = initial));
    lookup(initial, { push: false });
  }
})();
