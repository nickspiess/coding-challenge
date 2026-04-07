import type { FileType } from '$lib/types';

export interface DetectionResult {
	customerName: string;
	fileType: FileType;
	storeHint: string | null; // e.g., 'store1' for Steven's per-store files
	detected: boolean; // false if no known vendor matched
}

/**
 * Detect which customer/grocer a CSV belongs to and what type of data it contains.
 *
 * Layer 1: Filename pattern matching for known vendors.
 * Layer 2: Header fingerprinting fallback if filename doesn't match.
 * If neither matches, returns detected: false so the UI can prompt for manual entry.
 */
export function detectFile(filename: string, headerLine: string): DetectionResult {
	const lowerFilename = filename.toLowerCase();
	const lowerHeader = headerLine.toLowerCase().replace(/\s/g, '');

	// Detect file type from filename keywords, then header keywords
	const fileType = detectFileType(lowerHeader, lowerFilename);

	// Layer 1: Filename pattern matching for known vendors
	const filenameResult = detectCustomerByFilename(lowerFilename);
	if (filenameResult) {
		return { ...filenameResult, fileType, detected: true };
	}

	// Layer 2: Header fingerprinting fallback
	const headerResult = detectCustomerByHeaders(headerLine);
	if (headerResult) {
		return { ...headerResult, fileType, detected: true };
	}

	// No known vendor matched
	return { customerName: 'Unknown', fileType, storeHint: null, detected: false };
}

function detectFileType(header: string, filename: string): FileType {
	// Check filename first for standard keywords + common aliases
	if (/product|inventory|catalog|item/.test(filename)) return 'product';
	if (/price|cost|pricing/.test(filename)) return 'price';
	if (/sale|transaction|sold/.test(filename)) return 'sale';

	// Fall back to header content (after alias resolution these are canonical names)
	if (header.includes('units_sold') || header.includes('sale_time') || header.includes('sales_total'))
		return 'sale';
	if (header.includes('price_type') || header.includes('price_priority')) return 'price';
	if (header.includes('department') || header.includes('category')) return 'product';

	return 'product'; // default guess
}

/** Layer 1: Known vendor detection from filename patterns */
function detectCustomerByFilename(
	filename: string
): { customerName: string; storeHint: string | null } | null {
	// Steven's Produce: files have -store1/-store2 suffix AND a known Steven's pattern
	// Must also look like a Steven's file (not just any file with -store in the name)
	const storeMatch = filename.match(/-store(\d+)/);
	if (storeMatch) {
		// Check if it also has a date prefix (YYYYMMDD-) which is Steven's pattern
		if (/^\d{8}-/.test(filename)) {
			return {
				customerName: "Steven's Produce",
				storeHint: `store${storeMatch[1]}`
			};
		}
	}

	// Colin's Market: files have epoch timestamp suffix like -1767086400000
	if (filename.match(/-\d{13}\./)) {
		return { customerName: "Colin's Market", storeHint: null };
	}

	// J&A Grocers: simple YYYYMMDD-type.csv with no extra suffix
	if (/^\d{8}-\w+\.csv$/.test(filename) && !storeMatch) {
		return { customerName: 'J&A Grocers', storeHint: null };
	}

	return null; // No filename pattern matched
}

/** Layer 2: Known vendor detection from header characteristics */
function detectCustomerByHeaders(
	rawHeaderLine: string
): { customerName: string; storeHint: string | null } | null {
	// J&A Grocers: headers are quoted ("upc_plu","description",...)
	if (/^"[^"]+","[^"]+"/.test(rawHeaderLine.trim())) {
		return { customerName: 'J&A Grocers', storeHint: null };
	}

	// Colin's Market: mixed-case headers (Category, UnitSize, Pack) — not all lowercase
	const headers = rawHeaderLine.split(',').map((h) => h.trim());
	const hasMixedCase = headers.some((h) => /^[A-Z][a-z]/.test(h));
	if (hasMixedCase) {
		return { customerName: "Colin's Market", storeHint: null };
	}

	// Steven's Produce: spaces after commas in header line
	if (/,\s+\w/.test(rawHeaderLine)) {
		return { customerName: "Steven's Produce", storeHint: null };
	}

	return null; // No header fingerprint matched
}
