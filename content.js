let currentUrl = location.href;
let notesCache = {};

console.log("ZNT: Extension Loaded", window.location.href);

createModal(); // Initialize note edit modal
createExportModal(); // Initialize export output modal

// --- GENERIC HELPERS ---

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function saveNote(zpid, text, callback) {
  if (!zpid) return;
  chrome.storage.local.set({ [zpid]: text }, () => {
    notesCache[zpid] = text;
    if (callback) callback();
  });
}

// --- ZILLOW PARSING HELPERS ---

function getZpidFromUrl(url) {
  if (!url) return null;
  try {
    const m1 = url.match(/\/(\d+)_zpid/);
    if (m1) return m1[1];
    const u = new URL(url, window.location.origin);
    const param = u.searchParams.get('zpid');
    if (param && /^\d+$/.test(param)) return param;
  } catch (e) {}
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical && canonical.href) {
    const m2 = canonical.href.match(/\/(\d+)_zpid/);
    if (m2) return m2[1];
  }
  return null;
}

function extractZpidFromCard(card) {
  if (!card) return null;
  const compareInput = card.querySelector('input[type="checkbox"][name]');
  if (compareInput && /^\d+$/.test(compareInput.name)) return compareInput.name;

  const link = card.querySelector('a[href*="_zpid"]');
  if (link) {
    const m = (link.getAttribute('href') || '').match(/(\d+)_zpid/);
    if (m) return m[1];
  }

  const dz = card.getAttribute && card.getAttribute('data-zpid');
  if (dz && /^\d+$/.test(dz)) return dz;

  const m3 = (card.id || '').match(/zpid_(\d+)/);
  if (m3) return m3[1];

  return null;
}

// --- DATA LOADING ---

