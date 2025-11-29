import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type HackathonContext = Context<AppEnv>;

// Constants for rate limiting
const REPO_REFRESH_DELAY_MS = 1000; // 1 second delay between repository refreshes
const GITHUB_API_DELAY_MS = 100; // 100ms delay between API calls

// Helper method to create a base query for pull requests
async function getBasePRQuery(hackathon: any, repoIds: number[], isMerged?: boolean) {
	const query: any = {
		where: {
			repoId: { in: repoIds },
			type: "PULL_REQUEST",
			AND: [
				{
					OR: [
						{ contributor: { contributorType: { not: "Bot" } } },
						{ contributor: null },
					],
				},
				{
					NOT: {
						contributor: {
							OR: [
								{ name: { endsWith: "[bot]" } },
								{ name: { contains: "bot", mode: "insensitive" } },
							],
						},
					},
				},
			],
		},
	};

	if (isMerged !== undefined) {
		query.where.isMerged = isMerged;
		if (isMerged) {
			// For merged PRs, only include those merged during the hackathon
			query.where.mergedAt = {
				gte: hackathon.startTime,
				lte: hackathon.endTime,
			};
		}
	} else {
		// For all PRs (merged or not), include those created during the hackathon
		query.where.createdAt = {
			gte: hackathon.startTime,
			lte: hackathon.endTime,
		};
	}

	return query;
}

// Helper method to fill in date ranges with data
function getDateRangeData(
	startDate: Date,
	endDate: Date,
	dataDict: Record<string, number>,
	defaultValue: number = 0
): { dates: string[]; values: number[] } {
	const resultDates: string[] = [];
	const resultValues: number[] = [];

	let currentDate = new Date(startDate);
	while (currentDate <= endDate) {
		const dateStr = currentDate.toISOString().split("T")[0];
		resultDates.push(dateStr);
		resultValues.push(dataDict[dateStr] || defaultValue);
		currentDate.setDate(currentDate.getDate() + 1);
	}

	return { dates: resultDates, values: resultValues };
}

// Helper method to count unique participants from PRs
function getParticipantCount(prs: any[]): number {
	const userProfiles = new Set(prs.filter((pr) => pr.userProfileId).map((pr) => pr.userProfileId));

	// Count unique contributors (GitHub users not registered on the platform)
	// Exclude bot accounts
	const contributors = new Set(
		prs
			.filter(
				(pr) =>
					!pr.userProfileId &&
					pr.contributorId &&
					pr.contributor &&
					pr.contributor.contributorType !== "Bot" &&
					!pr.contributor.name?.endsWith("[bot]") &&
					!pr.contributor.name?.toLowerCase().includes("bot")
			)
			.map((pr) => pr.contributorId)
	);

	return userProfiles.size + contributors.size;
}

// Calculate leaderboard data for a hackathon
async function getLeaderboard(hackathonId: number, repoIds: number[], startTime: Date, endTime: Date) {
	const mergedPRs = await prisma.githubIssue.findMany({
		where: {
			repoId: { in: repoIds },
			type: "PULL_REQUEST",
			isMerged: true,
			mergedAt: {
				gte: startTime,
				lte: endTime,
			},
			AND: [
				{
					OR: [
						{ contributor: { contributorType: { not: "Bot" } } },
						{ contributor: null },
					],
				},
				{
					NOT: {
						contributor: {
							OR: [
								{ name: { endsWith: "[bot]" } },
								{ name: { contains: "bot", mode: "insensitive" } },
							],
						},
					},
				},
			],
		},
		include: {
			userProfile: {
				include: {
					user: {
						select: {
							id: true,
							username: true,
							email: true,
						},
					},
				},
			},
			contributor: true,
		},
	});

	// Count PRs per participant
	const participantCounts: Record<string, { count: number; data: any }> = {};

	for (const pr of mergedPRs) {
		let key: string;
		let participantData: any;

		if (pr.userProfileId) {
			key = `user_${pr.userProfileId}`;
			participantData = {
				type: "user",
				id: pr.userProfile?.userId,
				username: pr.userProfile?.user?.username,
				email: pr.userProfile?.user?.email,
				avatar: pr.userProfile?.userAvatar,
			};
		} else if (pr.contributorId) {
			key = `contributor_${pr.contributorId}`;
			participantData = {
				type: "contributor",
				id: pr.contributor?.githubId,
				username: pr.contributor?.name,
				githubUrl: pr.contributor?.githubUrl,
				avatar: pr.contributor?.avatarUrl,
			};
		} else {
			continue;
		}

		if (!participantCounts[key]) {
			participantCounts[key] = { count: 0, data: participantData };
		}
		participantCounts[key].count++;
	}

	// Convert to array and sort by count
	const leaderboard = Object.values(participantCounts)
		.sort((a, b) => b.count - a.count)
		.slice(0, 100) // Top 100
		.map((item, index) => ({
			rank: index + 1,
			...item.data,
			merged_pr_count: item.count,
		}));

	return leaderboard;
}

