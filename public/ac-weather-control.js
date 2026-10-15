(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const state = {
    power: false, mode: "cool", temp: 24, acTempCommand: null,
    fan: "auto", swing: true, quiet: false, turbo: false,
    sleep: false, econo: false, control: "manual"
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

        <div class="ac-command-temperature" style="display:flex;flex-direction:column;gap:5px;margin:0 16px 16px;padding:12px 14px;border:1px solid var(--border-color,#dedede);border-radius:12px">
          <span class="muted-label">Suhu perintah AC</span>
          <strong id="ac-temp-command" style="font-size:24px;font-weight:600">Belum tersedia</strong>
          <small id="ac-temp-command-note" style="font-size:12px;opacity:.75">Menunggu laporan terbaru dari ESP32</small>
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
              <button class="mini-choice" data-fan="low" type="button">Low</button>
              <button class="mini-choice" data-fan="medium" type="button">Med</button>
              <button class="mini-choice" data-fan="high" type="button">High</button>
              </div>
            <div class="fan-options ac-feature-options" aria-label="Fitur AC">
              <button class="mini-choice" data-feature="quiet" type="button" aria-pressed="false">Quiet</button>
              <button class="mini-choice" data-feature="turbo" type="button" aria-pressed="false">Turbo</button>
              <button class="mini-choice" data-feature="econo" type="button" aria-pressed="false">Econo</button>
              <button class="mini-choice" data-feature="sleep" type="button" aria-pressed="false">Sleep</button>
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

    async function sendACCommand() {
      const mode = state.control === "manual" ? "manual" : "auto";
      const acMode = ["cool", "dry", "fan", "heat"].includes(state.mode)
        ? state.mode : "cool";
      const fan = state.fan === "medium" ? "med" :
        (["auto", "low", "med", "high"].includes(state.fan) ? state.fan : "auto");

      const payload = {
        power: Boolean(state.power),
        mode,
        temp: Math.max(16, Math.min(30, Number(state.temp) || 27)),
        ac_mode: acMode,
        fan,
        swing: Boolean(state.swing),
        quiet: Boolean(state.quiet),
        turbo: Boolean(state.turbo),
        sleep: Boolean(state.sleep),
        econo: Boolean(state.econo)
      };

      try {
        const response = await fetch("/api/ac-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Permintaan gagal");
        feedback("Perintah tersimpan di Supabase. ID: " +
          (result.command_id ?? "tersimpan") +
          ". Pengiriman IR dan respons fisik AC belum terkonfirmasi.");
        return true;
      } catch (error) {
        feedback("Gagal mengirim perintah: " + error.message);
        return false;
      }
    }
    async function loadACState() {
      try {
        const response = await fetch("/api/ac-state", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const result = await response.json();
        const a = result && result.state;
        const deviceOnline = Boolean(result && result.device && result.device.online);
        if (!a) {
          feedback("Status AC belum tersedia; ESP32 belum dapat dipastikan online.");
          return;
        }

        if (typeof a.power === "boolean") state.power = a.power;
        if (Number.isFinite(Number(a.temp)) && a.temp !== null && a.temp !== undefined)
        state.temp = Number(a.temp);

      if (a.ac_temp_command !== null && a.ac_temp_command !== undefined &&
          Number.isInteger(Number(a.ac_temp_command)) &&
          Number(a.ac_temp_command) >= 16 && Number(a.ac_temp_command) <= 30) {
        state.acTempCommand = Number(a.ac_temp_command);
      } else {
        state.acTempCommand = null;
      }
        if (["cool", "dry", "fan", "heat"].includes(a.ac_mode)) {
          state.mode = a.ac_mode;
        }
        if (["auto", "low", "med", "medium", "high"].includes(a.fan)) {
          state.fan = a.fan === "medium" ? "med" : a.fan;
        }
        for (const key of ["quiet", "turbo", "sleep", "econo", "swing"]) {
          if (typeof a[key] === "boolean") state[key] = a[key];
        }
        if (a.mode === "manual") state.control = "manual";
        else if (a.mode === "auto" || a.mode === "auto_adaptive") {
          state.control = "auto_adaptive";
        }

        render();
        feedback(deviceOnline ? "ESP32 ONLINE — status dibaca dari Supabase." : "ESP32 OFFLINE — data terakhir mungkin sudah lama. Periksa perangkat dan koneksi.");
      } catch (error) {
        feedback("Status AC gagal dibaca: " + error.message);
      }
    }
    function render() {
      $("ac-temp").textContent = state.temp;

    const commandEl = $("ac-temp-command");
    const commandNoteEl = $("ac-temp-command-note");
    if (commandEl && commandNoteEl) {
      if (state.acTempCommand === null) {
        commandEl.textContent = "Belum tersedia";
        commandNoteEl.textContent = "Menunggu laporan terbaru dari ESP32";
      } else {
        commandEl.textContent = state.acTempCommand + " °C";
        commandNoteEl.textContent =
          state.acTempCommand < state.temp
            ? "Pendinginan dipercepat oleh kontrol adaptif"
            : state.acTempCommand > state.temp
              ? "Suhu perintah berbeda dari target pengguna"
              : "Suhu perintah sama dengan target pengguna";
      }
    }
      $("ac-power-label").textContent = state.power ? "Menyala" : "Mati";
      $("ac-power-text").textContent = state.power ? "Matikan" : "Nyalakan";
      $("ac-power").setAttribute("aria-pressed", String(state.power));
      $("ac-power").classList.toggle("is-on", state.power);
      $("ac-state-badge").textContent = state.power ? "ON" : "OFF";
      $("ac-state-badge").classList.toggle("is-on", state.power);
      document.querySelectorAll("[data-mode]").forEach(b =>
        b.classList.toggle("selected", b.dataset.mode === state.mode));
      document.querySelectorAll("[data-fan]").forEach(b =>
        b.classList.toggle("selected",
          (b.dataset.fan === "medium" ? "med" : b.dataset.fan) === state.fan));
      document.querySelectorAll("[data-feature]").forEach(b => {
        const key = b.dataset.feature;
        b.classList.toggle("selected", Boolean(state[key]));
        b.setAttribute("aria-pressed", String(Boolean(state[key])));
      });
      $("ac-swing").classList.toggle("selected", state.swing);
      $("ac-swing").setAttribute("aria-pressed", String(state.swing));
      $("ac-swing").querySelector("span").textContent =
        state.swing ? "Swing aktif" : "Swing mati";
      $("ac-auto").classList.toggle("active", state.control === "auto_adaptive");
      $("ac-auto").setAttribute("aria-checked", String(state.control === "auto_adaptive"));
    }

    $("ac-power").addEventListener("click", async () => {
      state.power = !state.power; render(); await sendACCommand();
    });
    $("ac-minus").addEventListener("click", async () => {
      state.temp = Math.max(18, state.temp - 1); render(); await sendACCommand();
    });
    $("ac-plus").addEventListener("click", async () => {
      state.temp = Math.min(30, state.temp + 1); render(); await sendACCommand();
    });
    document.querySelectorAll("[data-mode]").forEach(b =>
      b.addEventListener("click", () => {
        state.mode = b.dataset.mode;
        render();
        sendACCommand();
      }));
    document.querySelectorAll("[data-fan]").forEach(b =>
      b.addEventListener("click", async () => {
        state.fan = b.dataset.fan === "medium" ? "med" : b.dataset.fan;
        render();
        await sendACCommand();
      }));

    document.querySelectorAll("[data-feature]").forEach(b =>
      b.addEventListener("click", async () => {
        const key = b.dataset.feature;
        state[key] = !state[key];
        render();
        await sendACCommand();
      }));
    $("ac-swing").addEventListener("click", () => {
      state.swing = !state.swing;
      render();
      sendACCommand();
    });
    $("ac-auto").addEventListener("click", () => {
      state.control = state.control === "manual" ? "auto_adaptive" : "manual";
      render();
      sendACCommand();
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
    loadACState();
    setInterval(loadACState, 5000);
    loadWeather();
    setInterval(loadWeather, 60 * 1000);
    setInterval(compare, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else init();
})();
