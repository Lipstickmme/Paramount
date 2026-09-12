'use strict';

/* One discipline, resolved from the path so /services/steel is a real URL. */
(function () {
  const M = window.MERKEL; if (!M) return;
  const root = document.getElementById('service-detail');
  if (!root) return;
  const esc = M.esc;

  const id = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');

  function render(s, projects) {
    document.title = `${s.title} | Merkel Constructions`;
    const related = projects.filter((p) => (p.services || []).includes(s.title)).slice(0, 3);

    root.removeAttribute('data-loading');
    root.innerHTML = `
      <header class="page-header">
        <div class="wrap page-header-grid">
          <div class="page-header-copy">
            <span class="eyebrow">${esc(s.code)} / Services</span>
            <h1 data-reveal>${esc(s.title)}</h1>
            <p data-reveal>${esc(s.lede || s.summary)}</p>
          </div>
          <figure class="figure page-header-figure" data-reveal>
            <img src="${esc(s.image)}" alt="${esc(s.title)}" decoding="async" />
          </figure>
        </div>
      </header>

      <section class="section-pad">
        <div class="wrap project-cols">
          <div class="overview" data-reveal>
            ${(s.body || [s.summary]).map((para) => `<p>${esc(para)}</p>`).join('')}
          </div>
          <aside data-reveal>
            <div class="project-facts">
              ${(s.deliverables || []).map((d) => `<div class="fact"><span class="k">Deliverable</span><span class="v">${esc(d)}</span></div>`).join('')}
            </div>
            <div class="project-services">
              ${(s.capabilities || []).map((c) => `<span>${esc(c)}</span>`).join('')}
            </div>
          </aside>
        </div>
      </section>

      ${related.length ? `
      <section class="section-pad alt">
        <div class="wrap">
          <div class="section-head" data-reveal>
            <span class="eyebrow">Where it shows</span>
            <h2>Projects using this discipline.</h2>
          </div>
          <div class="cards-grid" data-reveal>${related.map(M.projectCard).join('')}</div>
        </div>
      </section>` : ''}

      <section class="cta-band">
        <div class="wrap cta-inner" data-reveal>
          <h2>Need this on a project?</h2>
          <p>Send the drawing set or a paragraph on the site and a principal engineer will come back to you.</p>
          <a href="/contact" class="btn">Contact us <span class="arw">&rsaquo;</span></a>
        </div>
      </section>`;
    M.observeReveals();
  }

  (async () => {
    try {
      const [service, list] = await Promise.all([
        M.fetchJSON(`/api/services/${encodeURIComponent(id)}`),
        M.fetchJSON('/api/projects').catch(() => ({ projects: [] })),
      ]);
      render(service, list.projects || []);
    } catch (err) {
      root.removeAttribute('data-loading');
      root.innerHTML = `
        <section class="notfound">
          <div class="wrap">
            <span class="eyebrow">Not found</span>
            <h1>No such service.</h1>
            <p>That discipline is not one of ours, or the link has changed.</p>
            <div class="hero-actions"><a href="/services" class="btn">All services <span class="arw">&rsaquo;</span></a></div>
          </div>
        </section>`;
    }
  })();
})();
