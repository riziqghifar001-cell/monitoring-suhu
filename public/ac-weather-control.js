(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let commandQueue = Promise.resolve();
  let commandSending = false;
  let lastManualActionTime = 0;
  const state = {
    power: false, mode: "cool", temp: 24,
    fan: "auto", swing: true, quiet: false, turbo: false,
    sleep: false, control: "manual",
    estKwh: 0, estBiaya: 0, budget: 100000,
    limitSiang: 29, limitMalam: 28
  };

  function init() {
    if ($("smart-ac")) return;
    
    const pageAc = $("page-ac") || document.body;
    const panel = document.createElement("div");
    panel.id = "smart-ac";
    panel.className = "smart-dashboard";
    panel.innerHTML = `
      <div class="smart-head" style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); border:1px solid var(--panel-border); border-radius:16px; padding:20px 24px; margin-bottom:16px;">
        <div>
          <p class="eyebrow">SMART CLIMATE</p>
          <h2 style="margin:2px 0;">Kontrol AC</h2>
          <p class="smart-sub">Daikin · Kontrol ruangan</p>
        </div>
        <span id="ac-state-badge" class="ac-badge">OFF</span>
      </div>

      <div class="ac-main-card" style="background:var(--panel); border:1px solid var(--panel-border); border-radius:16px; padding:24px; margin-bottom:16px;">
        <!-- Status & Tombol Power -->
        <div class="ac-power-row" style="display:flex; justify-content:space-between; align-items:center; padding-bottom:18px; border-bottom:1px solid var(--panel-border); margin-bottom:20px;">
          <div>
            <span class="muted-label" style="font-size:12px; color:var(--text-muted);">Status AC</span>
            <div id="ac-power-label" style="font-size:16px; font-weight:700; margin-top:2px;">Mati</div>
          </div>
          <button id="ac-power" class="power-button" aria-pressed="false" type="button" style="display:flex; align-items:center; gap:8px; padding:10px 20px; border-radius:12px; font-weight:700; cursor:pointer;">
            <span class="power-symbol" style="font-size:16px;">⏻</span><span id="ac-power-text">Nyalakan</span>
          </button>
        </div>

        <!-- Kontrol Suhu -->
        <div class="ac-temp-control" style="display:flex; justify-content:center; align-items:center; gap:24px; background:rgba(0,0,0,0.2); border:1px solid var(--panel-border); border-radius:14px; padding:18px; margin-bottom:20px;">
          <button id="ac-minus" class="round-button" aria-label="Kurangi suhu" type="button">−</button>
          <div class="setpoint" style="text-align:center;">
            <div><strong id="ac-temp" style="font-size:36px; font-weight:800; letter-spacing:-1px;">24</strong><span style="font-size:18px; font-weight:600; color:var(--text-muted); margin-left:4px;">°C</span></div>
            <small style="font-size:11px; color:var(--text-muted); display:block; margin-top:2px;">Suhu target</small>
          </div>
          <button id="ac-plus" class="round-button" aria-label="Tambah suhu" type="button">+</button>
        </div>

        <!-- Ringkasan Energi & Anggaran -->
        <div class="ac-energy-card" style="background:rgba(37,99,235,0.06); border:1px solid rgba(37,99,235,0.2); border-radius:14px; padding:16px; display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:20px;">
          <div>
            <span class="muted-label" style="font-size:11px; color:var(--text-muted); display:block;">Estimasi Energi Bulan Ini</span>
            <div style="font-size:18px; font-weight:800; margin-top:2px;"><span id="ac-est-kwh">0.00</span> kWh</div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">Sisa Bulan: <strong id="ac-sisa-bulan" style="color:var(--text-main);">0.00</strong> kWh</div>
          </div>
          <div style="text-align:right;">
            <span class="muted-label" style="font-size:11px; color:var(--text-muted); display:block;">Estimasi Biaya / Anggaran</span>
            <div style="font-size:16px; font-weight:800; color:#34d399; margin-top:2px;">Rp <span id="ac-est-biaya">0</span> / Rp 100k</div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">Sisa Hari Ini: <strong id="ac-sisa-harian" style="color:var(--text-main);">0.00</strong> kWh</div>
          </div>
        </div>

        <!-- Mode Operasi -->
        <div style="margin-bottom:16px;">
          <div class="ac-control-label" style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">Mode Operasi</div>
          <div class="ac-button-grid" id="ac-modes" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
            <button class="choice-button selected" data-mode="cool" type="button" style="padding:10px; border-radius:10px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;"><span>❄</span> Cool</button>
            <button class="choice-button" data-mode="dry" type="button" style="padding:10px; border-radius:10px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;"><span>◉</span> Dry</button>
            <button class="choice-button" data-mode="fan" type="button" style="padding:10px; border-radius:10px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;"><span>≋</span> Fan</button>
          </div>
        </div>

        <!-- Kecepatan Kipas & Fitur -->
        <div style="margin-bottom:16px;">
          <div class="ac-control-label" style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">Kecepatan Kipas & Fitur</div>
          <div class="fan-options" id="ac-fans" style="display:flex; gap:8px; margin-bottom:8px;">
            <button class="mini-choice" data-fan="low" type="button" style="padding:8px 14px; border-radius:8px; font-weight:600; font-size:12px; cursor:pointer; flex:1;">Low</button>
            <button class="mini-choice" data-fan="medium" type="button" style="padding:8px 14px; border-radius:8px; font-weight:600; font-size:12px; cursor:pointer; flex:1;">Med</button>
            <button class="mini-choice" data-fan="high" type="button" style="padding:8px 14px; border-radius:8px; font-weight:600; font-size:12px; cursor:pointer; flex:1;">High</button>
          </div>
          <div class="fan-options ac-feature-options" aria-label="Fitur AC" style="display:flex; gap:8px;">
            <button class="mini-choice" data-feature="quiet" type="button" aria-pressed="false" style="padding:8px 12px; border-radius:8px; font-weight:600; font-size:12px; cursor:pointer; flex:1;">Quiet</button>
            <button class="mini-choice" data-feature="turbo" type="button" aria-pressed="false" style="padding:8px 12px; border-radius:8px; font-weight:600; font-size:12px; cursor:pointer; flex:1;">Turbo</button>
            <button class="mini-choice" data-feature="sleep" type="button" aria-pressed="false" style="padding:8px 12px; border-radius:8px; font-weight:600; font-size:12px; cursor:pointer; flex:1;">Sleep</button>
          </div>
        </div>

        <!-- Tombol Swing -->
        <div>
          <div class="ac-control-label" style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:8px; letter-spacing:0.5px;">Pengaturan Aliran Udara</div>
          <button id="ac-swing" class="swing-button selected" type="button" aria-pressed="true" style="width:100%; padding:12px 16px; border-radius:10px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer; font-size:13.5px; white-space:nowrap;">
            <span style="font-size:15px; line-height:1;">↕</span> <span id="ac-swing-text">Swing aktif</span>
          </button>
        </div>
      </div>

      <div class="ac-automation" style="background:var(--panel); border:1px solid var(--panel-border); border-radius:16px; padding:20px 24px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <p class="eyebrow" style="margin-bottom:2px;">PENGATURAN CERDAS</p>
          <h3 style="font-size:16px; font-weight:700; margin:0;">Auto Adaptive</h3>
          <p class="smart-sub" style="margin:2px 0 0; font-size:12px;">Penyesuaian berdasarkan suhu kamar dan cuaca luar.</p>
        </div>
        <button id="ac-auto" class="toggle-button" role="switch" aria-checked="false" type="button" style="width:48px; height:26px; border-radius:99px; background:rgba(255,255,255,0.1); border:1px solid var(--panel-border); position:relative; cursor:pointer; flex-shrink:0;">
          <span style="position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#fff; transition:0.2s;"></span>
        </button>
      </div>
    `;
    pageAc.appendChild(panel);

    const pageWeather = $("page-weather") || document.body;
    const weatherPanel = document.createElement("div");
    weatherPanel.innerHTML = `
      <div class="weather-heading" style="display:flex; justify-content:space-between; align-items:center; background:var(--panel); border:1px solid var(--panel-border); border-radius:16px; padding:20px 24px; margin-bottom:16px;">
        <div>
          <p class="eyebrow">OPEN-METEO · SURAKARTA</p>
          <h2 style="margin:2px 0;">Cuaca di luar</h2>
        </div>
        <span id="weather-indicator" class="weather-indicator">Memuat...</span>
      </div>

      <div class="weather-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">
        <article class="weather-card outdoor" style="background:var(--panel); border:1px solid var(--panel-border); border-radius:16px; padding:20px;">
          <span class="weather-icon" style="font-size:24px;">☀</span>
          <span class="muted-label" style="font-size:12px; color:var(--text-muted); display:block; margin-top:8px;">Suhu luar</span>
          <div class="weather-value" style="font-size:32px; font-weight:800; margin:6px 0;"><strong id="out-temp">--</strong><span style="font-size:16px; font-weight:600; color:var(--text-muted); margin-left:4px;">°C</span></div>
          <p id="out-condition" style="margin:0; font-size:12px; color:var(--text-muted);">Mengambil data cuaca</p>
        </article>
        <article class="weather-card" style="background:var(--panel); border:1px solid var(--panel-border); border-radius:16px; padding:20px;">
          <span class="weather-icon" style="font-size:24px;">◌</span>
          <span class="muted-label" style="font-size:12px; color:var(--text-muted); display:block; margin-top:8px;">Kelembapan luar</span>
          <div class="weather-value" style="font-size:32px; font-weight:800; margin:6px 0;"><strong id="out-hum">--</strong><span style="font-size:16px; font-weight:600; color:var(--text-muted); margin-left:4px;">%</span></div>
          <p style="margin:0; font-size:12px; color:var(--text-muted);">Kelembapan relatif</p>
        </article>
      </div>

      <div class="comparison-card" style="background:var(--panel); border:1px solid var(--panel-border); border-radius:16px; padding:20px 24px;">
        <div class="comparison-title" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div><p class="eyebrow" style="margin-bottom:2px;">PERBANDINGAN</p><h3 style="font-size:16px; font-weight:700;">Kamar vs luar</h3></div>
          <span id="compare-badge" class="compare-badge" style="font-size:11px; padding:4px 10px; border-radius:8px; background:rgba(255,255,255,0.05);">Menunggu data</span>
        </div>
        <div class="compare-values" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:14px; padding:12px; background:rgba(0,0,0,0.2); border-radius:10px;">
          <div><span style="font-size:11px; color:var(--text-muted); display:block;">Kamar · DHT22</span><strong id="compare-in" style="font-size:15px;">-- °C</strong></div>
          <div><span style="font-size:11px; color:var(--text-muted); display:block;">Luar · Open-Meteo</span><strong id="compare-out" style="font-size:15px;">-- °C</strong></div>
        </div>
        <div class="delta-line" style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:8px;"><span style="color:var(--text-muted);">Selisih suhu</span><strong id="compare-delta">--</strong></div>
        <p id="compare-note" class="smart-sub" style="margin:0 0 10px; font-size:12px;">Perbandingan muncul saat kedua sumber memiliki data valid.</p>
        <p id="weather-time" class="weather-time" style="margin:0; font-size:11px; color:var(--text-muted);">Pembaruan: menunggu data</p>
      </div>
    `;
    pageWeather.appendChild(weatherPanel);

    async function sendACCommandNow(isPowerAction = false) {
      const mode = state.control === "manual" ? "manual" : "auto";
      const acMode = ["cool", "dry", "fan", "heat"].includes(state.mode) ? state.mode : "cool";
      const fan = state.fan === "medium" ? "med" : (["auto", "low", "med", "high"].includes(state.fan) ? state.fan : "auto");

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
        sync_power: Boolean(isPowerAction),
        limit_siang: Number(state.limitSiang) || 29,
        limit_malam: Number(state.limitMalam) || 28
      };

      try {
        const response = await fetch("/api/ac-command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Permintaan gagal");
        return true;
      } catch (error) {
        console.error("Gagal mengirim perintah:", error);
        return false;
      }
    }

    function sendACCommand(isPowerAction = false) {
      lastManualActionTime = Date.now();
      commandQueue = commandQueue.catch(() => {}).then(async () => {
        commandSending = true;
        try { await sendACCommandNow(isPowerAction); } finally { commandSending = false; }
      });
      return commandQueue;
    }

    async function loadACState() {
      if (commandSending) return;
      if (Date.now() - lastManualActionTime < 6000) return;

      try {
        const response = await fetch("/api/ac-state", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const result = await response.json();
        const a = result && result.state;
        if (!a) return;

        if (typeof a.power === "boolean") state.power = a.power;
        if (Number.isFinite(Number(a.temp)) && a.temp !== null) state.temp = Number(a.temp);

        if (a.est_kwh_bulan_ini !== undefined) state.estKwh = Number(a.est_kwh_bulan_ini) || 0;
        if (a.est_biaya_bulan_ini !== undefined) state.estBiaya = Number(a.est_biaya_bulan_ini) || 0;
        if (a.sisa_kwh_bulanan !== undefined) state.sisaBulan = Number(a.sisa_kwh_bulanan) || 0;
        if (a.sisa_kwh_harian !== undefined) state.sisaHarian = Number(a.sisa_kwh_harian) || 0;
        if (a.limit_siang !== undefined) state.limitSiang = Number(a.limit_siang) || 29;
        if (a.limit_malam !== undefined) state.limitMalam = Number(a.limit_malam) || 28;

        if (["cool", "dry", "fan", "heat"].includes(a.ac_mode)) state.mode = a.ac_mode;
        if (["auto", "low", "med", "medium", "high"].includes(a.fan)) state.fan = a.fan === "medium" ? "med" : a.fan;

        for (const key of ["quiet", "turbo", "sleep", "swing"]) {
          if (typeof a[key] === "boolean") state[key] = a[key];
        }

        if (a.mode === "manual") state.control = "manual";
        else if (a.mode === "auto" || a.mode === "auto_adaptive") state.control = "auto_adaptive";

        render();
      } catch (error) {
        console.error("Gagal baca status:", error);
      }
    }

    function render() {
      $("ac-temp").textContent = state.temp;
      if ($("ac-est-kwh")) $("ac-est-kwh").textContent = state.estKwh.toFixed(2);
      if ($("ac-est-biaya")) $("ac-est-biaya").textContent = Math.round(state.estBiaya).toLocaleString("id-ID");
      if ($("ac-sisa-bulan")) $("ac-sisa-bulan").textContent = (state.sisaBulan || 0).toFixed(2);
      if ($("ac-sisa-harian")) $("ac-sisa-harian").textContent = (state.sisaHarian || 0).toFixed(2);
      
      if ($("limit-siang")) $("limit-siang").value = state.limitSiang;
      if ($("limit-malam")) $("limit-malam").value = state.limitMalam;

      $("ac-power-label").textContent = state.power ? "Menyala" : "Mati";
      $("ac-power-text").textContent = state.power ? "Matikan" : "Nyalakan";
      $("ac-power").setAttribute("aria-pressed", String(state.power));
      $("ac-power").classList.toggle("is-on", state.power);
      $("ac-state-badge").textContent = state.power ? "ON" : "OFF";
      $("ac-state-badge").classList.toggle("is-on", state.power);

      document.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("selected", b.dataset.mode === state.mode));
      
      const fanDisabled = state.quiet || state.turbo;
      document.querySelectorAll("[data-fan]").forEach(b => {
        b.classList.toggle("selected", (b.dataset.fan === "medium" ? "med" : b.dataset.fan) === state.fan);
        b.style.opacity = fanDisabled ? "0.4" : "1";
        b.style.pointerEvents = fanDisabled ? "none" : "auto";
      });

      document.querySelectorAll("[data-feature]").forEach(b => {
        const key = b.dataset.feature;
        b.classList.toggle("selected", Boolean(state[key]));
        b.setAttribute("aria-pressed", String(Boolean(state[key])));
      });

      $("ac-swing").classList.toggle("selected", state.swing);
      $("ac-swing").setAttribute("aria-pressed", String(state.swing));
      const swingText = $("ac-swing-text");
      if (swingText) swingText.textContent = state.swing ? "Swing aktif" : "Swing mati";

      $("ac-auto").classList.toggle("active", state.control === "auto_adaptive");
      $("ac-auto").setAttribute("aria-checked", String(state.control === "auto_adaptive"));
      
      const toggleSpan = $("ac-auto").querySelector("span");
      if (toggleSpan) {
        toggleSpan.style.left = state.control === "auto_adaptive" ? "25px" : "3px";
        $("ac-auto").style.background = state.control === "auto_adaptive" ? "var(--accent-blue)" : "rgba(255,255,255,0.1)";
      }
    }

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
      $("compare-delta").textContent = (delta > 0 ? "+" : "") + delta.toFixed(1) + " °C";
      $("compare-badge").textContent = Math.abs(delta) < 0.5 ? "Hampir sama" : delta > 0 ? "Kamar lebih panas" : "Luar lebih panas";
      $("compare-note").textContent = delta > 0 ? "Suhu kamar lebih tinggi daripada suhu luar." : delta < 0 ? "Suhu kamar lebih rendah daripada suhu luar." : "Suhu kamar dan luar hampir sama.";
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
        if (!c || !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.relative_humidity_2m)) throw new Error("Data tidak valid");
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

    // Event Listeners untuk Simpan Pengaturan & Reset kWh
    document.addEventListener("click", async (e) => {
      if (e.target && e.target.id === "btn-save-settings") {
        const budgetInput = $("input-budget");
        const siangInput = $("limit-siang");
        const malamInput = $("limit-malam");
        const statusEl = $("settings-status");

        if (budgetInput) state.budget = Number(budgetInput.value) || 100000;
        if (siangInput) state.limitSiang = Number(siangInput.value) || 29;
        if (malamInput) state.limitMalam = Number(malamInput.value) || 28;

        if (statusEl) statusEl.textContent = "Menyimpan pengaturan...";
        const success = await sendACCommand(false);
        if (statusEl) {
          statusEl.textContent = success ? "Pengaturan berhasil disimpan ke sistem!" : "Gagal menyimpan pengaturan.";
          setTimeout(() => { statusEl.textContent = ""; }, 4000);
        }
      }

      if (e.target && e.target.id === "btn-reset-kwh") {
        if (!confirm("Yakin ingin mereset akumulasi kWh bulanan ke 0?")) return;
        const statusEl = $("settings-status");
        if (statusEl) statusEl.textContent = "Mereset data kWh...";
        // Kirim perintah reset atau sinkronisasi
        try {
          const payload = {
            reset_kwh: true
          };
          const res = await fetch("/api/ac-command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            state.estKwh = 0;
            state.estBiaya = 0;
            render();
            if (statusEl) statusEl.textContent = "Akumulasi kWh berhasil di-reset!";
          } else {
            if (statusEl) statusEl.textContent = "Gagal mereset kWh.";
          }
        } catch (err) {
          if (statusEl) statusEl.textContent = "Terjadi kesalahan jaringan.";
        }
        setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 4000);
      }
    });

    $("ac-power").addEventListener("click", async () => { state.power = !state.power; render(); await sendACCommand(true); });
    $("ac-minus").addEventListener("click", async () => { state.temp = Math.max(16, state.temp - 1); render(); await sendACCommand(false); });
    $("ac-plus").addEventListener("click", async () => { state.temp = Math.min(30, state.temp + 1); render(); await sendACCommand(false); });

    document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => { state.mode = b.dataset.mode; render(); sendACCommand(false); }));
    document.querySelectorAll("[data-fan]").forEach(b => b.addEventListener("click", async () => {
      if (state.quiet || state.turbo) return;
      state.fan = b.dataset.fan === "medium" ? "med" : b.dataset.fan;
      render();
      await sendACCommand(false);
    }));

    document.querySelectorAll("[data-feature]").forEach(b => b.addEventListener("click", async () => {
      const key = b.dataset.feature;
      state[key] = !state[key];
      if (key === "quiet" && state.quiet) state.turbo = false;
      if (key === "turbo" && state.turbo) state.quiet = false;
      render();
      await sendACCommand(false);
    }));

    $("ac-swing").addEventListener("click", () => { state.swing = !state.swing; render(); sendACCommand(false); });
    $("ac-auto").addEventListener("click", () => { state.control = state.control === "manual" ? "auto_adaptive" : "manual"; render(); sendACCommand(false); });

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



