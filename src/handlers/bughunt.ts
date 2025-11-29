import type { Context } from "hono";
import prisma from "../utils/db";
import { validateImage, generateUniqueFilename, uploadToR2 } from "../utils/file-upload";
import { IssueLabel } from "../generated/prisma/enums";

type AppContext = Context<{
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
		organizationId?: number;
		isOrganizationAdmin?: boolean;
		isOrganizationManager?: boolean;
	};
}>;

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
};

// Get active bug hunts
export async function getActiveHunts(c: AppContext) {
	try {
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

		return c.json(hunts);
	} catch (error) {
		console.error("Error fetching active hunts:", error);
		return c.json({ error: "Failed to fetch active hunts" }, 500);
	}
}

// Get previous bug hunts
export async function getPreviousHunts(c: AppContext) {
	try {
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

		return c.json(hunts);
	} catch (error) {
		console.error("Error fetching previous hunts:", error);
		return c.json({ error: "Failed to fetch previous hunts" }, 500);
	}
}

// Get upcoming bug hunts
export async function getUpcomingHunts(c: AppContext) {
	try {
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

		return c.json(hunts);
	} catch (error) {
		console.error("Error fetching upcoming hunts:", error);
		return c.json({ error: "Failed to fetch upcoming hunts" }, 500);
	}
}

// Search bug hunts by name
export async function searchHuntsByName(c: AppContext) {
	try {
		const searchQuery = c.req.query("search");

		if (!searchQuery) {
			return c.json({ error: "Search query is required" }, 400);
		}

		const hunts = await prisma.hunt.findMany({
			where: {
				isPublished: true,
				name: {
					contains: searchQuery,
					mode: "insensitive",
				},
			},
			select: HUNT_FIELDS,
			orderBy: {
				endOn: "asc",
			},
		});

		return c.json(hunts);
	} catch (error) {
		console.error("Error searching hunts:", error);
		return c.json({ error: "Failed to search hunts" }, 500);
	}
}

// Main handler for bug hunt API
export async function listHunts(c: AppContext) {
	try {
		const activeHunt = c.req.query("activeHunt");
		const previousHunt = c.req.query("previousHunt");
		const upcomingHunt = c.req.query("upcomingHunt");
		const searchQuery = c.req.query("search");

		if (searchQuery) {
			return searchHuntsByName(c);
		} else if (activeHunt) {
			return getActiveHunts(c);
		} else if (previousHunt) {
			return getPreviousHunts(c);
		} else if (upcomingHunt) {
			return getUpcomingHunts(c);
		}

		const hunts = await prisma.hunt.findMany({
			where: {
				isPublished: true,
			},
			select: HUNT_FIELDS,
			orderBy: {
				endOn: "desc",
			},
		});

		return c.json(hunts);
	} catch (error) {
		console.error("Error fetching hunts:", error);
		return c.json({ error: "Failed to fetch hunts" }, 500);
	}
}

