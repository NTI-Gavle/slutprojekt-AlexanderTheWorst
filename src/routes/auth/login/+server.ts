import { Client } from '../../../lib/client';
import type { RequestEvent } from './$types';
import argon from "argon2";
import jwt from "jsonwebtoken"

function Respond(body: Object | Array<any> | String | Number, init?: { headers?: Headers | undefined, status?: number }) {
    return new Response(JSON.stringify(body), init ? {
        headers: init.headers ?? {},
        status: init.status ?? 200
    } : {})
}

export const POST = async ({ request, cookies }: RequestEvent) => {
    const { username, password } = await request.json();

    if (!username || !password) return Respond({
        errors: {
            username: {
                keepValue: true,
                error: "Username or password is missing."
            },
            password: {
                keepValue: true,
                error: "Username or password is missing."
            },
        }
    }, {
        status: 403
    })

    const user = await Client.user.findFirst({
        where: {
            username
        }
    });

    if (!user) return Respond({
        errors: {
            username: {
                keepValue: true,
                error: "Username or password is invalid."
            },
            password: {
                keepValue: true,
                error: "Username or password is invalid."
            },
        }
    }, {
        status: 403
    })

    if (!(await argon.verify(user?.password!, password))) return Respond({
        errors: {
            username: {
                keepValue: true,
                error: "Incorrect credentials"
            },
            password: {
                keepValue: true,
                error: "Incorrect credentials"
            },
        }
    }, {
        status: 403
    });

    let at = jwt.sign({
        username: user.username,
        id: user.id
    }, process.env.ACCESS_TOKEN_SECRET!, {
        expiresIn: "10s"
    })

    let rt = jwt.sign({
        user: {
            username: user.username,
            id: user.id
        }
    }, process.env.REFRESH_TOKEN_SECRET!, {
        expiresIn: "7d"
    })

    cookies.set("ACCESS_TOKEN", at, {
        secure: false,
        path: "/",
        httpOnly: true
    })


    cookies.set("REFRESH_TOKEN", rt, {
        secure: false,
        path: "/",
        httpOnly: true
    })

    return Respond({
        success: true,
        user: {
            username: user.username,
            id: user.id
        }
    })
}