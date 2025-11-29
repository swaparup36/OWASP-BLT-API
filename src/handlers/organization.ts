import { Context } from "hono";
import prisma from "../utils/db";
import { OrganizationAdminRole, IssueLabel } from "../generated/prisma/enums";
import { validateImage, generateUniqueFilename, uploadToR2 } from "../utils/file-upload";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
		isOrganizationAdmin?: boolean;
	};
};

type OrganizationContext = Context<AppEnv>;

// Helper function to generate slug from name
function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, "")
		.replace(/[\s_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

// Helper function to format repository data for response
function formatRepoResponse(repo: any) {
	return {
		id: repo.id,
		organization_id: repo.organizationId,
		project_id: repo.projectId,
		name: repo.name,
		slug: repo.slug,
		description: repo.description,
		repo_url: repo.repoUrl,
		home_page_url: repo.homePageUrl,
		is_main: repo.isMain,
		is_wiki: repo.isWiki,
		is_archived: repo.isArchived,
		stars: repo.stars,
		forks: repo.forks,
		open_issues: repo.openIssues,
		last_updated: repo.lastUpdated,
		total_issues: repo.totalIssues,
		repo_visit_count: repo.repoVisitCount,
		watchers: repo.watchers,
		open_pull_requests: repo.openPullRequests,
		closed_pull_requests: repo.closedPullRequests,
		primary_language: repo.primaryLanguage,
		license: repo.license,
		last_commit_date: repo.lastCommitDate,
		created: repo.created,
		modified: repo.modified,
		network_count: repo.networkCount,
		subscribers_count: repo.subscribersCount,
		closed_issues: repo.closedIssues,
		size: repo.size,
		commit_count: repo.commitCount,
		release_name: repo.releaseName,
		release_date_time: repo.releaseDateTime,
		logo_url: repo.logoUrl,
		contributors_count: repo.contributorsCount,
		is_owasp_repo: repo.isOwaspRepo,
		readme_content: repo.readmeContent,
		ai_summary: repo.aiSummary,
		last_pr_page_processed: repo.lastPrPageProcessed,
		last_pr_fetch_date: repo.lastPrFetchDate,
	};
}

// Get organization details for dashboard
export async function getOrganizationDetails(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
			include: {
				admin: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				managers: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				domains: {
					where: {
						isActive: true,
					},
					select: {
						id: true,
						name: true,
						url: true,
						logo: true,
						created: true,
					},
				},
				admins: {
					where: {
						isActive: true,
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
							},
						},
					},
				},
			},
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Get organization statistics
		const [totalDomains, totalMembers, totalIssues, totalProjects] = await Promise.all([
			prisma.domain.count({
				where: {
					organizationId: organizationId,
					isActive: true,
				},
			}),
			prisma.organizationMember.count({
				where: {
					organizationId: organizationId,
					isActive: true,
				},
			}),
			prisma.issue.count({
				where: {
					domain: {
						organizationId: organizationId,
					},
				},
			}),
			prisma.project.count({
				where: {
					organizationId: organizationId,
				},
			}),
		]);

		return c.json({
			id: organization.id,
			name: organization.name,
			slug: organization.slug,
			url: organization.url,
			email: organization.email,
			twitter: organization.twitter,
			facebook: organization.facebook,
			logo: organization.logo,
			is_active: organization.isActive,
			created: organization.created,
			modified: organization.modified,
			admin: organization.admin,
			managers: organization.managers,
			domains: organization.domains,
			roles: organization.admins.map((role) => ({
				id: role.id,
				user: role.user,
				role: role.role,
				domain: role.domain,
				is_active: role.isActive,
				created: role.created,
			})),
			statistics: {
				total_domains: totalDomains,
				total_members: totalMembers,
				total_issues: totalIssues,
				total_projects: totalProjects,
			},
		});
	} catch (error) {
		console.error("Error retrieving organization details:", error);
		return c.json({ detail: "Failed to retrieve organization details" }, 500);
	}
}

