// ── ExtensionPay ──────────────────────────────────────────────
// Download ExtPay.js from https://extensionpay.com and place it
// in the extension root folder alongside this file.
importScripts('ExtPay.js');
const extpay = ExtPay('uidrop'); // ← replace 'uidrop' with your ExtensionPay app name
extpay.startBackground();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "takeScreenshot") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.captureVisibleTab(
        tabs[0].windowId,
        { format: "png", quality: 90 },
        (dataUrl) => {
          if (chrome.runtime.lastError) sendResponse({ error: chrome.runtime.lastError.message });
          else sendResponse({ screenshot: dataUrl });
        }
      );
    });
    return true;
  }

  if (message.action === "openWithPrompt") {
    openAndInject(message).catch(err => console.warn('UIDrop: open failed', err));
    return false;
  }
});

async function openAndInject({ target, url, prompt, screenshot }) {
  const tab = await chrome.tabs.create({ url });

  await waitForTabComplete(tab.id);
  await new Promise(r => setTimeout(r, 2500));

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectPromptIntoEditor,
      args: [prompt, screenshot, target]
    });
    console.log('UIDrop: inject result', result?.result);
  } catch (e) {
    console.warn('UIDrop: executeScript failed', e);
  }
}

function waitForTabComplete(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function injectPromptIntoEditor(text, imageDataUrl, target) {
  // ── 1. Find the editor ──
  const selectors = target === 'claude'
    ? ['div.ProseMirror[contenteditable="true"]',
       'div[contenteditable="true"][role="textbox"]']
    : (target === 'lovable' || target === 'manus')
    ? ['textarea[placeholder]', 'textarea',
       'div[contenteditable="true"]']
    : ['#prompt-textarea[contenteditable="true"]',
       'div.ProseMirror[contenteditable="true"]',
       'div[contenteditable="true"][role="textbox"]',
       'textarea'];

  let editor = null;
  for (let i = 0; i < 30 && !editor; i++) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth > 100 && el.offsetHeight > 20) { editor = el; break; }
    }
    if (!editor) await new Promise(r => setTimeout(r, 200));
  }

  if (!editor) {
    // Editor missing — fall back to clipboard so user can paste themselves
    try { await navigator.clipboard.writeText(text); } catch (e) {}
    console.warn('[UIDrop] Editor not found — text copied to clipboard, press Ctrl+V');
    return { success: false, reason: 'no-editor' };
  }

  // ── 2. Insert text — exactly ONE method, no fallback chain ──
  editor.focus();

  if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
    // Native input/textarea: set value via prototype setter so React picks it up
    const proto = editor.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    // Contenteditable (ProseMirror etc.): single paste event ONLY.
    // Previously had execCommand('insertText') + paste fallback — Claude's
    // ProseMirror sometimes responded to both, inserting the text 2-3 times.
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    editor.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt
    }));
  }

  // ── 3. Attach screenshot (if any) — single paste with explicit PNG type ──
  if (imageDataUrl) {
    try {
      const res  = await fetch(imageDataUrl);
      const blob = await res.blob();
      // Explicit name + MIME so Claude recognises it as an image, not a generic File
      const file = new File([blob], 'uidrop-screenshot.png', { type: 'image/png' });
      const dt   = new DataTransfer();
      dt.items.add(file);
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt
      }));
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      console.warn('[UIDrop] image attach failed', e);
    }
  }

  return { success: true };
}
