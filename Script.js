

"use strict";
/* AutoDebit Finder : script.js
   Part 1: Supabase authentication.  Part 2: recurring payment analysis.
   Only the PUBLISHABLE (anon) key belongs here. Never use a service_role / secret key. */

const SUPABASE_URL = "https://trtyjoabgvwqnaoygxws.supabase.co";

const SUPABASE_KEY = "sb_publishable_DcRtNbSVgsoAMn5PD0LnAw_ynhPT0fT";

const $ = (id) => document.getElementById(id);
const h = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const fd = (d) => d ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Not estimable";
const DAY = 864e5;
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");

let sb = null, user = null, mode = "login", ready = false;
let recovery = /type=recovery/.test(location.hash);
let recs = [], ref = null, flags = {};

/* ============================================================
   PART 1: AUTHENTICATION
============================================================ */
const MODES = {
  login:  { sub: "Log in to see your recurring payments.", go: "Log in", sw: "Create an account", f: ["mail", "pass"], forgot: true },
  signup: { sub: "Create an account. We will email you a verification link.", go: "Create account", sw: "I already have an account", f: ["name", "mail", "pass", "conf"] },
  forgot: { sub: "We will email you a link to reset your password.", go: "Send reset link", sw: "Back to log in", f: ["mail"] },
  reset:  { sub: "Choose a new password.", go: "Update password", sw: "", f: ["pass", "conf"] }
};

function msg(t, ok) {
  const e = $("aMsg");
  e.textContent = t || "";
  e.className = "msg" + (ok ? " ok" : "");
  e.hidden = !t;
}

function setMode(m) {
  mode = m;
  const c = MODES[m];
  $("aSub").textContent = c.sub;
  $("aGo").textContent = c.go;
  $("aSwitch").textContent = c.sw;
  $("aSwitch").hidden = !c.sw;
  $("aForgot").hidden = !c.forgot;
  ["name", "mail", "pass", "conf"].forEach((k) => { $(k + "W").hidden = !c.f.includes(k); });
  $("aPass").autocomplete = m === "login" ? "current-password" : "new-password";
  ["aPass", "aConf"].forEach((id) => { $(id).value = ""; $(id).type = "password"; });
  $("aShow").textContent = "Show";
  msg("");
}

function pwProblem(p) {
  if (p.length < 8) return "Use at least 8 characters.";
  if (p.length > 72) return "That password is too long.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Include at least one letter and one number.";
  return "";
}

