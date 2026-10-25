module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!base || !key) {
    return res.status(500).json({
      error: "Konfigurasi Supabase server belum lengkap"
    });
  }

  try {
    // Menambahkan est_kwh_bulan_ini dan est_biaya_bulan_ini ke dalam select
    const url = base.replace(/\/+$/, "") +
      "/rest/v1/ac_state?device_id=eq.esp32-kamar&select=device_id,rev,power,temp,ac_temp_command,ac_mode,fan,swing,quiet,turbo,sleep,mode,est_kwh_bulan_ini,est_biaya_bulan_ini,sisa_kwh_bulanan,sisa_kwh_harian,updated_by,updated_at&limit=1";

    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: "Bearer " + key
      },
      cache: "no-store"
    });

    if (!response.ok) {
      console.error("Supabase:", response.status, await response.text());
      return res.status(502).json({ error: "Gagal membaca status AC" });
    }

    const rows = await response.json();
    const state = rows[0] || null;
    const lastSeenMs = state && state.updated_at ? Date.parse(state.updated_at) : NaN;
    const ageMs = Date.now() - lastSeenMs;
    const online = Number.isFinite(lastSeenMs) && ageMs >= -5000 && ageMs <= 45000;
    
    return res.status(200).json({
      state,
      device: {
        online,
        last_seen: state && state.updated_at ? state.updated_at : null
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Kesalahan server" });
  }
};
