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
      sync_power: Boolean(b.sync_power),
      limit_siang: b.limit_siang !== undefined ? Number(b.limit_siang) : undefined,
      limit_malam: b.limit_malam !== undefined ? Number(b.limit_malam) : undefined,
      reset_kwh: Boolean(b.reset_kwh)
    };

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
      return res.status(502).json({ error: (result && (result.message || result.details || result.hint)) || "Gagal menyimpan perintah ke Supabase", code: result && result.code });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Kesalahan server" });
  }
};
