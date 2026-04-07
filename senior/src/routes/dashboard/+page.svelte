<script lang="ts">
	import ChartCanvas from '$lib/components/ChartCanvas.svelte';

	const COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb923c', '#e879f9', '#38bdf8', '#f87171'];

	let customers = $state<any[]>([]);
	let stores = $state<any[]>([]);
	let selectedCustomer = $state('');
	let selectedStore = $state('');

	let chartData = $state<{
		salesByCategory: { label: string; value: number }[];
		revenueByStore: { label: string; value: number }[];
		topProducts: { label: string; value: number }[];
		priceTypeMix: { label: string; value: number }[];
	}>({ salesByCategory: [], revenueByStore: [], topProducts: [], priceTypeMix: [] });

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

	async function loadCharts() {
		const params = new URLSearchParams();
		if (selectedCustomer) params.set('customer_id', selectedCustomer);
		if (selectedStore) params.set('store_id', selectedStore);

		const res = await fetch(`/api/data/charts?${params}`);
		if (!res.ok) return;
		chartData = await res.json();
	}

	function applyFilters() {
		if (selectedStore && selectedCustomer) {
			const valid = filteredStores.some((s) => String(s.id) === selectedStore);
			if (!valid) selectedStore = '';
		}
		loadCharts();
	}

	$effect(() => {
		loadMeta();
		loadCharts();
	});
</script>

<h1>Dashboard</h1>

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
		<label>
			Store
			<select bind:value={selectedStore} onchange={applyFilters}>
				<option value="">All Stores</option>
				{#each filteredStores as s}
					<option value={String(s.id)}>{s.customer_name} — {s.store_code}</option>
				{/each}
			</select>
		</label>
		<button class="btn btn-primary" onclick={applyFilters}>Apply</button>
	</div>
</div>

<div class="chart-grid">
	<!-- Sales by Category -->
	<div class="card">
		<h2>Sales by Department</h2>
		{#if chartData.salesByCategory.length > 0}
			<ChartCanvas
				type="bar"
				horizontal={true}
				labels={chartData.salesByCategory.map((d) => d.label)}
				datasets={[{
					label: 'Revenue',
					data: chartData.salesByCategory.map((d) => d.value),
					backgroundColor: COLORS
				}]}
			/>
		{:else}
			<div class="empty">No sales data</div>
		{/if}
	</div>

	<!-- Revenue by Store -->
	<div class="card">
		<h2>Revenue by Store</h2>
		{#if chartData.revenueByStore.length > 0}
			<ChartCanvas
				type="bar"
				labels={chartData.revenueByStore.map((d) => d.label)}
				datasets={[{
					label: 'Revenue',
					data: chartData.revenueByStore.map((d) => d.value),
					backgroundColor: COLORS
				}]}
			/>
		{:else}
			<div class="empty">No sales data</div>
		{/if}
	</div>

	<!-- Top 10 Products -->
	<div class="card">
		<h2>Top 10 Products by Revenue</h2>
		{#if chartData.topProducts.length > 0}
			<ChartCanvas
				type="bar"
				horizontal={true}
				labels={chartData.topProducts.map((d) => d.label)}
				datasets={[{
					label: 'Revenue',
					data: chartData.topProducts.map((d) => d.value),
					backgroundColor: '#4ade80'
				}]}
			/>
		{:else}
			<div class="empty">No sales data</div>
		{/if}
	</div>

	<!-- Price Type Breakdown -->
	<div class="card">
		<h2>Price Type Breakdown</h2>
		{#if chartData.priceTypeMix.length > 0}
			<ChartCanvas
				type="doughnut"
				labels={chartData.priceTypeMix.map((d) => d.label)}
				datasets={[{
					label: 'Count',
					data: chartData.priceTypeMix.map((d) => d.value),
					backgroundColor: COLORS
				}]}
			/>
		{:else}
			<div class="empty">No price data</div>
		{/if}
	</div>
</div>
