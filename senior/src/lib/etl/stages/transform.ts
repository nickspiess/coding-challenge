import type {
	RawExtraction,
	TransformedData,
	NormalizedProduct,
	NormalizedPrice,
	NormalizedSale,
	EtlFlagEntry,
	HeldRow
} from '$lib/types';

/**
 * TRANSFORM STAGE
 *
 * Takes raw extracted rows and normalizes/cleans/validates them.
 * Produces normalized typed rows + quality flags.
 *
 * Pure function — no DB access, no side effects, fully serializable I/O.
 */
export function transform(extraction: RawExtraction): TransformedData {
	const { filename, fileHash, customerName, fileType, storeHint, rows } = extraction;
	const flags: EtlFlagEntry[] = [];
	const heldRows: HeldRow[] = [];

	const result: TransformedData = {
		filename,
		fileHash,
		customerName,
		fileType,
		products: [],
		prices: [],
		sales: [],
		flags,
		heldRows
	};

	if (fileType === 'product') {
		result.products = transformProducts(rows, flags, heldRows);
	} else if (fileType === 'price') {
		result.prices = transformPrices(rows, storeHint, flags, heldRows);
	} else {
		result.sales = transformSales(rows, storeHint, flags, heldRows);
	}

	return result;
}

// ─── Product Transform ─────────────────────────────────────────

function transformProducts(
	rows: Record<string, string>[],
	flags: EtlFlagEntry[],
	heldRows: HeldRow[]
): NormalizedProduct[] {
	const products: NormalizedProduct[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2; // 1-indexed, skip header

		const upc = row['upc_plu'] ?? '';
		if (!upc) {
			const msg = 'Missing UPC/PLU — held for review';
			flags.push(flag(rowNum, 'upc_plu', '', 'missing', 'error', msg));
			heldRows.push({ row_number: rowNum, row_data: row, flag_type: 'missing', flag_message: msg });
			continue;
		}

		const description = row['description'] ?? '';
		if (!description) {
			flags.push(
				flag(rowNum, 'description', '', 'missing', 'warning', `Missing description for UPC ${upc}`)
			);
		}

		const department = clean(row['department']);
		if (!department) {
			flags.push(
				flag(rowNum, 'department', '', 'missing', 'warning', `Missing department for UPC ${upc} — will not appear in Sales by Department chart`)
			);
		}

		const category = clean(row['category']);

		const unitSize = clean(row['unit_size'] || row['unitsize'] || '').toUpperCase();
		const packSize = nullish(row['pack_size'] || row['pack'] || '');
		const linkCode = nullish(row['link_code'] || row['linkcode'] || '');

		products.push({
			upc_plu: upc,
			description: titleCase(description),
			department,
			category,
			unit_size: unitSize,
			pack_size: packSize,
			link_code: linkCode,
			_source_row: rowNum
		});
	}

	return products;
}

// ─── Price Transform ───────────────────────────────────────────

function transformPrices(
	rows: Record<string, string>[],
	storeHint: string | null,
	flags: EtlFlagEntry[],
	heldRows: HeldRow[]
): NormalizedPrice[] {
	const prices: NormalizedPrice[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2;

		const upc = row['upc_plu'] ?? '';
		if (!upc) {
			const msg = 'Missing UPC/PLU — held for review';
			flags.push(flag(rowNum, 'upc_plu', '', 'missing', 'error', msg));
			heldRows.push({ row_number: rowNum, row_data: row, flag_type: 'missing', flag_message: msg });
			continue;
		}

		const priceVal = parseNum(row['price']);
		if (priceVal === null || priceVal < 0) {
			const msg = `Invalid price "${row['price']}" for UPC ${upc} — held for review`;
			flags.push(flag(rowNum, 'price', row['price'], 'invalid', 'error', msg));
			heldRows.push({ row_number: rowNum, row_data: row, flag_type: 'invalid', flag_message: msg });
			continue;
		}

		const storeCode = resolveStoreCode(row, storeHint);
		if (storeCode === 'UNKNOWN') {
			flags.push(
				flag(rowNum, 'store', row['store'] ?? '', 'missing', 'warning', `No store code found for UPC ${upc} — set to UNKNOWN`)
			);
		}

		const priceType = (nullish(row['price_type']) ?? 'REG').toUpperCase();
		const pricePriority = nullish(row['price_priority']);
		const priceMultiple = parseNum(row['price_multiple']);
		const unitMultiple = parseNum(row['unit_multiple']);
		const startDate = parseDate(row['start_date']);
		const endDate = parseDate(row['end_date']);

		if (!startDate) {
			flags.push(
				flag(
					rowNum,
					'start_date',
					row['start_date'],
					'missing',
					'warning',
					`Missing or unparseable start_date for UPC ${upc}`
				)
			);
		}

		prices.push({
			store_code: storeCode,
			upc_plu: upc,
			price: priceVal,
			price_type: priceType,
			price_priority: pricePriority,
			price_multiple: priceMultiple,
			unit_multiple: unitMultiple,
			start_date: startDate,
			end_date: endDate,
			_source_row: rowNum
		});
	}

	return prices;
}

