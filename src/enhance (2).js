/**
 * Cafe Finder V2 — Enhancement Layer
 * --------------------------------------------------
 * This script is 100% additive. It never edits, wraps, or redefines any
 * function inside the original inline app script. Instead it:
 *   1. Reads a tiny read-only handle the original script exposes at the very
 *      end of its file: `window.CafeFinderInternal = { state, renderResults,
 *      addMarkers, showPlaceDetails }`. Nothing about how those functions
 *      work was changed — they're just referenced.
 *   2. Watches the existing DOM (#results, #detailsBody) with
 *      MutationObservers and layers new markup on top whenever the original
 *      code re-renders something.
 *   3. Adds brand-new UI (mode/profile/budget chips, compare bar, comparison
 *      modal) into empty space in the existing layout.
 *
 * If `window.CafeFinderInternal` / `window.CafeIntel` are missing for any
 * reason, this file quietly no-ops — the original app keeps working exactly
 * as before.
 */
(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function waitForHooks(cb, tries) {
    tries = tries || 0;
    if (window.CafeFinderInternal && window.CafeFinderInternal.state && window.CafeIntel) {
      return cb();
    }
    if (tries > 200) {
      console.warn('Cafe Finder V2 enhancements: required hooks not found — skipping (original app is unaffected).');
      return;
    }
    setTimeout(() => waitForHooks(cb, tries + 1), 50);
  }

  ready(function () {
    try {
      waitForHooks(initEnhancements);
    } catch (e) {
      console.warn('Cafe Finder V2 enhancements failed to start:', e);
    }
  });

  function initEnhancements() {
    const CFI = window.CafeFinderInternal;
    const Intel = window.CafeIntel;
    const state = CFI.state;

    let baseResults = [];
    let modeRenderInProgress = false;
    let activeMode = 'default';
    let activeProfile = null;
    let activeBudgetBracket = null;
    let pendingDashboardPlace = null;
    const compareMap = new Map();
    const cardPlaceMap = new WeakMap();

    safe(injectModePanel);
    safe(setupLayoutSync);
    safe(injectCompareBar);
    safe(injectComparisonModal);
    safe(observeResults);
    safe(observeDetailsModal);

    // ------------------------------------------------------------------
    // Layout fix: #searchSection is `position: fixed`, and the original
    // markup reserves space for it with a hardcoded `margin-top: 120px` on
    // #mainContent. Our new mode/profile/budget rows made the bar taller
    // than 120px, so without this it overlaps the map + results. Instead
    // of editing that inline style in index.html, we keep #mainContent's
    // offset in sync with the bar's *real* height at all times (initial
    // load, window resize, chip rows wrapping on narrow screens, etc).
    // ------------------------------------------------------------------
    function setupLayoutSync() {
      const searchSection = document.getElementById('searchSection');
      const mainContent = document.getElementById('mainContent');
      if (!searchSection || !mainContent) return;

      function sync() {
        if (searchSection.classList.contains('hidden')) return;
        const h = searchSection.offsetHeight;
        if (h > 0) mainContent.style.marginTop = h + 'px';
      }

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => sync());
        ro.observe(searchSection);
      }
      window.addEventListener('resize', sync);

      // Catch the hero -> main-content reveal (class toggle) and any late
      // font/layout settling.
      sync();
      setTimeout(sync, 50);
      setTimeout(sync, 300);
      setTimeout(sync, 1000);

      document.getElementById('startSearchBtn')?.addEventListener('click', () => {
        setTimeout(sync, 0);
        setTimeout(sync, 50);
      });
    }

    function safe(fn) {
      try { fn(); } catch (e) { console.warn('Cafe Finder V2 enhancement error:', e); }
    }

    // ------------------------------------------------------------------
    // UI injection
    // ------------------------------------------------------------------
    function injectModePanel() {
      const host = document.querySelector('#searchSection > div');
      if (!host || document.getElementById('cfModeRow')) return;

      const panel = document.createElement('div');
      panel.className = 'cf-panel';
      panel.innerHTML = `
        <div class="cf-panel-label">✨ I'm looking for a cafe to...</div>
        <div class="cf-chip-row" id="cfModeRow">
          <button type="button" class="cf-mode-btn active" data-mode="default">📍 Just Browse</button>
          <button type="button" class="cf-mode-btn" data-mode="study">📚 Study Mode</button>
          <button type="button" class="cf-mode-btn" data-mode="meeting">🤝 Meeting Mode</button>
        </div>
        <div class="cf-panel-label" style="margin-top:12px;">👤 I am a...</div>
        <div class="cf-chip-row" id="cfProfileRow">
          ${Object.keys(Intel.PROFILES).map(key => {
            const p = Intel.PROFILES[key];
            return `<button type="button" class="cf-profile-chip" data-profile="${key}">${p.emoji} ${p.label}</button>`;
          }).join('')}
        </div>
        <div class="cf-panel-label" style="margin-top:12px;">💰 Budget per person</div>
        <div class="cf-chip-row" id="cfBudgetRow">
          <button type="button" class="cf-budget-chip" data-bracket="under200">Under ₹200</button>
          <button type="button" class="cf-budget-chip" data-bracket="200-500">₹200–₹500</button>
          <button type="button" class="cf-budget-chip" data-bracket="500-1000">₹500–₹1000</button>
          <button type="button" class="cf-budget-chip" data-bracket="1000plus">₹1000+</button>
        </div>
      `;
      host.appendChild(panel);

      panel.querySelectorAll('.cf-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setMode(btn.getAttribute('data-mode')));
      });
      panel.querySelectorAll('.cf-profile-chip').forEach(btn => {
        btn.addEventListener('click', () => setProfile(btn.getAttribute('data-profile')));
      });
      panel.querySelectorAll('.cf-budget-chip').forEach(btn => {
        btn.addEventListener('click', () => setBudgetBracket(btn.getAttribute('data-bracket')));
      });
    }

    function injectCompareBar() {
      if (document.getElementById('cfCompareBar')) return;
      const bar = document.createElement('div');
      bar.id = 'cfCompareBar';
      bar.className = 'cf-compare-bar';
      bar.innerHTML = `
        <span id="cfCompareCount">Compare (0/3)</span>
        <button type="button" class="cf-cmp-view" id="cfCompareViewBtn">View Comparison</button>
        <button type="button" class="cf-cmp-clear" id="cfCompareClearBtn">Clear</button>
      `;
      document.body.appendChild(bar);
      document.getElementById('cfCompareViewBtn').addEventListener('click', openComparisonModal);
      document.getElementById('cfCompareClearBtn').addEventListener('click', clearCompare);
    }

    function injectComparisonModal() {
      if (document.getElementById('cfComparisonModal')) return;
      const modal = document.createElement('div');
      modal.id = 'cfComparisonModal';
      modal.className = 'fixed inset-0 hidden items-center justify-center z-50 bg-black/40 backdrop-blur-sm p-4';
      modal.innerHTML = `
        <div class="relative bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl border border-coffee-200 overflow-hidden flex flex-col">
          <div class="flex items-center justify-between px-6 py-5 border-b border-coffee-100 bg-gradient-to-r from-coffee-50 to-transparent">
            <h3 class="font-bold text-lg text-coffee-900">⚖️ Compare Cafes</h3>
            <button type="button" id="cfComparisonClose" class="p-2 rounded-lg hover:bg-coffee-100 transition text-coffee-600">✕</button>
          </div>
          <div id="cfComparisonBody" class="flex-1 overflow-auto p-6"></div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById('cfComparisonClose').addEventListener('click', () => modal.classList.add('hidden'));
      modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
    }

    // ------------------------------------------------------------------
    // Result card enhancement (score badges, budget, crowd, compare)
    // ------------------------------------------------------------------
    function observeResults() {
      const results = document.getElementById('results');
      if (!results) return;

      const obs = new MutationObserver(() => {
        if (!modeRenderInProgress) {
          baseResults = (state.lastResults || []).slice();
        }
        safe(enhanceVisibleCards);
      });
      obs.observe(results, { childList: true });

      // Delegated click: remember which place's details are being opened so
      // the dashboard observer below knows what to render.
      results.addEventListener('click', e => {
        const card = e.target.closest('.result-card');
        if (!card) return;
        const place = cardPlaceMap.get(card);
        if (place) pendingDashboardPlace = place;
      });

      baseResults = (state.lastResults || []).slice();
      safe(enhanceVisibleCards);
    }

    function enhanceVisibleCards() {
      const cards = Array.from(document.querySelectorAll('#results .result-card'));
      const places = state.lastResults || [];
      cards.forEach((card, i) => {
        if (card.dataset.cfEnhanced) return;
        const place = places[i];
        if (!place) return;
        cardPlaceMap.set(card, place);
        safe(() => enhanceCard(card, place));
        card.dataset.cfEnhanced = '1';
      });
    }

    function enhanceCard(card, place) {
      const inner = card.querySelector('.min-w-0.flex-1');
      if (!inner) return;

      const scores = Intel.scoreCafe(place);
      const overall = Intel.overallScore(scores);
      const tags = Intel.bestForTags(scores, 2);
      const budget = Intel.estimateBudget(place);
      const crowd = Intel.predictCrowd(place);
      const level = overall >= 80 ? 'high' : overall >= 60 ? 'mid' : 'low';

      const block = document.createElement('div');
      block.className = 'cf-card-block';
      block.innerHTML = `
        <div class="cf-bestfor-row">
          <span class="cf-overall-ring lvl-${level}" title="AI overall recommendation score">⭐ ${overall}</span>
          ${tags.map(t => `<span class="cf-bestfor-tag">${t.emoji} ${escapeHtml(t.label.replace('Best For ', ''))}</span>`).join('')}
        </div>
        <div class="cf-meta-row">
          <span>💰 ~₹${budget.avgCostPerPerson}/person</span>
          <span>${crowd.current.emoji} ${crowd.current.level} now</span>
        </div>
        <div class="cf-actions-row">
          <label class="cf-compare-label">
            <input type="checkbox" class="cf-compare-checkbox" />
            Compare
          </label>
          <button type="button" class="cf-insights-btn">View AI Insights →</button>
        </div>
      `;
      inner.appendChild(block);

      const checkbox = block.querySelector('.cf-compare-checkbox');
      checkbox.addEventListener('change', () => toggleCompare(place, checkbox));

      block.querySelector('.cf-insights-btn').addEventListener('click', () => {
        pendingDashboardPlace = place;
        if (place.place_id && typeof CFI.showPlaceDetails === 'function') {
          CFI.showPlaceDetails(place.place_id, place.name);
        }
      });
    }

    // ------------------------------------------------------------------
    // Modes / Profiles / Budget brackets — all re-use the ORIGINAL
    // renderResults()/addMarkers() so cards/markers look & behave exactly
    // like a normal search result, just re-ordered or filtered.
    // ------------------------------------------------------------------
    function currentOrigin() {
      if (state.userLocation) return state.userLocation;
      try { return state.map.getCenter().toJSON(); } catch (e) { return { lat: 28.6139, lng: 77.2090 }; }
    }

    function applyResults(list) {
      modeRenderInProgress = true;
      try {
        if (typeof CFI.renderResults === 'function') CFI.renderResults(list, currentOrigin());
        if (typeof CFI.addMarkers === 'function') CFI.addMarkers(list);
      } finally {
        setTimeout(() => { modeRenderInProgress = false; }, 80);
      }
    }

    function setMode(mode) {
      activeMode = mode;
      document.querySelectorAll('#cfModeRow .cf-mode-btn').forEach(b =>
        b.classList.toggle('active', b.getAttribute('data-mode') === mode));
      recompute();
    }

    function setProfile(profileKey) {
      activeProfile = (activeProfile === profileKey) ? null : profileKey;
      document.querySelectorAll('#cfProfileRow .cf-profile-chip').forEach(b =>
        b.classList.toggle('active', b.getAttribute('data-profile') === activeProfile));
      recompute();
    }

    function setBudgetBracket(bracket) {
      activeBudgetBracket = (activeBudgetBracket === bracket) ? null : bracket;
      document.querySelectorAll('#cfBudgetRow .cf-budget-chip').forEach(b =>
        b.classList.toggle('active', b.getAttribute('data-bracket') === activeBudgetBracket));
      recompute();
    }

    function recompute() {
      if (!baseResults.length) return;
      let list = baseResults.slice();

      if (activeBudgetBracket) {
        list = list.filter(p => Intel.matchesBudgetBracket(Intel.estimateBudget(p), activeBudgetBracket));
      }

      if (activeMode === 'study') {
        list = list
          .filter(p => Intel.scoreCafe(p).student >= 50)
          .sort((a, b) => Intel.scoreCafe(b).student - Intel.scoreCafe(a).student);
      } else if (activeMode === 'meeting') {
        list = list
          .filter(p => Intel.scoreCafe(p).meeting >= 50)
          .sort((a, b) => Intel.scoreCafe(b).meeting - Intel.scoreCafe(a).meeting);
      } else if (activeProfile) {
        const key = Intel.PROFILES[activeProfile].primaryScore;
        list = list.slice().sort((a, b) => Intel.scoreCafe(b)[key] - Intel.scoreCafe(a)[key]);
      }

      applyResults(list);
    }

    // ------------------------------------------------------------------
    // Comparison tool
    // ------------------------------------------------------------------
    function toggleCompare(place, checkbox) {
      const key = place.place_id || place.name;
      if (checkbox.checked) {
        if (compareMap.size >= 3) {
          checkbox.checked = false;
          window.alert('You can compare up to 3 cafes at a time.');
          return;
        }
        compareMap.set(key, place);
      } else {
        compareMap.delete(key);
      }
      updateCompareBar();
    }

    function updateCompareBar() {
      const bar = document.getElementById('cfCompareBar');
      const count = document.getElementById('cfCompareCount');
      if (!bar || !count) return;
      count.textContent = `Compare (${compareMap.size}/3)`;
      bar.classList.toggle('visible', compareMap.size >= 2);
    }

    function clearCompare() {
      compareMap.clear();
      document.querySelectorAll('.cf-compare-checkbox').forEach(cb => { cb.checked = false; });
      updateCompareBar();
      const modal = document.getElementById('cfComparisonModal');
      if (modal) modal.classList.add('hidden');
    }

    function openComparisonModal() {
      if (compareMap.size < 2) return;
      const cafes = Array.from(compareMap.values());

      const rows = [
        { label: '💻 Work', get: p => Intel.scoreCafe(p).work },
        { label: '📚 Student', get: p => Intel.scoreCafe(p).student },
        { label: '❤️ Date', get: p => Intel.scoreCafe(p).date },
        { label: '🤝 Meeting', get: p => Intel.scoreCafe(p).meeting },
        { label: '👨‍👩‍👧‍👦 Family', get: p => Intel.scoreCafe(p).family },
        { label: '👥 Group', get: p => Intel.scoreCafe(p).group },
        { label: '💰 Budget', get: p => { const b = Intel.estimateBudget(p); return `${b.symbol} ~₹${b.avgCostPerPerson}`; } },
        { label: '⭐ Rating', get: p => (p.rating != null ? p.rating.toFixed(1) : 'N/A') },
        { label: '📍 Distance', get: p => (p.distanceMeters != null ? (p.distanceMeters < 1000 ? Math.round(p.distanceMeters) + ' m' : (p.distanceMeters / 1000).toFixed(1) + ' km') : '—') },
        { label: '👥 Crowd Now', get: p => { const c = Intel.predictCrowd(p); return `${c.current.emoji} ${c.current.level}`; } }
      ];

      function scoreColor(v) {
        if (typeof v !== 'number') return 'inherit';
        return v >= 80 ? 'var(--cf-green)' : v >= 60 ? 'var(--cf-amber)' : '#9ca3af';
      }

      const headHtml = cafes.map(c => `<th>${escapeHtml(c.name || 'Cafe')}</th>`).join('');
      const bodyHtml = rows.map(r => `
        <tr>
          <td class="cf-cmp-name">${r.label}</td>
          ${cafes.map(c => {
            const v = r.get(c);
            const isScore = typeof v === 'number';
            return `<td ${isScore ? `class="cf-cmp-score" style="color:${scoreColor(v)}"` : ''}>${v}</td>`;
          }).join('')}
        </tr>
      `).join('');

      const body = document.getElementById('cfComparisonBody');
      const modal = document.getElementById('cfComparisonModal');
      if (!body || !modal) return;
      body.innerHTML = `<table><thead><tr><th>Feature</th>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    // ------------------------------------------------------------------
    // Insight Dashboard — appended inside the EXISTING details modal,
    // after the original modal content is rendered. We never overwrite or
    // remove the original content, only append to it.
    // ------------------------------------------------------------------
    function observeDetailsModal() {
      const body = document.getElementById('detailsBody');
      const modal = document.getElementById('detailsModal');
      if (!body || !modal) return;

      const obs = new MutationObserver(() => {
        if (modal.classList.contains('hidden')) return;
        if (body.querySelector('.cf-dashboard')) return; // already appended for this open
        if (!pendingDashboardPlace) return;
        safe(() => appendDashboard(body, pendingDashboardPlace));
      });
      obs.observe(body, { childList: true });

      const reset = () => { pendingDashboardPlace = null; };
      document.getElementById('detailsClose')?.addEventListener('click', reset);
      modal.addEventListener('click', e => { if (e.target === modal) reset(); });
    }

    function appendDashboard(body, place) {
      const wrap = document.createElement('div');
      wrap.className = 'cf-dashboard';
      wrap.innerHTML = `
        <div class="cf-dashboard-title">✨ AI Insight Dashboard</div>
        <div style="font-size:13px;color:var(--cf-coffee-600,#8b5e42);">Crunching the numbers…</div>
      `;
      body.appendChild(wrap);

      const fields = ['place_id', 'name', 'rating', 'user_ratings_total', 'price_level', 'types', 'reviews'];
      if (state.placesService && place.place_id) {
        state.placesService.getDetails({ placeId: place.place_id, fields }, (full, status) => {
          const ok = window.google && window.google.maps && status === window.google.maps.places.PlacesServiceStatus.OK;
          renderDashboard(wrap, ok && full ? full : place);
        });
      } else {
        renderDashboard(wrap, place);
      }
    }

    function renderDashboard(container, place) {
      const scores = Intel.scoreCafe(place);
      const overall = Intel.overallScore(scores);
      const allTags = Intel.bestForTags(scores, 6);
      const topTags = allTags.slice(0, 2);
      const budget = Intel.estimateBudget(place);
      const crowd = Intel.predictCrowd(place);
      const menu = Intel.generateMenuHighlights(place);
      const summaryData = Intel.summarizeReviews(place);
      const stars = Intel.ratingBreakdown(place);
      const now = new Date();
      const nowPct = ((now.getHours() + now.getMinutes() / 60) / 24) * 100;

      const barColor = v => (v >= 80 ? 'var(--cf-green)' : v >= 60 ? 'var(--cf-amber)' : '#9ca3af');

      const scoreRowsHtml = allTags.map(t => `
        <div class="cf-score-bar-row">
          <span class="lbl">${t.emoji} ${escapeHtml(t.label.replace('Best For ', ''))}</span>
          <span class="cf-score-bar-track"><span class="cf-score-bar-fill" style="width:${t.score}%; background:${barColor(t.score)};"></span></span>
          <span class="cf-score-bar-val">${t.score}</span>
        </div>
      `).join('');

      const peakBlocksHtml = crowd.peak.windows.map(w => {
        const left = (w.startHour / 24) * 100;
        const width = ((w.endHour - w.startHour) / 24) * 100;
        return `<div class="cf-peak-block" style="left:${left}%; width:${width}%;"></div>`;
      }).join('');

      const starsHtml = stars.map(s => `
        <div class="cf-stars-row">
          <span class="lbl">${s.star}★</span>
          <span class="cf-score-bar-track"><span class="cf-score-bar-fill" style="width:${s.pct}%; background:var(--cf-coffee-600);"></span></span>
          <span class="pct">${s.pct}%</span>
        </div>
      `).join('');

      const level = overall >= 80 ? 'high' : overall >= 60 ? 'mid' : 'low';

      container.innerHTML = `
        <div class="cf-dashboard-title">✨ AI Insight Dashboard</div>
        <div class="cf-bestfor-row" style="margin-bottom:14px;">
          <span class="cf-overall-ring lvl-${level}">⭐ Overall ${overall}/100</span>
          ${topTags.map(t => `<span class="cf-bestfor-tag">${t.emoji} Best for ${escapeHtml(t.label.replace('Best For ', ''))}</span>`).join('')}
        </div>

        <div class="cf-dash-grid">
          <div class="cf-score-card">
            <h5>Category Scores</h5>
            ${scoreRowsHtml}
          </div>
          <div class="cf-score-card">
            <h5>Rating Breakdown (estimated)</h5>
            ${starsHtml}
          </div>
        </div>

        <div class="cf-dash-grid">
          <div class="cf-score-card">
            <h5>Peak Hours</h5>
            <div class="cf-peak-track">
              ${peakBlocksHtml}
              <div class="cf-peak-now-marker" style="left:${nowPct}%;"></div>
            </div>
            <div class="cf-peak-legend"><span>12 AM</span><span>12 PM</span><span>11 PM</span></div>
            <div style="font-size:12.5px; margin-top:8px; color:var(--cf-coffee-700);">
              Best time to visit: <strong>${crowd.peak.bestWindow.label}</strong>
            </div>
          </div>
          <div class="cf-score-card">
            <h5>Crowd Prediction</h5>
            <div class="cf-crowd-grid">
              <div class="cf-crowd-cell"><div class="t">Now</div><div class="v">${crowd.current.emoji} ${crowd.current.level}</div></div>
              <div class="cf-crowd-cell"><div class="t">In 1 hr</div><div class="v">${crowd.in1h.emoji} ${crowd.in1h.level}</div></div>
              <div class="cf-crowd-cell"><div class="t">In 3 hrs</div><div class="v">${crowd.in3h.emoji} ${crowd.in3h.level}</div></div>
            </div>
          </div>
        </div>

        <div class="cf-dash-grid">
          <div class="cf-score-card">
            <h5>Top Picks (Most Ordered)</h5>
            <div class="cf-pill-row">${menu.topPicks.map(i => `<span class="cf-item-pill">${escapeHtml(i)}</span>`).join('')}</div>
          </div>
          <div class="cf-score-card">
            <h5>Must Try (Signature)</h5>
            <div class="cf-pill-row">${menu.mustTry.map(i => `<span class="cf-item-pill signature">✓ ${escapeHtml(i)}</span>`).join('')}</div>
          </div>
        </div>

        <div class="cf-score-card" style="margin-bottom:14px;">
          <h5>💰 Budget</h5>
          <div style="font-size:13px; color:var(--cf-coffee-700);">${budget.symbol} ${budget.label} • ~₹${budget.avgCostPerPerson} per person (typical range ${budget.rangeLabel})</div>
        </div>

        <div class="cf-summary-box">${escapeHtml(summaryData.summary)}</div>

        <div class="cf-heuristic-note">Scores, crowd levels, peak hours and menu highlights are AI/heuristic estimates based on rating, price and available reviews — not live data.</div>
      `;
    }

    function escapeHtml(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }
})();
