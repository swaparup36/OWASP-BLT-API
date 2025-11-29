import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type LeaderboardContext = Context<AppEnv>;

interface LeaderboardUser {
	rank: number;
	id: number;
	User: string;
	score: number;
	image: string | null;
	title_type: string;
	follows: number;
	savedissue: number;
}

interface MonthWinner {
	user: any;
	month: string;
}

// Helper function to calculate date range for filtering
function getDateRange(month?: string, year?: string) {
	if (!year) return null;

	const yearNum = parseInt(year);
	
	if (month) {
		const monthNum = parseInt(month);
		const startDate = new Date(yearNum, monthNum - 1, 1);
		const endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
		return { startDate, endDate };
	}

	// If no month, return range for entire year
	const startDate = new Date(yearNum, 0, 1);
	const endDate = new Date(yearNum, 11, 31, 23, 59, 59, 999);
	return { startDate, endDate };
}

// Get leaderboard data with filtering by month/year
async function getLeaderboard(month?: string, year?: string) {
	const dateRange = year ? getDateRange(month, year) : null;

	const pointsWhere: any = {};
	if (dateRange) {
		pointsWhere.created = {
			gte: dateRange.startDate,
			lte: dateRange.endDate,
		};
	}

	// Get users with their total scores, ordered by score
	const usersWithScores = await prisma.user.findMany({
		where: {
			points: {
				some: pointsWhere,
			},
		},
		select: {
			id: true,
			username: true,
		},
	});

	// Calculate scores for each user
	const leaderboardData = await Promise.all(
		usersWithScores.map(async (user) => {
			const scoreData = await prisma.points.aggregate({
				where: {
					userId: user.id,
					...pointsWhere,
				},
				_sum: {
					score: true,
				},
			});

			return {
				id: user.id,
				username: user.username,
				totalScore: scoreData._sum.score || 0,
			};
		})
	);

	// Sort by score descending
	leaderboardData.sort((a, b) => b.totalScore - a.totalScore);

	return leaderboardData;
}

// Get monthly winners for a year
async function getMonthlyYearLeaderboard(year: number) {
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];

	const monthlyWinners: any[] = [];

	for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
		const monthNum = monthIndex + 1;
		const leaderboard = await getLeaderboard(monthNum.toString(), year.toString());

		if (leaderboard.length > 0) {
			const winner = leaderboard[0];
			monthlyWinners.push({
				user: {
					id: winner.id,
					username: winner.username,
					score: winner.totalScore,
				},
				month: months[monthIndex],
			});
		} else {
			monthlyWinners.push({
				user: null,
				month: months[monthIndex],
			});
		}
	}

	return monthlyWinners;
}

// Filter leaderboard with pagination
export async function filterLeaderboard(c: LeaderboardContext) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		
		const month = searchParams.get("month");
		const year = searchParams.get("year");
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("page_size") || "10");

		if (!year) {
			return c.json({ error: "Year not passed" }, 400);
		}

		if (!/^\d+$/.test(year)) {
			return c.json({ error: "Invalid year passed" }, 400);
		}

		if (month) {
			if (!/^\d+$/.test(month)) {
				return c.json({ error: "Invalid month passed" }, 400);
			}

			const monthNum = parseInt(month);
			const yearNum = parseInt(year);

			// Validate month/year combination
			if (monthNum < 1 || monthNum > 12) {
				return c.json({ error: "Invalid month or year passed" }, 400);
			}

			// Check if date is valid
			try {
				new Date(yearNum, monthNum - 1, 1);
			} catch (error) {
				return c.json({ error: "Invalid month or year passed" }, 400);
			}
		}

		// Get leaderboard data
		const queryset = await getLeaderboard(month || undefined, year);

		const users: LeaderboardUser[] = [];
		let rank = 1;

		for (const user of queryset) {
			const profile = await prisma.userProfile.findUnique({
				where: { userId: user.id },
				select: {
					userAvatar: true,
					title: true,
					follows: true,
					issueSaved: {
						select: {
							id: true,
						},
					},
				},
			});

			const totalScore = user.totalScore;

			users.push({
				rank: rank,
				id: user.id,
				User: user.username,
				score: totalScore,
				image: profile?.userAvatar || null,
				title_type: profile?.title || "UNRATED",
				follows: profile?.follows.length || 0,
				savedissue: profile?.issueSaved.length || 0,
			});

			rank++;
		}

		// Paginate results
		const totalCount = users.length;
		const startIndex = (page - 1) * pageSize;
		const endIndex = startIndex + pageSize;
		const paginatedUsers = users.slice(startIndex, endIndex);

		// Pagination response
		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		return c.json({
			count: totalCount,
			next: hasNext ? `${url.pathname}?page=${page + 1}&page_size=${pageSize}&year=${year}${month ? `&month=${month}` : ""}` : null,
			previous: hasPrevious ? `${url.pathname}?page=${page - 1}&page_size=${pageSize}&year=${year}${month ? `&month=${month}` : ""}` : null,
			results: paginatedUsers,
		});
	} catch (error) {
		console.error("Error filtering leaderboard:", error);
		return c.json({ error: "Failed to retrieve leaderboard" }, 500);
	}
}

