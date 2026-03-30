import { redirect } from "@sveltejs/kit";
import type { RequestEvent } from "../$types";

export async function load(request: RequestEvent) {
    if (request.locals.user)
        throw redirect(302, "/home")

    return {
        user: request.locals.user
    }
}