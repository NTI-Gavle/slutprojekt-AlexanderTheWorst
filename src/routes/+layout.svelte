<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { user } from '../lib/stores/user';

	let { children, data }: { children: any, data: { user?: {
		username: string;
		id: string;
	} }} = $props();
	user.set(data.user);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<main class="min-h-screen w-screen bg-bg-primary text-foreground-primary font-dm-sans">
	{@render children()}
</main>
