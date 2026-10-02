import { engine } from "./engine.js";
import { InternalHistory } from "./internal.js";
import * as settings from "./settings.js";
import * as visitLog from "./history.js";
let seq = 0;
export class Tab {
    id;
    url;
    title = "new tab";
    loading = false;
    error = null;
    session = null;
    element;
    history = [];
    historyIndex = -1;
    internalHistory = new InternalHistory();
    #manager;
    #sessionPending = null;
    #destroyed = false;
    constructor(manager, options = {}) {
        this.id = `tab-${++seq}`;
        this.url = options.url ?? "";
        this.#manager = manager;
        this.element = document.createElement("iframe");
        this.element.className = "frame";
        this.element.dataset.tabId = this.id;
        this.element.setAttribute("sandbox", "allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads");
        this.element.setAttribute("allow", "autoplay; fullscreen; clipboard-read; clipboard-write");
    }
    async ensureSession() {
        if (this.session)
            return this.session;
        if (this.#sessionPending)
            return this.#sessionPending;
        this.#sessionPending = engine.createSession(this.element, {
            url: url => {
                if (this.element.srcdoc)
                    return;
                this.record(url);
                this.error = null;
                try {
                    this.title = new URL(url).hostname.replace(/^www\./, "");
                }
                catch {
                    this.title = url;
                }
                if (settings.get("saveHistory"))
                    visitLog.record(url, this.title);
                this.#manager.emit();
            },
            loading: () => {
                this.loading = true;
                this.#manager.emit();
            },
            ready: () => {
                this.loading = false;
                this.#manager.emit();
            },
            error: error => {
                this.loading = false;
                this.error = error?.message ?? String(error);
                this.#manager.emit();
            },
            escape: url => {
                this.#manager.open(url);
            }
        });
        const pending = this.#sessionPending;
        try {
            const session = await pending;
            if (this.#destroyed) {
                session.destroy();
                return session;
            }
            this.session = session;
        }
        finally {
            if (this.#sessionPending === pending)
                this.#sessionPending = null;
        }
        return this.session;
    }
    async go(url) {
        if (this.#destroyed)
            return;
        this.internalHistory.clear();
        this.element.removeAttribute("srcdoc");
        const session = await this.ensureSession();
        if (this.#destroyed) {
            session.destroy();
            return;
        }
        this.record(url);
        session.go(url);
        this.#manager.emit();
    }
    record(url) {
        if (this.history[this.historyIndex] === url) {
            this.url = url;
            return;
        }
        const existing = this.history.lastIndexOf(url, this.historyIndex - 1);
        if (existing >= 0) {
            this.historyIndex = existing;
            this.url = url;
            return;
        }
        this.history.splice(this.historyIndex + 1);
        this.history.push(url);
        this.historyIndex = this.history.length - 1;
        this.url = url;
    }
    get canGoBack() {
        return this.historyIndex > 0;
    }
    get canGoForward() {
        return (this.historyIndex >= 0 &&
            this.historyIndex < this.history.length - 1);
    }
    back() {
        if (!this.canGoBack)
            return null;
        this.historyIndex--;
        return this.history[this.historyIndex] ?? null;
    }
    forward() {
        if (!this.canGoForward)
            return null;
        this.historyIndex++;
        return this.history[this.historyIndex] ?? null;
    }
    reload() {
        this.session?.reload();
    }
    destroy() {
        if (this.#destroyed)
            return;
        this.#destroyed = true;
        this.session?.destroy();
        this.session = null;
        void this.#sessionPending?.then(session => session.destroy(), () => { });
        this.element.remove();
    }
}
export class TabManager {
    tabs = [];
    activeId = null;
    #container;
    #listeners = new Set();
    constructor(container) {
        this.#container = container;
    }
    onChange(fn) {
        this.#listeners.add(fn);
        return () => this.#listeners.delete(fn);
    }
    emit() {
        for (const fn of this.#listeners)
            fn(this);
    }
    get active() {
        return this.tabs.find(t => t.id === this.activeId) ?? null;
    }
    open(url = "", options = {}) {
        const tab = new Tab(this, { url });
        this.tabs.push(tab);
        this.#container.append(tab.element);
        if (!options.background || !this.activeId)
            this.select(tab.id);
        else
            this.emit();
        if (url)
            void tab.go(url);
        return tab;
    }
    select(id) {
        if (!this.tabs.some(t => t.id === id))
            return;
        this.activeId = id;
        for (const tab of this.tabs) {
            tab.element.classList.toggle("frame--active", tab.id === id);
        }
        this.emit();
    }
    close(id) {
        const index = this.tabs.findIndex(t => t.id === id);
        if (index === -1)
            return;
        const [tab] = this.tabs.splice(index, 1);
        tab.destroy();
        if (this.activeId === id) {
            const next = this.tabs[index] ?? this.tabs[index - 1];
            this.activeId = next?.id ?? null;
            if (next)
                this.select(next.id);
        }
        if (!this.tabs.length)
            this.open();
        else
            this.emit();
    }
    closeOthers(id) {
        for (const tab of [...this.tabs])
            if (tab.id !== id)
                this.close(tab.id);
    }
    move(id, toIndex) {
        const from = this.tabs.findIndex(t => t.id === id);
        if (from === -1)
            return;
        const [tab] = this.tabs.splice(from, 1);
        this.tabs.splice(Math.max(0, Math.min(toIndex, this.tabs.length)), 0, tab);
        this.emit();
    }
}
