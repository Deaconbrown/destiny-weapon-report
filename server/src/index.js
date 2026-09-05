import "dotenv/config";
import express from "express";
import cors from "cors";
import { ensureManifestCache, getWeapons, getWeaponDetail } from "./bungie.js";

const PORT = process.env.PORT || 4000;
const API_KEY = process.env.BUNGIE_API_KEY;

if (!API_KEY) {
  console.error("Missing BUNGIE_API_KEY in .env — see .env.example");
  process.exit(1);
}

const app = express();
app.use(cors());

app.get("/api/weapons", async (req, res) => {
  try {
    const weapons = await getWeapons();
    const { name, damageType, ammoType } = req.query;

    let results = weapons;
    if (name) {
      const needle = name.toLowerCase();
      results = results.filter((w) => w.name.toLowerCase().includes(needle));
    }
    if (damageType) {
      results = results.filter((w) => w.damageType === damageType);
    }
    if (ammoType) {
      results = results.filter((w) => w.ammoType === ammoType);
    }

    res.json({ count: results.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load weapons" });
  }
});

app.get("/api/weapons/:hash", async (req, res) => {
  try {
    const hash = Number(req.params.hash);
    if (!Number.isInteger(hash)) return res.status(400).json({ error: "Invalid weapon hash" });

    const weapon = await getWeaponDetail(hash);
    if (!weapon) return res.status(404).json({ error: "Weapon not found" });

    res.json(weapon);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load weapon detail" });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

async function start() {
  await ensureManifestCache(API_KEY);
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
