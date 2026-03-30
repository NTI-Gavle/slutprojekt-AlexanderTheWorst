import { writable } from 'svelte/store';

export const navbar = writable<CallableFunction | undefined>(undefined);