function errText(e) {
  const c = (e && e.code) || "", t = ((e && e.message) || "").toLowerCase();
  if (c === "invalid_credentials" || t.includes("invalid login")) return "Email or password is incorrect.";
  if (c === "email_not_confirmed" || t.includes("not confirmed")) return "Please verify your email first. Check your inbox and spam folder.";
  if (c.startsWith("over_") || (e && e.status === 429)) return "Too many attempts. Please wait a few minutes.";
  if (c === "same_password") return "Choose a password different from your old one.";
  if (c === "weak_password") return "That password is too weak.";
  if (c === "email_address_not_authorized") return "The email service can only send to approved addresses. The site owner must set up custom SMTP.";
  if (t.includes("fetch") || t.includes("network")) return "Network problem. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}

function showAuth(m) {
  user = null; recs = [];
  $("boot").hidden = true;
  $("app").hidden = true;
  $("results").hidden = true;
  $("upMsg").hidden = true;
  $("auth").hidden = false;
  setMode(m);
}

function showApp(u) {
  if (user && user.id === u.id) return;
  user = u;
  try { flags = JSON.parse(localStorage.getItem("adf." + u.id) || "{}"); } catch (e) { flags = {}; }
  $("who").textContent = (u.user_metadata && u.user_metadata.full_name) || u.email;
  $("boot").hidden = true;
  $("auth").hidden = true;
  $("app").hidden = false;
  window.scrollTo(0, 0);
}

function route(s) {
  const first = !ready;
  ready = true;
  if (recovery) { if (mode !== "reset" || user || first) showAuth("reset"); return; }
  if (s && s.user) showApp(s.user);
  else if (user || first) showAuth("login");
}

$("af").addEventListener("submit", async (e) => {
  e.preventDefault();
  msg("");
  const name = $("aName").value.trim().replace(/\s+/g, " ");
  const mail = $("aMail").value.trim().toLowerCase();
  const pw = $("aPass").value, cf = $("aConf").value;
  const f = MODES[mode].f;
  let bad = "";
  if (f.includes("name") && (name.length < 2 || name.length > 60)) bad = "Enter your full name (2 to 60 characters).";
  else if (f.includes("mail") && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) bad = "Enter a valid email address.";
  else if (mode === "login" && !pw) bad = "Enter your password.";
  else if (f.includes("pass") && mode !== "login" && pwProblem(pw)) bad = pwProblem(pw);
  else if (f.includes("conf") && pw !== cf) bad = "The two passwords do not match.";
  if (bad) return msg(bad);

  const b = $("aGo");
  b.disabled = true;
  b.textContent = "Please wait…";
  try {
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email: mail, password: pw });
      if (error) return msg(errText(error));
    } else if (mode === "signup") {
      const { data, error } = await sb.auth.signUp({ email: mail, password: pw, options: { data: { full_name: name }, emailRedirectTo: REDIRECT } });
      if (error) return msg(errText(error));
      if (!data.session) { setMode("login"); msg("Almost done. If this email can be registered, we sent a verification link. Open it, then log in.", true); }
    } else if (mode === "forgot") {
      const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: REDIRECT });
      if (error && /^over_/.test(error.code || "")) return msg(errText(error));
      msg("If an account exists for that email, we sent a reset link. Check your inbox and spam folder.", true);
    } else {
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) return msg(errText(error));
      recovery = false;
      const { data } = await sb.auth.getSession();
      route(data.session);
    }
  } catch (x) {
    msg(errText(x));
  } finally {
    b.disabled = false;
    b.textContent = MODES[mode].go;
  }
});

$("aShow").onclick = () => {
  const show = $("aPass").type === "password";
  $("aPass").type = $("aConf").type = show ? "text" : "password";
  $("aShow").textContent = show ? "Hide" : "Show";
};
$("aSwitch").onclick = () => setMode(mode === "login" ? "signup" : "login");
$("aForgot").onclick = () => setMode("forgot");
$("logout").onclick = async () => {
  try { await sb.auth.signOut(); } catch (e) { /* local session is removed anyway */ }
  route(null);
  msg("You have been logged out.", true);
};

