<script lang="ts">
	import { ChevronDown, GripHorizontalIcon, Mouse, PencilIcon, XIcon } from '@lucide/svelte';
	import { camera, mouse, selection } from '../../../lib/stores/canvas.js';
	import type { Readable, Writable } from 'svelte/store';
	import { onMount, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import { browser } from '$app/environment';
	import Canvas from '@/Canvas.svelte';

	const { data } = $props();

	let editMode = $state(false);

	let color: string = $state('#ffffff00');
	const settings = {
		get backgroundColor() {
			return color;
		},
		set backgroundColor(c: any) {
			color = c;
		}
	};

	let backgroundColorInput: HTMLInputElement = null as any;
	const settingInputs = {
		get backgroundColor() {
			return backgroundColorInput;
		},
		set backgroundColor(c: HTMLInputElement) {
			backgroundColorInput = c;
		}
	};

	function hexToHsl(hex: string) {
		hex = hex.replace('#', '');

		let r = parseInt(hex.substring(0, 2), 16) / 255;
		let g = parseInt(hex.substring(2, 4), 16) / 255;
		let b = parseInt(hex.substring(4, 6), 16) / 255;

		let max = Math.max(r, g, b);
		let min = Math.min(r, g, b);

		let h,
			s,
			l = (max + min) / 2;

		if (max === min) {
			h = s = 0;
		} else {
			let d = max - min;

			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

			switch (max) {
				case r:
					h = (g - b) / d + (g < b ? 6 : 0);
					break;
				case g:
					h = (b - r) / d + 2;
					break;
				case b:
					h = (r - g) / d + 4;
					break;
			}

			h! /= 6;
		}

		return [Math.round(h! * 360), Math.round(s * 100), Math.round(l * 100)];
	}

	function hexToRgba(hex: string) {
		hex = hex.replace('#', '');

		const r = parseInt(hex.substring(0, 2), 16);
		const g = parseInt(hex.substring(2, 4), 16);
		const b = parseInt(hex.substring(4, 6), 16);
		const a = hex.length === 8 ? parseInt(hex.substring(6, 8), 16) / 255 : 1;

		return { r, g, b, a };
	}

	function lightenHex(hex: string, amount = 10) {
		const [h, s, l] = hexToHsl(hex);
		return `hsl(${h}, ${s}%, ${Math.min(100, l + amount)}%)`;
	}

	let items = $state<
		{
			name: string;
			id: string;
			type: 'image' | 'text' | 'comment';
			data: {
				url?: string;
				content?: string;
			};
			transform: {
				position: { x: number; y: number };
				size: { width: number; height: number };
				rotation: number;
			};
		}[]
	>([]);

	let inspectorWindow = $state<HTMLDivElement>(null as any);
	let layerWindow = $state<HTMLDivElement>(null as any);
	const windows = {
		get inspector() {
			return inspectorWindow;
		},
		set inspector(i) {
			inspectorWindow = i;
		},
		get layers() {
			return layerWindow;
		},
		set layers(l) {
			layerWindow = l;
		}
	};

	let container = $state<HTMLDivElement>(null as any);
	let canvas = $state<HTMLCanvasElement>(null as any);

	let cameraPosState = $state({ x: 0, y: 0 });
	let selected = selection.items;

	onMount(() => {
		window.addEventListener('click', (ev) => {
			if (ev.target !== canvas) return;

			const worldX = ev.clientX + camera.pos.x;
			const worldY = ev.clientY + camera.pos.y;

			let clickedItem = null;

			for (let item of items) {
				const rect = {
					x: item.transform.position.x,
					y: item.transform.position.y,
					width: item.transform.size.width,
					height: item.transform.size.height
				};

				if (
					worldX > rect.x &&
					worldX < rect.x + rect.width &&
					worldY > rect.y &&
					worldY < rect.y + rect.height
				) {
					clickedItem = item;
				}
			}

			if (!clickedItem) {
				if (!ev.shiftKey) selection.clear();
				return;
			}

			if (!ev.shiftKey) {
				selection._items.forEach((item) => {
					if (item !== clickedItem.id) selection.remove(item);
				});

				if (selection._items.has(clickedItem.id) && selection._items.size > 1) {
					selection.remove(clickedItem.id);
				} else {
					selection.add(clickedItem.id);
				}
				return;
			}

			if (selection._items.has(clickedItem.id)) {
				selection.remove(clickedItem.id);
			} else {
				selection.add(clickedItem.id);
			}
		});

		window.addEventListener('mousemove', (ev) => {
			mouse.setMousePos(ev.clientX, ev.clientY);
		});

		window.addEventListener('paste', (ev) => {
			if (!editMode) return;

			let clipboardItems = ev.clipboardData?.items;
			for (const item of clipboardItems!) {
				if (item.type.startsWith('image/')) {
					let file = item.getAsFile();
					console.log(item, file);

					if (file) {
						console.log(file);
						let url = URL.createObjectURL(file);

						items = [
							...items,
							{
								id: Math.random().toFixed(1),
								name: 'abc' + Math.random().toFixed(1),
								type: 'image',
								data: {
									url
								},
								transform: {
									position: { x: 100, y: 100 },
									size: { width: 200, height: 200 },
									rotation: 0
								}
							}
						];
						console.log(items, url);
					}
				} else if (item.type == 'text/html') {
					let parser = new DOMParser();
					item.getAsString((text) => {
						let doc = parser.parseFromString(text, 'text/html');

						const worldX = mouse.pos.x + camera.pos.x;
						const worldY = mouse.pos.y + camera.pos.y;

						let img = doc.querySelector('img');
						if (img) {
							console.log(camera.pos.x + mouse.pos.x, camera.pos.y + mouse.pos.y);
							items = [
								...items,
								{
									id: (Math.random() * Number.MAX_SAFE_INTEGER).toFixed(1),
									name: 'abc' + (Math.random() * Number.MAX_SAFE_INTEGER).toFixed(1),
									type: 'image',
									data: {
										url: img.src
									},
									transform: {
										position: { x: worldX - 100, y: worldY - 100 },
										size: { width: 200, height: 200 },
										rotation: 0
									}
								}
							];
						}
					});
				}
				return;
			}
		});
	});
</script>

<div class="h-screen w-screen" style={`background: ${settings.backgroundColor ?? '#ffffff'};`}>
	{#if data.targetUser}
		<!-- <canvas
			class="fixed top-0 left-0 z-0 overflow-scroll"
			style={`width: 100vw; height: 100vh;`}
			bind:this={canvas}
			{@attach (canvas) => {
				const ctx = canvas.getContext('2d');
				if (!ctx) return;

				const onResize = () => {
					canvas.width = window.innerWidth;
					canvas.height = window.innerHeight;

					const dpr = window.devicePixelRatio;

					canvas.width = canvas.width * dpr;
					canvas.height = canvas.height * dpr;

					ctx.scale(dpr, dpr);
				};
				window.addEventListener('resize', onResize);
				onResize();

				function drawDots() {
					let spacing = 25;
					let radius = 2;

					if (!ctx) return;

					// offset based on camera
					const offsetX = -(camera.pos.x % spacing) - spacing;
					const offsetY = -(camera.pos.y % spacing) - spacing;

					const cols = Math.ceil(canvas.width / spacing) + 2;
					const rows = Math.ceil(canvas.height / spacing) + 2;

					ctx.beginPath();

					for (let x = 0; x < cols; x++) {
						for (let y = 0; y < rows; y++) {
							const px = Math.round(x * spacing + offsetX) + 0.5;
							const py = Math.round(y * spacing + offsetY) + 0.5;

							ctx.moveTo(px + radius, py);
							ctx.strokeStyle = lightenHex(settings.backgroundColor, 10);
							ctx.lineWidth = 0.1;
							ctx.strokeRect(px, py, spacing, spacing);
						}
					}

					ctx.fillStyle = '#ffffff40';
					ctx.fill();
				}

				let moveX = 0;
				let moveY = 0;
				let oldClientX = 0;
				let oldClientY = 0;

				window.addEventListener(
					'touchmove',
					(ev) => {
						ev.preventDefault();
						let { clientX, clientY } = ev.touches[0];

						let deltaX = oldClientX - clientX;
						let deltaY = oldClientY - clientY;

						oldClientX = clientX;
						oldClientY = clientY;

						moveX = deltaX;
						moveY = deltaY;
					},
					{ passive: false }
				);

				canvas.addEventListener(
					'wheel',
					(e) => {
						e.preventDefault();

						if (e.ctrlKey) {
							console.log('Zoom!');
						} else {
							moveX = e.deltaX * 0.3;
							moveY = e.deltaY * 0.3;
						}
					},
					{ passive: false }
				);

				function loop() {
					if (!ctx) return;

					if (moveX !== 0 || moveY !== 0) {
						camera.move(moveX, moveY);
						moveX = 0;
						moveY = 0;
						cameraPosState = camera.pos;
					}

					ctx?.clearRect(0, 0, canvas.width, canvas.height);

					drawDots();

					requestAnimationFrame(loop);
				}

				requestAnimationFrame(loop);
			}}
		></canvas>

		<canvas
			class="pointer-events-none fixed top-0 left-0 z-10 overflow-scroll"
			style={`width: 100vw; height: 100vh; image-rendering: pixelated;`}
			{@attach (canvas) => {
				const ctx = canvas.getContext('2d');
				if (!ctx) return;

				const onResize = () => {
					canvas.width = window.innerWidth;
					canvas.height = window.innerHeight;

					const dpr = window.devicePixelRatio;

					canvas.width = canvas.width * dpr;
					canvas.height = canvas.height * dpr;

					ctx.scale(dpr, dpr);
				};
				window.addEventListener('resize', onResize);
				onResize();

				// ctx.translate(0.5, 0.5);

				function loop() {
					if (!ctx) return;

					ctx.clearRect(0, 0, canvas.width, canvas.height);

					let boundaryRect: {
						x: number;
						y: number;
						width: number;
						height: number;
						rotation: number;
					} = {
						x: null as any,
						y: null as any,
						width: null as any,
						height: null as any,
						rotation: 0
					};

					selection._items.forEach((i) => {
						let item = items.find(({ id }) => id == i);
						if (!boundaryRect.x) boundaryRect.x = item!.transform.position.x;
						else boundaryRect.x = Math.min(boundaryRect.x, item!.transform.position.x);

						if (!boundaryRect.y) boundaryRect.y = item!.transform.position.y;
						else boundaryRect.y = Math.min(boundaryRect.y, item!.transform.position.y);

						if (!boundaryRect.width)
							boundaryRect.width = item!.transform.position.x + item!.transform.size.width;
						else
							boundaryRect.width = Math.max(
								boundaryRect.width,
								item!.transform.position.x + item!.transform.size.width
							);

						if (!boundaryRect.height)
							boundaryRect.height = item!.transform.position.y + item!.transform.size.height;
						else
							boundaryRect.height = Math.max(
								boundaryRect.height,
								item!.transform.position.y + item!.transform.size.height
							);
					});

					if (selection._items.size > 0) {
						console.log(camera.pos.x, camera.pos.y);
					}

					ctx.strokeStyle = 'orange';
					ctx.lineWidth = 1;

					const screenX = Math.round(boundaryRect.x - camera.pos.x) + 0.5;
					const screenY = Math.round(boundaryRect.y - camera.pos.y) + 0.5;
					const screenW = Math.round(boundaryRect.width - boundaryRect.x) + 0.5;
					const screenH = Math.round(boundaryRect.height - boundaryRect.y) + 0.5;

					ctx.strokeRect(screenX, screenY, screenW, screenH);

					for (let [x, y] of [
						[screenX, screenY],
						[screenX + screenW, screenY],
						[screenX + screenW, screenY + screenH],
						[screenX, screenY + screenH]
					]) {
						ctx.fillStyle = 'white';
						// ctx.fillRect(x - 5, y - 5, 10, 10);
						ctx.strokeStyle = 'orange';
						ctx.strokeRect(x - 5, y - 5, 10, 10);
					}

					requestAnimationFrame(loop);
				}

				requestAnimationFrame(loop);
			}}
		></canvas> -->

		<Canvas />

		<div class="pointer-events-none fixed top-0 left-0" bind:this={container}>
			{#each items as item}
				{#if item.type == 'image'}
					{@const screenX = Math.round(item.transform.position.x - cameraPosState.x) + 0.5}
					{@const screenY = Math.round(item.transform.position.y - cameraPosState.y) + 0.5}
					<button
						onclick={() => selection.add(item.id)}
						class={`${$selected.has(item.id) ? 'bg-red-500' : 'bg-blue-500'}`}
						style={`
                        position: fixed;
						width: ${item.transform.size.width}px;
						height: ${item.transform.size.height}px;
                        transform: translateX(${screenX}px) translateY(${screenY}px) rotate(${item.transform.rotation}deg);
                        `}
					>
						<img src={item.data.url} alt={item.name} />
					</button>
				{/if}
			{/each}
		</div>

		<div class="pointer-events-none fixed z-10 h-screen w-screen **:pointer-events-auto">
			<div class="fixed">
				{#if data.canEdit}
					<button
						onclick={() => (editMode = !editMode)}
						class={`fixed bottom-[10px] left-[10px] flex w-fit gap-[10px] rounded-full bg-[#313131] p-[10px] px-[15px] shadow-2xl ${!editMode ? 'translate-x-0' : 'translate-x-[200px]'} transition duration-75`}
					>
						{#if editMode}
							<XIcon />
							<p>Stop Editting</p>
						{:else}
							<PencilIcon />
							<p>Edit</p>
						{/if}
					</button>

					{#if editMode}
						<div
							class="fixed top-0 right-0 flex h-screen min-w-[200px] flex-col overflow-hidden bg-[#313131] shadow-2xl"
							transition:fly={{ x: 200, opacity: 1, duration: 75 }}
						>
							<div
								class="flex items-center justify-between border-b border-[hsl(0,0%,29%)] p-[10px]"
							>
								<p class="font-medium">Inspector</p>
								<ChevronDown class="w-[18px] opacity-50" />
							</div>

							<div class="flex flex-col gap-[10px] p-[10px]">
								<div class="flex items-center justify-between">
									<p class="text-[14px] font-medium">Settings</p>
									<ChevronDown class="w-[18px] opacity-50" />
								</div>
								<div class="flex items-center gap-[10px] rounded-[6px] bg-[hsl(0,0%,29%)] p-[10px]">
									<button
										onclick={() => settingInputs.backgroundColor.click()}
										class="flex h-[20px] w-[20px] flex-wrap overflow-hidden rounded-[25%]"
										style={`background: ${settings.backgroundColor ?? '#ffffff'}; corner-shape: scuircle;`}
									>
										<div
											class="relative flex h-full w-full flex-wrap"
											style={`opacity: ${1 - hexToRgba(settings.backgroundColor).a};`}
										>
											<input
												class="absolute top-0 left-0 h-full w-full opacity-0"
												bind:this={settingInputs.backgroundColor}
												type="color"
												bind:value={settings.backgroundColor}
											/>
											{#each Array(4) as _, index}
												<div
													class={`h-1/2 w-1/2 ${
														(Math.floor(index / 2) + (index % 2)) % 2 === 0
															? 'bg-gray-200'
															: 'bg-white'
													}`}
												></div>
											{/each}
										</div>
									</button>
									<input type="text" bind:value={settings.backgroundColor} />
								</div>
							</div>
						</div>

						<div
							class="fixed top-[0px] left-[0px] flex h-screen min-w-[200px] flex-col overflow-hidden bg-[#313131] shadow-2xl"
							transition:fly={{ x: -200, opacity: 1, duration: 75 }}
						>
							<div
								class="flex items-center justify-between border-b border-[hsl(0,0%,29%)] p-[10px]"
							>
								<p class="font-medium">Layers</p>
								<ChevronDown class="w-[18px] opacity-50" />
							</div>

							<div
								class="flex h-full flex-1 flex-col gap-[10px] overflow-y-scroll p-[10px] py-[10px]"
							>
								{#each items as item}
									<p>{item.name}</p>
								{/each}
							</div>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{:else}
		<p>{data.requestedUser}'s collage was not found.</p>
	{/if}
</div>