// Get organizations that the authenticated user has access to
export async function getUserOrganizations(c: OrganizationContext) {
	try {
		const currentUserId = c.get("userId");

		if (!currentUserId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		const userId = parseInt(currentUserId);

		// Get organizations where user is the owner
		const ownedOrganizations = await prisma.organization.findMany({
			where: {
				adminId: userId,
				isActive: true,
			},
			select: {
				id: true,
				name: true,
				slug: true,
				url: true,
				logo: true,
				email: true,
				created: true,
			},
		});

		// Get organizations where user is a manager
		const managedOrganizations = await prisma.organization.findMany({
			where: {
				managers: {
					some: {
						id: userId,
					},
				},
				isActive: true,
			},
			select: {
				id: true,
				name: true,
				slug: true,
				url: true,
				logo: true,
				email: true,
				created: true,
			},
		});

		// Get organizations where user has admin/moderator role
		const adminRoles = await prisma.organizationAdmin.findMany({
			where: {
				userId: userId,
				isActive: true,
			},
			include: {
				organization: {
					select: {
						id: true,
						name: true,
						slug: true,
						url: true,
						logo: true,
						email: true,
						created: true,
						isActive: true,
					},
				},
				domain: {
					select: {
						id: true,
						name: true,
					},
				},
			},
		});

		// Get organizations where user is a member
		const memberOrganizations = await prisma.organizationMember.findMany({
			where: {
				userId: userId,
				isActive: true,
			},
			include: {
				organization: {
					select: {
						id: true,
						name: true,
						slug: true,
						url: true,
						logo: true,
						email: true,
						created: true,
						isActive: true,
					},
				},
			},
		});

		// Combine and format the results
		const organizationsMap = new Map();

		// Add owned organizations
		ownedOrganizations.forEach((org) => {
			organizationsMap.set(org.id, {
				...org,
				role: "owner",
				access_level: "owner",
			});
		});

		// Add managed organizations
		managedOrganizations.forEach((org) => {
			if (!organizationsMap.has(org.id)) {
				organizationsMap.set(org.id, {
					...org,
					role: "manager",
					access_level: "manager",
				});
			}
		});

		// Add organizations with admin/moderator roles
		adminRoles.forEach((roleEntry) => {
			if (roleEntry.organization.isActive) {
				if (!organizationsMap.has(roleEntry.organization.id)) {
					organizationsMap.set(roleEntry.organization.id, {
						...roleEntry.organization,
						role: roleEntry.role.toLowerCase(),
						access_level: roleEntry.role.toLowerCase(),
						domain: roleEntry.domain,
					});
				} else {
					// If already exists, add domain info if applicable
					const existing = organizationsMap.get(roleEntry.organization.id);
					if (roleEntry.domain && !existing.domain) {
						existing.domain = roleEntry.domain;
					}
				}
			}
		});

		// Add member organizations
		memberOrganizations.forEach((memberEntry) => {
			if (memberEntry.organization.isActive) {
				if (!organizationsMap.has(memberEntry.organization.id)) {
					organizationsMap.set(memberEntry.organization.id, {
						...memberEntry.organization,
						role: "member",
						access_level: "member",
					});
				}
			}
		});

		// Convert map to array and sort by name
		const organizations = Array.from(organizationsMap.values()).sort((a, b) => 
			a.name.localeCompare(b.name)
		);

		return c.json({
			count: organizations.length,
			organizations: organizations,
		});
	} catch (error) {
		console.error("Error retrieving user organizations:", error);
		return c.json({ detail: "Failed to retrieve organizations" }, 500);
	}
}

// Get Slack integration status for an organization
export async function getOrganizationSlackIntegration(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Find Slack integration
		const integration = await prisma.integration.findFirst({
			where: {
				organizationId: organizationId,
				serviceName: "SLACK",
			},
			include: {
				slackIntegration: true,
			},
		});

		if (!integration || !integration.slackIntegration) {
			return c.json({
				has_integration: false,
				detail: "No Slack integration found for this organization",
			});
		}

		return c.json({
			has_integration: true,
			integration: {
				id: integration.id,
				workspace_name: integration.slackIntegration.workspaceName,
				default_channel_name: integration.slackIntegration.defaultChannelName,
				default_channel_id: integration.slackIntegration.defaultChannelId,
				daily_updates: integration.slackIntegration.dailyUpdates,
				daily_update_time: integration.slackIntegration.dailyUpdateTime,
				welcome_message: integration.slackIntegration.welcomeMessage,
				created_at: integration.createdAt,
			},
		});
	} catch (error) {
		console.error("Error retrieving Slack integration:", error);
		return c.json({ detail: "Failed to retrieve Slack integration" }, 500);
	}
}

// Get bug hunts for an organization with filtering
export async function getOrganizationBugHunts(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));
		const currentUserId = c.get("userId");

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Get the organization
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
			select: {
				id: true,
				name: true,
				slug: true,
				logo: true,
				url: true,
			},
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Get user's accessible organizations if authenticated
		let userOrganizations: any[] = [];
		if (currentUserId) {
			const userId = parseInt(currentUserId);

			// Check if user has access to organizations (as owner, manager, admin, or moderator)
			const [ownedOrgs, managedOrgs, adminRoles] = await Promise.all([
				prisma.organization.findMany({
					where: {
						adminId: userId,
						isActive: true,
					},
					select: { id: true, name: true },
				}),
				prisma.organization.findMany({
					where: {
						managers: {
							some: { id: userId },
						},
						isActive: true,
					},
					select: { id: true, name: true },
				}),
				prisma.organizationAdmin.findMany({
					where: {
						userId: userId,
						isActive: true,
					},
					include: {
						organization: {
							select: { id: true, name: true, isActive: true },
						},
					},
				}),
			]);

			// Combine all organizations user has access to
			const orgMap = new Map();
			ownedOrgs.forEach(org => orgMap.set(org.id, org));
			managedOrgs.forEach(org => orgMap.set(org.id, org));
			adminRoles.forEach(role => {
				if (role.organization.isActive) {
					orgMap.set(role.organization.id, {
						id: role.organization.id,
						name: role.organization.name,
					});
				}
			});

			userOrganizations = Array.from(orgMap.values());
		}

		// Get filter type from query parameter (all, ongoing, ended, draft)
		const filterType = c.req.query("filter") || "all";

		// Base query for hunts
		const baseWhere: any = {
			domain: {
				organizationId: organizationId,
			},
		};

		// Apply filters based on filter type
		let huntsWhere = { ...baseWhere };
		switch (filterType) {
			case "ongoing":
				huntsWhere = {
					...baseWhere,
					resultPublished: false,
					isPublished: true,
				};
				break;
			case "ended":
				huntsWhere = {
					...baseWhere,
					resultPublished: true,
				};
				break;
			case "draft":
				huntsWhere = {
					...baseWhere,
					resultPublished: false,
					isPublished: false,
				};
				break;
			case "all":
			default:
				// No additional filters for "all"
				break;
		}

		// Fetch hunts with prizes
		const hunts = await prisma.hunt.findMany({
			where: huntsWhere,
			select: {
				id: true,
				name: true,
				url: true,
				logo: true,
				startsOn: true,
				endOn: true,
				isPublished: true,
				resultPublished: true,
				prizes: {
					select: {
						value: true,
					},
				},
			},
			orderBy: {
				created: "desc",
			},
		});

		// Format the response
		const formattedHunts = hunts.map((hunt) => {
			const startsOn = hunt.startsOn ? new Date(hunt.startsOn) : null;
			const endOn = hunt.endOn ? new Date(hunt.endOn) : null;

			// Calculate total prize
			const totalPrize = hunt.prizes.reduce((sum: number, prize: { value: number }) => {
				return sum + (prize.value ? Number(prize.value) : 0);
			}, 0);

			return {
				id: hunt.id,
				name: hunt.name,
				url: hunt.url,
				logo: hunt.logo,
				is_published: hunt.isPublished,
				result_published: hunt.resultPublished,
				total_prize: totalPrize,
				starts_on: startsOn ? {
					day: startsOn.getDate(),
					month: startsOn.getMonth() + 1,
					year: startsOn.getFullYear(),
					date: startsOn.toISOString(),
				} : null,
				end_on: endOn ? {
					day: endOn.getDate(),
					month: endOn.getMonth() + 1,
					year: endOn.getFullYear(),
					date: endOn.toISOString(),
				} : null,
			};
		});

		return c.json({
			organization: {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo,
				url: organization.url,
			},
			user_organizations: userOrganizations,
			filter: filterType,
			count: formattedHunts.length,
			bughunts: formattedHunts,
		});
	} catch (error) {
		console.error("Error retrieving organization bug hunts:", error);
		return c.json({ detail: "Failed to retrieve bug hunts" }, 500);
	}
}