// Get hackathon details by slug
export async function getHackathonDetail(c: HackathonContext) {
	try {
		const slug = c.req.param("slug");

		if (!slug) {
			return c.json({ detail: "Slug is required" }, 400);
		}

		// Fetch hackathon with related data
		const hackathon = await prisma.hackathon.findUnique({
			where: { slug },
			include: {
				organization: {
					select: {
						id: true,
						name: true,
						slug: true,
						logo: true,
						url: true,
					},
				},
				repositories: {
					select: {
						id: true,
						name: true,
						repoUrl: true,
						description: true,
						stars: true,
						forks: true,
					},
				},
				sponsors: {
					include: {
						organization: {
							select: {
								id: true,
								name: true,
								logo: true,
								url: true,
							},
						},
					},
				},
				hackathonPrizes: {
					include: {
						sponsor: {
							include: {
								organization: {
									select: {
										id: true,
										name: true,
										logo: true,
									},
								},
							},
						},
					},
					orderBy: {
						position: "asc",
					},
				},
			},
		});

		if (!hackathon) {
			return c.json({ detail: "Hackathon not found" }, 404);
		}

		// Get repository IDs
		const repoIds = hackathon.repositories.map((repo) => repo.id);

		// Check if user can manage this hackathon
		let canManage = false;
		const userId = c.get("userId");
		if (userId) {
			const user = await prisma.user.findUnique({
				where: { id: parseInt(userId) },
				select: {
					isSuperuser: true,
					adminOrganizations: {
						where: { id: hackathon.organizationId },
						select: { id: true },
					},
					managerOrganizations: {
						where: { id: hackathon.organizationId },
						select: { id: true },
					},
				},
			});

			if (user) {
				canManage =
					user.isSuperuser ||
					user.adminOrganizations.length > 0 ||
					user.managerOrganizations.length > 0;
			}
		}

		// Get leaderboard
		const leaderboard = await getLeaderboard(
			hackathon.id,
			repoIds,
			hackathon.startTime,
			hackathon.endTime
		);

		// Get repositories with merged PR counts
		const reposWithPRCounts = await Promise.all(
			hackathon.repositories.map(async (repo) => {
				const mergedPRCount = await prisma.githubIssue.count({
					where: {
						repoId: repo.id,
						type: "PULL_REQUEST",
						isMerged: true,
						mergedAt: {
							gte: hackathon.startTime,
							lte: hackathon.endTime,
						},
						AND: [
							{
								OR: [
									{ contributor: { contributorType: { not: "Bot" } } },
									{ contributor: null },
								],
							},
							{
								NOT: {
									contributor: {
										OR: [
											{ name: { endsWith: "[bot]" } },
											{ name: { contains: "bot", mode: "insensitive" } },
										],
									},
								},
							},
						],
					},
				});

				return {
					repo,
					merged_pr_count: mergedPRCount,
				};
			})
		);

		// Get PR data per day for chart (all PRs)
		const allPRs = await prisma.githubIssue.findMany({
			where: (await getBasePRQuery(hackathon, repoIds)).where,
			select: {
				createdAt: true,
			},
		});

		// Get merged PR data per day
		const mergedPRs = await prisma.githubIssue.findMany({
			where: (await getBasePRQuery(hackathon, repoIds, true)).where,
			select: {
				mergedAt: true,
			},
		});

		// Create dictionaries for date-based counts
		const datePRCounts: Record<string, number> = {};
		for (const pr of allPRs) {
			const dateStr = pr.createdAt.toISOString().split("T")[0];
			datePRCounts[dateStr] = (datePRCounts[dateStr] || 0) + 1;
		}

		const dateMergedPRCounts: Record<string, number> = {};
		for (const pr of mergedPRs) {
			if (pr.mergedAt) {
				const dateStr = pr.mergedAt.toISOString().split("T")[0];
				dateMergedPRCounts[dateStr] = (dateMergedPRCounts[dateStr] || 0) + 1;
			}
		}

		// Fill in all dates in the range
		const startDate = new Date(hackathon.startTime);
		startDate.setHours(0, 0, 0, 0);
		const endDate = new Date(hackathon.endTime);
		endDate.setHours(0, 0, 0, 0);

		const prData = getDateRangeData(startDate, endDate, datePRCounts);
		const mergedPRData = getDateRangeData(startDate, endDate, dateMergedPRCounts);

		// Get sponsors by level
		const sponsorsByLevel = {
			platinum: hackathon.sponsors.filter((s) => s.sponsorLevel === "PLATINUM"),
			gold: hackathon.sponsors.filter((s) => s.sponsorLevel === "GOLD"),
			silver: hackathon.sponsors.filter((s) => s.sponsorLevel === "SILVER"),
			bronze: hackathon.sponsors.filter((s) => s.sponsorLevel === "BRONZE"),
			partner: hackathon.sponsors.filter((s) => s.sponsorLevel === "PARTNER"),
		};

		// Get participant count from merged PRs
		const mergedPRsWithContributors = await prisma.githubIssue.findMany({
			where: (await getBasePRQuery(hackathon, repoIds, true)).where,
			include: {
				userProfile: true,
				contributor: true,
			},
		});
		const participantCount = getParticipantCount(mergedPRsWithContributors);

		// Count pull requests
		const prCount = await prisma.githubIssue.count({
			where: (await getBasePRQuery(hackathon, repoIds)).where,
		});

		// Count merged pull requests
		const mergedPRCount = await prisma.githubIssue.count({
			where: (await getBasePRQuery(hackathon, repoIds, true)).where,
		});

		// Get view data for sparkline chart
		const hackathonPath = `/hackathons/${hackathon.slug}/`;
		const chartEndDate = new Date(Math.min(endDate.getTime(), new Date().getTime()));

		// Query IP table for view counts during hackathon period
		const viewData = await prisma.iP.groupBy({
			by: ["created"],
			where: {
				path: {
					contains: hackathonPath,
				},
				created: {
					gte: startDate,
					lte: chartEndDate,
				},
			},
			_sum: {
				count: true,
			},
		});

		// Prepare data for the sparkline chart
		const dateCountsView: Record<string, number> = {};
		for (const item of viewData) {
			const dateStr = item.created.toISOString().split("T")[0];
			dateCountsView[dateStr] = Number(item._sum.count || 0);
		}

		const viewChartData = getDateRangeData(startDate, chartEndDate, dateCountsView);

		// Calculate all-time views
		const allTimeViewsResult = await prisma.iP.aggregate({
			where: {
				path: {
					contains: hackathonPath,
				},
			},
			_sum: {
				count: true,
			},
		});
		const allTimeViews = Number(allTimeViewsResult._sum.count || 0);

		// Prepare response
		const response = {
			id: hackathon.id,
			name: hackathon.name,
			slug: hackathon.slug,
			description: hackathon.description,
			organization: hackathon.organization,
			start_time: hackathon.startTime,
			end_time: hackathon.endTime,
			banner_image: hackathon.bannerImage,
			is_active: hackathon.isActive,
			rules: hackathon.rules,
			registration_open: hackathon.registrationOpen,
			max_participants: hackathon.maxParticipants,
			sponsor_note: hackathon.sponsorNote,
			sponsor_link: hackathon.sponsorLink,
			created: hackathon.created,
			modified: hackathon.modified,

			// Additional computed data
			can_manage: canManage,
			leaderboard,
			repositories: reposWithPRCounts,
			sponsors_by_level: sponsorsByLevel,
			prizes: hackathon.hackathonPrizes,
			participant_count: participantCount,
			pr_count: prCount,
			merged_pr_count: mergedPRCount,

			// Chart data
			pr_dates: prData.dates,
			pr_counts: prData.values,
			merged_pr_counts: mergedPRData.values,
			view_dates: viewChartData.dates,
			view_counts: viewChartData.values,
			hackathon_views: viewChartData.values.reduce((a, b) => a + b, 0),
			all_time_views: allTimeViews,

			// Breadcrumbs
			breadcrumbs: [
				{ title: "Hackathons", url: "/hackathons" },
				{ title: hackathon.name, url: null },
			],
		};

		return c.json(response);
	} catch (error) {
		console.error("Error fetching hackathon details:", error);
		return c.json({ detail: "Internal server error" }, 500);
	}
}

