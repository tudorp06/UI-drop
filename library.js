// ============================================================
// UIDrop — library.js  (Snap Library)
// ============================================================

let allSnaps          = [];
let filteredSnaps     = [];
let selectedIds       = new Set();
let compareModeOn     = false;
let viewMode          = 'grid';
let starredOnly       = false;
let activeTags        = new Set();
let activeCollectionId= null;           // null = "All snaps"
let collections       = [];             // [{id, name, color}]

const COLL_COLORS = ['#8a6dff','#5b8def','#ff6b2b','#10b981','#f59e0b','#ec4899'];

// ── Trial gate (replaces ExtensionPay) ───────────────────────
// Library is now free for everyone. Polar.sh license unlocks unlimited Pro features.
// See gate.js for the trial counter + paywall logic.

// ── Init ────────────────────────────────────────────────────
async function init() {
    // Initialise the trial-bar + paywall listeners
    if (window.UIDropGate?.initGate) window.UIDropGate.initGate();

    // Library content loads for everyone now — trial counters enforce the limits
    const { snapHistory = [] } = await chrome.storage.local.get('snapHistory');
    allSnaps = snapHistory;

    // Auto-tag any snaps that have no tags yet
    let needsSave = false;
    allSnaps.forEach(s => {
        if (!s.tags) { s.tags = autoTags(s); needsSave = true; }
    });
    if (needsSave) await chrome.storage.local.set({ snapHistory: allSnaps });

    filteredSnaps = [...allSnaps];

    await loadCollections();
    renderCollectionsBar();
    renderTagFilterBar();
    renderGrid();

    document.getElementById('searchInput')      .addEventListener('input',  onSearch);
    document.getElementById('compareModeBtn')   .addEventListener('click',  toggleCompareMode);
    document.getElementById('cancelCompareMode').addEventListener('click',  exitCompareMode);
    // Gate: Compare consumes 1 use only when the user actually opens the comparison view
    document.getElementById('goCompare')        .addEventListener('click',  () => window.UIDropGate.gate('compare', openCompare));
    document.getElementById('backBtn')          .addEventListener('click',  backToGrid);
    document.getElementById('detailBackBtn')    .addEventListener('click',  closeDetail);
    document.getElementById('starFilterBtn')    .addEventListener('click',  toggleStarFilter);
    document.getElementById('viewToggleBtn')    .addEventListener('click',  toggleViewMode);
    // Gate: Insights modal
    document.getElementById('insightsBtn')      .addEventListener('click',  () => window.UIDropGate.gate('insights', showInsightsModal));
    document.getElementById('randomSnapBtn')   ?.addEventListener('click',  openRandomSnap);

    // Attach trial badges to the gated topbar buttons
    window.UIDropGate.attachTrialBadge(document.getElementById('compareModeBtn'), 'compare');
    window.UIDropGate.attachTrialBadge(document.getElementById('insightsBtn'), 'insights');
    document.getElementById('insightsClose')    .addEventListener('click',  () => document.getElementById('insightsModal').classList.add('hidden'));
    document.getElementById('insightsModal')    .addEventListener('click',  e => { if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden'); });

    // Collections bar controls
    document.getElementById('collAddBtn').addEventListener('click', () => {
        const wrap = document.getElementById('collCreateWrap');
        wrap.classList.toggle('visible');
        if (wrap.classList.contains('visible')) document.getElementById('collCreateInput').focus();
    });
    document.getElementById('collCreateOk').addEventListener('click', commitNewCollection);
    document.getElementById('collCreateInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') commitNewCollection();
        if (e.key === 'Escape') document.getElementById('collCreateWrap').classList.remove('visible');
    });
}

// Legacy showPayGate() removed — ExtPay gone, new gate.js + paywall modal in library.html handle it.

// ── Search ───────────────────────────────────────────────────
function onSearch(e) {
    applyFilters(e.target.value.trim().toLowerCase());
}

function applyFilters(q = document.getElementById('searchInput').value.trim().toLowerCase()) {
    let base = [...allSnaps];
    if (starredOnly)           base = base.filter(s => s.starred);
    if (activeCollectionId)    base = base.filter(s => s.collectionId === activeCollectionId);
    if (activeTags.size)       base = base.filter(s => [...activeTags].every(t => (s.tags||[]).includes(t)));
    if (q) base = base.filter(s =>
        s.siteName?.toLowerCase().includes(q) ||
        s.pageTitle?.toLowerCase().includes(q) ||
        (s.tags||[]).some(t => t.includes(q)) ||
        s.recommendation?.some(r => r.type?.toLowerCase().includes(q))
    );
    filteredSnaps = base;
    renderGrid();
}

function toggleStarFilter() {
    starredOnly = !starredOnly;
    const btn = document.getElementById('starFilterBtn');
    btn.classList.toggle('active', starredOnly);
    applyFilters();
}

function toggleViewMode() {
    viewMode = viewMode === 'grid' ? 'moodboard' : 'grid';
    const btn = document.getElementById('viewToggleBtn');
    btn.classList.toggle('active', viewMode === 'moodboard');
    // Update icon
    btn.querySelector('.view-icon-grid').classList.toggle('hidden', viewMode === 'moodboard');
    btn.querySelector('.view-icon-mood').classList.toggle('hidden', viewMode === 'grid');
    renderGrid();
}

// ── Grid ─────────────────────────────────────────────────────
function renderGrid() {
    const grid  = document.getElementById('snapGrid');
    const empty = document.getElementById('emptyState');
    const count = document.getElementById('snapCount');

    count.textContent = filteredSnaps.length
        ? `${filteredSnaps.length} snap${filteredSnaps.length !== 1 ? 's' : ''}`
        : '';

    if (!filteredSnaps.length) {
        grid.innerHTML = '';
        grid.className = 'snap-grid';
        empty.classList.remove('hidden');
        return;
    }
    empty.classList.add('hidden');

    if (viewMode === 'moodboard') {
        grid.className = 'moodboard-grid';
        grid.innerHTML = filteredSnaps.map(moodboardCardHTML).join('');
        grid.querySelectorAll('.moodboard-card').forEach(card => {
            const id = card.dataset.id;
            card.querySelector('.mb-star').addEventListener('click', e => {
                e.stopPropagation();
                toggleStar(id);
            });
            card.addEventListener('click', () => openDetail(id));
        });
        return;
    }

    grid.className = 'snap-grid';
    // Pinned snaps always float to the top
    const sorted = [...filteredSnaps].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    grid.innerHTML = sorted.map(snapCardHTML).join('');

    grid.querySelectorAll('.snap-card').forEach(card => {
        const id = card.dataset.id;
        card.querySelector('.snap-star').addEventListener('click', e => { e.stopPropagation(); toggleStar(id); });
        card.querySelector('.snap-del') .addEventListener('click', e => { e.stopPropagation(); deleteSnap(id); });
        card.querySelector('.snap-check').addEventListener('click', e => { e.stopPropagation(); if (compareModeOn) toggleSelect(id); });
        card.querySelector('.snap-pin') ?.addEventListener('click', e => { e.stopPropagation(); togglePin(id); });

        // Quick-copy button
        const qcBtn = card.querySelector('.snap-qc-btn');
        if (qcBtn) {
            qcBtn.addEventListener('click', e => {
                e.stopPropagation();
                const snap = allSnaps.find(s => s.id === id);
                const hex  = snap?.schema?.primaryColor;
                if (!hex) return;
                navigator.clipboard.writeText(hex).then(() => {
                    qcBtn.textContent = '✓';
                    qcBtn.classList.add('copied');
                    setTimeout(() => { qcBtn.textContent = 'Copy'; qcBtn.classList.remove('copied'); }, 1400);
                });
            });
        }

        // Action chip row
        card.querySelectorAll('.snap-action').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const act = btn.dataset.act;
                if (act === 'open')   return openDetail(id);
                if (act === 'del')    return deleteSnap(id);
                if (act === 'export') return openDetail(id);
                if (act === 'visit') {
                    const url = btn.dataset.url;
                    if (url) chrome.tabs.create({ url });
                    return;
                }
                if (act === 'copyhex') {
                    const hex = btn.dataset.hex;
                    if (!hex) return;
                    navigator.clipboard.writeText(hex).then(() => {
                        const orig = btn.innerHTML;
                        btn.classList.add('copied');
                        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied';
                        setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = orig; }, 1400);
                    });
                }
            });
        });

        card.addEventListener('click', () => {
            if (compareModeOn) toggleSelect(id);
            else openDetail(id);
        });
    });
}

