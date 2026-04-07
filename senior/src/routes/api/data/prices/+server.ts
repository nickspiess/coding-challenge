import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/data/prices?customer_id=1&store_id=1&upc=123 */
export const GET: RequestHandler = async ({ url }) => {
	const customerId = url.searchParams.get('customer_id');
	const storeId = url.searchParams.get('store_id');
	const upc = url.searchParams.get('upc');
	const limit = Number(url.searchParams.get('limit') || 100);
	const offset = Number(url.searchParams.get('offset') || 0);

	const prices = await sql`
		SELECT pr.*, s.store_code, c.name as customer_name
		FROM prices pr
		JOIN stores s ON s.id = pr.store_id
		JOIN customers c ON c.id = s.customer_id
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		${storeId ? sql`AND pr.store_id = ${Number(storeId)}` : sql``}
		${upc ? sql`AND pr.upc_plu = ${upc}` : sql``}
		ORDER BY c.name, s.store_code, pr.start_date DESC
		LIMIT ${limit} OFFSET ${offset}
	`;

	const [{ count }] = await sql`
		SELECT COUNT(*) as count FROM prices pr
		JOIN stores s ON s.id = pr.store_id
		WHERE 1=1
		${customerId ? sql`AND s.customer_id = ${Number(customerId)}` : sql``}
		${storeId ? sql`AND pr.store_id = ${Number(storeId)}` : sql``}
		${upc ? sql`AND pr.upc_plu = ${upc}` : sql``}
	`;

	return json({ prices, total: Number(count) });
};
