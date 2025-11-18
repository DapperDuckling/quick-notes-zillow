let currentUrl = location.href;

// Debounce function to prevent excessive DOM checking on scroll/dynamic load
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Core initialization logic
function init() {
  const isDetailsPage = window.location.href.includes('/homedetails/');
  const isSearchOrFavorites = window.location.href.includes('/homes/') ||
    window.location.href.includes('/myzillow/favorites') ||
    document.querySelector('.search-page-list-container');

  if (isDetailsPage) {
    injectDetailsNote();
  }

  // We run this on both specific listing pages (because "Nearby homes" might appear)
  // and search pages
  injectListingIndicators();
}

// --- FEATURE 1: INDIVIDUAL LISTING PAGE ---

async function injectDetailsNote() {
  // Prevent duplicate injection
  if (document.getElementById('znt-details-container')) return;

  // Extract ZPID from URL
  // Format usually: zillow.com/homedetails/address/ZPID_zpid/
  const zpidMatch = window.location.href.match(/\/(\d+)_zpid/);
  if (!zpidMatch) return;
  const zpid = zpidMatch[1];

  // Selector Logic:
  // Zillow changes structure often. We look for the main data column on the layout.
  // Common containers include data-testid="home-details-chip-container" or classes containing 'layout-container'.
  // We aim to insert below the "summary" or "facts" area.
  // Attempt 1: The main layout container column
  let targetContainer = document.querySelector('[data-testid="home-details-chip-container"]');

  // Attempt 2: Fallback to specific fact-rail if main chip container is missing
  if (!targetContainer) {
    targetContainer = document.querySelector('.ds-data-col');
  }

  if (!targetContainer) return;

  // Create UI Elements
  const container = document.createElement('div');
  container.id = 'znt-details-container';
  container.className = 'znt-note-container';

  container.innerHTML = `
        <div class="znt-title">My Private Note</div>
        <textarea id="znt-note-area" class="znt-textarea" placeholder="Enter your thoughts about this property..."></textarea>
        <div style="display:flex; align-items:center;">
            <button id="znt-save-btn" class="znt-save-btn">Save Note</button>
            <span id="znt-msg" class="znt-status-msg">Note Saved!</span>
        </div>
    `;

  // Insert immediately as the first child of the data column, or append if preferred.
  // Prepending ensures it's seen above the fold often.
  targetContainer.prepend(container);

  const textarea = container.querySelector('#znt-note-area');
  const saveBtn = container.querySelector('#znt-save-btn');
  const msg = container.querySelector('#znt-msg');

  // Load existing note
  chrome.storage.local.get([zpid], (result) => {
    if (result[zpid]) {
      textarea.value = result[zpid];
    }
  });

  // Save Action
  saveBtn.addEventListener('click', () => {
    const noteContent = textarea.value;
    chrome.storage.local.set({ [zpid]: noteContent }, () => {
      msg.classList.add('visible');
      setTimeout(() => msg.classList.remove('visible'), 2000);
      // Trigger a re-check of indicators in case there are "Nearby Homes" cards on this page
      injectListingIndicators();
    });
  });
}

// --- FEATURE 2: MULTI-LISTING PAGES ---

async function injectListingIndicators() {
  // Get all data first to minimize async calls inside the loop
  chrome.storage.local.get(null, (allItems) => {

    // Selector Logic:
    // Zillow cards are often <article> tags or <li> within a search result list.
    // They almost always contain an anchor <a> tag linking to the detail page.
    // We look for elements that likely represent a property card.
    const cards = document.querySelectorAll('article, li[class*="ListItem-"], [data-test="property-card"]');

    cards.forEach(card => {
      // Skip if we already injected an indicator
      if (card.querySelector('.znt-card-indicator')) return;

      // Find the link to get the ZPID
      const link = card.querySelector('a[href*="_zpid"]');
      if (!link) return;

      const href = link.getAttribute('href');
      const zpidMatch = href.match(/(\d+)_zpid/);

      if (zpidMatch) {
        const zpid = zpidMatch[1];
        const savedNote = allItems[zpid];

        if (savedNote && savedNote.trim().length > 0) {
          addIndicatorToCard(card, savedNote);
        }
      }
    });
  });
}

function addIndicatorToCard(cardElement, noteText) {
  const indicator = document.createElement('div');
  indicator.className = 'znt-card-indicator';
  indicator.textContent = '📝'; // Pencil/Note emoji

  // Tooltip logic
  const tooltip = document.createElement('div');
  tooltip.className = 'znt-tooltip';

  // Truncate if extremely long for display
  const displayText = noteText.length > 150 ? noteText.substring(0, 150) + '...' : noteText;
  tooltip.textContent = displayText;

  indicator.appendChild(tooltip);

  // Position logic:
  // Cards usually have a relative container for the image. We try to append there.
  // If not, we append to the card itself (which might need position: relative).
  const imageWrapper = cardElement.querySelector('[class*="Photo-"]') || cardElement.querySelector('.list-card-top') || cardElement;

  // Ensure parent has relative positioning for absolute child
  const style = window.getComputedStyle(imageWrapper);
  if (style.position === 'static') {
    imageWrapper.style.position = 'relative';
  }

  imageWrapper.appendChild(indicator);
}

// --- SPA HANDLING ---

// Zillow is a heavy Single Page Application. We use MutationObserver to detect
// when the user navigates or when new content (infinite scroll) loads.
const observer = new MutationObserver(debounce(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    // URL changed, re-run everything
    init();
  } else {
    // URL didn't change, but DOM might have (infinite scroll)
    injectListingIndicators();
    // Also retry details injection in case it loaded late
    if (window.location.href.includes('/homedetails/')) {
      injectDetailsNote();
    }
  }
}, 500)); // 500ms debounce

// Start observing
observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Initial Run
init();