function snapCardHTML(snap) {
    const isSelected = selectedIds.has(snap.id);
    const date = new Date(snap.timestamp).toLocaleDateString('en-US', {
        month:'short', day:'numeric', year:'numeric'
    });
    const recs = snap.recommendation || [];
    const palette = [
        snap.schema?.primaryColor,
        snap.schema?.accentColor,
        snap.schema?.surfaceColor,
        snap.schema?.textColor,
        snap.schema?.mutedText,
    ].filter(isHex);

    const primaryColor = snap.schema?.primaryColor || null;
    const thumbInner = snap.thumbnail
        ? `<img class="snap-thumb" src="${snap.thumbnail}" alt="${escHtml(snap.siteName)}" loading="lazy"/>`
        : `<div class="snap-thumb-ph">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
           </div>`;

    const thumbHTML = `
      <div class="snap-thumb-wrap">
        ${thumbInner}
        ${primaryColor ? `
        <div class="snap-quick-copy">
          <div class="snap-qc-dot" style="background:${primaryColor}"></div>
          <span class="snap-qc-hex">${primaryColor.toUpperCase()}</span>
          <button class="snap-qc-btn">Copy</button>
        </div>` : ''}
      </div>`;

    const tagsHTML = (snap.tags||[]).length
        ? `<div class="snap-tags">${snap.tags.map(t => `<span class="snap-tag">${escHtml(t)}</span>`).join('')}</div>`
        : '';

    return `
    <div class="snap-card${isSelected ? ' selected' : ''}${snap.pinned ? ' pinned' : ''}" data-id="${snap.id}">
      ${thumbHTML}
      <button class="snap-del" title="Remove snap">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
        </svg>
      </button>
      <div class="snap-check">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <button class="snap-pin${snap.pinned ? ' on' : ''}" title="${snap.pinned ? 'Unpin' : 'Pin to top'}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="${snap.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v3.76z"/></svg>
      </button>
      <div class="snap-body">
        <div class="snap-site-row">
          <div class="snap-site">${escHtml(snap.siteName || 'Unknown site')}</div>
          <button class="snap-star${snap.starred ? ' on' : ''}" title="Favourite">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${snap.starred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>
        <div class="snap-meta">${[date, ...(snap.tags||[]).slice(0,2)].join(' · ')}</div>
        <div class="snap-palette">
          ${palette.map(c => `<div class="snap-swatch" style="background:${c}" title="${c}"></div>`).join('')}
        </div>
        <div class="snap-actions">
          ${primaryColor ? `
          <button class="snap-action" data-act="copyhex" data-hex="${primaryColor}" title="Copy primary color">
            <span style="width:9px;height:9px;border-radius:2px;background:${primaryColor};border:1px solid rgba(255,255,255,.15)"></span>
            Copy hex
          </button>` : ''}
          <button class="snap-action" data-act="visit" data-url="${escHtml(snap.url || '')}" title="Open original site">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            Visit
          </button>
          <button class="snap-action danger" data-act="del" title="Delete snap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
            Remove
          </button>
        </div>
      </div>
    </div>`;
}

// ── Compare mode ─────────────────────────────────────────────
function toggleCompareMode() {
    compareModeOn ? exitCompareMode() : enterCompareMode();
}

function enterCompareMode() {
    compareModeOn = true;
    document.body.classList.add('compare-mode');
    document.getElementById('compareModeBtn').classList.add('active');
    selectedIds.clear();
    updateHintBar();
    renderGrid();
}

function exitCompareMode() {
    compareModeOn = false;
    document.body.classList.remove('compare-mode');
    document.getElementById('compareModeBtn').classList.remove('active');
    selectedIds.clear();
    document.getElementById('compareHint').classList.remove('visible');
    renderGrid();
}

function toggleSelect(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        if (selectedIds.size >= 2) {
            const [first] = selectedIds;
            selectedIds.delete(first);
        }
        selectedIds.add(id);
    }
    updateHintBar();
    renderGrid();
}

function updateHintBar() {
    const hint  = document.getElementById('compareHint');
    const count = document.getElementById('hintCount');
    const goBtn = document.getElementById('goCompare');

    hint.classList.toggle('visible', compareModeOn);
    count.textContent = selectedIds.size;
    goBtn.disabled = selectedIds.size < 2;
}