// ─── Sale Transform ────────────────────────────────────────────

function transformSales(
	rows: Record<string, string>[],
	storeHint: string | null,
	flags: EtlFlagEntry[],
	heldRows: HeldRow[]
): NormalizedSale[] {
	const sales: NormalizedSale[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const rowNum = i + 2;

		const upc = row['upc_plu'] ?? '';
		if (!upc) {
			const msg = 'Missing UPC/PLU — held for review';
			flags.push(flag(rowNum, 'upc_plu', '', 'missing', 'error', msg));
			heldRows.push({ row_number: rowNum, row_data: row, flag_type: 'missing', flag_message: msg });
			continue;
		}

		const storeCode = resolveStoreCode(row, storeHint);
		if (storeCode === 'UNKNOWN') {
			flags.push(
				flag(rowNum, 'store', row['store'] ?? '', 'missing', 'warning', `No store code found for UPC ${upc} — set to UNKNOWN, will not appear correctly in Revenue by Store`)
			);
		}

		const description = titleCase(row['description'] ?? '');
		if (!description) {
			flags.push(
				flag(rowNum, 'description', '', 'missing', 'warning', `Missing description for UPC ${upc} — will show as blank in Top Products chart`)
			);
		}

		const unitSize = (row['unit_size'] || '').toUpperCase();
		const saleTime = parseDate(row['sale_time']);
		const priceType = (nullish(row['price_type']) ?? 'REG').toUpperCase();
		const unitPrice = parseNum(row['unit_price']);
		const unitsSold = parseNum(row['units_sold']);
		const totalSale = parseNum(row['total_sale'] || row['sales_total']);

		const rawSaleTime = (row['sale_time'] ?? '').trim();
		if (rawSaleTime && !saleTime) {
			flags.push(
				flag(
					rowNum,
					'sale_time',
					rawSaleTime,
					'invalid',
					'warning',
					`Could not parse sale_time "${rawSaleTime}" for UPC ${upc}`
				)
			);
		}

		if (unitPrice == null && totalSale == null) {
			flags.push(
				flag(
					rowNum,
					'unit_price',
					row['unit_price'],
					'missing',
					'warning',
					`Missing unit_price and total_sale for UPC ${upc} — revenue will not be tracked`
				)
			);
		} else if (unitPrice === 0 && totalSale === 0) {
			flags.push(
				flag(
					rowNum,
					'unit_price',
					row['unit_price'],
					'missing',
					'warning',
					`Zero unit_price and total_sale for UPC ${upc} — revenue will show as $0`
				)
			);
		}

		sales.push({
			store_code: storeCode,
			upc_plu: upc,
			description,
			unit_size: unitSize,
			sale_time: saleTime,
			price_type: priceType,
			unit_price: unitPrice,
			units_sold: unitsSold,
			total_sale: totalSale,
			_source_row: rowNum
		});
	}

	return sales;
}

// ─── Shared Utilities ──────────────────────────────────────────

function clean(val: string | undefined): string {
	if (!val) return '';
	const v = val.trim();
	if (v === 'NULL' || v === 'null') return '';
	return v;
}

function nullish(val: string | undefined): string | null {
	if (!val) return null;
	const v = val.trim();
	if (!v || v === 'NULL' || v === 'null' || v === 'N/A' || v === 'n/a') return null;
	return v;
}

function parseNum(val: string | undefined): number | null {
	if (!val) return null;
	const v = val.trim();
	if (!v || v === 'NULL' || v === 'null') return null;
	const n = Number(v);
	return isNaN(n) ? null : n;
}

/** Parse epoch ms or date string → ISO string (serializable) */
function parseDate(val: string | undefined): string | null {
	if (!val) return null;
	const trimmed = val.trim();
	if (!trimmed || trimmed === 'NULL' || trimmed === 'null') return null;

	// Epoch milliseconds (13+ digit number)
	if (/^\d{13,}$/.test(trimmed)) {
		const d = new Date(Number(trimmed));
		return isNaN(d.getTime()) ? null : d.toISOString();
	}

	// Standard date/datetime string
	const d = new Date(trimmed);
	return isNaN(d.getTime()) ? null : d.toISOString();
}

function resolveStoreCode(row: Record<string, string>, storeHint: string | null): string {
	const storeVal = (row['store'] ?? '').trim();
	if (storeVal) return storeVal;

	// Steven's Produce: store from filename hint (store1 → SP1)
	if (storeHint) {
		const num = storeHint.replace(/\D/g, '');
		return `SP${num}`;
	}

	return 'UNKNOWN';
}

function titleCase(str: string): string {
	if (!str) return str;
	return str
		.toLowerCase()
		.replace(/(?:^|\s|[-/])\w/g, (match) => match.toUpperCase());
}

function flag(
	row_number: number,
	column_name: string,
	original_value: string | undefined,
	flag_type: EtlFlagEntry['flag_type'],
	severity: EtlFlagEntry['severity'],
	message: string
): EtlFlagEntry {
	return { row_number, column_name, original_value, flag_type, severity, message };
}
