import { Context } from "hono";
import prisma from "../utils/db";

type SearchContext = Context<{
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
}>;

/**
 * Universal search endpoint
 * Supports searching across multiple models: organizations, issues, domains, users, projects, repos, tags, languages
 * 
 * Query Parameters:
 * - query: Search string (required)
 * - type: Type of search - can be 'issues', 'domains', 'users', 'labels', 'organizations', 'projects', 'repos', 'tags', 'languages'
 *         If not specified, searches across all types
 */
export async function search(c: SearchContext) {
	try {
		const query = c.req.query("query")?.trim() || "";
		const stype = c.req.query("type")?.trim() || "";
		const userId = c.get("userId");

		if (!query) {
			return c.json({
				error: "Query parameter is required",
				query: "",
				type: stype,
			}, 400);
		}

		let result: any = {
			query,
			type: stype,
		};

		// If authenticated, include wallet information
		if (userId) {
			const wallet = await prisma.wallet.findUnique({
				where: { userId: parseInt(userId) },
			});
			if (wallet) {
				result.wallet = {
					id: wallet.id,
					current_balance: wallet.currentBalance,
					account_id: wallet.accountId,
				};
			}
		}

		// Search based on type
		switch (stype) {
			case "issues":
				result.issues = await searchIssues(query, userId);
				break;

			case "domains":
				result.domains = await searchDomains(query);
				break;

			case "users":
				result.users = await searchUsers(query);
				break;

			case "labels":
				result.issues = await searchIssuesByLabel(query, userId);
				break;

			case "organizations":
				result.organizations = await searchOrganizations(query);
				break;

			case "projects":
				result.projects = await searchProjects(query);
				break;

			case "repos":
				result.repos = await searchRepos(query);
				break;

			case "tags":
				result = { ...result, ...(await searchByTags(query)) };
				break;

			case "languages":
				result.repos = await searchReposByLanguage(query);
				break;

			default:
				// Search across all models
				const [organizations, issues, domains, users, projects, repos] = await Promise.all([
					searchOrganizations(query),
					searchIssues(query, userId),
					searchDomains(query),
					searchUsers(query),
					searchProjects(query),
					searchRepos(query),
				]);

				result = {
					...result,
					organizations,
					issues,
					domains,
					users,
					projects,
					repos,
				};
				break;
		}

		return c.json(result, 200);
	} catch (error) {
		console.error("Error in search:", error);
		return c.json(
			{
				error: "Internal server error",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			500
		);
	}
}

// Search organizations by name
async function searchOrganizations(query: string) {
	const organizations = await prisma.organization.findMany({
		where: {
			name: {
				contains: query,
				mode: "insensitive",
			},
		},
		include: {
			domains: {
				take: 1,
				select: {
					id: true,
					name: true,
					url: true,
				},
			},
			admin: {
				select: {
					id: true,
					username: true,
				},
			},
		},
		orderBy: {
			created: "desc",
		},
	});

	return organizations.map((org) => ({
		id: org.id,
		name: org.name,
		slug: org.slug,
		description: org.description,
		logo: org.logo,
		url: org.url,
		email: org.email,
		twitter: org.twitter,
		facebook: org.facebook,
		is_active: org.isActive,
		team_points: org.teamPoints,
		tagline: org.tagline,
		admin: org.admin,
		absolute_url: org.domains[0] ? `/domain/${org.domains[0].name}` : null,
		domain: org.domains[0] || null,
		created: org.created,
	}));
}

// Search issues by description
async function searchIssues(query: string, userId?: string) {
	const issues = await prisma.issue.findMany({
		where: {
			AND: [
				{
					description: {
						contains: query,
						mode: "insensitive",
					},
				},
				{
					domain: {
						hunts: {
							none: {},
						},
					},
				},
				// Hide hidden issues unless they belong to the current user
				userId
					? {
							OR: [
								{ isHidden: false },
								{ userId: parseInt(userId) },
							],
					  }
					: { isHidden: false },
			],
		},
		include: {
			user: {
				select: {
					id: true,
					username: true,
					email: true,
				},
			},
			domain: {
				select: {
					id: true,
					name: true,
					url: true,
				},
			},
			screenshots: true,
			tags: true,
		},
		orderBy: {
			created: "desc",
		},
		take: 20,
	});

	return issues.map((issue) => ({
		id: issue.id,
		url: issue.url,
		description: issue.description,
		markdown_description: issue.markdownDescription,
		label: issue.label,
		views: issue.views,
		verified: issue.verified,
		score: issue.score,
		status: issue.status,
		screenshot: issue.screenshot,
		github_url: issue.githubUrl,
		is_hidden: issue.isHidden,
		rewarded: issue.rewarded,
		token_value: issue.tokenValue,
		user: issue.user,
		domain: issue.domain,
		screenshots: issue.screenshots,
		tags: issue.tags,
		created: issue.created,
		modified: issue.modified,
	}));
}

// Search domains by URL
async function searchDomains(query: string) {
	const domains = await prisma.domain.findMany({
		where: {
			AND: [
				{
					name: {
						contains: query,
						mode: "insensitive",
					},
				},
				{
					hunts: {
						none: {},
					},
				},
			],
		},
		include: {
			organization: {
				select: {
					id: true,
					name: true,
					slug: true,
				},
			},
			managers: {
				select: {
					id: true,
					username: true,
				},
			},
			tags: true,
		},
		orderBy: {
			created: "desc",
		},
		take: 20,
	});

	return domains.map((domain) => ({
		id: domain.id,
		name: domain.name,
		url: domain.url,
		logo: domain.logo,
		webshot: domain.webshot,
		email: domain.email,
		twitter: domain.twitter,
		facebook: domain.facebook,
		github: domain.github,
		is_active: domain.isActive,
		has_security_txt: domain.hasSecurityTxt,
		organization: domain.organization,
		managers: domain.managers,
		tags: domain.tags,
		created: domain.created,
	}));
}

// Search users by username
async function searchUsers(query: string) {
	const users = await prisma.user.findMany({
		where: {
			AND: [
				{
					username: {
						contains: query,
						mode: "insensitive",
					},
				},
				{
					isSuperuser: false,
				},
			],
		},
		include: {
			userProfile: {
				include: {
					tags: true,
				},
			},
			points: {
				select: {
					score: true,
				},
			},
			userBadges: {
				include: {
					badge: {
						select: {
							id: true,
							description: true,
							icon: true,
						},
					},
				},
			},
		},
		orderBy: {
			points: {
				_count: "desc",
			},
		},
		take: 20,
	});

	return users.map((user) => {
		const totalScore = user.points.reduce((sum, point) => sum + point.score, 0);
		
		return {
			id: user.id,
			username: user.username,
			email: user.email,
			first_name: user.firstName,
			last_name: user.lastName,
			is_active: user.isActive,
			date_joined: user.dateJoined,
			total_score: totalScore,
			profile: user.userProfile ? {
				id: user.userProfile.id,
				user_avatar: user.userProfile.userAvatar,
				title: user.userProfile.title,
				description: user.userProfile.description,
				winnings: user.userProfile.winnings,
				github_url: user.userProfile.githubUrl,
				linkedin_url: user.userProfile.linkedinUrl,
				website_url: user.userProfile.websiteUrl,
				tags: user.userProfile.tags,
			} : null,
			badges: user.userBadges.map((ub) => ({
				id: ub.id,
				badge: ub.badge,
				awarded_at: ub.awardedAt,
			})),
		};
	});
}

// Search projects by name or description
async function searchProjects(query: string) {
	const projects = await prisma.project.findMany({
		where: {
			OR: [
				{
					name: {
						contains: query,
						mode: "insensitive",
					},
				},
				{
					description: {
						contains: query,
						mode: "insensitive",
					},
				},
			],
		},
		include: {
			organization: {
				select: {
					id: true,
					name: true,
					slug: true,
				},
			},
			members: {
				include: {
					user: {
						select: {
							id: true,
							username: true,
						},
					},
				},
			},
			repositories: {
				select: {
					id: true,
					name: true,
					repoUrl: true,
				},
				take: 5,
			},
		},
		orderBy: {
			created: "desc",
		},
	});

	return projects.map((project) => ({
		id: project.id,
		name: project.name,
		description: project.description,
		status: project.status,
		url: project.url,
		twitter: project.twitter,
		slack: project.slack,
		facebook: project.facebook,
		logo: project.logo,
		project_visit_count: project.projectVisitCount,
		organization: project.organization,
		members: project.members.map((m) => ({
			id: m.id,
			role: m.role,
			user: m.user,
			joined_at: m.joinedAt,
		})),
		repositories: project.repositories,
		created: project.created,
		modified: project.modified,
	}));
}

// Search repositories by name or description
async function searchRepos(query: string) {
	const repos = await prisma.repo.findMany({
		where: {
			OR: [
				{
					name: {
						contains: query,
						mode: "insensitive",
					},
				},
				{
					description: {
						contains: query,
						mode: "insensitive",
					},
				},
			],
		},
		include: {
			organization: {
				select: {
					id: true,
					name: true,
					slug: true,
				},
			},
			project: {
				select: {
					id: true,
					name: true,
				},
			},
			tags: true,
			contributors: {
				take: 10,
				orderBy: {
					contributions: "desc",
				},
			},
		},
		orderBy: {
			stars: "desc",
		},
	});

	return repos.map((repo) => ({
		id: repo.id,
		name: repo.name,
		slug: repo.slug,
		description: repo.description,
		repo_url: repo.repoUrl,
		home_page_url: repo.homePageUrl,
		is_main: repo.isMain,
		is_archived: repo.isArchived,
		stars: repo.stars,
		forks: repo.forks,
		open_issues: repo.openIssues,
		watchers: repo.watchers,
		primary_language: repo.primaryLanguage,
		license: repo.license,
		last_commit_date: repo.lastCommitDate,
		contributors_count: repo.contributorsCount,
		organization: repo.organization,
		project: repo.project,
		tags: repo.tags,
		contributors: repo.contributors,
		created: repo.created,
		modified: repo.modified,
	}));
}

// Search issues by label
async function searchIssuesByLabel(query: string, userId?: string) {
	const issues = await prisma.issue.findMany({
		where: {
			AND: [
				{
					label: {
						equals: query.toUpperCase() as any,
					},
				},
				{
					domain: {
						hunts: {
							none: {},
						},
					},
				},
				// Hide hidden issues unless they belong to the current user
				userId
					? {
							OR: [
								{ isHidden: false },
								{ userId: parseInt(userId) },
							],
					  }
					: { isHidden: false },
			],
		},
		include: {
			user: {
				select: {
					id: true,
					username: true,
					email: true,
				},
			},
			domain: {
				select: {
					id: true,
					name: true,
					url: true,
				},
			},
			screenshots: true,
			tags: true,
		},
		orderBy: {
			created: "desc",
		},
		take: 20,
	});

	return issues.map((issue) => ({
		id: issue.id,
		url: issue.url,
		description: issue.description,
		label: issue.label,
		views: issue.views,
		verified: issue.verified,
		score: issue.score,
		status: issue.status,
		is_hidden: issue.isHidden,
		user: issue.user,
		domain: issue.domain,
		screenshots: issue.screenshots,
		tags: issue.tags,
		created: issue.created,
	}));
}

// Search by tags across multiple models
async function searchByTags(query: string) {
	const tags = await prisma.tag.findMany({
		where: {
			name: {
				contains: query,
				mode: "insensitive",
			},
		},
		include: {
			organizations: {
				include: {
					domains: {
						take: 1,
						select: {
							id: true,
							name: true,
							url: true,
						},
					},
				},
			},
			domains: true,
			issues: {
				where: {
					isHidden: false,
				},
				take: 20,
			},
			userProfiles: {
				include: {
					user: {
						select: {
							id: true,
							username: true,
						},
					},
				},
			},
			repos: true,
		},
	});

	// Format organizations with absolute URLs
	const matching_organizations = tags.flatMap((tag) =>
		tag.organizations.map((org) => ({
			...org,
			absolute_url: org.domains[0] ? `/domain/${org.domains[0].name}` : null,
		}))
	);

	const matching_domains = tags.flatMap((tag) => tag.domains);
	const matching_issues = tags.flatMap((tag) => tag.issues);
	const matching_user_profiles = tags.flatMap((tag) => tag.userProfiles);
	const matching_repos = tags.flatMap((tag) => tag.repos);

	return {
		tags: tags.map((tag) => ({
			id: tag.id,
			name: tag.name,
			created: tag.created,
		})),
		matching_organizations: Array.from(
			new Map(matching_organizations.map((item) => [item.id, item])).values()
		),
		matching_domains: Array.from(
			new Map(matching_domains.map((item) => [item.id, item])).values()
		),
		matching_issues: Array.from(
			new Map(matching_issues.map((item) => [item.id, item])).values()
		),
		matching_user_profiles: Array.from(
			new Map(matching_user_profiles.map((item) => [item.id, item])).values()
		),
		matching_repos: Array.from(
			new Map(matching_repos.map((item) => [item.id, item])).values()
		),
	};
}

// Search repositories by primary language
async function searchReposByLanguage(query: string) {
	const repos = await prisma.repo.findMany({
		where: {
			primaryLanguage: {
				contains: query,
				mode: "insensitive",
			},
		},
		include: {
			organization: {
				select: {
					id: true,
					name: true,
					slug: true,
				},
			},
			project: {
				select: {
					id: true,
					name: true,
				},
			},
			tags: true,
		},
		orderBy: {
			stars: "desc",
		},
	});

	return repos.map((repo) => ({
		id: repo.id,
		name: repo.name,
		slug: repo.slug,
		description: repo.description,
		repo_url: repo.repoUrl,
		home_page_url: repo.homePageUrl,
		stars: repo.stars,
		forks: repo.forks,
		open_issues: repo.openIssues,
		primary_language: repo.primaryLanguage,
		license: repo.license,
		organization: repo.organization,
		project: repo.project,
		tags: repo.tags,
		created: repo.created,
	}));
}
