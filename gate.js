// ── UIDrop · Trial + Polar.sh License Gate ──────────────────────────────────
// Each feature gets 5 free uses. After that → paywall.
// Pro license unlocks everything forever.

const TRIAL_LIMIT = 3;  // per feature · 8 features × 3 = 24 free Pro actions total

// Stable IDs for every gated feature. Used as storage keys + UI badge keys.
// 8 gated features × 3 free uses each = 24 total trial actions before paywall.
// Skill mode + Send-to-AI + Tonal scale + Contrast checker intentionally NOT gated.
const GATED = {
  compare:        { label: 'Compare',         icon: '⇄' },
  exportFigma:    { label: 'Figma Export',    icon: '◆' },
  exportCSS:      { label: 'CSS Export',      icon: '{ }' },
  exportCanva:    { label: 'Canva Export',    icon: '◐' },
  exportTailwind: { label: 'Tailwind Export', icon: '⌽' },
  exportShadcn:   { label: 'shadcn Theme',    icon: '◑' },
  insights:       { label: 'Insights',        icon: '📊' },
  collections:    { label: 'Collections',     icon: '🗂' },
};

// ── Polar.sh config ─────────────────────────────────────────────────────────
// Real values live in gate.config.local.js (gitignored).
// If that file is loaded (via library.html) it sets window.UIDROP_POLAR and
// overrides these placeholders. If not, the paywall buttons show a setup hint.
const POLAR = Object.assign({
  checkoutUrl:    '__REPLACE_WITH_POLAR_CHECKOUT_URL__',
  organizationId: '__REPLACE_WITH_POLAR_ORG_ID__',
  productId:      '__REPLACE_WITH_POLAR_PRODUCT_ID__',
  validateUrl:    'https://api.polar.sh/v1/customer-portal/license-keys/validate',
}, (typeof window !== 'undefined' && window.UIDROP_POLAR) || {});

// ── State accessors ─────────────────────────────────────────────────────────
async function getUsage() {
  const { usage = {} } = await chrome.storage.local.get('usage');
  return usage;
}

async function getLicense() {
  const { license = null } = await chrome.storage.local.get('license');
  return license;
}

async function isPro() {
  const lic = await getLicense();
  return !!(lic && lic.valid === true);
}

// Returns { ok, remaining, used } — ok=true means feature can be used
async function canUse(feature) {
  if (await isPro()) return { ok: true, remaining: Infinity, used: 0, pro: true };
  const usage = await getUsage();
  const used = usage[feature] || 0;
  return { ok: used < TRIAL_LIMIT, remaining: Math.max(0, TRIAL_LIMIT - used), used, pro: false };
}

async function recordUse(feature) {
  if (await isPro()) return;
  const usage = await getUsage();
  usage[feature] = (usage[feature] || 0) + 1;
  await chrome.storage.local.set({ usage });
  refreshAllBadges();
  refreshTrialBar();
}

// Master gate — wrap any gated action with this.
//   await gate('compare', () => openCompareView())
async function gate(feature, action) {
  const c = await canUse(feature);
  if (!c.ok) {
    showPaywall(feature);
    return false;
  }
  await recordUse(feature);
  try { await action(); } catch (e) { console.warn('Gate action failed:', e); }
  return true;
}

// ── License validation (Polar.sh) ───────────────────────────────────────────
async function validateLicenseKey(key) {
  if (!key || key.length < 8) return { ok: false, error: 'Invalid key format' };
  try {
    const body = {
      key: key.trim(),
      organization_id: POLAR.organizationId,
    };
    // Polar accepts an optional benefit_id/product_id scope — include if set
    if (POLAR.productId && !POLAR.productId.startsWith('__')) body.product_id = POLAR.productId;

    const res = await fetch(POLAR.validateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.status === 'granted') {
      const license = { key: key.trim(), valid: true, checkedAt: Date.now(), data };
      await chrome.storage.local.set({ license });
      refreshAllBadges();
      refreshTrialBar();
      hidePaywall();
      return { ok: true };
    }
    return { ok: false, error: data.detail || 'License key not recognised' };
  } catch (e) {
    return { ok: false, error: 'Could not reach Polar (network)' };
  }
}

async function clearLicense() {
  await chrome.storage.local.remove('license');
  refreshAllBadges();
  refreshTrialBar();
}

