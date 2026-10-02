import { definePage, escapeHtml } from "./internal.js";
import { engine } from "./engine.js";
import * as settings from "./settings.js";
import * as visitLog from "./history.js";
import * as bookmarks from "./bookmarks.js";

const transportOptions = [
    { id: "libcurl", label: "libcurl", detail: "curl in WebAssembly, over wisp. Widest site compatibility." },
    { id: "epoxy", label: "epoxy", detail: "A Rust TLS stack in WebAssembly, over wisp. Smaller than libcurl." },
    { id: "bare", label: "bare", detail: "The only transport that runs on request/response serverless hosts. Your server can inspect target request and response data, and WebSocket sites will not work." }
];

const options = (list, selected, valueOf) => list
    .map(item => `<option value="${escapeHtml(valueOf(item))}"${valueOf(item) === selected ? " selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");

const row = (name, def, control) => `
  <div class="field">
    <label for="f-${name}">${escapeHtml(def.label)}</label>
    ${control}
    ${def.help ? `<p class="field__help">${escapeHtml(def.help)}</p>` : ""}
  </div>`;

const control = (name, def, value) => {
    switch (name) {
        case "searchEngine":
            return `<select id="f-${name}" name="${name}">${options(settings.searchEngines, value, e => e.template)}</select>`;
        case "transport":
            return `<select id="f-${name}" name="${name}">${options(transportOptions, value, t => t.id)}</select>`;
        case "cloakPreset":
            return `<select id="f-${name}" name="${name}">${settings.cloakPresets
                .map(preset => `<option value="${preset.id}" data-title="${escapeHtml(preset.title)}" data-favicon="${escapeHtml(preset.favicon)}"${preset.id === value ? " selected" : ""}>${escapeHtml(preset.label)}</option>`)
                .join("")}</select>`;
        default: {
            const type = ["homeUrl", "wispUrl", "cloakFavicon"].includes(name)
                ? "url"
                : "text";
            const custom = ["cloakTitle", "cloakFavicon"].includes(name)
                ? " data-custom-cloak"
                : "";
            return typeof def.default === "boolean"
                ? `<input id="f-${name}" type="checkbox" name="${name}"${value ? " checked" : ""}>`
                : `<input id="f-${name}" type="${type}" name="${name}" value="${escapeHtml(value ?? "")}" autocomplete="off" spellcheck="false"${custom}>`;
        }
    }
};

const hueFor = (text) => {
    let hash = 0;
    for (const char of String(text ?? ""))
        hash = (hash * 31 + char.charCodeAt(0)) % 360;
    return hash;
};

const hostOf = (url) => {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    }
    catch {
        return String(url ?? "");
    }
};

const avatar = (url) => {
    const host = hostOf(url);
    return `<span class="fav" style="--hue:${hueFor(host)}" aria-hidden="true">${escapeHtml(host.charAt(0) || "?")}</span>`;
};

const waveMark = `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 18c5-5 9-5 14 0s9 5 14 0 5-5 8-2"/><path d="M6 30c5-5 9-5 14 0s9 5 14 0 5-5 8-2"/></svg>`;

const quickLink = (href, glyph, name, desc) => `
  <a class="quick__link" href="#" data-open="${escapeHtml(href)}">
    <span class="quick__glyph" aria-hidden="true">${escapeHtml(glyph)}</span>
    <span class="quick__name">${escapeHtml(name)}</span>
    <span class="quick__desc">${escapeHtml(desc)}</span>
  </a>`;

export const registerInternalPages = () => {
    definePage("home", {
        title: "new tab",
        render: () => `
      <main class="internal">
        <section class="hero">
          <div class="hero__mark">${waveMark}</div>
          <h1>OpenSea</h1>
          <p>Type an address or search above, or jump straight into the pages below.</p>
          <form class="searchbox" data-search-form>
            <input name="q" type="text" placeholder="Search the web or enter an address" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Search the web" />
            <button type="submit">Search</button>
          </form>
        </section>
        <div class="quick">
          ${quickLink("opensea://settings", "⚙", "Settings", "Search engine, transport and cloaking")}
          ${quickLink("opensea://history", "↺", "History", "Everything you visited recently")}
          ${quickLink("opensea://bookmarks", "★", "Bookmarks", "Pages you saved for later")}
          ${quickLink("opensea://about", "i", "About", "Engine, transport and isolation status")}
          ${quickLink("https://duckduckgo.com/", "D", "DuckDuckGo", "Private search, no account needed")}
          ${quickLink("https://en.wikipedia.org/", "W", "Wikipedia", "The free encyclopedia")}
          ${quickLink("https://www.youtube.com/", "Y", "YouTube", "Videos and music")}
          ${quickLink("https://www.reddit.com/", "R", "Reddit", "Communities and discussions")}
        </div>
      </main>`
    });

    definePage("about", {
        title: "about",
        render: () => {
            const sj = window.$scramjet;
            const facts = [
                ["Engine", sj?.versionInfo?.version ? `Scramjet ${sj.versionInfo.version}` : "Scramjet 2.0.67-alpha.2"],
                ["Transport", engine.getTransport?.().kind ?? "libcurl"],
                ["Cross-origin isolated", globalThis.crossOriginIsolated === true ? "yes" : "no"],
                ["Service worker", navigator.serviceWorker?.controller?.scriptURL ?? "not controlling"],
                ["Storage", (() => {
                    try {
                        localStorage.setItem("opensea:probe", "1");
                        localStorage.removeItem("opensea:probe");
                        return "persistent";
                    }
                    catch {
                        return "session only";
                    }
                })()]
            ];
            return `
      <main class="internal">
        <h1>About OpenSea</h1>
        <p>A proxied browser shell. Everything here runs on your own server.</p>
        <section class="card">
          <h2>Status</h2>
          <ul>
            ${facts
                .map(([k, v]) => `<li><span class="key">${escapeHtml(k)}</span><span class="chip">${escapeHtml(v)}</span></li>`)
                .join("")}
          </ul>
        </section>
        <section class="card">
          <h2>Shortcuts</h2>
          <ul>
            ${[
                ["Focus the address bar", "Ctrl / ⌘ + L"],
                ["New tab", "Ctrl / ⌘ + T"],
                ["Close tab", "Ctrl / ⌘ + W"],
                ["Reopen closed tab", "Ctrl / ⌘ + Shift + T"],
                ["Reload", "Ctrl / ⌘ + R"],
                ["Bookmark page", "Ctrl / ⌘ + D"],
                ["Switch tabs", "Ctrl / ⌘ + Tab"],
                ["Jump to tab", "Ctrl / ⌘ + 1…9"],
                ["Back / forward", "Alt + ← / →"]
            ].map(([label, keys]) => `<li><span class="key">${escapeHtml(label)}</span><span class="chip">${escapeHtml(keys)}</span></li>`).join("")}
          </ul>
        </section>
      </main>`;
        }
    });

    definePage("settings", {
        title: "settings",
        render: () => {
            const current = settings.all();
            const fields = Object.entries(settings.schema);
            const section = (id, label) => {
                const rows = fields
                    .filter(([, def]) => def.section === id)
                    .map(([name, def]) => row(name, def, control(name, def, current[name])))
                    .join("");
                if (!rows)
                    return "";
                const preset = settings.cloakPresets.find(item => item.id === settings.get("cloakPreset"));
                const cloakTitle = preset && preset.id !== "custom"
                    ? preset.title
                    : settings.get("cloakTitle");
                const cloakFavicon = preset && preset.id !== "custom"
                    ? preset.favicon
                    : settings.get("cloakFavicon");
                const extra = id === "cloaking"
                    ? `<div class="actions">
                 <button type="button" data-action="cloak-aboutblank" data-cloak-title="${escapeHtml(cloakTitle)}" data-cloak-favicon="${escapeHtml(cloakFavicon)}">Open in a cloaked window</button>
                 <button type="button" data-action="cloak-blob" data-cloak-title="${escapeHtml(cloakTitle)}" data-cloak-favicon="${escapeHtml(cloakFavicon)}">Open as a blob tab</button>
               </div>`
                    : "";
                return `<section class="card"><h2>${escapeHtml(label)}</h2>${rows}${extra}</section>`;
            };
            return `
        <main class="internal">
          <h1>Settings</h1>
          <p>Changes apply immediately and are stored on this device only.</p>
          <form data-settings-form>
            ${settings.sections.map(s => section(s.id, s.label)).join("")}
            <div class="actions">
              <button type="submit">Save changes</button>
              <button type="button" data-action="reset-settings" class="danger">Reset to defaults</button>
            </div>
          </form>
        </main>`;
        }
    });

    definePage("history", {
        title: "history",
        render: () => {
            const groups = visitLog.grouped();
            if (!groups.length) {
                return `<main class="internal">
          <h1>History</h1>
          <div class="empty"><strong>Nothing here yet</strong>Pages you visit through the proxy will be listed here.</div>
        </main>`;
            }
            return `
        <main class="internal">
          <h1>History</h1>
          <p>Your last ${visitLog.all().length} visits, newest first.</p>
          <div class="actions">
            <button type="button" data-action="clear-history" class="danger">Clear history</button>
          </div>
          ${groups
                .map(group => `
            <section class="card">
              <h2>${escapeHtml(group.day)}</h2>
              <ul>
                ${group.items
                    .map(entry => `<li>
                  ${avatar(entry.url)}
                  <a href="#" data-open="${escapeHtml(entry.url)}">${escapeHtml(entry.title || entry.url)}</a>
                  <span class="dim">${escapeHtml(entry.url)}</span>
                  <span class="chip">${escapeHtml(new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</span>
                </li>`)
                    .join("")}
              </ul>
            </section>`)
                .join("")}
        </main>`;
        }
    });

    definePage("bookmarks", {
        title: "bookmarks",
        render: () => {
            const items = bookmarks.all();
            if (!items.length) {
                return `<main class="internal">
          <h1>Bookmarks</h1>
          <div class="empty"><strong>No bookmarks yet</strong>Press the star in the address bar, or hit Ctrl / ⌘ + D, to save the page you are on.</div>
        </main>`;
            }
            return `
        <main class="internal">
          <h1>Bookmarks</h1>
          <p>${items.length} saved page${items.length === 1 ? "" : "s"}.</p>
          <section class="card">
            <ul>
              ${items
                .map(item => `<li>
                ${avatar(item.url)}
                <a href="#" data-open="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a>
                <span class="dim">${escapeHtml(item.url)}</span>
                <button class="chip" type="button" data-action="remove-bookmark" data-url="${escapeHtml(item.url)}" title="Remove bookmark">remove</button>
              </li>`)
                .join("")}
            </ul>
          </section>
        </main>`;
        }
    });
};