async function boot() {
  let problem = "";
  if (location.protocol === "file:") problem = "Open this page with VS Code Live Server or from a website. Sign-in does not work from a file:// address.";
  else if (!window.supabase || !window.supabase.createClient) problem = "The Supabase library did not load. Check your internet connection and reload.";
  else if (/YOUR-/.test(SUPABASE_URL + SUPABASE_KEY)) problem = "Supabase is not set up yet. Add your project URL and publishable key at the top of script.js.";
  if (problem) {
    showAuth("login");
    msg(problem);
    $("aGo").disabled = true;
    return;
  }
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  // Do not call other Supabase methods inside this callback; defer with setTimeout.
  sb.auth.onAuthStateChange((ev, s) => {
    if (ev === "PASSWORD_RECOVERY") { recovery = true; setTimeout(() => route(s), 0); }
    else if (["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(ev)) setTimeout(() => route(s), 0);
  });
  let session = null;
  try {
    session = (await sb.auth.getSession()).data.session;
    if (session) {
      // Ask the server to confirm the session is real, not just present in storage.
      const r = await sb.auth.getUser();
      if (r.error || !r.data.user) {
        if (r.error && [401, 403, 404].includes(r.error.status)) await sb.auth.signOut({ scope: "local" });
        session = null;
      }
    }
  } catch (x) { session = null; }
  route(session);
}

/* ============================================================
   PART 2: RECURRING PAYMENT ANALYSIS (runs in the browser)
============================================================ */

// Manually curated merchant reference. Unknown text stays "Unknown merchant" (never guessed).
const MERCH = [
  [/netflix/i, "Netflix", "Entertainment", "https://www.netflix.com/account"],
  [/spotify/i, "Spotify", "Music", "https://www.spotify.com/account/"],
  [/amzn\s*prime|amazon\s*prime|primevideo/i, "Amazon Prime", "Shopping and video", "https://www.amazon.in/gp/primecentral"],
  [/hotstar/i, "Disney+ Hotstar", "Entertainment", ""],
  [/youtube|ytpremium/i, "YouTube Premium", "Entertainment", "https://www.youtube.com/paid_memberships"],
  [/gym|fitness/i, "Gym Membership", "Health and fitness", ""],
  [/insur|\blic\b|premium/i, "Insurance Premium", "Insurance", ""],
  [/icloud|apple\.com/i, "Apple iCloud", "Cloud storage", ""],
  [/google\s*one/i, "Google One", "Cloud storage", ""],
  [/adobe/i, "Adobe Creative Cloud", "Software", ""],
  [/coursehub/i, "CourseHub", "Education", ""],
  [/newsdaily/i, "News Daily", "News", ""]
];
const match = (d) => {
  for (const [re, name, cat, url] of MERCH) if (re.test(d)) return { known: true, name, cat, url };
  return { known: false, name: "Unknown merchant", cat: "Uncategorised", url: "" };
};

const BANDS = [
  { n: "Weekly", d: 7, lo: 5, hi: 9, y: 52 },
  { n: "Monthly", d: 30, lo: 26, hi: 35, y: 12 },
  { n: "Quarterly", d: 91, lo: 84, hi: 98, y: 4 },
  { n: "Annual", d: 365, lo: 350, hi: 380, y: 1 }
];
const med = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

function mech(t) {
  t = String(t).toUpperCase();
  if (/PLAY\s*STORE|GOOGLE\s*PLAY/.test(t)) return "Play Store";
  if (/APP\s*STORE|ITUNES|APPLE\.COM/.test(t)) return "App Store";
  if (/AUTOPAY|UPI/.test(t)) return "UPI AutoPay";
  if (/NACH|MANDATE|ECS/.test(t)) return "Bank e-mandate";
  if (/CARD|VISA|MASTERCARD|RUPAY/.test(t)) return "Card recurring";
  return "Merchant-managed";
}

function analyse(rows) {
  const g = {};
  rows.forEach((r) => {
    r.m = match(r.desc);
    const k = r.m.known ? r.m.name : "?" + r.desc.toUpperCase().replace(/[\d*#_\/-]+/g, " ").replace(/\s+/g, " ").trim();
    (g[k] = g[k] || []).push(r);
  });
  ref = new Date(Math.max(...rows.map((r) => r.d)));
  const out = [];
  for (const k in g) {
    const tx = g[k].sort((a, b) => a.d - b.d);
    if (tx.length < 2) continue;
    const iv = tx.slice(1).map((t, i) => (t.d - tx[i].d) / DAY);
    let b = BANDS.find((x) => med(iv) >= x.lo && med(iv) <= x.hi);
    if (b && iv.filter((v) => v >= b.lo && v <= b.hi).length / iv.length < 0.6) b = null;
    const am = tx.map((t) => t.amt);
    if (!b && !(tx.length >= 3 && Math.max(...am) - Math.min(...am) <= 0.25 * med(am))) continue;

    const trial = am[0] <= 10 && am[1] >= am[0] * 5;
    const ev = [];
    if (b) for (let i = trial ? 2 : 1; i < tx.length; i++) {
      const p = tx[i - 1].amt, c = tx[i].amt;
      if (c > p * 1.01) ev.push({ d: tx[i].d, from: p, to: c, pct: (c - p) / p * 100 });
    }
    let resumed = null;
    if (b) iv.forEach((v, i) => { if (v > b.d * 1.8) resumed = { d: tx[i + 1].d, gap: Math.round(v) }; });

    const last = tx[tx.length - 1], cur = last.amt;
    const next = b ? new Date(last.d.getTime() + b.d * DAY) : null;
    const late = !!b && (ref - last.d) / DAY > b.d * 1.6;
    const yr = tx.filter((t) => (ref - t.d) / DAY <= 365).reduce((s, t) => s + t.amt, 0);
    const why = [];
    if (b && b.n === "Annual") why.push("Annual charges are easy to forget");
    if (b && b.y >= 12 && cur <= 200) why.push("Small amount that is easy to overlook");
    if (!b) why.push("Irregular timing");
    if (!tx[0].m.known) why.push("Merchant not recognised");

    out.push({
      key: k, name: tx[0].m.name, cat: tx[0].m.cat, url: tx[0].m.url,
      raw: [...new Set(tx.map((t) => t.desc))], tx, freq: b ? b.n : "Irregular", days: b && b.d,
      mech: mech(last.mode || last.desc), cur, last: last.d, next, late,
      annual: b ? cur * b.y : yr, ev, trial, resumed, why
    });
  }
  return out;
}

/* ---------- CSV reading ---------- */

/* ---------- Robust CSV parser and validation ---------- */

function parseDate(value) {
  const s = String(value || "").trim();

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);

  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (
      d.getUTCFullYear() === +m[1] &&
      d.getUTCMonth() === +m[2] - 1 &&
      d.getUTCDate() === +m[3]
    ) return d;
    return null;
  }

  // Indian date format: DD/MM/YYYY
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);

  if (m) {
    const day = +m[1], month = +m[2], year = +m[3];
    const d = new Date(Date.UTC(year, month - 1, day));

    if (
      d.getUTCFullYear() === year &&
      d.getUTCMonth() === month - 1 &&
      d.getUTCDate() === day
    ) return d;
  }

  return null;
}


// Handles quoted commas, escaped quotes and multiline cells.
function parseCSV(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const firstLine = input.split(/\r?\n/)[0] || "";

  function countDelimiter(line, delimiter) {
    let quoted = false;
    let count = 0;

    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (line[i] === delimiter && !quoted) {
        count++;
      }
    }

    return count;
  }

  const delimiter = [",", ";", "\t"]
    .sort((a, b) =>
      countDelimiter(firstLine, b) - countDelimiter(firstLine, a)
    )[0];

  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i++;

      row.push(cell.trim());

      if (row.some(v => v !== "")) rows.push(row);

      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  if (quoted) {
    throw new Error("CSV has an unclosed quotation mark. Please check the file.");
  }

  row.push(cell.trim());
  if (row.some(v => v !== "")) rows.push(row);

  return rows;
}