// ── Detail view (single snap) ─────────────────────────────────
function openDetail(id) {
    const snap = allSnaps.find(x => x.id === id);
    if (!snap) return;

    const date = new Date(snap.timestamp).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
    });
    const detailTitle = document.getElementById('detailTitle');
    detailTitle.textContent = snap.siteName || 'Unknown site';
    document.getElementById('detailSubtitle').textContent = date;

    // Render the panel (passing empty object as "other" so no diff highlighting)
    document.getElementById('detailPanel').innerHTML =
        panelHTML(snap, {}) +
        `<div class="detail-actions">
           <!-- Tag management -->
           <div class="detail-tag-section">
             <div class="detail-tag-label">Tags</div>
             <div class="detail-tags-row" id="detailTagsRow"></div>
             <div class="detail-tag-input-wrap">
               <input class="detail-tag-input" id="detailTagInput" placeholder="Add a tag…" maxlength="24"/>
               <button class="detail-tag-add" id="detailTagAdd">+ Add</button>
             </div>
             ${collections.length ? `
             <div class="detail-tag-label" style="margin-top:4px;">Move to collection</div>
             <select class="detail-coll-select" id="detailCollSelect">
               <option value="">— No collection —</option>
               ${collections.map(c => `<option value="${c.id}"${snap.collectionId === c.id ? ' selected' : ''}>${escHtml(c.name)}</option>`).join('')}
             </select>` : ''}
           </div>

           <div class="detail-export-label" style="margin-top:16px;">Export as</div>
           <div class="detail-export-row">
             <button class="detail-export-btn" id="detailExportFigma">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="9" height="9" rx="2"/><rect x="13" y="2" width="9" height="9" rx="2"/><rect x="2" y="13" width="9" height="9" rx="2"/><circle cx="17.5" cy="17.5" r="4.5"/></svg>
               Figma Tokens
             </button>
             <button class="detail-export-btn" id="detailExportCSS">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
               CSS Vars
             </button>
             <button class="detail-export-btn" id="detailExportCanva">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/></svg>
               Canva
             </button>
             <button class="detail-export-btn" id="detailExportPoster">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5-4 4-2-2-5 5"/></svg>
               Poster PNG
             </button>
             <button class="detail-export-btn" id="detailExportTailwind">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s2-6 8-6 7 4 10 4 4-2 4-2-2 6-8 6-7-4-10-4-4 2-4 2z"/></svg>
               Tailwind
             </button>
             <button class="detail-export-btn" id="detailExportShadcn">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4l-8 16"/><path d="M3 10h6"/><path d="M15 14h6"/></svg>
               shadcn/ui
             </button>
           </div>
           <div class="detail-send-header">
             <span class="detail-send-label">Send to</span>
             <div class="detail-format-toggle" id="detailFormatToggle" role="tablist">
               <button class="dfmt-opt dfmt-active" data-mode="brief">Prompt</button>
               <button class="dfmt-opt" data-mode="skill">system.md</button>
             </div>
           </div>
           <div class="detail-send-row">
             <button class="detail-send-btn dsb-claude" id="detailBtnClaude">
               <div class="dsb-icon"><img src="icons/claude-logo-64.png" class="dsb-logo" alt="Claude"/></div>
               Claude
             </button>
             <button class="detail-send-btn dsb-gemini" id="detailBtnGemini">
               <div class="dsb-icon" style="background:#fff;border-color:rgba(66,133,244,0.2);overflow:hidden;padding:2px;">
                 <img src="icons/gemini-logo.png" alt="Gemini" style="width:28px;height:28px;object-fit:contain;display:block;"/>
               </div>
               Gemini
             </button>
             <button class="detail-send-btn dsb-lovable" id="detailBtnLovable">
               <div class="dsb-icon" style="background:#fff;border-color:rgba(0,0,0,0.1);overflow:hidden;padding:2px;">
                 <img src="icons/lovable-color.png" alt="Lovable" style="width:28px;height:28px;object-fit:contain;display:block;border-radius:4px;"/>
               </div>
               Lovable
             </button>
             <button class="detail-send-btn dsb-manus" id="detailBtnManus">
               <div class="dsb-icon" style="background:#fff;border-color:rgba(0,0,0,0.1);overflow:hidden;padding:4px;">
                 <img src="icons/manus.png" alt="Manus" style="width:24px;height:24px;object-fit:contain;display:block;border-radius:3px;"/>
               </div>
               Manus
             </button>
             <button class="detail-send-btn dsb-cursor" id="detailBtnCursor">
               <div class="dsb-icon dsb-icon-dark"><img src="icons/cursor-logo-64.png" class="dsb-logo dsb-logo-sm" alt="Cursor"/></div>
               Copy for Cursor
             </button>
             <button class="detail-send-btn dsb-gpt" id="detailBtnCodex">
               <div class="dsb-icon" style="background:#10a37f;border-color:rgba(16,163,127,0.35);">
                 <svg viewBox="0 0 41 41" width="20" height="20" fill="white" xmlns="http://www.w3.org/2000/svg">
                   <path d="M37.532 16.87a9.963 9.963 0 00-.856-8.184 10.078 10.078 0 00-10.855-4.835 9.964 9.964 0 00-7.505-3.348 10.079 10.079 0 00-9.61 6.977 9.967 9.967 0 00-6.664 4.834 10.08 10.08 0 001.24 11.817 9.965 9.965 0 00.856 8.185 10.079 10.079 0 0010.855 4.835 9.965 9.965 0 007.504 3.347 10.078 10.078 0 009.617-6.981 9.967 9.967 0 006.663-4.834 10.079 10.079 0 00-1.245-11.813zM22.498 37.886a7.474 7.474 0 01-4.799-1.735c.061-.033.168-.091.237-.134l7.964-4.6a1.294 1.294 0 00.655-1.134V19.054l3.366 1.944a.12.12 0 01.066.092v9.299a7.505 7.505 0 01-7.49 7.496zM6.392 31.006a7.471 7.471 0 01-.894-5.023c.06.036.162.099.237.141l7.964 4.6a1.297 1.297 0 001.308 0l9.724-5.614v3.888a.12.12 0 01-.048.103l-8.051 4.649a7.504 7.504 0 01-10.24-2.744zM4.297 13.62A7.469 7.469 0 018.2 10.333c0 .068-.004.19-.004.274v9.201a1.294 1.294 0 00.654 1.132l9.723 5.614-3.366 1.944a.12.12 0 01-.114.012L7.044 23.86a7.504 7.504 0 01-2.747-10.24zm27.658 6.437l-9.724-5.615 3.367-1.943a.121.121 0 01.114-.012l8.048 4.648a7.498 7.498 0 01-1.158 13.528v-9.476a1.293 1.293 0 00-.647-1.13zm3.35-5.043c-.059-.037-.162-.099-.236-.141l-7.965-4.6a1.298 1.298 0 00-1.308 0l-9.723 5.614v-3.888a.12.12 0 01.048-.103l8.05-4.645a7.497 7.497 0 0111.135 7.763zm-21.063 6.929l-3.367-1.944a.12.12 0 01-.065-.092v-9.299a7.497 7.497 0 0112.293-5.756 6.94 6.94 0 00-.236.134l-7.965 4.6a1.294 1.294 0 00-.654 1.132l-.006 11.225zm1.829-3.943l4.33-2.501 4.332 2.5v4.999l-4.331 2.5-4.331-2.5V18z"/>
                 </svg>
               </div>
               GPT
             </button>
           </div>
           <div class="detail-bottom-row">
             <button class="detail-copy-btn" id="detailCopyBtn">
               <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 11V3h8"/></svg>
               Copy AI Brief
             </button>
             <button class="detail-del-btn" id="detailDelBtn" title="Remove from library">
               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                 <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
               </svg>
             </button>
           </div>
         </div>`;

    // Export buttons helper
    const flashExport = (id, label) => {
        const btn = document.getElementById(id);
        const orig = btn.innerHTML;
        btn.textContent = `✓ ${label}`;
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
    };

    const downloadFile = (filename, content, mime) => {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const safeName = (snap.siteName || 'uidrop').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

    document.getElementById('detailExportFigma').addEventListener('click', () => {
        window.UIDropGate.gate('exportFigma', () => {
            downloadFile(`${safeName}-figma-tokens.json`, buildFigmaTokens(snap), 'application/json');
            navigator.clipboard.writeText(buildFigmaTokens(snap)).catch(()=>{});
            flashExport('detailExportFigma', 'Downloaded');
        });
    });
    document.getElementById('detailExportCSS').addEventListener('click', () => {
        window.UIDropGate.gate('exportCSS', () => {
            downloadFile(`${safeName}-tokens.css`, buildCSSVars(snap), 'text/css');
            navigator.clipboard.writeText(buildCSSVars(snap)).catch(()=>{});
            flashExport('detailExportCSS', 'Downloaded');
        });
    });
    document.getElementById('detailExportCanva').addEventListener('click', () => {
        window.UIDropGate.gate('exportCanva', () => {
            const palette = [snap.schema?.primaryColor, snap.schema?.accentColor, snap.schema?.surfaceColor, snap.schema?.textColor, snap.schema?.mutedText]
                .filter(isHex).map(h => h.replace('#','').toUpperCase());
            navigator.clipboard.writeText(buildCanvaPalette(snap)).catch(()=>{});
            const canvaUrl = palette.length
                ? `https://www.canva.com/colors/color-palettes/?colors=${palette.join(',')}`
                : 'https://www.canva.com/colors/color-palette-generator/';
            chrome.tabs.create({ url: canvaUrl });
            flashExport('detailExportCanva', 'Opened Canva');
        });
    });

    document.getElementById('detailExportTailwind').addEventListener('click', () => {
        window.UIDropGate.gate('exportTailwind', () => {
            downloadFile(`${safeName}-tailwind.config.js`, buildTailwindConfig(snap), 'application/javascript');
            navigator.clipboard.writeText(buildTailwindConfig(snap)).catch(()=>{});
            flashExport('detailExportTailwind', 'Downloaded');
        });
    });
    document.getElementById('detailExportShadcn').addEventListener('click', () => {
        window.UIDropGate.gate('exportShadcn', () => {
            downloadFile(`${safeName}-shadcn-theme.css`, buildShadcnTheme(snap), 'text/css');
            navigator.clipboard.writeText(buildShadcnTheme(snap)).catch(()=>{});
            flashExport('detailExportShadcn', 'Downloaded');
        });
    });
    document.getElementById('detailExportPoster').addEventListener('click', () => {
        exportPalettePoster(snap);
    });

    // ── Tags ──────────────────────────────────────────────────
    function renderDetailTags() {
        const row = document.getElementById('detailTagsRow');
        if (!row) return;
        row.innerHTML = (snap.tags||[]).map(t =>
            `<span class="detail-tag">${escHtml(t)}<span class="detail-tag-x" data-tag="${escHtml(t)}">×</span></span>`
        ).join('') || `<span style="font-size:11px;color:var(--faint)">No tags yet</span>`;
        row.querySelectorAll('.detail-tag-x').forEach(x => {
            x.addEventListener('click', async () => {
                await removeTag(snap.id, x.dataset.tag);
                snap.tags = allSnaps.find(s => s.id === snap.id)?.tags || [];
                renderDetailTags();
                renderTagFilterBar();
            });
        });
    }
    renderDetailTags();

    const tagInput = document.getElementById('detailTagInput');
    const addTagFn = async () => {
        const val = tagInput?.value.trim().toLowerCase().replace(/\s+/g,'-');
        if (!val || (snap.tags||[]).includes(val)) { if (tagInput) tagInput.value=''; return; }
        await addTag(snap.id, val);
        snap.tags = allSnaps.find(s => s.id === snap.id)?.tags || [];
        if (tagInput) tagInput.value = '';
        renderDetailTags();
        renderTagFilterBar();
    };
    document.getElementById('detailTagAdd')?.addEventListener('click', addTagFn);
    tagInput?.addEventListener('keydown', e => { if (e.key === 'Enter') addTagFn(); });

    // ── Move to collection ────────────────────────────────────
    document.getElementById('detailCollSelect')?.addEventListener('change', async e => {
        await saveSnapField(snap.id, { collectionId: e.target.value || null });
        snap.collectionId = e.target.value || null;
        applyFilters();
    });

    // ── Format toggle ──
    const skillMd = (snap.schema && typeof buildSkillMarkdown === 'function')
        ? buildSkillMarkdown(snap.schema, snap.siteName || '')
        : '';
    const snapSlug = (snap.siteName || 'site').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'site';
    let activePrompt = snap.finalPrompt || '';
    let activeMode   = 'brief';  // tracks current format mode

    document.querySelectorAll('#detailFormatToggle .dfmt-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            activeMode = mode;
            document.querySelectorAll('#detailFormatToggle .dfmt-opt').forEach(b => {
                b.classList.toggle('dfmt-active', b.dataset.mode === mode);
            });
            activePrompt = (mode === 'skill') ? skillMd : (snap.finalPrompt || '');
        });
    });

    // Helper: build skillFile payload when in skill mode
    function detailSkillFile() {
        return (activeMode === 'skill' && skillMd)
            ? { content: skillMd, filename: `${snapSlug}.md` }
            : null;
    }

    // Send to Gemini
    document.getElementById('detailBtnGemini').addEventListener('click', () => {
        if (!activePrompt) return;
        chrome.runtime.sendMessage({
            action: 'openWithPrompt', target: 'gemini',
            url: 'https://gemini.google.com/app',
            prompt: activePrompt, screenshot: snap.thumbnail, slug: snapSlug, skillFile: detailSkillFile()
        });
    });

    // Send to Claude
    document.getElementById('detailBtnClaude').addEventListener('click', () => {
        if (!activePrompt) return;
        chrome.runtime.sendMessage({
            action: 'openWithPrompt', target: 'claude',
            url: 'https://claude.ai/new',
            prompt: activePrompt, screenshot: snap.thumbnail, slug: snapSlug, skillFile: detailSkillFile()
        });
    });

    // Send to Lovable
    document.getElementById('detailBtnLovable').addEventListener('click', () => {
        if (!activePrompt) return;
        chrome.runtime.sendMessage({
            action: 'openWithPrompt', target: 'lovable',
            url: 'https://lovable.dev/',
            prompt: activePrompt, screenshot: snap.thumbnail, slug: snapSlug, skillFile: detailSkillFile()
        });
    });

    // Send to Manus
    document.getElementById('detailBtnManus').addEventListener('click', () => {
        if (!activePrompt) return;
        chrome.runtime.sendMessage({
            action: 'openWithPrompt', target: 'manus',
            url: 'https://manus.im/',
            prompt: activePrompt, screenshot: snap.thumbnail, slug: snapSlug, skillFile: detailSkillFile()
        });
    });

    // Cursor — just copies to clipboard (same as popup)
    document.getElementById('detailBtnCursor').addEventListener('click', () => {
        if (!activePrompt) return;
        navigator.clipboard.writeText(activePrompt).then(() => {
            const btn = document.getElementById('detailBtnCursor');
            const orig = btn.innerHTML;
            btn.innerHTML = '✓ Copied!';
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        });
    });

    // Codex / ChatGPT
    document.getElementById('detailBtnCodex').addEventListener('click', () => {
        if (!activePrompt) return;
        chrome.runtime.sendMessage({
            action: 'openWithPrompt', target: 'chatgpt',
            url: 'https://chatgpt.com/', prompt: activePrompt, screenshot: snap.thumbnail, slug: snapSlug
        });
    });

    // Remove from library
    document.getElementById('detailDelBtn').addEventListener('click', () => {
        deleteSnap(snap.id);
    });

    // Wire up copy button
    document.getElementById('detailCopyBtn').addEventListener('click', () => {
        if (!activePrompt) return;
        navigator.clipboard.writeText(activePrompt).then(() => {
            const btn = document.getElementById('detailCopyBtn');
            const orig = btn.innerHTML;
            btn.textContent = '✓ Copied!';
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        });
    });

    // Click-to-copy on individual token rows
    document.getElementById('detailPanel').querySelectorAll('.cv-token-row').forEach(row => {
        const valEl = row.querySelector('.cv-token-val');
        if (!valEl) return;
        row.title = 'Click to copy';
        row.addEventListener('click', () => {
            navigator.clipboard.writeText(valEl.textContent.trim()).then(() => {
                row.classList.add('copied');
                setTimeout(() => row.classList.remove('copied'), 700);
            });
        });
    });

    // Click-to-copy on tonal scale steps (free feature)
    document.getElementById('detailPanel').querySelectorAll('.tonal-step').forEach(step => {
        step.addEventListener('click', () => {
            const hex = step.dataset.hex;
            navigator.clipboard.writeText(hex).then(() => {
                step.classList.add('copied');
                setTimeout(() => step.classList.remove('copied'), 800);
            });
        });
    });

    document.getElementById('gridView').classList.add('hidden');
    document.getElementById('detailView').classList.remove('hidden');
    window.scrollTo(0, 0);
}

