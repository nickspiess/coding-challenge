<script lang="ts">
	import './data-page.css';

	let activeTab = $state<'products' | 'prices' | 'sales' | 'summary'>('products');
	let customers = $state<any[]>([]);
	let stores = $state<any[]>([]);
	let selectedCustomer = $state('');
	let selectedStore = $state('');
	let search = $state('');

	// Data
	let products = $state<any[]>([]);
	let prices = $state<any[]>([]);
	let sales = $state<any[]>([]);
	let summary = $state<any[]>([]);
	let totals = $state({ products: 0, prices: 0, sales: 0, summary: 0 });
	let salesAgg = $state({ total_revenue: 0, total_units: 0, transaction_count: 0 });
	let loading = $state(false);
	let page = $state(0);
	const pageSize = 50;

	// Orphan state
	let orphanCount = $state(0);
	let orphanOnly = $state(false);

	// Create product modal
	let showCreateModal = $state(false);
	let createForm = $state({ customer_id: 0, upc_plu: '', description: '', department: '', category: '', unit_size: '', pack_size: '' });
	let createError = $state('');
	let createLoading = $state(false);
	let departmentOptions = $state<string[]>([]);
	let categoryOptions = $state<{ category: string; department: string }[]>([]);
	let filteredCategories = $derived(
		createForm.department
			? categoryOptions.filter((c) => c.department === createForm.department).map((c) => c.category)
			: categoryOptions.map((c) => c.category)
	);
	let createFormValid = $derived(
		createForm.description.trim().length > 0 &&
		(createForm.pack_size === '' || /^\d+$/.test(createForm.pack_size))
	);

	// Filtered stores based on selected customer
	let filteredStores = $derived(
		selectedCustomer
			? stores.filter((s) => s.customer_id === Number(selectedCustomer))
			: stores
	);

	async function loadMeta() {
		const res = await fetch('/api/data');
		const data = await res.json();
		customers = data.customers;
		stores = data.stores;
	}

	/** Fetch counts for all three tabs in parallel */
	async function loadAllCounts() {
		const baseParams = new URLSearchParams();
		if (selectedCustomer) baseParams.set('customer_id', selectedCustomer);
		if (selectedStore) baseParams.set('store_id', selectedStore);

		// Products: only filter by customer (products are customer-level, not store-level)
		const productParams = new URLSearchParams();
		if (selectedCustomer) productParams.set('customer_id', selectedCustomer);
		if (search) productParams.set('search', search);
		productParams.set('limit', '0');
		productParams.set('offset', '0');

		const priceParams = new URLSearchParams(baseParams);
		priceParams.set('limit', '0');
		priceParams.set('offset', '0');

		const saleParams = new URLSearchParams(baseParams);
		saleParams.set('limit', '0');
		saleParams.set('offset', '0');

		const summaryParams = new URLSearchParams(baseParams);
		summaryParams.set('limit', '0');
		summaryParams.set('offset', '0');

		const [prodRes, priceRes, saleRes, summaryRes] = await Promise.all([
			fetch(`/api/data/products?${productParams}`).then((r) => r.json()),
			fetch(`/api/data/prices?${priceParams}`).then((r) => r.json()),
			fetch(`/api/data/sales?${saleParams}`).then((r) => r.json()),
			fetch(`/api/data/sales-summary?${summaryParams}`).then((r) => r.json())
		]);

		totals = {
			products: prodRes.total,
			prices: priceRes.total,
			sales: saleRes.total,
			summary: summaryRes.total
		};
		salesAgg = saleRes.aggregates;
		orphanCount = summaryRes.orphan_count ?? 0;
	}

	/** Fetch full row data for the active tab only */
	async function loadActiveTabData() {
		loading = true;

		if (activeTab === 'products') {
			// Products are customer-level — don't filter by store
			const params = new URLSearchParams();
			if (selectedCustomer) params.set('customer_id', selectedCustomer);
			if (search) params.set('search', search);
			params.set('limit', String(pageSize));
			params.set('offset', String(page * pageSize));

			const res = await fetch(`/api/data/products?${params}`);
			const data = await res.json();
			products = data.products;
			totals.products = data.total;
		} else if (activeTab === 'prices') {
			const params = new URLSearchParams();
			if (selectedCustomer) params.set('customer_id', selectedCustomer);
			if (selectedStore) params.set('store_id', selectedStore);
			params.set('limit', String(pageSize));
			params.set('offset', String(page * pageSize));

			const res = await fetch(`/api/data/prices?${params}`);
			const data = await res.json();
			prices = data.prices;
			totals.prices = data.total;
		} else if (activeTab === 'sales') {
			const params = new URLSearchParams();
			if (selectedCustomer) params.set('customer_id', selectedCustomer);
			if (selectedStore) params.set('store_id', selectedStore);
			params.set('limit', String(pageSize));
			params.set('offset', String(page * pageSize));

			const res = await fetch(`/api/data/sales?${params}`);
			const data = await res.json();
			sales = data.sales;
			totals.sales = data.total;
			salesAgg = data.aggregates;
		} else {
			const params = new URLSearchParams();
			if (selectedCustomer) params.set('customer_id', selectedCustomer);
			if (selectedStore) params.set('store_id', selectedStore);
			if (orphanOnly) params.set('orphan_only', 'true');
			params.set('limit', String(pageSize));
			params.set('offset', String(page * pageSize));

			const res = await fetch(`/api/data/sales-summary?${params}`);
			const data = await res.json();
			summary = data.rows;
			totals.summary = data.total;
			orphanCount = data.orphan_count ?? 0;
		}

		loading = false;
	}

	function switchTab(tab: typeof activeTab) {
		activeTab = tab;
		page = 0;
		loadActiveTabData();
	}

	function applyFilters() {
		page = 0;
		// Reset store selection when it doesn't apply
		if (selectedStore && selectedCustomer) {
			const storeStillValid = filteredStores.some((s) => String(s.id) === selectedStore);
			if (!storeStillValid) selectedStore = '';
		}
		loadAllCounts();
		loadActiveTabData();
	}

	function formatCurrency(val: number | null): string {
		if (val === null || val === undefined) return '—';
		return '$' + Number(val).toFixed(2);
	}

	function formatDate(val: string | null): string {
		if (!val) return '—';
		return new Date(val).toLocaleDateString();
	}

	function formatDateTime(val: string | null): string {
		if (!val) return '—';
		const d = new Date(val);
		return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
	}

	let currentTotal = $derived(
		activeTab === 'products' ? totals.products :
		activeTab === 'prices' ? totals.prices :
		activeTab === 'sales' ? totals.sales :
		totals.summary
	);
	let totalPages = $derived(Math.ceil(currentTotal / pageSize));

	function toggleOrphanFilter() {
		orphanOnly = !orphanOnly;
		page = 0;
		loadActiveTabData();
	}

	async function openCreateModal(row: any) {
		createForm = {
			customer_id: row.customer_id,
			upc_plu: row.upc_plu,
			description: row.sale_description ?? row.description ?? '',
			department: '',
			category: row.category ?? '',
			unit_size: row.sale_unit_size ?? row.unit_size ?? '',
			pack_size: ''
		};
		createError = '';
		showCreateModal = true;

		const res = await fetch(`/api/products/options?customer_id=${row.customer_id}`);
		if (res.ok) {
			const data = await res.json();
			departmentOptions = data.departments;
			categoryOptions = data.categories;
		}
	}

	async function submitCreateProduct() {
		if (!createFormValid) return;
		createLoading = true;
		createError = '';
		try {
			const res = await fetch('/api/products', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(createForm)
			});
			const data = await res.json();
			if (!res.ok) {
				createError = data.error ?? 'Failed to create product';
				return;
			}
			showCreateModal = false;
			loadAllCounts();
			loadActiveTabData();
		} catch (err) {
			createError = String(err);
		} finally {
			createLoading = false;
		}
	}

	$effect(() => {
		loadMeta();
		loadAllCounts();
		loadActiveTabData();
	});
