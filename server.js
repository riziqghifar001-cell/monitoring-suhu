require("dotenv").config({ path: ".env.local" });
const express = require("express");
const os = require("os");
const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10kb" }));
app.use(express.static("public"));

let latest = null;
let history = [];
let lastReceived = 0;

app.get("/api/data", (req, res) => {
  res.json({
    connected: !!latest && Date.now() - lastReceived < 15000,
    latest,
    history
  });
});

app.post("/api/data", (req, res) => {
  const { suhu, kelembapan } = req.body;

  if (
    typeof suhu !== "number" ||
    typeof kelembapan !== "number" ||
    !Number.isFinite(suhu) ||
    !Number.isFinite(kelembapan) ||
    suhu < -40 || suhu > 80 ||
    kelembapan < 0 || kelembapan > 100
  ) {
    return res.status(400).json({
      success: false,
      message: "Data sensor tidak valid"
    });
  }

  latest = {
    suhu,
    kelembapan,
    waktu: new Date().toISOString()
  };

  lastReceived = Date.now();
  history.push(latest);

  if (history.length > 500) {
    history.shift();
  }

  res.json({ success: true });
});

app.get("/api/status", (req, res) => {
  res.json({
    connected: !!latest && Date.now() - lastReceived < 15000,
    waktuServer: new Date().toISOString()
  });
});


app.get("/api/ac-state", require("./api/ac-state"));
app.post("/api/ac-command", async (req, res) => {
  try {
    await require("./api/ac-command")(req, res);
  } catch (error) {
    console.error("AC command route error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Kesalahan server AC" });
    }
  }
});
app.listen(PORT, "0.0.0.0", () => {
  console.log("\n==================================");
  console.log("  WEB MONITORING DHT22 AKTIF");
  console.log("==================================");
  console.log(`Lokal: http://localhost:${PORT}`);

  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`Jaringan: http://${net.address}:${PORT}`);
      }
    }
  }

  console.log("\nMenunggu data dari ESP32-S3...");
});


