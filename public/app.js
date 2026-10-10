
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

  // WIB = UTC+7; batas hari dibuat eksplisit.
  const start = `${today}T00:00:00+07:00`;

  const tomorrowDate = new Date(
    new Date(`${today}T00:00:00+07:00`).getTime() +
    24 * 60 * 60 * 1000
  );

  const tomorrow = jakartaDateString(tomorrowDate);
  const end = `${tomorrow}T00:00:00+07:00`;

  const query = new URLSearchParams({
    select: "suhu,kelembapan,recorded_at",
    recorded_at: `gte.${start}`,
    order: "recorded_at.asc",
    limit: String(PAGE_SIZE)
  });

  // Filter akhir hari ditambahkan terpisah agar tidak
  // menimpa filter awal recorded_at.
  query.append("recorded_at", `lt.${end}`);

  const all = [];
  let offset = 0;

  while (true) {
    const rows = await supabaseFetch(
      `${TABLE_URL}?${query.toString()}`,
      `${offset}-${offset + PAGE_SIZE - 1}`
    );

    all.push(...rows.map(normalizeRecord).filter(Boolean));

    if (rows.length < PAGE_SIZE) break;

    offset += rows.length;
  }

  return all;
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

  const todayRecords = records.filter(record =>
    jakartaDateString(record.date) === today
  );

  const groups = new Map();

  for (const record of todayRecords) {
    const hour = jakartaHour(record.date);

    if (!groups.has(hour)) groups.set(hour, []);
    groups.get(hour).push(record);
  }

  const hourly = [];

  for (const [hour, values] of groups.entries()) {
    if (values.length < 3) continue;

    const average = values.reduce(
      (sum, item) => sum + item.suhu, 0
    ) / values.length;

    const min = Math.min(...values.map(item => item.suhu));
    const max = Math.max(...values.map(item => item.suhu));

    hourly.push({ hour, average, min, max, count: values.length });
  }

  if (!hourly.length) {
    $("hotHour").textContent = "Belum cukup data";
    $("coolHour").textContent = "Belum cukup data";

    $("hotDetail").textContent =
      "Diperlukan minimal 3 pengukuran dalam satu jam.";

    $("coolDetail").textContent =
      "Hasil tersedia setelah data mencukupi.";

    $("insightText").textContent =
      "Pantau kamar lebih lama untuk menemukan pola suhu harian.";

    return;
  }

  const hottest = hourly.reduce(
    (a, b) => b.average > a.average ? b : a
  );

  const coolest = hourly.reduce(
    (a, b) => b.average < a.average ? b : a
  );

  const hourRange = hour =>
    `${String(hour).padStart(2, "0")}.00–` +
    `${String((hour + 1) % 24).padStart(2, "0")}.00`;

  $("hotHour").textContent = hourRange(hottest.hour);

  $("hotDetail").textContent =
    `Rata-rata ${hottest.average.toFixed(1)} °C; ` +
    `rentang ${hottest.min.toFixed(1)}–${hottest.max.toFixed(1)} °C; ` +
    `${hottest.count} pengukuran.`;

  $("coolHour").textContent = hourRange(coolest.hour);

  $("coolDetail").textContent =
    `Rata-rata ${coolest.average.toFixed(1)} °C; ` +
    `rentang ${coolest.min.toFixed(1)}–${coolest.max.toFixed(1)} °C; ` +
    `${coolest.count} pengukuran.`;

  if (hottest.hour === coolest.hour) {
    $("insightText").textContent =
      "Belum terlihat perbedaan jam panas dan sejuk yang jelas.";
  } else {
    $("insightText").textContent =
      `Selisih rata-rata suhu kedua jam tersebut ` +
      `${(hottest.average - coolest.average).toFixed(1)} °C. ` +
      `Hasil dihitung dari data hari ini.`;
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