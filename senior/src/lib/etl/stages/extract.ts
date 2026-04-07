import { createHash } from 'crypto';
import Papa from 'papaparse';
import type { RawExtraction } from '$lib/types';
import { detectFile } from '../detect';
import type { DetectionResult } from '../detect';

// ─── Header Alias Map ──────────────────────────────────────────
// Maps alternative column names to our canonical field names.
// Checked AFTER exact match — so standard names always win.

const HEADER_ALIASES: Record<string, string> = {
	// UPC / product identifier
	upc: 'upc_plu',
	plu: 'upc_plu',
	sku: 'upc_plu',
	item_code: 'upc_plu',
	barcode: 'upc_plu',
	product_code: 'upc_plu',
	item_id: 'upc_plu',
	product_id: 'upc_plu',

	// Description
	desc: 'description',
	item_name: 'description',
	product_name: 'description',
	name: 'description',
	item_description: 'description',
	product_description: 'description',

	// Department
	dept: 'department',
	dept_name: 'department',
	department_name: 'department',
	dept_code: 'department',

	// Category (already canonical, but add common variants)
	cat: 'category',
	category_name: 'category',
	sub_category: 'category',
	subcategory: 'category',

	// Unit size
	unitsize: 'unit_size',
	size: 'unit_size',
	item_size: 'unit_size',

	// Pack size
	pack: 'pack_size',
	packsize: 'pack_size',
	case_size: 'pack_size',
	case_pack: 'pack_size',

	// Link code
	linkcode: 'link_code',

	// Price
	cost: 'price',
	unit_cost: 'price',
	retail_price: 'price',
	sell_price: 'price',
	amount: 'price',
	item_price: 'price',

	// Price type
	pricetype: 'price_type',
	type: 'price_type',

	// Price priority
	pricepriority: 'price_priority',
	priority: 'price_priority',

	// Price multiple
	pricemultiple: 'price_multiple',

	// Unit multiple
	unitmultiple: 'unit_multiple',

	// Start/end dates
	startdate: 'start_date',
	begin_date: 'start_date',
	effective_date: 'start_date',
	enddate: 'end_date',
	expiry_date: 'end_date',
	expire_date: 'end_date',

	// Store
	store_code: 'store',
	store_id: 'store',
	location: 'store',
	location_id: 'store',
	branch: 'store',
	site: 'store',
	store_number: 'store',
	store_num: 'store',
	store_no: 'store',

	// Sale time
	sold_at: 'sale_time',
	transaction_date: 'sale_time',
	transaction_time: 'sale_time',
	sale_date: 'sale_time',
	date: 'sale_time',
	trans_date: 'sale_time',

	// Sale time zone
	timezone: 'sale_time_zone',
	time_zone: 'sale_time_zone',
	tz: 'sale_time_zone',

	// Units sold
	qty: 'units_sold',
	quantity: 'units_sold',
	qty_sold: 'units_sold',
	unit_qty: 'units_sold',
	sold_qty: 'units_sold',

	// Unit price
	unitprice: 'unit_price',
	sell: 'unit_price',

	// Total sale
	total: 'total_sale',
	sales_total: 'total_sale',
	revenue: 'total_sale',
	line_total: 'total_sale',
	ext_price: 'total_sale',
	extended_price: 'total_sale',
	sale_total: 'total_sale'
};

/**
 * EXTRACT STAGE
 *
 * Reads raw CSV content, detects the customer/file type,
 * computes a content hash for dedup, and returns normalized
 * row dictionaries with cleaned header keys.
 *
 * Supports optional customer name override from the UI.
 *
 * Pure function — no DB access, no side effects.
 */
export function extract(
	filename: string,
	content: string,
	overrides?: { customerName?: string; fileType?: 'product' | 'price' | 'sale' }
): RawExtraction {
	const fileHash = createHash('sha256').update(content).digest('hex');
	const headerLine = content.split('\n')[0] || '';

	let detection: DetectionResult;
	if (overrides?.customerName) {
		// Skip vendor detection — use values from the UI form
		const autoDetected = detectFile(filename, headerLine);
		detection = {
			customerName: overrides.customerName,
			fileType: overrides.fileType ?? autoDetected.fileType,
			storeHint: null,
			detected: true
		};
	} else {
		detection = detectFile(filename, headerLine);
	}

	const { headers, rows } = parseCsv(content);

	return {
		filename,
		fileHash,
		customerName: detection.customerName,
		fileType: detection.fileType,
		storeHint: detection.storeHint,
		headers,
		rows,
		detected: detection.detected
	};
}

// ─── CSV Parsing Helpers ───────────────────────────────────────

function parseCsv(content: string): { headers: string[]; rows: Record<string, string>[] } {
	const result = Papa.parse(content, {
		header: false,
		skipEmptyLines: true
	});

	if (result.data.length === 0) return { headers: [], rows: [] };

	const rawHeaders = result.data[0] as string[];
	const headers = normalizeHeaders(rawHeaders);

	const rows: Record<string, string>[] = [];
	for (let i = 1; i < result.data.length; i++) {
		const vals = result.data[i] as string[];
		const row: Record<string, string> = {};
		for (let j = 0; j < headers.length; j++) {
			row[headers[j]] = trim(vals[j] ?? '');
		}
		// Skip separator rows (-------)
		if (isSeparatorRow(row)) continue;
		// Skip fully empty rows
		if (Object.values(row).every((v) => !v)) continue;
		rows.push(row);
	}

	return { headers, rows };
}

/**
 * Normalize header keys: lowercase, trim, replace spaces with underscores,
 * then resolve aliases to canonical names.
 */
function normalizeHeaders(headers: string[]): string[] {
	return headers.map((h) => {
		const normalized = h.trim().toLowerCase().replace(/\s+/g, '_');
		// Return canonical name if it's an alias, otherwise keep as-is
		return HEADER_ALIASES[normalized] ?? normalized;
	});
}

function trim(val: unknown): string {
	return String(val ?? '').trim();
}

function isSeparatorRow(row: Record<string, string>): boolean {
	return Object.values(row).every((v) => /^-+$/.test(String(v).trim()));
}
