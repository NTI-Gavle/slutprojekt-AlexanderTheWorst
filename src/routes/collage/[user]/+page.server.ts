import { Client } from '../../../lib/client';
import type { RequestEvent } from './$types';

export const load = async (event: RequestEvent) => {
	const requestedUser = event.params.user;

	const user = await Client.user.findFirst({
		where: {
			username: requestedUser
		}
	});

	if (!user)
		return {
			requestedUser,
			targetUser: null
		};

	return {
		requestedUser,
		canEdit: event.locals.user && event.locals.user.id == user.id,
		targetUser: {
			id: user.id,
			username: user.username
		}
	};
};
