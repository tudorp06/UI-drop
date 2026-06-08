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
// Storage keys are deliberately obscure — slows down casual snooping.
const K_USAGE   = '_uds_u';
const K_LICENSE = '_uds_lk';   // stores { key, lastValidatedAt, productId }
const K_PROCACHE = '_uds_pc';  // stores { ok, ts } — 30 min cache to avoid hammering Polar

const PRO_CACHE_TTL = 30 * 60 * 1000;   // 30 minutes
const PRO_REVALIDATE = 24 * 60 * 60 * 1000;  // force re-check every 24h even if cached

async function getUsage() {
  const obj = await chrome.storage.local.get(K_USAGE);
  return obj[K_USAGE] || {};
}
async function setUsage(u) { return chrome.storage.local.set({ [K_USAGE]: u }); }

async function getLicense() {
  const obj = await chrome.storage.local.get(K_LICENSE);
  return obj[K_LICENSE] || null;
}

// Critical: isPro() does NOT trust any local boolean. It requires:
//   1. A real license key stored under K_LICENSE
//   2. A recent positive validation from Polar (cached up to 30min, hard-revalidate every 24h)
// Setting "license: { valid: true }" from devtools does nothing here — there's
// no "valid" field we read. Only a real Polar API response unlocks Pro.
async function isPro() {
  const lic = await getLicense();
  if (!lic || typeof lic.key !== 'string' || lic.key.length < 8) return false;

  // Check cache
  const cacheObj = await chrome.storage.local.get(K_PROCACHE);
  const cache = cacheObj[K_PROCACHE];
  const now = Date.now();
  if (cache && cache.ok === true && cache.keyHash === simpleHash(lic.key) &&
      (now - cache.ts) < PRO_CACHE_TTL) {
    return true;
  }

  // Cache stale or missing — re-validate against Polar
  return await revalidateLicense(lic.key);
}

// Tiny non-crypto hash — just to detect tampering of the cache (someone
// can't drop in a fake cache entry without also forging the keyHash).
function simpleHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

async function revalidateLicense(key) {
  if (!key) return false;
  // Don't even try if Polar isn't configured
  if (POLAR.organizationId.startsWith('__')) return false;

  try {
    const body = { key: key.trim(), organization_id: POLAR.organizationId };
    if (POLAR.productId && !POLAR.productId.startsWith('__')) body.product_id = POLAR.productId;

    const res = await fetch(POLAR.validateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const ok = res.ok && data.status === 'granted';

    // Cache the result (positive or negative) for PRO_CACHE_TTL
    await chrome.storage.local.set({
      [K_PROCACHE]: { ok, ts: Date.now(), keyHash: simpleHash(key) }
    });

    if (ok) {
      // Update license record with latest validation timestamp
      await chrome.storage.local.set({
        [K_LICENSE]: { key: key.trim(), lastValidatedAt: Date.now(), productId: POLAR.productId }
      });
    }
    return ok;
  } catch (e) {
    // Network failure — fall back to most recent positive cache if within
    // 24h grace window (so airplane-mode Pro users don't get locked out)
    const cacheObj = await chrome.storage.local.get(K_PROCACHE);
    const cache = cacheObj[K_PROCACHE];
    if (cache?.ok && (Date.now() - cache.ts) < PRO_REVALIDATE) return true;
    return false;
  }
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
  await setUsage(usage);
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

// ── License validation entry point (called from license-key input flow) ─────
// Uses the same revalidateLicense() logic — Polar is the only source of truth.
async function validateLicenseKey(key) {
  if (!key || key.length < 8) return { ok: false, error: 'Invalid key format' };
  if (POLAR.organizationId.startsWith('__')) return { ok: false, error: 'Polar not configured' };

  // Persist the candidate key first so revalidateLicense can hash it
  await chrome.storage.local.set({
    [K_LICENSE]: { key: key.trim(), lastValidatedAt: 0, productId: POLAR.productId }
  });
  const ok = await revalidateLicense(key.trim());
  if (ok) {
    refreshAllBadges();
    refreshTrialBar();
    hidePaywall();
    return { ok: true };
  }
  // Validation failed — wipe the rejected key so we don't keep retrying
  await chrome.storage.local.remove([K_LICENSE, K_PROCACHE]);
  return { ok: false, error: 'License key not recognised by Polar' };
}

async function clearLicense() {
  await chrome.storage.local.remove([K_LICENSE, K_PROCACHE]);
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

// One-time migration from old storage shape (v1.5.0 → secured).
// If user had a real license key, it survives. If they only had {valid:true}
// without a real key, it's wiped — they need to enter their Polar key.
async function migrateLegacyStorage() {
  const old = await chrome.storage.local.get(['license', 'usage']);
  if (old.license && typeof old.license.key === 'string' && old.license.key.length >= 8) {
    await chrome.storage.local.set({
      [K_LICENSE]: { key: old.license.key, lastValidatedAt: 0, productId: POLAR.productId }
    });
  }
  if (old.usage && typeof old.usage === 'object') {
    const existingNew = await getUsage();
    if (Object.keys(existingNew).length === 0) await setUsage(old.usage);
  }
  await chrome.storage.local.remove(['license', 'usage']);
}

// ── Wire paywall buttons on DOM ready ───────────────────────────────────────
function initGate() {
  // Run migration + a background re-validation on every library load.
  // This forces a fresh Polar check at the start of every session.
  migrateLegacyStorage().then(async () => {
    const lic = await getLicense();
    if (lic?.key) revalidateLicense(lic.key).then(() => {
      refreshAllBadges();
      refreshTrialBar();
    });
  });

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
