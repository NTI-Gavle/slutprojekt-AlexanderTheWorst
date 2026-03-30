import type { Handle, RequestEvent } from '@sveltejs/kit';
import jwt, { type JsonWebTokenError } from "jsonwebtoken";

async function handleToken(event: RequestEvent) {
	const ACCESS_TOKEN = event.cookies.get("ACCESS_TOKEN");
	const REFRESH_TOKEN = event.cookies.get("REFRESH_TOKEN");

	let tokenNeedsRefreshing = false;
	let user;

	try {
		user = jwt.verify(ACCESS_TOKEN!, process.env.ACCESS_TOKEN_SECRET!) as { username: string, id: string };
	} catch (err) {
		if ((err as JsonWebTokenError).name == "TokenExpiredError")
			tokenNeedsRefreshing = true;
	}

	if (tokenNeedsRefreshing) {
		let refreshTokenExpired = false;
		let refreshTokenData;
		try {
			refreshTokenData = jwt.verify(REFRESH_TOKEN!, process.env.REFRESH_TOKEN_SECRET!) as { user: { username: string, id: string } };
		} catch (err) {
			if ((err as JsonWebTokenError).name == "TokenExpiredError")
				refreshTokenExpired = true;
		}

		if (refreshTokenExpired || !refreshTokenData) {
			event.cookies.delete("REFRESH_TOKEN", { path: "/", secure: false, httpOnly: true });
			event.cookies.delete("ACCESS_TOKEN", { path: "/", secure: false, httpOnly: true });
			return;
		}

		let at = jwt.sign(refreshTokenData.user, process.env.ACCESS_TOKEN_SECRET!, {
			expiresIn: "10s"
		});
		user = (refreshTokenData as { user: { username: string, id: string } }).user;

		event.cookies.set("ACCESS_TOKEN", at, { path: "/", secure: false, httpOnly: true })

		console.log("Time to refresh!");
	}

	if (user)
		event.locals.user = { username: user?.username!, id: user?.id! };
}

export const handle: Handle = async ({ event, resolve }) => {
	await handleToken(event);
	console.log(event.locals)

	const response = await resolve(event);
	return response;
};