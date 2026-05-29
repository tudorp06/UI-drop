// ============================================================
// UIDrop — library.js  (Snap Library)
// ============================================================

let allSnaps      = [];
let filteredSnaps = [];
let selectedIds   = new Set();   // max 2 when in compare mode
let compareModeOn = false;
let viewMode      = 'grid';      // 'grid' | 'moodboard'
let starredOnly   = false;

// ── ExtensionPay ─────────────────────────────────────────────
const extpay = ExtPay('uidrop'); // ← same app name as background.js

// ── Init ────────────────────────────────────────────────────
async function init() {
    // ── Payment gate ──────────────────────────────────────────
    let user;
    try { user = await extpay.getUser(); } catch (e) { user = { paid: false }; }

    if (!user.paid) {
        showPayGate();
        return;  // stop — don't load library content for unpaid users
    }

    // ── Paid — load library normally ──────────────────────────
    const { snapHistory = [] } = await chrome.storage.local.get('snapHistory');
    allSnaps      = snapHistory;
    filteredSnaps = [...allSnaps];

    renderGrid();

    document.getElementById('searchInput')      .addEventListener('input',  onSearch);
    document.getElementById('compareModeBtn')   .addEventListener('click',  toggleCompareMode);
    document.getElementById('cancelCompareMode').addEventListener('click',  exitCompareMode);
    document.getElementById('goCompare')        .addEventListener('click',  openCompare);
    document.getElementById('backBtn')          .addEventListener('click',  backToGrid);
    document.getElementById('detailBackBtn')    .addEventListener('click',  closeDetail);
    document.getElementById('starFilterBtn')    .addEventListener('click',  toggleStarFilter);
    document.getElementById('viewToggleBtn')    .addEventListener('click',  toggleViewMode);
}

function showPayGate() {
    document.getElementById('payGate').classList.remove('hidden');

    document.getElementById('payBtn').addEventListener('click', () => {
        extpay.openPaymentPage();
    });
    document.getElementById('payLoginBtn').addEventListener('click', () => {
        extpay.openLoginPage();
    });

    // Re-check after the payment tab closes — user might have just paid
    extpay.onPaid.addListener(() => {
        document.getElementById('payGate').classList.add('hidden');
        init();
    });
}

// ── Search ───────────────────────────────────────────────────
function onSearch(e) {
    applyFilters(e.target.value.trim().toLowerCase());
}

