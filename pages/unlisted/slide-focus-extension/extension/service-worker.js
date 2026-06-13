const SLIDES_URL = "https://mrrains.org/pages/tools/slides/index.html";
const STORAGE_KEY = "slideTabsById";

function isSlidesTab(tab) {
  return Boolean(tab && typeof tab.url === "string" && tab.url.startsWith(SLIDES_URL));
}

async function readSlideTabs() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

async function writeSlideTabs(slideTabsById) {
  await chrome.storage.local.set({ [STORAGE_KEY]: slideTabsById });
}

async function rememberTab(tab, openedAt = Date.now()) {
  if (!isSlidesTab(tab) || typeof tab.id !== "number" || typeof tab.windowId !== "number") {
    return;
  }

  const slideTabsById = await readSlideTabs();
  const existing = slideTabsById[String(tab.id)];

  slideTabsById[String(tab.id)] = {
    tabId: tab.id,
    windowId: tab.windowId,
    openedAt: existing?.openedAt || openedAt,
    lastSeenAt: Date.now()
  };

  await writeSlideTabs(slideTabsById);
}

async function forgetTab(tabId) {
  const slideTabsById = await readSlideTabs();
  delete slideTabsById[String(tabId)];
  await writeSlideTabs(slideTabsById);
}

async function scanOpenSlideTabs() {
  const tabs = await chrome.tabs.query({ url: `${SLIDES_URL}*` });
  const slideTabsById = await readSlideTabs();
  const openTabIds = new Set(tabs.map((tab) => String(tab.id)));

  for (const key of Object.keys(slideTabsById)) {
    if (!openTabIds.has(key)) {
      delete slideTabsById[key];
    }
  }

  for (const tab of tabs) {
    const key = String(tab.id);
    slideTabsById[key] = {
      tabId: tab.id,
      windowId: tab.windowId,
      openedAt: slideTabsById[key]?.openedAt || Date.now(),
      lastSeenAt: Date.now()
    };
  }

  await writeSlideTabs(slideTabsById);
  return Object.values(slideTabsById);
}

async function getMostRecentlyOpenedSlideTab() {
  const knownTabs = await scanOpenSlideTabs();

  knownTabs.sort((a, b) => {
    if (b.openedAt !== a.openedAt) {
      return b.openedAt - a.openedAt;
    }

    return b.tabId - a.tabId;
  });

  for (const knownTab of knownTabs) {
    try {
      const tab = await chrome.tabs.get(knownTab.tabId);
      if (isSlidesTab(tab)) {
        return tab;
      }
    } catch (error) {
      await forgetTab(knownTab.tabId);
    }
  }

  return null;
}

async function focusSlides() {
  const tab = await getMostRecentlyOpenedSlideTab();

  if (!tab) {
    await chrome.tabs.create({ url: SLIDES_URL });
    return;
  }

  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tab.id, { active: true });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "focus-slides") {
    focusSlides();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  rememberTab(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    rememberTab(tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  scanOpenSlideTabs();
});

chrome.runtime.onStartup.addListener(() => {
  scanOpenSlideTabs();
});
