const { Pool } = require("pg");

const schema = `CREATE TABLE IF NOT EXISTS public.ble_test_logs (
  id uuid PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  site_id text NOT NULL,
  machine_id text NOT NULL,
  bluetooth_name text NOT NULL,
  cycle_key text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  outcome text NOT NULL,
  error_message text,
  events jsonb NOT NULL
)`;

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
}

function validateAttempt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id || "")) return false;
  if (value.siteId !== "the_boulevard_b_block" || value.machineId !== "washer2" || value.bluetoothName !== "AW88T7FE96R1" || value.cycleKey !== "standardEco") return false;
  if (!validDate(value.startedAt) || !validDate(value.finishedAt) || Date.parse(value.finishedAt) < Date.parse(value.startedAt)) return false;
  if (!["acknowledged", "unconfirmed", "error"].includes(value.outcome)) return false;
  if (value.errorMessage !== undefined && (typeof value.errorMessage !== "string" || value.errorMessage.length > 500)) return false;
  if (!Array.isArray(value.events) || value.events.length > 100) return false;
  return value.events.every((event) => event && validDate(event.at)
    && ["rx", "tx", "reply", "secure_packet_sent"].includes(event.type)
    && typeof event.text === "string" && event.text.length <= 4096
    && (event.hex === undefined || (typeof event.hex === "string" && /^[0-9a-f]*$/i.test(event.hex) && event.hex.length <= 8192)));
}

function createDiagnosticWriter(connectionString = process.env.DB_LINK, pool = null) {
  if (!connectionString && !pool) return null;
  const database = pool || new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
  let ready;
  return async (attempt) => {
    if (!validateAttempt(attempt)) throw new TypeError("Invalid diagnostic attempt");
    ready ||= database.query(schema).catch((error) => { ready = null; throw error; });
    await ready;
    const result = await database.query(
      `INSERT INTO public.ble_test_logs
        (id, site_id, machine_id, bluetooth_name, cycle_key, started_at, finished_at, outcome, error_message, events)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [attempt.id, attempt.siteId, attempt.machineId, attempt.bluetoothName, attempt.cycleKey,
        attempt.startedAt, attempt.finishedAt, attempt.outcome, attempt.errorMessage || null, JSON.stringify(attempt.events)]
    );
    return result.rowCount > 0;
  };
}

module.exports = { createDiagnosticWriter, validateAttempt, schema };
