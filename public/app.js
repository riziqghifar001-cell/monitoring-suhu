
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

const OFFLINE_AFTER_MS = 15000;
const REFRESH_LATEST_MS = 2500;
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
//    PAGINASI UNTUK MENGATASI BATAS ROW API
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
      and: `(recorded_at.gte.${start},recorded_at.lt.${end})`,
      order: "recorded_at.asc",
      limit: String(PAGE_SIZE),
      offset: String(offset)
    });

    const rows = await supabaseFetch(
      `${TABLE_URL}?${query.toString()}`
    );

    allRows.push(...rows);

    if (rows.length < PAGE_SIZE) break;
    offset += rows.length;
  }

  return allRows.map(normalizeRecord).filter(Boolean);
}

// ==========================================
// 6. STATUS ESP32
// ==========================================
function setStatus(online, message) {
  const statusText = $("statusText");
  const dot = $("statusDot");

  if (statusText) statusText.textContent = message;

  if (dot) {
    dot.className = "dot " + (online ? "online" : "offline");
  }
}

function showOffline(reason) {
  setStatus(false, "ESP32 Offline");

  // Jangan tampilkan data lama sebagai data terkini.
  $("temperature").textContent = "--";
  $("humidity").textContent = "--";
  $("temperatureStatus").textContent = reason;
  $("lastUpdate").textContent = "Tidak ada data terkini";

  // Analisis historis sengaja tidak dihapus.
}

// ==========================================
// 7. KATEGORI SUHU
// ==========================================
function describeTemperature(temp) {
  if (temp >= 32) return "Panas banget";
  if (temp >= 29) return "Panas";
  if (temp >= 26) return "Cenderung hangat";
  if (temp >= 23) return "Relatif sejuk";
  return "Sejuk";
}

// ==========================================
// 8. ANALISIS SUHU PER JAM
// ==========================================
function analyzeByHour(records) {
  const today = jakartaDateString();
  const groups = new Map();

  for (const record of records) {
    if (jakartaDateString(record.date) !== today) continue;

    const hour = jakartaHour(record.date);
    if (!groups.has(hour)) groups.set(hour, []);
    groups.get(hour).push(record);
  }

  const hourly = [];

  for (const [hour, values] of groups.entries()) {
    if (values.length < 3) continue;

    const temps = values.map(item => item.suhu);
    hourly.push({
      hour,
      average: temps.reduce((sum, value) => sum + value, 0) / temps.length,
      min: Math.min(...temps),
      max: Math.max(...temps),
      count: temps.length
    });
  }

  const hotHour = $("hotHour");
  const coolHour = $("coolHour");
  const hotDetail = $("hotDetail");
  const coolDetail = $("coolDetail");
  const insight = $("insightText");

  const range = hour =>
    `${String(hour).padStart(2, "0")}.00–${String((hour + 1) % 24).padStart(2, "0")}.00`;

  function showResult(element, detail, item) {
    element.textContent = range(item.hour);
    detail.textContent =
      `Rata-rata ${item.average.toFixed(1)} °C; rentang ` +
      `${item.min.toFixed(1)}–${item.max.toFixed(1)} °C; ` +
      `${item.count} pengukuran.`;
  }

  if (hourly.length < 2) {
    hotHour.textContent = "Belum cukup data";
    coolHour.textContent = "Belum cukup data";
    hotDetail.textContent = "Diperlukan minimal 3 pengukuran per jam.";
    coolDetail.textContent = "Diperlukan data dari jam lain untuk perbandingan.";
    insight.textContent = hourly.length === 0
      ? "Belum ada jam dengan data yang mencukupi."
      : "Baru satu jam memenuhi syarat. Tunggu data dari jam lain.";
    return;
  }

  const highest = Math.max(...hourly.map(item => item.average));
  const lowest = Math.min(...hourly.map(item => item.average));
  const hottest = hourly.filter(item => Math.abs(item.average - highest) < 1e-9);
  const coolest = hourly.filter(item => Math.abs(item.average - lowest) < 1e-9);

  showResult(hotHour, hotDetail, hottest[0]);
  showResult(coolHour, coolDetail, coolest[0]);

  if (Math.abs(highest - lowest) < 1e-9) {
    insight.textContent = "Rata-rata suhu semua jam yang memenuhi syarat sama.";
  } else {
    insight.textContent =
      `Selisih rata-rata suhu jam terpanas dan tersejuk ` +
      `${(highest - lowest).toFixed(1)} °C. ` +
      "Perbandingan berdasarkan jam dengan minimal 3 pengukuran.";
  }
}

// ==========================================
// 9. TAMPILKAN DATA TERBARU
// ==========================================
function showOnline(latest) {
  setStatus(true, "ESP32 Terhubung");

  $("temperature").textContent = latest.suhu.toFixed(1);
  $("humidity").textContent = latest.kelembapan.toFixed(1);

  $("temperatureStatus").textContent =
    describeTemperature(latest.suhu);

  $("lastUpdate").textContent =
    "Data diterima " + formatClock(latest.date);

  const analysisDate = $("analysisDate");

  if (analysisDate) {
    analysisDate.textContent = latest.date.toLocaleDateString(
      "id-ID",
      {
        timeZone: "Asia/Jakarta",
        day: "numeric",
        month: "short",
        year: "numeric"
      }
    );
  }
}

// ==========================================
// 10. REFRESH DATA TERBARU
// ==========================================
async function refreshLatest() {
  if (requestInProgress) return;
  requestInProgress = true;

  try {
    const latest = await fetchLatest();

    if (!latest) {
      showOffline("Belum ada data valid dari ESP32.");
      return;
    }

    const age = Date.now() - latest.date.getTime();

    if (age < -5000 || age > OFFLINE_AFTER_MS) {
      showOffline("ESP32 tidak mengirim data terbaru.");
      return;
    }

    showOnline(latest);
  } catch (error) {
    showOffline("Gagal mengambil data dari Supabase.");
    console.error("Kesalahan data terbaru:", error);
  } finally {
    requestInProgress = false;
  }
}

// ==========================================
// 11. REFRESH RIWAYAT DAN ANALISIS
// ==========================================
async function refreshHistory() {
  if (historyInProgress) return;
  historyInProgress = true;

  try {
    historyRecords = await fetchTodayHistory();
    lastHistoryRefresh = Date.now();

    analyzeByHour(historyRecords);

    console.log(
      `Riwayat hari ini: ${historyRecords.length} pengukuran`
    );
  } catch (error) {
    console.error("Gagal mengambil riwayat:", error);
  } finally {
    historyInProgress = false;
  }
}

// ==========================================
// 12. JALANKAN DASHBOARD
// ==========================================
if (
  SUPABASE_KEY === "TEMPEL_PUBLISHABLE_KEY_DI_SINI" ||
  !SUPABASE_KEY.trim()
) {
  setStatus(false, "Konfigurasi Supabase belum lengkap");
  console.error("Isi SUPABASE_KEY dengan publishable key.");
} else {
  refreshLatest();
  refreshHistory();

  setInterval(refreshLatest, REFRESH_LATEST_MS);

  setInterval(() => {
    if (Date.now() - lastHistoryRefresh >= REFRESH_HISTORY_MS) {
      refreshHistory();
    }
  }, 5000);
}