// Create a new bug hunt
export async function createHunt(c: AppContext) {
	try {
		const organizationId = c.get("organizationId");
		
		if (!organizationId) {
			return c.json({ error: "Organization ID is required" }, 400);
		}

		const formData = await c.req.formData();

		// Extract form fields
		const domainId = formData.get("domain_id") || formData.get("domain");
		const bughuntName = formData.get("bughunt_name") || formData.get("name");
		const domainUrl = formData.get("domain_url") || formData.get("url");
		const markdownDescription = formData.get("markdown-description") || formData.get("description");
		const startDate = formData.get("start_date");
		const endDate = formData.get("end_date");
		const publishBughunt = formData.get("publish_bughunt");
		const prizesJson = formData.get("prizes");

		// Validate required fields
		if (!domainId) {
			return c.json({ error: "Domain ID is required" }, 400);
		}

		if (!bughuntName) {
			return c.json({ error: "Bug hunt name is required" }, 400);
		}

		// Validate domain exists
		const domain = await prisma.domain.findUnique({
			where: { id: parseInt(domainId as string) },
		});

		if (!domain) {
			return c.json({ error: "Domain does not exist" }, 400);
		}

		// Parse and validate dates (expect MM/DD/YYYY format)
		const now = new Date();
		let parsedStartDate: Date;
		let parsedEndDate: Date;

		try {
			const startDateStr = startDate as string || now.toLocaleDateString("en-US");
			const endDateStr = endDate as string || now.toLocaleDateString("en-US");

			// Parse MM/DD/YYYY format
			const [startMonth, startDay, startYear] = startDateStr.split("/");
			const [endMonth, endDay, endYear] = endDateStr.split("/");

			parsedStartDate = new Date(`${startYear}-${startMonth}-${startDay}T00:00:00`);
			parsedEndDate = new Date(`${endYear}-${endMonth}-${endDay}T23:59:59`);

			if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
				throw new Error("Invalid date format");
			}
		} catch (error) {
			return c.json({ error: "Please enter dates in MM/DD/YYYY format (e.g., 12/25/2024)" }, 400);
		}

		// Validate start date is before end date
		if (parsedStartDate > parsedEndDate) {
			return c.json({ error: "Start date should be less than end date" }, 400);
		}

		// Handle file uploads (logo and banner)
		let logoPath: string | null = null;
		let bannerPath: string | null = null;

		const logoFile = formData.get("logo") as File | null;
		if (logoFile && logoFile.size > 0) {
			const validation = validateImage(logoFile);
			if (!validation.valid) {
				return c.json({ error: validation.error }, 400);
			}

			const uniqueFilename = generateUniqueFilename(logoFile.name);
			logoPath = `logos/${uniqueFilename}`;

			// Upload to R2 if available
			if (c.env.BLT_BUCKET) {
				await uploadToR2(c.env.BLT_BUCKET, logoPath, logoFile);
			}
		}

		const bannerFile = formData.get("banner") as File | null;
		if (bannerFile && bannerFile.size > 0) {
			const validation = validateImage(bannerFile);
			if (!validation.valid) {
				return c.json({ error: validation.error }, 400);
			}

			const uniqueFilename = generateUniqueFilename(bannerFile.name);
			bannerPath = `banners/${uniqueFilename}`;

			// Upload to R2 if available
			if (c.env.BLT_BUCKET) {
				await uploadToR2(c.env.BLT_BUCKET, bannerPath, bannerFile);
			}
		}

		// Create the hunt
		const isPublished = publishBughunt === "true" || publishBughunt === "1";

		const hunt = await prisma.hunt.create({
			data: {
				name: bughuntName as string,
				domainId: parseInt(domainId as string),
				url: domainUrl as string || "",
				description: markdownDescription as string || "",
				startsOn: parsedStartDate,
				endOn: parsedEndDate,
				isPublished,
				logo: logoPath,
				banner: bannerPath,
			},
		});

		// Parse and create prizes
		if (prizesJson) {
			try {
				const prizes = JSON.parse(prizesJson as string);

				for (const prize of prizes) {
					if (prize.prize_name && prize.prize_name.trim() !== "") {
						await prisma.huntPrize.create({
							data: {
								huntId: hunt.id,
								name: prize.prize_name,
								value: parseInt(prize.cash_value || 0),
								no_of_eligible_projects: parseInt(prize.number_of_winning_projects || 1),
								valid_submissions_eligible: prize.every_valid_submissions === true || prize.every_valid_submissions === "true",
								prize_in_crypto: prize.paid_in_cryptocurrency === true || prize.paid_in_cryptocurrency === "true",
								description: prize.prize_description || "",
							},
						});
					}
				}
			} catch (error) {
				console.error("Error parsing prizes:", error);
			}
		}

		return c.json(
			{
				message: "Bug hunt created successfully",
				hunt: {
					id: hunt.id,
					name: hunt.name,
					url: hunt.url,
					description: hunt.description,
					startsOn: hunt.startsOn,
					endOn: hunt.endOn,
					isPublished: hunt.isPublished,
					logo: hunt.logo,
					banner: hunt.banner,
				},
			},
			201
		);
	} catch (error) {
		console.error("Error creating hunt:", error);
		return c.json({ error: "Failed to create bug hunt" }, 500);
	}
}

