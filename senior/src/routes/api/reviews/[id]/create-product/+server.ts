import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/**
 * POST /api/reviews/:id/create-product
 * Body: { product: { upc_plu, description, department, category, unit_size, pack_size } }
 * Creates the missing product, then inserts the orphaned sale/price, and resolves the review item.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const body = await request.json();
	const productData = body.product;

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
	const rowData = item.row_data as Record<string, unknown>;
	const fileType = item.file_type;

	try {
		// Create the product
		await sql`
			INSERT INTO products (customer_id, upc_plu, description, department, category, unit_size, pack_size)
			VALUES (${customerId}, ${productData.upc_plu}, ${productData.description ?? null}, ${productData.department ?? null}, ${productData.category ?? null}, ${productData.unit_size ?? null}, ${productData.pack_size ?? null})
			ON CONFLICT (customer_id, upc_plu) DO UPDATE SET
				description = COALESCE(NULLIF(EXCLUDED.description, ''), products.description),
				department = COALESCE(NULLIF(EXCLUDED.department, ''), products.department),
				category = COALESCE(NULLIF(EXCLUDED.category, ''), products.category),
				unit_size = COALESCE(NULLIF(EXCLUDED.unit_size, ''), products.unit_size),
				pack_size = COALESCE(EXCLUDED.pack_size, products.pack_size)
		`;

		const storeCode = String(rowData.store_code);
		const [store] = await sql`
			SELECT id FROM stores WHERE customer_id = ${customerId} AND store_code = ${storeCode}
		`;

		if (!store) {
			return json({ error: `Store ${storeCode} not found` }, { status: 400 });
		}

		// Insert the orphaned row
		if (fileType === 'sale') {
			await sql`
				INSERT INTO sales (store_id, upc_plu, description, unit_size, sale_time, price_type, unit_price, units_sold, total_sale)
				VALUES (${store.id}, ${String(rowData.upc_plu)}, ${String(rowData.description ?? '')}, ${String(rowData.unit_size ?? '')}, ${rowData.sale_time ? String(rowData.sale_time) : null}, ${String(rowData.price_type ?? 'REG')}, ${Number(rowData.unit_price ?? 0)}, ${Number(rowData.units_sold ?? 0)}, ${Number(rowData.total_sale ?? 0)})
			`;
		} else if (fileType === 'price') {
			await sql`
				INSERT INTO prices (store_id, upc_plu, price, price_type, price_priority, start_date, end_date)
				VALUES (${store.id}, ${String(rowData.upc_plu)}, ${Number(rowData.price ?? 0)}, ${String(rowData.price_type ?? 'REG')}, ${rowData.price_priority ? String(rowData.price_priority) : null}, ${rowData.start_date ? String(rowData.start_date) : null}, ${rowData.end_date ? String(rowData.end_date) : null})
			`;
		}

		await sql`
			UPDATE etl_review_queue SET status = 'resolved', resolved_data = ${sql.json({ product: productData, row: rowData } as any)}, resolved_at = NOW()
			WHERE id = ${id}
		`;

		return json({ success: true });
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
