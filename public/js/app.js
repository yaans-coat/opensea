import { engine } from "./engine.js";
import { resolveInput, formatForDisplay } from "./url.js";
import * as settings from "./settings.js";
import { TabManager } from "./tabs.js";
import * as visitLog from "./history.js";
import * as bookmarks from "./bookmarks.js";
import * as internal from "./internal.js";
import { registerInternalPages } from "./internal-pages.js";
import { applyCloak } from "./cloak.js";
import "./snow.js";

const $ = (selector) => document.querySelector(selector);
const addressBar = $("#address");
const frames = $("#frames");
const status = $("#status");
const suggestBox = $("#suggest");

let addressBarFocused = false;
addressBar.addEventListener("focus", () => (addressBarFocused = true));
addressBar.addEventListener("blur", () => (addressBarFocused = false));

registerInternalPages();

const tabs = new TabManager(frames);
const tabStrip = $("#tabs");
tabs.onChange(() => render());

const currentSession = () => tabs.active?.session ?? null;
const currentUrl = () => tabs.active?.url ?? "";
const currentTitle = () => tabs.active?.title ?? "";
const isLoading = () => tabs.active?.loading ?? false;
const canGoBack = () => tabs.active?.canGoBack ?? false;
const canGoForward = () => tabs.active?.canGoForward ?? false;
const goBack = () => tabs.active?.back() ?? null;
const goForward = () => tabs.active?.forward() ?? null;

const hueFor = (text) => {
    let hash = 0;
    for (const char of String(text ?? ""))
        hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return hash;
};

/* ---------------------------------------------------------------- tabs */

const closedTabs = [];

const closeTab = (id) => {
    const tab = tabs.tabs.find(item => item.id === id);
    if (tab?.url && !internal.isInternal(tab.url))
        closedTabs.push({ url: tab.url, title: tab.title });
    if (closedTabs.length > 12)
        closedTabs.shift();
    tabs.close(id);
};

const tabOrderFromDom = () => [...tabStrip.children]
    .map(element => element.dataset.tabId)
    .filter(Boolean);

const syncTabOrder = () => {
    const order = tabOrderFromDom();
    tabs.tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    tabs.emit();
};

const renderTabs = () => {
    const nodes = tabs.tabs.map(tab => {
        const active = tab.id === tabs.activeId;
        const el = document.createElement("div");
        el.className = active ? "tab tab--active" : "tab";
        el.setAttribute("role", "tab");
        el.setAttribute("aria-selected", String(active));
        el.tabIndex = 0;
        el.draggable = true;
        el.dataset.tabId = tab.id;
        el.title = tab.url || tab.title;

        const icon = document.createElement("span");
        icon.className = tab.loading
            ? "tab__favicon tab__favicon--loading"
            : "tab__favicon";
        icon.style.setProperty("--hue", String(hueFor(tab.url || "opensea")));
        icon.textContent = tab.loading
            ? ""
            : (tab.title?.trim()?.[0] ?? "o");
        icon.setAttribute("aria-hidden", "true");

        const label = document.createElement("span");
        label.className = "tab__label";
        label.textContent = tab.loading ? "loading…" : tab.title || "new tab";

        const close = document.createElement("button");
        close.className = "tab__close";
        close.type = "button";
        close.setAttribute("aria-label", `Close ${tab.title || "new tab"}`);
        close.title = "Close tab (Ctrl+W)";
        close.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        close.addEventListener("click", event => {
            event.stopPropagation();
            closeTab(tab.id);
        });

        el.append(icon, label, close);
        el.addEventListener("click", () => tabs.select(tab.id));
        el.addEventListener("keydown", event => {
            switch (event.key) {
                case "Enter":
                case " ":
                    event.preventDefault();
                    tabs.select(tab.id);
                    break;
                case "Delete":
                case "Backspace":
                    event.preventDefault();
                    closeTab(tab.id);
                    break;
            }
        });
        el.addEventListener("auxclick", event => {
            if (event.button === 1) {
                event.preventDefault();
                closeTab(tab.id);
            }
        });

        /* drag to reorder */
        el.addEventListener("dragstart", event => {
            tabStrip.dataset.dragId = tab.id;
            event.dataTransfer?.setData("text/plain", tab.id);
            if (event.dataTransfer)
                event.dataTransfer.effectAllowed = "move";
            requestAnimationFrame(() => el.classList.add("tab--dragging"));
        });
        el.addEventListener("dragend", () => {
            el.classList.remove("tab--dragging");
            if (tabStrip.dataset.dragId) {
                delete tabStrip.dataset.dragId;
                syncTabOrder();
            }
        });
        el.addEventListener("dragover", event => {
            const dragId = tabStrip.dataset.dragId;
            if (!dragId || dragId === tab.id)
                return;
            event.preventDefault();
            if (event.dataTransfer)
                event.dataTransfer.dropEffect = "move";
            const dragged = tabStrip.querySelector(`[data-tab-id="${dragId}"]`);
            if (!dragged || !dragged.isConnected)
                return;
            const box = el.getBoundingClientRect();
            const insertBefore = event.clientX < box.left + box.width / 2;
            tabStrip.insertBefore(dragged, insertBefore ? el : el.nextSibling);
        });
        el.addEventListener("drop", event => event.preventDefault());
        return el;
    });
    tabStrip.replaceChildren(...nodes);
};

