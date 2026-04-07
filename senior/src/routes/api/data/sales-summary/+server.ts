import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/data/sales-summary — aggregated sales by product per store */
export const GET: RequestHandler = async ({ url }) => {
	const customerId = url.searchParams.get('customer_id');
	const storeId = url.searchParams.get('store_id');
	const orphanOnly = url.searchParams.get('orphan_only') === 'true';
	const limit = Number(url.searchParams.get('limit') || 50);
	const offset = Number(url.searchParams.get('offset') || 0);

	const rows = await sql`
		SELECT * FROM (
			SELECT
				sa.upc_plu,
				s.store_code,
				s.customer_id,
				c.name as customer_name,
				p.description,
				p.department,
				p.category,
				sa.description as sale_description,
				sa.unit_size as sale_unit_size,
				COUNT(*)::int as transaction_count,
				SUM(sa.units_sold) as total_units,
				SUM(sa.total_sale) as total_revenue,
				AVG(sa.unit_price) as avg_unit_price,
				MIN(sa.sale_time) as first_sale,
				MAX(sa.sale_time) as last_sale,
				CASE WHEN p.id IS NULL THEN true ELSE false END as is_orphan,
				'sales' as source
			FROM sales sa
			JOIN stores s ON s.id = sa.store_id
			JOIN customers c ON c.id = s.customer_id
			LEFT JOIN products p ON p.customer_id = s.customer_id AND p.upc_plu = sa.upc_plu
			WHERE 1=1
			${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
			${storeId ? sql`AND sa.store_id = ${Number(storeId)}` : sql``}
			${orphanOnly ? sql`AND p.id IS NULL` : sql``}
			GROUP BY sa.upc_plu, s.store_code, s.customer_id, c.name, p.id, p.description, p.department, p.category, sa.description, sa.unit_size

			UNION ALL

			SELECT
				pr.upc_plu,
				s.store_code,
				s.customer_id,
				c.name as customer_name,
				NULL::text as description,
				NULL::text as department,
				NULL::text as category,
				NULL::text as sale_description,
				NULL::text as sale_unit_size,
				0::int as transaction_count,
				0::numeric as total_units,
				0::numeric as total_revenue,
				AVG(pr.price) as avg_unit_price,
				MIN(pr.start_date)::timestamptz as first_sale,
				MAX(COALESCE(pr.end_date, pr.start_date))::timestamptz as last_sale,
				true as is_orphan,
				'prices' as source
			FROM prices pr
			JOIN stores s ON s.id = pr.store_id
			JOIN customers c ON c.id = s.customer_id
			LEFT JOIN products p ON p.customer_id = s.customer_id AND p.upc_plu = pr.upc_plu
			WHERE p.id IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM sales sa WHERE sa.upc_plu = pr.upc_plu AND sa.store_id = pr.store_id
			)
			${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
			${storeId ? sql`AND pr.store_id = ${Number(storeId)}` : sql``}
			GROUP BY pr.upc_plu, s.store_code, s.customer_id, c.name
		) combined
		ORDER BY total_revenue DESC
		LIMIT ${limit} OFFSET ${offset}
	`;

	const [{ count }] = await sql`
		SELECT COUNT(*)::int as count FROM (
			SELECT sa.upc_plu, s.store_code
			FROM sales sa
			JOIN stores s ON s.id = sa.store_id
			LEFT JOIN products p ON p.customer_id = s.customer_id AND p.upc_plu = sa.upc_plu
			WHERE 1=1
			${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
			${storeId ? sql`AND sa.store_id = ${Number(storeId)}` : sql``}
			${orphanOnly ? sql`AND p.id IS NULL` : sql``}
			GROUP BY sa.upc_plu, s.store_code

			UNION ALL

			SELECT pr.upc_plu, s.store_code
			FROM prices pr
			JOIN stores s ON s.id = pr.store_id
			LEFT JOIN products p ON p.customer_id = s.customer_id AND p.upc_plu = pr.upc_plu
			WHERE p.id IS NULL
			AND NOT EXISTS (
				SELECT 1 FROM sales sa WHERE sa.upc_plu = pr.upc_plu AND sa.store_id = pr.store_id
			)
			${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
			${storeId ? sql`AND pr.store_id = ${Number(storeId)}` : sql``}
			GROUP BY pr.upc_plu, s.store_code
		) sub
	`;

	const [{ orphan_count }] = await sql`
		SELECT COUNT(*)::int as orphan_count FROM (
			SELECT DISTINCT upc_plu, customer_id FROM (
				SELECT sa.upc_plu, s.customer_id
				FROM sales sa
				JOIN stores s ON s.id = sa.store_id
				LEFT JOIN products p ON p.customer_id = s.customer_id AND p.upc_plu = sa.upc_plu
				WHERE p.id IS NULL
				${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
				${storeId ? sql`AND sa.store_id = ${Number(storeId)}` : sql``}

				UNION

				SELECT pr.upc_plu, s.customer_id
				FROM prices pr
				JOIN stores s ON s.id = pr.store_id
				LEFT JOIN products p ON p.customer_id = s.customer_id AND p.upc_plu = pr.upc_plu
				WHERE p.id IS NULL
				${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
				${storeId ? sql`AND pr.store_id = ${Number(storeId)}` : sql``}
			) all_orphans
		) sub
	`;

	return json({ rows, total: Number(count), orphan_count: Number(orphan_count) });
};
