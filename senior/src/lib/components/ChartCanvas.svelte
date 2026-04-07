<script lang="ts">
	import { Chart, registerables } from 'chart.js';
	import { onMount } from 'svelte';

	Chart.register(...registerables);

	let {
		type,
		labels,
		datasets,
		horizontal = false
	}: {
		type: 'bar' | 'doughnut' | 'line';
		labels: string[];
		datasets: { label: string; data: number[]; backgroundColor?: string | string[]; borderColor?: string }[];
		horizontal?: boolean;
	} = $props();

	let canvasEl: HTMLCanvasElement;
	let chart: Chart | null = null;

	onMount(() => {
		createChart();
		return () => { chart?.destroy(); };
	});

	function createChart() {
		chart?.destroy();
		chart = new Chart(canvasEl, {
			type,
			data: { labels, datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				indexAxis: horizontal ? 'y' : 'x',
				plugins: {
					legend: { display: datasets.length > 1 || type === 'doughnut' }
				},
				scales: type === 'doughnut' ? {} : {
					y: { beginAtZero: true },
					x: { beginAtZero: horizontal }
				}
			}
		});
	}

	$effect(() => {
		// Re-create chart when data changes
		if (canvasEl && labels && datasets) {
			createChart();
		}
	});
</script>

<div class="chart-wrapper">
	<canvas bind:this={canvasEl}></canvas>
</div>
