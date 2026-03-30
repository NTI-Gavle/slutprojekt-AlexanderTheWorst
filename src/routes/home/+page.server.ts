import { redirect } from "@sveltejs/kit";
import type { PageServerLoad, RequestEvent } from "./$types";

export const load: PageServerLoad = (request: RequestEvent) => {
    if (!request.locals.user)
        throw redirect(302, "/");

    return {}
}