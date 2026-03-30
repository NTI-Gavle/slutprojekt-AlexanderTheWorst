<script lang="ts">
	import Navbar from '@/Navbar.svelte';

    const { children } = $props(); 
</script>

<Navbar />
{@render children?.()}