// List all hackathons with optional filters
export async function listHackathons(c: HackathonContext) {
	try {
		const { organization, status, time, page = "1", limit = "10" } = c.req.query();

		const pageNum = parseInt(page);
		const limitNum = parseInt(limit);
		const skip = (pageNum - 1) * limitNum;

		const where: any = {};
		const now = new Date();

		// Filter by active status
		if (status === "active") {
			where.isActive = true;
		} else if (status === "inactive") {
			where.isActive = false;
		}

		// Filter by time (upcoming, ongoing, past)
		if (time === "upcoming") {
			where.startTime = { gt: now };
		} else if (time === "ongoing") {
			where.startTime = { lte: now };
			where.endTime = { gte: now };
		} else if (time === "past") {
			where.endTime = { lt: now };
		}

		// Filter by organization
		if (organization) {
			const orgId = parseInt(organization);
			if (!isNaN(orgId)) {
				where.organizationId = orgId;
			}
		}

		// Execute queries in parallel for better performance
		const [hackathons, total, upcomingCount, ongoingCount, pastCount, organizations] = await Promise.all([
			// Get paginated hackathons
			prisma.hackathon.findMany({
				where,
				include: {
					organization: {
						select: {
							id: true,
							name: true,
							slug: true,
							logo: true,
						},
					},
					_count: {
						select: {
							repositories: true,
							sponsors: true,
							hackathonPrizes: true,
						},
					},
				},
				orderBy: {
					startTime: "desc",
				},
				skip,
				take: limitNum,
			}),
			// Get total count for pagination
			prisma.hackathon.count({ where }),
			// Get upcoming count
			prisma.hackathon.count({
				where: {
					startTime: { gt: now },
				},
			}),
			// Get ongoing count
			prisma.hackathon.count({
				where: {
					startTime: { lte: now },
					endTime: { gte: now },
				},
			}),
			// Get past count
			prisma.hackathon.count({
				where: {
					endTime: { lt: now },
				},
			}),
			// Get all organizations for filter dropdown
			prisma.organization.findMany({
				select: {
					id: true,
					name: true,
					slug: true,
				},
				orderBy: {
					name: "asc",
				},
			}),
		]);

		return c.json({
			results: hackathons,
			count: total,
			page: pageNum,
			page_size: limitNum,
			total_pages: Math.ceil(total / limitNum),

			// Quick stats for UI
			stats: {
				upcoming_count: upcomingCount,
				ongoing_count: ongoingCount,
				past_count: pastCount,
			},

			// Organizations for filter dropdown
			organizations,

			// Current filter values (useful for maintaining UI state)
			filters: {
				status: status || "",
				time: time || "",
				organization: organization || "",
			},
		});
	} catch (error) {
		console.error("Error listing hackathons:", error);
		return c.json({ detail: "Internal server error" }, 500);
	}
}

