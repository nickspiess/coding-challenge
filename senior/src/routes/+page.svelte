<script lang="ts">
	import type { LoadResult, EtlFlag, ReviewQueueItem } from '$lib/types';

	let files = $state<File[]>([]);
	let uploading = $state(false);
	let results = $state<(LoadResult & { detected?: boolean; warnings?: string[] })[]>([]);
	let dragover = $state(false);
	let imports = $state<any[]>([]);
	let selectedJobFlags = $state<EtlFlag[]>([]);
	let selectedJobId = $state<number | null>(null);

	// Custom store upload
	let customStoreEnabled = $state(false);
	let customStoreName = $state('');
	let customFileType = $state<'product' | 'price' | 'sale' | ''>('');
	let detectionFailed = $state(false);

	// Review queue
	let reviewItems = $state<ReviewQueueItem[]>([]);
	let reviewCount = $state(0);
	let showReview = $state(false);
	let editingId = $state<number | null>(null);
	let editData = $state<Record<string, unknown>>({});
	let creatingProductId = $state<number | null>(null);
	let productForm = $state({ upc_plu: '', description: '', department: '', category: '', unit_size: '', pack_size: '' });

	// Flag editing
	let editingFlagId = $state<number | null>(null);
	let editingFlagRecord = $state<Record<string, unknown>>({});
	let editingFlagLoading = $state(false);
	let fieldErrors = $state<Record<string, string>>({});

	// Fields that must be numeric (nullable — empty is OK, but non-numeric text is not)
	const numericFields = new Set(['unit_price', 'units_sold', 'total_sale', 'price', 'unit_multiple']);
	// Fields that must be datetime
	const dateFields = new Set(['sale_time', 'start_date', 'end_date']);
	// Fields that must be short uppercase text codes
	const codeFields = new Set(['price_type']);
	const validPriceTypes = new Set(['REG', 'AD', 'TPR', 'CLR', 'MKD']);

	// Returns { error, warning } — errors block save, warnings don't
	function validateField(key: string, value: unknown): { error: string; warning: string } {
		const s = String(value ?? '').trim();
		if (!s) return { error: '', warning: '' };

		if (numericFields.has(key)) {
			const n = Number(s);
			if (isNaN(n)) return { error: 'Must be a number', warning: '' };
			if (n < 0) return { error: 'Cannot be negative', warning: '' };
			return { error: '', warning: '' };
		}
		if (dateFields.has(key)) {
			// Dates warn but don't block — value is saved as-is if unparseable
			const parsed = parseDateTimeInput(s);
			return { error: '', warning: parsed ? '' : 'Could not parse date — will be saved as-is' };
		}
		if (codeFields.has(key)) {
			if (!validPriceTypes.has(s.toUpperCase())) return { error: `Must be one of: ${[...validPriceTypes].join(', ')}`, warning: '' };
			return { error: '', warning: '' };
		}
		return { error: '', warning: '' };
	}

	let fieldWarnings = $state<Record<string, string>>({});

	function validateAllFields(): boolean {
		const errors: Record<string, string> = {};
		const warnings: Record<string, string> = {};
		for (const [key, val] of Object.entries(editingFlagRecord)) {
			if (key === 'id' || key === 'store_id' || key === 'created_at' || key === 'customer_id') continue;
			const { error, warning } = validateField(key, val);
			if (error) errors[key] = error;
			if (warning) warnings[key] = warning;
		}
		fieldErrors = errors;
		fieldWarnings = warnings;
		return Object.keys(errors).length === 0;
	}

	let editFormValid = $derived(
		Object.values(fieldErrors).every((e) => !e)
	);

	/** Parse user-friendly datetime → ISO string. Returns null if invalid. */
	function parseDateTimeInput(input: string): string | null {
		if (!input || !input.trim()) return null;
		const s = input.trim();

		// Already ISO — pass through
		const isoDate = new Date(s);
		if (!isNaN(isoDate.getTime()) && /^\d{4}-\d{2}/.test(s)) {
			return isoDate.toISOString();
		}

		// MM/DD/YYYY h:mmAM  or  MM/DD/YYYY h:mm AM  or  MM-DD-YYYY ...
		const usMatch = s.match(
			/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/
		);
		if (usMatch) {
			const [, mo, day, yr, hr, min, ampm] = usMatch;
			let hour = Number(hr);
			if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
			if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
			const d = new Date(Number(yr), Number(mo) - 1, Number(day), hour, Number(min));
			return isNaN(d.getTime()) ? null : d.toISOString();
		}

		// YYYY-MM-DD h:mmAM  or  YYYY-MM-DD h:mm AM
		const isoAmPm = s.match(
			/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/
		);
		if (isoAmPm) {
			const [, yr, mo, day, hr, min, ampm] = isoAmPm;
			let hour = Number(hr);
			if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
			if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
			const d = new Date(Number(yr), Number(mo) - 1, Number(day), hour, Number(min));
			return isNaN(d.getTime()) ? null : d.toISOString();
		}

		// 24hr: YYYY-MM-DD HH:mm  or  MM/DD/YYYY HH:mm
		const time24 = s.match(
			/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2}):(\d{2})$/
		);
		if (time24) {
			let [, a, b, c, hr, min] = time24;
			let yr: number, mo: number, day: number;
			if (a.length === 4) { yr = Number(a); mo = Number(b); day = Number(c); }
			else { mo = Number(a); day = Number(b); yr = Number(c); }
			const d = new Date(yr, mo - 1, day, Number(hr), Number(min));
			return isNaN(d.getTime()) ? null : d.toISOString();
		}

		// Fallback — try native Date parse
		const fallback = new Date(s);
		return isNaN(fallback.getTime()) ? null : fallback.toISOString();
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragover = false;
		const dropped = Array.from(e.dataTransfer?.files ?? []);
		const csvFiles = dropped.filter((f) => f.name.endsWith('.csv'));
		files = [...files, ...csvFiles];
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			files = [...files, ...Array.from(input.files)];
		}
		input.value = '';
	}

	function removeFile(index: number) {
		files = files.filter((_, i) => i !== index);
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return bytes + ' B';
		return (bytes / 1024).toFixed(1) + ' KB';
	}

	async function upload() {
		if (files.length === 0) return;
		uploading = true;
		results = [];
		detectionFailed = false;

		const formData = new FormData();
		for (const file of files) {
			formData.append('files', file);
		}

		// Attach custom store info if the checkbox is enabled
		if (customStoreEnabled && customStoreName.trim()) {
			formData.append('customCustomerName', customStoreName.trim());
			if (customFileType) {
				formData.append('customFileType', customFileType);
			}
		}

		try {
			const res = await fetch('/api/upload', { method: 'POST', body: formData });
			const data = await res.json();
			results = data.results;

			// Check if any file failed detection
			const hasDetectionFailure = results.some((r: any) => r.detected === false);
			if (hasDetectionFailure) {
				detectionFailed = true;
				// Don't clear files — let the user enable the checkbox and retry
			} else {
				files = [];
				customStoreEnabled = false;
				customStoreName = '';
				customFileType = '';
				detectionFailed = false;
			}
			await Promise.all([loadImports(), loadReviewItems()]);
		} catch (err) {
			console.error('Upload failed:', err);
		} finally {
			uploading = false;
		}
	}

	async function loadImports() {
		const res = await fetch('/api/imports');
		const data = await res.json();
		imports = data.jobs;
	}

	async function loadReviewItems() {
		const res = await fetch('/api/reviews');
		const data = await res.json();
		reviewItems = data.items;
		reviewCount = data.pendingCount;
	}

	async function viewFlags(jobId: number) {
		if (selectedJobId === jobId) {
			selectedJobId = null;
			selectedJobFlags = [];
			return;
		}
		const res = await fetch(`/api/imports/${jobId}/flags`);
		const data = await res.json();
		selectedJobFlags = data.flags;
		selectedJobId = jobId;
	}

	async function deleteImport(jobId: number) {
		await fetch(`/api/imports/${jobId}`, { method: 'DELETE' });
		if (selectedJobId === jobId) {
			selectedJobId = null;
			selectedJobFlags = [];
		}
		await loadImports();
	}

	// ─── Flag Record Actions ──────────────────────────────────

	async function startFlagEdit(flag: EtlFlag) {
		if (!flag.record_id) return;
		editingFlagId = flag.id;
		editingFlagLoading = true;
		fieldErrors = {};
		const res = await fetch(`/api/imports/${flag.job_id}/flags/${flag.id}`);
		const data = await res.json();
		editingFlagRecord = data.record ? { ...data.record } : {};
		editingFlagLoading = false;
	}

	function cancelFlagEdit() {
		editingFlagId = null;
		editingFlagRecord = {};
		fieldErrors = {};
		fieldWarnings = {};
	}

	async function saveFlagEdit(flag: EtlFlag) {
		if (!validateAllFields()) return;

		// Build clean updates — parse dates (best-effort), coerce numerics
		const updates = { ...editingFlagRecord };
		for (const key of Object.keys(updates)) {
			const s = String(updates[key] ?? '').trim();
			if (!s) { updates[key] = null; continue; }
			if (dateFields.has(key)) updates[key] = parseDateTimeInput(s) ?? s; // pass through as-is if unparseable
			if (numericFields.has(key)) updates[key] = Number(s);
			if (codeFields.has(key)) updates[key] = s.toUpperCase();
		}

		await fetch(`/api/imports/${flag.job_id}/flags/${flag.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ updates })
		});
		editingFlagId = null;
		editingFlagRecord = {};
		// Refresh flags and import list
		await viewFlags(flag.job_id);
		// Re-toggle to force refresh (viewFlags toggles off if same ID)
		if (selectedJobId === null) await viewFlags(flag.job_id);
		await loadImports();
	}

	async function deleteFlagRecord(flag: EtlFlag) {
		await fetch(`/api/imports/${flag.job_id}/flags/${flag.id}`, { method: 'DELETE' });
		// Refresh
		if (selectedJobId === flag.job_id) {
			const res = await fetch(`/api/imports/${flag.job_id}/flags`);
			const data = await res.json();
			selectedJobFlags = data.flags;
			if (data.flags.length === 0) selectedJobId = null;
		}
		await loadImports();
	}

	// ─── Review Actions ────────────────────────────────────────

	let editingFileType = $state('');

	function startEdit(item: ReviewQueueItem) {
		editingId = item.id;
		editingFileType = item.file_type;
		// Guard against double-encoded JSON (stored as string instead of object)
		let rd = item.row_data;
		if (typeof rd === 'string') {
			try { rd = JSON.parse(rd); } catch { /* use as-is */ }
		}
		// Sanitize NULL/null strings to empty so inputs show blank, not "NULL"
		const cleaned: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(rd as Record<string, unknown>)) {
			if (typeof v === 'string') {
				const t = v.trim();
				cleaned[k] = (t === 'NULL' || t === 'null' || t === 'N/A' || t === 'n/a') ? '' : v;
			} else {
				cleaned[k] = v;
			}
		}
		editData = cleaned;
		fieldErrors = {};
		fieldWarnings = {};
		creatingProductId = null;
	}

	function cancelEdit() {
		editingId = null;
		editData = {};
		fieldErrors = {};
		fieldWarnings = {};
	}

	function validateEditData(): boolean {
		const errors: Record<string, string> = {};
		const warnings: Record<string, string> = {};
		for (const [key, val] of Object.entries(editData)) {
			if (key === 'id' || key === 'store_id' || key === 'created_at' || key === 'customer_id') continue;
			const { error, warning } = validateField(key, val);
			if (error) errors[key] = error;
			if (warning) warnings[key] = warning;
		}
		// Price is required for price records
		if (editingFileType === 'price') {
			const priceVal = String(editData['price'] ?? '').trim();
			if (!priceVal) errors['price'] = 'Price is required';
		}
		fieldErrors = errors;
		fieldWarnings = warnings;
		return Object.keys(errors).length === 0;
	}

	async function resolveItem(id: number) {
		if (!validateEditData()) return;

		// Clean values before sending — parse dates, coerce numerics
		const cleaned = { ...editData };
		for (const key of Object.keys(cleaned)) {
			const s = String(cleaned[key] ?? '').trim();
			if (!s) { cleaned[key] = null; continue; }
			if (dateFields.has(key)) cleaned[key] = parseDateTimeInput(s) ?? s;
			if (numericFields.has(key)) cleaned[key] = Number(s);
			if (codeFields.has(key)) cleaned[key] = s.toUpperCase();
		}

		await fetch(`/api/reviews/${id}/resolve`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ row_data: cleaned })
		});
		editingId = null;
		editData = {};
		fieldErrors = {};
		fieldWarnings = {};
		await loadReviewItems();
	}

	async function discardItem(id: number) {
		await fetch(`/api/reviews/${id}/discard`, { method: 'POST' });
		await loadReviewItems();
	}

	function startCreateProduct(item: ReviewQueueItem) {
		creatingProductId = item.id;
		editingId = null;
		const rd = item.row_data as Record<string, unknown>;
		productForm = {
			upc_plu: String(rd.upc_plu ?? ''),
			description: String(rd.description ?? ''),
			department: '',
			category: '',
			unit_size: String(rd.unit_size ?? ''),
			pack_size: ''
		};
	}

	function cancelCreateProduct() {
		creatingProductId = null;
	}

	async function submitCreateProduct(id: number) {
		await fetch(`/api/reviews/${id}/create-product`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ product: productForm })
		});
		creatingProductId = null;
		await loadReviewItems();
	}

	function statusBadge(status: string): string {
		if (status === 'completed') return 'badge-success';
		if (status === 'failed') return 'badge-error';
		if (status === 'duplicate') return 'badge-duplicate';
		return 'badge-info';
	}

	function severityBadge(severity: string): string {
		if (severity === 'error') return 'badge-error';
		if (severity === 'warning') return 'badge-warning';
		return 'badge-info';
	}

	$effect(() => {
		loadImports();
		loadReviewItems();
	});
</script>

<h1>Import CSV Files</h1>

<!-- Upload Zone -->
<div class="card">
	<h2>Upload</h2>

	<div
		class="drop-zone {dragover ? 'dragover' : ''}"
		role="button"
		tabindex="0"
		ondragover={(e) => { e.preventDefault(); dragover = true; }}
		ondragleave={() => { dragover = false; }}
		ondrop={handleDrop}
		onclick={() => document.getElementById('file-input')?.click()}
		onkeydown={(e) => { if (e.key === 'Enter') document.getElementById('file-input')?.click(); }}
	>
		<p>Drop CSV files here or click to browse</p>
		<p class="hint">Supports files from J&A Grocers, Colin's Market, and Steven's Produce</p>
	</div>
	<input id="file-input" type="file" accept=".csv" multiple hidden onchange={handleFileInput} />

	<!-- Detection failure prompt -->
	{#if detectionFailed && !customStoreEnabled}
		<div class="detection-failed">
			<p>Could not auto-detect the vendor for one or more files. Enable the custom store option below to specify the vendor and store, then re-import.</p>
		</div>
	{/if}

	<!-- Custom store checkbox -->
	<div class="custom-store-toggle">
		<label class="checkbox-label">
			<input
				type="checkbox"
				bind:checked={customStoreEnabled}
				onchange={() => { detectionFailed = false; }}
			/>
			Upload for a store outside of J&A Grocers, Colin's Market, and Steven's Produce
		</label>
	</div>

	<!-- Custom store fields -->
	{#if customStoreEnabled}
		<div class="custom-store-fields">
			<label>
				<span>Store Name (chain/company)</span>
				<input type="text" bind:value={customStoreName} placeholder="e.g. Freshmart" />
			</label>
		</div>
		{#if customStoreName.trim()}
			<div class="custom-file-type">
				<span class="file-type-label">Upload Type</span>
				<div class="file-type-options">
					<label class="file-type-option">
						<input type="radio" name="customFileType" value="product" bind:group={customFileType} />
						Products
					</label>
					<label class="file-type-option">
						<input type="radio" name="customFileType" value="price" bind:group={customFileType} />
						Prices
					</label>
					<label class="file-type-option">
						<input type="radio" name="customFileType" value="sale" bind:group={customFileType} />
						Sales
					</label>
				</div>
			</div>
		{/if}
	{/if}

	{#if files.length > 0}
		<ul class="file-list">
			{#each files as file, i}
				<li>
					<span class="filename">{file.name}</span>
					<span class="filesize">{formatSize(file.size)}</span>
					<button class="remove-btn" onclick={() => removeFile(i)}>x</button>
				</li>
			{/each}
		</ul>
		<div class="file-actions">
			<button
				class="btn btn-primary"
				disabled={uploading || (customStoreEnabled && (!customStoreName.trim() || !customFileType))}
				onclick={upload}
			>
				{uploading ? 'Processing...' : `Import ${files.length} file${files.length > 1 ? 's' : ''}`}
			</button>
			{#if customStoreEnabled && (!customStoreName.trim() || !customFileType)}
				<span class="field-hint">Please enter a Store Name and select an Upload Type</span>
			{/if}
		</div>
	{/if}
</div>

<!-- Results from current upload -->
{#if results.length > 0}
	<div class="card">
		<h2>Import Results</h2>
		<div class="results">
			{#each results as r}
				<div class="result-item">
					<span class="badge {statusBadge(r.status)}">{r.status}</span>
					<span class="result-file">{r.customerName}</span>
					<span class="result-stats">
						{r.fileType} — {r.rowsInserted} inserted, {r.rowsSkipped} skipped, {r.rowsFlagged} flagged
						{#if r.rowsHeld > 0}
							, <strong>{r.rowsHeld} held for review</strong>
						{/if}
					</span>
					{#if r.error}
						<span class="badge badge-error">{r.error}</span>
					{/if}
				</div>
				{#if r.warnings && r.warnings.length > 0}
					{#each r.warnings as warning}
						<div class="result-warning">{warning}</div>
					{/each}
				{/if}
			{/each}
		</div>
	</div>
{/if}

<!-- Review Queue -->
{#if reviewCount > 0}
	<div class="card">
		<h2>
			Review Queue
			<span class="badge badge-warning">{reviewCount} pending</span>
		</h2>

		{#if !showReview}
			<p>{reviewCount} row{reviewCount > 1 ? 's' : ''} need review before they can be imported.</p>
			<button class="btn btn-primary" onclick={() => { showReview = true; }}>Review Items</button>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Job</th>
						<th>File</th>
						<th>Row</th>
						<th>Type</th>
						<th>Issue</th>
						<th>UPC</th>
						<th>Data Preview</th>
						<th>Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each reviewItems as item}
						{@const rd = (typeof item.row_data === 'string' ? JSON.parse(item.row_data) : item.row_data) as Record<string, unknown>}
						<tr>
							<td>{item.job_id}</td>
							<td>{item.original_filename ?? '—'}</td>
							<td>{item.row_number ?? '—'}</td>
							<td>{item.file_type}</td>
							<td><span class="badge badge-warning">{item.flag_type}</span></td>
							<td>{rd.upc_plu ?? '—'}</td>
							<td class="data-preview">
								{item.flag_message}
							</td>
							<td class="action-buttons">
								{#if item.flag_type === 'orphaned_product'}
									<button class="btn btn-primary" onclick={() => startCreateProduct(item)}>Create Product</button>
								{/if}
								<button class="btn btn-secondary" onclick={() => startEdit(item)}>Edit</button>
								<button class="btn btn-danger" onclick={() => discardItem(item.id)}>Discard</button>
							</td>
						</tr>

						<!-- Inline Edit Row -->
						{#if editingId === item.id}
							<tr>
								<td colspan="8">
									<div class="edit-row">
										<h3>Edit Row #{item.row_number}</h3>
										<div class="edit-fields">
											{#each Object.entries(editData) as [key, val]}
												{#if key !== 'id' && key !== 'store_id' && key !== 'created_at' && key !== 'customer_id'}
													<label>
														<span class={key === item.flag_type ? 'flag-highlight' : ''}>{key}</span>
														<input
															type="text"
															value={typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')}
															placeholder={dateFields.has(key) ? 'MM/DD/YYYY h:mmAM' : numericFields.has(key) ? '0.00' : codeFields.has(key) ? 'REG, AD, TPR, CLR, MKD' : ''}
															class={fieldErrors[key] ? 'field-error' : ''}
															oninput={(e) => {
																const v = (e.target as HTMLInputElement).value;
																editData[key] = v || null;
																const { error, warning } = validateField(key, v);
																if (error) fieldErrors = { ...fieldErrors, [key]: error };
																else { const { [key]: _, ...rest } = fieldErrors; fieldErrors = rest; }
																if (warning) fieldWarnings = { ...fieldWarnings, [key]: warning };
																else { const { [key]: _, ...rest } = fieldWarnings; fieldWarnings = rest; }
															}}
														/>
														{#if dateFields.has(key)}
															<span class="field-hint">e.g. 01/15/2026 2:30PM or 2026-01-15 14:30</span>
														{/if}
														{#if fieldErrors[key]}
															<span class="field-hint error">{fieldErrors[key]}</span>
														{/if}
														{#if fieldWarnings[key]}
															<span class="field-hint warning">{fieldWarnings[key]}</span>
														{/if}
													</label>
												{/if}
											{/each}
										</div>
										<div class="edit-actions">
											<button class="btn btn-primary" disabled={!editFormValid} onclick={() => resolveItem(item.id)}>Re-process</button>
											<button class="btn btn-secondary" onclick={cancelEdit}>Cancel</button>
										</div>
									</div>
								</td>
							</tr>
						{/if}

						<!-- Create Product Form -->
						{#if creatingProductId === item.id}
							<tr>
								<td colspan="8">
									<div class="edit-row">
										<h3>Create Product for UPC {rd.upc_plu}</h3>
										<div class="edit-fields">
											<label>
												<span>UPC/PLU</span>
												<input type="text" bind:value={productForm.upc_plu} />
											</label>
											<label>
												<span>Description</span>
												<input type="text" bind:value={productForm.description} />
											</label>
											<label>
												<span>Department</span>
												<input type="text" bind:value={productForm.department} />
											</label>
											<label>
												<span>Category</span>
												<input type="text" bind:value={productForm.category} />
											</label>
											<label>
												<span>Unit Size</span>
												<input type="text" bind:value={productForm.unit_size} />
											</label>
											<label>
												<span>Pack Size</span>
												<input type="text" bind:value={productForm.pack_size} />
											</label>
										</div>
										<div class="edit-actions">
											<button class="btn btn-primary" onclick={() => submitCreateProduct(item.id)}>Create Product &amp; Import Row</button>
											<button class="btn btn-secondary" onclick={cancelCreateProduct}>Cancel</button>
										</div>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
{/if}

<!-- Import History -->
<div class="card">
	<h2>Import History</h2>

	{#if imports.length === 0}
		<div class="empty">No imports yet. Upload some CSV files to get started.</div>
	{:else}
		<table>
			<thead>
				<tr>
					<th>ID</th>
					<th>Customer</th>
					<th>Type</th>
					<th>File</th>
					<th>Status</th>
					<th>Rows</th>
					<th>Held</th>
					<th>Flags</th>
					<th>Date</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each imports as job}
					<tr>
						<td>{job.id}</td>
						<td>{job.customer_name ?? '—'}</td>
						<td>{job.file_type}</td>
						<td>{job.original_filename ?? '—'}</td>
						<td><span class="badge {statusBadge(job.status)}">{job.status}</span></td>
						<td>{job.rows_inserted ?? 0}/{job.rows_total ?? 0}</td>
						<td>
							{#if (job.rows_held ?? 0) > 0}
								<span class="badge badge-warning">{job.rows_held}</span>
							{:else}
								0
							{/if}
						</td>
						<td>
							{#if job.rows_flagged > 0}
								<span class="badge badge-warning">{job.rows_flagged}</span>
							{:else}
								0
							{/if}
						</td>
						<td>{new Date(job.created_at).toLocaleDateString()}</td>
						<td class="action-buttons">
							{#if job.rows_flagged > 0}
								<button class="btn btn-secondary" onclick={() => viewFlags(job.id)}>
									{selectedJobId === job.id ? 'Hide' : 'Flags'}
								</button>
							{/if}
							<button class="btn btn-danger" onclick={() => deleteImport(job.id)}>Remove</button>
						</td>
					</tr>
					{#if selectedJobId === job.id && selectedJobFlags.length > 0}
						<tr>
							<td colspan="10">
								<table>
									<thead>
										<tr>
											<th>Row</th>
											<th>Column</th>
											<th>Severity</th>
											<th>Type</th>
											<th>Message</th>
											<th>Original Value</th>
											<th>Actions</th>
										</tr>
									</thead>
									<tbody>
										{#each selectedJobFlags as f}
											<tr>
												<td>{f.row_number ?? '—'}</td>
												<td>{f.column_name ?? '—'}</td>
												<td><span class="badge {severityBadge(f.severity)}">{f.severity}</span></td>
												<td>{f.flag_type}</td>
												<td>{f.message}</td>
												<td>{f.original_value ?? '—'}</td>
												<td class="action-buttons">
													{#if f.record_id}
														<button class="btn btn-secondary" onclick={() => startFlagEdit(f)}>Edit</button>
														<button class="btn btn-danger" onclick={() => deleteFlagRecord(f)}>Delete</button>
													{:else}
														<span class="badge badge-info">skipped</span>
													{/if}
												</td>
											</tr>

											{#if editingFlagId === f.id}
												<tr>
													<td colspan="7">
														<div class="edit-row">
															<h3>Edit Record — Row #{f.row_number} ({f.record_table})</h3>
															{#if editingFlagLoading}
																<div class="loading">Loading record...</div>
															{:else}
																<div class="edit-fields">
																	{#each Object.entries(editingFlagRecord) as [key, val]}
																		{#if key !== 'id' && key !== 'store_id' && key !== 'created_at' && key !== 'customer_id'}
																			<label>
																				<span class={key === f.column_name ? 'flag-highlight' : ''}>{key}</span>
																				<input
																					type="text"
																					value={typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '')}
																					placeholder={dateFields.has(key) ? 'MM/DD/YYYY h:mmAM' : numericFields.has(key) ? '0.00' : codeFields.has(key) ? 'REG, AD, TPR, CLR, MKD' : ''}
																					class={(key === f.column_name || fieldErrors[key]) ? 'field-error' : ''}
																					oninput={(e) => {
																						const v = (e.target as HTMLInputElement).value;
																						editingFlagRecord[key] = v || null;
																						const { error, warning } = validateField(key, v);
																						if (error) fieldErrors = { ...fieldErrors, [key]: error };
																						else { const { [key]: _, ...rest } = fieldErrors; fieldErrors = rest; }
																						if (warning) fieldWarnings = { ...fieldWarnings, [key]: warning };
																						else { const { [key]: _, ...rest } = fieldWarnings; fieldWarnings = rest; }
																					}}
																				/>
																				{#if dateFields.has(key)}
																					<span class="field-hint">e.g. 01/15/2026 2:30PM or 2026-01-15 14:30</span>
																				{/if}
																				{#if fieldErrors[key]}
																					<span class="field-hint error">{fieldErrors[key]}</span>
																				{/if}
																				{#if fieldWarnings[key]}
																					<span class="field-hint warning">{fieldWarnings[key]}</span>
																				{/if}
																			</label>
																		{/if}
																	{/each}
																</div>
																<div class="edit-actions">
																	<button class="btn btn-primary" disabled={!editFormValid} onclick={() => saveFlagEdit(f)}>Save</button>
																	<button class="btn btn-secondary" onclick={cancelFlagEdit}>Cancel</button>
																</div>
															{/if}
														</div>
													</td>
												</tr>
											{/if}
										{/each}
									</tbody>
								</table>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	{/if}
</div>
