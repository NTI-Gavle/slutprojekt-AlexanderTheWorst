<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Navbar from '../components/Navbar.svelte';
	import { navbar } from '../lib/stores/navbar';
</script>

<div class="min-h-screen w-screen bg-bg-primary text-foreground-primary">
	<Navbar showUser={true} />
</div>
