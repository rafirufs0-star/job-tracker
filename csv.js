/* CSV import and export. Column names and order match the spreadsheet templates, so files move between the app, Excel and Sheets. */
(function () {
  const JT = (window.JT = window.JT || {});
  const U = JT.util;
  const L = () => JT.store.LISTS;

  const HEADERS = {
    applications: ["ID", "Company", "Job Title", "Location", "Work Type", "Job Link", "Source", "Date Applied", "Status", "Status Updated", "Priority", "Salary Min", "Salary Max", "Currency", "Contact Name", "Contact Email", "First Response Date", "Offer Date", "Notes", "Archived", "Created", "Updated"],
    interviews: ["ID", "Application ID", "Interview Type", "Date", "Time", "Time Zone", "Duration Min", "Location or Link", "Interviewer", "Outcome", "Notes", "Created", "Updated"],
    followups: ["ID", "Application ID", "Due Date", "Type", "Done", "Done Date", "Notes", "Created", "Updated"],
  };
  const FILENAMES = { applications: "applications.csv", interviews: "interviews.csv", followups: "follow-ups.csv" };

  /* ----- writing ----- */
  /* A cell that starts with = + - @ (or a tab or return) could run as a formula in a spreadsheet, so it gets a leading apostrophe. */
  function safeCell(v) {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const yn = (b) => (b ? "Yes" : "No");
  const rowOf = {
    applications: (a) => [a.id, a.company, a.title, a.location, a.workType, a.link, a.source, a.dateApplied, a.status, a.statusUpdated, a.priority, a.salaryMin, a.salaryMax, a.currency, a.contactName, a.contactEmail, a.firstResponse, a.offerDate, a.notes, yn(a.archived), a.created, a.updated],
    interviews: (i) => [i.id, i.appId, i.type, i.date, i.time, i.tz, i.duration, i.place, i.interviewer, i.outcome, i.notes, i.created, i.updated],
    followups: (f) => [f.id, f.appId, f.due, f.type, yn(f.done), f.doneDate, f.notes, f.created, f.updated],
  };
  function build(kind, records) {
    const lines = [HEADERS[kind].map(safeCell).join(",")].concat(records.map((r) => rowOf[kind](r).map(safeCell).join(",")));
    return "﻿" + lines.join("\r\n") + "\r\n";
  }
  function exportKind(kind) {
    const S = JT.store;
    const recs = kind === "applications" ? S.apps() : kind === "interviews" ? S.ints() : S.fups();
    return { name: FILENAMES[kind], text: build(kind, recs), count: recs.length };
  }
  const template = (kind) => build(kind, []);

  /* ----- reading ----- */
  function parse(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }
  /* Removes the protective apostrophe added on export. Values are always treated as plain text. */
  const clean = (v) => {
    v = (v == null ? "" : String(v)).trim();
    return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v;
  };
  const same = (a, b) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
  function pick(list, v) {
    const found = list.find((x) => same(x, v));
    return found || null;
  }
  const detectKind = (header) => {
    const h = header.map((x) => x.trim().replace(/^﻿/, ""));
    return Object.keys(HEADERS).find((k) => HEADERS[k].every((c) => h.includes(c))) || null;
  };

  /* Reads one file's rows into records and problems. Nothing is stored yet. */
  function readRows(kind, rows) {
    const S = JT.store;
    const header = rows[0].map((h) => h.trim().replace(/^﻿/, ""));
    const idx = {};
    HEADERS[kind].forEach((h) => (idx[h] = header.indexOf(h)));
    const get = (r, h) => clean(r[idx[h]]);
    const out = [], errors = [];
    rows.slice(1).forEach((r, n) => {
      const line = n + 2;
      const bad = (key, vars) => errors.push({ line, key, vars: vars || {} });
      const optDate = (h) => { const v = get(r, h); if (v && !U.isDate(v)) { bad("csv.errDate", { col: h }); return false; } return v; };
      const t = U.today();
      if (kind === "applications") {
        const company = get(r, "Company"), title = get(r, "Job Title");
        if (!company || !title) return bad("csv.errRequiredApp");
        const dateApplied = optDate("Date Applied"), statusUpdated = optDate("Status Updated"), firstResponse = optDate("First Response Date"), offerDate = optDate("Offer Date");
        if ([dateApplied, statusUpdated, firstResponse, offerDate].includes(false)) return;
        const wt = get(r, "Work Type") ? pick(L().workType, get(r, "Work Type")) : "Remote";
        if (!wt) return bad("csv.errList", { col: "Work Type" });
        const pr = get(r, "Priority") ? pick(L().priority, get(r, "Priority")) : "Medium";
        if (!pr) return bad("csv.errList", { col: "Priority" });
        const num = (h) => { const v = get(r, h); if (v === "") return ""; const x = Number(v.replace(/[, ]/g, "")); return isFinite(x) && x >= 0 ? x : false; };
        const smin = num("Salary Min"), smax = num("Salary Max");
        if (smin === false || smax === false) return bad("csv.errNumber", { col: "Salary" });
        const cur = (get(r, "Currency") || "USD").toUpperCase();
        if (!/^[A-Z]{3}$/.test(cur)) return bad("csv.errCurrency");
        const email = get(r, "Contact Email");
        if (email && !/^\S+@\S+\.\S+$/.test(email)) return bad("csv.errEmail");
        const status = get(r, "Status") || "Applied";
        const known = S.statusByName(status) ? S.statusByName(status).name : status;
        out.push({
          id: get(r, "ID"), company, title, location: get(r, "Location"), workType: wt, link: get(r, "Job Link"), source: get(r, "Source") || "Other",
          dateApplied, status: known, statusUpdated: statusUpdated || dateApplied || t, priority: pr, salaryMin: smin, salaryMax: smax, currency: cur,
          contactName: get(r, "Contact Name"), contactEmail: email, firstResponse, offerDate, notes: get(r, "Notes"),
          archived: /^(yes|true|1)$/i.test(get(r, "Archived")), created: get(r, "Created") || t, updated: get(r, "Updated") || t, deleted: false,
          __line: line,
        });
      } else if (kind === "interviews") {
        const appId = get(r, "Application ID"), date = get(r, "Date"), time = get(r, "Time");
        if (!appId || !date) return bad("csv.errRequiredInt");
        if (!U.isDate(date)) return bad("csv.errDate", { col: "Date" });
        if (time && !U.isTime(time)) return bad("csv.errTime");
        const outcome = get(r, "Outcome") ? pick(L().outcome, get(r, "Outcome")) : "Pending";
        if (!outcome) return bad("csv.errList", { col: "Outcome" });
        const dur = get(r, "Duration Min");
        if (dur && !(Number(dur) >= 0)) return bad("csv.errNumber", { col: "Duration Min" });
        out.push({
          id: get(r, "ID"), appId, type: get(r, "Interview Type") || "Video", date, time: time || "", tz: get(r, "Time Zone"), duration: dur ? Number(dur) : "",
          place: get(r, "Location or Link"), interviewer: get(r, "Interviewer"), outcome, notes: get(r, "Notes"), created: get(r, "Created") || t, updated: get(r, "Updated") || t, deleted: false, __line: line,
        });
      } else {
        const appId = get(r, "Application ID"), due = get(r, "Due Date");
        if (!appId || !due) return bad("csv.errRequiredFup");
        if (!U.isDate(due)) return bad("csv.errDate", { col: "Due Date" });
        const doneDate = optDate("Done Date");
        if (doneDate === false) return;
        const type = get(r, "Type") ? pick(L().followType, get(r, "Type")) : "Email";
        if (!type) return bad("csv.errList", { col: "Type" });
        const done = /^(yes|true|1)$/i.test(get(r, "Done"));
        out.push({ id: get(r, "ID"), appId, due, type, done, doneDate: done ? doneDate || t : "", notes: get(r, "Notes"), created: get(r, "Created") || t, updated: get(r, "Updated") || t, deleted: false, __line: line });
      }
    });
    return { records: out, errors, total: rows.length - 1 };
  }

  /* Builds an import plan from several parsed files. Duplicates are flagged, never overwritten. */
  function plan(files) {
    const S = JT.store;
    const result = { files: [], unknown: [] };
    const seenApps = new Set(S.apps().map(S.sameKey));
    const existingIds = { applications: new Set(S.raw.apps.map((a) => a.id)), interviews: new Set(S.raw.ints.map((a) => a.id)), followups: new Set(S.raw.fups.map((a) => a.id)) };
    const batchAppIds = new Set(S.raw.apps.filter((a) => !a.deleted).map((a) => a.id));
    const order = ["applications", "interviews", "followups"];
    const parsed = files.map((f) => ({ name: f.name, rows: parse(f.text) }));
    const bucket = {};
    parsed.forEach((p) => {
      if (!p.rows.length) return result.unknown.push(p.name);
      const kind = detectKind(p.rows[0]);
      if (!kind) return result.unknown.push(p.name);
      bucket[kind] = (bucket[kind] || []).concat([{ name: p.name, rows: p.rows }]);
    });
    order.forEach((kind) => {
      (bucket[kind] || []).forEach((f) => {
        const rd = readRows(kind, f.rows);
        const fresh = [], dups = [], errors = rd.errors.slice();
        const keysInFile = new Set();
        rd.records.forEach((rec) => {
          let dupReason = null;
          if (rec.id && existingIds[kind].has(rec.id)) dupReason = "csv.dupId";
          else if (kind === "applications") {
            const k = S.sameKey(rec);
            if (seenApps.has(k) || keysInFile.has(k)) dupReason = "csv.dupApp";
            keysInFile.add(k);
          } else if (kind === "interviews") {
            const k = [rec.appId, rec.date, rec.time, rec.type].join("|");
            if (keysInFile.has(k) || S.raw.ints.some((i) => !i.deleted && [i.appId, i.date, i.time, i.type].join("|") === k)) dupReason = "csv.dupInt";
            keysInFile.add(k);
          } else {
            const k = [rec.appId, rec.due, rec.type, rec.notes].join("|");
            if (keysInFile.has(k) || S.raw.fups.some((x) => !x.deleted && [x.appId, x.due, x.type, x.notes].join("|") === k)) dupReason = "csv.dupFup";
            keysInFile.add(k);
          }
          if (kind !== "applications" && !batchAppIds.has(rec.appId) && !(bucket.applications || []).length) {
            errors.push({ line: rec.__line, key: "csv.errNoApp", vars: { id: rec.appId } });
            return;
          }
          (dupReason ? dups : fresh).push(Object.assign(rec, dupReason ? { __why: dupReason } : {}));
        });
        if (kind === "applications") fresh.concat(dups).forEach((r) => r.id && batchAppIds.add(r.id));
        result.files.push({ kind, name: f.name, total: rd.total, fresh, dups, errors });
      });
    });
    return result;
  }

  /* Applies a plan. Returns counts and any records that were skipped because their application is unknown. */
  async function apply(planResult, includeDuplicates) {
    const S = JT.store;
    const st = S.raw;
    const counts = { applications: 0, interviews: 0, followups: 0, skipped: 0 };
    const idMap = {};
    const bumpOrNew = (kind, rec, allowKeep) => {
      const n = U.idNumber(rec.id, S.KINDS[kind].prefix);
      const taken = st[S.KINDS[kind].list].some((x) => x.id === rec.id);
      if (allowKeep && n != null && !taken) { S.bumpCounter(kind, rec.id); return rec.id; }
      return S.nextId(kind);
    };
    for (const f of planResult.files) {
      const list = f.fresh.concat(includeDuplicates ? f.dups : []);
      if (f.kind === "applications") {
        for (const r of list) {
          const old = r.id;
          const wasDup = !!r.__why;
          const fresh = Object.assign(S.blankApp(), r);
          delete fresh.__line; delete fresh.__why;
          fresh.id = bumpOrNew("app", r, !wasDup);
          if (old) idMap[old] = fresh.id;
          fresh.history = [{ status: fresh.status, date: fresh.statusUpdated }];
          st.apps.push(fresh);
          await S.persistRecord("app", fresh);
          counts.applications++;
        }
      } else if (f.kind === "interviews") {
        for (const r of list) {
          const appId = idMap[r.appId] || r.appId;
          if (!S.appLive(appId)) { counts.skipped++; continue; }
          const rec = Object.assign({}, r, { appId });
          delete rec.__line; delete rec.__why;
          rec.id = bumpOrNew("int", r, !r.__why);
          st.ints.push(rec);
          await S.persistRecord("int", rec);
          counts.interviews++;
        }
      } else {
        for (const r of list) {
          const appId = idMap[r.appId] || r.appId;
          if (!S.appLive(appId)) { counts.skipped++; continue; }
          const rec = Object.assign({}, r, { appId });
          delete rec.__line; delete rec.__why;
          rec.id = bumpOrNew("fup", r, !r.__why);
          st.fups.push(rec);
          await S.persistRecord("fup", rec);
          counts.followups++;
        }
      }
    }
    // Status names that appeared in the file become real statuses so nothing is dropped.
    st.apps.forEach((a) => {
      if (!S.statusByName(a.status)) st.settings.statuses.push({ key: "s" + U.uid(), name: a.status, active: true, awaiting: false });
    });
    await S.saveSettings();
    return counts;
  }

  function errorReport(planResult) {
    const lines = [["File", "Row", "Problem"].map(safeCell).join(",")];
    planResult.files.forEach((f) => f.errors.forEach((e) => lines.push([f.name, e.line, JT.i18n.t(e.key, e.vars)].map(safeCell).join(","))));
    return "﻿" + lines.join("\r\n") + "\r\n";
  }

  JT.csv = { HEADERS, FILENAMES, exportKind, template, plan, apply, errorReport, parse };
})();
