import type { RequestEvent } from './$types';

import { Client } from '../../lib/client';
import { createHash } from 'node:crypto';

export const GET = async (event: RequestEvent) => {
    event.cookies.set("sigma", "sigma", {
        domain: "localhost",
        httpOnly: false,
        path: "/",
        secure: false,
        expires: new Date(Date.now() + 1000 * 60)
    })

    const user = await Client.user.create({
        data: {
            username: "test",
            password: createHash("sha256").update("sigmaaa").digest("hex").toString()
        }
    })

    const data = { message: "Hello from server" };

    return new Response(JSON.stringify(user), {
        headers: { 'Content-Type': 'application/json' }
    });
};