// Create a new prize for a hackathon
export async function createHackathonPrize(c: HackathonContext) {
	try {
		const slug = c.req.param("slug");
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (!slug) {
			return c.json({ detail: "Hackathon slug is required" }, 400);
		}

		// Fetch hackathon
		const hackathon = await prisma.hackathon.findUnique({
			where: { slug },
			select: {
				id: true,
				organizationId: true,
			},
		});

		if (!hackathon) {
			return c.json({ detail: "Hackathon not found" }, 404);
		}

		// Check if user can manage this hackathon
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
			select: {
				isSuperuser: true,
				adminOrganizations: {
					where: { id: hackathon.organizationId },
					select: { id: true },
				},
				managerOrganizations: {
					where: { id: hackathon.organizationId },
					select: { id: true },
				},
			},
		});

		if (!user) {
			return c.json({ detail: "User not found" }, 404);
		}

		const canManage =
			user.isSuperuser || user.adminOrganizations.length > 0 || user.managerOrganizations.length > 0;

		if (!canManage) {
			return c.json({ detail: "You do not have permission to add prizes to this hackathon" }, 403);
		}

		const body = await c.req.json();
		const { position, title, description, value, sponsor_id } = body;

		if (!position || !title || !description) {
			return c.json(
				{
					detail: "Missing required fields",
					required: ["position", "title", "description"],
				},
				400
			);
		}

		// Validate position enum
		const validPositions = ["FIRST_PLACE", "SECOND_PLACE", "THIRD_PLACE", "SPECIAL_PLACE"];
		if (!validPositions.includes(position)) {
			return c.json(
				{
					detail: "Invalid position",
					valid_values: validPositions,
				},
				400
			);
		}

		// Validate sponsor if provided
		if (sponsor_id) {
			const sponsor = await prisma.hackathonSponsor.findFirst({
				where: {
					id: parseInt(sponsor_id),
					hackathonId: hackathon.id,
				},
			});

			if (!sponsor) {
				return c.json({ detail: "Sponsor not found or not associated with this hackathon" }, 400);
			}
		}

		// Create the prize
		const prize = await prisma.hackathonPrize.create({
			data: {
				hackathonId: hackathon.id,
				position,
				title,
				description,
				value: value ? parseFloat(value) : null,
				sponsorId: sponsor_id ? parseInt(sponsor_id) : null,
			},
			include: {
				sponsor: {
					include: {
						organization: {
							select: {
								id: true,
								name: true,
								logo: true,
							},
						},
					},
				},
			},
		});

		return c.json(prize, 201);
	} catch (error) {
		console.error("Error creating hackathon prize:", error);
		return c.json({ detail: "Internal server error" }, 500);
	}
}