</script>

<h1>Data Explorer</h1>

<!-- Filters -->
<div class="card">
	<div class="filters">
		<label>
			Customer
			<select bind:value={selectedCustomer} onchange={applyFilters}>
				<option value="">All Customers</option>
				{#each customers as c}
					<option value={String(c.id)}>{c.name}</option>
				{/each}
			</select>
		</label>

		{#if activeTab !== 'products'}
			<label>
				Store
				<select bind:value={selectedStore} onchange={applyFilters}>
					<option value="">All Stores</option>
					{#each filteredStores as s}
						<option value={String(s.id)}>{s.customer_name} — {s.store_code}</option>
					{/each}
				</select>
			</label>
		{/if}

		{#if activeTab === 'products'}
			<label>
				Search
				<input
					type="text"
					placeholder="UPC or description..."
					bind:value={search}
					onkeydown={(e) => { if (e.key === 'Enter') applyFilters(); }}
				/>
			</label>
		{/if}

		<button class="btn btn-primary" onclick={applyFilters}>Apply</button>
	</div>
</div>

<!-- Tabs -->
<div class="tabs">
	<button class="tab {activeTab === 'products' ? 'active' : ''}" onclick={() => switchTab('products')}>
		Products ({totals.products})
	</button>
	<button class="tab {activeTab === 'prices' ? 'active' : ''}" onclick={() => switchTab('prices')}>
		Prices ({totals.prices})
	</button>
	<button class="tab {activeTab === 'sales' ? 'active' : ''}" onclick={() => switchTab('sales')}>
		Sales ({totals.sales})
	</button>
	<button class="tab {activeTab === 'summary' ? 'active' : ''}" onclick={() => switchTab('summary')}>
		Summary ({totals.summary})
		{#if orphanCount > 0}
			<span class="badge badge-orphan">{orphanCount} orphaned</span>
		{/if}
	</button>
</div>

<!-- Sales Aggregates -->
{#if activeTab === 'sales'}
	<div class="stats">
		<div class="stat">
			<div class="stat-label">Total Revenue</div>
			<div class="stat-value">{formatCurrency(salesAgg.total_revenue)}</div>
		</div>
		<div class="stat">
			<div class="stat-label">Total Units</div>
			<div class="stat-value">{salesAgg.total_units.toLocaleString()}</div>
		</div>
		<div class="stat">
			<div class="stat-label">Transactions</div>
			<div class="stat-value">{salesAgg.transaction_count.toLocaleString()}</div>
		</div>
	</div>
{/if}

<!-- Data Table -->
<div class="card">
	{#if loading}
		<div class="loading">Loading...</div>
	{:else if activeTab === 'products'}
		{#if products.length === 0}
			<div class="empty">No products found. Import some CSV files first.</div>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Customer</th>
						<th>UPC/PLU</th>
						<th>Description</th>
						<th>Department</th>
						<th>Category</th>
						<th>Unit Size</th>
						<th>Pack</th>
					</tr>
				</thead>
				<tbody>
					{#each products as p}
						<tr>
							<td>{p.customer_name}</td>
							<td>{p.upc_plu}</td>
							<td>{p.description ?? '—'}</td>
							<td>{p.department ?? '—'}</td>
							<td>{p.category ?? '—'}</td>
							<td>{p.unit_size ?? '—'}</td>
							<td>{p.pack_size ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{:else if activeTab === 'prices'}
		{#if prices.length === 0}
			<div class="empty">No prices found.</div>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Customer</th>
						<th>Store</th>
						<th>UPC/PLU</th>
						<th>Price</th>
						<th>Type</th>
						<th>Priority</th>
						<th>Start Date</th>
						<th>End Date</th>
					</tr>
				</thead>
				<tbody>
					{#each prices as p}
						<tr>
							<td>{p.customer_name}</td>
							<td>{p.store_code}</td>
							<td>{p.upc_plu}</td>
							<td>{formatCurrency(p.price)}</td>
							<td>{p.price_type ?? '—'}</td>
							<td>{p.price_priority ?? '—'}</td>
							<td>{formatDate(p.start_date)}</td>
							<td>{formatDate(p.end_date)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{:else if activeTab === 'sales'}
		{#if sales.length === 0}
			<div class="empty">No sales found.</div>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Customer</th>
						<th>Store</th>
						<th>UPC/PLU</th>
						<th>Description</th>
						<th>Time</th>
						<th>Units</th>
						<th>Unit Price</th>
						<th>Total</th>
						<th>Type</th>
					</tr>
				</thead>
				<tbody>
					{#each sales as s}
						<tr>
							<td>{s.customer_name}</td>
							<td>{s.store_code}</td>
							<td>{s.upc_plu}</td>
							<td>{s.description ?? '—'}</td>
							<td>{formatDateTime(s.sale_time)}</td>
							<td>{s.units_sold ?? '—'}</td>
							<td>{formatCurrency(s.unit_price)}</td>
							<td>{formatCurrency(s.total_sale)}</td>
							<td>{s.price_type ?? '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{:else if activeTab === 'summary'}
		{#if orphanCount > 0}
			<div class="filters">
				<label class="orphan-toggle">
					<input type="checkbox" checked={orphanOnly} onchange={toggleOrphanFilter} />
					Show only orphaned UPCs ({orphanCount})
				</label>
			</div>
		{/if}
		{#if summary.length === 0}
			<div class="empty">No sales summary data.</div>
		{:else}
			<table>
				<thead>
					<tr>
						<th>Status</th>
						<th>Customer</th>
						<th>Store</th>
						<th>UPC/PLU</th>
						<th>Description</th>
						<th>Category</th>
						<th>Transactions</th>
						<th>Total Units</th>
						<th>Avg Price</th>
						<th>Total Revenue</th>
						<th>Period</th>
					</tr>
				</thead>
				<tbody>
					{#each summary as row}
						<tr class={row.is_orphan ? 'orphan-row' : ''}>
							<td>
								{#if row.is_orphan}
									<button class="btn btn-create" onclick={() => openCreateModal(row)}>
										Create Product
									</button>
								{:else}
									<span class="badge badge-success">Matched</span>
								{/if}
							</td>
							<td>{row.customer_name}</td>
							<td>{row.store_code}</td>
							<td>{row.upc_plu}</td>
							<td>
								{row.description ?? row.sale_description ?? '—'}
								{#if row.source === 'prices'}
									<span class="badge badge-orphan">price only</span>
								{/if}
							</td>
							<td>{row.category ?? '—'}</td>
							<td>{row.transaction_count}</td>
							<td>{row.total_units != null ? Number(row.total_units).toFixed(1) : '—'}</td>
							<td>{formatCurrency(row.avg_unit_price)}</td>
							<td>{formatCurrency(row.total_revenue)}</td>
							<td>{formatDate(row.first_sale)} — {formatDate(row.last_sale)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	{/if}

	<!-- Pagination -->
	{#if totalPages > 1}
		<div class="pagination">
			<button class="btn btn-secondary" disabled={page === 0} onclick={() => { page--; loadActiveTabData(); }}>
				Prev
			</button>
			<span>Page {page + 1} of {totalPages}</span>
			<button class="btn btn-secondary" disabled={page >= totalPages - 1} onclick={() => { page++; loadActiveTabData(); }}>
				Next
			</button>
		</div>
	{/if}
</div>

{#if showCreateModal}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
	<div class="modal-overlay" onclick={() => showCreateModal = false} onkeydown={(e) => { if (e.key === 'Escape') showCreateModal = false; }} role="dialog" tabindex="-1">
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<div class="modal" onclick={(e) => e.stopPropagation()} role="document">
			<h2>Create Product for UPC {createForm.upc_plu}</h2>

			{#if createError}
				<div class="modal-error">{createError}</div>
			{/if}

			<div class="modal-fields">
				<label>
					UPC/PLU
					<input type="text" value={createForm.upc_plu} disabled />
				</label>
				<label>
					Description <span class="required">*</span>
					<input type="text" bind:value={createForm.description} placeholder="Product description" class={createForm.description.trim() === '' ? 'field-error' : ''} />
					{#if createForm.description.trim() === ''}
						<span class="field-hint error">Description is required</span>
					{/if}
				</label>
				<label>
					Department
					<input type="text" bind:value={createForm.department} placeholder="Select or type a department" list="dept-options" />
					<datalist id="dept-options">
						{#each departmentOptions as dept}
							<option value={dept}></option>
						{/each}
					</datalist>
				</label>
				<label>
					Category
					<input type="text" bind:value={createForm.category} placeholder="Select or type a category" list="cat-options" />
					<datalist id="cat-options">
						{#each filteredCategories as cat}
							<option value={cat}></option>
						{/each}
					</datalist>
					{#if createForm.department && filteredCategories.length === 0 && categoryOptions.length > 0}
						<span class="field-hint">No existing categories for this department — type a new one</span>
					{/if}
				</label>
				<label>
					Unit Size
					<input type="text" bind:value={createForm.unit_size} placeholder="e.g. 16 OZ, 1 LB" />
				</label>
				<label>
					Pack Size
					<input type="text" bind:value={createForm.pack_size} placeholder="e.g. 1, 6, 12" class={createForm.pack_size !== '' && !/^\d+$/.test(createForm.pack_size) ? 'field-error' : ''} />
					{#if createForm.pack_size !== '' && !/^\d+$/.test(createForm.pack_size)}
						<span class="field-hint error">Must be a whole number</span>
					{/if}
				</label>
			</div>

			<div class="modal-actions">
				<button class="btn btn-secondary" onclick={() => showCreateModal = false}>Cancel</button>
				<button class="btn btn-create" onclick={submitCreateProduct} disabled={createLoading || !createFormValid}>
					{createLoading ? 'Creating...' : 'Create Product'}
				</button>
			</div>
		</div>
	</div>
{/if}