// Group leaderboard by month for a specific year
export async function groupLeaderboardByMonth(c: LeaderboardContext) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		
		let year = searchParams.get("year");

		// Default to current year if not provided
		if (!year) {
			year = new Date().getFullYear().toString();
		}

		if (!/^\d+$/.test(year)) {
			return c.json({ error: `Invalid query passed | Year:${year}` }, 400);
		}

		const yearNum = parseInt(year);
		const monthWinners = await getMonthlyYearLeaderboard(yearNum);

		return c.json(monthWinners);
	} catch (error) {
		console.error("Error grouping leaderboard by month:", error);
		return c.json({ error: "Failed to retrieve monthly leaderboard" }, 500);
	}
}

// Get global leaderboard (all time)
export async function getGlobalLeaderboard(c: LeaderboardContext) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("page_size") || "10");

		// Get all-time leaderboard data
		const queryset = await getLeaderboard();

		// Build user data with additional profile information
		const users: LeaderboardUser[] = [];
		let rank = 1;

		for (const user of queryset) {
			const profile = await prisma.userProfile.findUnique({
				where: { userId: user.id },
				select: {
					userAvatar: true,
					title: true,
					follows: true,
					issueSaved: {
						select: {
							id: true,
						},
					},
				},
			});

			const totalScore = user.totalScore;

			users.push({
				rank: rank,
				id: user.id,
				User: user.username,
				score: totalScore,
				image: profile?.userAvatar || null,
				title_type: profile?.title || "UNRATED",
				follows: profile?.follows.length || 0,
				savedissue: profile?.issueSaved.length || 0,
			});

			rank++;
		}

		// Paginate results
		const totalCount = users.length;
		const startIndex = (page - 1) * pageSize;
		const endIndex = startIndex + pageSize;
		const paginatedUsers = users.slice(startIndex, endIndex);

		// Pagination response
		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		return c.json({
			count: totalCount,
			next: hasNext ? `${url.pathname}?page=${page + 1}&page_size=${pageSize}` : null,
			previous: hasPrevious ? `${url.pathname}?page=${page - 1}&page_size=${pageSize}` : null,
			results: paginatedUsers,
		});
	} catch (error) {
		console.error("Error retrieving global leaderboard:", error);
		return c.json({ error: "Failed to retrieve leaderboard" }, 500);
	}
}

// Get organization leaderboard
export async function getOrganizationLeaderboard(c: LeaderboardContext) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("page_size") || "10");

		// Get organizations with issue counts
		const organizations = await prisma.organization.findMany({
			select: {
				id: true,
				name: true,
				slug: true,
				description: true,
				logo: true,
				url: true,
				created: true,
				modified: true,
				_count: {
					select: {
						domains: {
							where: {
								issues: {
									some: {},
								},
							},
						},
					},
				},
			},
		});

		// Calculate issue count for each organization
		const organizationsWithCounts = await Promise.all(
			organizations.map(async (org) => {
				const issueCount = await prisma.issue.count({
					where: {
						domain: {
							organizationId: org.id,
						},
					},
				});

				return {
					...org,
					issue_count: issueCount,
				};
			})
		);

		// Sort by issue count descending
		organizationsWithCounts.sort((a, b) => b.issue_count - a.issue_count);

		// Paginate results
		const totalCount = organizationsWithCounts.length;
		const startIndex = (page - 1) * pageSize;
		const endIndex = startIndex + pageSize;
		const paginatedOrganizations = organizationsWithCounts.slice(startIndex, endIndex);

		// Pagination response
		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		return c.json({
			count: totalCount,
			next: hasNext ? `${url.pathname}?leaderboard_type=organizations&page=${page + 1}&page_size=${pageSize}` : null,
			previous: hasPrevious ? `${url.pathname}?leaderboard_type=organizations&page=${page - 1}&page_size=${pageSize}` : null,
			results: paginatedOrganizations,
		});
	} catch (error) {
		console.error("Error retrieving organization leaderboard:", error);
		return c.json({ error: "Failed to retrieve organization leaderboard" }, 500);
	}
}

// Main GET handler - routes to appropriate leaderboard function
export async function getLeaderboardHandler(c: LeaderboardContext) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		
		const filter = searchParams.get("filter");
		const groupByMonth = searchParams.get("group_by_month");
		const leaderboardType = searchParams.get("leaderboard_type");

		if (filter) {
			return await filterLeaderboard(c);
		} else if (groupByMonth) {
			return await groupLeaderboardByMonth(c);
		} else if (leaderboardType === "organizations") {
			return await getOrganizationLeaderboard(c);
		} else {
			return await getGlobalLeaderboard(c);
		}
	} catch (error) {
		console.error("Error in leaderboard handler:", error);
		return c.json({ error: "Failed to retrieve leaderboard" }, 500);
	}
}
