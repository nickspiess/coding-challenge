import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/**
 * GET /api/data/charts?customer_id=1&store_id=1
 *
 * Returns data for all dashboard charts in one call:
 * - salesByCategory: revenue per department/category
 * - revenueByStore: revenue per store (within selected customer or all)
 * - topProducts: top 10 products by revenue
 * - priceTypeMix: count of prices by price_type
 */
export const GET: RequestHandler = async ({ url }) => {
	const customerId = url.searchParams.get('customer_id');
	const storeId = url.searchParams.get('store_id');

	// 1. Sales by department/category
	const salesByCategory = await sql`
		SELECT
			COALESCE(NULLIF(p.department, ''), 'Unknown') as label,
			SUM(sa.total_sale) as value
		FROM sales sa
		JOIN stores s ON s.id = sa.store_id
		LEFT JOIN products p ON p.customer_id = s.customer_id AND p.upc_plu = sa.upc_plu
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		${storeId ? sql`AND sa.store_id = ${Number(storeId)}` : sql``}
		GROUP BY label
		ORDER BY value DESC
		LIMIT 10
	`;

	// 2. Revenue by store
	const revenueByStore = await sql`
		SELECT
			c.name || ' — ' || s.store_code as label,
			SUM(sa.total_sale) as value
		FROM sales sa
		JOIN stores s ON s.id = sa.store_id
		JOIN customers c ON c.id = s.customer_id
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		GROUP BY c.name, s.store_code
		ORDER BY value DESC
	`;

	// 3. Top 10 products by revenue
	const topProducts = await sql`
		SELECT
			COALESCE(p.description, sa.upc_plu) as label,
			SUM(sa.total_sale) as value
		FROM sales sa
		JOIN stores s ON s.id = sa.store_id
		LEFT JOIN products p ON p.customer_id = s.customer_id AND p.upc_plu = sa.upc_plu
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		${storeId ? sql`AND sa.store_id = ${Number(storeId)}` : sql``}
		GROUP BY label
		ORDER BY value DESC
		LIMIT 10
	`;

	// 4. Price type breakdown
	const priceTypeMix = await sql`
		SELECT
			COALESCE(pr.price_type, 'Unknown') as label,
			COUNT(*)::int as value
		FROM prices pr
		JOIN stores s ON s.id = pr.store_id
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		${storeId ? sql`AND pr.store_id = ${Number(storeId)}` : sql``}
		GROUP BY label
		ORDER BY value DESC
	`;

	return json({
		salesByCategory: salesByCategory.map((r) => ({ label: r.label, value: Number(r.value) })),
		revenueByStore: revenueByStore.map((r) => ({ label: r.label, value: Number(r.value) })),
		topProducts: topProducts.map((r) => ({ label: r.label, value: Number(r.value) })),
		priceTypeMix: priceTypeMix.map((r) => ({ label: r.label, value: Number(r.value) }))
	});
};
