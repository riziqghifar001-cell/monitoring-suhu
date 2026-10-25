import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEVICE_TOKEN = Deno.env.get("DEVICE_TOKEN");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !DEVICE_TOKEN) {
  throw new Error("Secret SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, atau DEVICE_TOKEN belum tersedia");
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-device-token, apikey",
  "Content-Type": "application/json",
};

const FIELDS = [
  "power",
  "temp",
  "ac_temp_command",
  "ac_mode",
  "fan",
  "swing",
  "quiet",
  "turbo",
  "sleep",
  "mode",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function validDeviceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 100;
}

function validState(state: any) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;

  if (state.temp !== undefined && (!Number.isInteger(state.temp) || state.temp < 16 || state.temp > 30)) return false;
  if (state.power !== undefined && state.power !== null && typeof state.power !== "boolean") return false;

  for (const key of ["swing", "quiet", "turbo", "sleep"]) {
    if (state[key] !== undefined && typeof state[key] !== "boolean") return false;
  }

  if (state.ac_mode !== undefined && !["cool", "dry", "fan", "heat"].includes(state.ac_mode)) return false;
  if (state.fan !== undefined && !["auto", "low", "med", "medium", "high"].includes(state.fan)) return false;
  if (state.mode !== undefined && !["manual", "auto"].includes(state.mode)) return false;

  return true;
}

async function merge(deviceId: string, patch: any, by: string, baseRev?: number) {
  if (!validDeviceId(deviceId)) throw new Error("device_id tidak valid");
  if (!validState(patch)) throw new Error("Format state tidak valid");

  const { data: current, error: readError } = await db.from("ac_state").select("*").eq("device_id", deviceId).maybeSingle();
  if (readError) throw readError;

  const currentRev = Number(current?.rev ?? 0);
  if (baseRev !== undefined && baseRev !== currentRev) {
    return { conflict: true, rev: currentRev, state: current };
  }

  const update: Record<string, unknown> = {
    rev: currentRev + 1,
    updated_by: by,
    updated_at: new Date().toISOString(),
  };

  for (const key of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      update[key] = patch[key];
    }
  }

  let result;
  if (current) {
    const { data, error } = await db.from("ac_state").update(update).eq("device_id", deviceId).eq("rev", currentRev).select().maybeSingle();
    if (error) throw error;
    result = data;
  } else {
    const { data, error } = await db.from("ac_state").insert({
      device_id: deviceId,
      ...update,
      ...Object.fromEntries(FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(patch, key)).map((key) => [key, patch[key]])),
    }).select().single();
    if (error) throw error;
    result = data;
  }

  if (!result) {
    const { data: latest, error } = await db.from("ac_state").select("*").eq("device_id", deviceId).maybeSingle();
    if (error) throw error;
    return { conflict: true, rev: Number(latest?.rev ?? 0), state: latest };
  }

  return { conflict: false, rev: result.rev, state: result };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Gunakan POST" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "JSON request tidak valid" }, 400); }

  try {
    const deviceAction = ["sensor", "get_state", "report_state"].includes(body.action);
    const deviceAuthorized = Boolean(DEVICE_TOKEN) && req.headers.get("x-device-token") === DEVICE_TOKEN;

    if (deviceAction && !deviceAuthorized) return json({ success: false, error: "Token perangkat tidak valid" }, 401);
    if (deviceAction && !validDeviceId(body.device_id)) return json({ success: false, error: "device_id tidak valid" }, 400);

    if (body.action === "sensor") {
      const suhu = body.suhu;
      const kelembapan = body.kelembapan;
      if (typeof suhu !== "number" || typeof kelembapan !== "number" || !Number.isFinite(suhu) || !Number.isFinite(kelembapan)) {
        return json({ success: false, error: "Nilai suhu/kelembapan tidak valid" }, 400);
      }

      const row = {
        device_id: body.device_id,
        suhu,
        kelembapan,
        control_mode: ["manual", "auto"].includes(body.control_mode) ? body.control_mode : "manual",
        desired_power: body.desired_power === true ? "true" : body.desired_power === false ? "false" : "unknown",
        ac_temp_command: body.ac_temp_command ?? null,
        ac_mode_command: body.ac_mode_command ?? null,
        last_action: body.last_action ?? null,
      };

      const { data, error } = await db.from("sensor_readings").insert(row).select("id, device_id, suhu, kelembapan, recorded_at").single();
      if (error) return json({ success: false, error: "Gagal menyimpan sensor", details: error.message }, 500);

      return json({ success: true, message: "Data sensor tersimpan", data });
    }

    if (body.action === "get_state") {
      const { data, error } = await db.from("ac_state").select("*").eq("device_id", body.device_id).maybeSingle();
      if (error) throw error;
      const sinceRev = Number(body.since_rev ?? 0);
      return json({ state: data && Number(data.rev) > sinceRev ? data : null });
    }

    if (body.action === "report_state") {
      if (!body.state || typeof body.state !== "object") return json({ success: false, error: "State tidak valid" }, 400);
      const result = await merge(body.device_id, body.state, "device", Number(body.base_rev ?? 0));
      return json(result);
    }

    if (body.action === "set_state") {
      const authorization = req.headers.get("Authorization");
      if (!authorization?.startsWith("Bearer ")) return json({ success: false, error: "Login diperlukan" }, 401);

      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user) return json({ success: false, error: "Sesi login tidak valid" }, 401);

      if (!validDeviceId(body.device_id) || !validState(body.state)) return json({ success: false, error: "Device ID atau state tidak valid" }, 400);

      const result = await merge(body.device_id, body.state, "web", body.base_rev === undefined ? undefined : Number(body.base_rev));
      return json(result);
    }

    return json({ success: false, error: "Action tidak dikenal" }, 400);
  } catch (error) {
    return json({ success: false, error: "Operasi database gagal", details: errorMessage(error) }, 500);
  }
});
