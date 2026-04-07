import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/imports/:id/flags/:flagId — fetch the flag and its linked record or held row */
export const GET: RequestHandler = async ({ params }) => {
	const flagId = Number(params.flagId);

	const [flag] = await sql`SELECT * FROM etl_flags WHERE id = ${flagId}`;
	if (!flag) throw error(404, 'Flag not found');
	if (!flag.record_id || !flag.record_table) {
		return json({ flag, record: null });
	}

	let record = null;

	if (flag.record_table === 'etl_review_queue') {
		// Held row — return the raw row_data as the editable record
		const [rq] = await sql`SELECT * FROM etl_review_queue WHERE id = ${flag.record_id}`;
		if (rq) record = rq.row_data;
	} else if (flag.record_table === 'sales') {
		const [row] = await sql`SELECT * FROM sales WHERE id = ${flag.record_id}`;
		record = row ?? null;
	} else if (flag.record_table === 'prices') {
		const [row] = await sql`SELECT * FROM prices WHERE id = ${flag.record_id}`;
		record = row ?? null;
	} else if (flag.record_table === 'products') {
		const [row] = await sql`SELECT * FROM products WHERE id = ${flag.record_id}`;
		record = row ?? null;
	}

	return json({ flag, record });
};

/** PATCH /api/imports/:id/flags/:flagId — update the linked record or resolve a held row */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const flagId = Number(params.flagId);
	const jobId = Number(params.id);
	const { updates } = await request.json();

	const [flag] = await sql`SELECT * FROM etl_flags WHERE id = ${flagId}`;
	if (!flag) throw error(404, 'Flag not found');
	if (!flag.record_id || !flag.record_table) throw error(400, 'Flag has no linked record');

	// Sanitize "NULL"/"null"/"N/A" strings to actual null
	for (const key of Object.keys(updates)) {
		const v = updates[key];
		if (typeof v === 'string') {
			const trimmed = v.trim();
			if (trimmed === 'NULL' || trimmed === 'null' || trimmed === 'N/A' || trimmed === 'n/a' || trimmed === '') {
				updates[key] = null;
			}
		}
	}

	if (flag.record_table === 'etl_review_queue') {
		// Resolve a held row: look up the review item, insert into the real table
		const [rq] = await sql`SELECT * FROM etl_review_queue WHERE id = ${flag.record_id}`;
		if (!rq) throw error(404, 'Review queue item not found');

		const [job] = await sql`SELECT * FROM import_log WHERE id = ${jobId}`;
		if (!job) throw error(404, 'Import job not found');

		// Ensure store exists for price/sale rows
		const storeCode = updates.store ?? updates.store_code ?? '';
		let storeId: number | null = null;
		if (rq.file_type === 'price' || rq.file_type === 'sale') {
			if (storeCode) {
				const [store] = await sql`
					INSERT INTO stores (customer_id, store_code, name)
					VALUES (${job.customer_id}, ${storeCode}, ${storeCode})
					ON CONFLICT (customer_id, store_code) DO UPDATE SET store_code = EXCLUDED.store_code
					RETURNING id
				`;
				storeId = store.id;
			} else {
				// Try to find existing store for this customer
				const [store] = await sql`
					SELECT id FROM stores WHERE customer_id = ${job.customer_id} LIMIT 1
				`;
				storeId = store?.id ?? null;
			}
		}

		// If no store could be resolved for price/sale, create a default one
		if ((rq.file_type === 'price' || rq.file_type === 'sale') && !storeId) {
			const [store] = await sql`
				INSERT INTO stores (customer_id, store_code, name)
				VALUES (${job.customer_id}, ${'UNKNOWN'}, ${'UNKNOWN'})
				ON CONFLICT (customer_id, store_code) DO UPDATE SET store_code = EXCLUDED.store_code
				RETURNING id
			`;
			storeId = store.id;
		}

		if (rq.file_type === 'sale' && storeId) {
			await sql`
				INSERT INTO sales (store_id, upc_plu, description, unit_size, sale_time, price_type, unit_price, units_sold, total_sale)
				VALUES (
					${storeId},
					${updates.upc_plu ?? null},
					${updates.description ?? null},
					${updates.unit_size ?? null},
					${updates.sale_time ?? null},
					${updates.price_type ?? 'REG'},
					${updates.unit_price != null ? Number(updates.unit_price) : null},
					${updates.units_sold != null ? Number(updates.units_sold) : null},
					${updates.total_sale != null ? Number(updates.total_sale) : null}
				)
			`;
		} else if (rq.file_type === 'price' && storeId) {
			await sql`
				INSERT INTO prices (store_id, upc_plu, price, price_type, price_priority, price_multiple, unit_multiple, start_date, end_date)
				VALUES (
					${storeId},
					${updates.upc_plu ?? null},
					${updates.price != null ? Number(updates.price) : 0},
					${updates.price_type ?? 'REG'},
					${updates.price_priority ?? null},
					${updates.price_multiple != null ? Number(updates.price_multiple) : null},
					${updates.unit_multiple != null ? Number(updates.unit_multiple) : null},
					${updates.start_date ?? null},
					${updates.end_date ?? null}
				)
			`;
		} else if (rq.file_type === 'product') {
			await sql`
				INSERT INTO products (customer_id, upc_plu, description, department, category, unit_size, pack_size, link_code)
				VALUES (
					${job.customer_id},
					${updates.upc_plu ?? null},
					${updates.description ?? null},
					${updates.department ?? null},
					${updates.category ?? null},
					${updates.unit_size ?? null},
					${updates.pack_size ?? null},
					${updates.link_code ?? null}
				)
				ON CONFLICT (customer_id, upc_plu) DO UPDATE SET
					description = COALESCE(NULLIF(EXCLUDED.description, ''), products.description),
					department = COALESCE(NULLIF(EXCLUDED.department, ''), products.department),
					category = COALESCE(NULLIF(EXCLUDED.category, ''), products.category),
					unit_size = COALESCE(NULLIF(EXCLUDED.unit_size, ''), products.unit_size)
			`;
		}

		// Mark review item resolved
		await sql`
			UPDATE etl_review_queue SET status = 'resolved', resolved_data = ${updates}, resolved_at = NOW()
			WHERE id = ${flag.record_id}
		`;

		// Update import_log: one more inserted, one less held
		await sql`
			UPDATE import_log SET
				rows_inserted = rows_inserted + 1,
				rows_held = GREATEST(rows_held - 1, 0)
			WHERE id = ${jobId}
		`;
	} else if (flag.record_table === 'sales') {
		await sql`
			UPDATE sales SET
				description = ${updates.description ?? null},
				unit_size = ${updates.unit_size ?? null},
				sale_time = ${updates.sale_time ?? null},
				price_type = ${updates.price_type ?? null},
				unit_price = ${updates.unit_price != null ? Number(updates.unit_price) : null},
				units_sold = ${updates.units_sold != null ? Number(updates.units_sold) : null},
				total_sale = ${updates.total_sale != null ? Number(updates.total_sale) : null}
			WHERE id = ${flag.record_id}
		`;
	} else if (flag.record_table === 'prices') {
		await sql`
			UPDATE prices SET
				price = ${updates.price != null ? Number(updates.price) : 0},
				price_type = ${updates.price_type ?? null},
				price_priority = ${updates.price_priority ?? null},
				price_multiple = ${updates.price_multiple != null ? Number(updates.price_multiple) : null},
				unit_multiple = ${updates.unit_multiple != null ? Number(updates.unit_multiple) : null},
				start_date = ${updates.start_date ?? null},
				end_date = ${updates.end_date ?? null}
			WHERE id = ${flag.record_id}
		`;
	} else if (flag.record_table === 'products') {
		await sql`
			UPDATE products SET
				description = ${updates.description ?? null},
				department = ${updates.department ?? null},
				category = ${updates.category ?? null},
				unit_size = ${updates.unit_size ?? null},
				pack_size = ${updates.pack_size ?? null},
				link_code = ${updates.link_code ?? null}
			WHERE id = ${flag.record_id}
		`;
	}

	// Remove the resolved flag
	await sql`DELETE FROM etl_flags WHERE id = ${flagId}`;

	// Update the import_log flag count
	const [{ remaining }] = await sql`
		SELECT COUNT(*)::int as remaining FROM etl_flags WHERE job_id = ${jobId}
	`;
	await sql`UPDATE import_log SET rows_flagged = ${remaining} WHERE id = ${jobId}`;

	return json({ success: true });
};