// Create a new sponsor for a hackathon
export async function createHackathonSponsor(c: HackathonContext) {
	try {
		const slug = c.req.param("slug");
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (!slug) {
			return c.json({ detail: "Hackathon slug is required" }, 400);
		}

		// Fetch hackathon
		const hackathon = await prisma.hackathon.findUnique({
			where: { slug },
			select: {
				id: true,
				organizationId: true,
			},
		});

		if (!hackathon) {
			return c.json({ detail: "Hackathon not found" }, 404);
		}

		// Check if user can manage this hackathon
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
			select: {
				isSuperuser: true,
				adminOrganizations: {
					where: { id: hackathon.organizationId },
					select: { id: true },
				},
				managerOrganizations: {
					where: { id: hackathon.organizationId },
					select: { id: true },
				},
			},
		});

		if (!user) {
			return c.json({ detail: "User not found" }, 404);
		}

		const canManage =
			user.isSuperuser || user.adminOrganizations.length > 0 || user.managerOrganizations.length > 0;

		if (!canManage) {
			return c.json({ detail: "You do not have permission to add sponsors to this hackathon" }, 403);
		}

		const body = await c.req.json();
		const { organization_id, sponsor_level, logo, website } = body;

		if (!organization_id || !sponsor_level) {
			return c.json(
				{
					detail: "Missing required fields",
					required: ["organization_id", "sponsor_level"],
				},
				400
			);
		}

		// Validate sponsor level enum
		const validLevels = ["PLATINUM", "GOLD", "SILVER", "BRONZE", "PARTNER"];
		if (!validLevels.includes(sponsor_level)) {
			return c.json(
				{
					detail: "Invalid sponsor level",
					valid_values: validLevels,
				},
				400
			);
		}

		// Validate organization exists
		const organization = await prisma.organization.findUnique({
			where: { id: parseInt(organization_id) },
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Check if this organization is already a sponsor for this hackathon
		const existingSponsor = await prisma.hackathonSponsor.findFirst({
			where: {
				hackathonId: hackathon.id,
				organizationId: parseInt(organization_id),
			},
		});

		if (existingSponsor) {
			return c.json({ detail: "This organization is already a sponsor for this hackathon" }, 400);
		}

		// Create the sponsor
		const sponsor = await prisma.hackathonSponsor.create({
			data: {
				hackathonId: hackathon.id,
				organizationId: parseInt(organization_id),
				sponsorLevel: sponsor_level,
				logo: logo || null,
				website: website || null,
			},
			include: {
				organization: {
					select: {
						id: true,
						name: true,
						slug: true,
						logo: true,
						url: true,
					},
				},
			},
		});

		return c.json(sponsor, 201);
	} catch (error) {
		console.error("Error creating hackathon sponsor:", error);
		return c.json({ detail: "Internal server error" }, 500);
	}
}

// Update an existing hackathon
export async function updateHackathon(c: HackathonContext) {
	try {
		const slug = c.req.param("slug");
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (!slug) {
			return c.json({ detail: "Hackathon slug is required" }, 400);
		}

		// Fetch hackathon
		const hackathon = await prisma.hackathon.findUnique({
			where: { slug },
			select: {
				id: true,
				organizationId: true,
			},
		});

		if (!hackathon) {
			return c.json({ detail: "Hackathon not found" }, 404);
		}

		// Check if user can manage this hackathon
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
			select: {
				isSuperuser: true,
				adminOrganizations: {
					where: { id: hackathon.organizationId },
					select: { id: true },
				},
				managerOrganizations: {
					where: { id: hackathon.organizationId },
					select: { id: true },
				},
			},
		});

		if (!user) {
			return c.json({ detail: "User not found" }, 404);
		}

		const canManage =
			user.isSuperuser || user.adminOrganizations.length > 0 || user.managerOrganizations.length > 0;

		if (!canManage) {
			return c.json({ detail: "You do not have permission to update this hackathon" }, 403);
		}

		const body = await c.req.json();
		const {
			name,
			description,
			start_time,
			end_time,
			banner_image,
			is_active,
			rules,
			registration_open,
			max_participants,
			sponsor_note,
			sponsor_link,
		} = body;

		// Build update data object with only provided fields
		const updateData: any = {};

		if (name !== undefined) updateData.name = name;
		if (description !== undefined) updateData.description = description;
		if (start_time !== undefined) updateData.startTime = new Date(start_time);
		if (end_time !== undefined) updateData.endTime = new Date(end_time);
		if (banner_image !== undefined) updateData.bannerImage = banner_image;
		if (is_active !== undefined) updateData.isActive = is_active;
		if (rules !== undefined) updateData.rules = rules;
		if (registration_open !== undefined) updateData.registrationOpen = registration_open;
		if (max_participants !== undefined) updateData.maxParticipants = max_participants;
		if (sponsor_note !== undefined) updateData.sponsorNote = sponsor_note;
		if (sponsor_link !== undefined) updateData.sponsorLink = sponsor_link;

		// Validate dates if both are provided
		if (updateData.startTime && updateData.endTime) {
			if (updateData.startTime >= updateData.endTime) {
				return c.json({ detail: "End time must be after start time" }, 400);
			}
		}

		// Update the hackathon
		const updatedHackathon = await prisma.hackathon.update({
			where: { id: hackathon.id },
			data: updateData,
			include: {
				organization: {
					select: {
						id: true,
						name: true,
						slug: true,
						logo: true,
						url: true,
					},
				},
				repositories: {
					select: {
						id: true,
						name: true,
						repoUrl: true,
						description: true,
					},
				},
				sponsors: {
					include: {
						organization: {
							select: {
								id: true,
								name: true,
								logo: true,
								url: true,
							},
						},
					},
				},
				hackathonPrizes: {
					include: {
						sponsor: {
							include: {
								organization: {
									select: {
										id: true,
										name: true,
										logo: true,
									},
								},
							},
						},
					},
					orderBy: {
						position: "asc",
					},
				},
			},
		});

		// Transform response to match API naming conventions
		const response = {
			id: updatedHackathon.id,
			name: updatedHackathon.name,
			slug: updatedHackathon.slug,
			description: updatedHackathon.description,
			organization: updatedHackathon.organization,
			start_time: updatedHackathon.startTime,
			end_time: updatedHackathon.endTime,
			banner_image: updatedHackathon.bannerImage,
			is_active: updatedHackathon.isActive,
			rules: updatedHackathon.rules,
			registration_open: updatedHackathon.registrationOpen,
			max_participants: updatedHackathon.maxParticipants,
			sponsor_note: updatedHackathon.sponsorNote,
			sponsor_link: updatedHackathon.sponsorLink,
			created: updatedHackathon.created,
			modified: updatedHackathon.modified,
			repositories: updatedHackathon.repositories,
			sponsors: updatedHackathon.sponsors,
			prizes: updatedHackathon.hackathonPrizes,
			message: "Hackathon updated successfully!",
		};

		return c.json(response);
	} catch (error) {
		console.error("Error updating hackathon:", error);
		return c.json({ detail: "Internal server error" }, 500);
	}
}