// Get issues/bugs for an organization
export async function getOrganizationIssues(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));
		const currentUserId = c.get("userId");

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Get the organization
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
			select: {
				id: true,
				name: true,
				slug: true,
				logo: true,
				url: true,
				email: true,
			},
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Get user's accessible organizations if authenticated
		let userOrganizations: any[] = [];
		if (currentUserId) {
			const userId = parseInt(currentUserId);

			// Check if user has access to organizations (as owner, manager, admin, or moderator)
			const [ownedOrgs, managedOrgs, adminRoles] = await Promise.all([
				prisma.organization.findMany({
					where: {
						adminId: userId,
						isActive: true,
					},
					select: { id: true, name: true },
				}),
				prisma.organization.findMany({
					where: {
						managers: {
							some: { id: userId },
						},
						isActive: true,
					},
					select: { id: true, name: true },
				}),
				prisma.organizationAdmin.findMany({
					where: {
						userId: userId,
						isActive: true,
					},
					include: {
						organization: {
							select: { id: true, name: true, isActive: true },
						},
					},
				}),
			]);

			// Combine all organizations user has access to
			const orgMap = new Map();
			ownedOrgs.forEach(org => orgMap.set(org.id, org));
			managedOrgs.forEach(org => orgMap.set(org.id, org));
			adminRoles.forEach(role => {
				if (role.organization.isActive) {
					orgMap.set(role.organization.id, {
						id: role.organization.id,
						name: role.organization.name,
					});
				}
			});

			userOrganizations = Array.from(orgMap.values());
		}

		// Get all issues for this organization, ordered by creation date
		const issues = await prisma.issue.findMany({
			where: {
				domain: {
					organizationId: organizationId,
				},
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
				assignedUser: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
			},
			orderBy: {
				created: "desc",
			},
		});

		// Format the issues
		const formattedIssues = issues.map((issue) => ({
			id: issue.id,
			url: issue.url,
			description: issue.description,
			markdown_description: issue.markdownDescription,
			screenshot: issue.screenshot,
			label: issue.label,
			views: issue.views,
			verified: issue.verified,
			score: issue.score,
			status: issue.status,
			user: issue.user,
			domain: issue.domain,
			assigned_user: issue.assignedUser,
			created: issue.created,
			modified: issue.modified,
			is_hidden: issue.isHidden,
			reporter_ip_address: issue.reporterIpAddress,
			github_url: issue.githubUrl,
			cve_id: issue.cveId,
			cve_score: issue.cveScore ? Number(issue.cveScore) : null,
			rewarded: issue.rewarded,
			token_value: issue.tokenValue,
			public: issue.public,
			closed_date: issue.closedDate,
		}));

		return c.json({
			organization: {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo,
				url: organization.url,
				email: organization.email,
			},
			user_organizations: userOrganizations,
			count: formattedIssues.length,
			issues: formattedIssues,
		});
	} catch (error) {
		console.error("Error retrieving organization issues:", error);
		return c.json({ detail: "Failed to retrieve issues" }, 500);
	}
}

// Get domains for an organization with security.txt filtering
export async function getOrganizationDomains(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));
		const currentUserId = c.get("userId");

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Get the organization
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
			select: {
				id: true,
				name: true,
				slug: true,
				logo: true,
				url: true,
				email: true,
			},
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Get user's accessible organizations if authenticated
		let userOrganizations: any[] = [];
		if (currentUserId) {
			const userId = parseInt(currentUserId);

			// Check if user has access to organizations (as owner, manager, admin, or moderator)
			const [ownedOrgs, managedOrgs, adminRoles] = await Promise.all([
				prisma.organization.findMany({
					where: {
						adminId: userId,
						isActive: true,
					},
					select: { id: true, name: true },
				}),
				prisma.organization.findMany({
					where: {
						managers: {
							some: { id: userId },
						},
						isActive: true,
					},
					select: { id: true, name: true },
				}),
				prisma.organizationAdmin.findMany({
					where: {
						userId: userId,
						isActive: true,
					},
					include: {
						organization: {
							select: { id: true, name: true, isActive: true },
						},
					},
				}),
			]);

			// Combine all organizations user has access to
			const orgMap = new Map();
			ownedOrgs.forEach(org => orgMap.set(org.id, org));
			managedOrgs.forEach(org => orgMap.set(org.id, org));
			adminRoles.forEach(role => {
				if (role.organization.isActive) {
					orgMap.set(role.organization.id, {
						id: role.organization.id,
						name: role.organization.name,
					});
				}
			});

			userOrganizations = Array.from(orgMap.values());
		}

		// Get the filter parameter for security.txt
		const securityTxtFilter = c.req.query("security_txt");

		// Base query for domains
		let domainsWhere: any = {
			organizationId: organizationId,
		};

		// Apply filter if provided
		if (securityTxtFilter) {
			if (securityTxtFilter === "yes") {
				domainsWhere.hasSecurityTxt = true;
			} else if (securityTxtFilter === "no") {
				domainsWhere.OR = [
					{ hasSecurityTxt: false },
				];
			}
		}

		// Get all domains for this organization
		const domains = await prisma.domain.findMany({
			where: domainsWhere,
			select: {
				id: true,
				name: true,
				url: true,
				logo: true,
				isActive: true,
				hasSecurityTxt: true,
				securityTxtCheckedAt: true,
			},
			orderBy: {
				name: "asc",
			},
		});

		// Get security.txt counts
		const [securityTxtYesCount, securityTxtNoCount, totalDomains] = await Promise.all([
			prisma.domain.count({
				where: {
					organizationId: organizationId,
					hasSecurityTxt: true,
				},
			}),
			prisma.domain.count({
				where: {
					organizationId: organizationId,
					hasSecurityTxt: false,
				},
			}),
			prisma.domain.count({
				where: {
					organizationId: organizationId,
				},
			}),
		]);

		// Format the domains
		const formattedDomains = domains.map((domain) => ({
			id: domain.id,
			name: domain.name,
			url: domain.url,
			logo: domain.logo,
			is_active: domain.isActive,
			has_security_txt: domain.hasSecurityTxt,
			security_txt_checked_at: domain.securityTxtCheckedAt,
		}));

		return c.json({
			organization: {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo,
				url: organization.url,
				email: organization.email,
			},
			user_organizations: userOrganizations,
			security_txt_filter: securityTxtFilter || null,
			security_txt_yes_count: securityTxtYesCount,
			security_txt_no_count: securityTxtNoCount,
			count: formattedDomains.length,
			domains: formattedDomains,
		});
	} catch (error) {
		console.error("Error retrieving organization domains:", error);
		return c.json({ detail: "Failed to retrieve domains" }, 500);
	}
}

