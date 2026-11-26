/*
  Smart Climate Control V8 (Optimized Protection & Energy Sync)
  Board: ESP32-S3
  Sensor: DHT22 GPIO4
  IR: Daikin128 GPIO5
  Cloud: Supabase Edge Function quick-endpoint
  Weather: Open-Meteo
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <time.h>
#include <math.h>
#include <Preferences.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include <ir_Daikin.h>

// ============================================================
// 1. CONFIGURATION
// ============================================================
const char* WIFI_SSID = "Aryo Sidiq";
const char* WIFI_PASSWORD = "cukitooo";
const char* DEVICE_TOKEN = "SRVF0pZEBouRws9vYOSW2ZIBGpABG60kKFpfNbDIzjg";
const char* API ="https://rcgcerurtrnfccrwcuns.supabase.co/functions/v1/quick-endpoint";
const char* DEVICE_ID = "esp32-kamar";

// ============================================================
// 2. HARDWARE
// ============================================================
#define DHTPIN 4
#define DHTTYPE DHT22
const uint16_t IR_PIN = 5;

DHT dht(DHTPIN, DHTTYPE);
IRDaikin128 ac(IR_PIN);
Preferences prefs;

// ============================================================
// 3. ENERGY / MONTHLY BUDGET CONFIGURATION
// ============================================================
const float TARIF_PER_KWH = 1352.0f;
const float ANGGARAN_BULAN_RP = 100000.0f;
const float TARGET_TOTAL_KWH_BULANAN = ANGGARAN_BULAN_RP / TARIF_PER_KWH; 

// Asumsi Daya Perangkat (Software Estimate)
const float DAYA_COOL_KW = 0.633f;
const float DAYA_FAN_KW  = 0.042f;

// Target Adaptif Siang
const float TARGET_SIANG_NORMAL = 26.0f;
const float TARGET_SIANG_PANAS  = 25.0f;
const float SUHU_KAMAR_PANAS    = 29.0f;
const float SUHU_LUAR_PANAS     = 33.0f;

// Jadwal Malam (22:00 - 05:00)
const int JAM_MALAM_MULAI = 22;
const int JAM_MALAM_SELESAI = 5;
const float TARGET_MALAM_COOL_ON  = 28.0f;
const float TARGET_MALAM_FAN_BACK = 26.5f;

// Interval Waktu (Millis)
const unsigned long READ_INTERVAL        = 2500UL;
const unsigned long POST_INTERVAL        = 30000UL;
const unsigned long POLL_INTERVAL        = 5000UL;
const unsigned long LAPOR_INTERVAL       = 1500UL;
const unsigned long WEATHER_INTERVAL     = 900000UL;
const unsigned long WIFI_INTERVAL        = 10000UL;
const unsigned long IR_MIN_INTERVAL      = 3000UL;
const unsigned long AUTO_INTERVAL        = 10000UL;
const unsigned long ENERGY_SAVE_MS       = 300000UL; 
const unsigned long SENSOR_STALE_MS      = 15000UL;

// ============================================================
// PERBAIKAN UTAMA: PROTEKSI SHORT-CYCLE & HOLD MODE DIPERKETAT
// ============================================================
// Kompresor minimal nyala 5 menit & minimal mati 5 menit agar tidak gampang gonta-ganti
const unsigned long MIN_COOL_ON_MS   = 5UL * 60UL * 1000UL; 
const unsigned long MIN_COOL_OFF_MS  = 5UL * 60UL * 1000UL; 
// Minimal tahan di mode yang sama selama 4 menit agar tidak bolak-balik Cool <-> Fan dalam 1 menit
const unsigned long MIN_MODE_HOLD_MS = 4UL * 60UL * 1000UL; 

const int JUMLAH_SAMPEL = 5;

// ============================================================
// 4. SENSOR STATE
// ============================================================
float sampelSuhu[JUMLAH_SAMPEL] = {NAN, NAN, NAN, NAN, NAN};
float sampelRH[JUMLAH_SAMPEL] = {NAN, NAN, NAN, NAN, NAN};
int indeksSampel = 0;
int jumlahSampel = 0;
float suhuKamar = NAN;
float kelembapanKamar = NAN;
unsigned long waktuSensorValid = 0;

// ============================================================
// 5. AC / CONTROL STATE
// ============================================================
uint8_t suhuTarget = 26;
uint8_t modeAC = kDaikin128Cool;
uint8_t kecepatanKipas = kDaikin128FanAuto;

bool swing = false;
bool quiet = false;
bool turbo = false;
bool sleepMode = false;

bool statusDayaDiketahui = false; 
bool targetDayaON = false;
bool kompresorDiperkirakanAktif = false;
bool modeKontrolAuto = true;
bool sinkronAwal = false;

String keputusanTerakhir = "Menunggu data sensor";
String modeJadwal = "init";
long revTerakhir = -1;
bool perluLapor = false;

unsigned long waktuIRTerakhir = 0;
unsigned long waktuMulaiDayaON = 0;
unsigned long waktuMulaiDayaOFF = 0;
unsigned long waktuMulaiKompresor = 0;
unsigned long waktuMulaiMode = 0; // Timer pelacak durasi mode aktif
bool timerDayaDiinisialisasi = false;

bool irTertunda = false;
unsigned long httpBackoffMs = 0;
unsigned long waktuHttpGagalTerakhir = 0;

// ============================================================
// 6. MONTHLY ENERGY STATE
// ============================================================
float kWhCoolBulanIni = 0.0f;
float kWhFanBulanIni = 0.0f;
float kWhLainBulanIni = 0.0f;
uint32_t kunciBulanTerakhir = 0;
unsigned long energyTickMs = 0;
unsigned long energySaveMs = 0;

float kwhTotalAwalHari = -1.0f;
int hariTerakhir = -1;

// ============================================================
// 7. WEATHER STATE
// ============================================================
float suhuLuar = NAN;
float rhLuar = NAN;
bool cuacaValid = false;
unsigned long waktuCuaca = 0;

// ============================================================
// 8. SYSTEM TIMERS
// ============================================================
unsigned long timerSensor = 0;
unsigned long timerPost = 0;
unsigned long timerPoll = 0;
unsigned long timerLapor = 0;
unsigned long timerCuaca = 0;
unsigned long timerAuto = 0;
unsigned long timerWiFi = 0;

void simpanDataNVS();
float targetAdaptifSiang();

// ============================================================
// 9. UTILITIES & DIAGNOSTICS
// ============================================================
bool sensorSegar() {
  return !isnan(suhuKamar) && !isnan(kelembapanKamar) &&
         (millis() - waktuSensorValid < SENSOR_STALE_MS);
}

float trimmedMean(float* data, int count) {
  if (count <= 0) return NAN;
  float temp[JUMLAH_SAMPEL];
  for (int i = 0; i < count; i++) temp[i] = data[i];

  for (int i = 0; i < count - 1; i++) {
    for (int j = 0; j < count - i - 1; j++) {
      if (temp[j] > temp[j + 1]) {
        float t = temp[j]; temp[j] = temp[j + 1]; temp[j + 1] = t;
      }
    }
  }

  if (count < JUMLAH_SAMPEL) {
    float sum = 0;
    for (int i = 0; i < count; i++) sum += temp[i];
    return sum / count;
  }

  float sum = 0;
  for (int i = 1; i < count - 1; i++) sum += temp[i];
  return sum / (count - 2);
}

void bacaSensor() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t) || isnan(h) || t < -40 || t > 80 || h < 0 || h > 100) {
    Serial.println("[DHT22] Pembacaan sensor tidak valid.");
    return;
  }

  sampelSuhu[indeksSampel] = t;
  sampelRH[indeksSampel] = h;
  indeksSampel = (indeksSampel + 1) % JUMLAH_SAMPEL;
  if (jumlahSampel < JUMLAH_SAMPEL) jumlahSampel++;

  suhuKamar = trimmedMean(sampelSuhu, jumlahSampel);
  kelembapanKamar = trimmedMean(sampelRH, jumlahSampel);
  waktuSensorValid = millis();
}

bool waktuValid(struct tm* out) {
  return getLocalTime(out, 50) && out->tm_year >= (2024 - 1900);
}

uint32_t kunciBulan(const struct tm& t) {
  return (uint32_t)(t.tm_year + 1900) * 100UL + (uint32_t)(t.tm_mon + 1);
}

int getHariDalamBulan(const struct tm& t) {
  int tahun = t.tm_year + 1900;
  int bulan = t.tm_mon + 1;
  if (bulan == 2) {
    bool kabisat = ((tahun % 4 == 0) && (tahun % 100 != 0)) || (tahun % 400 == 0);
    return kabisat ? 29 : 28;
  }
  if (bulan == 4 || bulan == 6 || bulan == 9 || bulan == 11) return 30;
  return 31;
}

bool dalamJadwalMalam(const struct tm& t) {
  return (t.tm_hour >= JAM_MALAM_MULAI || t.tm_hour < JAM_MALAM_SELESAI);
}

String namaMode(uint8_t mode) {
  if (mode == kDaikin128Cool) return "cool";
  if (mode == kDaikin128Dry) return "dry";
  if (mode == kDaikin128Fan) return "fan";
  if (mode == kDaikin128Heat) return "heat";
  return "cool";
}

uint8_t konversiMode(String mode) {
  mode.trim(); mode.toLowerCase();
  if (mode == "dry") return kDaikin128Dry;
  if (mode == "fan") return kDaikin128Fan;
  if (mode == "heat") return kDaikin128Heat;
  return kDaikin128Cool;
}

uint8_t konversiKipas(String kipas) {
  kipas.trim(); kipas.toLowerCase();
  if (kipas == "low") return kDaikin128FanLow;
  if (kipas == "med" || kipas == "medium") return kDaikin128FanMed;
  if (kipas == "high") return kDaikin128FanHigh;
  return kDaikin128FanAuto;
}

String namaKipas(uint8_t kipas) {
  if (kipas == kDaikin128FanLow) return "low";
  if (kipas == kDaikin128FanMed) return "med";
  if (kipas == kDaikin128FanHigh) return "high";
  return "auto";
}

bool irSiap() {
  return waktuIRTerakhir == 0 || millis() - waktuIRTerakhir >= IR_MIN_INTERVAL;
}

// ============================================================
// 10. UNIFIED ACTUATION GATE & STRICT TIMER GUARD
// ============================================================
bool validasiTimerGuard(bool dayaBaru, uint8_t modeBaru) {
  if (!timerDayaDiinisialisasi) return true;
  unsigned long now = millis();

  bool kompresorAkanAktif = dayaBaru && (modeBaru == kDaikin128Cool);

  // Proteksi 1: Kompresor baru boleh OFF jika sudah nyala minimal 5 menit (MIN_COOL_ON_MS)
  if (kompresorDiperkirakanAktif && (!dayaBaru || modeBaru != kDaikin128Cool)) {
    if (now - waktuMulaiKompresor < MIN_COOL_ON_MS) {
      return false; // Tolak! Belum waktunya kompresor mati
    }
  }

  // Proteksi 2: Kompresor baru boleh ON jika sebelumnya sudah mati minimal 5 menit (MIN_COOL_OFF_MS)
  if (kompresorAkanAktif && !kompresorDiperkirakanAktif) {
    if (now - waktuMulaiDayaOFF < MIN_COOL_OFF_MS) {
      return false; // Tolak! Mencegah short-cycle kompresor
    }
  }

  // Proteksi 3: Hold Mode (Mencegah gonta-ganti Cool <-> Fan kurang dari 4 menit)
  bool perubahanModeAktif = (modeBaru != modeAC);
  if (perubahanModeAktif && (now - waktuMulaiMode < MIN_MODE_HOLD_MS)) {
    return false; // Tolak! Mode harus bertahan minimal 4 menit
  }

  return true;
}

void kirimFrameIRActual(bool toggleDaya) {
  ac.setPowerToggle(toggleDaya);
  ac.setTemp(suhuTarget);
  ac.setMode(modeAC);
  ac.setFan(kecepatanKipas);
  ac.setSwingVertical(swing);
  ac.setQuiet(quiet);
  ac.setPowerful(turbo);
  ac.setSleep(sleepMode);

  ac.send();
  ac.setPowerToggle(false);
  waktuIRTerakhir = millis();
}

bool eksekusiPengaturanAC(bool dayaBaru, uint8_t modeBaru, uint8_t tempBaru, 
                         uint8_t fanBaru, bool swingBaru, bool quietBaru, 
                         bool turboBaru, bool sleepBaru, bool paksaKirim) {
  
  // Jika status daya belum diketahui, kita set default menjadi true (asumsi user ingin mengontrol)
  // atau biarkan jika dalam mode AUTO ketat.
  if (!statusDayaDiketahui) {
    statusDayaDiketahui = true; // Auto-assume agar tidak tertahan terus
    targetDayaON = dayaBaru;
  }

  if (!validasiTimerGuard(dayaBaru, modeBaru) && !paksaKirim) {
    keputusanTerakhir = "Aksi ditolak: Melanggar Proteksi Timer Guard / Min Hold Mode";
    return false;
  }

  bool perubahanDaya = (dayaBaru != targetDayaON);
  bool perubahanState = perubahanDaya || (modeBaru != modeAC) || (tempBaru != suhuTarget) ||
                        (fanBaru != kecepatanKipas) || (swingBaru != swing) ||
                        (quietBaru != quiet) || (turboBaru != turbo) || (sleepBaru != sleepMode);

  if (!perubahanState && !paksaKirim) return true;

  unsigned long now = millis();

  targetDayaON = dayaBaru;
  if (modeAC != modeBaru) {
    modeAC = modeBaru;
    waktuMulaiMode = now; 
  }
  suhuTarget = tempBaru;
  quiet = quietBaru;
  turbo = turboBaru;
  if (quiet && turbo) turbo = false;
  if (!quiet && !turbo) {
    kecepatanKipas = fanBaru;
  }
  swing = swingBaru;
  sleepMode = sleepBaru;

  bool kompresorAktifBaru = targetDayaON && (modeAC == kDaikin128Cool);
  if (kompresorAktifBaru && !kompresorDiperkirakanAktif) {
    waktuMulaiKompresor = now;
  }
  kompresorDiperkirakanAktif = kompresorAktifBaru;

  if (perubahanDaya) {
    timerDayaDiinisialisasi = true;
    if (targetDayaON) waktuMulaiDayaON = now;
    else waktuMulaiDayaOFF = now;
  }

  // EKSEKUSI PENGIRIMAN IR
  if (irSiap()) {
    kirimFrameIRActual(perubahanDaya);
    irTertunda = false;
  } else {
    irTertunda = true;
  }

  perluLapor = true;
  simpanDataNVS();
  return true;
}

// ============================================================
// 11. NVS & ENERGY ACCOUNTING (YANG DISELARASKAN)
// ============================================================
void muatDataNVS() {
  prefs.begin("climate8", false);
  kWhCoolBulanIni = prefs.getFloat("kwhCoolM", 0.0f);
  kWhFanBulanIni = prefs.getFloat("kwhFanM", 0.0f);
  kWhLainBulanIni = prefs.getFloat("kwhOthM", 0.0f);
  kunciBulanTerakhir = prefs.getUInt("monthKey", 0);
  statusDayaDiketahui = prefs.getBool("known", true);
  targetDayaON = prefs.getBool("power", false);
  modeKontrolAuto = prefs.getBool("auto", true);
  suhuTarget = prefs.getUChar("target", 26);
  modeAC = prefs.getUChar("acMode", kDaikin128Cool);
  prefs.end();

  if (suhuTarget < 16 || suhuTarget > 30) suhuTarget = 26;
  if (modeAC != kDaikin128Cool && modeAC != kDaikin128Dry &&
      modeAC != kDaikin128Fan && modeAC != kDaikin128Heat) modeAC = kDaikin128Cool;

  timerDayaDiinisialisasi = false;
  kompresorDiperkirakanAktif = targetDayaON && (modeAC == kDaikin128Cool);
}

void simpanDataNVS() {
  prefs.begin("climate8", false);
  prefs.putFloat("kwhCoolM", kWhCoolBulanIni);
  prefs.putFloat("kwhFanM", kWhFanBulanIni);
  prefs.putFloat("kwhOthM", kWhLainBulanIni);
  prefs.putUInt("monthKey", kunciBulanTerakhir);
  prefs.putBool("known", statusDayaDiketahui);
  prefs.putBool("power", targetDayaON);
  prefs.putBool("auto", modeKontrolAuto);
  prefs.putUChar("target", suhuTarget);
  prefs.putUChar("acMode", modeAC);
  prefs.end();
}

void resetEnergiBulanan(uint32_t key) {
  kWhCoolBulanIni = 0.0f;
  kWhFanBulanIni = 0.0f;
  kWhLainBulanIni = 0.0f;
  kunciBulanTerakhir = key;
  simpanDataNVS();
}

// PERBAIKAN: Perhitungan kWh dipecah presisi antara kompresor ON (Cool) vs Fan saja
void perbaruiEnergi() {
  unsigned long nowMs = millis();
  if (energyTickMs == 0) {
    energyTickMs = nowMs;
    return;
  }

  unsigned long elapsed = nowMs - energyTickMs;
  energyTickMs = nowMs;

  if (elapsed > 120000UL) elapsed = 120000UL;

  struct tm local;
  if (waktuValid(&local)) {
    uint32_t currentMonthKey = kunciBulan(local);
    if (kunciBulanTerakhir == 0) kunciBulanTerakhir = currentMonthKey;
    else if (currentMonthKey != kunciBulanTerakhir) resetEnergiBulanan(currentMonthKey);
  }

  // Akuntansi daya berjalan jika status AC menyala
  if (statusDayaDiketahui && targetDayaON) {
    float hours = elapsed / 3600000.0f;
    
    // Jika kompresor diperkirakan aktif (Mode COOL), hitung dengan DAYA_COOL_KW (633W)
    if (modeAC == kDaikin128Cool) {
      kWhCoolBulanIni += hours * DAYA_COOL_KW;
    } 
    // Jika hanya mode FAN / DRY, hitung dengan DAYA_FAN_KW (42W)
    else {
      kWhFanBulanIni += hours * DAYA_FAN_KW;
    }
  }

  if (nowMs - energySaveMs >= ENERGY_SAVE_MS) {
    energySaveMs = nowMs;
    simpanDataNVS();
  }
}

void layaniTertunda() {
  if (irTertunda && irSiap()) {
    kirimFrameIRActual(false);
    irTertunda = false;
  }
}

// ============================================================
// 12. HTTPS & EXPONENTIAL BACKOFF
// ============================================================
bool kirimPOST(JsonDocument& request, String& response) {
  if (WiFi.status() != WL_CONNECTED) return false;

  if (httpBackoffMs > 0 && millis() - waktuHttpGagalTerakhir < httpBackoffMs) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);
  if (!http.begin(client, API)) return false;

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_TOKEN);

  String payload;
  serializeJson(request, payload);
  int code = http.POST(payload);
  response = http.getString();
  http.end();

  if (code >= 200 && code < 300) {
    httpBackoffMs = 0;
    return true;
  } else {
    waktuHttpGagalTerakhir = millis();
    if (httpBackoffMs == 0) httpBackoffMs = 2000;
    else httpBackoffMs = min(httpBackoffMs * 2, 60000UL);
    return false;
  }
}

void kirimDataSensor() {
  if (!sensorSegar()) return;

  float totalKwhBulan = kWhCoolBulanIni + kWhFanBulanIni + kWhLainBulanIni;

  JsonDocument data;
  data["action"] = "sensor";
  data["device_id"] = DEVICE_ID;
  data["suhu"] = suhuKamar;
  data["kelembapan"] = kelembapanKamar;
  data["control_mode"] = modeKontrolAuto ? "auto" : "manual";
  data["desired_power"] = statusDayaDiketahui ? targetDayaON : false;
  data["ac_temp_command"] = suhuTarget;
  data["ac_mode_command"] = namaMode(modeAC);
  data["last_action"] = keputusanTerakhir;
  data["schedule"] = modeJadwal;
  data["est_kwh_bulan_ini"] = totalKwhBulan;
  data["budget_rp_bulan"] = ANGGARAN_BULAN_RP;
  data["est_biaya_bulan_ini"] = totalKwhBulan * TARIF_PER_KWH;

  String response;
  kirimPOST(data, response);
}

void isiState(JsonObject o) {
  o["power"] = statusDayaDiketahui ? targetDayaON : false;
  o["temp"] = suhuTarget;
  o["ac_mode"] = namaMode(modeAC);
  o["fan"] = namaKipas(kecepatanKipas);
  o["swing"] = swing;
  o["quiet"] = quiet;
  o["turbo"] = turbo;
  o["sleep"] = sleepMode;
  o["mode"] = modeKontrolAuto ? "auto" : "manual";
  o["sync_power"] = false;
  o["schedule"] = modeJadwal;
  
  float totalKwhBulan = kWhCoolBulanIni + kWhFanBulanIni + kWhLainBulanIni;
  float sisaKwhBulanan = TARGET_TOTAL_KWH_BULANAN - totalKwhBulan;
  if (sisaKwhBulanan < 0) sisaKwhBulanan = 0;

  

  struct tm local;
  bool NTP_OK = waktuValid(&local);

  // Ambil data dari NVS jika belum dimuat
  if (kwhTotalAwalHari < 0.0f) {
    prefs.begin("climate8", false);
    kwhTotalAwalHari = prefs.getFloat("kwhDayStart", -1.0f);
    hariTerakhir = prefs.getInt("lastDay", -1);
    prefs.end();
  }

  int hariTotal = 30;
  int hariIniMday = 1;

  if (NTP_OK) {
    hariTotal = getHariDalamBulan(local);
    hariIniMday = local.tm_mday;
  }

  float jatahKwhPerHari = TARGET_TOTAL_KWH_BULANAN / (float)hariTotal;

  // Jika tanggal berganti, atau NVS kosong/belum pernah diset, set ulang baseline awal hari
  if (!NTP_OK && kwhTotalAwalHari < 0.0f) {
    kwhTotalAwalHari = totalKwhBulan;
  } else if (NTP_OK && (hariTerakhir != hariIniMday || kwhTotalAwalHari < 0.0f)) {
    hariTerakhir = hariIniMday;
    kwhTotalAwalHari = totalKwhBulan; // Reset titik awal kWh khusus hari ini
    
    prefs.begin("climate8", false);
    prefs.putFloat("kwhDayStart", kwhTotalAwalHari);
    prefs.putInt("lastDay", hariTerakhir);
    prefs.end();
  }

  // Hitung murni pemakaian hari ini
  float kwhTerpakaiHariIni = totalKwhBulan - kwhTotalAwalHari;
  if (kwhTerpakaiHariIni < 0) {
    // Antisipasi jika terjadi reset kWh bulanan / anomali
    kwhTerpakaiHariIni = 0;
    kwhTotalAwalHari = totalKwhBulan;
  }

  float sisaKwhHarian = jatahKwhPerHari - kwhTerpakaiHariIni;
  if (sisaKwhHarian < 0) sisaKwhHarian = 0;

  o["est_kwh_bulan_ini"] = totalKwhBulan;
  o["est_biaya_bulan_ini"] = totalKwhBulan * TARIF_PER_KWH;
  o["budget_rp_bulan"] = ANGGARAN_BULAN_RP;
  o["sisa_kwh_bulanan"] = sisaKwhBulanan;
  o["sisa_biaya_bulanan"] = sisaKwhBulanan * TARIF_PER_KWH;
  o["sisa_kwh_harian"] = sisaKwhHarian;
  o["sisa_biaya_harian"] = sisaKwhHarian * TARIF_PER_KWH;
}
void terapkanStateCloud(JsonObject s, bool kirimIR) {
  long incomingRev = s["rev"] | revTerakhir;
  if (incomingRev < revTerakhir) return;
  revTerakhir = incomingRev;

  // --- TAMBAHKAN BLOK INI AGAR TIDAK MENGIRIM IR SAAT RESET ---
  if (s["reset_kwh"].is<bool>() && s["reset_kwh"].as<bool>()) {
    kWhCoolBulanIni = 0.0f;
    kWhFanBulanIni = 0.0f;
    kWhLainBulanIni = 0.0f;
    kwhTotalAwalHari = -1.0f; 
    simpanDataNVS();
    perluLapor = true;
    Serial.println("[RESET] Data kWh bulanan berhasil di-reset via Cloud Web!");
    return; // Langsung keluar, TIDAK mengeksekusi IR!
  }
  // -----------------------------------------------------------

  bool dayaTujuan = targetDayaON;
  uint8_t modeTujuan = modeAC;
  uint8_t tempTujuan = suhuTarget;
  uint8_t fanTujuan = kecepatanKipas;
  bool swingTujuan = swing;
  bool quietTujuan = quiet;
  bool turboTujuan = turbo;
  bool sleepTujuan = sleepMode;

  if (s["mode"].is<const char*>()) {
    String m = s["mode"].as<String>();
    m.trim(); m.toLowerCase();
    if (m == "auto" || m == "manual") {
      modeKontrolAuto = (m == "auto");
    }
  }

  if (s["temp"].is<int>()) {
    int t = s["temp"].as<int>();
    if (t >= 16 && t <= 30) tempTujuan = t;
  }
  if (s["ac_mode"].is<const char*>()) {
    modeTujuan = konversiMode(s["ac_mode"].as<String>());
  }
  if (s["fan"].is<const char*>()) {
    fanTujuan = konversiKipas(s["fan"].as<String>());
  }
  if (s["swing"].is<bool>()) swingTujuan = s["swing"];
  if (s["quiet"].is<bool>()) quietTujuan = s["quiet"];
  if (s["turbo"].is<bool>()) turboTujuan = s["turbo"];
  if (s["sleep"].is<bool>()) sleepTujuan = s["sleep"];

  if (!modeKontrolAuto && s["power"].is<bool>()) {
    bool p = s["power"].as<bool>();
    bool syncManual = s["sync_power"].is<bool>() && s["sync_power"].as<bool>();
    if (!statusDayaDiketahui || syncManual) {
      statusDayaDiketahui = true;
      targetDayaON = p;
      kompresorDiperkirakanAktif = p && (modeAC == kDaikin128Cool);
      timerDayaDiinisialisasi = true;
      if (p) waktuMulaiDayaON = millis();
      else waktuMulaiDayaOFF = millis();
      perluLapor = true;
      simpanDataNVS();
    } else {
      dayaTujuan = p;
    }
  }

  eksekusiPengaturanAC(dayaTujuan, modeTujuan, tempTujuan, fanTujuan, 
                       swingTujuan, quietTujuan, turboTujuan, sleepTujuan, kirimIR);
}

bool laporStatus() {
  JsonDocument req;
  req["action"] = "report_state";
  req["device_id"] = DEVICE_ID;
  req["base_rev"] = revTerakhir;
  JsonObject state = req["state"].to<JsonObject>();
  isiState(state);

  String response;
  if (!kirimPOST(req, response)) return false;

  JsonDocument d;
  if (deserializeJson(d, response)) return false;

  if (d["conflict"] | false) {
    if (d["state"].is<JsonObject>()) {
      terapkanStateCloud(d["state"].as<JsonObject>(), false);
    }
    perluLapor = false;
    return true;
  }

  if (d["rev"].is<long>()) revTerakhir = d["rev"].as<long>();
  perluLapor = false;
  return true;
}

void pollingPerintah() {
  if (perluLapor) return;

  JsonDocument request;
  request["action"] = "get_state";
  request["device_id"] = DEVICE_ID;
  request["since_rev"] = revTerakhir;

  String response;
  if (!kirimPOST(request, response)) return;

  JsonDocument data;
  if (deserializeJson(data, response)) return;
  if (!data["state"].is<JsonObject>()) return;

  JsonObject s = data["state"].as<JsonObject>();
  long rev = s["rev"] | 0L;
  if (rev <= revTerakhir) return;

  terapkanStateCloud(s, sinkronAwal);
  sinkronAwal = true;
}

// ============================================================
// 13. WEATHER
// ============================================================
bool perbaruiCuaca() {
  if (WiFi.status() != WL_CONNECTED) return false;

  String url = "https://api.open-meteo.com/v1/forecast?latitude=-7.5755&longitude=110.8243&current=temperature_2m,relative_humidity_2m&timezone=Asia%2FJakarta";
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(8000);
  if (!http.begin(client, url)) return false;

  int code = http.GET();
  String response = http.getString();
  http.end();
  if (code != 200) return false;

  JsonDocument data;
  if (deserializeJson(data, response)) return false;
  if (data["current"]["temperature_2m"].isNull()) return false;

  suhuLuar = data["current"]["temperature_2m"].as<float>();
  rhLuar = data["current"]["relative_humidity_2m"] | NAN;
  cuacaValid = !isnan(suhuLuar);
  waktuCuaca = millis();
  return cuacaValid;
}

// ============================================================
// 14. AUTO CONTROL V8
// ============================================================
float targetAdaptifSiang() {
  bool panasKamar = sensorSegar() && suhuKamar >= SUHU_KAMAR_PANAS;
  bool panasLuar = cuacaValid && (millis() - waktuCuaca < 3600000UL) &&
                   suhuLuar >= SUHU_LUAR_PANAS;
  return (panasKamar || panasLuar) ? TARGET_SIANG_PANAS : TARGET_SIANG_NORMAL;
}

void kontrolOtomatis() {
  if (!modeKontrolAuto) return;

  if (!statusDayaDiketahui) {
    keputusanTerakhir = "AUTO ditahan: Status daya fisik AC UNKNOWN (Lakukan SYNC ON/OFF)";
    return;
  }
  if (!sensorSegar()) {
    keputusanTerakhir = "AUTO ditahan: Sensor DHT22 tidak segar atau terputus";
    return;
  }

  struct tm local;
  bool clockOk = waktuValid(&local);
  
  if (!clockOk) {
    modeJadwal = "fallback_safe";
    eksekusiPengaturanAC(targetDayaON, kDaikin128Cool, 26, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
    keputusanTerakhir = "Fallback Mode: Menunggu Sinkronisasi Jam NTP";
    return;
  }

  bool malam = dalamJadwalMalam(local);
  modeJadwal = malam ? "night_eco" : "day_comfort";

  float totalKwhBulanIni = kWhCoolBulanIni + kWhFanBulanIni + kWhLainBulanIni;
  float totalBiayaBulanIni = totalKwhBulanIni * TARIF_PER_KWH;
  
  int hariTotal = getHariDalamBulan(local);
  int hariBerjalan = max(1, (int)local.tm_mday);
  
  float rataBiayaHarian = totalBiayaBulanIni / (float)hariBerjalan;
  float proyeksiBiayaAkhirBulan = rataBiayaHarian * (float)hariTotal;
  
  bool anggaranKritis = proyeksiBiayaAkhirBulan > (ANGGARAN_BULAN_RP * 0.95f) || totalBiayaBulanIni >= (ANGGARAN_BULAN_RP * 0.92f);
  bool anggaranHabis = totalBiayaBulanIni >= ANGGARAN_BULAN_RP;

  if (anggaranHabis) {
    eksekusiPengaturanAC(false, modeAC, suhuTarget, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
    keputusanTerakhir = "DARURAT: Anggaran Rp100k bulanan tercapai! AC dimatikan.";
    return;
  }

  if (malam) {
    if (anggaranKritis) {
      eksekusiPengaturanAC(targetDayaON, kDaikin128Fan, 27, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
      if (suhuKamar > 28.5f && targetDayaON) {
        eksekusiPengaturanAC(false, kDaikin128Fan, 27, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
      }
      keputusanTerakhir = "Night Eco: Anggaran kritis, membatasi operasional malam";
      return;
    }

    if (suhuKamar >= TARGET_MALAM_COOL_ON) {
      eksekusiPengaturanAC(true, kDaikin128Cool, 27, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
      keputusanTerakhir = "Night Eco: Terlalu panas; meminta mode COOL";
    } else if (suhuKamar <= TARGET_MALAM_FAN_BACK) {
      eksekusiPengaturanAC(true, kDaikin128Fan, 27, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
      keputusanTerakhir = "Night Eco: FAN default; suhu kamar cukup nyaman";
    }
  } else {
    float target = targetAdaptifSiang();

    if (anggaranKritis) {
      eksekusiPengaturanAC(targetDayaON, kDaikin128Fan, (uint8_t)target, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
      keputusanTerakhir = "Siang Comfort: Anggaran kritis, beralih ke FAN untuk sisa bulan";
      return;
    }

    bool perluCool = suhuKamar >= target + 1.0f || (kelembapanKamar >= 80.0f && suhuKamar > target + 0.5f);
    bool targetTercapai = suhuKamar <= target;

    if (!targetDayaON) {
      if (perluCool) {
        eksekusiPengaturanAC(true, kDaikin128Cool, (uint8_t)target, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
        keputusanTerakhir = "Siang Comfort: Meminta COOL; menjaga kesejukan ruangan";
      } else {
        keputusanTerakhir = "Siang Comfort: Suhu kamar masih cukup nyaman";
      }
    } else {
      if (targetTercapai) {
        eksekusiPengaturanAC(true, kDaikin128Fan, (uint8_t)target, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
        keputusanTerakhir = "Siang Comfort: Target tercapai; beralih ke FAN hemat";
      } else {
        eksekusiPengaturanAC(true, kDaikin128Cool, (uint8_t)target, kecepatanKipas, swing, quiet, turbo, sleepMode, false);
        keputusanTerakhir = "Siang Comfort: COOL aktif mendinginkan ruangan";
      }
    }
  }
}

// ============================================================
// 15. SERIAL COMMANDS
// ============================================================
void cetakStatus() {
  float totalKwh = kWhCoolBulanIni + kWhFanBulanIni + kWhLainBulanIni;
  // AMBIL WAKTU LOKAL TERKINI
  struct tm local;
  bool clockOk = waktuValid(&local);
  Serial.println("\n--- SMART CLIMATE CONTROL V8 (FINAL STATUS) ---"); 
  // TAMPILKAN JAM DAN TANGGAL
  if (clockOk) {
    Serial.printf("Waktu Sistem     : %02d-%02d-%d %02d:%02d:%02d WIB (NTP Sinkron)\n",
                  local.tm_mday, local.tm_mon + 1, local.tm_year + 1900,
                  local.tm_hour, local.tm_min, local.tm_sec);
  } else {
    Serial.println("Waktu Sistem     : BELUM SINKRON (Menunggu NTP / 1970)");
  }
  Serial.printf("Suhu kamar       : %.2f C\n", suhuKamar);
  Serial.printf("RH kamar         : %.1f %%\n", kelembapanKamar);
  Serial.printf("Suhu luar        : %.1f C\n", suhuLuar);
  Serial.printf("Mode kontrol     : %s\n", modeKontrolAuto ? "AUTO" : "MANUAL");
  Serial.printf("Jadwal           : %s\n", modeJadwal.c_str());
  Serial.printf("Daya diketahui   : %s\n", statusDayaDiketahui ? "YA" : "TIDAK");
  Serial.printf("Perintah daya    : %s\n", targetDayaON ? "ON" : "OFF");
  Serial.printf("Mode AC          : %s\n", namaMode(modeAC).c_str());
  Serial.printf("Target suhu      : %u C\n", suhuTarget);
  Serial.printf("Total kWh Bulan  : %.3f kWh (Software Estimation)\n", totalKwh);
  Serial.printf("Biaya Aktual     : Rp %.0f / Rp %.0f\n", totalKwh * TARIF_PER_KWH, ANGGARAN_BULAN_RP);
  Serial.printf("Keputusan        : %s\n", keputusanTerakhir.c_str());
  Serial.println("----------------------------------------------\n");
}

void prosesSerial() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  String upper = cmd;
  upper.toUpperCase();

  if (upper == "STATUS") {
    cetakStatus();
    return;
  }

  if (upper == "RESET KWH") {
    kWhCoolBulanIni = 0.0f;
    kWhFanBulanIni = 0.0f;
    kWhLainBulanIni = 0.0f;
    simpanDataNVS();
    perluLapor = true;
    Serial.println("[RESET] Data kWh bulanan berhasil di-reset ke 0.");
    return;
  }

  if (upper == "SYNC ON" || upper == "SYNC OFF") {
    statusDayaDiketahui = true;
    targetDayaON = (upper == "SYNC ON");
    timerDayaDiinisialisasi = true;
    if (targetDayaON) {
      waktuMulaiDayaON = millis();
      kompresorDiperkirakanAktif = (modeAC == kDaikin128Cool);
    } else {
      waktuMulaiDayaOFF = millis();
      kompresorDiperkirakanAktif = false;
    }
    irTertunda = false;
    perluLapor = true;
    simpanDataNVS();
    Serial.printf("[SYNC] Status daya diasumsikan %s; tidak mengirim IR.\n", targetDayaON ? "ON" : "OFF");
    return;
  }

  if (upper == "POWER ON" || upper == "POWER OFF") {
    modeKontrolAuto = false;
    eksekusiPengaturanAC(upper == "POWER ON", modeAC, suhuTarget, kecepatanKipas, swing, quiet, turbo, sleepMode, true);
    return;
  }

  if (upper == "AUTO") {
    modeKontrolAuto = true;
    simpanDataNVS();
    perluLapor = true;
    Serial.println("[MODE] AUTO aktif.");
    return;
  }

  if (upper == "MANUAL") {
    modeKontrolAuto = false;
    simpanDataNVS();
    perluLapor = true;
    Serial.println("[MODE] MANUAL aktif.");
    return;
  }

  if (upper.startsWith("TEMP ")) {
    int t = cmd.substring(5).toInt();
    if (t >= 16 && t <= 30) {
      eksekusiPengaturanAC(targetDayaON, modeAC, (uint8_t)t, kecepatanKipas, swing, quiet, turbo, sleepMode, true);
    } else {
      Serial.println("Target suhu harus 16–30 C.");
    }
    return;
  }

  if (upper == "FAN") {
    eksekusiPengaturanAC(targetDayaON, kDaikin128Fan, suhuTarget, kecepatanKipas, swing, quiet, turbo, sleepMode, true);
    return;
  }

  if (upper == "COOL") {
    eksekusiPengaturanAC(targetDayaON, kDaikin128Cool, suhuTarget, kecepatanKipas, swing, quiet, turbo, sleepMode, true);
    return;
  }

  // ============================================================
  // PERINTAH BARU UNTUK KIPAS, SWING, QUIET, TURBO, SLEEP
  // ============================================================

  // 1. Pengaturan Kecepatan Kipas
  if (upper == "FAN AUTO" || upper == "FAN LOW" || upper == "FAN MED" || upper == "FAN HIGH") {
    uint8_t fanBaru = kecepatanKipas;
    if (upper == "FAN AUTO") fanBaru = kDaikin128FanAuto;
    else if (upper == "FAN LOW") fanBaru = kDaikin128FanLow;
    else if (upper == "FAN MED") fanBaru = kDaikin128FanMed;
    else if (upper == "FAN HIGH") fanBaru = kDaikin128FanHigh;

    eksekusiPengaturanAC(targetDayaON, modeAC, suhuTarget, fanBaru, swing, quiet, turbo, sleepMode, true);
    Serial.printf("[FAN] Kipas diubah ke: %s\n", namaKipas(fanBaru).c_str());
    return;
  }

  // 2. Pengaturan Swing Vertical
  if (upper == "SWING ON" || upper == "SWING OFF") {
    bool swingBaru = (upper == "SWING ON");
    eksekusiPengaturanAC(targetDayaON, modeAC, suhuTarget, kecepatanKipas, swingBaru, quiet, turbo, sleepMode, true);
    Serial.printf("[SWING] Swing vertical: %s\n", swingBaru ? "ON" : "OFF");
    return;
  }

  // 3. Pengaturan Quiet Mode (Mode Hening)
  if (upper == "QUIET ON" || upper == "QUIET OFF") {
    bool quietBaru = (upper == "QUIET ON");
    eksekusiPengaturanAC(targetDayaON, modeAC, suhuTarget, kecepatanKipas, swing, quietBaru, turbo, sleepMode, true);
    Serial.printf("[QUIET] Mode Quiet: %s\n", quietBaru ? "ON" : "OFF");
    return;
  }

  // 4. Pengaturan Turbo / Powerful Mode
  if (upper == "TURBO ON" || upper == "TURBO OFF") {
    bool turboBaru = (upper == "TURBO ON");
    eksekusiPengaturanAC(targetDayaON, modeAC, suhuTarget, kecepatanKipas, swing, quiet, turboBaru, sleepMode, true);
    Serial.printf("[TURBO] Mode Powerful/Turbo: %s\n", turboBaru ? "ON" : "OFF");
    return;
  }

  // 5. Pengaturan Sleep Mode
  if (upper == "SLEEP ON" || upper == "SLEEP OFF") {
    bool sleepBaru = (upper == "SLEEP ON");
    eksekusiPengaturanAC(targetDayaON, modeAC, suhuTarget, kecepatanKipas, swing, quiet, turbo, sleepBaru, true);
    Serial.printf("[SLEEP] Mode Sleep: %s\n", sleepBaru ? "ON" : "OFF");
    return;
  }

  Serial.println("Perintah tidak dikenal!");
  Serial.println("Daftar perintah:");
  Serial.println(" - POWER ON / POWER OFF");
  Serial.println(" - AUTO / MANUAL");
  Serial.println(" - TEMP 16-30");
  Serial.println(" - COOL / FAN");
  Serial.println(" - FAN AUTO / FAN LOW / FAN MED / FAN HIGH");
  Serial.println(" - SWING ON / SWING OFF");
  Serial.println(" - QUIET ON / QUIET OFF");
  Serial.println(" - TURBO ON / TURBO OFF");
  Serial.println(" - SLEEP ON / SLEEP OFF");
  Serial.println(" - SYNC ON / SYNC OFF");
  Serial.println(" - RESET KWH");
  Serial.println(" - STATUS");
}

// ============================================================
// 16. SETUP & LOOP
// ============================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.setTimeout(50);

  dht.begin();
  ac.begin();
  muatDataNVS();

  // PERBAIKAN: Jika status daya belum pernah disync atau tersimpan di NVS, 
  // set default ke true agar perintah kontrol langsung bisa dieksekusi.
  if (!statusDayaDiketahui) {
    statusDayaDiketahui = true;
    targetDayaON = false; // Asumsi awal AC dalam keadaan mati (OFF) saat ESP menyala
    timerDayaDiinisialisasi = true;
    waktuMulaiDayaOFF = millis();
  }

  configTzTime("WIB-7", "pool.ntp.org", "time.google.com");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  if (String(WIFI_SSID) != "YOUR_WIFI_SSID") {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  } else {
    Serial.println("[CONFIG] Isi WIFI_SSID dan WIFI_PASSWORD terlebih dahulu.");
  }

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 10000UL) {
    delay(250);
  }

  timerSensor = millis() - READ_INTERVAL;
  timerPost = millis();
  timerPoll = millis() - POLL_INTERVAL;
  timerLapor = millis();
  timerCuaca = millis() - WEATHER_INTERVAL;
  timerAuto = millis();
  timerWiFi = millis();
  energyTickMs = millis();
  energySaveMs = millis();

  Serial.println("\n[SYSTEM] Smart Climate Control V8 Final Ready.");
  Serial.printf("Target anggaran bulanan: Rp%.0f; target total kWh: %.2f kWh.\n",
                ANGGARAN_BULAN_RP, TARGET_TOTAL_KWH_BULANAN);
  Serial.println("Sistem siap. Ketik STATUS, AUTO, MANUAL, atau TEMP [16-30] di Serial Monitor."); // <-- DIUBAH
}

void loop() {
  prosesSerial();
  layaniTertunda();

  unsigned long now = millis();

  // Pemicu agar ESP32 rutin melapor ke Supabase tiap 15 detik
  static unsigned long timerDorongLaporan = 0;
  if (now - timerDorongLaporan >= 15000UL) {
    timerDorongLaporan = now;
    perluLapor = true; 
  }

  if (WiFi.status() != WL_CONNECTED && now - timerWiFi >= WIFI_INTERVAL) {
    timerWiFi = now;
    WiFi.reconnect();
  }

  if (now - timerSensor >= READ_INTERVAL) {
    timerSensor = now;
    bacaSensor();
  }

  perbaruiEnergi();

  if (perluLapor && WiFi.status() == WL_CONNECTED &&
      now - timerLapor >= LAPOR_INTERVAL) {
    timerLapor = now;
    laporStatus();
  }

  if (WiFi.status() == WL_CONNECTED && now - timerPost >= POST_INTERVAL) {
    timerPost = now;
    kirimDataSensor();
  }

  if (WiFi.status() == WL_CONNECTED && now - timerPoll >= POLL_INTERVAL) {
    timerPoll = now;
    pollingPerintah();
  }

  if (WiFi.status() == WL_CONNECTED && now - timerCuaca >= WEATHER_INTERVAL) {
    timerCuaca = now;
    perbaruiCuaca();
  }

  if (now - timerAuto >= AUTO_INTERVAL) {
    timerAuto = now;
    kontrolOtomatis();
  }

  delay(2);
}