function toRows(text) {
  const cells = parseCSV(text);

  if (cells.length < 2) {
    throw new Error("CSV file mein header ke baad koi transaction data nahi hai.");
  }

  const hd = cells[0].map(x =>
    x.toLowerCase().replace(/^\uFEFF/, "").trim().replace(/[\s_-]+/g, "")
  );

  const find = re => hd.findIndex(x => re.test(x));

  const di = find(/^(date|transactiondate|txndate|valuedate)$/);

  const si = find(/description|narration|particular|details|merchant|remarks/);

  let ai = find(/^(debit|withdrawal|withdrawals)$/);
  if (ai < 0) ai = find(/^(amount|transactionamount|txnamount)$/);

  const ci = find(/^(credit|deposit|deposits)$/);
  const ti = find(/^(type|transactiontype|drcr)$/);
  const mi = find(/mode|mechanism|channel|paymentmethod/);

  if (di < 0 || si < 0 || (ai < 0 && ci < 0)) {
    throw new Error(
      "Required columns missing. CSV must contain date, description and amount/debit columns."
    );
  }

  const rows = [];
  let skipped = 0;
  let total = 0;

  for (const c of cells.slice(1)) {
    if (!c.some(v => String(v).trim())) continue;

    total++;

    const date = parseDate(c[di]);
    const description = String(c[si] || "").trim();

    const type = ti >= 0
      ? String(c[ti] || "").trim().toLowerCase()
      : "";

    // Do not count credits, refunds or deposits as spending.
    if (/credit|deposit|refund|cr\b/.test(type)) {
      skipped++;
      continue;
    }

    let rawAmount = ai >= 0 ? c[ai] : "";

    // If debit column is blank, do not mistake a credit for spending.
    if (!String(rawAmount || "").trim() && ci >= 0) {
      skipped++;
      continue;
    }

    const amountText = String(rawAmount || "")
      .replace(/[₹,\s]/g, "")
      .replace(/^Rs\.?/i, "")
      .replace(/[()]/g, "");

    const amount = Number(amountText);

    if (
      !date ||
      !description ||
      !Number.isFinite(amount) ||
      amount === 0
    ) {
      skipped++;
      continue;
    }

    rows.push({
      d: date,
      desc: description,
      amt: Math.abs(amount),
      mode: mi >= 0 ? String(c[mi] || "").trim() : ""
    });
  }

  if (rows.length === 0) {
    throw new Error(
      total === 0
        ? "CSV mein transaction data nahi mila. File empty hai."
        : "Koi valid transaction nahi mila. Date, description aur amount check karo. " +
          skipped + " rows reject hui."
    );
  }

  return { rows, skipped, total };
}
   

