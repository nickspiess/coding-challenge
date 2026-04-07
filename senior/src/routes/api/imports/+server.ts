import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/imports — list all import jobs with customer name */
export const GET: RequestHandler = async ({ url }) => {
	const customerId = url.searchParams.get('customer_id');

	let jobs;
	if (customerId) {
		jobs = await sql`
			SELECT il.*, c.name as customer_name
			FROM import_log il
			LEFT JOIN customers c ON c.id = il.customer_id
			WHERE il.customer_id = ${Number(customerId)}
			ORDER BY il.created_at DESC
		`;
	} else {
		jobs = await sql`
			SELECT il.*, c.name as customer_name
			FROM import_log il
			LEFT JOIN customers c ON c.id = il.customer_id
			ORDER BY il.created_at DESC
		`;
	}

	return json({ jobs });
};
