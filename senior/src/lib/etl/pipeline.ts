import { extract } from './stages/extract';
import { transform } from './stages/transform';
import { load } from './stages/load';
import type { RawExtraction, TransformedData, LoadResult, FileType } from '$lib/types';

export interface PipelineOverrides {
	customerName?: string;
	fileType?: 'product' | 'price' | 'sale';
}

// ─── Header Validation ────────────────────────────────────────
// Required: upload fails if none of these are found
// Expected: warning flag but upload continues

const REQUIRED_HEADERS: Record<FileType, string[]> = {
	product: ['upc_plu'],
	price: ['upc_plu', 'price'],
	sale: ['upc_plu']
};

const EXPECTED_HEADERS: Record<FileType, string[]> = {
	product: ['description', 'department', 'category'],
	price: ['price_type', 'start_date'],
	sale: ['sale_time', 'units_sold', 'total_sale']
};

export interface HeaderValidation {
	valid: boolean;
	missingRequired: string[];
	missingExpected: string[];
}

/**
 * Check that extracted headers contain the columns needed for
 * the detected/selected file type. Runs after alias resolution
 * so alternative column names have already been normalized.
 */
export function validateHeaders(headers: string[], fileType: FileType): HeaderValidation {
	const required = REQUIRED_HEADERS[fileType];
	const expected = EXPECTED_HEADERS[fileType];

	const headerSet = new Set(headers);
	const missingRequired = required.filter((h) => !headerSet.has(h));
	const missingExpected = expected.filter((h) => !headerSet.has(h));

	return {
		valid: missingRequired.length === 0,
		missingRequired,
		missingExpected
	};
}

/**
 * PIPELINE ORCHESTRATOR
 *
 * Chains Extract → Transform → Load for a single file.
 * Each stage has serializable I/O — could be split into
 * independent services with a message queue between stages.
 *
 * Usage:
 *   const result = await pipeline.run(filename, csvContent);
 *   // or run stages individually:
 *   const raw = pipeline.extract(filename, content);
 *   const transformed = pipeline.transform(raw);
 *   const result = await pipeline.load(transformed);
 */
export const pipeline = {
	/** Stage 1: Parse CSV, detect format, compute hash */
	extract(filename: string, content: string, overrides?: PipelineOverrides): RawExtraction {
		return extract(filename, content, overrides);
	},

	/** Stage 2: Normalize, clean, validate, flag */
	transform(extraction: RawExtraction): TransformedData {
		return transform(extraction);
	},

	/** Stage 3: Write to database */
	async load(data: TransformedData): Promise<LoadResult> {
		return load(data);
	},

	/** Validate extracted headers against file type requirements */
	validate(extraction: RawExtraction): HeaderValidation {
		return validateHeaders(extraction.headers, extraction.fileType);
	},

	/** Full pipeline: Extract → Validate → Transform → Load */
	async run(filename: string, content: string, overrides?: PipelineOverrides): Promise<LoadResult> {
		const extracted = extract(filename, content, overrides);

		// Validate headers before transform
		const validation = validateHeaders(extracted.headers, extracted.fileType);
		if (!validation.valid) {
			return {
				jobId: 0,
				fileType: extracted.fileType,
				customerName: extracted.customerName,
				status: 'failed',
				rowsTotal: extracted.rows.length,
				rowsInserted: 0,
				rowsSkipped: 0,
				rowsFlagged: 0,
				rowsHeld: 0,
				error: `Missing required columns for ${extracted.fileType} file: ${validation.missingRequired.join(', ')}. Found headers: ${extracted.headers.join(', ')}`
			};
		}

		const transformed = transform(extracted);
		const result = await load(transformed);
		return result;
	}
};
