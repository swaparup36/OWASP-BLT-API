import type { Context } from "hono";
import prisma from "../utils/db";

type AppContext = Context<{
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
}>;

// Interface for Hunt with prizes
interface HuntWithPrizes {
	id: number;
	name: string;
	url: string;
	prize: number;
	logo: string | null;
	banner: string | null;
	description: string;
	startsOn: Date;
	endOn: Date | null;
	isPublished: boolean;
	prizes: Array<{
		id: number;
		huntId: number;
		name: string;
		value: number;
		no_of_eligible_projects: number;
		valid_submissions_eligible: boolean;
		prize_in_crypto: boolean;
		description: string | null;
		created: Date;
	}>;
}

const HUNT_FIELDS = {
	id: true,
	name: true,
	url: true,
	prize: true,
	logo: true,
	banner: true,
	description: true,
	startsOn: true,
	endOn: true,
	isPublished: true,
};

// Serialize hunts with their associated prizes
async function serializeHunts(hunts: any[]): Promise<HuntWithPrizes[]> {
	const serializedHunts: HuntWithPrizes[] = [];

	for (const hunt of hunts) {
		const prizes = await prisma.huntPrize.findMany({
			where: {
				huntId: hunt.id,
			},
		});

		serializedHunts.push({
			...hunt,
			prizes,
		});
	}

	return serializedHunts;
}

// Get active bug hunts
async function getActiveHunts(c: AppContext) {
	const now = new Date();
	const hunts = await prisma.hunt.findMany({
		where: {
			isPublished: true,
			startsOn: {
				lte: now,
			},
			endOn: {
				gte: now,
			},
		},
		select: HUNT_FIELDS,
		orderBy: {
			prize: "desc",
		},
	});

	return await serializeHunts(hunts);
}

// Get previous bug hunts
async function getPreviousHunts(c: AppContext) {
	const now = new Date();
	const hunts = await prisma.hunt.findMany({
		where: {
			isPublished: true,
			endOn: {
				lte: now,
			},
		},
		select: HUNT_FIELDS,
		orderBy: {
			endOn: "desc",
		},
	});

	return await serializeHunts(hunts);
}

// Get upcoming bug hunts
async function getUpcomingHunts(c: AppContext) {
	const now = new Date();
	const hunts = await prisma.hunt.findMany({
		where: {
			isPublished: true,
			startsOn: {
				gte: now,
			},
		},
		select: HUNT_FIELDS,
		orderBy: {
			startsOn: "asc",
		},
	});

	return await serializeHunts(hunts);
}

// Main handler for bug hunt API with pagination (V2)
export async function listHuntsV2(c: AppContext) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;

		const activeHunt = searchParams.get("activeHunt");
		const previousHunt = searchParams.get("previousHunt");
		const upcomingHunt = searchParams.get("upcomingHunt");
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("page_size") || "10");

		let hunts: HuntWithPrizes[];

		if (activeHunt) {
			hunts = await getActiveHunts(c);
		} else if (previousHunt) {
			hunts = await getPreviousHunts(c);
		} else if (upcomingHunt) {
			hunts = await getUpcomingHunts(c);
		} else {
			const allHunts = await prisma.hunt.findMany({
				where: {
					isPublished: true,
				},
				select: HUNT_FIELDS,
				orderBy: {
					endOn: "desc",
				},
			});
			hunts = await serializeHunts(allHunts);
		}

		const totalCount = hunts.length;
		const startIndex = (page - 1) * pageSize;
		const endIndex = startIndex + pageSize;
		const paginatedHunts = hunts.slice(startIndex, endIndex);

		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		const queryParams = new URLSearchParams();
		if (activeHunt) queryParams.set("activeHunt", activeHunt);
		if (previousHunt) queryParams.set("previousHunt", previousHunt);
		if (upcomingHunt) queryParams.set("upcomingHunt", upcomingHunt);
		queryParams.set("page_size", pageSize.toString());

		const baseUrl = url.pathname;
		const nextUrl = hasNext
			? `${baseUrl}?${new URLSearchParams({ ...Object.fromEntries(queryParams), page: (page + 1).toString() }).toString()}`
			: null;
		const previousUrl = hasPrevious
			? `${baseUrl}?${new URLSearchParams({ ...Object.fromEntries(queryParams), page: (page - 1).toString() }).toString()}`
			: null;

		return c.json({
			count: totalCount,
			next: nextUrl,
			previous: previousUrl,
			results: paginatedHunts,
		});
	} catch (error) {
		console.error("Error fetching hunts (V2):", error);
		return c.json({ error: "Failed to fetch hunts" }, 500);
	}
}
