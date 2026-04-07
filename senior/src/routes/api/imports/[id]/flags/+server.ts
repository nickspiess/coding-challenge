import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** GET /api/imports/:id/flags — get quality flags for a specific import job */
export const GET: RequestHandler = async ({ params }) => {
	const jobId = Number(params.id);

	const flags = await sql`
		SELECT * FROM etl_flags
		WHERE job_id = ${jobId}
		ORDER BY row_number ASC
	`;

	return json({ flags });
};