// Add all organization repositories to a hackathon
export async function addOrgReposToHackathon(c: HackathonContext) {
	try {
		const slug = c.req.param("slug");
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (!slug) {
			return c.json({ detail: "Hackathon slug is required" }, 400);
		}

		// Fetch hackathon with organization details
		const hackathon = await prisma.hackathon.findUnique({
			where: { slug },
			select: {
				id: true,
				name: true,
				organizationId: true,
				organization: {
					select: {
						id: true,
						name: true,
					},
				},
				repositories: {
					select: {
						id: true,
					},
				},
			},
		});

		if (!hackathon) {
			return c.json({ detail: "Hackathon not found" }, 404);
		}

		// Check if user can manage this hackathon
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
			select: {
				isSuperuser: true,
				adminOrganizations: {
					where: { id: hackathon.organizationId },
					select: { id: true },
				},
				managerOrganizations: {
					where: { id: hackathon.organizationId },
					select: { id: true },
				},
			},
		});

		if (!user) {
			return c.json({ detail: "User not found" }, 404);
		}

		const canManage =
			user.isSuperuser || user.adminOrganizations.length > 0 || user.managerOrganizations.length > 0;

		if (!canManage) {
			return c.json({ detail: "You don't have permission to manage this hackathon" }, 403);
		}

		// Get all repos from the hackathon's organization
		const orgRepos = await prisma.repo.findMany({
			where: {
				organizationId: hackathon.organizationId,
			},
			select: {
				id: true,
				name: true,
				repoUrl: true,
				description: true,
			},
		});

		if (orgRepos.length === 0) {
			return c.json(
				{
					detail: `No repositories found for organization ${hackathon.organization.name}. Please sync the organization's repositories first.`,
					added_count: 0,
					already_added_count: 0,
				},
				404
			);
		}

		const currentRepoIds = new Set(hackathon.repositories.map((r) => r.id));

		const reposToAdd = orgRepos.filter((repo) => !currentRepoIds.has(repo.id));
		const alreadyAddedCount = orgRepos.length - reposToAdd.length;

		// Add new repos to the hackathon
		if (reposToAdd.length > 0) {
			await prisma.hackathon.update({
				where: { id: hackathon.id },
				data: {
					repositories: {
						connect: reposToAdd.map((repo) => ({ id: repo.id })),
					},
				},
			});
		}

		let message: string;
		if (reposToAdd.length > 0) {
			message = `Successfully added ${reposToAdd.length} repositories to ${hackathon.name}. (${alreadyAddedCount} were already added)`;
		} else {
			message = `All ${alreadyAddedCount} repositories from ${hackathon.organization.name} are already part of this hackathon.`;
		}

		return c.json({
			message,
			added_count: reposToAdd.length,
			already_added_count: alreadyAddedCount,
			total_repos: orgRepos.length,
		});
	} catch (error) {
		console.error("Error adding repositories to hackathon:", error);
		return c.json({ detail: "An error occurred while adding repositories to the hackathon" }, 500);
	}
}

