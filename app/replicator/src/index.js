const { Kafka } = require("kafkajs");
const { Pool } = require("pg");
const http = require("http");
require("dotenv").config();

// Postgres pool for Region 2 read database
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  user: process.env.PGUSER || "postgres",
  password: String(process.env.PGPASSWORD || "postgres"),
  database: process.env.PGDATABASE || "read_db",
  port: Number(process.env.PGPORT || 5433),
});

// Ensure required tables exist and seed apply_state
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_products_updated_at
      ON products(updated_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consumer_offsets (
      topic TEXT NOT NULL,
      partition INTEGER NOT NULL,
      last_offset BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (topic, partition)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS apply_state (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      last_applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO apply_state (id, last_applied_at)
    VALUES (1, NOW())
    ON CONFLICT (id) DO NOTHING;
  `);
}

// Kafka setup
const kafka = new Kafka({
  clientId: process.env.KAFKA_CLIENT_ID || "replicator",
  brokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
});

const consumer = kafka.consumer({
  groupId: process.env.GROUP_ID || "replicator-group",
});

const TOPIC = process.env.KAFKA_TOPIC || "product-updates";

// Health server
let consumerConnected = false;
let healthServer;

function startHealthServer(port = Number(process.env.HEALTH_PORT || 3004)) {
  healthServer = http.createServer(async (req, res) => {
    if (req.url === "/live") {
      res.statusCode = 200;
      return res.end("OK");
    }
    if (req.url === "/ready") {
      try {
        await pool.query("SELECT 1");
        if (consumerConnected) {
          res.statusCode = 200;
          return res.end("OK");
        }
        res.statusCode = 503;
        return res.end("NOT_READY");
      } catch {
        res.statusCode = 503;
        return res.end("NOT_READY");
      }
    }
    res.statusCode = 404;
    res.end("NOT_FOUND");
  });
  healthServer.listen(port, () =>
    console.log(`replicator health listening on ${port}`)
  );
}

// Helpers for offsets and apply state
async function upsertOffset(topic, partition, offset) {
  await pool.query(
    `
    INSERT INTO consumer_offsets (topic, partition, last_offset, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (topic, partition)
    DO UPDATE SET last_offset = EXCLUDED.last_offset, updated_at = NOW()
  `,
    [topic, partition, Number(offset)]
  );
}

async function updateApplyState(ts) {
  const when = ts ? new Date(ts).toISOString() : new Date().toISOString();
  await pool.query(
    `
    UPDATE apply_state
    SET last_applied_at = $1
    WHERE id = 1
  `,
    [when]
  );
}

// Main consumer run loop
async function run() {
  await ensureSchema();

  startHealthServer();

  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
  consumerConnected = true;
  console.log(`replicator connected and subscribed to ${TOPIC}`);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const payloadStr = message.value.toString();
        const payload = JSON.parse(payloadStr);

        const { id, name, price_cents, updated_at } = payload;

        // Apply business upsert
        await pool.query(
          `
          INSERT INTO products (id, name, price_cents, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              price_cents = EXCLUDED.price_cents,
              updated_at = EXCLUDED.updated_at
        `,
          [id, name, price_cents, updated_at]
        );

        // Record offset and apply time
        await upsertOffset(topic, partition, message.offset);
        await updateApplyState(updated_at);

        console.log(
          `applied id ${id} topic ${topic} partition ${partition} offset ${message.offset}`
        );
      } catch (err) {
        console.error("replication error", err.message);
      }
    },
  });
}

// Graceful shutdown
async function shutdown(signal) {
  try {
    console.log(`${signal} received, shutting down`);
    consumerConnected = false;
    try {
      await consumer.disconnect();
    } catch (e) {
      console.error("consumer disconnect error", e.message);
    }
    try {
      await pool.end();
    } catch (e) {
      console.error("pool end error", e.message);
    }
    if (healthServer) {
      healthServer.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  } catch (e) {
    console.error("shutdown error", e);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

run().catch((err) => {
  console.error("replicator startup failed", err);
  process.exit(1);
});
