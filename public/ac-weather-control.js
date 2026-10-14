(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const state = {
    power: false, mode: "cool", temp: 24, fan: "auto",
    swing: true, control: "manual"
  };

  function init() {
    if ($("smart-ac")) return;
    const main = document.querySelector("main") || document.body;
    const panel = document.createElement("section");
    panel.id = "smart-ac";
    panel.className = "smart-dashboard";
    panel.innerHTML = `
      <div class="smart-head">
        <div>
          <p class="eyebrow">SMART CLIMATE</p>
          <h2>Kontrol AC</h2>
          <p class="smart-sub">Daikin · Kontrol ruangan</p>
        </div>
        <span id="ac-state-badge" class="ac-badge">OFF</span>
      </div>

      <div class="ac-main-card">
        <div class="ac-power-row">
          <div>
            <span class="muted-label">Status AC</span>
            <div id="ac-power-label" class="ac-power-label">Mati</div>
          </div>
          <button id="ac-power" class="power-button" aria-pressed="false" type="button">
            <span class="power-symbol">⏻</span><span id="ac-power-text">Nyalakan</span>
          </button>
        </div>

        <div class="ac-temp-control">
          <button id="ac-minus" class="round-button" aria-label="Kurangi suhu" type="button">−</button>
          <div class="setpoint">
            <div><strong id="ac-temp">24</strong><span>°C</span></div>
            <small>Suhu target</small>
          </div>
          <button id="ac-plus" class="round-button" aria-label="Tambah suhu" type="button">+</button>
        </div>

        <div class="ac-control-label">Mode operasi</div>
        <div class="ac-button-grid" id="ac-modes">
          <button class="choice-button selected" data-mode="cool" type="button"><span>❄</span> Cool</button>
          <button class="choice-button" data-mode="dry" type="button"><span>◉</span> Dry</button>
          <button class="choice-button" data-mode="fan" type="button"><span>≋</span> Fan</button>
          <button class="choice-button" data-mode="auto" type="button"><span>⟳</span> Auto</button>
        </div>

        <div class="ac-options">
          <div>
            <div class="ac-control-label">Kecepatan kipas</div>
            <div class="fan-options" id="ac-fans">
              <button class="mini-choice" data-fan="quiet" type="button">Quiet</button>
              <button class="mini-choice" data-fan="low" type="button">Low</button>
              <button class="mini-choice" data-fan="medium" type="button">Med</button>
              <button class="mini-choice" data-fan="high" type="button">High</button>
              <button class="mini-choice selected" data-fan="auto" type="button">Auto</button>
            </div>
          </div>
          <button id="ac-swing" class="swing-button selected" type="button" aria-pressed="true">
            ↕ <span>Swing aktif</span>
          </button>
        </div>
      </div>

      <div class="ac-automation">
        <div>
          <p class="eyebrow">PENGATURAN CERDAS</p>
          <h3>Auto Adaptive</h3>
          <p class="smart-sub">Penyesuaian berdasarkan suhu kamar dan cuaca luar.</p>
        </div>
        <button id="ac-auto" class="toggle-button" role="switch" aria-checked="false" type="button">
          <span></span>
        </button>
      </div>
      <p id="ac-feedback" class="ac-feedback" role="status">
        Tampilan siap. Kontrol fisik AC belum terhubung ke firmware.
      </p>

      <div class="weather-heading">
        <div>
          <p class="eyebrow">OPEN-METEO · SURAKARTA</p>
          <h2>Cuaca di luar</h2>
        </div>
        <span id="weather-indicator" class="weather-indicator">Memuat...</span>
      </div>

      <div class="weather-grid">
        <article class="weather-card outdoor">
          <span class="weather-icon">☀</span>
          <span class="muted-label">Suhu luar</span>
          <div class="weather-value"><strong id="out-temp">--</strong><span>°C</span></div>
          <p id="out-condition">Mengambil data cuaca</p>
        </article>
        <article class="weather-card">
          <span class="weather-icon">◌</span>
          <span class="muted-label">Kelembapan luar</span>
          <div class="weather-value"><strong id="out-hum">--</strong><span>%</span></div>
          <p>Kelembapan relatif</p>
        </article>
      </div>

      <div class="comparison-card">
        <div class="comparison-title">
          <div><p class="eyebrow">PERBANDINGAN</p><h3>Kamar vs luar</h3></div>
          <span id="compare-badge" class="compare-badge">Menunggu data</span>
        </div>
        <div class="compare-values">
          <div><span>Kamar · DHT22</span><strong id="compare-in">-- °C</strong></div>
          <div><span>Luar · Open-Meteo</span><strong id="compare-out">-- °C</strong></div>
        </div>
        <div class="delta-line"><span>Selisih suhu</span><strong id="compare-delta">--</strong></div>
        <p id="compare-note" class="smart-sub">Perbandingan muncul saat kedua sumber memiliki data valid.</p>
        <p id="weather-time" class="weather-time">Pembaruan: menunggu data</p>
      </div>
    `;
    main.appendChild(panel);

    function feedback(message) {
      $("ac-feedback").textContent = message;
    }

    function render() {
      $("ac-temp").textContent = state.temp;
      $("ac-power-label").textContent = state.power ? "Menyala" : "Mati";
      $("ac-power-text").textContent = state.power ? "Matikan" : "Nyalakan";
      $("ac-power").setAttribute("aria-pressed", String(state.power));
      $("ac-power").classList.toggle("is-on", state.power);
      $("ac-state-badge").textContent = state.power ? "ON" : "OFF";
      $("ac-state-badge").classList.toggle("is-on", state.power);
      document.querySelectorAll("[data-mode]").forEach(b =>
        b.classList.toggle("selected", b.dataset.mode === state.mode));
      document.querySelectorAll("[data-fan]").forEach(b =>
        b.classList.toggle("selected", b.dataset.fan === state.fan));
      $("ac-swing").classList.toggle("selected", state.swing);
      $("ac-swing").setAttribute("aria-pressed", String(state.swing));
      $("ac-swing").querySelector("span").textContent =
        state.swing ? "Swing aktif" : "Swing mati";
      $("ac-auto").classList.toggle("active", state.control === "auto_adaptive");
      $("ac-auto").setAttribute("aria-checked", String(state.control === "auto_adaptive"));
    }

    $("ac-power").addEventListener("click", () => {
      state.power = !state.power;
      render();
      feedback("Pilihan daya berubah di tampilan. Belum dikirim ke AC: integrasi ESP32/IR belum tersedia.");
    });
    $("ac-minus").addEventListener("click", () => {
      state.temp = Math.max(18, state.temp - 1);
      render();
      feedback("Target suhu dipilih: " + state.temp + " °C. Perintah fisik belum dikirim.");
    });
    $("ac-plus").addEventListener("click", () => {
      state.temp = Math.min(30, state.temp + 1);
      render();
      feedback("Target suhu dipilih: " + state.temp + " °C. Perintah fisik belum dikirim.");
    });
    document.querySelectorAll("[data-mode]").forEach(b =>
      b.addEventListener("click", () => {
        state.mode = b.dataset.mode;
        render();
        feedback("Mode " + b.textContent.trim() + " dipilih. Perintah fisik belum dikirim.");
      }));
    document.querySelectorAll("[data-fan]").forEach(b =>
      b.addEventListener("click", () => {
        state.fan = b.dataset.fan;
        render();
        feedback("Kipas " + state.fan + " dipilih. Perintah fisik belum dikirim.");
      }));
    $("ac-swing").addEventListener("click", () => {
      state.swing = !state.swing;
      render();
      feedback("Swing " + (state.swing ? "aktif" : "mati") + " pada tampilan. Belum dikirim ke AC.");
    });
    $("ac-auto").addEventListener("click", () => {
      state.control = state.control === "manual" ? "auto_adaptive" : "manual";
      render();
      feedback(state.control === "auto_adaptive"
        ? "Auto Adaptive dipilih. Otomatisasi fisik belum aktif sebelum backend dan firmware terhubung."
        : "Mode Manual dipilih. Perubahan ini belum dikirim ke AC.");
    });

    function compare() {
      const roomEl = $("temperature");
      const room = roomEl ? Number(roomEl.textContent) : NaN;
      const outside = Number($("out-temp").dataset.value);
      const validRoom = roomEl && roomEl.textContent.trim() !== "--" && Number.isFinite(room);
      const validOutside = Number.isFinite(outside);
      $("compare-in").textContent = validRoom ? room.toFixed(1) + " °C" : "-- °C";
      $("compare-out").textContent = validOutside ? outside.toFixed(1) + " °C" : "-- °C";
      if (!validRoom || !validOutside) {
        $("compare-delta").textContent = "--";
        $("compare-badge").textContent = "Menunggu data";
        $("compare-note").textContent = "Pastikan sensor kamar online dan data cuaca tersedia.";
        return;
      }
      const delta = room - outside;
      $("compare-delta").textContent =
        (delta > 0 ? "+" : "") + delta.toFixed(1) + " °C";
      $("compare-badge").textContent =
        Math.abs(delta) < 0.5 ? "Hampir sama" : delta > 0 ? "Kamar lebih panas" : "Luar lebih panas";
      $("compare-note").textContent = delta > 0
        ? "Suhu kamar lebih tinggi daripada suhu luar."
        : delta < 0 ? "Suhu kamar lebih rendah daripada suhu luar."
        : "Suhu kamar dan luar hampir sama.";
    }

    async function loadWeather() {
      $("weather-indicator").textContent = "Memperbarui...";
      try {
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.search = new URLSearchParams({
          latitude: "-7.5755",
          longitude: "110.8243",
          current: "temperature_2m,relative_humidity_2m,weather_code",
          timezone: "Asia/Jakarta"
        });
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        const c = data.current;
        if (!c || !Number.isFinite(c.temperature_2m) ||
            !Number.isFinite(c.relative_humidity_2m)) throw new Error("Data tidak valid");
        $("out-temp").textContent = c.temperature_2m.toFixed(1);
        $("out-temp").dataset.value = String(c.temperature_2m);
        $("out-hum").textContent = c.relative_humidity_2m;
        $("out-condition").textContent = "Suhu udara 2 meter";
        $("weather-indicator").textContent = "● Live";
        $("weather-time").textContent = "Data cuaca: " +
          new Date(c.time).toLocaleString("id-ID", {
            timeZone: "Asia/Jakarta", day: "2-digit", month: "short",
            hour: "2-digit", minute: "2-digit"
          }) + " WIB · cek tiap 60 detik";
        compare();
      } catch (err) {
        $("weather-indicator").textContent = "Tidak tersedia";
        $("out-condition").textContent = "Gagal mengambil data cuaca";
        $("weather-time").textContent = "Pembaruan gagal. Akan dicoba kembali.";
        console.error("Open-Meteo:", err);
      }
    }

    const roomObserver = new MutationObserver(compare);
    const roomTemp = $("temperature");
    if (roomTemp) roomObserver.observe(roomTemp, { childList: true, characterData: true, subtree: true });

    render();
    loadWeather();
    setInterval(loadWeather, 60 * 1000);
    setInterval(compare, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else init();
})();
