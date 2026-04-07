import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/data/sales?customer_id=1&store_id=1&upc=123 */
export const GET: RequestHandler = async ({ url }) => {
	const customerId = url.searchParams.get('customer_id');
	const storeId = url.searchParams.get('store_id');
	const upc = url.searchParams.get('upc');
	const limit = Number(url.searchParams.get('limit') || 100);
	const offset = Number(url.searchParams.get('offset') || 0);

	const sales = await sql`
		SELECT sa.*, s.store_code, c.name as customer_name
		FROM sales sa
		JOIN stores s ON s.id = sa.store_id
		JOIN customers c ON c.id = s.customer_id
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		${storeId ? sql`AND sa.store_id = ${Number(storeId)}` : sql``}
		${upc ? sql`AND sa.upc_plu = ${upc}` : sql``}
		ORDER BY sa.sale_time DESC
		LIMIT ${limit} OFFSET ${offset}
	`;

	const [{ count }] = await sql`
		SELECT COUNT(*) as count FROM sales sa
		JOIN stores s ON s.id = sa.store_id
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		${storeId ? sql`AND sa.store_id = ${Number(storeId)}` : sql``}
		${upc ? sql`AND sa.upc_plu = ${upc}` : sql``}
	`;

	// Aggregates for the filtered set
	const [agg] = await sql`
		SELECT
			COALESCE(SUM(sa.total_sale), 0) as total_revenue,
			COALESCE(SUM(sa.units_sold), 0) as total_units,
			COUNT(*) as transaction_count
		FROM sales sa
		JOIN stores s ON s.id = sa.store_id
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		${storeId ? sql`AND sa.store_id = ${Number(storeId)}` : sql``}
		${upc ? sql`AND sa.upc_plu = ${upc}` : sql``}
	`;

	return json({
		sales,
		total: Number(count),
		aggregates: {
			total_revenue: Number(agg.total_revenue),
			total_units: Number(agg.total_units),
			transaction_count: Number(agg.transaction_count)
		}
	});
};
