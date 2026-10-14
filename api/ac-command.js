module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Konfigurasi server belum lengkap" });
  }

  try {
    const b = req.body || {};
    const command = {
      mode: b.mode,
      power: b.power,
      temp: Number(b.temp),
      ac_mode: b.ac_mode,
      fan: b.fan,
      swing: b.swing,
      quiet: b.quiet,
      turbo: b.turbo,
      sleep: b.sleep,
      econo: b.econo
    };

    if (!["manual", "auto"].includes(command.mode))
      return res.status(400).json({ error: "Mode kontrol tidak valid" });

    if (typeof command.power !== "boolean")
      return res.status(400).json({ error: "Power tidak valid" });

    if (!Number.isInteger(command.temp) || command.temp < 16 || command.temp > 30)
      return res.status(400).json({ error: "Suhu harus 16-30°C" });

    if (!["cool", "dry", "fan", "heat"].includes(command.ac_mode))
      return res.status(400).json({ error: "Mode AC tidak valid" });

    if (!["auto", "low", "med", "high"].includes(command.fan))
      return res.status(400).json({ error: "Kipas tidak valid" });

    for (const key of ["swing", "quiet", "turbo", "sleep", "econo"]) {
      if (typeof command[key] !== "boolean")
        return res.status(400).json({ error: "Pengaturan " + key + " tidak valid" });
    }

    const response = await fetch(
      supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rpc/set_ac_command",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceKey,
          "Authorization": "Bearer " + serviceKey
        },
        body: JSON.stringify({ p_command: command })
      }
    );

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("Supabase RPC error:", response.status, result);
      return res.status(502).json({ error: "Gagal menyimpan perintah ke Supabase" });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Kesalahan server" });
  }
};
