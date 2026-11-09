/* Calendar (.ics) export. Interviews get alarms 1 day and 1 hour before. Follow-ups are all-day events with an alarm at 9:00. */
(function () {
  const JT = (window.JT = window.JT || {});
  const U = JT.util;

  const esc = (s) => String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  function fold(line) {
    const out = [];
    while (line.length > 74) { out.push(line.slice(0, 74)); line = " " + line.slice(74); }
    out.push(line);
    return out.join("\r\n");
  }
  const ymd = (s) => s.replace(/-/g, "");
  function stampUTC() {
    const d = new Date();
    return `${d.getUTCFullYear()}${U.pad(d.getUTCMonth() + 1)}${U.pad(d.getUTCDate())}T${U.pad(d.getUTCHours())}${U.pad(d.getUTCMinutes())}${U.pad(d.getUTCSeconds())}Z`;
  }
  function addMinutes(date, time, mins) {
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d, hh, mm + mins));
    return `${dt.getUTCFullYear()}${U.pad(dt.getUTCMonth() + 1)}${U.pad(dt.getUTCDate())}T${U.pad(dt.getUTCHours())}${U.pad(dt.getUTCMinutes())}00`;
  }

  function build(includeInterviews, includeFollowups) {
    const S = JT.store;
    const stamp = stampUTC();
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Job Application Tracker//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    let n = 0;
    if (includeInterviews) {
      S.ints().filter((i) => i.outcome !== "Cancelled" && i.date).forEach((i) => {
        const a = S.appById(i.appId);
        const who = a ? `${a.company}, ${a.title}` : i.appId;
        lines.push("BEGIN:VEVENT", `UID:${i.id}@job-application-tracker`, `DTSTAMP:${stamp}`);
        if (i.time) {
          const tz = U.validTZ(i.tz) ? `;TZID=${i.tz}` : "";
          lines.push(`DTSTART${tz}:${ymd(i.date)}T${i.time.replace(":", "")}00`, `DTEND${tz}:${addMinutes(i.date, i.time, Number(i.duration) || 60)}`);
        } else {
          lines.push(`DTSTART;VALUE=DATE:${ymd(i.date)}`, `DTEND;VALUE=DATE:${ymd(U.addDays(i.date, 1))}`);
        }
        lines.push(`SUMMARY:${esc(`${i.type} interview: ${who}`)}`);
        if (i.place) lines.push(`LOCATION:${esc(i.place)}`);
        lines.push(`DESCRIPTION:${esc(`Application ${i.appId}${i.interviewer ? `\nInterviewer: ${i.interviewer}` : ""}${i.notes ? `\n${i.notes}` : ""}`)}`);
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Interview tomorrow", "TRIGGER:-P1D", "END:VALARM");
        if (i.time) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Interview in 1 hour", "TRIGGER:-PT1H", "END:VALARM");
        lines.push("END:VEVENT");
        n++;
      });
    }
    if (includeFollowups) {
      S.fups().filter((f) => !f.done && f.due).forEach((f) => {
        const a = S.appById(f.appId);
        lines.push(
          "BEGIN:VEVENT", `UID:${f.id}@job-application-tracker`, `DTSTAMP:${stamp}`,
          `DTSTART;VALUE=DATE:${ymd(f.due)}`, `DTEND;VALUE=DATE:${ymd(U.addDays(f.due, 1))}`,
          `SUMMARY:${esc(`Follow up (${f.type}): ${a ? a.company + ", " + a.title : f.appId}`)}`,
          `DESCRIPTION:${esc(`${f.appId}${f.notes ? "\n" + f.notes : ""}`)}`,
          "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Follow-up due today", "TRIGGER:PT9H", "END:VALARM", "END:VEVENT"
        );
        n++;
      });
    }
    lines.push("END:VCALENDAR");
    return { text: lines.map(fold).join("\r\n") + "\r\n", count: n };
  }

  JT.ics = { build };
})();
