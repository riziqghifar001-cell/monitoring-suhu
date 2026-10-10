const $ = id => document.getElementById(id);

const OFFLINE_AFTER_MS = 15000;
let requestInProgress = false;
let lastGoodRecords = [];

function normalizeDate(value) {
  if (value === undefined || value === null || value === "") return null;

  // Mendukung timestamp Unix dalam detik atau milidetik.
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const number = Number(value);
    const milliseconds = number < 1e12 ? number * 1000 : number;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toRecord(item) {
  if (!item || typeof item !== "object") return null;

  const suhu = Number(item.suhu ?? item.temperature);
  const kelembapan = Number(item.kelembapan ?? item.humidity);

  const date = normalizeDate(
    item.timestamp ??
    item.waktu ??
    item.time ??
    item.created_at ??
    item.updatedAt ??
    item.datetime
  );

  if (!Number.isFinite(suhu) || !Number.isFinite(kelembapan)) return null;

  return { suhu, kelembapan, date };
}

function extractPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.map(toRecord).filter(Boolean);
  }

  if (!payload || typeof payload !== "object") return [];

  const list = payload.history ?? payload.data ?? payload.records;

  if (Array.isArray(list)) {
    const records = list.map(toRecord).filter(Boolean);
    if (records.length) return records;
  }

  const latest = toRecord(payload.latest ?? payload);
  return latest ? [latest] : [];
}

function setStatus(online, message) {
  const statusText = $("statusText");
  const dot = $("statusDot");

  if (statusText) statusText.textContent = message;
  if (dot) dot.className = "dot " + (online ? "online" : "offline");
}

function clearAnalysis(message) {
  $("hotHour").textContent = "Tidak tersedia";
  $("coolHour").textContent = "Tidak tersedia";
  $("hotDetail").textContent = message;
  $("coolDetail").textContent = message;
  $("insightText").textContent = message;
}

function showOffline(reason) {
  setStatus(false, "ESP32 Offline");

  // Jangan tampilkan nilai terakhir seolah-olah itu nilai terkini.
  $("temperature").textContent = "--";
  $("humidity").textContent = "--";
  $("temperatureStatus").textContent = reason;
  $("lastUpdate").textContent = "Tidak ada data terkini";

  clearAnalysis("Analisis dijeda karena ESP32 offline atau data sudah kedaluwarsa.");
}

function formatClock(date) {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function describeTemperature(temp) {
  if (temp >= 32) return "Panas banget";
  if (temp >= 29) return "Panas";
  if (temp >= 26) return "Cenderung hangat";
  if (temp >= 23) return "Relatif sejuk";
  return "Sejuk";
}

function analyzeByHour(records) {
  const now = new Date();

  const today = records.filter(record =>
    record.date &&
    record.date.getFullYear() === now.getFullYear() &&
    record.date.getMonth() === now.getMonth() &&
    record.date.getDate() === now.getDate()
  );

  const groups = new Map();

  for (const record of today) {
    const hour = record.date.getHours();
    if (!groups.has(hour)) groups.set(hour, []);
    groups.get(hour).push(record);
  }

  const hourly = [];

  for (const [hour, values] of groups.entries()) {
    if (values.length < 3) continue;

    const average = values.reduce((sum, item) => sum + item.suhu, 0) / values.length;
    const min = Math.min(...values.map(item => item.suhu));
    const max = Math.max(...values.map(item => item.suhu));

    hourly.push({ hour, average, min, max, count: values.length });
  }

  if (!hourly.length) {
    $("hotHour").textContent = "Belum cukup data";
    $("coolHour").textContent = "Belum cukup data";
    $("hotDetail").textContent = "Diperlukan minimal 3 pengukuran dalam satu jam.";
    $("coolDetail").textContent = "Hasil akan tersedia setelah data mencukupi.";
    $("insightText").textContent = "Pantau kamar lebih lama untuk menemukan pola suhu harian.";
    return;
  }

  const hottest = hourly.reduce((a, b) => b.average > a.average ? b : a);
  const coolest = hourly.reduce((a, b) => b.average < a.average ? b : a);

  const hourRange = hour =>
    `${String(hour).padStart(2, "0")}.00–${String((hour + 1) % 24).padStart(2, "0")}.00`;

  $("hotHour").textContent = hourRange(hottest.hour);
  $("hotDetail").textContent =
    `Rata-rata ${hottest.average.toFixed(1)} °C; rentang ${hottest.min.toFixed(1)}–${hottest.max.toFixed(1)} °C.`;

  $("coolHour").textContent = hourRange(coolest.hour);
  $("coolDetail").textContent =
    `Rata-rata ${coolest.average.toFixed(1)} °C; rentang ${coolest.min.toFixed(1)}–${coolest.max.toFixed(1)} °C.`;

  if (hottest.hour === coolest.hour) {
    $("insightText").textContent = "Belum terlihat perbedaan jam panas dan sejuk yang jelas.";
  } else {
    $("insightText").textContent =
      `Selisih rata-rata suhu pada kedua jam tersebut ${(hottest.average - coolest.average).toFixed(1)} °C. Pantau beberapa hari untuk memastikan polanya.`;
  }
}

function showOnline(latest, records) {
  setStatus(true, "ESP32 Terhubung");

  $("temperature").textContent = latest.suhu.toFixed(1);
  $("humidity").textContent = latest.kelembapan.toFixed(1);
  $("temperatureStatus").textContent = describeTemperature(latest.suhu);
  $("lastUpdate").textContent = "Data diterima " + formatClock(latest.date);

  const analysisDate = $("analysisDate");
  if (analysisDate) {
    analysisDate.textContent = latest.date.toLocaleDateString("id-ID", {
      day: "numeric", month: "short", year: "numeric"
    });
  }

  analyzeByHour(records);
}

async function refresh() {
  if (requestInProgress) return;
  requestInProgress = true;

  try {
    const response = await fetch("/api/data", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const records = extractPayload(payload).sort((a, b) => a.date - b.date);

    if (!records.length) {
      showOffline("Belum ada data valid dari ESP32.");
      return;
    }

    const latest = records[records.length - 1];

    // Tanpa timestamp, frontend tidak bisa membedakan data baru dan data lama.
    if (!latest.date) {
      showOffline("Timestamp data tidak tersedia.");
      return;
    }

    const age = Date.now() - latest.date.getTime();

    // Timestamp terlalu jauh di masa depan juga dianggap tidak valid.
    if (age < -5000 || age > OFFLINE_AFTER_MS) {
      showOffline("ESP32 tidak mengirim data terbaru.");
      return;
    }

    lastGoodRecords = records;
    showOnline(latest, records);
  } catch (error) {
    showOffline("Server tidak dapat dihubungi.");
    console.warn("Status monitoring:", error.message);
  } finally {
    requestInProgress = false;
  }
}

refresh();
setInterval(refresh, 2500);
