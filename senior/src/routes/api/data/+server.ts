import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/data — get customers and stores for filter dropdowns */
export const GET: RequestHandler = async () => {
	const customers = await sql`SELECT * FROM customers ORDER BY name`;
	const stores = await sql`
		SELECT s.*, c.name as customer_name
		FROM stores s
		JOIN customers c ON c.id = s.customer_id
		ORDER BY c.name, s.store_code
	`;

	return json({ customers, stores });
};
