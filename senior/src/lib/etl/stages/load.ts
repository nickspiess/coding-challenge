import sql from '$lib/db';
import type { TransactionSql } from 'postgres';
import type {
	TransformedData,
	LoadResult,
	NormalizedProduct,
	NormalizedPrice,
	NormalizedSale,
	EtlFlagEntry
} from '$lib/types';

/**
 * LOAD STAGE
 *
 * Writes transformed data to PostgreSQL.
 * Products, prices, and sales all share upc_plu — joins happen at query time
 * through stores.customer_id + upc_plu.
 *
 * All inserts are wrapped in a transaction so a partial failure
 * rolls back cleanly — no orphaned rows left in the database.
 */
export async function load(data: TransformedData): Promise<LoadResult> {
	const { filename, fileHash, customerName, fileType, products, prices, sales, flags, heldRows } = data;

	const customerId = await ensureCustomer(customerName);

	// Duplicate check
	const existing = await sql`
		SELECT id FROM import_log
		WHERE customer_id = ${customerId} AND file_hash = ${fileHash}
	`;
	if (existing.length > 0) {
		return {
			jobId: existing[0].id, fileType, customerName, status: 'duplicate',
			rowsTotal: 0, rowsInserted: 0, rowsSkipped: 0, rowsFlagged: 0, rowsHeld: 0,
			error: `Duplicate file: already imported as job #${existing[0].id}`
		};
	}

	const [job] = await sql`
		INSERT INTO import_log (customer_id, file_type, file_hash, original_filename, status)
		VALUES (${customerId}, ${fileType}, ${fileHash}, ${filename}, 'processing')
		RETURNING id
	`;
	const jobId = job.id;

	try {
		let rowsInserted = 0;
		let rowsSkipped = 0;

		await sql.begin(async (tx) => {
			let rowIdMap = new Map<number, number>();

			if (fileType === 'product') {
				const r = await insertProducts(tx, customerId, products);
				rowsInserted = r.inserted;
				rowsSkipped = r.skipped;
				rowIdMap = r.rowIdMap;
			} else if (fileType === 'price') {
				const r = await insertPrices(tx, customerId, prices);
				rowsInserted = r.inserted;
				rowsSkipped = r.skipped;
				rowIdMap = r.rowIdMap;
			} else {
				const r = await insertSales(tx, customerId, sales);
				rowsInserted = r.inserted;
				rowsSkipped = r.skipped;
				rowIdMap = r.rowIdMap;
			}

			// Insert held rows into review queue and track their IDs
			const heldIdMap = new Map<number, number>(); // row_number → review_queue id
			for (const held of heldRows) {
				const [rq] = await tx`
					INSERT INTO etl_review_queue (job_id, row_number, file_type, row_data, flag_type, flag_message)
					VALUES (${jobId}, ${held.row_number}, ${fileType}, ${sql.json(held.row_data)}, ${held.flag_type}, ${held.flag_message})
					RETURNING id
				`;
				heldIdMap.set(held.row_number, rq.id);
			}

			if (flags.length > 0) await saveFlags(tx, jobId, flags, fileType, rowIdMap, heldIdMap);
		});

		const rowsHeld = heldRows.length;
		const rowsTotal = rowsInserted + rowsSkipped + rowsHeld;

		await sql`
			UPDATE import_log SET
				status = 'completed', rows_total = ${rowsTotal},
				rows_inserted = ${rowsInserted}, rows_skipped = ${rowsSkipped},
				rows_flagged = ${flags.length}, rows_held = ${rowsHeld}, completed_at = NOW()
			WHERE id = ${jobId}
		`;

		return { jobId, fileType, customerName, status: 'completed',
			rowsTotal, rowsInserted, rowsSkipped, rowsFlagged: flags.length, rowsHeld };
	} catch (err) {
		const errorMsg = err instanceof Error ? err.message : String(err);
		await sql`
			UPDATE import_log SET status = 'failed', error_message = ${errorMsg}, completed_at = NOW()
			WHERE id = ${jobId}
		`;
		return { jobId, fileType, customerName, status: 'failed',
			rowsTotal: 0, rowsInserted: 0, rowsSkipped: 0, rowsFlagged: 0, rowsHeld: 0, error: errorMsg };
	}
}

// ─── DB Helpers ────────────────────────────────────────────────

async function ensureCustomer(name: string): Promise<number> {
	const [row] = await sql`
		INSERT INTO customers (name) VALUES (${name})
		ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
		RETURNING id
	`;
	return row.id;
}

async function ensureStore(tx: TransactionSql, customerId: number, storeCode: string): Promise<number> {
	const [row] = await tx`
		INSERT INTO stores (customer_id, store_code, name)
		VALUES (${customerId}, ${storeCode}, ${storeCode})
		ON CONFLICT (customer_id, store_code) DO UPDATE SET store_code = EXCLUDED.store_code
		RETURNING id
	`;
	return row.id;
}

// ─── Inserters ─────────────────────────────────────────────────