/* ------------------------------------------------------------- suggest */

const suggestIcons = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24"><path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8z"/></svg>',
    history: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>'
};

let suggestions = [];
let suggestIndex = -1;
let suggestTimer = 0;

const hideSuggest = () => {
    suggestions = [];
    suggestIndex = -1;
    suggestBox.hidden = true;
    suggestBox.replaceChildren();
};

const renderSuggest = () => {
    if (!suggestions.length) {
        hideSuggest();
        return;
    }
    const nodes = suggestions.map((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "suggest__item" +
            (index === suggestIndex ? " suggest__item--active" : "");
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(index === suggestIndex));

        const icon = document.createElement("span");
        icon.className = "suggest__icon";
        icon.innerHTML = suggestIcons[item.kind] ?? suggestIcons.search;

        const meta = document.createElement("span");
        meta.className = "suggest__meta";
        const title = document.createElement("span");
        title.className = "suggest__title";
        title.textContent = item.title;
        const url = document.createElement("span");
        url.className = "suggest__url";
        url.textContent = item.url;
        meta.append(title, url);

        const tag = document.createElement("span");
        tag.className = "suggest__tag";
        tag.textContent = item.tag;

        button.append(icon, meta, tag);
        button.addEventListener("mousedown", event => event.preventDefault());
        button.addEventListener("click", () => {
            suggestIndex = index;
            pickSuggestion();
        });
        return button;
    });
    suggestBox.replaceChildren(...nodes);
    suggestBox.hidden = false;
};

const pickSuggestion = () => {
    const item = suggestions[suggestIndex];
    hideSuggest();
    addressBar.blur();
    if (item)
        void navigate(item.url);
};

const matches = (query, ...fields) => fields
    .some(field => String(field ?? "").toLowerCase().includes(query));

const updateSuggest = () => {
    const query = addressBar.value.trim().toLowerCase();
    if (!query) {
        hideSuggest();
        return;
    }
    const seen = new Set();
    const found = [];
    const push = (kind, tag, title, url) => {
        if (!url || seen.has(url) || found.length >= 7)
            return;
        seen.add(url);
        found.push({ kind, tag, title: title || url, url });
    };

    push("search", "search", addressBar.value.trim(), addressBar.value.trim());
    for (const item of bookmarks.all())
        if (matches(query, item.title, item.url))
            push("bookmark", "saved", item.title, item.url);
    for (const entry of visitLog.search(query).slice(0, 8))
        if (matches(query, entry.title, entry.url))
            push("history", "recent", entry.title, entry.url);

    suggestions = found;
    suggestIndex = found.length ? 0 : -1;
    renderSuggest();
};

const scheduleSuggest = () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => {
        if (addressBarFocused)
            updateSuggest();
    }, 90);
};

/* -------------------------------------------------------------- navigate */

const startUrl = () => {
    const configured = settings.get("homeUrl");
    if (configured)
        return configured;
    return internal.homeUrl;
};

const searchTemplate = () => settings.get("searchEngine");

const navigate = async (input, options = {}) => {
    const { url, kind } = resolveInput(input, searchTemplate());
    switch (kind) {
        case "empty":
            return;
        case "blocked":
            setStatus("That address cannot be opened through the proxy.");
            return;
        case "external":
            location.assign(url);
            return;
        case "internal": {
            const html = internal.render(url);
            if (html === null)
                return;
            const tab = tabs.active ?? tabs.open();
            if (options.record !== false) {
                tab.internalHistory.push(url);
                tab.record(url);
            }
            tab.url = url;
            const name = url.replace("opensea://", "");
            tab.title = name.charAt(0).toUpperCase() + name.slice(1);
            tab.loading = false;
            tab.element.removeAttribute("src");
            tab.element.srcdoc = html;
            tabs.emit();
            return;
        }
        default: {
            setStatus("");
            const tab = tabs.active ?? tabs.open();
            if (options.record === false) {
                tab.url = url;
                tab.element.removeAttribute("srcdoc");
                await tab.ensureSession();
                tab.session.go(url);
                tabs.emit();
            }
            else {
                await tab.go(url);
            }
        }
    }
};

