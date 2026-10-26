// A minimal Luxon-compatible DateTime subset — just the surface the
// ported n8n Code nodes use: now()/fromISO() in a fixed IANA zone,
// toISODate(), plus({days|years}), startOf('day'), diff(..., 'days'),
// and toFormat() for the token patterns 'cccc', 'LLLL', 'LLL', 'yyyy',
// 'd' and 'h:mm a' (with 'quoted' literals). Implemented on Intl so no
// new dependency is added to the portal.
const DEFAULT_ZONE = "America/Edmonton";

function partsInZone(epochMs, zone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    weekday: "long", monthLong: undefined,
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date(epochMs))) parts[p.type] = p.value;
  return parts;
}

function zoneOffsetMs(epochMs, zone) {
  const p = partsInZone(epochMs, zone);
  const hour = p.hour === "24" ? 0 : Number(p.hour);
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return asUTC - Math.floor(epochMs / 1000) * 1000;
}

function zonedMidnightEpoch(y, m, d, zone) {
  // Epoch of local midnight on y-m-d in zone (two-pass offset settle).
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  const first = utcMidnight - zoneOffsetMs(utcMidnight, zone);
  return utcMidnight - zoneOffsetMs(first, zone);
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

class ZonedDateTime {
  constructor(epochMs, zone) {
    this._ms = epochMs;
    this.zone = zone || DEFAULT_ZONE;
  }
  static now() { return new ZonedDateTime(Date.now(), DEFAULT_ZONE); }
  static fromISO(iso, opts) {
    if (!iso) return new ZonedDateTime(NaN, (opts && opts.zone) || DEFAULT_ZONE);
    // Airtable dates may be date-only ('2026-10-27'); Luxon fromISO in a
    // zone treats them as local midnight of that date.
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, d] = iso.split("-").map(Number);
      const zone = (opts && opts.zone) || DEFAULT_ZONE;
      return new ZonedDateTime(zonedMidnightEpoch(y, m, d, zone), zone);
    }
    return new ZonedDateTime(Date.parse(iso), (opts && opts.zone) || DEFAULT_ZONE);
  }
  setZone(zone) { return new ZonedDateTime(this._ms, zone || this.zone); }
  _parts() {
    const p = partsInZone(this._ms, this.zone);
    return {
      year: Number(p.year), month: Number(p.month), day: Number(p.day),
      hour: p.hour === "24" ? 0 : Number(p.hour), minute: Number(p.minute),
      weekday: new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day))).getUTCDay(),
    };
  }
  toISODate() {
    if (Number.isNaN(this._ms)) return null;
    const p = this._parts();
    const mm = String(p.month).padStart(2, "0");
    const dd = String(p.day).padStart(2, "0");
    return `${p.year}-${mm}-${dd}`;
  }
  toISO() { return Number.isNaN(this._ms) ? null : new Date(this._ms).toISOString(); }
  plus(amount) {
    let ms = this._ms;
    if (amount.days) ms += amount.days * 86400000;
    if (amount.years) {
      const p = this._parts();
      ms = zonedMidnightEpoch(p.year + amount.years, p.month, p.day, this.zone) + (ms - zonedMidnightEpoch(p.year, p.month, p.day, this.zone));
    }
    return new ZonedDateTime(ms, this.zone);
  }
  startOf(unit) {
    if (unit !== "day") throw new Error("startOf only supports 'day'");
    const p = this._parts();
    return new ZonedDateTime(zonedMidnightEpoch(p.year, p.month, p.day, this.zone), this.zone);
  }
  diff(other, unit) {
    if (unit !== "days") throw new Error("diff only supports 'days'");
    return { days: (this._ms - other._ms) / 86400000 };
  }
  toFormat(pattern) {
    if (Number.isNaN(this._ms)) return "";
    const p = this._parts();
    const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
    const ampm = p.hour < 12 ? "AM" : "PM";
    const timeStr = `${hour12}:${String(p.minute).padStart(2, "0")} ${ampm}`;
    // Split out quoted literals first.
    const segments = String(pattern).split("'");
    return segments.map((seg, i) => {
      if (i % 2 === 1) return seg; // literal
      return seg
        .replace(/cccc/g, WEEKDAYS[p.weekday])
        .replace(/LLLL/g, MONTHS_LONG[p.month - 1])
        .replace(/LLL/g, MONTHS_SHORT[p.month - 1])
        .replace(/yyyy/g, String(p.year))
        .replace(/h:mm a/g, timeStr)
        .replace(/\bd\b/g, String(p.day));
    }).join("");
  }
}

module.exports = { DateTime: ZonedDateTime };
