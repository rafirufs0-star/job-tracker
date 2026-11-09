/* Translation layer. All UI text lives in locales/<code>.js. English is built in; other languages ship after a reviewed translation. */
(function () {
  const JT = (window.JT = window.JT || {});
  window.JT_LOCALES = window.JT_LOCALES || {};

  const AVAILABLE = [{ code: "en", name: "English" }];
  const PLANNED = [
    { code: "fr", name: "Français" },
    { code: "es", name: "Español" },
  ];
  let lang = "en";

  function t(key, vars) {
    const dict = window.JT_LOCALES[lang] || window.JT_LOCALES.en || {};
    let s = dict[key];
    if (s == null) s = (window.JT_LOCALES.en || {})[key];
    if (s == null) {
      if (window.console) console.warn("Missing translation:", key);
      return key;
    }
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }

  function loadLocale(code) {
    return new Promise((res) => {
      if (window.JT_LOCALES[code]) return res(true);
      const s = document.createElement("script");
      s.src = "locale-" + code + ".js";
      s.onload = () => res(!!window.JT_LOCALES[code]);
      s.onerror = () => res(false);
      document.head.appendChild(s);
    });
  }

  async function setLang(code) {
    if (!AVAILABLE.some((l) => l.code === code)) code = "en";
    if (await loadLocale(code)) lang = code;
    else lang = "en";
    document.documentElement.lang = lang;
    return lang;
  }

  const locale = () => lang;
  const fmtDate = (iso, opts) =>
    iso ? new Intl.DateTimeFormat(lang, opts || { day: "numeric", month: "short" }).format(JT.util.parse(iso)) : "";
  const fmtDateLong = (iso) => fmtDate(iso, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const fmtNum = (n) => new Intl.NumberFormat(lang).format(n);
  const fmtMoney = (n, cur) => {
    try {
      return new Intl.NumberFormat(lang, { style: "currency", currency: cur || "USD", maximumFractionDigits: 0 }).format(n);
    } catch (e) {
      return (cur || "") + " " + fmtNum(n);
    }
  };

  JT.i18n = { t, setLang, locale, fmtDate, fmtDateLong, fmtNum, fmtMoney, AVAILABLE, PLANNED };
})();
