const express = require("express");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  user: process.env.PGUSER || "postgres",
  password: String(process.env.PGPASSWORD || "postgres"),
  database: process.env.PGDATABASE || "write_db",
  port: Number(process.env.PGPORT || 5432),
});

async function getDataLagSeconds(pool) {
  try {
    const r = await pool.query(
      "SELECT last_applied_at FROM apply_state WHERE id = 1"
    );
    if (r.rowCount === 0) return null;
    const last = new Date(r.rows[0].last_applied_at).getTime();
    const now = Date.now();
    return Math.max(0, Math.round((now - last) / 1000));
  } catch {
    return null;
  }
}

app.get("/live", (_req, res) => res.status(200).send("OK"));

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).send("OK");
  } catch {
    res.status(503).send("NOT_READY");
  }
});

app.get("/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT NOW()");
    const lag = await getDataLagSeconds(pool);
    if (lag !== null) res.set("X-Data-Lag", String(lag));
    res.json({
      status: "ok",
      region: process.env.REGION || "R1",
      time: r.rows[0].now,
    });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
});

// list latest N products (default 10)
app.get("/products", async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 10), 100);
  try {
    const r = await pool.query(
      `SELECT id, name, price_cents, updated_at
       FROM products
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );
    const lag = await getDataLagSeconds(pool);
    if (lag !== null) res.set("X-Data-Lag", String(lag));
    res.json({ region: process.env.REGION || "R1", items: r.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// get one product by id
app.get("/products/:id", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, price_cents, updated_at
       FROM products WHERE id = $1`,
      [req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    const lag = await getDataLagSeconds(pool);
    if (lag !== null) res.set("X-Data-Lag", String(lag));
    res.json({ region: process.env.REGION || "R1", item: r.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = Number(process.env.PORT || 3002);
app.listen(PORT, () => {
  console.log(`Read API (${process.env.REGION || "R1"}) on ${PORT}`);
});
