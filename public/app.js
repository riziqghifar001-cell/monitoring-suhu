const $ = id => document.getElementById(id);

// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
const SUPABASE_URL =
  "https://rcgcerurtrnfccrwcuns.supabase.co";

const SUPABASE_KEY =
  "sb_publishable_jatgzAXihteDe_0_0iCDhg_bJXTNVFX";

const TABLE_URL =
  `${SUPABASE_URL}/rest/v1/sensor_readings`;

const OFFLINE_AFTER_MS = 75000;
const REFRESH_LATEST_MS = 5000;
const REFRESH_HISTORY_MS = 60000;
const PAGE_SIZE = 1000;

let requestInProgress = false;
let historyInProgress = false;
let lastHistoryRefresh = 0;
let historyRecords = [];

// ==========================================
// 2. FORMAT WAKTU INDONESIA
// ==========================================
const jakartaFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function jakartaDateString(date = new Date()) {
  const parts = jakartaFormatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function jakartaHour(date) {
  return Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    hourCycle: "h23"
  }).format(date));
}

function normalizeRecord(item) {
  if (!item) return null;

  const suhu = Number(item.suhu);
  const kelembapan = Number(item.kelembapan);
  const date = new Date(item.recorded_at);

  if (
    !Number.isFinite(suhu) ||
    !Number.isFinite(kelembapan) ||
    Number.isNaN(date.getTime())
  ) {
    return null;
  }

  return { suhu, kelembapan, date };
}

function formatClock(date) {
  return date.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

// ==========================================
// 3. REQUEST SUPABASE
// ==========================================
async function supabaseFetch(url, range) {
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`
  };

  if (range) headers.Range = range;

  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase HTTP ${response.status}: ${detail}`);
  }

  return response.json();
}

// ==========================================
// 4. AMBIL DATA TERBARU
// ==========================================
async function fetchLatest() {
  const query = new URLSearchParams({
    select: "suhu,kelembapan,recorded_at",
    order: "recorded_at.desc",
    limit: "1"
  });

  const rows = await supabaseFetch(
    `${TABLE_URL}?${query.toString()}`
  );

  return rows.length ? normalizeRecord(rows[0]) : null;
}

