<script lang="ts">
	import { goto } from '$app/navigation';
	import { ArrowRightIcon, ChevronDownIcon, HouseIcon } from '@lucide/svelte';
	import { user as userStore } from '../lib/stores/user';

	interface Props {
		loginButton?: boolean;

		showUser?: boolean;

		content?: CallableFunction;
	}

	const { loginButton = true, showUser = true, content = undefined }: Props = $props();
	const user = $userStore;
</script>

<div class="fixed top-0 flex h-[84px] w-screen items-center justify-between p-[20px]">
	<button onclick={() => goto('/')} class="cursor-pointer text-[20px] font-medium"
		><h1>Collage</h1></button
	>

	{#if content}
		{@render content?.()}
	{:else if loginButton && !(showUser && user)}
		<button
			onclick={() => goto('/auth/login')}
			class="cursor-pointer rounded-[4px] bg-accent-light p-[20px] py-[10px] text-[16px] font-medium transition duration-75 hover:bg-accent-dark active:bg-accent-light"
		>
			Login
		</button>
	{:else if showUser && user}
		<div class="flex h-full items-center gap-[10px]">
			<button
				onclick={() => goto('/home')}
				class="group flex h-full cursor-pointer items-center justify-center gap-[10px] rounded-[4px] border border-white/5 bg-white/0 p-[10px] transition duration-75 hover:border-white/8 hover:bg-white/2"
			>
				<HouseIcon
					class="w-[22px] shrink-0 text-white opacity-40 transition duration-75 group-hover:opacity-100"
				/>
				<p class="font-medium opacity-40 transition duration-75 group-hover:opacity-100">Home</p>
			</button>

			<div
				class="group flex h-full cursor-pointer items-center justify-center gap-[10px] rounded-[4px] border border-white/5 bg-white/0 px-[15px] transition duration-75 hover:border-white/8 hover:bg-white/2"
			>
				<p class="text-[16px] font-medium">{user.username}</p>
				<ChevronDownIcon
					class="w-[22px] shrink-0 text-white opacity-40 transition duration-75 group-hover:opacity-100"
				/>
			</div>
		</div>
	{/if}
</div>