// Get organization roles with permission checks
export async function getOrganizationRoles(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));
		const currentUserId = c.get("userId");

		if (!currentUserId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		const userId = parseInt(currentUserId);

		// Get the organization
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
			select: {
				id: true,
				name: true,
				slug: true,
				logo: true,
				url: true,
				email: true,
				adminId: true,
			},
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Check if user is admin or manager of this organization
		const isOrgAdmin = organization.adminId === userId;
		const isOrgManager = await prisma.organization.findFirst({
			where: {
				id: organizationId,
				managers: {
					some: { id: userId },
				},
			},
		});

		if (!isOrgAdmin && !isOrgManager) {
			return c.json({ detail: "You don't have permission to manage roles for this organization" }, 403);
		}

		// Get user's own role to determine permissions
		let userRoleLevel = 0; // Default for org owner
		if (!isOrgAdmin) {
			const currentUserRole = await prisma.organizationAdmin.findFirst({
				where: {
					userId: userId,
					organizationId: organizationId,
					isActive: true,
				},
			});

			if (!currentUserRole) {
				return c.json({ detail: "You don't have an active role in this organization" }, 403);
			}

			// 0=Admin, 1=Moderator (using enum values)
			userRoleLevel = currentUserRole.role === OrganizationAdminRole.ADMIN ? 0 : 1;
		}

		// Only admins (role=0) or org owner can manage roles
		if (userRoleLevel !== 0 && !isOrgAdmin) {
			return c.json({ detail: "Only administrators can manage roles" }, 403);
		}

		// Get all active roles in the organization
		const orgRoles = await prisma.organizationAdmin.findMany({
			where: {
				organizationId: organizationId,
				isActive: true,
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
						firstName: true,
						lastName: true,
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
					},
				},
			},
			orderBy: [
				{ role: "asc" },
				{ created: "asc" },
			],
		});

		// Get organization domains for assignment
		const domains = await prisma.domain.findMany({
			where: { organizationId: organizationId },
			select: {
				id: true,
				name: true,
			},
			orderBy: {
				name: "asc",
			},
		});

		// Extract domain from organization URL for finding matching users
		let organizationDomain = "";
		try {
			let orgUrl = organization.url;
			if (!orgUrl.includes("://")) {
				orgUrl = `https://${orgUrl}`;
			}
			const url = new URL(orgUrl);
			organizationDomain = url.hostname.replace("www.", "").trim();
		} catch (error) {
			console.error("Error parsing organization URL:", error);
		}

		// Get existing role user IDs to exclude
		const existingUserIds = orgRoles.map(role => role.userId);

		// Try to get users matching organization email domain
		let availableUsers: any[] = [];
		if (organizationDomain) {
			availableUsers = await prisma.user.findMany({
				where: {
					email: {
						endsWith: `@${organizationDomain}`,
					},
					isActive: true,
					id: {
						notIn: existingUserIds,
					},
				},
				select: {
					id: true,
					username: true,
					email: true,
					firstName: true,
					lastName: true,
				},
				take: 100,
			});
		}

		// If no users found with matching email domain, show all active users
		if (availableUsers.length === 0) {
			availableUsers = await prisma.user.findMany({
				where: {
					isActive: true,
					id: {
						notIn: existingUserIds,
					},
				},
				select: {
					id: true,
					username: true,
					email: true,
					firstName: true,
					lastName: true,
				},
				take: 100,
			});
		}

		// Format roles data
		const rolesData: any[] = [];
		let adminCount = 0;
		let moderatorCount = 0;

		for (const orgRole of orgRoles) {
			const roleInfo = {
				id: orgRole.id,
				user_id: orgRole.user?.id || null,
				username: orgRole.user?.username || "Unknown",
				email: orgRole.user?.email || "",
				first_name: orgRole.user?.firstName || "",
				last_name: orgRole.user?.lastName || "",
				avatar: orgRole.user?.userProfile?.userAvatar || null,
				role: orgRole.role === OrganizationAdminRole.ADMIN ? 0 : 1,
				role_display: orgRole.role === OrganizationAdminRole.ADMIN ? "Administrator" : "Moderator",
				domain: orgRole.domain ? {
					id: orgRole.domain.id,
					name: orgRole.domain.name,
				} : null,
				created: orgRole.created,
				is_active: orgRole.isActive,
				is_owner: organization.adminId === orgRole.userId,
			};
			rolesData.push(roleInfo);

			if (orgRole.role === OrganizationAdminRole.ADMIN) {
				adminCount++;
			} else {
				moderatorCount++;
			}
		}

		// Format available users
		const formattedAvailableUsers = availableUsers.map(user => ({
			id: user.id,
			username: user.username,
			email: user.email,
			first_name: user.firstName,
			last_name: user.lastName,
		}));

		return c.json({
			organization: {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo,
				url: organization.url,
				email: organization.email,
			},
			roles: rolesData,
			domains: domains,
			available_users: formattedAvailableUsers,
			is_org_admin: isOrgAdmin,
			user_role_level: userRoleLevel,
			admin_count: adminCount,
			moderator_count: moderatorCount,
			role_choices: [
				{ value: 0, label: "Administrator" },
				{ value: 1, label: "Moderator" },
			],
		});
	} catch (error) {
		console.error("Error retrieving organization roles:", error);
		return c.json({ detail: "Failed to retrieve organization roles" }, 500);
	}
}

