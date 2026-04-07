<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();
	let clearing = $state(false);

	async function clearDatabase() {
		if (!confirm('Clear all imported data? This cannot be undone.')) return;
		clearing = true;
		await fetch('/api/reset', { method: 'POST' });
		clearing = false;
		window.location.reload();
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>EmpowerFresh — Grocery Data Pipeline</title>
</svelte:head>

<div class="app">
	<nav>
		<div class="nav-brand">EmpowerFresh</div>
		<div class="nav-links">
			<a href="/">Import</a>
			<a href="/data">Data</a>
			<a href="/dashboard">Dashboard</a>
		</div>
		<div class="nav-spacer"></div>
		<button class="btn-reset" disabled={clearing} onclick={clearDatabase}>
			{clearing ? 'Clearing...' : 'Clear DB'}
		</button>
	</nav>
	<main>
		{@render children()}
	</main>
</div>
