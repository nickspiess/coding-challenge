import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** POST /api/reset — truncate all data tables */
export const POST: RequestHandler = async () => {
	await sql`
		TRUNCATE sales, prices, products, etl_flags, etl_review_queue, import_log, stores, customers
		RESTART IDENTITY CASCADE
	`;
	return json({ success: true });
};
