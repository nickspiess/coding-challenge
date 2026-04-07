// ─── Database Row Types ────────────────────────────────────────

export interface Customer {
	id: number;
	name: string;
	created_at: string;
}

export interface Store {
	id: number;
	customer_id: number;
	store_code: string;
	name: string | null;
	location: string | null;
	created_at: string;
}

export interface Product {
	id: number;
	customer_id: number;
	upc_plu: string;
	description: string | null;
	department: string | null;
	category: string | null;
	unit_size: string | null;
	pack_size: string | null;
	link_code: string | null;
	created_at: string;
}

export interface Price {
	id: number;
	store_id: number;
	upc_plu: string;
	price: number;
	price_type: string | null;
	price_priority: string | null;
	price_multiple: number | null;
	unit_multiple: number | null;
	start_date: string | null;
	end_date: string | null;
	created_at: string;
}

export interface Sale {
	id: number;
	store_id: number;
	upc_plu: string;
	description: string | null;
	unit_size: string | null;
	sale_time: string | null;
	units_sold: number | null;
	unit_price: number | null;
	total_sale: number | null;
	price_type: string | null;
	created_at: string;
}

export interface ImportLog {
	id: number;
	customer_id: number | null;
	file_type: string;
	file_hash: string;
	original_filename: string | null;
	status: string;
	rows_total: number;
	rows_inserted: number;
	rows_skipped: number;
	rows_flagged: number;
	error_message: string | null;
	created_at: string;
	completed_at: string | null;
}

export interface EtlFlag {
	id: number;
	job_id: number;
	row_number: number | null;
	column_name: string | null;
	original_value: string | null;
	flag_type: string;
	severity: string;
	message: string;
	record_id: number | null;
	record_table: string | null;
	created_at: string;
}

// ─── ETL Pipeline Contracts ────────────────────────────────────

export type FileType = 'product' | 'price' | 'sale';

/** Flag raised during transform — no DB IDs, fully serializable */
export interface EtlFlagEntry {
	row_number: number;
	column_name?: string;
	original_value?: string;
	flag_type: 'missing' | 'invalid' | 'unknown_format' | 'duplicate' | 'skipped_row' | 'parse_error';
	severity: 'info' | 'warning' | 'error';
	message: string;
}

// ── Extract stage output ───────────────────────────────────────

export interface RawExtraction {
	filename: string;
	fileHash: string;
	customerName: string;
	fileType: FileType;
	storeHint: string | null;
	headers: string[];
	rows: Record<string, string>[];
	detected: boolean; // false if no known vendor matched
}

// ── Transform stage output ─────────────────────────────────────

export interface NormalizedProduct {
	upc_plu: string;
	description: string;
	department: string;
	category: string;
	unit_size: string;
	pack_size: string | null;
	link_code: string | null;
	_source_row?: number;
}

export interface NormalizedPrice {
	store_code: string;
	upc_plu: string;
	price: number;
	price_type: string;
	price_priority: string | null;
	price_multiple: number | null;
	unit_multiple: number | null;
	start_date: string | null;
	end_date: string | null;
	_source_row?: number;
}

export interface NormalizedSale {
	store_code: string;
	upc_plu: string;
	description: string;
	unit_size: string;
	sale_time: string | null;
	price_type: string;
	unit_price: number | null;
	units_sold: number | null;
	total_sale: number | null;
	_source_row?: number;
}

export interface HeldRow {
	row_number: number;
	row_data: Record<string, string>;
	flag_type: string;
	flag_message: string;
}

export interface TransformedData {
	filename: string;
	fileHash: string;
	customerName: string;
	fileType: FileType;
	products: NormalizedProduct[];
	prices: NormalizedPrice[];
	sales: NormalizedSale[];
	flags: EtlFlagEntry[];
	heldRows: HeldRow[];
}

// ── Load stage output ──────────────────────────────────────────

export interface LoadResult {
	jobId: number;
	fileType: FileType;
	customerName: string;
	status: 'completed' | 'failed' | 'duplicate';
	rowsTotal: number;
	rowsInserted: number;
	rowsSkipped: number;
	rowsFlagged: number;
	rowsHeld: number;
	error?: string;
}

// ── Review Queue ───────────────────────────────────────────────

export interface ReviewQueueItem {
	id: number;
	job_id: number;
	row_number: number | null;
	file_type: string;
	row_data: Record<string, unknown>;
	flag_type: string;
	flag_message: string;
	status: string;
	resolved_data: Record<string, unknown> | null;
	created_at: string;
	resolved_at: string | null;
	customer_name?: string;
	original_filename?: string;
}
