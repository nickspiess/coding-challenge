import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/**
 * POST /api/products
 * Body: { customer_id, upc_plu, description?, department?, category?, unit_size?, pack_size? }
 * Creates or updates a product stub. Safe to call before or after CSV import.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { customer_id, upc_plu, description, department, category, unit_size, pack_size } = body;

	if (!customer_id || !upc_plu) {
		return json({ error: 'customer_id and upc_plu are required' }, { status: 400 });
	}

	try {
		const [product] = await sql`
			INSERT INTO products (customer_id, upc_plu, description, department, category, unit_size, pack_size)
			VALUES (${customer_id}, ${upc_plu}, ${description ?? null}, ${department ?? null}, ${category ?? null}, ${unit_size ?? null}, ${pack_size ?? null})
			ON CONFLICT (customer_id, upc_plu) DO UPDATE SET
				description = COALESCE(NULLIF(EXCLUDED.description, ''), products.description),
				department = COALESCE(NULLIF(EXCLUDED.department, ''), products.department),
				category = COALESCE(NULLIF(EXCLUDED.category, ''), products.category),
				unit_size = COALESCE(NULLIF(EXCLUDED.unit_size, ''), products.unit_size),
				pack_size = COALESCE(EXCLUDED.pack_size, products.pack_size)
			RETURNING id, customer_id, upc_plu, description, department, category, unit_size, pack_size
		`;

		return json({ success: true, product });
	} catch (err) {
		return json({ error: String(err) }, { status: 500 });
	}
};
