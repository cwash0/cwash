const CANONICAL_ORDER_TABLE = "access_orders";
const LEGACY_ORDER_TABLE = "paypal_access_orders";

let storageReady = false;

/**
 * Moves the historical provider-named order table to the canonical business
 * name. The rename is metadata-only in PostgreSQL, so primary keys, foreign
 * keys, data, and historical provider values are preserved atomically.
 */
async function ensureOrderStorage(pool) {
  if (storageReady) return { tableName: CANONICAL_ORDER_TABLE, migrated: false };

  const client = typeof pool.connect === "function" ? await pool.connect() : pool;
  const shouldRelease = client !== pool;
  let migrated = false;

  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('circuitwash-order-storage-v1'))");

    const tables = await client.query(`
      select
        to_regclass('public.${CANONICAL_ORDER_TABLE}') as canonical_table,
        to_regclass('public.${LEGACY_ORDER_TABLE}') as legacy_table
    `);
    const canonicalExists = Boolean(tables.rows[0]?.canonical_table);
    const legacyExists = Boolean(tables.rows[0]?.legacy_table);

    if (canonicalExists && legacyExists) {
      throw new Error("Both canonical and legacy order tables exist; refusing to choose between two order sources.");
    }

    if (!canonicalExists && legacyExists) {
      await client.query(`alter table ${LEGACY_ORDER_TABLE} rename to ${CANONICAL_ORDER_TABLE}`);
      migrated = true;

      // These names are cosmetic, but renaming them removes misleading
      // provider-specific labels from database diagnostics and future dumps.
      await renameIndexIfPresent(client, "paypal_access_orders_pkey", "access_orders_pkey");
      await renameIndexIfPresent(client, "paypal_access_orders_access_code_key", "access_orders_access_code_key");
      await renameIndexIfPresent(client, "paypal_access_orders_capture_id_key", "access_orders_capture_id_key");
      await renameIndexIfPresent(client, "paypal_access_orders_created_idx", "access_orders_created_idx");
      await renameIndexIfPresent(client, "paypal_access_orders_completed_idx", "access_orders_completed_idx");
    }

    const canonicalNowExists = canonicalExists || migrated;
    if (canonicalNowExists) {
      await client.query(`alter table ${CANONICAL_ORDER_TABLE} add column if not exists payment_method text`);
      if (migrated) {
        await client.query(`
          update ${CANONICAL_ORDER_TABLE}
          set payment_method = 'paypal'
          where payment_method is null or btrim(payment_method) = ''
        `);
      }
    }

    await client.query("commit");
    storageReady = true;
    return { tableName: CANONICAL_ORDER_TABLE, migrated };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    if (shouldRelease) client.release();
  }
}

async function renameIndexIfPresent(client, oldName, newName) {
  const result = await client.query("select to_regclass($1) as index_name", [`public.${oldName}`]);
  if (!result.rows[0]?.index_name) return;
  await client.query(`alter index ${oldName} rename to ${newName}`);
}

function resetOrderStorageForTests() {
  storageReady = false;
}

module.exports = {
  CANONICAL_ORDER_TABLE,
  LEGACY_ORDER_TABLE,
  ensureOrderStorage,
  resetOrderStorageForTests
};
