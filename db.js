/* IndexedDB access with a versioned schema. Bump VERSION and add an `if (old < N)` block to migrate; existing data is never dropped. */
(function () {
  const JT = (window.JT = window.JT || {});
  const NAME = "job-application-tracker";
  const VERSION = 1;
  const RECORD_STORES = ["applications", "interviews", "followups"];
  let db = null;
  let available = false;

  function open() {
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open(NAME, VERSION);
        r.onupgradeneeded = (e) => {
          const d = r.result;
          const old = e.oldVersion;
          if (old < 1) {
            RECORD_STORES.forEach((s) => d.createObjectStore(s, { keyPath: "id" }));
            d.createObjectStore("meta", { keyPath: "key" });
          }
          /* Future schema changes go here, for example: if (old < 2) { ... } */
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error("blocked"));
      } catch (e) {
        rej(e);
      }
    });
  }

  const wrap = (req) =>
    new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  const done = (tx) =>
    new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new Error("aborted"));
    });

  async function init() {
    try {
      db = await open();
      available = true;
    } catch (e) {
      available = false;
    }
    return available;
  }

  async function getAll(store) {
    if (!available) return [];
    return wrap(db.transaction(store).objectStore(store).getAll());
  }
  async function put(store, obj) {
    if (!available) return;
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(obj);
    await done(tx);
  }
  async function putMany(store, arr) {
    if (!available || !arr.length) return;
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    arr.forEach((o) => os.put(o));
    await done(tx);
  }
  async function del(store, id) {
    if (!available) return;
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    await done(tx);
  }
  async function getMeta(key) {
    if (!available) return null;
    const row = await wrap(db.transaction("meta").objectStore("meta").get(key));
    return row ? row.value : null;
  }
  async function setMeta(key, value) {
    return put("meta", { key, value });
  }
  /* Replaces everything in one transaction, so a failed restore leaves the old data untouched. */
  async function replaceAll(data) {
    if (!available) return;
    const tx = db.transaction([...RECORD_STORES, "meta"], "readwrite");
    RECORD_STORES.forEach((s) => tx.objectStore(s).clear());
    tx.objectStore("meta").clear();
    data.applications.forEach((o) => tx.objectStore("applications").put(o));
    data.interviews.forEach((o) => tx.objectStore("interviews").put(o));
    data.followups.forEach((o) => tx.objectStore("followups").put(o));
    tx.objectStore("meta").put({ key: "settings", value: data.settings });
    tx.objectStore("meta").put({ key: "counters", value: data.counters });
    await done(tx);
  }

  JT.db = { init, getAll, put, putMany, del, getMeta, setMeta, replaceAll, isAvailable: () => available, VERSION };
})();
