import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { pipeline, validateHeaders } from '$lib/etl/pipeline';
import type { PipelineOverrides } from '$lib/etl/pipeline';
import type { LoadResult } from '$lib/types';

export const POST: RequestHandler = async ({ request }) => {
	const formData = await request.formData();
	const files = formData.getAll('files') as File[];

	if (files.length === 0) {
		return json({ error: 'No files provided' }, { status: 400 });
	}

	// Custom vendor/type overrides from the UI checkbox flow
	const customCustomerName = formData.get('customCustomerName') as string | null;
	const customFileType = formData.get('customFileType') as string | null;

	const overrides: PipelineOverrides | undefined =
		customCustomerName
			? {
				customerName: customCustomerName,
				fileType: customFileType as 'product' | 'price' | 'sale' | undefined
			}
			: undefined;

	const results: (LoadResult & { detected?: boolean; warnings?: string[] })[] = [];

	try {
		for (const file of files) {
			const content = await file.text();

			// If no overrides, do a pre-check to see if detection succeeded
			if (!overrides) {
				const extracted = pipeline.extract(file.name, content);
				if (!extracted.detected) {
					results.push({
						jobId: 0,
						fileType: extracted.fileType,
						customerName: 'Unknown',
						status: 'failed',
						rowsTotal: extracted.rows.length,
						rowsInserted: 0,
						rowsSkipped: 0,
						rowsFlagged: 0,
						rowsHeld: 0,
						detected: false,
						error: `Could not detect vendor for "${file.name}". Use the custom store option to specify the vendor and store.`
					});
					continue;
				}
			}

			const result = await pipeline.run(file.name, content, overrides);

			// Collect any missing-expected-column warnings
			const extracted = pipeline.extract(file.name, content, overrides);
			const validation = validateHeaders(extracted.headers, extracted.fileType);
			const warnings: string[] = [];
			if (validation.missingExpected.length > 0) {
				warnings.push(
					`Optional columns not found: ${validation.missingExpected.join(', ')}. Data may be incomplete.`
				);
			}

			results.push({ ...result, detected: true, warnings });
		}
	} catch (err) {
		console.error('Upload error:', err);
		return json({ error: String(err) }, { status: 500 });
	}

	return json({ results });
};
