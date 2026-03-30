<script lang="ts">
	import { page } from '$app/state';
	import { Component, ImageIcon, LayersIcon, PencilIcon } from '@lucide/svelte';
	import { user as userStore } from '../../lib/stores/user';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	let user = $userStore;
</script>

<div class="flex flex-col gap-[10px] px-[20px] pt-[84px]">
	<div class="border-b border-white/8 pb-[10px]">
		<p>Welcome, <span class="font-medium">{user?.username}</span>!</p>
	</div>

	<div class="flex-gap flex flex-wrap gap-[10px]">
		<button
			onclick={() => goto(`/collage/${user?.username}`)}
			class="flex w-fit cursor-pointer items-center gap-[10px] rounded-[4px] border border-white/8 bg-white/0 p-[10px] px-[15px] transition duration-75 hover:border-white/12 hover:bg-white/5"
		>
			<LayersIcon class="w-[22px]" />
			<p>My Collage</p>
		</button>
		<button
			class="flex w-fit cursor-pointer items-center gap-[10px] rounded-[4px] border border-white/8 bg-white/0 p-[10px] px-[15px] transition duration-75 hover:border-white/8 hover:bg-white/5"
		>
			<ImageIcon class="w-[22px]" />
			<p>My Images</p>
		</button>
	</div>
</div>
