/* Application state, business rules and metrics. The in-memory copy is the source for the UI; every change is written through to IndexedDB. */
(function () {
  const JT = (window.JT = window.JT || {});
  const U = JT.util;
  const DB = JT.db;

  const SCHEMA_VERSION = 1; /* version of the backup file format */
  const DEFAULT_STATUSES = [
    ["wishlist", "Wishlist", true, false],
    ["applied", "Applied", true, true],
    ["screening", "Screening", true, false],
    ["interview", "Interview", true, false],
    ["assessment", "Assessment", true, false],
    ["offer", "Offer", true, false],
    ["accepted", "Accepted", false, false],
    ["rejected", "Rejected", false, false],
    ["withdrawn", "Withdrawn", false, false],
    ["ghosted", "Ghosted", false, false],
  ];
  const RESPONDED = ["screening", "interview", "assessment", "offer", "accepted", "rejected"];
  const FLOW = ["applied", "screening", "interview", "assessment", "offer", "accepted"];
  const LISTS = {
    workType: ["Remote", "Hybrid", "On-site"],
    priority: ["High", "Medium", "Low"],
    source: ["LinkedIn", "Company Site", "Referral", "Indeed", "Recruiter", "Other"],
    currency: ["USD", "EUR", "GBP", "CAD", "AUD", "INR", "BDT", "AED", "SGD", "JPY"],
    interviewType: ["Phone Screen", "Video", "On-site", "Technical", "Panel", "HR", "Final"],
    outcome: ["Pending", "Passed", "Failed", "Cancelled"],
    followType: ["Email", "Call", "LinkedIn", "Other"],
  };

  const defaultSettings = () => ({
    statuses: DEFAULT_STATUSES.map(([key, name, active, awaiting]) => ({ key, name, active, awaiting })),
    noRespDays: 7,
    weeklyGoal: 10,
    minSample: 5,
    backupDays: 14,
    lastBackup: "",
    lang: "en",
    installDismissedUntil: "",
    persisted: null,
    sample: false,
  });

  let st = { apps: [], ints: [], fups: [], settings: defaultSettings(), counters: { app: 1, int: 1, fup: 1 } };

  /* ---------- loading and saving ---------- */
  async function load() {
    const [apps, ints, fups, settings, counters] = await Promise.all([
      DB.getAll("applications"),
      DB.getAll("interviews"),
      DB.getAll("followups"),
      DB.getMeta("settings"),
      DB.getMeta("counters"),
    ]);
    st.apps = apps;
    st.ints = ints;
    st.fups = fups;
    st.settings = Object.assign(defaultSettings(), settings || {});
    st.counters = Object.assign({ app: 1, int: 1, fup: 1 }, counters || {});
    return !!(settings || apps.length);
  }
  const saveSettings = () => DB.setMeta("settings", st.settings);
  const saveCounters = () => DB.setMeta("counters", st.counters);

  const KINDS = {
    app: { list: "apps", store: "applications", prefix: "APP" },
    int: { list: "ints", store: "interviews", prefix: "INT" },
    fup: { list: "fups", store: "followups", prefix: "FUP" },
  };
  function nextId(kind) {
    const id = U.fmtId(KINDS[kind].prefix, st.counters[kind]);
    st.counters[kind] += 1;
    saveCounters();
    return id;
  }
  function bumpCounter(kind, id) {
    const n = U.idNumber(id, KINDS[kind].prefix);
    if (n != null && n >= st.counters[kind]) st.counters[kind] = n + 1;
  }
  async function persistRecord(kind, rec) {
    await DB.put(KINDS[kind].store, rec);
  }

  /* ---------- statuses ---------- */
  const statusByName = (name) => st.settings.statuses.find((s) => s.name === name);
  const statusByKey = (key) => st.settings.statuses.find((s) => s.key === key);
  const keyOfName = (name) => (statusByName(name) || {}).key;

  /* ---------- queries ---------- */
  const apps = () => st.apps.filter((a) => !a.deleted);
  const appById = (id) => st.apps.find((a) => a.id === id);
  const appLive = (id) => {
    const a = appById(id);
    return !!a && !a.deleted;
  };
  const ints = () => st.ints.filter((i) => !i.deleted && appLive(i.appId));
  const fups = () => st.fups.filter((f) => !f.deleted && appLive(f.appId));
  const label = (a) => (a ? `${a.company} · ${a.title}` : "");

  const isActive = (a) => {
    if (a.archived || a.deleted) return false;
    const s = statusByName(a.status);
    return s ? s.active : true;
  };
  const isAwaiting = (a) => {
    const s = statusByName(a.status);
    return !!(s && s.awaiting);
  };
  const needsFollowUp = (a) =>
    isActive(a) && isAwaiting(a) && !!a.dateApplied && !a.firstResponse && U.diffDays(U.today(), a.dateApplied) >= st.settings.noRespDays;
  const sameKey = (a) => (a.company || "").trim().toLowerCase() + "|" + (a.title || "").trim().toLowerCase();
  const isDuplicate = (a) => apps().some((b) => b.id !== a.id && sameKey(b) === sameKey(a));
  function reached(a, key) {
    const idx = FLOW.indexOf(key);
    const names = (a.history || []).map((h) => h.status).concat(a.status);
    return names.some((n) => {
      const i = FLOW.indexOf(keyOfName(n));
      return i >= idx && i !== -1;
    });
  }

  /* ---------- saving applications ---------- */
  function blankApp() {
    const today = U.today();
    return {
      id: "", company: "", title: "", location: "", workType: "Remote", link: "", source: "LinkedIn", dateApplied: today,
      status: "Applied", statusUpdated: today, priority: "Medium", salaryMin: "", salaryMax: "", currency: "USD",
      contactName: "", contactEmail: "", firstResponse: "", offerDate: "", notes: "", archived: false, deleted: false,
      created: today, updated: today, history: [],
    };
  }
  async function saveApp(data, id) {
    const today = U.today();
    let a = id ? appById(id) : null;
    const isNew = !a;
    const prevStatus = a ? a.status : null;
    if (isNew) {
      a = blankApp();
      a.id = nextId("app");
      st.apps.push(a);
    }
    Object.assign(a, data);
    a.updated = today;
    if (isNew) {
      a.created = today;
      a.statusUpdated = a.status === "Wishlist" || !a.dateApplied ? today : a.dateApplied;
      a.history = [{ status: a.status, date: a.statusUpdated }];
    } else if (prevStatus !== a.status) {
      a.statusUpdated = today;
      a.history = (a.history || []).concat({ status: a.status, date: today });
      const k = keyOfName(a.status);
      if (RESPONDED.includes(k) && !a.firstResponse) a.firstResponse = today;
      if (k === "offer" && !a.offerDate) a.offerDate = today;
    }
    await persistRecord("app", a);
    return a;
  }

  async function saveInt(data, id) {
    let i = id ? st.ints.find((x) => x.id === id) : null;
    if (!i) {
      i = { id: nextId("int"), deleted: false, created: U.today() };
      st.ints.push(i);
    }
    Object.assign(i, data, { updated: U.today() });
    await persistRecord("int", i);
    return i;
  }
  async function saveFup(data, id) {
    let f = id ? st.fups.find((x) => x.id === id) : null;
    if (!f) {
      f = { id: nextId("fup"), deleted: false, created: U.today() };
      st.fups.push(f);
    }
    Object.assign(f, data, { updated: U.today() });
    if (f.done && !f.doneDate) f.doneDate = U.today();
    if (!f.done) f.doneDate = "";
    await persistRecord("fup", f);
    return f;
  }
  const findRec = (kind, id) => st[KINDS[kind].list].find((r) => r.id === id);
  async function setDeleted(kind, id, flag) {
    const r = findRec(kind, id);
    if (!r) return;
    r.deleted = flag;
    r.deletedAt = flag ? U.today() : "";
    await persistRecord(kind, r);
  }
  async function purge(kind, id) {
    const list = st[KINDS[kind].list];
    const i = list.findIndex((r) => r.id === id);
    if (i >= 0) list.splice(i, 1);
    await DB.del(KINDS[kind].store, id);
  }
  const trashed = () => ({
    apps: st.apps.filter((a) => a.deleted),
    ints: st.ints.filter((i) => i.deleted),
    fups: st.fups.filter((f) => f.deleted),
  });
  async function emptyTrash() {
    const t = trashed();
    for (const a of t.apps) await purge("app", a.id);
    for (const i of t.ints) await purge("int", i.id);
    for (const f of t.fups) await purge("fup", f.id);
  }

  /* ---------- statuses editing ---------- */
  async function saveStatuses(rows) {
    const old = st.settings.statuses;
    const next = rows.map((r) => ({ key: r.key || "s" + U.uid(), name: r.name.trim(), active: !!r.active, awaiting: !!r.awaiting }));
    const renames = {};
    next.forEach((n) => {
      const o = old.find((x) => x.key === n.key);
      if (o && o.name !== n.name) renames[o.name] = n.name;
    });
    st.settings.statuses = next;
    if (Object.keys(renames).length) {
      const touched = [];
      st.apps.forEach((a) => {
        let ch = false;
        if (renames[a.status]) { a.status = renames[a.status]; ch = true; }
        (a.history || []).forEach((h) => { if (renames[h.status]) { h.status = renames[h.status]; ch = true; } });
        if (ch) touched.push(a);
      });
      await DB.putMany("applications", touched);
    }
    await saveSettings();
  }
  const statusUsage = (name) => st.apps.filter((a) => a.status === name).length;

  /* ---------- metrics ---------- */
  function metrics() {
    const today = U.today();
    const A = apps();
    const S = st.settings;
    const base = A.filter((a) => a.dateApplied).length;
    const enough = base >= S.minSample;
    const wk = U.mondayOf(today);
    const withResp = A.filter((a) => a.dateApplied && a.firstResponse);
    const intApps = new Set(ints().filter((i) => i.date).map((i) => i.appId));
    const pct = (n) => (enough ? Math.round((100 * n) / base) : null);
    const openFups = fups().filter((f) => !f.done);
    const fupDue = openFups.filter((f) => f.due <= today).sort((a, b) => a.due.localeCompare(b.due));
    const intNext = ints()
      .filter((i) => i.outcome !== "Cancelled" && i.date >= today && U.diffDays(i.date, today) <= 7)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const stages = ["applied", "screening", "interview", "offer"]
      .filter((k) => statusByKey(k))
      .map((k) => ({ key: k, name: statusByKey(k).name, count: A.filter((a) => reached(a, k)).length }));
    const weeks = Array.from({ length: 8 }, (_, k) => {
      const start = U.addDays(wk, -7 * (7 - k));
      return { start, n: A.filter((a) => a.dateApplied && a.dateApplied >= start && a.dateApplied < U.addDays(start, 7)).length };
    });
    const events = [];
    A.forEach((a) => (a.history || []).forEach((h, idx) => events.push({ app: a, status: h.status, date: h.date, idx })));
    events.sort((x, y) => y.date.localeCompare(x.date) || y.idx - x.idx);
    return {
      fupDue,
      intNext,
      noResp: A.filter(needsFollowUp),
      active: A.filter(isActive).length,
      appliedWeek: A.filter((a) => a.dateApplied && a.dateApplied >= wk && a.dateApplied < U.addDays(wk, 7)).length,
      upcoming: ints().filter((i) => i.outcome !== "Cancelled" && i.date >= today).length,
      offers: A.filter((a) => a.offerDate).length,
      response: pct(withResp.length),
      interviewRate: pct(A.filter((a) => a.dateApplied && intApps.has(a.id)).length),
      offerRate: pct(A.filter((a) => a.dateApplied && a.offerDate).length),
      avgDays: withResp.length >= S.minSample ? withResp.reduce((s, a) => s + U.diffDays(a.firstResponse, a.dateApplied), 0) / withResp.length : null,
      total: A.length,
      stages,
      weeks,
      recent: events.slice(0, 10),
    };
  }

  /* ---------- backup, restore, migrations ---------- */
  const MIGRATIONS = {
    /* 1: (data) => { ...return data upgraded from schema 1 to 2... } */
  };
  function migrate(data) {
    let v = data.schemaVersion || 1;
    while (v < SCHEMA_VERSION) {
      if (MIGRATIONS[v]) data = MIGRATIONS[v](data);
      v += 1;
    }
    data.schemaVersion = SCHEMA_VERSION;
    return data;
  }
  function exportAll() {
    return {
      app: "job-application-tracker",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: { applications: st.apps, interviews: st.ints, followups: st.fups, settings: st.settings, counters: st.counters },
    };
  }
  /* Returns { ok, error, counts, normalized } without touching current data. */
  function validateBackup(obj) {
    if (!obj || obj.app !== "job-application-tracker" || !obj.data) return { ok: false, error: "notBackup" };
    if ((obj.schemaVersion || 1) > SCHEMA_VERSION) return { ok: false, error: "tooNew" };
    const m = migrate(JSON.parse(JSON.stringify(obj)));
    const d = m.data;
    if (!Array.isArray(d.applications) || !Array.isArray(d.interviews) || !Array.isArray(d.followups)) return { ok: false, error: "notBackup" };
    const settings = Object.assign(defaultSettings(), d.settings || {});
    const counters = Object.assign({ app: 1, int: 1, fup: 1 }, d.counters || {});
    d.applications.forEach((a) => { const n = U.idNumber(a.id, "APP"); if (n != null && n >= counters.app) counters.app = n + 1; });
    d.interviews.forEach((a) => { const n = U.idNumber(a.id, "INT"); if (n != null && n >= counters.int) counters.int = n + 1; });
    d.followups.forEach((a) => { const n = U.idNumber(a.id, "FUP"); if (n != null && n >= counters.fup) counters.fup = n + 1; });
    return {
      ok: true,
      counts: { apps: d.applications.filter((a) => !a.deleted).length, ints: d.interviews.filter((a) => !a.deleted).length, fups: d.followups.filter((a) => !a.deleted).length },
      normalized: { applications: d.applications, interviews: d.interviews, followups: d.followups, settings, counters },
    };
  }
  async function restore(normalized) {
    const lang = st.settings.lang;
    await DB.replaceAll(normalized);
    st.apps = normalized.applications;
    st.ints = normalized.interviews;
    st.fups = normalized.followups;
    st.settings = normalized.settings;
    st.counters = normalized.counters;
    st.settings.lang = st.settings.lang || lang;
  }
  async function wipe(keepSettings) {
    const s = defaultSettings();
    if (keepSettings) { s.lang = st.settings.lang; s.persisted = st.settings.persisted; }
    await restore({ applications: [], interviews: [], followups: [], settings: s, counters: { app: 1, int: 1, fup: 1 } });
  }

  /* ---------- sample data (clearly marked, removable) ---------- */
  async function loadSample() {
    const t = U.today();
    const d = (n) => U.addDays(t, -n);
    const out = { applications: [], interviews: [], followups: [], settings: defaultSettings(), counters: { app: 1, int: 1, fup: 1 } };
    out.settings.sample = true;
    out.settings.lastBackup = d(9);
    const A = (company, title, location, workType, source, ago, status, upd, priority, smin, smax, currency, resp, offer, notes, hist, contact) => {
      const a = blankApp();
      Object.assign(a, {
        id: U.fmtId("APP", out.counters.app++), company, title, location, workType, source, dateApplied: d(ago), status, statusUpdated: d(upd),
        priority, salaryMin: smin, salaryMax: smax, currency, firstResponse: resp == null ? "" : d(resp), offerDate: offer == null ? "" : d(offer),
        notes, created: d(ago), updated: d(upd), history: hist.map(([s, n]) => ({ status: s, date: d(n) })),
        contactName: contact ? contact[0] : "", contactEmail: contact ? contact[1] : "", link: "",
      });
      out.applications.push(a);
    };
    A("Northwind Labs", "Data Analyst", "Austin, TX", "Hybrid", "LinkedIn", 62, "Rejected", 40, "High", 60000, 72000, "USD", 55, null, "Rejected after screening.", [["Applied", 62], ["Screening", 55], ["Rejected", 40]], ["Maya Chen", "maya@example.com"]);
    A("Contoso Health", "Operations Coordinator", "Remote", "Remote", "Company Site", 55, "Ghosted", 30, "Medium", 48000, 55000, "USD", null, null, "No reply after two follow-ups.", [["Applied", 55], ["Ghosted", 30]]);
    A("Fabrikam Logistics", "Business Analyst", "Chicago, IL", "On-site", "Referral", 50, "Interview", 8, "High", 70000, 85000, "USD", 43, null, "Referred by a former colleague.", [["Applied", 50], ["Screening", 43], ["Interview", 8]], ["Liam Ortiz", "liam@example.com"]);
    A("Tailspin Systems", "Project Manager", "Denver, CO", "Hybrid", "Indeed", 47, "Withdrawn", 35, "Low", 80000, 95000, "USD", 40, null, "Salary too low.", [["Applied", 47], ["Screening", 40], ["Withdrawn", 35]]);
    A("Adventure Works", "Marketing Analyst", "Remote", "Remote", "LinkedIn", 40, "Offer", 5, "High", 65000, 78000, "USD", 33, 5, "Offer received, deciding by Friday.", [["Applied", 40], ["Screening", 33], ["Interview", 25], ["Offer", 5]], ["Priya Nair", "priya@example.com"]);
    A("Litware Analytics", "Data Analyst", "Seattle, WA", "Hybrid", "Recruiter", 36, "Assessment", 6, "High", 68000, 80000, "USD", 30, null, "Take-home test due next week.", [["Applied", 36], ["Screening", 30], ["Assessment", 6]], ["Sam Reed", "sam@example.com"]);
    A("Proseware Cloud", "Customer Success Manager", "Remote", "Remote", "Company Site", 30, "Screening", 12, "Medium", 62000, 74000, "USD", 24, null, "", [["Applied", 30], ["Screening", 12]]);
    A("Wingtip Studio", "Product Designer", "Berlin", "Hybrid", "LinkedIn", 26, "Applied", 26, "Medium", 52000, 62000, "EUR", null, null, "", [["Applied", 26]]);
    A("Lucerne Finance", "Financial Analyst", "London", "On-site", "Indeed", 21, "Applied", 21, "Low", 45000, 52000, "GBP", null, null, "", [["Applied", 21]]);
    A("Margie Travel", "Operations Analyst", "Remote", "Remote", "Other", 16, "Applied", 16, "Medium", 50000, 58000, "USD", null, null, "", [["Applied", 16]]);
    A("Coho Retail", "Supply Chain Analyst", "Dallas, TX", "On-site", "Company Site", 12, "Screening", 4, "Medium", 58000, 66000, "USD", 9, null, "", [["Applied", 12], ["Screening", 4]], ["Jo Park", "jo@example.com"]);
    A("Blue Yonder Energy", "Data Engineer", "Houston, TX", "Hybrid", "Recruiter", 8, "Applied", 8, "High", 90000, 110000, "USD", null, null, "", [["Applied", 8]]);
    A("Alpine Ski House", "Event Coordinator", "Denver, CO", "On-site", "Referral", 4, "Wishlist", 4, "Low", 40000, 46000, "USD", null, null, "Apply before the end of the month.", [["Wishlist", 4]]);
    A("Northwind Labs", "Data Analyst", "Austin, TX", "Hybrid", "Company Site", 1, "Applied", 1, "High", 60000, 72000, "USD", null, null, "Re-applied to the new posting.", [["Applied", 1]]);
    const I = (appId, type, off, time, tz, outcome, dur, who) =>
      out.interviews.push({ id: U.fmtId("INT", out.counters.int++), appId, type, date: U.addDays(t, off), time, tz, duration: dur, place: "", interviewer: who, outcome, notes: "", deleted: false, created: t, updated: t });
    I("APP-0003", "Phone Screen", -40, "10:00", "America/Chicago", "Passed", 30, "Liam Ortiz");
    I("APP-0003", "Video", -30, "14:30", "America/Chicago", "Passed", 60, "Team lead");
    I("APP-0003", "On-site", 3, "11:00", "America/Chicago", "Pending", 120, "Panel of 3");
    I("APP-0005", "Video", -25, "09:00", "UTC", "Passed", 45, "Priya Nair");
    I("APP-0005", "Final", -14, "13:00", "UTC", "Passed", 60, "Director");
    I("APP-0006", "Technical", 6, "16:00", "America/Los_Angeles", "Pending", 90, "Sam Reed");
    const F = (appId, off, type, done, notes) =>
      out.followups.push({ id: U.fmtId("FUP", out.counters.fup++), appId, due: U.addDays(t, off), type, done, doneDate: done ? U.addDays(t, off + 1) : "", notes, deleted: false, created: t, updated: t });
    F("APP-0002", 0, "Email", false, "Second follow-up already sent");
    F("APP-0008", -2, "Email", false, "Ask about the hiring timeline");
    F("APP-0009", 3, "LinkedIn", false, "Message the recruiter");
    F("APP-0005", -5, "Call", true, "Asked for the offer in writing");
    F("APP-0011", -6, "Email", false, "Confirm interview slot");
    await restore(out);
  }

  JT.store = {
    SCHEMA_VERSION, LISTS, RESPONDED, FLOW, KINDS,
    load, saveSettings, saveCounters, nextId, bumpCounter, persistRecord,
    get settings() { return st.settings; },
    get raw() { return st; },
    apps, ints, fups, appById, appLive, label, isActive, isAwaiting, needsFollowUp, isDuplicate, sameKey, reached,
    statusByName, statusByKey, keyOfName, statusUsage, blankApp,
    saveApp, saveInt, saveFup, setDeleted, purge, trashed, emptyTrash, saveStatuses,
    metrics, exportAll, validateBackup, restore, wipe, loadSample, defaultSettings,
  };
})();
