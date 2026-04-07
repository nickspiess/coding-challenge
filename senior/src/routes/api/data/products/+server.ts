import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/data/products?customer_id=1&search=banana */
export const GET: RequestHandler = async ({ url }) => {
	const customerId = url.searchParams.get('customer_id');
	const search = url.searchParams.get('search');
	const limit = Number(url.searchParams.get('limit') || 100);
	const offset = Number(url.searchParams.get('offset') || 0);

	const conditions = [];
	const params: Record<string, unknown> = {};

	let query = sql`
		SELECT p.*, c.name as customer_name
		FROM products p
		JOIN customers c ON c.id = p.customer_id
		WHERE 1=1
		${customerId ? sql`AND p.customer_id = ${Number(customerId)}` : sql``}
		${search ? sql`AND (p.description ILIKE ${'%' + search + '%'} OR p.upc_plu ILIKE ${'%' + search + '%'})` : sql``}
		ORDER BY c.name, p.description
		LIMIT ${limit} OFFSET ${offset}
	`;

	const products = await query;

	const [{ count }] = await sql`
		SELECT COUNT(*) as count FROM products p
		WHERE 1=1
		${customerId ? sql`AND p.customer_id = ${Number(customerId)}` : sql``}
		${search ? sql`AND (p.description ILIKE ${'%' + search + '%'} OR p.upc_plu ILIKE ${'%' + search + '%'})` : sql``}
	`;

	return json({ products, total: Number(count) });
};
