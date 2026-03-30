<script lang="ts">
	import Navbar from '@/Navbar.svelte';

    const { children } = $props(); 
</script>

{#snippet navbarContent()}
    
{/snippet}

<Navbar content={navbarContent}/>
{@render children?.()}