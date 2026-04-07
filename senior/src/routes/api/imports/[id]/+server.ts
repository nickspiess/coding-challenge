import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** DELETE /api/imports/:id — remove an import job and its flags/reviews (clears duplicate hash) */
export const DELETE: RequestHandler = async ({ params }) => {
	const jobId = Number(params.id);

	const [job] = await sql`SELECT * FROM import_log WHERE id = ${jobId}`;
	if (!job) throw error(404, 'Import job not found');

	// etl_flags and etl_review_queue cascade on import_log delete
	await sql`DELETE FROM import_log WHERE id = ${jobId}`;

	return json({ success: true });
};