// Get organization team overview with daily status reports
export async function getOrganizationTeamOverview(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));
		const currentUserId = c.get("userId");

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Get the organization
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
			select: {
				id: true,
				name: true,
				slug: true,
				logo: true,
				url: true,
				email: true,
				adminId: true,
			},
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Get user's accessible organizations if authenticated
		let userOrganizations: any[] = [];
		if (currentUserId) {
			const userId = parseInt(currentUserId);

			const [ownedOrgs, managedOrgs, adminRoles] = await Promise.all([
				prisma.organization.findMany({
					where: {
						adminId: userId,
						isActive: true,
					},
					select: { id: true, name: true },
				}),
				prisma.organization.findMany({
					where: {
						managers: {
							some: { id: userId },
						},
						isActive: true,
					},
					select: { id: true, name: true },
				}),
				prisma.organizationAdmin.findMany({
					where: {
						userId: userId,
						isActive: true,
					},
					include: {
						organization: {
							select: { id: true, name: true, isActive: true },
						},
					},
				}),
			]);

			const orgMap = new Map();
			ownedOrgs.forEach(org => orgMap.set(org.id, org));
			managedOrgs.forEach(org => orgMap.set(org.id, org));
			adminRoles.forEach(role => {
				if (role.organization.isActive) {
					orgMap.set(role.organization.id, {
						id: role.organization.id,
						name: role.organization.name,
					});
				}
			});

			userOrganizations = Array.from(orgMap.values());
		}

		// Get team members from organization's admin and managers
		const teamMemberUsers: any[] = [];
		const teamMemberIds = new Set<number>();

		// Get admin
		if (organization.adminId) {
			const admin = await prisma.user.findUnique({
				where: { id: organization.adminId },
				include: {
					userProfile: {
						select: {
							userAvatar: true,
						},
					},
				},
			});

			if (admin) {
				teamMemberUsers.push({
					id: admin.id,
					username: admin.username,
					email: admin.email,
					first_name: admin.firstName,
					last_name: admin.lastName,
					user_avatar: admin.userProfile?.userAvatar || null,
					role: "Admin",
				});
				teamMemberIds.add(admin.id);
			}
		}

		// Get managers
		const managers = await prisma.organization.findUnique({
			where: { id: organizationId },
			select: {
				managers: {
					include: {
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				},
			},
		});

		if (managers?.managers) {
			for (const manager of managers.managers) {
				if (!teamMemberIds.has(manager.id)) {
					teamMemberUsers.push({
						id: manager.id,
						username: manager.username,
						email: manager.email,
						first_name: manager.firstName,
						last_name: manager.lastName,
						user_avatar: manager.userProfile?.userAvatar || null,
						role: "Manager",
					});
					teamMemberIds.add(manager.id);
				}
			}
		}

		// Get filter parameters
		const filterType = c.req.query("filter_type");
		const filterValue = c.req.query("filter_value");

		// Base query for daily status reports
		let reportsWhere: any = {
			userId: {
				in: Array.from(teamMemberIds),
			},
		};

		// Apply filters
		if (filterType && filterValue) {
			switch (filterType) {
				case "user":
					reportsWhere.userId = parseInt(filterValue);
					break;
				case "date":
					reportsWhere.date = new Date(filterValue);
					break;
				case "goal":
					reportsWhere.goalAccomplished = filterValue === "true";
					break;
				case "task":
					reportsWhere.previousWork = {
						contains: filterValue,
						mode: "insensitive",
					};
					break;
			}
		}

		// Get daily status reports
		const dailyStatusReports = await prisma.dailyStatusReport.findMany({
			where: reportsWhere,
			include: {
				user: {
					include: {
						userProfile: {
							select: {
								userAvatar: true,
							},
						},
					},
				},
			},
			orderBy: {
				date: "desc",
			},
		});

		// Format the reports
		const formattedReports = dailyStatusReports.map((report) => ({
			id: report.id,
			username: report.user.username,
			user_id: report.userId,
			avatar_url: report.user.userProfile?.userAvatar || null,
			date: report.date.toISOString(),
			date_formatted: report.date.toLocaleDateString("en-US", {
				year: "numeric",
				month: "long",
				day: "numeric",
			}),
			previous_work: report.previousWork,
			next_plan: report.nextPlan,
			blockers: report.blockers,
			goal_accomplished: report.goalAccomplished,
			current_mood: report.currentMood,
		}));

		return c.json({
			organization: {
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				logo: organization.logo,
				url: organization.url,
				email: organization.email,
			},
			user_organizations: userOrganizations,
			team_members: teamMemberUsers,
			team_members_count: teamMemberUsers.length,
			daily_status_reports: formattedReports,
			reports_count: formattedReports.length,
			applied_filters: filterType && filterValue ? {
				filter_type: filterType,
				filter_value: filterValue,
			} : null,
		});
	} catch (error) {
		console.error("Error retrieving organization team overview:", error);
		return c.json({ detail: "Failed to retrieve team overview" }, 500);
	}
}