// Per-button badges removed — too noisy. Counter lives in the trial bar at the top only.
function attachTrialBadge() { /* no-op kept for callsite back-compat */ }
function refreshAllBadges()   { /* no-op */ }

// ── UI: trial progress bar at the top of the library ────────────────────────
async function refreshTrialBar() {
  const bar = document.getElementById('trialBar');
  if (!bar) return;
  if (await isPro()) {
    bar.classList.add('hidden');
    document.body.classList.add('is-pro');
    return;
  }
  document.body.classList.remove('is-pro');
  const usage = await getUsage();
  const total = Object.keys(GATED).length * TRIAL_LIMIT;
  const used  = Object.keys(GATED).reduce((sum, k) => sum + Math.min(TRIAL_LIMIT, usage[k] || 0), 0);
  bar.classList.remove('hidden');
  bar.querySelector('.trial-bar-text').innerHTML =
    `<strong>${used} of ${total}</strong> free Pro actions used`;
  bar.querySelector('.trial-bar-fill').style.width = `${(used / total) * 100}%`;
}

// ── UI: paywall modal ───────────────────────────────────────────────────────
function showPaywall(feature) {
  const m = document.getElementById('paywall');
  if (!m) return;
  // Headline stays static — clean and uncluttered. Sub-line names the feature.
  const featLabel = GATED[feature]?.label || 'this feature';
  const sub = m.querySelector('.paywall-sub');
  if (sub) sub.textContent = `${featLabel} is locked. Unlock the whole Snap Library for $3, one-time.`;
  m.classList.remove('hidden');
}

function hidePaywall() {
  document.getElementById('paywall')?.classList.add('hidden');
}

function openCheckout() {
  if (POLAR.checkoutUrl.startsWith('__REPLACE')) {
    alert('Polar checkout URL not configured yet. See POLAR_SETUP.md');
    return;
  }
  chrome.tabs.create({ url: POLAR.checkoutUrl });
}

function showLicenseInput() {
  const m = document.getElementById('paywall');
  if (!m) return;
  m.querySelector('.paywall-default').classList.add('hidden');
  m.querySelector('.paywall-license').classList.remove('hidden');
  setTimeout(() => m.querySelector('#licenseKeyInput')?.focus(), 50);
}

function showPaywallDefault() {
  const m = document.getElementById('paywall');
  if (!m) return;
  m.querySelector('.paywall-default').classList.remove('hidden');
  m.querySelector('.paywall-license').classList.add('hidden');
  const err = m.querySelector('.paywall-license-error');
  if (err) err.textContent = '';
}

async function submitLicenseKey() {
  const input = document.getElementById('licenseKeyInput');
  const err   = document.querySelector('.paywall-license-error');
  const btn   = document.getElementById('licenseSubmitBtn');
  if (!input || !btn) return;
  const key = input.value.trim();
  if (!key) { err.textContent = 'Paste your license key first'; return; }
  btn.disabled = true; btn.textContent = 'Checking…';
  const result = await validateLicenseKey(key);
  btn.disabled = false; btn.textContent = 'Activate';
  if (result.ok) {
    err.textContent = '';
    showPaywallToast('✓ Pro unlocked — enjoy.');
  } else {
    err.textContent = result.error || 'Invalid key';
  }
}

function showPaywallToast(msg) {
  const t = document.createElement('div');
  t.className = 'paywall-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// ── Wire paywall buttons on DOM ready ───────────────────────────────────────
function initGate() {
  document.getElementById('paywallBuyBtn')?.addEventListener('click', openCheckout);
  document.getElementById('paywallLicenseBtn')?.addEventListener('click', showLicenseInput);
  document.getElementById('paywallBackBtn')?.addEventListener('click', showPaywallDefault);
  document.getElementById('licenseSubmitBtn')?.addEventListener('click', submitLicenseKey);
  document.getElementById('paywallCloseBtn')?.addEventListener('click', hidePaywall);
  document.getElementById('trialBarUpgrade')?.addEventListener('click', () => showPaywall('compare'));

  // Close paywall on backdrop click
  document.getElementById('paywall')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) hidePaywall();
  });

  refreshTrialBar();
}

// Expose for library.js
window.UIDropGate = { gate, canUse, isPro, attachTrialBadge, refreshAllBadges, refreshTrialBar, initGate, validateLicenseKey, clearLicense };