const refreshInternalPages = (names) => {
    for (const tab of tabs.tabs) {
        if (!internal.isInternal(tab.url) ||
            !names.includes(internal.pageName(tab.url) ?? ""))
            continue;
        const html = internal.render(tab.url);
        if (html !== null)
            tab.element.srcdoc = html;
    }
    tabs.emit();
};

visitLog.onChange(() => refreshInternalPages(["history"]));
bookmarks.onChange(() => refreshInternalPages(["bookmarks"]));

addEventListener("message", event => {
    if (event.origin !== location.origin)
        return;
    if (!internal.isInternal(currentUrl()))
        return;
    if (event.source !== tabs.active?.element.contentWindow)
        return;
    const data = event.data;
    if (!data || typeof data !== "object")
        return;
    switch (data.type) {
        case "internal:open":
            if (typeof data.url === "string")
                void navigate(data.url);
            break;
        case "internal:settings": {
            if (!data.patch || typeof data.patch !== "object")
                break;
            const { rejected, persisted } = settings.set(data.patch);
            const saved = persisted
                ? "Saved."
                : "Applied for this session, but browser storage is unavailable.";
            setStatus(rejected.length
                ? `${saved} Invalid values reset: ${rejected.join(", ")}.`
                : saved);
            void applyTransport();
            applyCloak();
            void navigate(currentUrl());
            break;
        }
        case "internal:action":
            switch (data.action) {
                case "clear-history":
                    setStatus(visitLog.clear()
                        ? "History cleared."
                        : "History cleared for this session, but browser storage is unavailable.");
                    void navigate(currentUrl());
                    break;
                case "remove-bookmark":
                    if (typeof data.url === "string" && data.url) {
                        bookmarks.remove(data.url);
                        setStatus("Bookmark removed.");
                    }
                    break;
                case "reset-settings": {
                    const { persisted } = settings.reset();
                    void applyTransport();
                    applyCloak();
                    setStatus(persisted
                        ? "Settings reset."
                        : "Reset for this session, but browser storage is unavailable.");
                    void navigate(currentUrl());
                    break;
                }
            }
            break;
        case "internal:popup-blocked":
            setStatus("The browser blocked the popup.");
            break;
    }
});

const applyTransport = async () => {
    try {
        await engine.setTransport?.({
            kind: settings.get("transport"),
            wisp: settings.get("wispUrl")
        });
    }
    catch (error) {
        setStatus(`Could not switch transport: ${error.message}`);
    }
};

/* ---------------------------------------------------------------- render */

const render = () => {
    renderTabs();
    const url = currentUrl();
    if (!addressBarFocused)
        addressBar.value = url ? formatForDisplay(url) : "";
    $("#back").disabled = !canGoBack();
    $("#forward").disabled = !canGoForward();
    $("#reload").disabled = !currentSession() && !internal.isInternal(url);

    const star = $("#bookmark");
    const bookmarkable = /^https?:/i.test(url);
    star.disabled = !bookmarkable;
    star.setAttribute("aria-pressed", String(bookmarkable ? bookmarks.has(url) : false));

    document.body.classList.toggle("is-loading", isLoading());
    if (isLoading())
        setStatus("Loading…");
    else if (status.textContent === "Loading…")
        setStatus("");
};

const setStatus = (message) => {
    status.textContent = message ?? "";
    status.hidden = !message;
};

/* --------------------------------------------------------------- events */

$("#omnibox").addEventListener("submit", event => {
    event.preventDefault();
    if (suggestions.length && suggestIndex >= 0) {
        pickSuggestion();
        return;
    }
    addressBar.blur();
    hideSuggest();
    void navigate(addressBar.value);
});

addressBar.addEventListener("input", scheduleSuggest);
addressBar.addEventListener("focus", () => {
    if (addressBar.value.trim())
        updateSuggest();
});
addressBar.addEventListener("blur", () => {
    clearTimeout(suggestTimer);
    setTimeout(hideSuggest, 130);
});
addressBar.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        if (!suggestBox.hidden) {
            event.preventDefault();
            hideSuggest();
        }
        else {
            addressBar.blur();
        }
        return;
    }
    if (!suggestions.length)
        return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        suggestIndex = (suggestIndex + step + suggestions.length) % suggestions.length;
        renderSuggest();
    }
    else if (event.key === "Enter" && document.activeElement === addressBar) {
        if (suggestBox.hidden)
            return;
        event.preventDefault();
        pickSuggestion();
    }
});
suggestBox.addEventListener("mousedown", event => event.preventDefault());

