'use strict';

(function () {
  const M = window.MERKEL; if (!M) return;
  const root = document.getElementById('project-detail');
  if (!root) return;
  const esc = M.esc;
  const id = decodeURIComponent(location.pathname.replace(/\/+$/, '').split('/').pop() || '');

  function notFound() {
    root.innerHTML = `
      <section class="notfound"><div class="wrap">
        <span class="eyebrow">Not found</span>
        <h1>Project not found.</h1>
        <p>That project is not in our records. Browse the full list instead.</p>
        <div class="hero-actions"><a href="/projects" class="btn">All projects <span class="arw">&rsaquo;</span></a></div>
      </div></section>`;
  }

  function render(project, next) {
    document.title = project.name + ' | Merkel Constructions';
    const facts = (project.facts || []).map((f) => `<div class="fact"><span class="k">${esc(f.k)}</span><span class="v">${esc(f.v)}</span></div>`).join('');
    const services = (project.services || []).map((s) => `<span>${esc(s)}</span>`).join('');
    root.innerHTML = `
      <header class="page-header project-hero">
        <div class="wrap page-header-grid">
          <div class="page-header-copy">
            <span class="eyebrow">${esc(project.sector)} project</span>
            <h1>${esc(project.name)}</h1>
            <div class="meta-row">
              <span class="sector">${esc(project.location)}</span>
              <span>${esc(project.status || project.year)}</span>
              ${project.client ? `<span>Client: ${esc(project.client)}</span>` : ''}
              ${project.duration ? `<span>${esc(project.duration)}</span>` : ''}
            </div>
          </div>
          <figure class="figure page-header-figure">
            <img src="${esc(project.image)}" alt="${esc(project.name)}" decoding="async" />
          </figure>
        </div>
      </header>
      <section class="project-body"><div class="wrap project-cols">
        <div class="overview">
          <p>${esc(project.overview || project.blurb)}</p>
          ${services ? `<div class="project-services">${services}</div>` : ''}
        </div>
        <aside>
          <div class="project-facts">${facts}</div>
        </aside>
      </div></section>
      <nav class="project-next"><div class="wrap"><a href="/projects/${esc(next.id)}">
        <span><span class="lbl">Next project</span><br><span class="nm">${esc(next.name)}</span></span>
        <span class="arw">&rsaquo;</span>
      </a></div></nav>
      <section class="cta-band">
        <div class="wrap cta-inner"><h2>Have a project like this?</h2><p>Tell us what you are building and where it gets difficult.</p><a href="/contact" class="btn">Contact us <span class="arw">&rsaquo;</span></a></div>
      </section>`;
    M.observeReveals();
  }

  (async () => {
    if (!id) return notFound();
    try {
      const d = await M.fetchJSON('/api/projects/' + encodeURIComponent(id));
      render(d.project, d.next || { id: 'helix-tower', name: 'Helix Tower' });
    } catch (e) { notFound(); }
  })();
})();
