<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';

	import { EyeOffIcon, EyeIcon, KeyRoundIcon, UserIcon, LoaderCircleIcon } from '@lucide/svelte';
	import Navbar from '@/Navbar.svelte';
	import { goto } from '$app/navigation';
	import { user } from '../../../lib/stores/user';

	let displayPassword = $state(false);

	let usernameFocus: boolean = $state(false);
	let passwordFocus: boolean = $state(false);

	let error = $state<string | null>(null);
	let usernameError = $state<{
		keepValue: boolean;
		error: string;
	} | null>(null);
	let passwordError = $state<{
		keepValue: boolean;
		error: string;
	} | null>(null);

	let verifyingLogin = $state(false);

	let username: string = $state('');
	let password: string = $state('');

	function POST(ev: SubmitEvent) {
		ev.preventDefault();

		verifyingLogin = true;

		fetch('/auth/register', {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				username,
				password
			})
		})
			.then(async (res) => {
				if (!res.ok) throw await res.json();
				return await res.json();
			})
			.then((successRes) => {
				if (successRes.success == true) {
					$user = successRes.user;
					throw goto('/home');
				}
			})
			.catch(
				(errorRes: {
					error: string;
					errors: {
						username?: { keepValue: boolean; error: string };
						password?: { keepValue: boolean; error: string };
					};
				}) => {
					if (errorRes.error) error = errorRes.error;
					if (errorRes.errors) {
						usernameError = errorRes.errors.username ? errorRes.errors.username : null;
						passwordError = errorRes.errors.password ? errorRes.errors.password : null;
					}
				}
			)
			.finally(() => (verifyingLogin = false));
	}
</script>

<div class="flex h-screen w-screen flex-col">
	<div class="flex w-screen flex-1 items-center justify-center">
		<form class="flex flex-col gap-[10px]" onsubmit={POST}>
			{#if browser}
				{#if error}
					<div>
						<h1>{error}</h1>
					</div>
				{/if}
			{/if}

			<div class="group flex flex-col justify-end gap-[5px]">
				<p>Username</p>
				<div
					class={`flex w-[320px] items-center gap-[10px] rounded-[4px] border-2 p-[10px] transition duration-75 ${usernameFocus ? 'border-accent-light' : 'border-white/5'} ${usernameError ? 'border-red-500!' : ''}`}
				>
					{#if browser}
						<UserIcon class="w-[22px]" />
					{/if}
					<input
						onfocus={() => {
							usernameFocus = true;
							usernameError = null;
						}}
						onblur={() => (usernameFocus = false)}
						name="username"
						class="flex-1 border-0 outline-0"
						type="text"
						placeholder="Username"
						disabled={verifyingLogin}
						bind:value={username}
					/>
				</div>
				{#if usernameError?.error}
					<p class="text-[14px] font-medium text-red-500">{usernameError.error}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-[5px]">
				<p>Password</p>
				<div
					class={`flex w-[320px] items-center gap-[10px] rounded-[4px] border-2 transition duration-75 ${passwordFocus ? 'border-accent-light' : 'border-white/5'} ${passwordError ? 'border-red-500!' : ''} p-[10px]`}
				>
					{#if browser}
						<KeyRoundIcon class="w-[22px]" />
					{/if}
					<input
						onfocus={() => {
							passwordFocus = true;
							passwordError = null;
						}}
						onblur={() => (passwordFocus = false)}
						name="password"
						class="flex-1 border-0 outline-0"
						type={displayPassword ? 'text' : 'password'}
						placeholder="Password"
						disabled={verifyingLogin}
						bind:value={password}
					/>
					{#if browser}
						<button
							onclick={(ev) => {
								displayPassword = !displayPassword;
								ev.preventDefault();
							}}
						>
							{#if displayPassword}
								<EyeOffIcon class="w-[22px]" />
							{:else}
								<EyeIcon class="w-[22px]" />
							{/if}
						</button>
					{/if}
				</div>
				{#if passwordError?.error}
					<p class="text-[14px] font-medium text-red-500">{passwordError.error}</p>
				{/if}
			</div>

			<button
				disabled={verifyingLogin}
				type="submit"
				class={`flex w-full cursor-pointer items-center justify-center rounded-[4px] bg-accent-light p-[20px] py-[10px] text-[16px] font-medium transition duration-75 hover:bg-accent-dark active:bg-accent-light`}
			>
				{#if verifyingLogin}
					{#if browser}
						<LoaderCircleIcon class="animate-spin" />
					{/if}
				{:else}
					Register
				{/if}
			</button>

			<div class="flex flex-col gap-[5px]">
				<div class="relative flex justify-center opacity-50">
					<div
						class="absolute top-1/2 left-1/2 h-[1px] w-full -translate-1/2 bg-accent-light"
					></div>
					<p class="relative w-fit bg-bg-primary px-[10px] text-[14px] font-bold text-accent-light">
						OR
					</p>
				</div>

				<p>
					Already have an account? <a
						onclick={() => goto('/auth/login')}
						class="cursor-pointer text-accent-light underline underline-offset-4 transition-[text-underline-offset] duration-150 hover:underline-offset-8!"
						>Login!</a
					>
				</p>
			</div>
		</form>
	</div>
</div>