$("#back").addEventListener("click", () => {
    const url = goBack();
    if (url)
        void navigate(url, { record: false });
});
$("#forward").addEventListener("click", () => {
    const url = goForward();
    if (url)
        void navigate(url, { record: false });
});
$("#reload").addEventListener("click", () => {
    if (internal.isInternal(currentUrl())) {
        void navigate(currentUrl());
        return;
    }
    currentSession()?.reload();
});
$("#home").addEventListener("click", () => void navigate(startUrl()));

const openNewTab = () => {
    tabs.open();
    void navigate(startUrl());
    addressBar.focus();
    addressBar.select();
};
$("#new-tab").addEventListener("click", openNewTab);

const menu = $("#menu");
const menuToggle = $("#menu-toggle");

const closeMenu = () => {
    menu.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
};

menuToggle.addEventListener("click", event => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    menuToggle.setAttribute("aria-expanded", String(!menu.hidden));
});

for (const button of menu.querySelectorAll("[data-open]")) {
    button.addEventListener("click", () => {
        closeMenu();
        void navigate(button.dataset.open);
    });
}

document.addEventListener("click", event => {
    if (menu.hidden)
        return;
    if (menu.contains(event.target) || menuToggle.contains(event.target))
        return;
    closeMenu();
});

document.addEventListener("keydown", event => {
    if (event.key !== "Escape")
        return;
    if (!menu.hidden) {
        closeMenu();
        menuToggle.focus();
    }
    hideSuggest();
});

$("#bookmark").addEventListener("click", () => {
    const url = currentUrl();
    if (!/^https?:/i.test(url))
        return;
    bookmarks.toggle(url, currentTitle());
    render();
});

bookmarks.onChange(() => render());

applyCloak();

/* ---------------------------------------------------------- shortcuts */

const cycleTab = (step) => {
    if (tabs.tabs.length < 2)
        return;
    const index = tabs.tabs.findIndex(tab => tab.id === tabs.activeId);
    const next = tabs.tabs[(index + step + tabs.tabs.length) % tabs.tabs.length];
    if (next)
        tabs.select(next.id);
};

addEventListener("keydown", event => {
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === "ArrowLeft") {
            const url = goBack();
            if (url)
                void navigate(url, { record: false });
        }
        else if (event.key === "ArrowRight") {
            const url = goForward();
            if (url)
                void navigate(url, { record: false });
        }
        return;
    }

    const mod = event.ctrlKey || event.metaKey;
    if (!mod)
        return;

    switch (event.key) {
        case "l":
        case "L":
            event.preventDefault();
            addressBar.focus();
            addressBar.select();
            break;
        case "t":
        case "T":
            event.preventDefault();
            if (event.shiftKey) {
                const last = closedTabs.pop();
                if (last) {
                    tabs.open(last.url);
                    break;
                }
            }
            openNewTab();
            break;
        case "w":
        case "W":
            event.preventDefault();
            if (tabs.activeId)
                closeTab(tabs.activeId);
            break;
        case "d":
        case "D": {
            const url = currentUrl();
            if (/^https?:/i.test(url)) {
                event.preventDefault();
                bookmarks.toggle(url, currentTitle());
                render();
                setStatus(bookmarks.has(url) ? "Bookmark saved." : "Bookmark removed.");
            }
            break;
        }
        case "r":
        case "R":
            event.preventDefault();
            if (internal.isInternal(currentUrl()))
                void navigate(currentUrl());
            else
                currentSession()?.reload();
            break;
        case "Tab":
            event.preventDefault();
            cycleTab(event.shiftKey ? -1 : 1);
            break;
        default:
            if (/^[1-9]$/.test(event.key)) {
                event.preventDefault();
                const index = Number(event.key);
                const target = index === 9
                    ? tabs.tabs[tabs.tabs.length - 1]
                    : tabs.tabs[index - 1];
                if (target)
                    tabs.select(target.id);
            }
    }
});

/* ----------------------------------------------------------------- boot */

void applyTransport();
engine.init().catch(() => setStatus("Could not reach the proxy backend."));
tabs.open();
void navigate(startUrl());
