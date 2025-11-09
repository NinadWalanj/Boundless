const express = require("express");
const { Pool } = require("pg");
const { Kafka } = require("kafkajs");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json());

// Postgres
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  user: process.env.PGUSER || "postgres",
  password: String(process.env.PGPASSWORD || "postgres"),
  database: process.env.PGDATABASE || "write_db",
  port: Number(process.env.PGPORT || 5432),
});

// Kafka
const kafka = new Kafka({
  clientId: "write-api",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
});
const producer = kafka.producer();

app.get("/live", (_req, res) => res.status(200).send("OK"));

app.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).send("OK");
  } catch {
    res.status(503).send("NOT_READY");
  }
});

// health
app.get("/health", async (_req, res) => {
  try {
    const r = await pool.query("SELECT NOW()");
    res.status(200).json({ status: "ok", time: r.rows[0].now });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
});

// write endpoint
app.post("/products", async (req, res) => {
  const { name, price_cents } = req.body || {};
  if (!name || typeof price_cents !== "number") {
    return res.status(400).json({ error: "name and price_cents required" });
  }

  const id = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO products (id, name, price_cents)
       VALUES ($1, $2, $3)`,
      [id, name, price_cents]
    );

    const payload = {
      id,
      name,
      price_cents,
      updated_at: new Date().toISOString(),
      event_type: "product_created",
    };

    await client.query(
      `INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      ["product", id, "product_created", JSON.stringify(payload)]
    );

    await client.query("COMMIT");
    return res.status(201).json({ id, ...payload });
  } catch (err) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// outbox dispatcher
async function processOutboxBatch(maxRows = 50) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pick = await client.query(
      `
      SELECT id, aggregate_type, aggregate_id, event_type, payload
      FROM outbox
      WHERE processed = FALSE
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT $1
      `,
      [maxRows]
    );

    if (pick.rowCount === 0) {
      await client.query("COMMIT");
      return 0;
    }

    // publish sequentially so order is preserved
    for (const row of pick.rows) {
      await producer.send({
        topic: process.env.KAFKA_TOPIC || "product-updates",
        messages: [
          {
            key: String(row.aggregate_id),
            value: JSON.stringify({
              ...row.payload,
              event_type: row.event_type,
            }),
          },
        ],
      });

      await client.query(
        `UPDATE outbox
         SET processed = TRUE,
             processed_at = NOW()
         WHERE id = $1`,
        [row.id]
      );
    }

    await client.query("COMMIT");
    return pick.rowCount;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("outbox batch failed", err.message);
    return 0;
  } finally {
    client.release();
  }
}

let stopping = false;

async function dispatcherLoop() {
  const baseSleepMs = 500;
  const idleSleepMs = 1500;

  while (!stopping) {
    const processed = await processOutboxBatch(100);
    const sleepMs = processed > 0 ? baseSleepMs : idleSleepMs;
    await new Promise((r) => setTimeout(r, sleepMs));
  }
}

async function start() {
  await producer.connect();
  console.log("Kafka producer connected");

  // start dispatcher
  dispatcherLoop().catch((e) => {
    console.error("dispatcher crashed", e);
    process.exit(1);
  });

  const PORT = Number(process.env.PORT || 3001);
  app.listen(PORT, () => {
    console.log(`Write API running on port ${PORT}`);
  });
}

async function shutdown(signal) {
  try {
    console.log(`${signal} received, shutting down`);
    stopping = true;
    await new Promise((r) => setTimeout(r, 1000));
    await producer.disconnect();
    await pool.end();
    process.exit(0);
  } catch (e) {
    console.error("shutdown error", e);
    process.exit(1);
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((e) => {
  console.error("startup error", e);
  process.exit(1);
});
