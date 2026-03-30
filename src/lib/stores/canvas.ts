import { writable, derived } from 'svelte/store';

const pos = { x: 0, y: 0 };

function panTo(x: number, y: number) {
	pos.x = x;
	pos.y = y;
}

function moveX(x: number) {
	pos.x += x;
}

function moveY(y: number) {
	pos.y += y;
}

function move(x: number, y: number) {
	pos.x += x;
	pos.y += y;
}

export const camera = {
	pos,
	panTo,
	move,
	moveX,
	moveY
};

const mousePosition = { x: 0, y: 0 };

function setMousePos(x: number, y: number) {
	mousePosition.x = x;
	mousePosition.y = y;
}

export const mouse = { pos: mousePosition, setMousePos };

const selectionList = writable(new Set<string>());
const _items = new Set<string>();

selectionList.subscribe((i) => {
	_items.forEach((a) => {
		if (!i.has(a)) _items.delete(a);
	});
	i.forEach((a) => {
		if (!_items.has(a)) _items.add(a);
	});
});

function add(id: string) {
	selectionList.update((old: Set<string>) => {
		let next = new Set(old);
		next.add(id);
		console.log(next);
		return next;
	});
}

function remove(id: string) {
	selectionList.update((old: Set<string>) => {
		let next = new Set(old);
		if (next.has(id)) {
			next.delete(id);
		}
		return next;
	});
}

function clear() {
	selectionList.set(new Set<string>());
}

export const selection = { items: selectionList, _items, add, remove, clear };
