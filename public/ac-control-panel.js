(() => {
  if (document.getElementById("ac-control-card")) return;

  const card = document.createElement("section");
  card.id = "ac-control-card";
  card.style.cssText = "max-width:700px;margin:24px auto;padding:20px;border:1px solid #ccc;border-radius:14px;font:inherit";

  card.innerHTML = `
    <h2>Kontrol AC Daikin</h2>
    <p>Perintah dikirim melalui server ke Supabase.</p>
    <p><label>Power <select id="ac-power"><option value="true">ON</option><option value="false">OFF</option></select></label></p>
    <p><label>Mode kontrol <select id="ac-mode"><option value="manual">Manual</option><option value="auto">Otomatis</option></select></label></p>
    <p><label>Suhu <select id="ac-temp">${Array.from({length:15},(_,i)=>`<option value="${i+16}" ${i+16===27?"selected":""}>${i+16} °C</option>`).join("")}</select></label></p>
    <p><label>Mode AC <select id="ac-kind"><option value="cool">Cool</option><option value="dry">Dry</option><option value="fan">Fan</option><option value="heat">Heat</option></select></label></p>
    <p><label>Kipas <select id="ac-fan"><option value="auto">Auto</option><option value="low">Low</option><option value="med">Medium</option><option value="high">High</option></select></label></p>
    <p><label><input id="ac-swing" type="checkbox"> Swing</label></p>
    <p><label><input id="ac-quiet" type="checkbox"> Quiet</label></p>
    <p><label><input id="ac-turbo" type="checkbox"> Turbo</label></p>
    <p><label><input id="ac-sleep" type="checkbox"> Sleep</label></p>
    <p><label><input id="ac-econo" type="checkbox"> Econo</label></p>
    <button id="ac-send" type="button">Kirim perintah</button>
    <p id="ac-status" role="status">Belum ada perintah dikirim.</p>
  `;

  (document.querySelector("main") || document.body).appendChild(card);

  const $ = id => document.getElementById(id);

  $("ac-send").addEventListener("click", async () => {
const payload = {
      power: $("ac-power").value === "true",
      mode: $("ac-mode").value,
      temp: Number($("ac-temp").value),
      ac_mode: $("ac-kind").value,
      fan: $("ac-fan").value,
      swing: $("ac-swing").checked,
      quiet: $("ac-quiet").checked,
      turbo: $("ac-turbo").checked,
      sleep: $("ac-sleep").checked,
      econo: $("ac-econo").checked
    };

    const button = $("ac-send");
    button.disabled = true;
    $("ac-status").textContent = "Mengirim perintah...";

    try {
      const response = await fetch("/api/ac-command", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
},
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Permintaan gagal");

      $("ac-status").textContent =
        "Perintah tersimpan. ID: " + result.command_id +
        ". Belum berarti AC sudah menerima sinyal IR.";
    } catch (error) {
      $("ac-status").textContent = "Gagal: " + error.message;
    } finally {
      button.disabled = false;
    }
  });
})();