/* ---------- Synthetic sample statement (fictional) ---------- */
function sample() {
  const L = ["date,description,amount,mode"];
  const add = (d, s, a, m) => L.push([d, s, a, m].join(","));
  const p = (n) => String(n).padStart(2, "0");
  for (let i = 0; i < 25; i++) {
    const y = 2024 + Math.floor((9 + i) / 12), m = (9 + i) % 12 + 1, ym = y * 12 + m, D = (day) => y + "-" + p(m) + "-" + p(day);
    add(D(5), "NETFLIX.COM*PAY", ym >= 2026 * 12 + 4 ? 649 : 499, "Card");
    add(D(12), "SPOTIFY P", 119, "UPI AutoPay");
    if (!(y === 2025 && m >= 6 && m <= 8)) add(D(1), "GYM_MEMBERSHIP_01", 1200, "Bank e-mandate");
    add(D(22), "GOOGLE ONE", 130, "Play Store");
    if (ym >= 2026 * 12 + 3) add(D(9), "XYZ SVC 8841", 249, "Card");
    if (ym >= 2026 * 12 + 6) add(D(2), "COURSEHUB*SUB", 299, "Play Store");
  }
  add("2026-05-02", "COURSEHUB*SUB", 1, "Play Store");
  add("2024-11-18", "AMZNPRIME MEMBERSHIP", 1499, "Card");
  add("2025-11-18", "AMZNPRIME MEMBERSHIP", 1499, "Card");
  add("2024-12-20", "HDFC LIFE INSURANCE PREMIUM", 12000, "Bank e-mandate");
  add("2025-12-20", "HDFC LIFE INSURANCE PREMIUM", 12600, "Bank e-mandate");
  ["2025-12-03", "2026-01-15", "2026-02-09", "2026-03-28", "2026-04-30", "2026-06-14", "2026-07-19", "2026-09-02"].forEach((d) => add(d, "NEWSDAILY*DIGITAL", 99, "Merchant"));
  [["2026-02-11", 250], ["2026-03-06", 480], ["2026-05-20", 190], ["2026-08-01", 720], ["2026-10-14", 340]].forEach(([d, a]) => add(d, "SWIGGY ORDER", a, "UPI"));
  return L.join("\n");
}