/** DELETE /api/imports/:id/flags/:flagId — delete/discard the linked record and the flag */
export const DELETE: RequestHandler = async ({ params }) => {
	const flagId = Number(params.flagId);
	const jobId = Number(params.id);

	const [flag] = await sql`SELECT * FROM etl_flags WHERE id = ${flagId}`;
	if (!flag) throw error(404, 'Flag not found');

	if (flag.record_id && flag.record_table) {
		if (flag.record_table === 'etl_review_queue') {
			// Discard the held row
			await sql`
				UPDATE etl_review_queue SET status = 'discarded', resolved_at = NOW()
				WHERE id = ${flag.record_id}
			`;
			await sql`
				UPDATE import_log SET rows_held = GREATEST(rows_held - 1, 0)
				WHERE id = ${jobId}
			`;
		} else if (flag.record_table === 'sales') {
			await sql`DELETE FROM sales WHERE id = ${flag.record_id}`;
			await sql`UPDATE import_log SET rows_inserted = GREATEST(rows_inserted - 1, 0) WHERE id = ${jobId}`;
		} else if (flag.record_table === 'prices') {
			await sql`DELETE FROM prices WHERE id = ${flag.record_id}`;
			await sql`UPDATE import_log SET rows_inserted = GREATEST(rows_inserted - 1, 0) WHERE id = ${jobId}`;
		} else if (flag.record_table === 'products') {
			await sql`DELETE FROM products WHERE id = ${flag.record_id}`;
			await sql`UPDATE import_log SET rows_inserted = GREATEST(rows_inserted - 1, 0) WHERE id = ${jobId}`;
		}
	}

	// Remove the flag
	await sql`DELETE FROM etl_flags WHERE id = ${flagId}`;

	// Update flag count
	const [{ remaining }] = await sql`
		SELECT COUNT(*)::int as remaining FROM etl_flags WHERE job_id = ${jobId}
	`;
	await sql`UPDATE import_log SET rows_flagged = ${remaining} WHERE id = ${jobId}`;

	return json({ success: true });
};
