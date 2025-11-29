import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type BadgeContext = Context<AppEnv>;


// Get list of all badges with user count, ordered by popularity
export async function badgeList(c: BadgeContext) {
	try {
		const badges = await prisma.badge.findMany({
			include: {
				_count: {
					select: {
						userBadges: true,
					},
				},
			},
			orderBy: {
				userBadges: {
					_count: 'desc',
				},
			},
		});

		// Transform the response to match expected format
		const badgesWithCount = badges.map((badge) => ({
			id: badge.id,
			title: badge.title,
			description: badge.description,
			icon: badge.icon,
			type: badge.type,
			criteria: badge.criteria,
			created: badge.created,
			userCount: badge._count.userBadges,
		}));

		return c.json({
			success: true,
			data: badgesWithCount,
		});
	} catch (error) {
		console.error("Error retrieving badges:", error);
		return c.json(
			{
				success: false,
				error: "Failed to retrieve badges",
			},
			500
		);
	}
}
