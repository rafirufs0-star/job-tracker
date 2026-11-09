/* Small shared helpers. Everything hangs off window.JT so the app works without a build step. */
(function () {
  const JT = (window.JT = window.JT || {});
  const U = (JT.util = {});

  U.$ = (s, r) => (r || document).querySelector(s);
  U.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  U.esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  U.pad = (n) => String(n).padStart(2, "0");
  U.iso = (d) => `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  U.today = () => U.iso(new Date());
  U.parse = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  U.addDays = (s, n) => {
    const d = U.parse(s);
    d.setDate(d.getDate() + n);
    return U.iso(d);
  };
  U.diffDays = (a, b) => Math.round((U.parse(a) - U.parse(b)) / 864e5);
  U.mondayOf = (s) => {
    const d = U.parse(s);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return U.iso(d);
  };
  U.isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && U.iso(U.parse(s)) === s;
  U.isTime = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  U.fmtId = (prefix, n) => prefix + "-" + String(n).padStart(4, "0");
  U.idNumber = (id, prefix) => {
    const m = new RegExp("^" + prefix + "-(\\d{4,})$").exec(id || "");
    return m ? parseInt(m[1], 10) : null;
  };
  U.validTZ = (tz) => {
    if (!tz) return false;
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch (e) {
      return false;
    }
  };
  U.isIOS = () =>
    /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  U.isStandalone = () =>
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  U.uid = () => Math.random().toString(36).slice(2, 8);
  U.debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /* Saves a text file. iOS uses the share sheet when it can; everything else uses a normal download. */
  U.saveFile = async (name, mime, content) => {
    const blob = new Blob([content], { type: mime + ";charset=utf-8" });
    try {
      if (U.isIOS() && navigator.canShare && typeof File === "function") {
        const file = new File([blob], name, { type: mime });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return true;
        }
      }
    } catch (e) {
      if (e && e.name === "AbortError") return false;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  };

  U.readFile = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ""));
      r.onerror = () => rej(r.error);
      r.readAsText(file);
    });
})();