async function insertProducts(
	tx: TransactionSql,
	customerId: number,
	products: NormalizedProduct[]
): Promise<{ inserted: number; skipped: number; rowIdMap: Map<number, number> }> {
	let inserted = 0;
	let skipped = 0;
	const rowIdMap = new Map<number, number>();

	for (const p of products) {
		const result = await tx`
			INSERT INTO products (customer_id, upc_plu, description, department, category, unit_size, pack_size, link_code)
			VALUES (${customerId}, ${p.upc_plu}, ${p.description}, ${p.department}, ${p.category}, ${p.unit_size}, ${p.pack_size}, ${p.link_code})
			ON CONFLICT (customer_id, upc_plu) DO UPDATE SET
				description = COALESCE(NULLIF(EXCLUDED.description, ''), products.description),
				department = COALESCE(NULLIF(EXCLUDED.department, ''), products.department),
				category = COALESCE(NULLIF(EXCLUDED.category, ''), products.category),
				unit_size = COALESCE(NULLIF(EXCLUDED.unit_size, ''), products.unit_size),
				pack_size = COALESCE(EXCLUDED.pack_size, products.pack_size),
				link_code = COALESCE(EXCLUDED.link_code, products.link_code)
			RETURNING id
		`;
		if (result.length > 0) {
			inserted++;
			if (p._source_row != null) rowIdMap.set(p._source_row, result[0].id);
		} else {
			skipped++;
		}
	}

	return { inserted, skipped, rowIdMap };
}

async function insertPrices(
	tx: TransactionSql,
	customerId: number,
	prices: NormalizedPrice[]
): Promise<{ inserted: number; skipped: number; rowIdMap: Map<number, number> }> {
	let inserted = 0;
	const skipped = 0;
	const storeCache = new Map<string, number>();
	const rowIdMap = new Map<number, number>();

	for (const p of prices) {
		let storeId = storeCache.get(p.store_code);
		if (!storeId) {
			storeId = await ensureStore(tx, customerId, p.store_code);
			storeCache.set(p.store_code, storeId);
		}

		const [row] = await tx`
			INSERT INTO prices (store_id, upc_plu, price, price_type, price_priority, price_multiple, unit_multiple, start_date, end_date)
			VALUES (${storeId}, ${p.upc_plu}, ${p.price}, ${p.price_type}, ${p.price_priority}, ${p.price_multiple}, ${p.unit_multiple}, ${p.start_date}, ${p.end_date})
			RETURNING id
		`;
		if (p._source_row != null) rowIdMap.set(p._source_row, row.id);
		inserted++;
	}

	return { inserted, skipped, rowIdMap };
}

async function insertSales(
	tx: TransactionSql,
	customerId: number,
	sales: NormalizedSale[]
): Promise<{ inserted: number; skipped: number; rowIdMap: Map<number, number> }> {
	let inserted = 0;
	const skipped = 0;
	const storeCache = new Map<string, number>();
	const rowIdMap = new Map<number, number>();

	for (const s of sales) {
		let storeId = storeCache.get(s.store_code);
		if (!storeId) {
			storeId = await ensureStore(tx, customerId, s.store_code);
			storeCache.set(s.store_code, storeId);
		}

		const [row] = await tx`
			INSERT INTO sales (store_id, upc_plu, description, unit_size, sale_time, price_type, unit_price, units_sold, total_sale)
			VALUES (${storeId}, ${s.upc_plu}, ${s.description}, ${s.unit_size}, ${s.sale_time}, ${s.price_type}, ${s.unit_price}, ${s.units_sold}, ${s.total_sale})
			RETURNING id
		`;
		if (s._source_row != null) rowIdMap.set(s._source_row, row.id);
		inserted++;
	}

	return { inserted, skipped, rowIdMap };
}

async function saveFlags(
	tx: TransactionSql,
	jobId: number,
	flags: EtlFlagEntry[],
	fileType: string,
	rowIdMap: Map<number, number>,
	heldIdMap: Map<number, number>
): Promise<void> {
	const dataTable = fileType === 'product' ? 'products' : fileType === 'price' ? 'prices' : 'sales';

	for (const f of flags) {
		let recordId: number | null = null;
		let recordTable: string | null = null;

		if (f.row_number != null) {
			// Check if this row was inserted into a data table (warning-level)
			const dataId = rowIdMap.get(f.row_number);
			if (dataId != null) {
				recordId = dataId;
				recordTable = dataTable;
			} else {
				// Check if this row was held in review queue (error-level)
				const heldId = heldIdMap.get(f.row_number);
				if (heldId != null) {
					recordId = heldId;
					recordTable = 'etl_review_queue';
				}
			}
		}

		await tx`
			INSERT INTO etl_flags (job_id, row_number, column_name, original_value, flag_type, severity, message, record_id, record_table)
			VALUES (${jobId}, ${f.row_number}, ${f.column_name ?? null}, ${f.original_value ?? null}, ${f.flag_type}, ${f.severity}, ${f.message}, ${recordId}, ${recordTable})
		`;
	}
}