/* ---------- Rendering ---------- */
const CANCEL = {
  "UPI AutoPay": { steps: ["Open the UPI app where you set up AutoPay (Google Pay, PhonePe, Paytm, BHIM).", "Go to Profile or Settings, then AutoPay or Mandates.", "Select this merchant's mandate and choose Pause or Revoke.", "Check that the status shows Revoked and keep the confirmation."], help: "If the merchant still debits you, raise a dispute in your UPI app and with your bank." },
  "Card recurring": { steps: ["Cancel the plan on the merchant's account or billing page first.", "In your bank or card app, open recurring payments or e-mandates and disable this merchant if available.", "If you cannot find it, call the bank and ask them to stop recurring debits to this merchant.", "Save the cancellation email or reference number."], help: "If you are charged after cancelling, dispute the charge with your card issuer and send your cancellation proof." },
  "Bank e-mandate": { steps: ["Log in to net banking and look for Mandates, ECS or NACH.", "Select the mandate and choose Cancel or Stop. If it is not listed, visit the branch or write to the bank.", "Also cancel with the merchant so they do not set it up again."], help: "Ask the bank for a written acknowledgement that the mandate is cancelled." },
  "Merchant-managed": { steps: ["Sign in to the merchant's website or app.", "Open Account, Membership or Billing and choose Cancel plan.", "Keep the confirmation email and note the last billing date."], help: "If you cannot cancel, email the merchant's support with your payment proof and ask for written confirmation." },
  "App Store": { steps: ["On your iPhone open Settings, tap your name, then Subscriptions.", "Choose the subscription and tap Cancel Subscription."], help: "For wrong charges use reportaproblem.apple.com or contact Apple Support." },
  "Play Store": { steps: ["Open Google Play, tap your profile picture, then Payments and subscriptions, then Subscriptions.", "Choose the subscription and tap Cancel subscription."], help: "For wrong charges, request a refund through Google Play help." }
};

const badge = (t, c) => h("span", "bd" + (c ? " " + c : ""), t);

function bars(id, rows) {
  const box = $(id);
  box.textContent = "";
  const mx = Math.max(1, ...rows.map((r) => r[1]));
  rows.forEach(([l, v]) => {
    const w = h("div", "bar"), tr = h("span", "bt"), f = h("i");
    f.style.width = (v / mx * 100) + "%";
    tr.append(f);
    w.append(h("span", "bl", l), tr, h("span", "bv", inr(v)));
    box.append(w);
  });
  if (!rows.length) box.append(h("p", "hint", "Nothing to show yet."));
}

