<script lang="ts">
	import { onMount } from 'svelte';

	let progress = $state(0);

	onMount(() => {
		let active = true;

		const update = () => {
			if (!active) {
				return;
			}

			requestAnimationFrame(update);

			progress = (Math.sin(performance.now() / 1000) + 1) / 2;
		};

		requestAnimationFrame(update);

		return () => (active = false);
	});
</script>

<div class="relative block h-[200px] w-[200px]">
	<div
		class="p-[10px] absolute top-0 left-0 h-full w-full rounded-full"
		style={`
            background: conic-gradient(red ${progress * 100}%, transparent ${progress * 100}%)
        `}
	>
		<div class="top-0 left-0 h-full w-full rounded-full bg-white"></div>
	</div>
</div>
