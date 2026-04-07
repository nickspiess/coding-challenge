import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import sql from '$lib/db';

/** POST /api/reviews/:id/discard — discard a held review item */
export const POST: RequestHandler = async ({ params }) => {
	const id = Number(params.id);

	const result = await sql`
		UPDATE etl_review_queue SET status = 'discarded', resolved_at = NOW()
		WHERE id = ${id} AND status = 'pending'
		RETURNING id
	`;

	if (result.length === 0) {
		return json({ error: 'Review item not found or already resolved' }, { status: 404 });
	}

	return json({ success: true });
};