const sumBy = (list, fn) => { const o = {}; list.forEach((r) => { const k = fn(r); o[k] = (o[k] || 0) + r.annual; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
const label = (r) => r.name === "Unknown merchant" ? "Unknown: " + r.raw[0] : r.name;

function render() {
  const act = recs.filter((r) => !r.late);
  const annual = act.reduce((s, r) => s + r.annual, 0);
  const review = act.filter((r) => r.why.length && flags[r.key] !== "using");
  const unused = act.filter((r) => flags[r.key] === "unused");
  const incr = act.filter((r) => r.ev.length);
  const soon = act.filter((r) => r.next && r.next >= ref && (r.next - ref) / DAY <= 30);

  const st = $("stats");
  st.textContent = "";
  [
    ["Monthly recurring spend", inr(annual / 12), "Normalised estimate"],
    ["Estimated annual spend", inr(annual), "Data up to " + fd(ref)],
    ["Active commitments", act.length, "Detected recurring payments"],
    ["Possibly forgotten", review.length, "Needs your check. Confirmed unused: " + unused.length + " (" + inr(unused.reduce((s, r) => s + r.annual, 0)) + "/yr)"],
    ["Price increases", incr.length, "Detected on active payments"],
    ["Renewals in 30 days", soon.length, "Estimated from last payment"]
  ].forEach(([l, v, s]) => { const c = h("div", "stat"); c.append(h("span", null, l), h("b", null, v), h("small", null, s)); st.append(c); });

  const al = [];
  act.forEach((r) => {
    r.ev.slice(-1).forEach((v) => al.push(["Price increase", r.name + ": " + inr(v.from) + " to " + inr(v.to) + " (+" + v.pct.toFixed(2) + "%, +" + inr(v.to - v.from) + ") on " + fd(v.d) + ".", "warn"]));
    if (r.trial) al.push(["Trial converted", r.name + ": a " + inr(r.tx[0].amt) + " trial payment was followed by a paid " + r.freq.toLowerCase() + " plan of " + inr(r.cur) + " (inferred from the payment pattern).", "bad"]);
    if (r.resumed) al.push(["Charge resumed", r.name + ": payments restarted on " + fd(r.resumed.d) + " after a gap of about " + r.resumed.gap + " days.", "warn"]);
    if (r.freq === "Annual" && r.next && r.next >= ref && (r.next - ref) / DAY <= 60) al.push(["Annual renewal", r.name + ": about " + inr(r.cur) + " is expected around " + fd(r.next) + " (estimate).", "info"]);
    if (r.freq === "Irregular") al.push(["Irregular recurring", r.name + ": payments of about " + inr(r.cur) + " with no fixed schedule.", "info"]);
  });
  const ul = $("alerts");
  ul.textContent = "";
  al.forEach(([t, x, c]) => { const li = h("li", "al " + c); li.append(h("strong", null, t), h("span", null, x)); ul.append(li); });
  if (!al.length) ul.append(h("li", "hint", "No alerts found."));

  const tb = $("tbl").tBodies[0];
  tb.textContent = "";
  recs.forEach((r) => {
    const tr = h("tr"), n = h("td"), s = h("td"), a = h("td");
    n.append(h("strong", null, r.name), h("small", null, r.raw[0]));
    s.append(...[
      r.late && badge("Not seen recently", "warn"),
      r.ev.length && badge("Price up", "warn"),
      r.trial && badge("Trial converted", "bad"),
      r.resumed && badge("Resumed"),
      r.freq === "Irregular" && badge("Irregular"),
      flags[r.key] === "unused" && badge("Marked unused", "ok"),
      r.why.length && !flags[r.key] && badge("Review"),
    ].filter(Boolean));
    if (!s.childNodes.length) s.append(badge("Active", "ok"));
    const btn = h("button", "btn ghost", "Details");
    btn.onclick = () => detail(r);
    a.append(btn);
    tr.append(n, h("td", null, inr(r.cur)), h("td", null, r.freq), h("td", null, fd(r.last)), h("td", null, fd(r.next)), h("td", null, r.mech), s, a);
    tb.append(tr);
  });

  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1));
    months.push([d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }), d.getUTCFullYear() * 12 + d.getUTCMonth(), 0]);
  }
  act.forEach((r) => r.tx.forEach((t) => { const m = months.find((x) => x[1] === t.d.getUTCFullYear() * 12 + t.d.getUTCMonth()); if (m) m[2] += t.amt; }));
  bars("chMonth", months.map((m) => [m[0], m[2]]));
  bars("chMerch", [...act].sort((x, y) => y.annual - x.annual).map((r) => [label(r), r.annual]));
  bars("chCat", sumBy(act, (r) => r.cat));
  bars("chFreq", sumBy(act, (r) => r.freq));
}