function closeDetail() {
    document.getElementById('detailView').classList.add('hidden');
    document.getElementById('gridView').classList.remove('hidden');
}

// "Surprise me" — jump to a random snap (free)
function openRandomSnap() {
    if (!allSnaps?.length) return;
    const random = allSnaps[Math.floor(Math.random() * allSnaps.length)];
    openDetail(random.id);
}

// ── Open compare ─────────────────────────────────────────────
function openCompare() {
    if (selectedIds.size < 2) return;
    const snaps = [...selectedIds]
        .map(id => allSnaps.find(x => x.id === id))
        .filter(Boolean);
    if (snaps.length < 2) return;

    buildCompareView(snaps[0], snaps[1]);
    document.getElementById('gridView').classList.add('hidden');
    document.getElementById('compareHint').classList.remove('visible');
    document.getElementById('compareView').classList.add('open');
    window.scrollTo(0, 0);
}

function backToGrid() {
    document.getElementById('compareView').classList.remove('open');
    document.getElementById('gridView').classList.remove('hidden');
    if (compareModeOn) updateHintBar();
}

// ── Build compare view ────────────────────────────────────────
function buildCompareView(a, b) {
    const sa = a.schema || {}, sb = b.schema || {};

    // Subtitle
    document.getElementById('compareSubtitle').textContent =
        `${a.siteName || 'Site A'}  vs  ${b.siteName || 'Site B'}`;

    // Count diffs
    const fields = [
        'primaryColor','accentColor','surfaceColor','elevatedSurface',
        'textColor','mutedText','headingFont','bodyFont','typeScale',
        'radius','spacingScale','buttonStyle','cardStyle','inputStyle'
    ];
    const diffs = fields.filter(k => sa[k] && sb[k] && sa[k] !== sb[k]).length;
    document.getElementById('diffCount').textContent =
        diffs ? `${diffs} difference${diffs !== 1 ? 's' : ''}` : 'identical schemas';

    // Render two panels
    document.getElementById('cvCols').innerHTML =
        [a, b].map((snap, idx) => panelHTML(snap, idx === 0 ? sb : sa)).join('');
}

