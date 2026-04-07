import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/reviews?job_id=1&status=pending */
export const GET: RequestHandler = async ({ url }) => {
	const jobId = url.searchParams.get('job_id');
	const status = url.searchParams.get('status') || 'pending';

	const items = await sql`
		SELECT rq.*, il.original_filename, c.name as customer_name
		FROM etl_review_queue rq
		JOIN import_log il ON il.id = rq.job_id
		LEFT JOIN customers c ON c.id = il.customer_id
		WHERE rq.status = ${status}
		${jobId ? sql`AND rq.job_id = ${Number(jobId)}` : sql``}
		ORDER BY rq.job_id DESC, rq.row_number ASC
	`;

	const [{ count }] = await sql`
		SELECT COUNT(*) as count FROM etl_review_queue WHERE status = 'pending'
	`;

	return json({ items, pendingCount: Number(count) });
};