// Helper function to delay execution
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to fetch pull requests from GitHub API
async function fetchGitHubPullRequests(
	repoUrl: string,
	page: number = 1,
	perPage: number = 100,
	state: string = "all",
	githubToken?: string
): Promise<any> {
	// Extract owner and repo from URL
	const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
	if (!match) {
		throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
	}

	const [, owner, repo] = match;
	const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&page=${page}&per_page=${perPage}`;

	const headers: Record<string, string> = {
		Accept: "application/vnd.github.v3+json",
		"User-Agent": "OWASP-BLT-API",
	};

	if (githubToken) {
		headers.Authorization = `token ${githubToken}`;
	}

	const response = await fetch(apiUrl, { headers });

	if (!response.ok) {
		if (response.status === 403) {
			const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
			const rateLimitReset = response.headers.get("X-RateLimit-Reset");
			throw new Error(
				`GitHub API rate limit exceeded. Remaining: ${rateLimitRemaining}, Reset: ${rateLimitReset}`
			);
		}
		throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
	}

	return await response.json();
}

// Helper function to refresh pull requests for a single repository
async function refreshRepositoryPullRequests(
	hackathon: any,
	repo: any,
	githubToken?: string
): Promise<number> {
	let newPRCount = 0;
	let page = 1;
	const perPage = 100;
	let hasMore = true;

	while (hasMore) {
		try {
			const pullRequests = await fetchGitHubPullRequests(
				repo.repoUrl,
				page,
				perPage,
				"all",
				githubToken
			);

			if (!pullRequests || pullRequests.length === 0) {
				hasMore = false;
				break;
			}

			// Process each pull request
			for (const pr of pullRequests) {
				try {
					// Check if PR already exists
					const existingPR = await prisma.githubIssue.findFirst({
						where: {
							issueId: BigInt(pr.id),
							repoId: repo.id,
						},
					});

					const prData: any = {
						issueId: BigInt(pr.id),
						title: pr.title || "",
						body: pr.body || "",
						state: pr.state || "open",
						type: "PULL_REQUEST",
						createdAt: new Date(pr.created_at),
						updatedAt: new Date(pr.updated_at),
						closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
						mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
						isMerged: !!pr.merged_at,
						url: pr.html_url,
						repoId: repo.id,
					};

					// Try to link to contributor if available
					if (pr.user && pr.user.login) {
						// Check if contributor already exists
						let contributor = await prisma.contributor.findFirst({
							where: {
								githubId: pr.user.id,
							},
						});

						if (contributor) {
							prData.contributorId = contributor.id;
						} else {
							// Create new contributor
							const newContributor = await prisma.contributor.create({
								data: {
									githubId: pr.user.id,
									name: pr.user.login,
									githubUrl: pr.user.html_url,
									avatarUrl: pr.user.avatar_url,
									contributorType: pr.user.type === "Bot" ? "Bot" : "User",
								},
							});
							prData.contributorId = newContributor.id;
						}

						// Try to link to user profile if contributor has one
						const userProfile = await prisma.userProfile.findFirst({
							where: {
								githubUrl: {
									contains: pr.user.login,
								},
							},
							select: {
								id: true,
							},
						});

						if (userProfile) {
							prData.userProfileId = userProfile.id;
						}
					}

					if (existingPR) {
						// Update existing PR
						await prisma.githubIssue.update({
							where: { id: existingPR.id },
							data: prData,
						});
					} else {
						// Create new PR
						await prisma.githubIssue.create({
							data: prData,
						});
						newPRCount++;
					}
				} catch (prError) {
					console.error(`Error processing PR ${pr.id} for repo ${repo.name}:`, prError);
					// Continue with next PR
				}

				// Small delay to avoid overwhelming the database
				await delay(10);
			}

			// Update repository metadata
			await prisma.repo.update({
				where: { id: repo.id },
				data: {
					lastPrPageProcessed: page,
					lastPrFetchDate: new Date(),
				},
			});

			// Check if we should continue
			if (pullRequests.length < perPage) {
				hasMore = false;
			} else {
				page++;
				// Delay between pages
				await delay(GITHUB_API_DELAY_MS);
			}
		} catch (error) {
			console.error(`Error fetching page ${page} for repo ${repo.name}:`, error);
			throw error;
		}
	}

	return newPRCount;
}

// Refresh pull request data for a single repository in a hackathon
export async function refreshSingleRepository(c: HackathonContext) {
	try {
		const slug = c.req.param("slug");
		const repoId = c.req.param("repoId");
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (!slug) {
			return c.json({ detail: "Hackathon slug is required" }, 400);
		}

		if (!repoId) {
			return c.json({ detail: "Repository ID is required" }, 400);
		}

		// Fetch hackathon
		const hackathon = await prisma.hackathon.findUnique({
			where: { slug },
			include: {
				organization: {
					select: {
						id: true,
						name: true,
					},
				},
			},
		});

		if (!hackathon) {
			return c.json({ detail: "Hackathon not found" }, 404);
		}

		// Fetch repository
		const repo = await prisma.repo.findUnique({
			where: { id: parseInt(repoId) },
			select: {
				id: true,
				name: true,
				repoUrl: true,
			},
		});

		if (!repo) {
			return c.json({ detail: "Repository not found" }, 404);
		}

		// Check if user can manage this hackathon
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
			select: {
				isSuperuser: true,
				adminOrganizations: {
					where: { id: hackathon.organization.id },
					select: { id: true },
				},
				managerOrganizations: {
					where: { id: hackathon.organization.id },
					select: { id: true },
				},
			},
		});

		if (!user) {
			return c.json({ detail: "User not found" }, 404);
		}

		const canManage =
			user.isSuperuser ||
			user.adminOrganizations.length > 0 ||
			user.managerOrganizations.length > 0;

		if (!canManage) {
			return c.json({ detail: "You don't have permission to refresh repository data" }, 403);
		}

		// Get GitHub token from environment (if available)
		const githubToken = c.env?.GITHUB_TOKEN;

		try {
			const newPRs = await refreshRepositoryPullRequests(hackathon, repo, githubToken);

			return c.json({
				message: `Successfully refreshed data for ${repo.name}. Found ${newPRs} new pull requests.`,
				repository: repo.name,
				new_pr_count: newPRs,
			});
		} catch (error: any) {
			console.error(`Error refreshing repo ${repo.name}:`, error);
			return c.json(
				{
					detail: `Error refreshing repository data: ${error.message}`,
					repository: repo.name,
				},
				500
			);
		}
	} catch (error) {
		console.error("Error refreshing repository:", error);
		return c.json({ detail: "An error occurred while refreshing repository data" }, 500);
	}
}

// Refresh pull request data for all repositories in a hackathon
export async function refreshAllHackathonRepositories(c: HackathonContext) {
	try {
		const slug = c.req.param("slug");
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (!slug) {
			return c.json({ detail: "Hackathon slug is required" }, 400);
		}

		// Fetch hackathon with repositories
		const hackathon = await prisma.hackathon.findUnique({
			where: { slug },
			include: {
				organization: {
					select: {
						id: true,
						name: true,
					},
				},
				repositories: {
					select: {
						id: true,
						name: true,
						repoUrl: true,
					},
				},
			},
		});

		if (!hackathon) {
			return c.json({ detail: "Hackathon not found" }, 404);
		}

		// Check if user can manage this hackathon
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
			select: {
				isSuperuser: true,
				adminOrganizations: {
					where: { id: hackathon.organization.id },
					select: { id: true },
				},
				managerOrganizations: {
					where: { id: hackathon.organization.id },
					select: { id: true },
				},
			},
		});

		if (!user) {
			return c.json({ detail: "User not found" }, 404);
		}

		const canManage =
			user.isSuperuser ||
			user.adminOrganizations.length > 0 ||
			user.managerOrganizations.length > 0;

		if (!canManage) {
			return c.json({ detail: "You don't have permission to refresh repository data" }, 403);
		}

		if (hackathon.repositories.length === 0) {
			return c.json({
				detail: `No repositories are linked to ${hackathon.name}.`,
				refreshed_count: 0,
				total_new_prs: 0,
				failed_repos: [],
			});
		}

		// Get GitHub token from environment (if available)
		const githubToken = c.env?.GITHUB_TOKEN;

		let refreshedCount = 0;
		let totalNewPRs = 0;
		const failedRepos: string[] = [];

		// Process each repository
		for (let i = 0; i < hackathon.repositories.length; i++) {
			const repo = hackathon.repositories[i];

			try {
				const newPRs = await refreshRepositoryPullRequests(hackathon, repo, githubToken);
				totalNewPRs += newPRs;
				refreshedCount++;
			} catch (error: any) {
				failedRepos.push(repo.name);
				console.error(
					`Error refreshing repo ${repo.name} for hackathon ${hackathon.slug}:`,
					error
				);
			}

			// Add delay between repositories to avoid rate limits
			if (i < hackathon.repositories.length - 1 && REPO_REFRESH_DELAY_MS > 0) {
				await delay(REPO_REFRESH_DELAY_MS);
			}
		}

		// Prepare response message
		const messages: string[] = [];

		if (refreshedCount > 0) {
			messages.push(
				`Successfully refreshed ${refreshedCount} repositories. Found ${totalNewPRs} new pull requests.`
			);
		}

		if (failedRepos.length > 0) {
			messages.push(
				`Unable to refresh the following repositories: ${failedRepos.join(", ")}. Please try again later.`
			);
		}

		return c.json({
			message: messages.join(" "),
			refreshed_count: refreshedCount,
			total_new_prs: totalNewPRs,
			failed_repos: failedRepos,
			total_repos: hackathon.repositories.length,
		});
	} catch (error) {
		console.error("Error refreshing hackathon repositories:", error);
		return c.json({ detail: "An error occurred while refreshing repository data" }, 500);
	}
}