// ==========================================
// 5. AMBIL SELURUH RIWAYAT HARI INI
// ==========================================
async function fetchTodayHistory() {
  const today = jakartaDateString();
  const start = `${today}T00:00:00+07:00`;

  const tomorrowDate = new Date(
    new Date(start).getTime() + 24 * 60 * 60 * 1000
  );

  const tomorrow = jakartaDateString(tomorrowDate);
  const end = `${tomorrow}T00:00:00+07:00`;
  const allRows = [];
  let offset = 0;

  while (true) {
    const query = new URLSearchParams({
      select: "suhu,kelembapan,recorded_at",
      recorded_at: `gte.${start}`,
      and: `(recorded_at.lt.${end})`,
      order: "recorded_at.asc",
      limit: String(PAGE_SIZE),
      offset: String(offset)
    });

    const rows = await supabaseFetch(
      `${TABLE_URL}?${query.toString()}`,
      `0-${PAGE_SIZE - 1}`
    );

    const validRows = rows
      .map(normalizeRecord)
      .filter(item => item !== null);

    allRows.push(...validRows);

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allRows;
}

// ==========================================
// 6. STATUS KONEKSI
// ==========================================
function setStatus(online, text) {
  const dot = $("statusDot");
  const label = $("statusText");
  if (!dot || !label) return;

  if (online) {
    dot.className = "status online";
    label.textContent = text;
  } else {
    dot.className = "status offline";
    label.textContent = text;
  }
}

// ==========================================
// 7. DESKRIPSI SUHU RUANGAN
// ==========================================
function describeTemperature(suhu) {
  if (suhu < 24) return "Sejuk dan nyaman";
  if (suhu < 27) return "Suhu normal ruangan";
  if (suhu < 30) return "Cukup hangat";
  return "Terasa panas";
}

// ==========================================
// 8. ANALISIS HARIAN (DISEDERHANAKAN)
// ==========================================
function analyzeDaily(records) {
  const buckets = Array.from({ length: 24 }, () => []);

  for (const item of records) {
    const h = jakartaHour(item.date);
    if (h >= 0 && h < 24) {
      buckets[h].push(item.suhu);
    }
  }

  const MIN_SAMPLES = 10;
  const MIN_COVERAGE = 0.1;
  const hourly = [];

  for (let hour = 0; hour < 24; hour++) {
    const temps = buckets[hour];
    const expected = 60;
    const count = temps.length;
    const coverage = expected > 0 ? Math.min(1, count / expected) : 0;

    if (count < MIN_SAMPLES || coverage < MIN_COVERAGE) continue;

    hourly.push({
      hour,
      average: temps.reduce((sum, value) => sum + value, 0) / count,
      count
    });
  }

  hourly.sort((a, b) => a.hour - b.hour);

  const hotHour = $("hotHour");
  const coolHour = $("coolHour");
  const hotDetail = $("hotDetail");
  const coolDetail = $("coolDetail");
  const insight = $("insightText");

  if (!hotHour || !coolHour || !hotDetail || !coolDetail || !insight) return;

  const range = hour =>
    `${String(hour).padStart(2, "0")}.00–${String((hour + 1) % 24).padStart(2, "0")}.00`;

  function showResult(element, detail, item) {
    element.textContent = range(item.hour);
    // Detail hanya menampilkan rata-rata suhu sesuai permintaan
    detail.textContent = `Rata-rata ${item.average.toFixed(1)} °C`;
  }

  if (hourly.length < 2) {
    hotHour.textContent = "Belum cukup data";
    coolHour.textContent = "Belum cukup data";
    hotDetail.textContent = "Data suhu per jam akan dianalisis di sini.";
    coolDetail.textContent = "Data suhu per jam akan dianalisis di sini.";
    insight.textContent = "Menunggu data sensor untuk mengetahui pola suhu kamar.";
    return;
  }

  const highest = Math.max(...hourly.map(item => item.average));
  const lowest = Math.min(...hourly.map(item => item.average));
  const hottest = hourly.filter(item => Math.abs(item.average - highest) < 1e-9);
  const coolest = hourly.filter(item => Math.abs(item.average - lowest) < 1e-9);

  showResult(hotHour, hotDetail, hottest[0]);
  showResult(coolHour, coolDetail, coolest[0]);

  insight.textContent =
    `Selisih rata-rata jam terpanas dan tersejuk ${(highest - lowest).toFixed(1)} °C.`;
}

// ==========================================
// 9. TAMPILKAN DATA TERBARU
// ==========================================
function showOnline(latest) {
  setStatus(true, "ESP32 Terhubung");

  if ($("temperature")) $("temperature").textContent = latest.suhu.toFixed(1);
  if ($("humidity")) $("humidity").textContent = latest.kelembapan.toFixed(1);
  if ($("temperatureStatus")) $("temperatureStatus").textContent = describeTemperature(latest.suhu);

  const analysisDate = $("analysisDate");
  if (analysisDate) {
    analysisDate.textContent = latest.date.toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric"
    });
  }
}

// ==========================================
// 10. REFRESH LOOP UTAMA
// ==========================================
async function refreshLatestData() {
  if (requestInProgress) return;
  requestInProgress = true;

  try {
    const latest = await fetchLatest();
    if (latest && Date.now() - latest.date.getTime() < OFFLINE_AFTER_MS) {
      showOnline(latest);
    } else {
      setStatus(false, "ESP32 Terputus");
    }
  } catch (err) {
    console.error("Gagal mengambil data terbaru:", err);
    setStatus(false, "Kesalahan Koneksi");
  } finally {
    requestInProgress = false;
  }
}

async function refreshHistoryData(force = false) {
  if (historyInProgress) return;
  const now = Date.now();
  if (!force && now - lastHistoryRefresh < REFRESH_HISTORY_MS) return;

  historyInProgress = true;
  lastHistoryRefresh = now;

  try {
    const rows = await fetchTodayHistory();
    historyRecords = rows;
    analyzeDaily(historyRecords);
  } catch (err) {
    console.error("Gagal mengambil riwayat harian:", err);
  } finally {
    historyInProgress = false;
  }
}

async function initDashboard() {
  await refreshLatestData();
  await refreshHistoryData(true);

  setInterval(refreshLatestData, REFRESH_LATEST_MS);
  setInterval(() => refreshHistoryData(false), REFRESH_HISTORY_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDashboard);
} else {
  initDashboard();
}
