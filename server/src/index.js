import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  ensureManifestCache,
  ensureSeasonData,
  ensureSourceData,
  ensureClarityData,
  getWeapons,
  getWeaponDetail,
  getPerks,
  getFilters,
} from "./bungie.js";
import { getCutout, CUTOUT_VERSION } from "./cutout.js";

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

app.get("/api/perks", async (req, res) => {
  try {
    const perks = await getPerks();
    res.json({ count: perks.length, results: perks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load perks" });
  }
});

app.get("/api/filters", async (req, res) => {
  try {
    res.json(await getFilters());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load filters" });
  }
});

// The weapon cut out of Bungie's backdrop (WebP), or 404 when the page should show the
// original screenshot instead (glowing weapons, or the cut-out failed).
app.get("/api/picture/:hash", async (req, res) => {
  const hash = Number(req.params.hash);
  if (!Number.isInteger(hash)) return res.status(400).json({ error: "Invalid weapon hash" });
  try {
    const weapon = await getWeaponDetail(hash);
    if (!weapon?.screenshot) return res.status(404).json({ useOriginal: true });
    const cutout = await getCutout(hash, weapon.screenshot);
    if (!cutout.file) return res.status(404).json({ useOriginal: true, glowScore: cutout.glowScore });
    // kind: "cutout" (gun cut out) or "original" (Bungie's picture cropped, darkened, faded)
    res.set("Cache-Control", "public, max-age=86400").set("X-Picture-Kind", cutout.kind).type("image/webp").sendFile(cutout.file);
  } catch (err) {
    console.error(`Cut-out failed for ${hash}:`, err.message);
    res.status(404).json({ useOriginal: true });
  }
});

app.get("/api/weapons/:hash", async (req, res) => {
  try {
    const hash = Number(req.params.hash);
    if (!Number.isInteger(hash)) return res.status(400).json({ error: "Invalid weapon hash" });

    const selectedHashes = (req.query.perks ?? "")
      .split(",")
      .map((h) => Number(h.trim()))
      .filter(Number.isInteger);

    const weapon = await getWeaponDetail(hash, selectedHashes);
    if (!weapon) return res.status(404).json({ error: "Weapon not found" });

    res.json({ ...weapon, pictureVersion: CUTOUT_VERSION });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load weapon detail" });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

async function start() {
  await ensureManifestCache(API_KEY);
  await ensureSeasonData();
  await ensureSourceData();
  await ensureClarityData();
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
