<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import {
		Application,
		Container,
		Graphics,
		Renderer,
		Sprite,
		texture,
		type ApplicationProps,
		type GraphicsProps
	} from 'svelte-pixi';
	import * as PIXI from 'pixi.js';
	import {
		GraphicsGpuData,
		Application as PixiApplication,
		Texture,
		type Graphics as PixiGraphics
	} from 'pixi.js';
	import { camera, mouse, selection } from '../lib/stores/canvas';
	import type { ColorSource } from 'pixi.js';
	import burgir from '$lib/assets/burgir.png';

	let workspace = $state<HTMLDivElement>(null as any);

	let graphics: PixiGraphics;

	let height = $state(0),
		width = $state(0);

	let moveX = 0,
		moveY = 0;

	let gizmoHeldDirection = $state<
		'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | null
	>();

	let hoverAction = $state<
		| {
				type: 'SelectNode';
				target?: string;
		  }
		| undefined
	>();
	let editorState = $state<string | null>(null);

	let middleButtonDown = false;

	let cameraPos = $state(camera.pos);

	type BaseNode = {
		name: string;
		parent: Node | null;
		id: string;

		appearance: {
			cornerRadius?: number | number[];
			fill?: string | ColorSource;
			stroke?: string | ColorSource;
			strokeWidth?: number;
			strokeAlignment?: 'inside' | 'outside' | 'center';
		};

		transform: {
			x: number;
			y: number;
			width: number;
			height: number;
			rotation?: number;
		};
	};
	type Node = BaseNode & FrameNode;
	type FrameNode = {
		type: 'frame';
		children: Node[];
	};

	let items: Node[] = [
		{
			name: 'sigma',
			type: 'frame',
			id: (Math.random() * Number.MAX_SAFE_INTEGER).toFixed(0),

			children: [],
			parent: null,

			appearance: {
				fill: 'red',
				stroke: 'blue',
				strokeWidth: 10,
				cornerRadius: 100,
				strokeAlignment: 'outside'
			},

			transform: {
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				rotation: 0
			}
		}
	];

	let mousePos = $state({ x: 0, y: 0 });

	let boundary = $state<
		| {
				x: number;
				y: number;
				width: number;
				height: number;
				rotation: number;
		  }
		| undefined
	>(undefined);

	selection.items.subscribe((i) => {
		boundary = calculateBoundaryOfSelected();
	});

	function calculateBoundaryOfSelected():
		| {
				x: number;
				y: number;
				width: number;
				height: number;
				rotation: number;
		  }
		| undefined {
		let boundary:
			| {
					x: number;
					y: number;
					width: number;
					height: number;
					rotation: number;
			  }
			| undefined = undefined;

		let x = Number.MAX_SAFE_INTEGER;
		let y = Number.MAX_SAFE_INTEGER;
		let w = -Number.MAX_SAFE_INTEGER;
		let h = -Number.MAX_SAFE_INTEGER;

		if (selection._items.size > 0) {
			for (const itemId of selection._items) {
				const item = items.find(({ id }) => id == itemId);
				if (!item) return;
				x = Math.min(item.transform.x, x);
				y = Math.min(item.transform.y, y);
				w = Math.max(item.transform.x + item.transform.width, w);
				h = Math.max(item.transform.y + item.transform.height, h);
			}
			return { x, y, width: w, height: h, rotation: 0 };
		}
	}

	function dist(x1: number, y1: number, x2: number, y2: number) {
		return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
	}

	type Hit =
		| { type: 'Node'; id: string }
		| { type: 'Boundary' }
		| { type: 'None' }
		| { type: 'Handle'; alignment: 'TopLeft' | 'TopRight' | 'BottomLeft' | 'BottomRight' }
		| { type: 'Rotate'; corner: 'TopLeft' | 'TopRight' | 'BottomLeft' | 'BottomRight' };

	function hitTest(worldX: number, worldY: number): Hit {
		if (boundary) {
			let gizmos = {
				TopLeft: { x: boundary.x - 5, y: boundary.y - 5 },
				TopRight: { x: boundary.x + boundary.width - 5, y: boundary.y - 5 },
				BottomLeft: { x: boundary.x - 5, y: boundary.y + boundary.height - 5 },
				BottomRight: { x: boundary.x + boundary.width - 5, y: boundary.y + boundary.height - 5 }
			};

			let grabbedGizmo: keyof typeof gizmos | null = null;
			let gizmoSize = 10;

			for (let gizmoKey in gizmos) {
				let gizmo = gizmos[gizmoKey as keyof typeof gizmos];
				if (
					worldX > gizmo.x &&
					worldX < gizmo.x + gizmoSize &&
					worldY > gizmo.y &&
					worldY < gizmo.y + gizmoSize
				) {
					grabbedGizmo = gizmoKey as keyof typeof gizmos;
					return { type: 'Handle', alignment: gizmoKey as any };
				}
			}

			let corners = {
				TopLeft: { x: boundary.x - 5, y: boundary.y - 5 },
				TopRight: { x: boundary.x + boundary.width - 5, y: boundary.y - 5 },
				BottomLeft: { x: boundary.x - 5, y: boundary.y + boundary.height - 5 },
				BottomRight: { x: boundary.x + boundary.width - 5, y: boundary.y + boundary.height - 5 }
			};

			if (
				worldX < corners['TopLeft'].x &&
				worldY < corners['TopLeft'].y &&
				dist(worldX, worldY, corners['TopLeft'].x, corners['TopLeft'].y) < 20
			) {
				return { type: 'Rotate', corner: 'TopLeft' };
			}

			if (
				worldX > corners['TopRight'].x &&
				worldY < corners['TopRight'].y &&
				dist(worldX, worldY, corners['TopRight'].x, corners['TopRight'].y) < 20
			) {
				return { type: 'Rotate', corner: 'TopRight' };
			}

			if (
				worldX < corners['BottomLeft'].x &&
				worldY > corners['BottomLeft'].x &&
				dist(worldX, worldY, corners['BottomLeft'].x, corners['BottomLeft'].y) < 20
			) {
				return { type: 'Rotate', corner: 'BottomLeft' };
			}

			if (
				worldX > corners['BottomRight'].x &&
				worldY > corners['BottomRight'].x &&
				dist(worldX, worldY, corners['BottomRight'].x, corners['BottomRight'].y) < 20
			) {
				return { type: 'Rotate', corner: 'BottomRight' };
			}
		}

		for (const item of items) {
			if (
				item.transform.x < worldX &&
				worldX < item.transform.x + item.transform.width &&
				item.transform.y < worldY &&
				worldY < item.transform.y + item.transform.height
			) {
				return { type: 'Node', id: item.id };
			}
		}

		return { type: 'None' };
	}

	onMount(() => {
		const onResize = () => ((width = window.innerWidth), (height = window.innerHeight));
		window.addEventListener('resize', onResize);
		onResize();

		let oldMouseX = 0,
			oldMouseY = 0;

		workspace.addEventListener(
			'mousedown',
			(ev) => {
				if (ev.button == 1) {
					ev.preventDefault();
					((oldMouseX = ev.clientX), (oldMouseY = ev.clientY));
					middleButtonDown = true;
				}
			},
			{ passive: false }
		);

		workspace.addEventListener('mousedown', (ev) => {
			let worldX = mouse.pos.x - camera.pos.x,
				worldY = mouse.pos.y - camera.pos.y;

			if (boundary) {
				let gizmoSize = 10;

				let gizmos = {
					top_left: { x: boundary.x - 5, y: boundary.y - 5 },
					top_right: { x: boundary.x + boundary.width - 5, y: boundary.y - 5 },
					bottom_left: { x: boundary.x + boundary.width - 5, y: boundary.y + boundary.height - 5 },
					bottom_right: { x: boundary.x - 5, y: boundary.y + boundary.height - 5 }
				};

				let grabbedGizmo: keyof typeof gizmos | null = null;

				for (let gizmoKey in gizmos) {
					let gizmo = gizmos[gizmoKey as keyof typeof gizmos];
					if (
						worldX > gizmo.x &&
						worldX < gizmo.x + gizmoSize &&
						worldY > gizmo.y &&
						worldY < gizmo.y + gizmoSize
					) {
						grabbedGizmo = gizmoKey as keyof typeof gizmos;
						gizmoHeldDirection = grabbedGizmo;
						break;
					}
				}

				if (grabbedGizmo) {
					return;
				}
			}

			for (const item of items) {
				if (
					item.transform.x < worldX &&
					worldX < item.transform.x + item.transform.width &&
					item.transform.y < worldY &&
					worldY < item.transform.y + item.transform.height
				) {
					selection.clear();
					selection.add(item.id);
				}
			}
		});

		workspace.addEventListener('contextmenu', (ev) => ev.preventDefault());

		workspace.addEventListener(
			'mouseup',
			(ev) => {
				if (ev.button == 1) {
					ev.preventDefault();
					ev.stopPropagation();
					middleButtonDown = false;
				}

				if (gizmoHeldDirection && ev.button == 0) {
					gizmoHeldDirection = null;
				}
			},
			{ passive: false }
		);

		workspace.addEventListener('mousemove', (ev) => {
			if (middleButtonDown) {
				ev.preventDefault();
				moveX -= oldMouseX - ev.clientX;
				moveY -= oldMouseY - ev.clientY;
				((oldMouseX = ev.clientX), (oldMouseY = ev.clientY));
				console.log(moveX, moveY);
			}

			mouse.setMousePos(ev.clientX, ev.clientY);
			mousePos = { x: mouse.pos.x, y: mouse.pos.y };
		});

		workspace.addEventListener('wheel', (ev) => {
			ev.preventDefault();

			let x = ev.deltaX;
			let y = ev.deltaY;

			if (ev.ctrlKey) {
				console.log('Zoom');
			} else {
				moveX = -x;
				moveY = -y;
			}
		});

		function loop() {
			if (moveX !== 0 || moveY !== 0) {
				camera.move(moveX, moveY);
				moveX = 0;
				moveY = 0;
				cameraPos = camera.pos;
			}

			requestAnimationFrame(loop);
		}

		requestAnimationFrame(loop);
	});

	let test: PIXI.Texture | undefined;

	const draw: GraphicsProps['draw'] = (g) => {
		let worldX = mouse.pos.x - camera.pos.x,
			worldY = mouse.pos.y - camera.pos.y;

		g.save();
		let hit = hitTest(worldX, worldY);
		if (hit.type == 'Handle') {
			console.log(hit.alignment);
		}
		g.restore();

		const drawLayers = () => {
			g.save();
			for (const item of items) {
				if (item.type == 'frame') {
					g.fill(item.appearance.fill ?? 'red')
						.stroke({
							width: item.appearance.strokeWidth ?? 0,
							color: item.appearance.stroke ?? 'green',
							alignment:
								(item.appearance.strokeAlignment ?? 'center') == 'center'
									? 0.5
									: item.appearance.strokeAlignment == 'inside'
										? 0
										: 1
						})
						.rect(item.transform.x, item.transform.y, item.transform.width, item.transform.height)
						.fill()
						.stroke();
				}
			}
			g.restore();
		};

		const drawEditorOverlay = () => {
			if (boundary) {
				g.save();

				g.rect(boundary.x, boundary.y, boundary.width, boundary.height)
					.stroke('red')
					.fill('transparent');

				g.restore();

				g.save();

				let gizmos = {
					TopLeft: { x: boundary.x - 5, y: boundary.y - 5 },
					TopRight: { x: boundary.x + boundary.width - 5, y: boundary.y - 5 },
					BottomLeft: { x: boundary.x - 5, y: boundary.y + boundary.height - 5 },
					BottomRight: { x: boundary.x + boundary.width - 5, y: boundary.y + boundary.height - 5 }
				};

				for (let gizmoKey in gizmos) {
					let gizmo = gizmos[gizmoKey as keyof typeof gizmos];
					g.save();
					g.circle(gizmo.x + 5, gizmo.y + 5, 25)
						.stroke('orange')
						.fill('transparent');
					g.restore();
					let rect = g.rect(gizmo.x, gizmo.y, 10, 10);

					if (hit.type == 'Handle' && hit.alignment == gizmoKey) {
						rect.stroke('red').fill('orange');
					} else rect.stroke('red').fill('white');
				}

				g.restore();
			}
		};

		drawLayers();
		drawEditorOverlay();
	};

	const init: ApplicationProps['oninit'] = (a) => {
		const resize = () => {
			const w = window.innerWidth;
			const h = window.innerHeight;
			const dpr = window.devicePixelRatio;

			a.application.renderer.resolution = dpr;
			a.application.renderer.resize(w, h);
		};

		resize();
		window.addEventListener('resize', resize);

		a.application.ticker.add(() => graphics.clear() && draw(graphics));
	};

	function getCursorStyle() {
		let hit = hitTest(mousePos.x - cameraPos.x, mousePos.y - cameraPos.y);
		let cursor = '';

		if (hit.type == 'Handle') {
			if (hit.alignment == 'TopLeft') cursor = 'nw-resize';
			if (hit.alignment == 'TopRight') cursor = 'sw-resize';
			if (hit.alignment == 'BottomLeft') cursor = 'ne-resize';
			if (hit.alignment == 'BottomRight') cursor = 'se-resize';
		}

		return `cursor: ${cursor ?? 'default'};`;
	}
</script>

<div
	bind:this={workspace}
	class="pointer-events-auto fixed top-0 left-0 h-screen w-screen overflow-hidden **:pointer-events-none"
	style={`${getCursorStyle()}`}
>
	<div class="fixed p-[20px]">
		<p>{hitTest(mousePos.x - cameraPos.x, mousePos.y - cameraPos.y).type}</p>
		<p>{cameraPos.x}, {cameraPos.y}</p>
		<p>{mousePos.x}, {mousePos.y}</p>
	</div>
	{#if browser}
		<Application
			backgroundAlpha={0}
			clearBeforeRender={true}
			oninit={init}
			resolution={window.devicePixelRatio}
			autoDensity
			antialias
			webgl={{ antialias: true }}
		>
			<Container x={cameraPos.x} y={cameraPos.y}>
				<Graphics bind:instance={graphics} />
			</Container>
		</Application>
	{/if}
</div>
