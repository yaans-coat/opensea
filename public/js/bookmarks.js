import * as storage from "./storage.js";
import { originOf } from "./url.js";
const storeKey = "bookmarks";
const maxItems = 500;
let items = null;
const listeners = new Set();
const load = () => {
    if (items)
        return items;
    const raw = storage.read(storeKey, []);
    items = Array.isArray(raw)
        ? raw.filter((b) => Boolean(b) && typeof b.url === "string")
        : [];
    return items;
};
const persist = () => {
    storage.write(storeKey, items);
    for (const fn of listeners)
        fn(items);
};
export const all = () => {
    return [...load()];
};
export const has = (url) => {
    return load().some(b => b.url === url);
};
export const add = (url, title = "") => {
    if (!url || !/^https?:/i.test(url))
        return false;
    const list = load();
    if (has(url))
        return false;
    if (list.length >= maxItems)
        return false;
    list.push({
        url,
        title: title || originOf(url).replace(/^https?:\/\//, "") || url,
        at: Date.now()
    });
    persist();
    return true;
};
export const remove = (url) => {
    const list = load();
    const before = list.length;
    items = list.filter(b => b.url !== url);
    if (items.length !== before)
        persist();
};
export const toggle = (url, title) => {
    if (has(url)) {
        remove(url);
        return false;
    }
    return add(url, title);
};
export const move = (url, toIndex) => {
    const list = load();
    const from = list.findIndex(b => b.url === url);
    if (from === -1)
        return;
    const [item] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, item);
    persist();
};
export const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
};
