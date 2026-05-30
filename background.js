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

  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.warn('[UIDrop] Could not write to clipboard:', e);
  }

  const selectors = target === 'claude'
    ? [
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'fieldset div[contenteditable="true"]',
        'div[contenteditable="true"]'
      ]
    : target === 'lovable'
    ? [
        'textarea[placeholder]',
        'textarea',
        'div[contenteditable="true"]'
      ]
    : target === 'manus'
    ? [
        'textarea[placeholder]',
        'textarea',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]'
      ]
    : [
        '#prompt-textarea[contenteditable="true"]',
        'div.ProseMirror[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]'
      ];

  let editor = null;
  for (let i = 0; i < 30 && !editor; i++) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().width > 100 && el.getBoundingClientRect().height > 20) {
        editor = el;
        break;
      }
    }
    if (!editor) await new Promise(r => setTimeout(r, 200));
  }

  if (!editor) {
    console.warn('[UIDrop] Editor not found after 6s — text is in clipboard, press Ctrl+V');
    return { success: false, reason: 'no-editor', clipboardOK: true };
  }

  editor.focus();

  // Native textarea — set value directly and fire input event
  if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
                   || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSet) nativeSet.call(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // contenteditable — use execCommand then paste event fallback
    try {
      const sel = window.getSelection();
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.addRange(range);
    } catch (e) {}

    let inserted = false;
    try { inserted = document.execCommand('insertText', false, text); } catch (e) {}
    if (!inserted) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        editor.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt
        }));
      } catch (e) {}
    }
  }

  if (imageDataUrl) {
    try {
      const res = await fetch(imageDataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'uidrop-screenshot', { type: blob.type || 'image/png' });

      // Single paste only — no DOM verification, no fallback.
      // The hasImage check used editor.closest('form') but Claude renders
      // attachment previews outside the form, so it always returned null,
      // causing the file-input fallback to fire as well → two images sent.
      const dt = new DataTransfer();
      dt.items.add(file);
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, clipboardData: dt
      }));

      // Give Claude time to process the paste before the script exits.
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      console.warn('[UIDrop] image attach failed', e);
    }
  }

  return { success: true, inserted, clipboardOK: true };
}