function loadNotesCache(done) {
  chrome.storage.local.get(null, (all) => {
    notesCache = all || {};
    if (typeof done === 'function') done();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  Object.keys(changes).forEach((key) => {
    if (changes[key].newValue === undefined) delete notesCache[key];
    else notesCache[key] = changes[key].newValue;
  });

  injectListingIndicators();

  const zpid = getZpidFromUrl(window.location.href);
  const textarea = document.getElementById('znt-note-area');
  if (textarea && zpid && document.activeElement !== textarea) {
    textarea.value = notesCache[zpid] || '';
  }
});

// --- UI COMPONENT FACTORY (DRY) ---

function createNoteBoxUI(zpid, initialText) {
  const container = document.createElement('div');
  container.id = 'znt-details-container';
  container.className = 'znt-note-container';
  container.innerHTML = `
    <div class="znt-title">My Private Note</div>
    <textarea id="znt-note-area" class="znt-textarea" placeholder="Enter your thoughts..."></textarea>
    <div style="display:flex; align-items:center; gap:8px;">
        <button id="znt-save-btn" class="znt-save-btn">Save Note</button>
        <span id="znt-msg" class="znt-status-msg" aria-live="polite">Note Saved!</span>
    </div>
  `;

  const textarea = container.querySelector('#znt-note-area');
  const saveBtn = container.querySelector('#znt-save-btn');
  const msg = container.querySelector('#znt-msg');

  textarea.value = initialText || '';

  saveBtn.addEventListener('click', () => {
    saveNote(zpid, textarea.value, () => {
      msg.classList.add('visible');
      setTimeout(() => msg.classList.remove('visible'), 2000);
    });
  });

  return container;
}

// --- FEATURE 1: DETAILS PAGE ---

async function injectDetailsNote() {
  const zpid = getZpidFromUrl(window.location.href);
  if (!zpid) return;

  const existing = document.getElementById('znt-details-container');
  if (existing) {
    const ta = existing.querySelector('#znt-note-area');
    if (ta && ta.value !== (notesCache[zpid] || '') && document.activeElement !== ta) {
      ta.value = notesCache[zpid] || '';
    }
    return;
  }

  const placementTargets = [
    {
      sel: '.layout-sticky-content',
      method: 'append',
      refine: (el) => el.querySelector('div[class*="Flex"]') || el
    },
    {
      sel: '.layout-static-column-container',
      method: 'after_child',
      refine: (el) => el.firstElementChild
    },
    { sel: '.ds-data-col', method: 'prepend' },
    { sel: '[data-testid="property-overview"]', method: 'after' }
  ];

  let target = null;
  let method = 'append';
  let referenceNode = null;

  for (const strategy of placementTargets) {
    const el = document.querySelector(strategy.sel);
    if (el) {
      if (strategy.method === 'after_child') {
        const child = strategy.refine ? strategy.refine(el) : null;
        if (child) {
          target = el;
          referenceNode = child.nextSibling;
          method = 'insertBefore';
        } else {
          target = el;
          method = 'prepend';
        }
      } else {
        target = strategy.refine ? strategy.refine(el) : el;
        method = strategy.method;
      }
      break;
    }
  }

  if (!target) return;

  const ui = createNoteBoxUI(zpid, notesCache[zpid]);
  ui.classList.add('znt-sidebar-style');

  if (method === 'insertBefore' && referenceNode) {
    target.insertBefore(ui, referenceNode);
  } else if (method === 'after') {
    target.parentNode.insertBefore(ui, target.nextSibling);
  } else if (method === 'prepend') {
    target.prepend(ui);
  } else {
    target.appendChild(ui);
  }
}

// --- FEATURE 2: LISTING CARDS & MODAL ---

function createModal() {
  if (document.getElementById('znt-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'znt-modal-overlay';
  overlay.className = 'znt-modal-overlay';
  overlay.innerHTML = `
    <div class="znt-modal-content">
        <div class="znt-modal-header">
            <div class="znt-title">Edit Note</div>
            <button id="znt-modal-close" class="znt-modal-close">&times;</button>
        </div>
        <textarea id="znt-modal-textarea" class="znt-textarea" placeholder="Enter your note..."></textarea>
        <div style="text-align: right;">
            <button id="znt-modal-save" class="znt-save-btn">Save Note</button>
        </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeBtn = overlay.querySelector('#znt-modal-close');
  const saveBtn = overlay.querySelector('#znt-modal-save');
  const textarea = overlay.querySelector('#znt-modal-textarea');

  const closeModal = () => {
    overlay.classList.remove('open');
    overlay.dataset.activeZpid = '';
  };

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

  saveBtn.addEventListener('click', () => {
    const zpid = overlay.dataset.activeZpid;
    if (zpid) saveNote(zpid, textarea.value, closeModal);
  });
}

function openModal(zpid) {
  const overlay = document.getElementById('znt-modal-overlay');
  const textarea = document.getElementById('znt-modal-textarea');
  if (!overlay || !textarea) return;

  overlay.dataset.activeZpid = zpid;
  textarea.value = notesCache[zpid] || '';
  overlay.classList.add('open');
  textarea.focus();
}

function injectListingIndicators() {
  const selector = 'article, li[class*="ListItem-"], [data-test="property-card"], [class*="result-list-card"], [class*="search-list-item"], [data-testid="PropertyListCard-wrapper"]';
  const cards = document.querySelectorAll(selector);

  cards.forEach(card => {
    const zpid = extractZpidFromCard(card);
    if (!zpid) return;

    let annotation = card.querySelector('.znt-card-annotation');
    if (!annotation) {
      annotation = document.createElement('div');
      annotation.className = 'znt-card-annotation';
      annotation.innerHTML = `
        <div class="znt-card-icon" title="Click to edit note">✎</div>
        <span class="znt-snippet"></span>
        <div class="znt-tooltip"></div>
      `;

      const imageWrapper = card.querySelector('[class*="Photo"]') || card.querySelector('.list-card-top') || card;
      if (window.getComputedStyle(imageWrapper).position === 'static') {
        imageWrapper.style.position = 'relative';
      }
      imageWrapper.appendChild(annotation);

      annotation.querySelector('.znt-card-icon').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openModal(zpid);
      });
    }

    const noteText = notesCache[zpid] || '';
    const icon = annotation.querySelector('.znt-card-icon');
    const snippet = annotation.querySelector('.znt-snippet');
    const tooltip = annotation.querySelector('.znt-tooltip');

    if (noteText.trim().length > 0) {
      if (!icon.classList.contains('has-note')) icon.classList.add('has-note');

      const newSnippetText = noteText.length > 25 ? noteText.substring(0, 25) + '...' : noteText;
      if (snippet.textContent !== newSnippetText) snippet.textContent = newSnippetText;

      if (!snippet.classList.contains('visible')) snippet.classList.add('visible');
      if (tooltip.textContent !== noteText) tooltip.textContent = noteText;
    } else {
      if (icon.classList.contains('has-note')) icon.classList.remove('has-note');
      if (snippet.classList.contains('visible')) snippet.classList.remove('visible');

      const emptyText = "Click to add a note";
      if (tooltip.textContent !== emptyText) tooltip.textContent = emptyText;
    }
  });
}

// --- FEATURE 3: EXPORT TOOL ---

function createExportModal() {
  if (document.getElementById('znt-export-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'znt-export-modal';
  modal.className = 'znt-modal-overlay';
  modal.innerHTML = `
    <div class="znt-modal-content" style="max-width: 600px;">
        <div class="znt-modal-header">
            <div class="znt-title">Export Listings</div>
            <button id="znt-export-close" class="znt-modal-close">&times;</button>
        </div>
        <p style="margin-bottom:10px; color:#666; font-size:14px;">
           Ready to copy! Paste this directly into your email.
        </p>
        <textarea id="znt-export-area" class="znt-textarea" style="height: 300px; font-family: monospace; font-size: 12px; white-space: pre;"></textarea>
        <div style="text-align: right;">
            <button id="znt-copy-btn" class="znt-save-btn">Copy to Clipboard</button>
        </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#znt-export-close');
  const copyBtn = modal.querySelector('#znt-copy-btn');
  const area = modal.querySelector('#znt-export-area');
  const close = () => modal.classList.remove('open');

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  copyBtn.addEventListener('click', () => {
    area.select();
    document.execCommand('copy');
    copyBtn.innerText = "Copied!";
    setTimeout(() => copyBtn.innerText = "Copy to Clipboard", 2000);
  });
}

function collectListingData() {
  const selector = 'article, li[class*="ListItem-"], [data-test="property-card"], [class*="result-list-card"]';
  const cards = document.querySelectorAll(selector);
  let exportLines = [];

  cards.forEach(card => {
    const zpid = extractZpidFromCard(card);
    if (!zpid) return;

    // Scrape Data
    // const priceEl = card.querySelector('[data-test="property-card-price"], .list-card-price, span[class*="PropertyCardWrapper__StyledPrice"]');
    const priceEl = card.querySelector('[data-testid="data-price-row"]');
    const addrEl = card.querySelector('address, [data-test="property-card-addr"], .list-card-addr');
    const linkEl = card.querySelector('a[href*="_zpid"]');

    const price = priceEl ? priceEl.textContent.trim() : "Price N/A";
    const address = addrEl ? addrEl.textContent.trim() : "Address N/A";
    const link = linkEl ? linkEl.href : `https://www.zillow.com/homedetails/${zpid}_zpid/`;
    const myNote = notesCache[zpid] ? notesCache[zpid].trim() : null;

    // Only export if we have a note OR it's a valid card (Optional: remove 'true' to only export commented homes)
    if (true) {
      let block = `${address} (${price})\n${link}`;
      if (myNote) {
        block += `\nMY NOTES: ${myNote}`;
      }
      exportLines.push(block);
    }
  });

  if (exportLines.length === 0) return "No listings found on this page.";

  return `Here is the list of homes I'm interested in:\n\n` + exportLines.join('\n\n---------------------------------\n\n');
}

function createExportButton() {
  if (document.getElementById('znt-export-trigger')) return;

  const btn = document.createElement('button');
  btn.id = 'znt-export-trigger';
  btn.innerText = "Export Page";
  btn.className = 'znt-save-btn'; // Reuse existing style
  btn.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 9999;
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    padding: 12px 20px;
    font-weight: bold;
  `;

  btn.addEventListener('click', () => {
    const text = collectListingData();
    const modal = document.getElementById('znt-export-modal');
    const area = document.getElementById('znt-export-area');
    area.value = text;
    modal.classList.add('open');
  });

  document.body.appendChild(btn);
}

// --- INIT & OBSERVER ---

function init() {
  loadNotesCache(() => {
    if (window.location.href.includes('/homedetails/')) injectDetailsNote();
    injectListingIndicators();
    // Only add export button on search results/map pages, not individual details pages
    if (!window.location.href.includes('/homedetails/')) createExportButton();
  });
}

const observer = new MutationObserver(debounce(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    init();
  } else {
    injectListingIndicators();
    if (window.location.href.includes('/homedetails/')) injectDetailsNote();
    if (!document.getElementById('znt-export-trigger') && !window.location.href.includes('/homedetails/')) createExportButton();
  }
}, 500));

observer.observe(document.body, { childList: true, subtree: true });

init();
