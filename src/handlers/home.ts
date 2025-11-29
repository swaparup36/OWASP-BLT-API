import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type HomeContext = Context<AppEnv>;

interface TopBugReporter {
	id: number;
	username: string;
	bug_count: number;
	total_score: number;
	avatar: string | null;
}

interface TopPRContributor {
	name: string;
	avatar_url: string;
	github_url: string;
	total_prs: number;
}

interface TopEarner {
	id: number;
	username: string;
	total_earnings: number;
	avatar: string | null;
}

interface TopReferral {
	id: number;
	username: string;
	referral_code: string;
	signup_count: number;
	total_points: number;
	avatar: string | null;
}

interface RepoStar {
	key: string;
	stars: number;
}

interface HackathonWithStats {
	id: number;
	name: string;
	slug: string | null;
	description: string;
	startTime: Date;
	endTime: Date;
	bannerImage: string | null;
	isActive: boolean;
	organization: {
		id: number;
		name: string;
		logo: string | null;
	};
	stats: {
		participant_count: number;
		total_prs: number;
		merged_pr_count: number;
	};
}

// Home API handler - provides data for the homepage
export async function getHomeData(c: HomeContext) {
	try {
		const currentTime = new Date();
		const currentMonth = currentTime.getMonth() + 1; // JavaScript months are 0-indexed
		const currentYear = currentTime.getFullYear();

		// Get authenticated user's referral code if logged in
		const userId = c.get("userId");
		let referralCode: string | null = null;

		if (userId) {
			const inviteFriend = await prisma.inviteFriend.findFirst({
				where: { senderId: parseInt(userId) },
				select: { referralCode: true },
			});

			if (!inviteFriend) {
				// Create a new InviteFriend record if it doesn't exist
				const newInvite = await prisma.inviteFriend.create({
					data: {
						senderId: parseInt(userId),
						referralCode: generateReferralCode(),
					},
					select: { referralCode: true },
				});
				referralCode = newInvite.referralCode;
			} else {
				referralCode = inviteFriend.referralCode;
			}
		}

		// Get latest repositories (5 most recent)
		const latestRepos = await prisma.repo.findMany({
			orderBy: { created: "desc" },
			take: 5,
			select: {
				id: true,
				name: true,
				slug: true,
				description: true,
				repoUrl: true,
				stars: true,
				forks: true,
				primaryLanguage: true,
				created: true,
				organization: {
					select: {
						id: true,
						name: true,
						logo: true,
					},
				},
			},
		});

		const totalRepos = await prisma.repo.count();

		// Get recent forum posts (5 most recent)
		const recentPosts = await prisma.forumPost.findMany({
			orderBy: { created: "desc" },
			take: 5,
			select: {
				id: true,
				title: true,
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
				category: {
					select: {
						id: true,
						name: true,
					},
				},
				_count: {
					select: {
						forumComments: true,
						votes: true,
					},
				},
			},
		});

		// Get top bug reporters for current month
		const topBugReportersData = await prisma.user.findMany({
			where: {
				points: {
					some: {
						created: {
							gte: new Date(currentYear, currentMonth - 1, 1),
							lte: new Date(currentYear, currentMonth, 0, 23, 59, 59, 999),
						},
						score: {
							gt: 0,
						},
					},
				},
			},
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

		// Calculate scores for each bug reporter
		const topBugReporters: TopBugReporter[] = await Promise.all(
			topBugReportersData.map(async (user) => {
				const pointsAgg = await prisma.points.aggregate({
					where: {
						userId: user.id,
						created: {
							gte: new Date(currentYear, currentMonth - 1, 1),
							lte: new Date(currentYear, currentMonth, 0, 23, 59, 59, 999),
						},
						score: {
							gt: 0,
						},
					},
					_sum: {
						score: true,
					},
					_count: {
						id: true,
					},
				});

				return {
					id: user.id,
					username: user.username,
					bug_count: pointsAgg._count.id,
					total_score: pointsAgg._sum.score || 0,
					avatar: user.userProfile?.userAvatar || null,
				};
			})
		);

		// Sort by total score and take top 5
		topBugReporters.sort((a, b) => b.total_score - a.total_score);
		const top5BugReporters = topBugReporters.slice(0, 5);

		// Get top PR contributors for current month (BLT repo only, excluding copilot)
		const topPRContributorsRaw = await prisma.githubIssue.groupBy({
			by: ["contributorId"],
			where: {
				type: "PULL_REQUEST",
				isMerged: true,
				repo: {
					name: {
						contains: "BLT",
					},
				},
				contributorId: {
					not: null,
				},
				mergedAt: {
					gte: new Date(currentYear, currentMonth - 1, 1),
					lte: new Date(currentYear, currentMonth, 0, 23, 59, 59, 999),
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

		// Get contributor details
		const topPRContributorsTemp = await Promise.all(
			topPRContributorsRaw
				.filter((item) => item.contributorId !== null)
				.map(async (item) => {
					const contributor = await prisma.contributor.findUnique({
						where: { id: item.contributorId! },
						select: {
							name: true,
							avatarUrl: true,
							githubUrl: true,
						},
					});

					if (!contributor) {
						return null;
					}

					// Exclude copilot contributors
					if (contributor.name.toLowerCase().includes("copilot")) {
						return null;
					}

					return {
						name: contributor.name,
						avatar_url: contributor.avatarUrl || "",
						github_url: contributor.githubUrl || "",
						total_prs: item._count.id,
					};
				})
		);

		// Filter out null values
		const filteredPRContributors: TopPRContributor[] = topPRContributorsTemp.filter((c): c is TopPRContributor => c !== null);

		// Get top earners - from GitHub issue payments or winnings field
		const userProfilesWithEarnings = await prisma.userProfile.findMany({
			select: {
				id: true,
				userId: true,
				userAvatar: true,
				winnings: true,
				user: {
					select: {
						id: true,
						username: true,
					},
				},
				githubIssues: {
					where: {
						p2pAmountUsd: {
							not: null,
						},
					},
					select: {
						p2pAmountUsd: true,
					},
				},
			},
		});

		// Calculate total earnings for each user
		const topEarnersData: TopEarner[] = userProfilesWithEarnings
			.map((profile) => {
				// Sum GitHub issue payments
				const githubEarnings = profile.githubIssues.reduce((sum, issue) => {
					return sum + (Number(issue.p2pAmountUsd) || 0);
				}, 0);

				// Use GitHub earnings if available, otherwise use winnings field
				const totalEarnings = profile.githubIssues.length > 0 ? githubEarnings : Number(profile.winnings) || 0;

				return {
					id: profile.user.id,
					username: profile.user.username,
					total_earnings: totalEarnings,
					avatar: profile.userAvatar || null,
				};
			})
			.filter((earner) => earner.total_earnings > 0)
			.sort((a, b) => b.total_earnings - a.total_earnings)
			.slice(0, 5);

		// Get top referrals
		const topReferralsData = await prisma.inviteFriend.findMany({
			where: {
				pointByReferral: {
					gt: 0,
				},
			},
			orderBy: {
				pointByReferral: "desc",
			},
			take: 5,
			include: {
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
				recipients: true,
			},
		});

		const topReferrals: TopReferral[] = topReferralsData.map((referral) => ({
			id: referral.user.id,
			username: referral.user.username,
			referral_code: referral.referralCode,
			signup_count: referral.recipients.length,
			total_points: referral.pointByReferral,
			avatar: referral.user.userProfile?.userAvatar || null,
		}));

		// Get latest blog posts
		const latestBlogPosts = await prisma.post.findMany({
			orderBy: { createdAt: "desc" },
			take: 2,
			select: {
				id: true,
				title: true,
				slug: true,
				content: true,
				createdAt: true,
				author: {
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

		// Get latest bug reports (excluding hidden issues unless user is the creator)
		const latestBugsWhere: any = {
			huntId: null,
		};

		// If user is authenticated, show their hidden issues
		if (userId) {
			latestBugsWhere.OR = [
				{ isHidden: false },
				{
					isHidden: true,
					userId: parseInt(userId),
				},
			];
		} else {
			latestBugsWhere.isHidden = false;
		}

		const latestBugs = await prisma.issue.findMany({
			where: latestBugsWhere,
			orderBy: { created: "desc" },
			take: 2,
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
				domain: {
					select: {
						id: true,
						name: true,
						url: true,
					},
				},
			},
		});

		// Get 2 most recent active hackathons
		const recentHackathonsRaw = await prisma.hackathon.findMany({
			where: {
				isActive: true,
			},
			orderBy: {
				startTime: "desc",
			},
			take: 2,
			select: {
				id: true,
				name: true,
				slug: true,
				description: true,
				startTime: true,
				endTime: true,
				bannerImage: true,
				isActive: true,
				organization: {
					select: {
						id: true,
						name: true,
						logo: true,
					},
				},
				repositories: {
					select: {
						id: true,
					},
				},
			},
		});

		// Calculate statistics for each hackathon
		const recentHackathons: HackathonWithStats[] = await Promise.all(
			recentHackathonsRaw.map(async (hackathon) => {
				const repoIds = hackathon.repositories.map((repo) => repo.id);

				// Count merged pull requests during hackathon
				const mergedPRs = await prisma.githubIssue.findMany({
					where: {
						repoId: {
							in: repoIds,
						},
						type: "PULL_REQUEST",
						isMerged: true,
						mergedAt: {
							gte: hackathon.startTime,
							lte: hackathon.endTime,
						},
					},
					select: {
						userProfileId: true,
						contributorId: true,
						contributor: {
							select: {
								name: true,
							},
						},
					},
				});

				const mergedPRCount = mergedPRs.length;

				// Count total pull requests during hackathon
				const totalPRs = await prisma.githubIssue.count({
					where: {
						repoId: {
							in: repoIds,
						},
						type: "PULL_REQUEST",
						createdAt: {
							gte: hackathon.startTime,
							lte: hackathon.endTime,
						},
					},
				});

				// Count unique participants (excluding bots)
				const uniqueUserProfiles = new Set(
					mergedPRs.filter((pr) => pr.userProfileId !== null).map((pr) => pr.userProfileId)
				);

				const uniqueContributors = new Set(
					mergedPRs
						.filter(
							(pr) =>
								pr.userProfileId === null &&
								pr.contributorId !== null &&
								!pr.contributor?.name.endsWith("[bot]")
						)
						.map((pr) => pr.contributorId)
				);

				const participantCount = uniqueUserProfiles.size + uniqueContributors.size;

				return {
					id: hackathon.id,
					name: hackathon.name,
					slug: hackathon.slug,
					description: hackathon.description,
					startTime: hackathon.startTime,
					endTime: hackathon.endTime,
					bannerImage: hackathon.bannerImage,
					isActive: hackathon.isActive,
					organization: hackathon.organization,
					stats: {
						participant_count: participantCount,
						total_prs: totalPRs,
						merged_pr_count: mergedPRCount,
					},
				};
			})
		);

		// Get repository star counts for specific repositories
		const repoMappings: { [key: string]: string } = {
			blt: "BLT",
			flutter: "BLT-Flutter",
			extension: "BLT-Extension",
			action: "BLT-Action",
		};

		const repoStars: RepoStar[] = [];

		for (const [key, repoName] of Object.entries(repoMappings)) {
			const repo = await prisma.repo.findFirst({
				where: {
					name: {
						contains: repoName,
						mode: "insensitive",
					},
				},
				select: {
					stars: true,
				},
			});

			if (repo) {
				repoStars.push({
					key,
					stars: repo.stars,
				});
			}
		}

		// Build response
		return c.json({
			current_year: currentYear,
			current_time: currentTime,
			latest_repos: latestRepos,
			total_repos: totalRepos,
			recent_posts: recentPosts,
			top_bug_reporters: top5BugReporters,
			top_pr_contributors: filteredPRContributors,
			latest_blog_posts: latestBlogPosts,
			top_earners: topEarnersData,
			repo_stars: repoStars,
			top_referrals: topReferrals,
			referral_code: referralCode,
			latest_bugs: latestBugs,
			recent_hackathons: recentHackathons,
		});
	} catch (error) {
		console.error("Error fetching home data:", error);
		return c.json({ error: "Failed to fetch home data" }, 500);
	}
}

// Helper function to generate a random referral code
function generateReferralCode(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let code = "";
	for (let i = 0; i < 8; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}
