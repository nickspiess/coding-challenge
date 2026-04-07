import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/grocery_app';
const sql = postgres(DATABASE_URL, { connection: { client_min_messages: 'warning' } });

async function migrate() {
	console.log('Running migrations...');

	// ─── Tables ───────────────────────────────────────────────────

	await sql`
		CREATE TABLE IF NOT EXISTS customers (
			id SERIAL PRIMARY KEY,
			name TEXT NOT NULL UNIQUE,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS stores (
			id SERIAL PRIMARY KEY,
			customer_id INTEGER NOT NULL REFERENCES customers(id),
			store_code TEXT NOT NULL,
			name TEXT,
			location TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE (customer_id, store_code)
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS products (
			id SERIAL PRIMARY KEY,
			customer_id INTEGER NOT NULL REFERENCES customers(id),
			upc_plu TEXT NOT NULL,
			description TEXT,
			department TEXT,
			category TEXT,
			unit_size TEXT,
			pack_size TEXT,
			link_code TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE (customer_id, upc_plu)
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS import_log (
			id SERIAL PRIMARY KEY,
			customer_id INTEGER REFERENCES customers(id),
			file_type TEXT NOT NULL,
			file_hash TEXT,
			original_filename TEXT,
			rows_total INTEGER DEFAULT 0,
			rows_inserted INTEGER DEFAULT 0,
			rows_skipped INTEGER DEFAULT 0,
			rows_flagged INTEGER DEFAULT 0,
			rows_held INTEGER DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'pending',
			error_message TEXT,
			completed_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			UNIQUE (customer_id, file_hash)
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS prices (
			id SERIAL PRIMARY KEY,
			store_id INTEGER NOT NULL REFERENCES stores(id),
			upc_plu TEXT NOT NULL,
			price NUMERIC NOT NULL,
			price_type TEXT,
			price_priority TEXT,
			price_multiple NUMERIC,
			unit_multiple NUMERIC,
			start_date DATE,
			end_date DATE,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS sales (
			id SERIAL PRIMARY KEY,
			store_id INTEGER NOT NULL REFERENCES stores(id),
			upc_plu TEXT NOT NULL,
			description TEXT,
			unit_size TEXT,
			sale_time TIMESTAMPTZ,
			price_type TEXT,
			unit_price NUMERIC,
			units_sold NUMERIC,
			total_sale NUMERIC,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS etl_flags (
			id SERIAL PRIMARY KEY,
			job_id INTEGER NOT NULL REFERENCES import_log(id) ON DELETE CASCADE,
			row_number INTEGER,
			column_name TEXT,
			original_value TEXT,
			flag_type TEXT NOT NULL,
			severity TEXT NOT NULL DEFAULT 'warning',
			message TEXT NOT NULL,
			record_id INTEGER,
			record_table TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)
	`;

	await sql`
		CREATE TABLE IF NOT EXISTS etl_review_queue (
			id SERIAL PRIMARY KEY,
			job_id INTEGER NOT NULL REFERENCES import_log(id) ON DELETE CASCADE,
			row_number INTEGER,
			file_type TEXT NOT NULL,
			row_data JSONB NOT NULL,
			flag_type TEXT NOT NULL,
			flag_message TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			resolved_data JSONB,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			resolved_at TIMESTAMPTZ
		)
	`;

	// ─── Indexes ──────────────────────────────────────────────────

	// Review queue: filter by job; composite (status, job_id) for the review listing
	await sql`CREATE INDEX IF NOT EXISTS idx_review_queue_job ON etl_review_queue(job_id)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_review_queue_status_job ON etl_review_queue(status, job_id)`;

	// ETL flags: look up quality issues per import job
	await sql`CREATE INDEX IF NOT EXISTS idx_etl_flags_job ON etl_flags(job_id)`;

	// Stores: list stores for a customer (filter dropdowns, joins)
	await sql`CREATE INDEX IF NOT EXISTS idx_stores_customer ON stores(customer_id)`;

	// Products: filter by customer (unique constraint on customer_id, upc_plu already covers lookups)
	await sql`CREATE INDEX IF NOT EXISTS idx_products_customer ON products(customer_id)`;

	// Prices: filter by store, and join/orphan-check by upc_plu
	await sql`CREATE INDEX IF NOT EXISTS idx_prices_store ON prices(store_id)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_prices_upc ON prices(upc_plu)`;

	// Sales: filter by store, join/orphan-check by upc_plu, time-range queries
	await sql`CREATE INDEX IF NOT EXISTS idx_sales_store ON sales(store_id)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_sales_upc ON sales(upc_plu)`;
	await sql`CREATE INDEX IF NOT EXISTS idx_sales_time ON sales(sale_time)`;

	// Import log: duplicate-check and customer filter (covered by unique constraint, explicit for clarity)
	await sql`CREATE INDEX IF NOT EXISTS idx_import_log_customer_hash ON import_log(customer_id, file_hash)`;

	console.log('Migrations complete.');
	await sql.end();
}

migrate().catch((err) => {
	console.error('Migration failed:', err);
	process.exit(1);
});
