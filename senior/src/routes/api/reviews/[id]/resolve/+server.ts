import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/**
 * POST /api/reviews/:id/resolve
 * Body: { row_data: { ...edited fields } }
 * Re-validates and inserts the corrected row.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const body = await request.json();
	const editedData = body.row_data;

	// Fetch the review item
	const items = await sql`
		SELECT rq.*, il.customer_id
		FROM etl_review_queue rq
		JOIN import_log il ON il.id = rq.job_id
		WHERE rq.id = ${id} AND rq.status = 'pending'
	`;

	if (items.length === 0) {
		return json({ error: 'Review item not found or already resolved' }, { status: 404 });
	}

	const item = items[0];
	const customerId = item.customer_id;
	const fileType = item.file_type;

	// Sanitize "NULL"/"null"/"N/A"/empty strings to actual null
	for (const key of Object.keys(editedData)) {
		const v = editedData[key];
		if (typeof v === 'string') {
			const trimmed = v.trim();
			if (trimmed === 'NULL' || trimmed === 'null' || trimmed === 'N/A' || trimmed === 'n/a' || trimmed === '') {
				editedData[key] = null;
			}
		}
	}

	// Validate and sanitize date fields — reject non-date strings
	const dateKeys = ['start_date', 'end_date', 'sale_time'];
	for (const key of dateKeys) {
		const v = editedData[key];
		if (v == null) continue;
		const s = String(v).trim();
		if (!s) { editedData[key] = null; continue; }
		// Try parsing as date
		const d = new Date(s);
		if (isNaN(d.getTime())) {
			// Not a valid date — clear it rather than crash
			editedData[key] = null;
		} else {
			editedData[key] = d.toISOString();
		}
	}

	// Coerce numeric fields
	const numKeys = ['price', 'unit_price', 'units_sold', 'total_sale', 'price_multiple', 'unit_multiple'];
	for (const key of numKeys) {
		const v = editedData[key];
		if (v == null) continue;
		const n = Number(v);
		editedData[key] = isNaN(n) ? null : n;
	}

	try {
		// Resolve store code — could be in 'store', 'store_code', or 'store_id'
		const storeCode = editedData.store_code ?? editedData.store ?? null;

		if (fileType === 'price' || fileType === 'sale') {
			let storeId: number | null = null;
			if (storeCode) {
				// Upsert store
				const [store] = await sql`
					INSERT INTO stores (customer_id, store_code, name)
					VALUES (${customerId}, ${storeCode}, ${storeCode})
					ON CONFLICT (customer_id, store_code) DO UPDATE SET store_code = EXCLUDED.store_code
					RETURNING id
				`;
				storeId = store.id;
			} else {
				// Fallback: find any existing store or create UNKNOWN
				const [store] = await sql`
					SELECT id FROM stores WHERE customer_id = ${customerId} LIMIT 1
				`;
				if (store) {
					storeId = store.id;
				} else {
					const [newStore] = await sql`
						INSERT INTO stores (customer_id, store_code, name)
						VALUES (${customerId}, ${'UNKNOWN'}, ${'UNKNOWN'})
						ON CONFLICT (customer_id, store_code) DO UPDATE SET store_code = EXCLUDED.store_code
						RETURNING id
					`;
					storeId = newStore.id;
				}
			}

			if (fileType === 'price') {
				await sql`
					INSERT INTO prices (store_id, upc_plu, price, price_type, price_priority, price_multiple, unit_multiple, start_date, end_date)
					VALUES (
						${storeId},
						${editedData.upc_plu ?? null},
						${editedData.price != null ? Number(editedData.price) : 0},
						${editedData.price_type ?? 'REG'},
						${editedData.price_priority ?? null},
						${editedData.price_multiple ?? null},
						${editedData.unit_multiple ?? null},
						${editedData.start_date ?? null},
						${editedData.end_date ?? null}
					)
				`;
			} else {
				await sql`
					INSERT INTO sales (store_id, upc_plu, description, unit_size, sale_time, price_type, unit_price, units_sold, total_sale)
					VALUES (
						${storeId},
						${editedData.upc_plu ?? null},
						${editedData.description ?? null},
						${editedData.unit_size ?? null},
						${editedData.sale_time ?? null},
						${editedData.price_type ?? 'REG'},
						${editedData.unit_price != null ? Number(editedData.unit_price) : null},
						${editedData.units_sold != null ? Number(editedData.units_sold) : null},
						${editedData.total_sale != null ? Number(editedData.total_sale) : null}
					)
				`;
			}
		}

		await sql`
			UPDATE etl_review_queue SET status = 'resolved', resolved_data = ${editedData}, resolved_at = NOW()
			WHERE id = ${id}
		`;

		return json({ success: true });
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};

async function findProductId(customerId: number, upc: string): Promise<number | null> {
	const rows = await sql`SELECT id FROM products WHERE customer_id = ${customerId} AND upc_plu = ${upc}`;
	return rows.length > 0 ? rows[0].id : null;
}