// Get all repositories for an organization by organization ID
export async function getOrganizationRepositories(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
		});

		if (!organization) {
			return c.json({ detail: "Organization not found." }, 404);
		}

		const repos = await prisma.repo.findMany({
			where: {
				organizationId: organizationId,
			},
			orderBy: {
				created: "desc",
			},
		});

		const formattedRepos = repos.map((repo) => formatRepoResponse(repo));

		return c.json(formattedRepos);
	} catch (error) {
		console.error("Error retrieving organization repositories:", error);
		return c.json({ detail: "Failed to retrieve repositories" }, 500);
	}
}

// Accept a bug/issue and optionally assign a reward
export async function acceptBug(c: OrganizationContext) {
	try {
		const issueId = parseInt(c.req.param("issue_id"));
		const rewardId = c.req.param("reward_id");
		const currentUserId = c.get("userId");

		if (!currentUserId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (isNaN(issueId)) {
			return c.json({ detail: "Invalid issue ID" }, 400);
		}

		// Get the issue with domain and hunt information
		const issue = await prisma.issue.findUnique({
			where: { id: issueId },
			include: {
				domain: {
					include: {
						hunts: {
							where: {
								isPublished: true,
							},
							orderBy: {
								created: "desc",
							},
							take: 1,
						},
					},
				},
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
			},
		});

		if (!issue) {
			return c.json({ detail: "Issue not found" }, 404);
		}

		if (!issue.domain) {
			return c.json({ detail: "Issue domain not found" }, 404);
		}

		// Check if user has permission to accept bugs for this organization
		if (issue.domain.organizationId) {
			const organization = await prisma.organization.findUnique({
				where: { id: issue.domain.organizationId },
			});

			if (!organization) {
				return c.json({ detail: "Organization not found" }, 404);
			}

			const userId = parseInt(currentUserId);
			const isOrgAdmin = organization.adminId === userId;
			const isOrgManager = await prisma.organization.findFirst({
				where: {
					id: issue.domain.organizationId,
					managers: {
						some: { id: userId },
					},
				},
			});

			const hasAdminRole = await prisma.organizationAdmin.findFirst({
				where: {
					userId: userId,
					organizationId: issue.domain.organizationId,
					isActive: true,
				},
			});

			if (!isOrgAdmin && !isOrgManager && !hasAdminRole) {
				return c.json({ detail: "You don't have permission to accept bugs for this organization" }, 403);
			}
		}

		// Get the active hunt for this domain
		const hunt = issue.domain.hunts && issue.domain.hunts.length > 0 ? issue.domain.hunts[0] : null;

		if (!hunt) {
			return c.json({ detail: "No active bug hunt found for this issue's domain" }, 404);
		}

		// Check if issue is already verified
		if (issue.verified) {
			return c.json({ detail: "Issue is already verified" }, 400);
		}

		// Start transaction
		let rewardAmount = 0;
		let prizeId: number | null = null;

		if (rewardId === "no_reward") {
			// Accept without reward
			await prisma.$transaction(async (tx) => {
				// Update issue
				await tx.issue.update({
					where: { id: issueId },
					data: {
						verified: true,
						rewarded: 0,
					},
				});

				await tx.winner.create({
					data: {
						huntId: hunt.id,
						issueId: issueId,
						winnerId: issue.userId,
						prizeAmount: 0,
						prizeDistributed: false,
					},
				});
			});

			return c.json({
				detail: "Bug accepted successfully without reward",
				issue: {
					id: issue.id,
					url: issue.url,
					description: issue.description,
					verified: true,
					rewarded: 0,
					user: issue.user,
				},
				hunt: {
					id: hunt.id,
					name: hunt.name,
					url: hunt.url,
				},
			});
		} else {
			// Accept with reward
			const parsedRewardId = parseInt(rewardId);
			if (isNaN(parsedRewardId)) {
				return c.json({ detail: "Invalid reward ID" }, 400);
			}

			// Get the hunt prize
			const huntPrize = await prisma.huntPrize.findFirst({
				where: {
					id: parsedRewardId,
					huntId: hunt.id,
				},
			});

			if (!huntPrize) {
				return c.json({ detail: "Hunt prize not found or does not belong to this hunt" }, 404);
			}

			rewardAmount = huntPrize.value;
			prizeId = huntPrize.id;

			await prisma.$transaction(async (tx) => {
				// Update issue
				await tx.issue.update({
					where: { id: issueId },
					data: {
						verified: true,
						rewarded: rewardAmount,
					},
				});

				// Create winner record
				await tx.winner.create({
					data: {
						huntId: hunt.id,
						issueId: issueId,
						winnerId: issue.userId || 0,
						runnerId: issue.userId || 0,
						secondRunnerId: issue.userId || 0,
						prizeAmount: rewardAmount,
						prizeDistributed: false,
					},
				});
			});

			return c.json({
				detail: "Bug accepted successfully with reward",
				issue: {
					id: issue.id,
					url: issue.url,
					description: issue.description,
					verified: true,
					rewarded: rewardAmount,
					user: issue.user,
				},
				hunt: {
					id: hunt.id,
					name: hunt.name,
					url: hunt.url,
				},
				prize: {
					id: huntPrize.id,
					name: huntPrize.name,
					value: huntPrize.value,
				},
			});
		}
	} catch (error) {
		console.error("Error accepting bug:", error);
		return c.json({ detail: "Failed to accept bug" }, 500);
	}
}

// Add a role to a user in an organization
export async function addOrganizationRole(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));
		const currentUserId = c.get("userId");

		if (!currentUserId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Get request body
		const body = await c.req.json();
		const { user_id, email, role, domain_id } = body;

		// Validate that either user_id or email is provided
		if (!user_id && !email) {
			return c.json({ detail: "Please provide a user ID or email" }, 400);
		}

		// Get the organization with admin info
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
			include: {
				admin: true,
			},
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Check current user's permissions
		const isOrgOwner = organization.adminId === parseInt(currentUserId);
		const currentUserRole = await prisma.organizationAdmin.findFirst({
			where: {
				userId: parseInt(currentUserId),
				organizationId: organizationId,
				isActive: true,
			},
		});

		// Only organization owner or admins can add roles
		const isAdmin = currentUserRole?.role === OrganizationAdminRole.ADMIN;
		if (!isOrgOwner && !isAdmin) {
			return c.json({ detail: "Only administrators can manage roles" }, 403);
		}

		// Find the target user
		let targetUser;
		if (user_id) {
			targetUser = await prisma.user.findFirst({
				where: {
					id: parseInt(user_id),
					isActive: true,
				},
			});
		} else if (email) {
			targetUser = await prisma.user.findFirst({
				where: {
					email: email,
					isActive: true,
				},
			});
		}

		if (!targetUser) {
			return c.json({ detail: "User not found or inactive" }, 404);
		}

		// Prevent assigning role to self
		if (targetUser.id === parseInt(currentUserId)) {
			return c.json({ detail: "You cannot modify your own role" }, 400);
		}

		// Check if user already has an active role
		const existingRole = await prisma.organizationAdmin.findFirst({
			where: {
				userId: targetUser.id,
				organizationId: organizationId,
				isActive: true,
			},
		});

		if (existingRole) {
			return c.json(
				{ detail: `${targetUser.username} already has an active role in this organization` },
				400
			);
		}

		// Validate domain if provided
		let domain = null;
		if (domain_id) {
			domain = await prisma.domain.findFirst({
				where: {
					id: parseInt(domain_id),
					organizationId: organizationId,
				},
			});

			if (!domain) {
				return c.json({ detail: "Domain not found in this organization" }, 404);
			}
		}

		// Parse role (default to MODERATOR if not specified)
		const roleValue = role === "0" || role === 0 ? OrganizationAdminRole.ADMIN : OrganizationAdminRole.MODERATOR;

		// Create the role
		const newRole = await prisma.organizationAdmin.create({
			data: {
				userId: targetUser.id,
				organizationId: organizationId,
				domainId: domain_id ? parseInt(domain_id) : null,
				role: roleValue,
				isActive: true,
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				domain: true,
			},
		});

		const roleName = roleValue === OrganizationAdminRole.ADMIN ? "Administrator" : "Moderator";

		return c.json({
			detail: `Successfully assigned ${roleName} role to ${targetUser.username}`,
			role: {
				id: newRole.id,
				user: newRole.user,
				role: newRole.role,
				domain: newRole.domain,
				is_active: newRole.isActive,
				created: newRole.created,
			},
		}, 201);
	} catch (error) {
		console.error("Error adding organization role:", error);
		return c.json({ detail: "Failed to add role" }, 500);
	}
}