// Get detailed bug hunt information
export async function getHuntDetails(c: AppContext) {
	try {
		const huntId = c.req.param("huntId");
		const userId = c.get("userId"); // Optional - user may not be authenticated

		if (!huntId) {
			return c.json({ error: "Hunt ID is required" }, 400);
		}

		// Get the hunt details
		const hunt = await prisma.hunt.findUnique({
			where: { id: parseInt(huntId) },
			include: {
				domain: {
					include: {
						organization: true,
						managers: {
							select: {
								id: true,
								username: true,
							},
						},
					},
				},
				prizes: {
					orderBy: {
						value: "desc",
					},
				},
			},
		});

		if (!hunt) {
			return c.json({ error: "Hunt not found" }, 404);
		}

		// Check if the user is a hunt manager (domain manager or organization admin)
		let isHuntManager = false;
		if (userId && hunt.domain?.organization) {
			const userIdNum = parseInt(userId);
			isHuntManager =
				hunt.domain.managers.some((manager) => manager.id === userIdNum) ||
				hunt.domain.organization.adminId === userIdNum;
		}

		// Get issues for this hunt
		const issueFilter: any = {
			domainId: hunt.domainId,
			created: {
				gte: hunt.startsOn,
				...(hunt.endOn ? { lte: hunt.endOn } : {}),
			},
		};

		// If not a hunt manager, only show public issues
		if (!isHuntManager) {
			issueFilter.isHidden = false;
		}

		// Total bugs statistics
		const totalBugs = await prisma.issue.count({
			where: issueFilter,
		});

		const totalBugAccepted = await prisma.issue.count({
			where: {
				...issueFilter,
				verified: true,
			},
		});

		// Calculate total money distributed
		const moneyAggregation = await prisma.issue.aggregate({
			where: issueFilter,
			_sum: {
				rewarded: true,
			},
		});

		const totalMoneyDistributed = moneyAggregation._sum.rewarded || 0;

		// Get bughunt leaderboard (top 16 verified bug reporters)
		const bughuntLeaderboard = await prisma.issue.groupBy({
			by: ["userId"],
			where: {
				...issueFilter,
				userId: {
					not: null,
				},
				verified: true,
			},
			_count: {
				id: true,
			},
			orderBy: {
				_count: {
					id: "desc",
				},
			},
			take: 16,
		});

		// Enrich leaderboard with user details
		const leaderboardWithUsers = await Promise.all(
			bughuntLeaderboard.map(async (entry) => {
				const user = await prisma.user.findUnique({
					where: { id: entry.userId! },
					select: {
						id: true,
						username: true,
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				});

				return {
					user__id: user?.id,
					user__username: user?.username,
					user__userprofile__user_avatar: user?.userProfile?.userAvatar,
					count: entry._count.id,
				};
			})
		);

		// Get latest issues
		const latestIssues = await prisma.issue.findMany({
			where: issueFilter,
			select: {
				id: true,
				url: true,
				description: true,
				label: true,
				status: true,
				verified: true,
				rewarded: true,
				created: true,
				domain: {
					select: {
						name: true,
					},
				},
				user: {
					select: {
						id: true,
						username: true,
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				},
				screenshots: {
					take: 1,
					select: {
						image: true,
					},
					orderBy: {
						created: "asc",
					},
				},
			},
			orderBy: {
				created: "desc",
			},
		});

		// Transform issues with label names
		const issueLabels = ["General", "Number Error", "Functional", "Performance", "Security", "Typo", "Design", "Server Down", "Trademark Squatting"];
		const cleanedIssues = latestIssues.map((issue) => ({
			id: issue.id,
			domain__name: issue.domain?.name,
			url: issue.url,
			description: issue.description,
			user__id: issue.user?.id,
			user__username: issue.user?.username,
			user__userprofile__user_avatar: issue.user?.userProfile?.userAvatar,
			label: issueLabels[Object.values(IssueLabel).indexOf(issue.label)],
			status: issue.status,
			verified: issue.verified,
			rewarded: issue.rewarded,
			created: issue.created,
			first_screenshot: issue.screenshots[0]?.image,
		}));

		// Get first and last bug
		const firstBug = await prisma.issue.findFirst({
			where: issueFilter,
			select: {
				id: true,
				url: true,
				description: true,
				created: true,
				user: {
					select: {
						id: true,
						username: true,
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				},
			},
			orderBy: {
				created: "asc",
			},
		});

		const lastBug = await prisma.issue.findFirst({
			where: issueFilter,
			select: {
				id: true,
				url: true,
				description: true,
				created: true,
				user: {
					select: {
						id: true,
						username: true,
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				},
			},
			orderBy: {
				created: "desc",
			},
		});

		// Get top testers (top 5 bug reporters)
		const topTestersData = await prisma.issue.groupBy({
			by: ["userId"],
			where: {
				...issueFilter,
				userId: {
					not: null,
				},
			},
			_count: {
				id: true,
			},
			orderBy: {
				_count: {
					id: "desc",
				},
			},
			take: 5,
		});

		const topTesters = await Promise.all(
			topTestersData.map(async (entry) => {
				const user = await prisma.user.findUnique({
					where: { id: entry.userId! },
					select: {
						id: true,
						username: true,
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				});

				return {
					user__id: user?.id,
					user__username: user?.username,
					user__userprofile__user_avatar: user?.userProfile?.userAvatar,
					count: entry._count.id,
				};
			})
		);

		// Get winners for this hunt
		const winners = await prisma.winner.findMany({
			where: {
				huntId: hunt.id,
			},
			include: {
				winner: {
					select: {
						id: true,
						username: true,
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				},
				runner: {
					select: {
						id: true,
						username: true,
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				},
				secondRunner: {
					select: {
						id: true,
						username: true,
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				},
			},
		});

		// Return comprehensive bug hunt data
		return c.json({
			hunt_obj: {
				id: hunt.id,
				name: hunt.name,
				description: hunt.description,
				url: hunt.url,
				logo: hunt.logo,
				banner: hunt.banner,
				prize: hunt.prize,
				startsOn: hunt.startsOn,
				endOn: hunt.endOn,
				isPublished: hunt.isPublished,
				resultPublished: hunt.resultPublished,
				created: hunt.created,
				domain: {
					id: hunt.domain?.id,
					name: hunt.domain?.name,
					organization: hunt.domain?.organization
						? {
								id: hunt.domain.organization.id,
								name: hunt.domain.organization.name,
								slug: hunt.domain.organization.slug,
						  }
						: null,
				},
			},
			stats: {
				total_rewarded: totalMoneyDistributed,
				total_bugs: totalBugs,
				total_bug_accepted: totalBugAccepted,
			},
			bughunt_leaderboard: leaderboardWithUsers,
			top_testers: topTesters,
			latest_issues: cleanedIssues,
			rewards: hunt.prizes,
			first_bug: firstBug,
			last_bug: lastBug,
			winners: winners,
			is_hunt_manager: isHuntManager,
		});
	} catch (error) {
		console.error("Error fetching hunt details:", error);
		return c.json({ error: "Failed to fetch hunt details" }, 500);
	}
}

// Update an existing bug hunt
export async function updateHunt(c: AppContext) {
	try {
		const organizationId = c.get("organizationId");
		const huntId = c.req.param("huntId");

		if (!organizationId) {
			return c.json({ error: "Organization ID is required" }, 400);
		}

		if (!huntId) {
			return c.json({ error: "Hunt ID is required" }, 400);
		}

		// Check if hunt exists
		const existingHunt = await prisma.hunt.findUnique({
			where: { id: parseInt(huntId) },
			include: {
				domain: true,
			},
		});

		if (!existingHunt) {
			return c.json({ error: "Hunt not found" }, 404);
		}

		const formData = await c.req.formData();

		// Extract form fields
		const domainId = formData.get("domain_id") || formData.get("domain");
		const bughuntName = formData.get("bughunt_name") || formData.get("name");
		const domainUrl = formData.get("domain_url") || formData.get("url");
		const markdownDescription = formData.get("markdown-description") || formData.get("description");
		const startDate = formData.get("start_date");
		const endDate = formData.get("end_date");
		const publishBughunt = formData.get("publish_bughunt");
		const prizesJson = formData.get("prizes");

		// Validate domain if provided
		let validatedDomainId = existingHunt.domainId;
		if (domainId) {
			const domain = await prisma.domain.findUnique({
				where: { id: parseInt(domainId as string) },
			});

			if (!domain) {
				return c.json({ error: "Domain does not exist" }, 400);
			}

			validatedDomainId = domain.id;
		}

		// Parse and validate dates if provided
		let parsedStartDate = existingHunt.startsOn;
		let parsedEndDate = existingHunt.endOn;

		if (startDate || endDate) {
			try {
				if (startDate) {
					const [startMonth, startDay, startYear] = (startDate as string).split("/");
					parsedStartDate = new Date(`${startYear}-${startMonth}-${startDay}T00:00:00`);

					if (isNaN(parsedStartDate.getTime())) {
						throw new Error("Invalid start date format");
					}
				}

				if (endDate) {
					const [endMonth, endDay, endYear] = (endDate as string).split("/");
					parsedEndDate = new Date(`${endYear}-${endMonth}-${endDay}T23:59:59`);

					if (isNaN(parsedEndDate.getTime())) {
						throw new Error("Invalid end date format");
					}
				}

				// Validate start date is before end date
				if (parsedStartDate && parsedEndDate && parsedStartDate > parsedEndDate) {
					return c.json({ error: "Start date should be less than end date" }, 400);
				}
			} catch (error) {
				return c.json({ error: "Please enter dates in MM/DD/YYYY format (e.g., 12/25/2024)" }, 400);
			}
		}

		// Handle file uploads (logo and banner)
		let logoPath = existingHunt.logo;
		let bannerPath = existingHunt.banner;

		const logoFile = formData.get("logo") as File | null;
		if (logoFile && logoFile.size > 0) {
			const validation = validateImage(logoFile);
			if (!validation.valid) {
				return c.json({ error: validation.error }, 400);
			}

			const uniqueFilename = generateUniqueFilename(logoFile.name);
			logoPath = `logos/${uniqueFilename}`;

			// Upload to R2 if available
			if (c.env.BLT_BUCKET) {
				await uploadToR2(c.env.BLT_BUCKET, logoPath, logoFile);
			}
		}

		const bannerFile = formData.get("banner") as File | null;
		if (bannerFile && bannerFile.size > 0) {
			const validation = validateImage(bannerFile);
			if (!validation.valid) {
				return c.json({ error: validation.error }, 400);
			}

			const uniqueFilename = generateUniqueFilename(bannerFile.name);
			bannerPath = `banners/${uniqueFilename}`;

			// Upload to R2 if available
			if (c.env.BLT_BUCKET) {
				await uploadToR2(c.env.BLT_BUCKET, bannerPath, bannerFile);
			}
		}

		// Prepare update data
		const updateData: any = {
			domainId: validatedDomainId,
			url: domainUrl as string || existingHunt.url,
			description: markdownDescription as string || existingHunt.description,
			endOn: parsedEndDate,
		};

		// Only allow updating name and startsOn if not published
		if (!existingHunt.isPublished) {
			if (bughuntName) {
				updateData.name = bughuntName as string;
			}
			updateData.startsOn = parsedStartDate;
		}

		// Update publish status
		if (publishBughunt !== null && publishBughunt !== undefined) {
			updateData.isPublished = publishBughunt === "true" || publishBughunt === "false" ? publishBughunt !== "false" : existingHunt.isPublished;
		}

		// Update logo and banner if new files were uploaded
		if (logoPath !== existingHunt.logo) {
			updateData.logo = logoPath;
		}
		if (bannerPath !== existingHunt.banner) {
			updateData.banner = bannerPath;
		}

		// Update the hunt
		const updatedHunt = await prisma.hunt.update({
			where: { id: parseInt(huntId) },
			data: updateData,
		});

		// Handle prizes update
		if (prizesJson) {
			try {
				const prizes = JSON.parse(prizesJson as string);

				// Delete existing prizes and create new ones
				// (In production, you might want to update existing prizes instead)
				await prisma.huntPrize.deleteMany({
					where: { huntId: updatedHunt.id },
				});

				for (const prize of prizes) {
					if (prize.prize_name && prize.prize_name.trim() !== "") {
						await prisma.huntPrize.create({
							data: {
								huntId: updatedHunt.id,
								name: prize.prize_name,
								value: parseInt(prize.cash_value || 0),
								no_of_eligible_projects: parseInt(prize.number_of_winning_projects || 1),
								valid_submissions_eligible: prize.every_valid_submissions === true || prize.every_valid_submissions === "true",
								prize_in_crypto: prize.paid_in_cryptocurrency === true || prize.paid_in_cryptocurrency === "true",
								description: prize.prize_description || "",
							},
						});
					}
				}
			} catch (error) {
				console.error("Error updating prizes:", error);
			}
		}

		return c.json({
			message: "Bug hunt updated successfully",
			hunt: {
				id: updatedHunt.id,
				name: updatedHunt.name,
				url: updatedHunt.url,
				description: updatedHunt.description,
				startsOn: updatedHunt.startsOn,
				endOn: updatedHunt.endOn,
				isPublished: updatedHunt.isPublished,
				logo: updatedHunt.logo,
				banner: updatedHunt.banner,
			},
		});
	} catch (error) {
		console.error("Error updating hunt:", error);
		return c.json({ error: "Failed to update bug hunt" }, 500);
	}
}

// Edit a prize
export async function editPrize(c: AppContext) {
	try {
		const organizationId = c.get("organizationId");
		const prizeId = c.req.param("prizeId");

		if (!organizationId) {
			return c.json({ success: false, error: "User not allowed" }, 403);
		}

		if (!prizeId) {
			return c.json({ success: false, error: "Prize ID is required" }, 400);
		}

		// Check if prize exists
		const prize = await prisma.huntPrize.findUnique({
			where: { id: parseInt(prizeId) },
		});

		if (!prize) {
			return c.json({ success: false, error: "Prize not found" }, 404);
		}

		// Parse request body
		const data = await c.req.json();

		// Update prize with provided data or keep existing values
		const updatedPrize = await prisma.huntPrize.update({
			where: { id: parseInt(prizeId) },
			data: {
				name: data.prize_name ?? prize.name,
				value: data.cash_value !== undefined ? parseInt(data.cash_value) : prize.value,
				no_of_eligible_projects: data.number_of_winning_projects !== undefined ? parseInt(data.number_of_winning_projects) : prize.no_of_eligible_projects,
				valid_submissions_eligible: data.every_valid_submissions ?? prize.valid_submissions_eligible,
				description: data.prize_description ?? prize.description,
			},
		});

		return c.json({ success: true });
	} catch (error) {
		console.error("Error editing prize:", error);
		return c.json({ success: false, error: "Failed to edit prize" }, 500);
	}
}

// Delete a prize
export async function deletePrize(c: AppContext) {
	try {
		const organizationId = c.get("organizationId");
		const prizeId = c.req.param("prizeId");

		if (!organizationId) {
			return c.json({ success: false, error: "User not allowed" }, 403);
		}

		if (!prizeId) {
			return c.json({ success: false, error: "Prize ID is required" }, 400);
		}

		// Check if prize exists
		const prize = await prisma.huntPrize.findUnique({
			where: { id: parseInt(prizeId) },
		});

		if (!prize) {
			return c.json({ success: false, error: "Prize not found" }, 404);
		}

		// Delete the prize
		await prisma.huntPrize.delete({
			where: { id: parseInt(prizeId) },
		});

		return c.json({ success: true });
	} catch (error) {
		console.error("Error deleting prize:", error);
		return c.json({ success: false, error: "Failed to delete prize" }, 500);
	}
}

