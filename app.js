/* User interface: routing, views, dialogs, settings, install and update prompts. */
(function () {
  const JT = window.JT;
  const U = JT.util, S = JT.store, I = JT.i18n, CSV = JT.csv, ICS = JT.ics, DB = JT.db;
  const { $, $$, esc } = U;
  const t = I.t;
  const L = S.LISTS;

  const ROUTES = ["dashboard", "applications", "interviews", "followups", "settings"];
  let route = "dashboard";
  let filters = { q: "", status: "", reached: "", archived: false, sort: "applied", intTab: "upcoming", fupTab: "open" };
  let undoFn = null, toastTimer = null, lastFocus = null;
  let deferredInstall = null, updateWorker = null, userWantsUpdate = false;
  let pendingImport = null, pendingRestore = null;
  const DAYMS = 864e5;

  const IC = {
    dashboard: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
    applications: '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3.5 13h17"/>',
    interviews: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
    followups: '<path d="M8.5 12.5l2.5 2.5 4.5-5"/><circle cx="12" cy="12" r="8.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  const svgIcon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;
  const LOGO = '<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#2F2A6E"/><rect x="15" y="14" width="34" height="38" rx="6" fill="none" stroke="#EDEBFA" stroke-width="3.5"/><path d="M24 33l6 6 11-13" fill="none" stroke="#D9AE62" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><rect x="25" y="10" width="14" height="8" rx="3" fill="#D9AE62"/></svg>';

  /* ---------- small helpers ---------- */
  const val = (v) => (v == null || v === "" ? "—" : v);
  const dash = (n, suffix) => (n == null ? "—" : n + (suffix || ""));
  function chipFor(name) {
    const k = S.keyOfName(name);
    const cls = { wishlist: "mute", applied: "brand", screening: "info", interview: "info", assessment: "info", offer: "", accepted: "", rejected: "bad", withdrawn: "mute", ghosted: "mute" }[k];
    return `<span class="chip ${cls == null ? "brand" : cls}">${esc(name)}</span>`;
  }
  const dateOrDash = (d) => (d ? I.fmtDate(d) : "—");
  function greeting() {
    const h = new Date().getHours();
    return t(h < 12 ? "dash.goodMorning" : h < 18 ? "dash.goodAfternoon" : "dash.goodEvening");
  }
  function toast(msg, undo) {
    undoFn = undo || null;
    const el = $("#toast");
    el.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${undo ? `<button data-act="undo">${t("common.undo")}</button>` : ""}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.innerHTML = ""; undoFn = null; }, 7000);
  }
  function openDlg(html) {
    const d = $("#dlg");
    lastFocus = document.activeElement;
    d.innerHTML = `<div class="dlg">${html}</div>`;
    if (!d.open) d.showModal();
    const first = $("[autofocus], input:not([type=hidden]):not([type=checkbox]), select, textarea", d);
    if (first && window.matchMedia("(min-width: 700px)").matches) first.focus();
  }
  function closeDlg() {
    const d = $("#dlg");
    if (d.open) d.close();
  }

  /* ---------- chrome: sidebar, top bar, tabs, banners ---------- */
  function backupInfo() {
    const lb = S.settings.lastBackup;
    if (!lb) return { cls: "warn", text: t("bk.none") };
    const n = U.diffDays(U.today(), lb);
    const late = S.settings.backupDays > 0 && n > S.settings.backupDays;
    return { cls: late ? "warn" : "", text: t(n === 1 ? "bk.dayAgo" : "bk.daysAgo", { n }) };
  }
  function renderChrome() {
    const nav = ROUTES.map((r) => `<button data-act="go" data-r="${r}" ${route === r ? 'aria-current="page"' : ""}>${svgIcon(r)}<span>${t("nav." + r)}</span></button>`).join("");
    const bk = backupInfo();
    $("#side").innerHTML = `<div class="brand">${LOGO}<b>${t("app.name")}</b></div><nav aria-label="${t("nav.main")}">${nav}</nav>
      <div class="foot"><span class="chip onDeep ${bk.cls}">${esc(bk.text)}</span><span>${t("app.privacyShort")}</span></div>`;
    $("#top").innerHTML = `<div class="brand">${LOGO}<b>${t("app.name")}</b></div>
      <div class="row" style="flex-wrap:nowrap">${deferredInstall ? `<button class="iconbtn" data-act="install">${t("inst.install")}</button>` : ""}<span class="chip onDeep ${bk.cls}">${esc(bk.text)}</span></div>`;
    $("#tabs").innerHTML = nav;
    $("#tabs").setAttribute("aria-label", t("nav.main"));
    $(".skip").textContent = t("app.skip");
  }
  function renderBanners() {
    const s = S.settings, today = U.today(), out = [];
    if (!DB.isAvailable()) out.push(`<div class="banner"><div><b>${t("warn.noStorageTitle")}</b>${t("warn.noStorage")}</div></div>`);
    if (updateWorker) out.push(`<div class="banner info"><div><b>${t("upd.title")}</b>${t("upd.text")}</div><button class="btn sm" data-act="applyUpdate">${t("upd.reload")}</button></div>`);
    if (s.sample) out.push(`<div class="banner info"><div><b>${t("sample.title")}</b>${t("sample.text")}</div><button class="btn sm ghost" data-act="clearSample">${t("sample.clear")}</button></div>`);
    const ios = U.isIOS() && !U.isStandalone();
    if (ios) {
      if (!s.installDismissedUntil || s.installDismissedUntil <= today)
        out.push(`<div class="banner"><div><b>${t("inst.iosTitle")}</b>${t("inst.iosText")}</div><button class="btn sm ghost" data-act="dismissInstall">${t("inst.notNow")}</button></div>`);
      else out.push(`<div class="banner slim"><span>${t("inst.iosSlim")}</span><button class="btn sm ghost" data-act="iosHelp">${t("inst.how")}</button></div>`);
    }
    const hasData = S.raw.apps.length > 0;
    if (!s.sample && hasData && s.backupDays > 0) {
      const late = !s.lastBackup ? true : U.diffDays(today, s.lastBackup) >= s.backupDays;
      if (late) out.push(`<div class="banner"><div><b>${t("bk.remindTitle")}</b>${t("bk.remindText")}</div><button class="btn sm brass" data-act="backup">${t("bk.create")}</button></div>`);
    }
    $("#banners").innerHTML = out.join("");
  }

  /* ---------- dashboard ---------- */
  function vDashboard() {
    const m = S.metrics();
    const today = U.today();
    const attn = m.fupDue.length + m.intNext.length + m.noResp.length;
    if (!m.total) {
      return `<div class="hero"><h2>${greeting()}</h2><p>${t("dash.emptyLead")}</p></div>
        <div class="empty"><h3>${t("dash.emptyTitle")}</h3><p>${t("dash.emptyText")}</p>
        <button class="btn brass" data-act="newApp">${svgIcon("plus")}${t("dash.addFirst")}</button>
        <button class="btn ghost" data-act="pickCsv">${t("dash.importCsv")}</button>
        <button class="btn ghost" data-act="loadSample">${t("dash.trySample")}</button></div>`;
    }
    const stat = (n, l, c) => `<div class="card stat ${c || "primary"}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    const rows = [];
    m.fupDue.forEach((f) => {
      const late = f.due < today;
      rows.push(`<div class="a"><div class="txt"><b>${late ? t("dash.overdue") : t("dash.dueToday")}</b> · ${t("dash.fupLine", { type: esc(f.type) })}<br><span class="muted small">${esc(S.label(S.appById(f.appId)))}${late ? " · " + I.fmtDate(f.due) : ""}</span></div><button class="btn sm" data-act="doneFup" data-id="${f.id}">${t("fups.markDone")}</button></div>`);
    });
    m.intNext.forEach((i) => rows.push(`<div class="a info"><div class="txt"><b>${esc(i.type)}</b> · ${I.fmtDate(i.date)}${i.time ? " " + esc(i.time) : ""}<br><span class="muted small">${esc(S.label(S.appById(i.appId)))}</span></div><button class="btn sm ghost" data-act="editInt" data-id="${i.id}">${t("common.open")}</button></div>`));
    m.noResp.slice(0, 6).forEach((a) => rows.push(`<div class="a"><div class="txt"><b>${t("dash.noResponse", { n: U.diffDays(today, a.dateApplied) })}</b><br><span class="muted small">${esc(S.label(a))}</span></div><button class="btn sm ghost" data-act="newFupFor" data-id="${a.id}">${t("fups.add")}</button></div>`));
    const max = Math.max(1, ...m.stages.map((s) => s.count));
    const funnel = m.stages.map((s, i) => {
      const prev = i ? m.stages[i - 1].count - s.count : 0;
      return `<button class="f" data-act="stageFilter" data-k="${s.key}" aria-label="${esc(s.name)}: ${s.count}"><span>${esc(s.name)}</span><span class="bar"><i style="width:${Math.max(2, (100 * s.count) / max)}%"></i></span><span class="d">${s.count}${prev > 0 ? ` <small>(−${prev})</small>` : ""}</span></button>`;
    }).join("");
    const goal = S.settings.weeklyGoal;
    const ymax = Math.max(goal, ...m.weeks.map((w) => w.n), 1);
    const yy = (v) => 130 - (v / ymax) * 112;
    const bars = m.weeks.map((w, i) => {
      const x = 22 + i * 39, h = (w.n / ymax) * 112;
      return `<rect x="${x}" y="${130 - h}" width="28" height="${h}" rx="4" fill="var(--primary)"></rect><text x="${x + 14}" y="${130 - h - 4}" text-anchor="middle" style="font-weight:700">${w.n || ""}</text><text x="${x + 14}" y="146" text-anchor="middle">${I.fmtDate(w.start)}</text>`;
    }).join("");
    const chartLabel = t("dash.chartLabel", { goal });
    const recent = m.recent.map((e) => `<button class="item" data-act="editApp" data-id="${e.app.id}"><div class="body"><div class="t">${esc(e.app.company)}</div><div class="s">${esc(e.app.title)} · ${I.fmtDate(e.date)}</div></div><div class="r">${chipFor(e.status)}</div></button>`).join("");
    return `
    <div class="hero"><h2>${greeting()}</h2>
      <p>${attn ? t("dash.attnLead", { n: attn }) : t("dash.allClear")}</p>
      <div class="row" style="justify-content:flex-start"><button class="btn brass" data-act="newApp">${svgIcon("plus")}${t("apps.add")}</button><button class="btn ghost" style="color:#fff;border-color:rgba(255,255,255,.35)" data-act="newFup">${t("fups.add")}</button></div></div>
    <section class="sec"><h3>${t("dash.attention")}</h3>
      <div class="grid g3">${stat(m.fupDue.length, t("dash.statFups"), "warn")}${stat(m.intNext.length, t("dash.statInts"), "info")}${stat(m.noResp.length, t("dash.statNoResp"), "warn")}</div>
      ${rows.length ? `<div class="att" style="margin-top:10px">${rows.join("")}</div>` : `<div class="empty" style="margin-top:10px">${t("dash.nothing")}</div>`}</section>
    <section class="sec"><h3>${t("dash.key")}</h3><div class="grid g4">${stat(m.active, t("dash.statActive"))}${stat(m.appliedWeek, t("dash.statWeek"))}${stat(m.upcoming, t("dash.statUpcoming"))}${stat(m.offers, t("dash.statOffers"), "brass")}</div></section>
    <section class="sec"><h3>${t("dash.rates")}</h3><div class="grid g4">${stat(dash(m.response, "%"), t("dash.rateResponse"))}${stat(dash(m.interviewRate, "%"), t("dash.rateInterview"))}${stat(dash(m.offerRate, "%"), t("dash.rateOffer"), "brass")}${stat(m.avgDays == null ? "—" : m.avgDays.toFixed(1), t("dash.avgDays"))}</div>
      <p class="muted small" style="margin:8px 0 0">${t("dash.ratesNote", { n: S.settings.minSample })}</p></section>
    <div class="grid g2" style="margin-top:22px;align-items:start">
      <section><div class="sec" style="margin-top:0"><h3>${t("dash.pipeline")}</h3></div><div class="card funnel">${funnel}<p class="muted small" style="margin:8px 4px 0">${t("dash.pipelineNote")}</p></div></section>
      <section><div class="sec" style="margin-top:0"><h3>${t("dash.weekly")}</h3></div><div class="card"><svg class="chart" viewBox="0 0 340 154" width="100%" role="img" aria-label="${esc(chartLabel)}">
        <line class="gl" x1="14" x2="336" y1="130" y2="130"></line>
        <line x1="14" x2="336" y1="${yy(goal)}" y2="${yy(goal)}" stroke="var(--brass)" stroke-width="1.6" stroke-dasharray="5 4"></line>
        <text x="336" y="${yy(goal) - 4}" text-anchor="end" style="fill:var(--brass-ink);font-weight:700">${t("dash.goal", { goal })}</text>${bars}</svg></div></section></div>
    <section class="sec"><h3>${t("dash.recent")}</h3><div class="list">${recent}</div></section>`;
  }

  /* ---------- applications ---------- */
  function appRows() {
    const f = filters, q = f.q.trim().toLowerCase();
    const pr = { High: 0, Medium: 1, Low: 2 };
    let list = S.apps().filter((a) => (f.archived || !a.archived) && (!f.status || a.status === f.status) && (!f.reached || S.reached(a, f.reached)) &&
      (!q || [a.company, a.title, a.location, a.id].join(" ").toLowerCase().includes(q)));
    const cmp = {
      applied: (a, b) => (b.dateApplied || "").localeCompare(a.dateApplied || ""),
      company: (a, b) => a.company.localeCompare(b.company),
      updated: (a, b) => (b.statusUpdated || "").localeCompare(a.statusUpdated || ""),
      priority: (a, b) => pr[a.priority] - pr[b.priority] || (b.dateApplied || "").localeCompare(a.dateApplied || ""),
    }[f.sort];
    list = list.sort(cmp);
    if (!list.length) return `<div class="empty">${S.apps().length ? t("apps.noMatch") : t("apps.none")}</div>`;
    return list.map((a) => {
      const sal = a.salaryMin !== "" && a.salaryMin != null ? ` · ${I.fmtMoney(a.salaryMin, a.currency)}${a.salaryMax ? "–" + I.fmtNum(a.salaryMax) : ""}` : "";
      return `<button class="item" data-act="editApp" data-id="${a.id}"><div class="body"><div class="t">${esc(a.company)}</div><div class="s">${esc(a.title)}${a.location ? " · " + esc(a.location) : ""}</div>
        <div class="s">${a.id}${a.dateApplied ? " · " + t("apps.appliedOn", { d: I.fmtDate(a.dateApplied) }) : ""}${sal}</div></div>
        <div class="r">${chipFor(a.status)}${S.needsFollowUp(a) ? `<span class="chip warn">${t("apps.followUp")}</span>` : ""}${S.isDuplicate(a) ? `<span class="chip warn">${t("apps.duplicate")}</span>` : ""}${a.archived ? `<span class="chip mute">${t("apps.archived")}</span>` : ""}</div></button>`;
    }).join("");
  }
  function vApplications() {
    const stageName = filters.reached ? (S.statusByKey(filters.reached) || {}).name : "";
    return `<div class="pagehead"><div><h2>${t("nav.applications")}</h2><p>${t("apps.count", { n: S.apps().length })}</p></div><button class="btn brass" data-act="newApp">${svgIcon("plus")}${t("apps.add")}</button></div>
    <div class="toolbar"><div class="grow"><label class="sr" for="q">${t("common.search")}</label><input id="q" type="search" placeholder="${t("apps.searchPh")}" value="${esc(filters.q)}"></div>
      <div><label class="sr" for="fs">${t("apps.filterStatus")}</label><select id="fs"><option value="">${t("apps.allStatuses")}</option>${S.settings.statuses.map((s) => `<option ${filters.status === s.name ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div><label class="sr" for="fo">${t("apps.sort")}</label><select id="fo">${["applied", "company", "updated", "priority"].map((k) => `<option value="${k}" ${filters.sort === k ? "selected" : ""}>${t("apps.sort_" + k)}</option>`).join("")}</select></div></div>
    <div class="row" style="margin-bottom:10px"><label class="inline"><input type="checkbox" id="arch" ${filters.archived ? "checked" : ""}>${t("apps.showArchived")}</label>
      ${stageName ? `<button class="chip brand" data-act="clearStage" style="border:0;cursor:pointer">${t("apps.reachedFilter", { s: esc(stageName) })} ✕</button>` : ""}</div>
    <div class="list" id="applist">${appRows()}</div>`;
  }

  /* ---------- interviews and follow-ups ---------- */
  function vInterviews() {
    const today = U.today(), tab = filters.intTab;
    let list = S.ints();
    if (tab === "upcoming") list = list.filter((i) => i.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    else if (tab === "past") list = list.filter((i) => i.date < today).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    else list = list.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    const rows = list.map((i) => {
      const when = i.date < today ? ["ints.past", "mute"] : U.diffDays(i.date, today) <= 7 ? ["ints.next7", "info"] : ["ints.later", "brand"];
      return `<button class="item" data-act="editInt" data-id="${i.id}"><div class="body"><div class="t">${esc(i.type)} · ${I.fmtDate(i.date)}${i.time ? " " + esc(i.time) : ""}</div>
        <div class="s">${esc(S.label(S.appById(i.appId)))}</div><div class="s">${esc(i.tz || "")}${i.place ? " · " + esc(i.place) : ""}</div></div>
        <div class="r"><span class="chip ${when[1]}">${t(when[0])}</span><span class="chip ${i.outcome === "Passed" ? "" : i.outcome === "Failed" ? "bad" : "mute"}">${t("out." + i.outcome)}</span></div></button>`;
    }).join("");
    return `<div class="pagehead"><div><h2>${t("nav.interviews")}</h2><p>${t("ints.lead")}</p></div><button class="btn brass" data-act="newInt">${svgIcon("plus")}${t("ints.add")}</button></div>
      <div class="toolbar"><div class="seg" role="group" aria-label="${t("ints.show")}">${["upcoming", "past", "all"].map((k) => `<button data-act="intTab" data-k="${k}" aria-pressed="${tab === k}">${t("ints.tab_" + k)}</button>`).join("")}</div>
      <button class="btn ghost sm" data-act="icsAll" style="margin-left:auto">${t("ics.export")}</button></div>
      <div class="list">${rows || `<div class="empty">${t("ints.none")}</div>`}</div>`;
  }
  function vFollowups() {
    const today = U.today(), tab = filters.fupTab;
    let list = S.fups();
    if (tab === "open") list = list.filter((f) => !f.done).sort((a, b) => a.due.localeCompare(b.due));
    else if (tab === "done") list = list.filter((f) => f.done).sort((a, b) => b.due.localeCompare(a.due));
    else list = list.sort((a, b) => a.done - b.done || a.due.localeCompare(b.due));
    const rows = list.map((f) => {
      const s = f.done ? ["fups.done", ""] : f.due < today ? ["dash.overdue", "bad"] : f.due === today ? ["dash.dueToday", "warn"] : ["fups.upcoming", "info"];
      return `<div class="item"><button class="body" data-act="editFup" data-id="${f.id}" style="background:none;border:0;text-align:left;padding:0;color:inherit;min-height:44px"><div class="t">${esc(f.type)} · ${I.fmtDate(f.due)}</div><div class="s">${esc(S.label(S.appById(f.appId)))}</div><div class="s">${esc(f.notes || "")}</div></button>
        <div class="r"><span class="chip ${s[1]}">${t(s[0])}</span>${f.done ? "" : `<button class="btn sm" data-act="doneFup" data-id="${f.id}">${t("fups.markDone")}</button>`}</div></div>`;
    }).join("");
    return `<div class="pagehead"><div><h2>${t("nav.followups")}</h2><p>${t("fups.lead")}</p></div><button class="btn brass" data-act="newFup">${svgIcon("plus")}${t("fups.add")}</button></div>
      <div class="toolbar"><div class="seg" role="group" aria-label="${t("fups.show")}">${["open", "done", "all"].map((k) => `<button data-act="fupTab" data-k="${k}" aria-pressed="${tab === k}">${t("fups.tab_" + k)}</button>`).join("")}</div>
      <button class="btn ghost sm" data-act="icsAll" style="margin-left:auto">${t("ics.export")}</button></div>
      <div class="list">${rows || `<div class="empty">${t("fups.none")}</div>`}</div>`;
  }

  /* ---------- settings ---------- */
  function statusRows(list) {
    return list.map((s, i) => `<div class="statusrow" data-key="${esc(s.key)}">
      <input type="text" name="sname" value="${esc(s.name)}" aria-label="${t("set.statusName")}">
      <div class="flags"><label><input type="checkbox" name="sactive" ${s.active ? "checked" : ""}>${t("set.counts")}</label><label><input type="checkbox" name="sawait" ${s.awaiting ? "checked" : ""}>${t("set.awaiting")}</label></div>
      <div class="mv"><button class="btn ghost sm" data-act="stUp" aria-label="${t("set.moveUp")}">↑</button><button class="btn ghost sm" data-act="stDown" aria-label="${t("set.moveDown")}">↓</button></div>
      <button class="btn ghost sm" data-act="stRemove">${t("common.remove")}</button></div>`).join("");
  }
  function vSettings() {
    const s = S.settings, bk = backupInfo(), tr = S.trashed();
    const trashN = tr.apps.length + tr.ints.length + tr.fups.length;
    const persist = s.persisted === true ? t("set.persistYes") : s.persisted === false ? t("set.persistNo") : t("set.persistUnknown");
    return `<div class="pagehead"><div><h2>${t("nav.settings")}</h2><p>${t("set.lead")}</p></div></div>
    <section class="sec" style="margin-top:0"><h3>${t("set.statuses")}</h3><div class="card"><p class="muted small" style="margin-top:0">${t("set.statusesNote")}</p>
      <div id="stList">${statusRows(s.statuses)}</div>
      <div class="actions"><button class="btn ghost sm" data-act="stAdd">${t("set.addStatus")}</button><button class="btn sm" data-act="stSave">${t("set.saveStatuses")}</button></div></div></section>
    <section class="sec"><h3>${t("set.reminders")}</h3><div class="card"><form class="form" data-form="settings">
      <div><label for="s_nr">${t("set.noRespDays")}</label><input id="s_nr" name="noRespDays" type="number" min="1" max="60" value="${s.noRespDays}"></div>
      <div><label for="s_wg">${t("set.weeklyGoal")}</label><input id="s_wg" name="weeklyGoal" type="number" min="1" max="200" value="${s.weeklyGoal}"></div>
      <div><label for="s_ms">${t("set.minSample")}</label><input id="s_ms" name="minSample" type="number" min="1" max="50" value="${s.minSample}"></div>
      <div><label for="s_bd">${t("set.backupReminder")}</label><select id="s_bd" name="backupDays">${[[0, "set.off"], [7, "set.every7"], [14, "set.every14"]].map(([v, k]) => `<option value="${v}" ${s.backupDays === v ? "selected" : ""}>${t(k)}</option>`).join("")}</select></div>
      <div><label for="s_lang">${t("set.language")}</label><select id="s_lang" name="lang">${I.AVAILABLE.map((l) => `<option value="${l.code}" ${s.lang === l.code ? "selected" : ""}>${l.name}</option>`).join("")}${I.PLANNED.map((l) => `<option disabled>${l.name} (${t("set.afterReview")})</option>`).join("")}</select></div>
      <div><label for="s_theme">${t("set.appearance")}</label><select id="s_theme" name="theme">${["auto", "light", "dark"].map((k) => `<option value="${k}" ${(s.theme || "auto") === k ? "selected" : ""}>${t("set.theme_" + k)}</option>`).join("")}</select></div>
      <div class="full actions" style="margin:0"><button class="btn sm" type="submit">${t("common.save")}</button></div></form></div></section>
    <section class="sec"><h3>${t("set.backup")}</h3><div class="card"><p style="margin-top:0">${t("set.privacy")}</p>
      <p class="muted small">${t("set.lastBackup")}: <b>${esc(bk.text)}</b></p>
      <div class="row" style="justify-content:flex-start"><button class="btn" data-act="backup">${t("bk.create")}</button><button class="btn ghost" data-act="pickRestore">${t("bk.restore")}</button></div></div></section>
    <section class="sec"><h3>${t("set.csv")}</h3><div class="card"><p style="margin-top:0" class="muted small">${t("set.csvNote")}</p>
      <div class="row" style="justify-content:flex-start"><button class="btn ghost sm" data-act="csvExport" data-k="applications">${t("set.expApps")}</button><button class="btn ghost sm" data-act="csvExport" data-k="interviews">${t("set.expInts")}</button><button class="btn ghost sm" data-act="csvExport" data-k="followups">${t("set.expFups")}</button></div>
      <div class="row" style="justify-content:flex-start;margin-top:10px"><button class="btn" data-act="pickCsv">${t("set.importCsv")}</button><button class="btn ghost sm" data-act="csvTemplates">${t("set.templates")}</button><button class="btn ghost sm" data-act="icsAll">${t("ics.export")}</button></div></div></section>
    <section class="sec"><h3>${t("set.install")}</h3><div class="card"><p style="margin-top:0">${t("set.storageState")}: <b>${persist}</b></p>
      <div class="row" style="justify-content:flex-start">${deferredInstall ? `<button class="btn" data-act="install">${t("inst.install")}</button>` : ""}<button class="btn ghost sm" data-act="iosHelp">${t("inst.showSteps")}</button><button class="btn ghost sm" data-act="askPersist">${t("set.askPersist")}</button></div></div></section>
    <section class="sec"><h3>${t("set.data")}</h3><div class="card"><div class="row" style="justify-content:flex-start">
      <button class="btn ghost sm" data-act="trash">${t("set.trash", { n: trashN })}</button>
      ${S.raw.apps.length === 0 ? `<button class="btn ghost sm" data-act="loadSample">${t("dash.trySample")}</button>` : ""}
      <button class="btn danger sm" data-act="wipe">${t("set.deleteAll")}</button></div></div></section>`;
  }

  const VIEWS = { dashboard: vDashboard, applications: vApplications, interviews: vInterviews, followups: vFollowups, settings: vSettings };
  function render() {
    renderChrome();
    renderBanners();
    $("#main").innerHTML = VIEWS[route]();
  }
  function go(r) {
    if (!ROUTES.includes(r)) r = "dashboard";
    if (location.hash !== "#" + r) location.hash = r;
    else { route = r; render(); }
  }
  function onHash() {
    const r = location.hash.replace("#", "");
    route = ROUTES.includes(r) ? r : "dashboard";
    render();
    window.scrollTo(0, 0);
    $("#main").focus({ preventScroll: true });
  }

  /* ---------- forms ---------- */
  const opt = (list, sel) => list.map((x) => `<option ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("");
  const optT = (list, sel, prefix) => list.map((x) => `<option value="${esc(x)}" ${x === sel ? "selected" : ""}>${t(prefix + x)}</option>`).join("");
  const field = (name, label, value, type, extra) => `<div ${extra && extra.full ? 'class="full"' : ""}><label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" type="${type || "text"}" value="${esc(value == null ? "" : value)}" ${extra && extra.attrs ? extra.attrs : ""}><div class="field-err" id="e_${name}" role="alert"></div></div>`;
  const appOptions = (sel) => S.apps().sort((a, b) => a.company.localeCompare(b.company)).map((a) => `<option value="${a.id}" ${a.id === sel ? "selected" : ""}>${esc(a.id)} · ${esc(S.label(a))}</option>`).join("");

  function appDialog(id) {
    const a = id ? S.appById(id) : S.blankApp();
    const sources = L.source.includes(a.source) ? L.source : L.source.concat(a.source);
    const linked = id ? `<h3 class="sub">${t("form.linked")}</h3>
      ${S.ints().filter((i) => i.appId === id).map((i) => `<div class="row" style="margin-bottom:6px"><span>${esc(i.type)} · ${I.fmtDate(i.date)} <span class="chip mute">${t("out." + i.outcome)}</span></span><button type="button" class="btn ghost sm" data-act="editInt" data-id="${i.id}">${t("common.edit")}</button></div>`).join("")}
      ${S.fups().filter((f) => f.appId === id).map((f) => `<div class="row" style="margin-bottom:6px"><span>${esc(f.type)} · ${I.fmtDate(f.due)} <span class="chip ${f.done ? "" : "warn"}">${t(f.done ? "fups.done" : "fups.open")}</span></span><button type="button" class="btn ghost sm" data-act="editFup" data-id="${f.id}">${t("common.edit")}</button></div>`).join("")}
      <div class="row" style="justify-content:flex-start"><button type="button" class="btn ghost sm" data-act="newIntFor" data-id="${id}">${t("ints.add")}</button><button type="button" class="btn ghost sm" data-act="newFupFor" data-id="${id}">${t("fups.add")}</button></div>
      <h3 class="sub">${t("form.history")}</h3><div class="hist">${(a.history || []).map((h, i) => `${i ? '<span class="arrow">→</span>' : ""}${chipFor(h.status)}<span class="muted">${I.fmtDate(h.date)}</span>`).join("") || "—"}</div>` : "";
    openDlg(`<h2>${id ? t("form.editApp") : t("form.newApp")}</h2>
    <form class="form" data-form="app" data-id="${id || ""}" novalidate>
      ${field("company", t("form.company") + " *", a.company, "text", { attrs: 'autocomplete="off" required' })}
      ${field("title", t("form.title") + " *", a.title, "text", { attrs: 'autocomplete="off" required' })}
      <div class="full" id="dupWarn"></div>
      ${field("location", t("form.location"), a.location)}
      <div><label for="f_workType">${t("form.workType")}</label><select id="f_workType" name="workType">${opt(L.workType, a.workType)}</select></div>
      <div><label for="f_status">${t("form.status")}</label><select id="f_status" name="status">${S.settings.statuses.map((s) => `<option ${s.name === a.status ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div><label for="f_priority">${t("form.priority")}</label><select id="f_priority" name="priority">${optT(L.priority, a.priority, "pri.")}</select></div>
      ${field("dateApplied", t("form.dateApplied"), a.dateApplied, "date")}
      <div><label for="f_source">${t("form.source")}</label><select id="f_source" name="source">${opt(sources, a.source)}</select></div>
      ${field("salaryMin", t("form.salaryMin"), a.salaryMin, "number", { attrs: 'min="0" step="1000" inputmode="numeric"' })}
      ${field("salaryMax", t("form.salaryMax"), a.salaryMax, "number", { attrs: 'min="0" step="1000" inputmode="numeric"' })}
      <div><label for="f_currency">${t("form.currency")}</label><select id="f_currency" name="currency">${opt(L.currency.includes(a.currency) ? L.currency : L.currency.concat(a.currency), a.currency)}</select></div>
      ${field("contactName", t("form.contactName"), a.contactName)}
      ${field("contactEmail", t("form.contactEmail"), a.contactEmail, "email")}
      ${field("firstResponse", t("form.firstResponse"), a.firstResponse, "date")}
      ${field("offerDate", t("form.offerDate"), a.offerDate, "date")}
      ${field("link", t("form.link"), a.link, "url", { full: true, attrs: 'placeholder="https://"' })}
      <div class="full"><label for="f_notes">${t("form.notes")}</label><textarea id="f_notes" name="notes">${esc(a.notes)}</textarea></div>
      <div class="full"><label class="inline"><input type="checkbox" name="archived" ${a.archived ? "checked" : ""}>${t("form.archived")}</label></div>
      <div class="full">${linked}</div>
      <div class="full actions">${id ? `<button type="button" class="btn danger sm left" data-act="delApp" data-id="${id}">${t("common.delete")}</button>` : ""}<button type="button" class="btn ghost" data-act="closeDlg">${t("common.cancel")}</button><button class="btn" type="submit">${t("common.save")}</button></div>
    </form>`);
    if (id) checkDup();
  }
  function checkDup() {
    const f = $("form[data-form=app]");
    if (!f) return;
    const company = f.company.value, title = f.title.value;
    const probe = { id: f.dataset.id, company, title };
    const hit = company.trim() && title.trim() && S.isDuplicate(probe);
    $("#dupWarn").innerHTML = hit ? `<div class="notice">${t("form.dupWarn")}</div>` : "";
  }
  const setErr = (name, msg) => { const e = $("#e_" + name); if (e) e.textContent = msg || ""; };

  async function submitApp(form) {
    const fd = new FormData(form);
    const g = (k) => String(fd.get(k) || "").trim();
    ["company", "title", "salaryMin", "contactEmail", "link"].forEach((k) => setErr(k, ""));
    let bad = null;
    if (!g("company")) { setErr("company", t("err.required")); bad = bad || "company"; }
    if (!g("title")) { setErr("title", t("err.required")); bad = bad || "title"; }
    if (g("contactEmail") && !/^\S+@\S+\.\S+$/.test(g("contactEmail"))) { setErr("contactEmail", t("err.email")); bad = bad || "contactEmail"; }
    if (g("link") && !/^https?:\/\//i.test(g("link"))) { setErr("link", t("err.link")); bad = bad || "link"; }
    const smin = g("salaryMin"), smax = g("salaryMax");
    if ((smin && !(Number(smin) >= 0)) || (smax && !(Number(smax) >= 0)) || (smin && smax && Number(smin) > Number(smax))) { setErr("salaryMin", t("err.salary")); bad = bad || "salaryMin"; }
    if (bad) { form["" + bad].focus(); return; }
    const data = {
      company: g("company"), title: g("title"), location: g("location"), workType: g("workType"), status: g("status"), priority: g("priority"),
      dateApplied: g("dateApplied"), source: g("source"), salaryMin: smin === "" ? "" : Number(smin), salaryMax: smax === "" ? "" : Number(smax), currency: g("currency"),
      contactName: g("contactName"), contactEmail: g("contactEmail"), firstResponse: g("firstResponse"), offerDate: g("offerDate"), link: g("link"), notes: String(fd.get("notes") || ""),
      archived: fd.get("archived") === "on",
    };
    const rec = await S.saveApp(data, form.dataset.id || null);
    closeDlg(); render(); toast(t("toast.saved", { id: rec.id }));
  }

  function intDialog(id, appId) {
    const i = id ? S.raw.ints.find((x) => x.id === id) : { appId: appId || (S.apps()[0] || {}).id, type: "Video", date: U.addDays(U.today(), 2), time: "10:00", tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", duration: 60, place: "", interviewer: "", outcome: "Pending", notes: "" };
    if (!i.appId) return toast(t("toast.addAppFirst"));
    openDlg(`<h2>${id ? t("form.editInt") : t("form.newInt")}</h2><form class="form" data-form="int" data-id="${id || ""}" novalidate>
      <div class="full"><label for="f_appId">${t("form.application")}</label><select id="f_appId" name="appId">${appOptions(i.appId)}</select></div>
      <div><label for="f_type">${t("form.type")}</label><select id="f_type" name="type">${opt(L.interviewType.includes(i.type) ? L.interviewType : L.interviewType.concat(i.type), i.type)}</select></div>
      <div><label for="f_outcome">${t("form.outcome")}</label><select id="f_outcome" name="outcome">${optT(L.outcome, i.outcome, "out.")}</select></div>
      ${field("date", t("form.date") + " *", i.date, "date")}
      ${field("time", t("form.time"), i.time, "time")}
      ${field("tz", t("form.tz"), i.tz, "text", { attrs: 'list="tzlist" placeholder="America/Chicago"' })}
      ${field("duration", t("form.duration"), i.duration, "number", { attrs: 'min="0" step="5" inputmode="numeric"' })}
      ${field("place", t("form.place"), i.place, "text", { full: true })}
      ${field("interviewer", t("form.interviewer"), i.interviewer, "text", { full: true })}
      <div class="full"><label for="f_inotes">${t("form.notes")}</label><textarea id="f_inotes" name="notes">${esc(i.notes || "")}</textarea></div>
      <datalist id="tzlist">${["UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Dhaka", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"].map((z) => `<option value="${z}">`).join("")}</datalist>
      <div class="full actions">${id ? `<button type="button" class="btn danger sm left" data-act="delInt" data-id="${id}">${t("common.delete")}</button>` : ""}<button type="button" class="btn ghost" data-act="closeDlg">${t("common.cancel")}</button><button class="btn" type="submit">${t("common.save")}</button></div></form>`);
  }
  async function submitInt(form) {
    const fd = new FormData(form), g = (k) => String(fd.get(k) || "").trim();
    ["date", "time", "tz"].forEach((k) => setErr(k, ""));
    if (!U.isDate(g("date"))) { setErr("date", t("err.required")); return form.date.focus(); }
    if (g("time") && !U.isTime(g("time"))) { setErr("time", t("err.time")); return form.time.focus(); }
    if (g("tz") && !U.validTZ(g("tz"))) { setErr("tz", t("err.tz")); return form.tz.focus(); }
    const rec = await S.saveInt({ appId: g("appId"), type: g("type"), outcome: g("outcome"), date: g("date"), time: g("time"), tz: g("tz"), duration: g("duration") === "" ? "" : Number(g("duration")), place: g("place"), interviewer: g("interviewer"), notes: String(fd.get("notes") || "") }, form.dataset.id || null);
    closeDlg(); render(); toast(t("toast.saved", { id: rec.id }));
  }
  function fupDialog(id, appId) {
    const f = id ? S.raw.fups.find((x) => x.id === id) : { appId: appId || (S.apps()[0] || {}).id, due: U.addDays(U.today(), 1), type: "Email", done: false, notes: "" };
    if (!f.appId) return toast(t("toast.addAppFirst"));
    openDlg(`<h2>${id ? t("form.editFup") : t("form.newFup")}</h2><form class="form" data-form="fup" data-id="${id || ""}" novalidate>
      <div class="full"><label for="f_appId">${t("form.application")}</label><select id="f_appId" name="appId">${appOptions(f.appId)}</select></div>
      ${field("due", t("form.due") + " *", f.due, "date")}
      <div><label for="f_type">${t("form.type")}</label><select id="f_type" name="type">${opt(L.followType, f.type)}</select></div>
      ${field("notes", t("form.notes"), f.notes, "text", { full: true })}
      <div class="full"><label class="inline"><input type="checkbox" name="done" ${f.done ? "checked" : ""}>${t("fups.done")}</label></div>
      <div class="full actions">${id ? `<button type="button" class="btn danger sm left" data-act="delFup" data-id="${id}">${t("common.delete")}</button>` : ""}<button type="button" class="btn ghost" data-act="closeDlg">${t("common.cancel")}</button><button class="btn" type="submit">${t("common.save")}</button></div></form>`);
  }
  async function submitFup(form) {
    const fd = new FormData(form), g = (k) => String(fd.get(k) || "").trim();
    setErr("due", "");
    if (!U.isDate(g("due"))) { setErr("due", t("err.required")); return form.due.focus(); }
    const rec = await S.saveFup({ appId: g("appId"), due: g("due"), type: g("type"), notes: g("notes"), done: fd.get("done") === "on" }, form.dataset.id || null);
    closeDlg(); render(); toast(t("toast.saved", { id: rec.id }));
  }

  /* ---------- settings actions ---------- */
  async function saveSettingsForm(form) {
    const fd = new FormData(form), s = S.settings;
    const n = (k, d, lo, hi) => Math.min(hi, Math.max(lo, parseInt(fd.get(k), 10) || d));
    s.noRespDays = n("noRespDays", 7, 1, 60); s.weeklyGoal = n("weeklyGoal", 10, 1, 200); s.minSample = n("minSample", 5, 1, 50);
    s.backupDays = parseInt(fd.get("backupDays"), 10) || 0; s.theme = fd.get("theme");
    const lang = fd.get("lang");
    if (lang !== s.lang) { s.lang = lang; await I.setLang(lang); }
    applyTheme();
    await S.saveSettings(); render(); toast(t("toast.settingsSaved"));
  }
  function applyTheme() {
    const th = S.settings.theme || "auto";
    if (th === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", th);
  }
  function collectStatuses() {
    return $$("#stList .statusrow").map((r) => ({ key: r.dataset.key, name: $("[name=sname]", r).value, active: $("[name=sactive]", r).checked, awaiting: $("[name=sawait]", r).checked }));
  }
  async function saveStatuses() {
    const rows = collectStatuses();
    const names = rows.map((r) => r.name.trim());
    if (!names.length || names.some((n) => !n)) return toast(t("err.statusEmpty"));
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return toast(t("err.statusDup"));
    const removed = S.settings.statuses.filter((s) => !rows.some((r) => r.key === s.key));
    const inUse = removed.find((s) => S.statusUsage(s.name) > 0);
    if (inUse) return toast(t("err.statusInUse", { s: inUse.name, n: S.statusUsage(inUse.name) }));
    await S.saveStatuses(rows); render(); toast(t("toast.statusesSaved"));
  }

  /* ---------- backup, restore, import, export ---------- */
  async function doBackup() {
    const obj = S.exportAll();
    const ok = await U.saveFile(`job-tracker-backup-${U.today()}.json`, "application/json", JSON.stringify(obj, null, 1));
    if (ok) { S.settings.lastBackup = U.today(); await S.saveSettings(); render(); toast(t("bk.saved")); }
    return ok;
  }
  async function onRestoreFile(file) {
    let obj;
    try { obj = JSON.parse(await U.readFile(file)); } catch (e) { return toast(t("bk.errNotBackup")); }
    const v = S.validateBackup(obj);
    if (!v.ok) return toast(t(v.error === "tooNew" ? "bk.errTooNew" : "bk.errNotBackup"));
    pendingRestore = v.normalized;
    openDlg(`<h2>${t("bk.restoreTitle")}</h2><p>${t("bk.restoreText", v.counts)}</p><div class="notice">${t("bk.restoreWarn")}</div>
      <div class="actions"><button class="btn ghost" data-act="closeDlg">${t("common.cancel")}</button><button class="btn" data-act="doRestore">${t("bk.restoreGo")}</button></div>`);
  }
  async function onCsvFiles(files) {
    const loaded = [];
    for (const f of files) loaded.push({ name: f.name, text: await U.readFile(f) });
    pendingImport = CSV.plan(loaded);
    const p = pendingImport;
    const importable = p.files.reduce((n, f) => n + f.fresh.length, 0);
    const dupTotal = p.files.reduce((n, f) => n + f.dups.length, 0);
    const errs = p.files.flatMap((f) => f.errors.map((e) => ({ file: f.name, ...e }))).slice(0, 12);
    const unknown = p.unknown.length ? `<div class="notice bad">${t("csv.unknown", { names: esc(p.unknown.join(", ")) })}</div>` : "";
    openDlg(`<h2>${t("csv.title")}</h2>${unknown}
      <div class="table-wrap"><table class="t"><thead><tr><th>${t("csv.file")}</th><th>${t("csv.kind")}</th><th>${t("csv.rows")}</th><th>${t("csv.new")}</th><th>${t("csv.dups")}</th><th>${t("csv.errors")}</th></tr></thead><tbody>
      ${p.files.map((f) => `<tr><td>${esc(f.name)}</td><td>${t("csv.kind_" + f.kind)}</td><td>${f.total}</td><td>${f.fresh.length}</td><td>${f.dups.length}</td><td>${f.errors.length}</td></tr>`).join("")}</tbody></table></div>
      ${dupTotal ? `<label class="inline" style="margin-top:8px"><input type="checkbox" id="incDup">${t("csv.includeDups", { n: dupTotal })}</label><p class="muted small" style="margin:0">${t("csv.dupNote")}</p>` : ""}
      ${errs.length ? `<h3 class="sub">${t("csv.errorList")}</h3><div class="table-wrap"><table class="t"><tbody>${errs.map((e) => `<tr><td>${esc(e.file)}</td><td>${t("csv.row", { n: e.line })}</td><td>${esc(t(e.key, e.vars))}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <p class="muted small">${t("csv.neverOverwrite")}</p>
      <div class="actions">${p.files.some((f) => f.errors.length) ? `<button class="btn ghost sm left" data-act="errReport">${t("csv.downloadErrors")}</button>` : ""}<button class="btn ghost" data-act="closeDlg">${t("common.cancel")}</button><button class="btn" data-act="doImport" ${importable || dupTotal ? "" : "disabled"}>${t("csv.import")}</button></div>`);
  }
  async function exportCsv(kinds) {
    for (const k of kinds) {
      const x = CSV.exportKind(k);
      await U.saveFile(x.name, "text/csv", x.text);
    }
    toast(t("toast.exported"));
  }

  /* ---------- trash ---------- */
  function trashDialog() {
    const tr = S.trashed();
    const row = (kind, r, label) => `<div class="row" style="margin-bottom:8px"><span><b>${esc(r.id)}</b> ${esc(label)}</span><span><button class="btn ghost sm" data-act="restoreRec" data-kind="${kind}" data-id="${r.id}">${t("common.restore")}</button> <button class="btn ghost sm" data-act="purgeRec" data-kind="${kind}" data-id="${r.id}">${t("trash.forever")}</button></span></div>`;
    const rows = tr.apps.map((a) => row("app", a, S.label(a))).concat(tr.ints.map((i) => row("int", i, `${i.type} · ${I.fmtDate(i.date)}`)), tr.fups.map((f) => row("fup", f, `${f.type} · ${I.fmtDate(f.due)}`))).join("");
    openDlg(`<h2>${t("trash.title")}</h2>${rows || `<p class="muted">${t("trash.empty")}</p>`}<div class="actions">${rows ? `<button class="btn danger sm left" data-act="emptyTrash">${t("trash.emptyAll")}</button>` : ""}<button class="btn ghost" data-act="closeDlg">${t("common.close")}</button></div>`);
  }
  function wipeDialog() {
    openDlg(`<h2>${t("wipe.title")}</h2><p>${t("wipe.text")}</p>
      <div class="row" style="justify-content:flex-start"><button class="btn" data-act="backup">${t("wipe.backupFirst")}</button></div>
      <label class="inline" style="margin-top:10px"><input type="checkbox" id="wipeOk">${t("wipe.confirm")}</label>
      <div class="actions"><button class="btn ghost" data-act="closeDlg">${t("common.cancel")}</button><button class="btn danger" id="wipeGo" data-act="wipeGo" disabled>${t("wipe.go")}</button></div>`);
  }
  function iosHelp() {
    openDlg(`<h2>${t("inst.stepsTitle")}</h2><p>${t("inst.iosText")}</p><ol><li>${t("inst.step1")}</li><li>${t("inst.step2")}</li><li>${t("inst.step3")}</li></ol><p class="muted small">${t("inst.androidNote")}</p>
      <div class="actions"><button class="btn" data-act="closeDlg">${t("common.close")}</button></div>`);
  }

  /* ---------- event handling ---------- */
  const ACTIONS = {
    go: (e) => go(e.dataset.r),
    closeDlg: closeDlg,
    undo: async () => { if (undoFn) { const f = undoFn; undoFn = null; await f(); $("#toast").innerHTML = ""; render(); } },
    newApp: () => appDialog(), editApp: (e) => appDialog(e.dataset.id),
    newInt: () => intDialog(), editInt: (e) => intDialog(e.dataset.id), newIntFor: (e) => intDialog(null, e.dataset.id),
    newFup: () => fupDialog(), editFup: (e) => fupDialog(e.dataset.id), newFupFor: (e) => fupDialog(null, e.dataset.id),
    delApp: async (e) => { const id = e.dataset.id; await S.setDeleted("app", id, true); closeDlg(); render(); toast(t("toast.deleted"), async () => S.setDeleted("app", id, false)); },
    delInt: async (e) => { const id = e.dataset.id; await S.setDeleted("int", id, true); closeDlg(); render(); toast(t("toast.deleted"), async () => S.setDeleted("int", id, false)); },
    delFup: async (e) => { const id = e.dataset.id; await S.setDeleted("fup", id, true); closeDlg(); render(); toast(t("toast.deleted"), async () => S.setDeleted("fup", id, false)); },
    doneFup: async (e) => { await S.saveFup({ done: true }, e.dataset.id); render(); toast(t("toast.markedDone")); },
    intTab: (e) => { filters.intTab = e.dataset.k; render(); }, fupTab: (e) => { filters.fupTab = e.dataset.k; render(); },
    stageFilter: (e) => { filters.reached = e.dataset.k; filters.status = ""; go("applications"); },
    clearStage: () => { filters.reached = ""; render(); },
    stAdd: () => { $("#stList").insertAdjacentHTML("beforeend", statusRows([{ key: "", name: "", active: true, awaiting: false }])); $$("#stList [name=sname]").pop().focus(); },
    stRemove: (e) => e.closest(".statusrow").remove(),
    stUp: (e) => { const r = e.closest(".statusrow"); if (r.previousElementSibling) r.parentNode.insertBefore(r, r.previousElementSibling); },
    stDown: (e) => { const r = e.closest(".statusrow"); if (r.nextElementSibling) r.parentNode.insertBefore(r.nextElementSibling, r); },
    stSave: saveStatuses,
    backup: doBackup,
    pickRestore: () => $("#fileRestore").click(), pickCsv: () => $("#fileCsv").click(),
    doRestore: async () => { if (!pendingRestore) return; await S.restore(pendingRestore); pendingRestore = null; await I.setLang(S.settings.lang); applyTheme(); closeDlg(); render(); toast(t("bk.restored")); },
    doImport: async () => {
      const inc = $("#incDup") && $("#incDup").checked;
      const c = await CSV.apply(pendingImport, inc);
      const hadErrors = pendingImport.files.some((f) => f.errors.length);
      closeDlg(); render();
      toast(t("csv.done", { a: c.applications, i: c.interviews, f: c.followups }) + (c.skipped ? " " + t("csv.skipped", { n: c.skipped }) : "") + (hadErrors ? " " + t("csv.someErrors") : ""));
    },
    errReport: () => U.saveFile("import-errors.csv", "text/csv", CSV.errorReport(pendingImport)),
    csvExport: (e) => exportCsv([e.dataset.k]),
    csvTemplates: async () => { for (const k of Object.keys(CSV.HEADERS)) await U.saveFile("template-" + CSV.FILENAMES[k], "text/csv", CSV.template(k)); toast(t("toast.exported")); },
    icsAll: async () => { const x = ICS.build(true, true); if (!x.count) return toast(t("ics.none")); await U.saveFile("job-search-calendar.ics", "text/calendar", x.text); toast(t("toast.exported")); },
    trash: trashDialog,
    restoreRec: async (e) => { await S.setDeleted(e.dataset.kind, e.dataset.id, false); trashDialog(); render(); },
    purgeRec: async (e) => { await S.purge(e.dataset.kind, e.dataset.id); trashDialog(); render(); },
    emptyTrash: async () => { await S.emptyTrash(); trashDialog(); render(); },
    wipe: wipeDialog,
    wipeGo: async () => { await S.wipe(true); closeDlg(); go("dashboard"); render(); toast(t("wipe.done")); },
    loadSample: async () => { await S.loadSample(); render(); toast(t("sample.loaded")); },
    clearSample: async () => { await S.wipe(true); S.settings.sample = false; await S.saveSettings(); render(); toast(t("sample.cleared")); },
    dismissInstall: async () => { S.settings.installDismissedUntil = U.addDays(U.today(), 7); await S.saveSettings(); render(); },
    iosHelp: iosHelp,
    install: async () => { if (!deferredInstall) return iosHelp(); deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; render(); },
    askPersist: async () => { await askPersist(true); render(); },
    applyUpdate: () => { userWantsUpdate = true; if (updateWorker) updateWorker.postMessage("SKIP_WAITING"); },
  };
  document.addEventListener("click", (ev) => {
    const e = ev.target.closest("[data-act]");
    if (!e) return;
    const fn = ACTIONS[e.dataset.act];
    if (fn) { ev.preventDefault(); fn(e, ev); }
  });
  document.addEventListener("submit", (ev) => {
    const f = ev.target.closest("form[data-form]");
    if (!f) return;
    ev.preventDefault();
    const kind = f.dataset.form;
    if (kind === "app") submitApp(f); else if (kind === "int") submitInt(f); else if (kind === "fup") submitFup(f); else if (kind === "settings") saveSettingsForm(f);
  });
  document.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.id === "q") { filters.q = el.value; $("#applist").innerHTML = appRows(); }
    else if (el.closest("form[data-form=app]") && (el.name === "company" || el.name === "title")) checkDup();
    else if (el.id === "wipeOk") $("#wipeGo").disabled = !el.checked;
  });
  document.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.id === "fs") { filters.status = el.value; filters.reached = ""; render(); }
    else if (el.id === "fo") { filters.sort = el.value; render(); }
    else if (el.id === "arch") { filters.archived = el.checked; render(); }
    else if (el.id === "wipeOk") $("#wipeGo").disabled = !el.checked;
    else if (el.id === "fileRestore" && el.files[0]) { onRestoreFile(el.files[0]); el.value = ""; }
    else if (el.id === "fileCsv" && el.files.length) { onCsvFiles(Array.from(el.files)); el.value = ""; }
  });
  $("#dlg").addEventListener("close", () => { $("#dlg").innerHTML = ""; if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus(); });
  $("#dlg").addEventListener("click", (ev) => { if (ev.target === $("#dlg")) closeDlg(); });
  window.addEventListener("hashchange", onHash);
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; render(); });
  window.addEventListener("appinstalled", () => { deferredInstall = null; render(); });

  /* ---------- storage persistence and service worker ---------- */
  async function askPersist(force) {
    try {
      if (navigator.storage && navigator.storage.persisted) {
        let p = await navigator.storage.persisted();
        if (!p && navigator.storage.persist && (force || S.settings.persisted == null)) p = await navigator.storage.persist();
        S.settings.persisted = !!p;
        await S.saveSettings();
      }
    } catch (e) { /* storage API unavailable */ }
  }
  function setupSW() {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const show = (w) => { updateWorker = w; render(); };
      if (reg.waiting && navigator.serviceWorker.controller) show(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (nw) nw.addEventListener("statechange", () => { if (nw.state === "installed" && navigator.serviceWorker.controller) show(nw); });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (userWantsUpdate) location.reload(); });
  }

  /* ---------- boot ---------- */
  async function boot() {
    await DB.init();
    await S.load();
    await I.setLang(S.settings.lang || "en");
    applyTheme();
    document.title = t("app.name");
    const hadData = S.raw.apps.length > 0 || S.settings.lastBackup;
    onHash();
    askPersist(false).then(() => { if (route === "settings") render(); });
    setupSW();
    window.JT_READY = true;
  }
  boot();
})();