function panelHTML(snap, other) {
    const s   = snap.schema || {};
    const o   = other || {};
    const recs = snap.recommendation || [];
    const date = new Date(snap.timestamp).toLocaleDateString('en-US', {
        month:'short', day:'numeric', year:'numeric'
    });

    const diff = (key, val) => val && o[key] && val !== o[key] ? ' diff' : '';

    const palette = [
        { label:'primary',  hex: s.primaryColor },
        { label:'accent',   hex: s.accentColor  },
        { label:'surface',  hex: s.surfaceColor  },
        { label:'elevated', hex: s.elevatedSurface },
        { label:'text',     hex: s.textColor     },
        { label:'muted',    hex: s.mutedText     },
    ].filter(c => isHex(c.hex));

    const tokenRow = (key, label, val, type='text') => {
        const isDiff = val && o[key] && val !== o[key];
        const inner = type === 'color' && isHex(val)
            ? `<div class="cv-token-dot" style="background:${val}"></div><span class="cv-token-val hex">${escHtml(val)}</span>`
            : val
                ? `<span class="cv-token-val">${escHtml(String(val))}</span>`
                : `<span class="cv-token-null">—</span>`;
        return `<div class="cv-token-row${isDiff?' diff':''}">
            <span class="cv-token-key">${label}</span>${inner}
        </div>`;
    };

    return `
    <div class="cv-panel">
      <div class="cv-panel-head">
        ${snap.thumbnail
            ? `<img class="cv-panel-thumb" src="${snap.thumbnail}" alt="${escHtml(snap.siteName)}"/>`
            : `<div class="cv-panel-thumb-ph"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`}
        <div class="cv-panel-meta">
          <div class="cv-panel-site">${escHtml(snap.siteName || 'Unknown')}</div>
          <div class="cv-panel-date">${date}</div>
        </div>
      </div>

      <div class="cv-panel-body">

        <!-- Vibe -->
        <div>
          <div class="cv-section-label">Vibe</div>
          ${tokenRow('vibe', 'vibe', s.vibe)}
        </div>

        <!-- Palette -->
        <div>
          <div class="cv-section-label">Palette</div>
          <div class="cv-palette">
            ${palette.map(c => `
              <div class="cv-swatch-item">
                <div class="cv-swatch" style="background:${c.hex}" title="${c.hex}"></div>
                <span class="cv-swatch-name">${c.label}</span>
              </div>`).join('')}
          </div>
          ${tokenRow('primaryColor',    'primary',  s.primaryColor,    'color')}
          ${tokenRow('accentColor',     'accent',   s.accentColor,     'color')}
          ${tokenRow('surfaceColor',    'surface',  s.surfaceColor,    'color')}
          ${tokenRow('elevatedSurface', 'elevated', s.elevatedSurface, 'color')}
          ${tokenRow('textColor',       'text',     s.textColor,       'color')}
          ${tokenRow('mutedText',       'muted',    s.mutedText,       'color')}
        </div>

        <!-- Tonal scale (free, derived from primary) -->
        ${s.primaryColor ? `
        <div>
          <div class="cv-section-label">Tonal scale <span class="cv-section-hint">— generated from primary</span></div>
          <div class="tonal-scale">
            ${generateTonalScale(s.primaryColor).map(t => `
              <div class="tonal-step" data-hex="${t.hex}" title="${t.hex} · click to copy">
                <div class="tonal-swatch" style="background:${t.hex}"></div>
                <span class="tonal-name">${t.name}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

        <!-- WCAG contrast checker (free) -->
        ${s.textColor && s.surfaceColor ? `
        <div>
          <div class="cv-section-label">Contrast <span class="cv-section-hint">— WCAG 2.x</span></div>
          <div class="wcag-grid">
            ${[
              { fg: s.textColor,    bg: s.surfaceColor, fgLabel: 'text',    bgLabel: 'surface' },
              s.primaryColor ? { fg: s.primaryColor, bg: s.surfaceColor, fgLabel: 'primary', bgLabel: 'surface' } : null,
              s.mutedText    ? { fg: s.mutedText,    bg: s.surfaceColor, fgLabel: 'muted',   bgLabel: 'surface' } : null,
            ].filter(Boolean).map(p => {
              const r = contrastRatio(p.fg, p.bg);
              const g = wcagGrade(r);
              return `<div class="wcag-row">
                <div class="wcag-preview" style="background:${p.bg};color:${p.fg};">Aa</div>
                <div class="wcag-meta">
                  <div class="wcag-label">${p.fgLabel} on ${p.bgLabel}</div>
                  <div class="wcag-ratio">${r}:1</div>
                </div>
                <span class="wcag-badge ${g.ok ? 'ok' : 'fail'}">${g.grade}</span>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}

        <!-- Typography -->
        <div>
          <div class="cv-section-label">Typography</div>
          ${tokenRow('headingFont', 'heading', s.headingFont)}
          ${tokenRow('bodyFont',    'body',    s.bodyFont)}
          ${tokenRow('typeScale',   'scale',   s.typeScale)}
        </div>

        <!-- Tokens -->
        <div>
          <div class="cv-section-label">Tokens</div>
          ${tokenRow('radius',      'radius',  s.radius)}
          ${tokenRow('spacingScale','spacing', s.spacingScale)}
          ${tokenRow('borderColor', 'border',  s.borderColor, 'color')}
          ${tokenRow('iconStroke',  'icons',   s.iconStroke)}
        </div>

        <!-- Components -->
        <div>
          <div class="cv-section-label">Components</div>
          ${tokenRow('buttonStyle', 'button', s.buttonStyle)}
          ${tokenRow('cardStyle',   'card',   s.cardStyle)}
          ${tokenRow('inputStyle',  'input',  s.inputStyle)}
        </div>

        ${recs.length ? `
        <!-- Use-case chips (no label — chips speak for themselves) -->
        <div>
          <div class="cv-recs">
            ${recs.map(r => `<span class="cv-rec">${escHtml(r.type)}</span>`).join('')}
          </div>
        </div>` : ''}

      </div>
    </div>`;
}

// ── Delete a snap ────────────────────────────────────────────
async function deleteSnap(id) {
    allSnaps      = allSnaps.filter(s => s.id !== id);
    filteredSnaps = filteredSnaps.filter(s => s.id !== id);
    selectedIds.delete(id);

    const { snapHistory = [] } = await chrome.storage.local.get('snapHistory');
    await chrome.storage.local.set({ snapHistory: snapHistory.filter(s => s.id !== id) });

    // If we're in the detail view for this snap, go back to grid
    if (!document.getElementById('detailView').classList.contains('hidden')) {
        closeDetail();
    }
    renderGrid();
}


// ── Toggle star / favourite ───────────────────────────────────
async function toggleStar(id) {
    const snap = allSnaps.find(s => s.id === id);
    if (!snap) return;
    snap.starred = !snap.starred;

    const { snapHistory = [] } = await chrome.storage.local.get('snapHistory');
    const updated = snapHistory.map(s => s.id === id ? { ...s, starred: snap.starred } : s);
    await chrome.storage.local.set({ snapHistory: updated });

    applyFilters();
}

// ── Moodboard card HTML ───────────────────────────────────────
function moodboardCardHTML(snap) {
    const thumbHTML = snap.thumbnail
        ? `<img class="mb-thumb" src="${snap.thumbnail}" alt="${escHtml(snap.siteName)}" loading="lazy"/>`
        : `<div class="mb-thumb mb-thumb-ph"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;
    return `
    <div class="moodboard-card" data-id="${snap.id}">
      ${thumbHTML}
      <div class="mb-overlay">
        <span class="mb-site">${escHtml(snap.siteName || 'Unknown')}</span>
        <button class="mb-star${snap.starred ? ' on' : ''}" title="Favourite">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="${snap.starred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
      </div>
    </div>`;
}

// ── Export builders ───────────────────────────────────────────
function buildFigmaTokens(snap) {
    const s = snap.schema || {};
    const out = { global: {} };
    const g = out.global;

    // Colors
    const colorMap = {
        primary: s.primaryColor, accent: s.accentColor,
        surface: s.surfaceColor, elevated: s.elevatedSurface,
        text: s.textColor, muted: s.mutedText, border: s.borderColor
    };
    Object.entries(colorMap).forEach(([k, v]) => {
        if (v) g[`color-${k}`] = { value: v, type: 'color' };
    });

    // Typography — parse "Montserrat 700" and "Montserrat 16px 400, 1.56 line-height"
    if (s.headingFont) {
        const parts = s.headingFont.split(/\s+/);
        const weight = parts.find(p => /^\d{3}$/.test(p));
        const family = parts.filter(p => !/^\d/.test(p)).join(' ').trim();
        if (family) g['font-heading'] = { value: family, type: 'fontFamilies' };
        if (weight) g['font-heading-weight'] = { value: weight, type: 'fontWeights' };
    }
    if (s.bodyFont) {
        const parts = s.bodyFont.split(/[\s,]+/);
        const family = parts[0];
        const size   = parts.find(p => /^\d+px$/.test(p));
        const weight = parts.find(p => /^[1-9]00$/.test(p));
        const lh     = s.bodyFont.match(/(\d+\.\d+)\s+line-height/)?.[1];
        if (family) g['font-body']        = { value: family, type: 'fontFamilies' };
        if (size)   g['font-size-body']   = { value: parseInt(size), type: 'fontSizes' };
        if (weight) g['font-body-weight'] = { value: weight, type: 'fontWeights' };
        if (lh)     g['line-height-body'] = { value: lh, type: 'lineHeights' };
    }

    // Border radius — parse "999px buttons, 16px cards"
    if (s.radius) {
        [...s.radius.matchAll(/(\d+(?:\.\d+)?)px\s+(\w+)/g)].forEach(([, val, name]) => {
            g[`radius-${name}`] = { value: parseInt(val), type: 'borderRadius' };
        });
    }

    return JSON.stringify(out, null, 2);
}

function buildCSSVars(snap) {
    const s = snap.schema || {};
    const lines = [
        `/* UIDrop — ${snap.siteName || 'Design Tokens'} */`,
        `:root {`
    ];
    const add = (k, v) => v && lines.push(`  ${k}: ${v};`);

    add('--color-primary',  s.primaryColor);
    add('--color-accent',   s.accentColor);
    add('--color-surface',  s.surfaceColor);
    add('--color-elevated', s.elevatedSurface);
    add('--color-text',     s.textColor);
    add('--color-muted',    s.mutedText);
    add('--color-border',   s.borderColor);

    if (s.headingFont) {
        const parts  = s.headingFont.split(/\s+/);
        const family = parts.filter(p => !/^\d/.test(p)).join(' ').trim();
        const weight = parts.find(p => /^\d{3}$/.test(p));
        add('--font-heading',        `"${family}"`);
        add('--font-heading-weight', weight);
    }
    if (s.bodyFont) {
        const parts  = s.bodyFont.split(/[\s,]+/);
        const size   = parts.find(p => /^\d+px$/.test(p));
        const weight = parts.find(p => /^[1-9]00$/.test(p));
        const lh     = s.bodyFont.match(/(\d+\.\d+)\s+line-height/)?.[1];
        add('--font-body',        `"${parts[0]}"`);
        add('--font-size-body',   size);
        add('--font-body-weight', weight);
        add('--line-height-body', lh);
    }

    if (s.radius) {
        [...s.radius.matchAll(/(\d+(?:\.\d+)?)px\s+(\w+)/g)].forEach(([, val, name]) => {
            add(`--radius-${name}`, `${val}px`);
        });
    }

    lines.push('}');
    return lines.join('\n');
}

// ── Color science helpers ────────────────────────────────────
// Used by tonal scale, contrast checker, Tailwind/shadcn exports
function hexToRgb(hex) {
    if (!hex) return null;
    const m = hex.replace('#','').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c+c).join('');
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}

function rgbToHex(r,g,b) {
    const c = n => Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0');
    return '#' + c(r) + c(g) + c(b);
}

function rgbToHsl(r,g,b) {
    r/=255; g/=255; b/=255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let h, s, l = (max+min)/2;
    if (max === min) { h = s = 0; }
    else {
        const d = max-min;
        s = l > 0.5 ? d/(2-max-min) : d/(max+min);
        switch (max) {
            case r: h = ((g-b)/d + (g<b?6:0)); break;
            case g: h = ((b-r)/d + 2); break;
            case b: h = ((r-g)/d + 4); break;
        }
        h /= 6;
    }
    return { h: h*360, s: s*100, l: l*100 };
}

function hslToRgb(h,s,l) {
    h/=360; s/=100; l/=100;
    let r,g,b;
    if (s === 0) { r=g=b=l; }
    else {
        const hue2rgb = (p,q,t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
        const q = l < 0.5 ? l*(1+s) : l+s-l*s;
        const p = 2*l - q;
        r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
    }
    return { r: r*255, g: g*255, b: b*255 };
}

// Tailwind-style 11-step tonal scale (50, 100..900, 950) from a single hex
function generateTonalScale(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return [];
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    // Lightness targets matched to Tailwind's perceptual scale
    const steps = [
        { name: '50',  l: 97 }, { name: '100', l: 94 }, { name: '200', l: 86 },
        { name: '300', l: 77 }, { name: '400', l: 66 }, { name: '500', l: hsl.l },
        { name: '600', l: Math.max(38, hsl.l - 8) },
        { name: '700', l: Math.max(30, hsl.l - 18) },
        { name: '800', l: Math.max(22, hsl.l - 26) },
        { name: '900', l: Math.max(15, hsl.l - 34) },
        { name: '950', l: Math.max(8,  hsl.l - 42) },
    ];
    return steps.map(s => {
        const { r, g, b } = hslToRgb(hsl.h, hsl.s, s.l);
        return { name: s.name, hex: rgbToHex(r, g, b) };
    });
}

// WCAG 2.x contrast ratio (1:1 → 21:1)
function contrastRatio(hex1, hex2) {
    const lum = hex => {
        const c = hexToRgb(hex); if (!c) return 0;
        const f = v => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
        return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b);
    };
    const a = lum(hex1), b = lum(hex2);
    const ratio = (Math.max(a,b) + 0.05) / (Math.min(a,b) + 0.05);
    return Math.round(ratio * 10) / 10;
}

function wcagGrade(ratio) {
    if (ratio >= 7)   return { grade: 'AAA',  ok: true,  desc: 'Excellent' };
    if (ratio >= 4.5) return { grade: 'AA',   ok: true,  desc: 'Good' };
    if (ratio >= 3)   return { grade: 'AA-L', ok: true,  desc: 'Large text only' };
    return                   { grade: 'Fail', ok: false, desc: 'Insufficient' };
}

// ── Tailwind config export (Pro) ────────────────────────────
function buildTailwindConfig(snap) {
    const s = snap.schema || {};
    const name = (snap.siteName || 'brand').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'brand';

    const tonal = s.primaryColor ? generateTonalScale(s.primaryColor) : [];
    const accentTonal = s.accentColor ? generateTonalScale(s.accentColor) : [];

    const fmtScale = (scale) => scale.length
        ? '{\n' + scale.map(t => `          '${t.name}': '${t.hex}',`).join('\n') + '\n        }'
        : 'null';

    const headingFamily = s.headingFont?.split(/\s+/).filter(p => !/^\d/.test(p)).join(' ').trim();
    const bodyFamily    = s.bodyFont?.split(/[\s,]+/)[0];

    let radii = [];
    if (s.radius) {
        radii = [...s.radius.matchAll(/(\d+(?:\.\d+)?)px\s+(\w+)/g)].map(([, v, n]) => ({ name: n, value: v + 'px' }));
    }

    return `// tailwind.config.js — extracted from ${snap.siteName || 'site'} via UIDrop
// Drop into your tailwind config under \`theme.extend\`.
module.exports = {
  theme: {
    extend: {
      colors: {
        ${name}: ${fmtScale(tonal)},${accentTonal.length ? `
        ${name}Accent: ${fmtScale(accentTonal)},` : ''}
        surface:  '${s.surfaceColor    || '#ffffff'}',
        elevated: '${s.elevatedSurface || '#f9fafb'}',
        ink:      '${s.textColor       || '#111827'}',
        muted:    '${s.mutedText       || '#6b7280'}',
        border:   '${s.borderColor     || '#e5e7eb'}',
      },
      fontFamily: {${headingFamily ? `
        heading: ['${headingFamily}', 'sans-serif'],` : ''}${bodyFamily ? `
        sans:    ['${bodyFamily}', 'sans-serif'],` : ''}
      },${radii.length ? `
      borderRadius: {
${radii.map(r => `        ${r.name}: '${r.value}',`).join('\n')}
      },` : ''}
    },
  },
};
`;
}

// ── shadcn/ui CSS theme export (Pro) ─────────────────────────
// Outputs the CSS variables block in shadcn's exact convention (HSL channel values)
function buildShadcnTheme(snap) {
    const s = snap.schema || {};
    const hexToHslChannels = (hex) => {
        const rgb = hexToRgb(hex); if (!rgb) return null;
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        return `${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${Math.round(hsl.l)}%`;
    };
    const isDark = s.isDark === true;

    const pri      = hexToHslChannels(s.primaryColor) || '222 47% 11%';
    const acc      = hexToHslChannels(s.accentColor)  || pri;
    const bg       = hexToHslChannels(s.surfaceColor) || (isDark ? '222 47% 11%' : '0 0% 100%');
    const fg       = hexToHslChannels(s.textColor)    || (isDark ? '210 40% 98%' : '222 47% 11%');
    const muted    = hexToHslChannels(s.mutedText)    || (isDark ? '215 20% 65%' : '215 16% 47%');
    const border   = hexToHslChannels(s.borderColor)  || (isDark ? '217 33% 17%' : '214 32% 91%');
    const elevated = hexToHslChannels(s.elevatedSurface) || bg;
    // Heuristic primary-foreground: white if primary is dark, near-black otherwise
    const priRgb = hexToRgb(s.primaryColor);
    const priLight = priRgb ? rgbToHsl(priRgb.r, priRgb.g, priRgb.b).l : 50;
    const priFg = priLight > 60 ? '222 47% 11%' : '0 0% 100%';

    // Radius — pull the first numeric radius value
    const radiusMatch = s.radius?.match(/(\d+(?:\.\d+)?)px/);
    const radius = radiusMatch ? `${radiusMatch[1]}px` : '0.5rem';

    return `/* shadcn/ui theme — extracted from ${snap.siteName || 'site'} via UIDrop
   Paste this into globals.css (replaces the default :root + .dark blocks) */
:root {
  --background: ${bg};
  --foreground: ${fg};
  --card: ${elevated};
  --card-foreground: ${fg};
  --popover: ${elevated};
  --popover-foreground: ${fg};
  --primary: ${pri};
  --primary-foreground: ${priFg};
  --secondary: ${acc};
  --secondary-foreground: ${fg};
  --muted: ${muted};
  --muted-foreground: ${muted};
  --accent: ${acc};
  --accent-foreground: ${fg};
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 98%;
  --border: ${border};
  --input: ${border};
  --ring: ${pri};
  --radius: ${radius};
}
`;
}

function buildCanvaPalette(snap) {
    const s = snap.schema || {};
    const pairs = [
        ['Primary',  s.primaryColor],
        ['Accent',   s.accentColor],
        ['Surface',  s.surfaceColor],
        ['Elevated', s.elevatedSurface],
        ['Text',     s.textColor],
        ['Muted',    s.mutedText],
    ].filter(([, v]) => v);
    const hexLine = pairs.map(([, v]) => v).join('  ');
    const labelLines = pairs.map(([k, v]) => `${k.padEnd(10)} ${v}`).join('\n');
    return `Brand Palette — ${snap.siteName || 'UIDrop'}\n\n${labelLines}\n\nHex codes: ${hexLine}`;
}

// ── Colour helpers ────────────────────────────────────────────
function isHex(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }

// ── Utils ─────────────────────────────────────────────────────
function escHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c =>
        ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
    );
}

// ── Auto-tags ─────────────────────────────────────────────────
// Clean single-word tags only. No compound strings, no separators.
function autoTags(snap) {
    const tags = [];
    const s = snap.schema || {};

    // Light / Dark
    if (snap.isDark === true)  tags.push('Dark');
    if (snap.isDark === false) tags.push('Light');

    // Radius feel — one word
    if (s.radius) {
        if (/999|pill/i.test(s.radius))             tags.push('Pill');
        else if (/^[0-3]px/.test(s.radius))         tags.push('Sharp');
        else if (/1[6-9]px|2\d+px/.test(s.radius))  tags.push('Rounded');
    }

    // Colour mood — from vibe string, pick only the useful single words
    const vibeStr = (s.vibe || '').toLowerCase();
    if (vibeStr.includes('vibrant') || vibeStr.includes('colorful')) tags.push('Vibrant');
    if (vibeStr.includes('minimal') || vibeStr.includes('monochrome')) tags.push('Minimal');
    if (vibeStr.includes('gradient')) tags.push('Gradient');
    if (vibeStr.includes('modern'))   tags.push('Modern');
    if (vibeStr.includes('soft'))     tags.push('Soft');

    // Font style
    const hf = (s.headingFont || '').toLowerCase();
    if (/serif(?!less)/.test(hf) && !/sans/.test(hf)) tags.push('Serif');
    else if (/mono/.test(hf))                          tags.push('Monospace');

    return [...new Set(tags)];
}

// ── Tag CRUD ──────────────────────────────────────────────────
async function addTag(id, tag) {
    const snap = allSnaps.find(s => s.id === id);
    if (!snap) return;
    snap.tags = [...new Set([...(snap.tags||[]), tag])];
    await saveSnapField(id, { tags: snap.tags });
}

async function removeTag(id, tag) {
    const snap = allSnaps.find(s => s.id === id);
    if (!snap) return;
    snap.tags = (snap.tags||[]).filter(t => t !== tag);
    await saveSnapField(id, { tags: snap.tags });
}

// ── Pin ───────────────────────────────────────────────────────
async function togglePin(id) {
    const snap = allSnaps.find(s => s.id === id);
    if (!snap) return;
    snap.pinned = !snap.pinned;
    await saveSnapField(id, { pinned: snap.pinned });
    applyFilters();
}

// ── Generic snap field updater ────────────────────────────────
async function saveSnapField(id, changes) {
    const { snapHistory = [] } = await chrome.storage.local.get('snapHistory');
    const updated = snapHistory.map(s => s.id === id ? { ...s, ...changes } : s);
    allSnaps = allSnaps.map(s => s.id === id ? { ...s, ...changes } : s);
    await chrome.storage.local.set({ snapHistory: updated });
}

// ── Collections ───────────────────────────────────────────────
async function loadCollections() {
    const { snapCollections = [] } = await chrome.storage.local.get('snapCollections');
    collections = snapCollections;
}

async function saveCollections() {
    await chrome.storage.local.set({ snapCollections: collections });
}

function commitNewCollection() {
    const input = document.getElementById('collCreateInput');
    const name  = input.value.trim();
    if (!name) return;
    // Gate: creating a new collection consumes 1 trial use
    window.UIDropGate.gate('collections', () => {
        const color = COLL_COLORS[collections.length % COLL_COLORS.length];
        collections.push({ id: Date.now().toString(), name, color });
        saveCollections();
        input.value = '';
        document.getElementById('collCreateWrap').classList.remove('visible');
        renderCollectionsBar();
    });
}

function renderCollectionsBar() {
    const bar = document.getElementById('collectionsBar');
    const existingChips = bar.querySelectorAll('.coll-chip');
    existingChips.forEach(c => c.remove());

    // "All snaps" chip
    const allChip = document.createElement('button');
    allChip.className = `coll-chip${!activeCollectionId ? ' active' : ''}`;
    allChip.dataset.coll = 'all';
    allChip.textContent = 'All snaps';
    allChip.addEventListener('click', () => { activeCollectionId = null; renderCollectionsBar(); applyFilters(); });
    bar.insertBefore(allChip, bar.firstChild);

    // Collection chips
    collections.forEach(c => {
        const chip = document.createElement('button');
        chip.className = `coll-chip${activeCollectionId === c.id ? ' active' : ''}`;
        chip.innerHTML = `<span class="coll-dot" style="background:${c.color}"></span>${escHtml(c.name)}<span class="coll-x" title="Delete collection">×</span>`;
        chip.addEventListener('click', e => {
            if (e.target.classList.contains('coll-x')) {
                if (!confirm(`Delete collection "${c.name}"?`)) return;
                collections = collections.filter(x => x.id !== c.id);
                saveCollections();
                allSnaps.forEach(s => { if (s.collectionId === c.id) saveSnapField(s.id, { collectionId: null }); });
                if (activeCollectionId === c.id) activeCollectionId = null;
                renderCollectionsBar(); applyFilters();
            } else {
                activeCollectionId = c.id;
                renderCollectionsBar(); applyFilters();
            }
        });
        bar.insertBefore(chip, document.getElementById('collCreateWrap'));
    });
}

// ── Tag filter bar ────────────────────────────────────────────
function renderTagFilterBar() {
    const bar = document.getElementById('tagFilterBar');
    // Collect all unique tags across library
    const allTags = [...new Set(allSnaps.flatMap(s => s.tags||[]))].sort();
    if (!allTags.length) { bar.classList.add('empty'); return; }
    bar.classList.remove('empty');

    bar.innerHTML = `<span class="tag-filter-label">Filter</span>` +
        allTags.map(t =>
            `<button class="tag-chip${activeTags.has(t) ? ' active' : ''}" data-tag="${escHtml(t)}">${escHtml(t)}</button>`
        ).join('');

    bar.querySelectorAll('.tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const t = chip.dataset.tag;
            activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t);
            chip.classList.toggle('active', activeTags.has(t));
            applyFilters();
        });
    });
}

// ── Insights modal ────────────────────────────────────────────
function showInsightsModal() {
    const modal = document.getElementById('insightsModal');
    const body  = document.getElementById('insightsBody');
    const meta  = document.getElementById('insightsMeta');

    meta.textContent = `${allSnaps.length} snap${allSnaps.length !== 1 ? 's' : ''} in your library`;

    // Font frequency
    const fontCount = {};
    allSnaps.forEach(s => {
        const fonts = [s.schema?.headingFont, s.schema?.bodyFont].filter(Boolean);
        fonts.forEach(f => {
            const name = f.split(/[\s,]+/)[0];
            fontCount[name] = (fontCount[name] || 0) + 1;
        });
    });
    const sortedFonts = Object.entries(fontCount).sort((a,b) => b[1]-a[1]).slice(0, 8);
    const maxFont = sortedFonts[0]?.[1] || 1;

    // Primary colors
    const colorCount = {};
    allSnaps.forEach(s => {
        const p = s.schema?.primaryColor;
        if (p) colorCount[p] = (colorCount[p] || 0) + 1;
    });
    const sortedColors = Object.entries(colorCount).sort((a,b) => b[1]-a[1]).slice(0, 10);

    // Tag frequency
    const tagCount = {};
    allSnaps.forEach(s => (s.tags||[]).forEach(t => { tagCount[t] = (tagCount[t]||0) + 1; }));
    const sortedTags = Object.entries(tagCount).sort((a,b) => b[1]-a[1]).slice(0, 8);
    const maxTag = sortedTags[0]?.[1] || 1;

    // Dark vs light
    const darkCount  = allSnaps.filter(s => s.isDark === true).length;
    const lightCount = allSnaps.filter(s => s.isDark === false).length;
    const total = allSnaps.length || 1;

    body.innerHTML = `
    <!-- Primary colors — big interactive swatches at top -->
    ${sortedColors.length ? `
    <div class="ins-colors-grid">
      ${sortedColors.map(([hex, count], i) => `
        <div class="ins-color-swatch" style="background:${hex};" title="${hex}"
             onclick="navigator.clipboard.writeText('${hex}').then(()=>{this.classList.add('copied');setTimeout(()=>this.classList.remove('copied'),1400)})">
          <span class="ins-color-hex">${hex.toUpperCase()}</span>
          <span class="ins-color-count">${count}×</span>
        </div>`).join('')}
    </div>` : ''}

    <!-- Two column grid: fonts + tags -->
    <div class="ins-two-col">
      ${sortedFonts.length ? `
      <div class="ins-section">
        <div class="ins-section-label">Most used fonts</div>
        ${sortedFonts.map(([name, count]) => `
          <div class="ins-bar-row">
            <span class="ins-bar-name">${escHtml(name)}</span>
            <div class="ins-bar-track">
              <div class="ins-bar-fill ins-bar-purple" data-w="${Math.round(count/maxFont*100)}"></div>
            </div>
            <span class="ins-bar-count">${count}</span>
          </div>`).join('')}
      </div>` : ''}

      ${sortedTags.length ? `
      <div class="ins-section">
        <div class="ins-section-label">Tag breakdown</div>
        ${sortedTags.map(([tag, count]) => `
          <div class="ins-bar-row">
            <span class="ins-bar-name">${escHtml(tag)}</span>
            <div class="ins-bar-track">
              <div class="ins-bar-fill ins-bar-blue" data-w="${Math.round(count/maxTag*100)}"></div>
            </div>
            <span class="ins-bar-count">${count}</span>
          </div>`).join('')}
      </div>` : ''}
    </div>

    <!-- Dark vs Light — big pill split -->
    ${(darkCount + lightCount) > 0 ? `
    <div class="ins-section">
      <div class="ins-section-label">Dark vs Light</div>
      <div class="ins-split-bar">
        <div class="ins-split-dark" style="width:${Math.round(darkCount/total*100)}%">
          <span>🌙 ${darkCount}</span>
        </div>
        <div class="ins-split-light" style="width:${Math.round(lightCount/total*100)}%">
          <span>☀️ ${lightCount}</span>
        </div>
      </div>
      <div class="ins-split-labels">
        <span>Dark ${Math.round(darkCount/total*100)}%</span>
        <span>Light ${Math.round(lightCount/total*100)}%</span>
      </div>
    </div>` : ''}
    `;

    modal.classList.remove('hidden');

    // Animate bars after paint
    requestAnimationFrame(() => {
        body.querySelectorAll('.ins-bar-fill[data-w]').forEach(el => {
            el.style.width = el.dataset.w + '%';
        });
    });
}

// ── Palette poster export (Canvas PNG) ───────────────────────
function exportPalettePoster(snap) {
    const s = snap.schema || {};
    const colors = [
        { label:'primary',  hex: s.primaryColor },
        { label:'accent',   hex: s.accentColor },
        { label:'surface',  hex: s.surfaceColor },
        { label:'elevated', hex: s.elevatedSurface },
        { label:'text',     hex: s.textColor },
        { label:'muted',    hex: s.mutedText },
    ].filter(c => isHex(c.hex));

    if (!colors.length) { alert('No palette data for this snap.'); return; }

    const W = 820, H = 400, PAD = 40;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // Background + subtle gradient
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0,   '#07090f');
    bgGrad.addColorStop(1,   '#0d1224');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Accent glow behind first swatch
    if (colors[0]) {
        const glow = ctx.createRadialGradient(PAD + 55, 200, 0, PAD + 55, 200, 180);
        glow.addColorStop(0,   colors[0].hex + '28');
        glow.addColorStop(1,   'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
    }

    // Site name
    ctx.font = 'bold 26px system-ui,-apple-system,sans-serif';
    ctx.fillStyle = '#eef1fb';
    ctx.fillText(snap.siteName || 'Design Palette', PAD, 54);

    // Date + vibe
    const date = new Date(snap.timestamp).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });
    const sub  = [date, s.vibe].filter(Boolean).join(' · ');
    ctx.font = '14px system-ui,-apple-system,sans-serif';
    ctx.fillStyle = '#7a82a3';
    ctx.fillText(sub, PAD, 78);

    // Divider
    ctx.strokeStyle = 'rgba(120,150,230,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, 96); ctx.lineTo(W - PAD, 96); ctx.stroke();

    // Swatches
    const sw = Math.min(110, Math.floor((W - PAD * 2 - (colors.length - 1) * 14) / colors.length));
    const sh = 130, sy = 120;
    const totalW = colors.length * sw + (colors.length - 1) * 14;
    const sx0 = (W - totalW) / 2;

    colors.forEach((c, i) => {
        const x = sx0 + i * (sw + 14);
        // Rounded swatch
        ctx.beginPath();
        const r = 12;
        ctx.moveTo(x + r, sy); ctx.lineTo(x + sw - r, sy);
        ctx.quadraticCurveTo(x + sw, sy, x + sw, sy + r);
        ctx.lineTo(x + sw, sy + sh - r);
        ctx.quadraticCurveTo(x + sw, sy + sh, x + sw - r, sy + sh);
        ctx.lineTo(x + r, sy + sh);
        ctx.quadraticCurveTo(x, sy + sh, x, sy + sh - r);
        ctx.lineTo(x, sy + r);
        ctx.quadraticCurveTo(x, sy, x + r, sy);
        ctx.closePath();
        ctx.fillStyle = c.hex;
        ctx.fill();

        const cx = x + sw / 2;
        ctx.textAlign = 'center';
        ctx.font = '600 10px system-ui,-apple-system,sans-serif';
        ctx.fillStyle = 'rgba(122,130,163,0.85)';
        ctx.fillText(c.label.toUpperCase(), cx, sy + sh + 18);
        ctx.font = '500 12px "Courier New",monospace';
        ctx.fillStyle = '#aab2d0';
        ctx.fillText(c.hex.toUpperCase(), cx, sy + sh + 34);
        ctx.textAlign = 'left';
    });

    // Font info
    const fontStr = [s.headingFont, s.bodyFont].filter(Boolean).join(' · ');
    if (fontStr) {
        ctx.font = '13px system-ui,-apple-system,sans-serif';
        ctx.fillStyle = '#4a5068';
        ctx.fillText(fontStr, PAD, H - 28);
    }

    // UIDrop brand
    ctx.font = 'bold 12px system-ui,-apple-system,sans-serif';
    ctx.fillStyle = '#4a5068';
    ctx.textAlign = 'right';
    ctx.fillText('UIDrop', W - PAD, H - 28);
    ctx.textAlign = 'left';

    const a = document.createElement('a');
    a.download = `${(snap.siteName || 'palette').replace(/[^a-z0-9]/gi,'-').toLowerCase()}-palette.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
}

// ── Boot ──────────────────────────────────────────────────────
init();