function applyFilters(q = document.getElementById('searchInput').value.trim().toLowerCase()) {
    let base = starredOnly ? allSnaps.filter(s => s.starred) : [...allSnaps];
    filteredSnaps = q
        ? base.filter(s =>
            s.siteName?.toLowerCase().includes(q) ||
            s.pageTitle?.toLowerCase().includes(q) ||
            s.recommendation?.some(r => r.type?.toLowerCase().includes(q))
          )
        : base;
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
    grid.innerHTML = filteredSnaps.map(snapCardHTML).join('');

    grid.querySelectorAll('.snap-card').forEach(card => {
        const id = card.dataset.id;
        card.querySelector('.snap-star').addEventListener('click', e => {
            e.stopPropagation();
            toggleStar(id);
        });
        // Trash button — always available, never enters compare/detail flow
        card.querySelector('.snap-del').addEventListener('click', e => {
            e.stopPropagation();
            deleteSnap(id);
        });
        // Clicking the checkbox toggles selection (compare mode only)
        card.querySelector('.snap-check').addEventListener('click', e => {
            e.stopPropagation();
            if (compareModeOn) toggleSelect(id);
        });
        // Normal mode → open detail view. Compare mode → toggle selection.
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

    const thumbHTML = snap.thumbnail
        ? `<img class="snap-thumb" src="${snap.thumbnail}" alt="${escHtml(snap.siteName)}" loading="lazy"/>`
        : `<div class="snap-thumb-ph">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="M21 15l-5-5L5 21"/>
            </svg>
           </div>`;

    return `
    <div class="snap-card${isSelected ? ' selected' : ''}" data-id="${snap.id}">
      ${thumbHTML}
      <button class="snap-del" title="Remove snap">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>
        </svg>
      </button>
      <div class="snap-check">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="snap-body">
        <div class="snap-site-row">
          <div class="snap-site">${escHtml(snap.siteName || 'Unknown site')}</div>
          <button class="snap-star${snap.starred ? ' on' : ''}" title="Favourite">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="${snap.starred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </button>
        </div>
        <div class="snap-date">${date}</div>
        <div class="snap-palette">
          ${palette.map(c => `<div class="snap-swatch" style="background:${c}" title="${c}"></div>`).join('')}
        </div>
        <div class="snap-rec-section">
          <span class="snap-rec-label">Good for</span>
          <div class="snap-recs">
            ${recs.slice(0,3).map(r =>
                `<span class="snap-rec">${escHtml(r.type)}</span>`
            ).join('') || '<span class="snap-rec muted">—</span>'}
          </div>
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
           <div class="detail-export-label">Export as</div>
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
           </div>
           <div class="detail-send-label">Send to</div>
           <div class="detail-send-row">
             <button class="detail-send-btn dsb-claude" id="detailBtnClaude">
               <div class="dsb-icon"><img src="icons/claude-logo-64.png" class="dsb-logo" alt="Claude"/></div>
               Claude
             </button>
             <button class="detail-send-btn dsb-cursor" id="detailBtnCursor">
               <div class="dsb-icon dsb-icon-dark"><img src="icons/cursor-logo-64.png" class="dsb-logo dsb-logo-sm" alt="Cursor"/></div>
               Cursor
             </button>
             <button class="detail-send-btn dsb-codex" id="detailBtnCodex">
               <div class="dsb-icon dsb-icon-white">
                 <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                   <path d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z" fill="#fff"/>
                   <path d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z" fill="url(#cg)"/>
                   <defs><linearGradient id="cg" gradientUnits="userSpaceOnUse" x1="12" x2="12" y1="3" y2="21"><stop stop-color="#B1A7FF"/><stop offset=".5" stop-color="#7A9DFF"/><stop offset="1" stop-color="#3941FF"/></linearGradient></defs>
                 </svg>
               </div>
               Codex
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

    document.getElementById('detailExportFigma').addEventListener('click', () => {
        navigator.clipboard.writeText(buildFigmaTokens(snap)).then(() => flashExport('detailExportFigma', 'Copied!'));
    });
    document.getElementById('detailExportCSS').addEventListener('click', () => {
        navigator.clipboard.writeText(buildCSSVars(snap)).then(() => flashExport('detailExportCSS', 'Copied!'));
    });
    document.getElementById('detailExportCanva').addEventListener('click', () => {
        navigator.clipboard.writeText(buildCanvaPalette(snap)).then(() => flashExport('detailExportCanva', 'Copied!'));
    });

    // Send to Claude
    document.getElementById('detailBtnClaude').addEventListener('click', () => {
        if (!snap.finalPrompt) return;
        chrome.runtime.sendMessage({
            action: 'openWithPrompt', target: 'claude',
            url: 'https://claude.ai/new', prompt: snap.finalPrompt, screenshot: snap.thumbnail
        });
    });

    // Cursor — just copies to clipboard (same as popup)
    document.getElementById('detailBtnCursor').addEventListener('click', () => {
        if (!snap.finalPrompt) return;
        navigator.clipboard.writeText(snap.finalPrompt).then(() => {
            const btn = document.getElementById('detailBtnCursor');
            const orig = btn.innerHTML;
            btn.innerHTML = '✓ Copied!';
            setTimeout(() => { btn.innerHTML = orig; }, 2000);
        });
    });

    // Codex / ChatGPT
    document.getElementById('detailBtnCodex').addEventListener('click', () => {
        if (!snap.finalPrompt) return;
        chrome.runtime.sendMessage({
            action: 'openWithPrompt', target: 'chatgpt',
            url: 'https://chatgpt.com/', prompt: snap.finalPrompt, screenshot: snap.thumbnail
        });
    });

    // Remove from library
    document.getElementById('detailDelBtn').addEventListener('click', () => {
        deleteSnap(snap.id);
    });

    // Wire up copy button
    document.getElementById('detailCopyBtn').addEventListener('click', () => {
        if (!snap.finalPrompt) return;
        navigator.clipboard.writeText(snap.finalPrompt).then(() => {
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

    document.getElementById('gridView').classList.add('hidden');
    document.getElementById('detailView').classList.remove('hidden');
    window.scrollTo(0, 0);
}

function closeDetail() {
    document.getElementById('detailView').classList.add('hidden');
    document.getElementById('gridView').classList.remove('hidden');
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

        <!-- Good for -->
        <div>
          <div class="cv-section-label">Good for</div>
          <div class="cv-recs">
            ${recs.length
                ? recs.map(r => `<span class="cv-rec">${escHtml(r.type)}</span>`).join('')
                : '<span style="font-size:12px;color:var(--faint)">—</span>'}
          </div>
        </div>

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

// ── Boot ──────────────────────────────────────────────────────
init();