// Update a user's role in an organization
export async function updateOrganizationRole(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));
		const currentUserId = c.get("userId");

		if (!currentUserId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Get request body
		const body = await c.req.json();
		const { role_id, role, domain_id } = body;

		if (!role_id) {
			return c.json({ detail: "Role ID is required" }, 400);
		}

		// Get the organization with admin info
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Check current user's permissions
		const isOrgOwner = organization.adminId === parseInt(currentUserId);
		const currentUserRole = await prisma.organizationAdmin.findFirst({
			where: {
				userId: parseInt(currentUserId),
				organizationId: organizationId,
				isActive: true,
			},
		});

		// Only organization owner or admins can update roles
		const isAdmin = currentUserRole?.role === OrganizationAdminRole.ADMIN;
		if (!isOrgOwner && !isAdmin) {
			return c.json({ detail: "Only administrators can manage roles" }, 403);
		}

		// Find the role to update
		const orgRole = await prisma.organizationAdmin.findFirst({
			where: {
				id: parseInt(role_id),
				organizationId: organizationId,
				isActive: true,
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
			},
		});

		if (!orgRole) {
			return c.json({ detail: "Role not found" }, 404);
		}

		// Prevent modifying own role
		if (orgRole.userId === parseInt(currentUserId)) {
			return c.json({ detail: "You cannot modify your own role" }, 400);
		}

		// Prevent modifying organization owner's role
		if (orgRole.userId === organization.adminId) {
			return c.json({ detail: "Cannot modify the organization owner's role" }, 400);
		}

		// Validate domain if provided
		let domainIdToSet: number | null = orgRole.domainId;
		if (domain_id !== undefined) {
			if (domain_id === "" || domain_id === null) {
				domainIdToSet = null;
			} else {
				const domain = await prisma.domain.findFirst({
					where: {
						id: parseInt(domain_id),
						organizationId: organizationId,
					},
				});

				if (!domain) {
					return c.json({ detail: "Domain not found in this organization" }, 404);
				}
				domainIdToSet = parseInt(domain_id);
			}
		}

		// Parse role if provided
		let roleValue = orgRole.role;
		if (role !== undefined && role !== null) {
			roleValue = role === "0" || role === 0 ? OrganizationAdminRole.ADMIN : OrganizationAdminRole.MODERATOR;
		}

		// Update the role
		const updatedRole = await prisma.organizationAdmin.update({
			where: {
				id: parseInt(role_id),
			},
			data: {
				role: roleValue,
				domainId: domainIdToSet,
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				domain: true,
			},
		});

		return c.json({
			detail: `Successfully updated role for ${updatedRole.user.username}`,
			role: {
				id: updatedRole.id,
				user: updatedRole.user,
				role: updatedRole.role,
				domain: updatedRole.domain,
				is_active: updatedRole.isActive,
				created: updatedRole.created,
			},
		});
	} catch (error) {
		console.error("Error updating organization role:", error);
		return c.json({ detail: "Failed to update role" }, 500);
	}
}

