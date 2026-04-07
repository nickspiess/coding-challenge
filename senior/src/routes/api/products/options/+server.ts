import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/**
 * GET /api/products/options?customer_id=1
 * Returns distinct departments and categories for the given customer,
 * used to populate datalist suggestions in the Create Product modal.
 * Users can still type custom values not in the list.
 */
export const GET: RequestHandler = async ({ url }) => {
	const customerId = url.searchParams.get('customer_id');

	if (!customerId) {
		return json({ error: 'customer_id is required' }, { status: 400 });
	}

	const departments = await sql`
		SELECT DISTINCT department
		FROM products
		WHERE customer_id = ${Number(customerId)}
			AND department IS NOT NULL AND department != ''
		ORDER BY department
	`;

	const categories = await sql`
		SELECT DISTINCT category, department
		FROM products
		WHERE customer_id = ${Number(customerId)}
			AND category IS NOT NULL AND category != ''
		ORDER BY category
	`;

	return json({
		departments: departments.map((r) => r.department),
		categories: categories.map((r) => ({ category: r.category, department: r.department }))
	});
};