function detail(r) {
  const d = $("dlg");
  d.textContent = "";
  const kv = h("dl", "kv");
  [["Category", r.cat], ["Frequency", r.freq], ["Current payment", inr(r.cur)],
   ["Annual cost (estimate)", inr(r.annual) + (r.freq === "Irregular" ? " (observed in last 12 months)" : "")],
   ["Payment mechanism", r.mech], ["Next expected", fd(r.next)]
  ].forEach(([k, v]) => kv.append(h("dt", null, k), h("dd", null, v)));
  d.append(h("h2", null, r.name), h("p", "hint", "Statement text: " + r.raw.join(", ")), kv);

  if (r.why.length) d.append(h("p", "note", "Flagged for review because: " + r.why.join("; ") + ". This is only a pattern-based guess. Only you can confirm whether you have forgotten it."));

  d.append(h("h3", null, "Price changes"));
  const pu = h("ul");
  r.ev.forEach((v) => pu.append(h("li", null, fd(v.d) + ": " + inr(v.from) + " to " + inr(v.to) + " (+" + v.pct.toFixed(2) + "%)")));
  if (!r.ev.length) pu.append(h("li", null, "No price change detected."));
  d.append(pu, h("h3", null, "Payment history"));
  const hu = h("ul");
  [...r.tx].reverse().slice(0, 12).forEach((t) => hu.append(h("li", null, fd(t.d) + ": " + inr(t.amt))));
  d.append(hu, h("h3", null, "How to stop it: " + r.mech));

  const c = CANCEL[r.mech] || CANCEL["Merchant-managed"], ol = h("ol");
  c.steps.forEach((x) => ol.append(h("li", null, x)));
  d.append(ol);
  if (r.url) { const p = h("p"), a = h("a", null, "Official account or management page"); a.href = r.url; a.target = "_blank"; a.rel = "noopener noreferrer"; p.append(a); d.append(p); }
  d.append(h("p", "note", "If the merchant does not respond: " + c.help + " If it is still unresolved, complain to your bank and then to the RBI complaint portal (cms.rbi.org.in). This prototype only guides you. It does not cancel anything."));

  const acts = h("div", "acts");
  [["I no longer use this", "unused", "btn warn"], ["I still use this", "using", "btn ghost"]].forEach(([t, v, cl]) => {
    const b = h("button", cl, t);
    b.onclick = () => { flags[r.key] = v; try { localStorage.setItem("adf." + user.id, JSON.stringify(flags)); } catch (e) { /* ignore */ } d.close(); render(); };
    acts.append(b);
  });
  const x = h("button", "btn ghost", "Close");
  x.onclick = () => d.close();
  acts.append(x);
  d.append(acts);
  d.showModal();
}

/* ---------- Upload ---------- */
function upMsg(t, ok) { const e = $("upMsg"); e.textContent = t; e.className = "msg" + (ok ? " ok" : ""); e.hidden = false; }


function load(text) {
  // Clear previous results first.
  recs = [];
  ref = null;

  $("results").hidden = true;

  $("stats").textContent = "";
  $("alerts").textContent = "";
  $("tbl").tBodies[0].textContent = "";

  ["chMonth", "chMerch", "chCat", "chFreq"].forEach(id => {
    $(id).textContent = "";
  });

  try {
    const result = toRows(text);
    const rows = result.rows;

    // Analyse only the transactions actually read from the file.
    recs = analyse(rows);

    if (recs.length === 0) {
      upMsg(
        "File read successfully: " + rows.length +
        " valid transactions. No recurring payment pattern was detected. " +
        "No demo or fabricated results have been added." +
        (result.skipped ? " Rejected rows: " + result.skipped + "." : ""),
        false
      );

      return;
    }

    // Show dashboard only when real detected groups exist.
    render();
    $("results").hidden = false;

    upMsg(
      "CSV scanned successfully. " +
      rows.length + " valid transactions read. " +
      recs.length + " recurring payment groups detected. " +
      result.skipped + " invalid/credit rows skipped.",
      true
    );

  } catch (error) {
    recs = [];
    ref = null;
    $("results").hidden = true;

    upMsg(error.message || "Could not analyse this CSV file.", false);
  }
}

$("sampleBtn").onclick = () => load(sample());
$("file").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  $("results").hidden = true;
$("upMsg").hidden = true;
recs = [];
ref = null;
  if (f.size > 2e6) return upMsg("That file is too large (maximum 2 MB).");
  const r = new FileReader();
  r.onload = () => load(String(r.result));
  r.onerror = () => upMsg("Could not read that file.");
  r.readAsText(f);
};

boot();