// Remove a user's role from an organization
export async function removeOrganizationRole(c: OrganizationContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));
		const currentUserId = c.get("userId");

		if (!currentUserId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Get request body
		const body = await c.req.json();
		const { role_id } = body;

		if (!role_id) {
			return c.json({ detail: "Role ID is required" }, 400);
		}

		// Get the organization with admin info
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
		});

		if (!organization) {
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Check current user's permissions
		const isOrgOwner = organization.adminId === parseInt(currentUserId);
		const currentUserRole = await prisma.organizationAdmin.findFirst({
			where: {
				userId: parseInt(currentUserId),
				organizationId: organizationId,
				isActive: true,
			},
		});

		// Only organization owner or admins can remove roles
		const isAdmin = currentUserRole?.role === OrganizationAdminRole.ADMIN;
		if (!isOrgOwner && !isAdmin) {
			return c.json({ detail: "Only administrators can manage roles" }, 403);
		}

		// Find the role to remove
		const orgRole = await prisma.organizationAdmin.findFirst({
			where: {
				id: parseInt(role_id),
				organizationId: organizationId,
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
			},
		});

		if (!orgRole) {
			return c.json({ detail: "Role not found" }, 404);
		}

		// Prevent removing own role
		if (orgRole.userId === parseInt(currentUserId)) {
			return c.json({ detail: "You cannot remove your own role" }, 400);
		}

		// Prevent removing organization owner's role
		if (orgRole.userId === organization.adminId) {
			return c.json({ detail: "Cannot remove the organization owner's role" }, 400);
		}

		// Deactivate the role instead of deleting
		await prisma.organizationAdmin.update({
			where: {
				id: parseInt(role_id),
			},
			data: {
				isActive: false,
			},
		});

		return c.json({
			detail: `Successfully removed role from ${orgRole.user.username}`,
		});
	} catch (error) {
		console.error("Error removing organization role:", error);
		return c.json({ detail: "Failed to remove role" }, 500);
	}
}

// Create a new organization
export async function createOrganization(c: OrganizationContext) {
	try {
		const currentUserId = c.get("userId");

		if (!currentUserId) {
			return c.json({ detail: "Authentication required" }, 401);
		}

		// Get current user to check if active
		const user = await prisma.user.findUnique({
			where: { id: parseInt(currentUserId) },
		});

		if (!user) {
			return c.json({ detail: "User not found" }, 404);
		}

		if (!user.isActive) {
			return c.json({ detail: "Email not verified" }, 403);
		}

		// Parse multipart form data
		const formData = await c.req.formData();
		const organizationName = formData.get("organization_name") as string;
		const organizationUrl = formData.get("organization_url") as string;
		const supportEmail = formData.get("support_email") as string;
		const twitterUrl = formData.get("twitter_url") as string;
		const facebookUrl = formData.get("facebook_url") as string;
		const managerEmails = formData.get("email") as string; // Comma-separated emails
		const logoFile = formData.get("logo") as File | null;

		// Validate required fields
		if (!organizationName || organizationName.trim() === "") {
			return c.json({ detail: "Organization name is required" }, 400);
		}

		if (!organizationUrl || organizationUrl.trim() === "") {
			return c.json({ detail: "Organization URL is required" }, 400);
		}

		// Check if organization with same name already exists
		const existingByName = await prisma.organization.findFirst({
			where: { name: organizationName },
		});

		if (existingByName) {
			return c.json({ detail: "Organization name already exists" }, 400);
		}

		// Check if organization with same URL already exists
		const existingByUrl = await prisma.organization.findFirst({
			where: { url: organizationUrl },
		});

		if (existingByUrl) {
			return c.json({ detail: "Organization URL already exists" }, 400);
		}

		// Generate slug from organization name
		let slug = generateSlug(organizationName);
		
		// Ensure slug is unique
		let slugExists = await prisma.organization.findUnique({
			where: { slug },
		});

		let counter = 1;
		while (slugExists) {
			slug = `${generateSlug(organizationName)}-${counter}`;
			slugExists = await prisma.organization.findUnique({
				where: { slug },
			});
			counter++;
		}

		// Handle logo upload if provided
		let logoPath: string | null = null;
		if (logoFile && logoFile.size > 0) {
			// Validate the image
			const validation = validateImage(logoFile);
			if (!validation.valid) {
				return c.json({ detail: validation.error }, 400);
			}

			// Generate unique filename
			const uniqueFilename = generateUniqueFilename(logoFile.name);
			const key = `organization_logos/${uniqueFilename}`;

			// Upload to R2 bucket
			const bucket = c.env.BLT_BUCKET;
			if (!bucket) {
				return c.json({ detail: "File storage not configured" }, 500);
			}

			try {
				await uploadToR2(bucket, key, logoFile);
				logoPath = key;
			} catch (uploadError) {
				console.error("Error uploading logo:", uploadError);
				return c.json({ detail: "Failed to upload logo" }, 500);
			}
		}

		// Find managers by email
		const managers: number[] = [];
		if (managerEmails && managerEmails.trim() !== "") {
			const emailList = managerEmails.split(",").map((e) => e.trim()).filter((e) => e !== "");
			
			if (emailList.length > 0) {
				const foundManagers = await prisma.user.findMany({
					where: {
						email: { in: emailList },
						isActive: true,
					},
					select: { id: true },
				});
				managers.push(...foundManagers.map((m) => m.id));
			}
		}

		// Create the organization
		const organization = await prisma.organization.create({
			data: {
				adminId: parseInt(currentUserId),
				name: organizationName,
				slug: slug,
				url: organizationUrl,
				email: supportEmail || null,
				twitter: twitterUrl || null,
				facebook: facebookUrl || null,
				logo: logoPath,
				isActive: true,
			},
			include: {
				admin: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
			},
		});

		// Assign managers if any
		if (managers.length > 0) {
			await prisma.organization.update({
				where: { id: organization.id },
				data: {
					managers: {
						connect: managers.map((id) => ({ id })),
					},
				},
			});
		}

		return c.json(
			{
				detail: "Organization registered successfully",
				organization: {
					id: organization.id,
					name: organization.name,
					slug: organization.slug,
					url: organization.url,
					email: organization.email,
					twitter: organization.twitter,
					facebook: organization.facebook,
					logo: organization.logo,
					is_active: organization.isActive,
					admin: organization.admin,
					created: organization.created,
				},
			},
			201
		);
	} catch (error) {
		console.error("Error creating organization:", error);
		return c.json({ detail: "Failed to create organization" }, 500);
	}
}


