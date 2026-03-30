import type { RequestEvent } from "@sveltejs/kit";

export const load = (request: RequestEvent) => {
    return {
        user: request.locals.user ? request.locals.user : undefined
    };
}