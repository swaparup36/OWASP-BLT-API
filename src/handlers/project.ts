import { Context } from "hono";
import prisma from "../utils/db";

// Helper function to format contributor data
function formatContributor(contributor: any) {
	return {
		id: contributor.id,
		name: contributor.name,
		github_id: contributor.githubId,
		github_url: contributor.githubUrl,
		avatar_url: contributor.avatarUrl,
		contributor_type: contributor.contributorType,
		contributions: contributor.contributions,
		created: contributor.created,
	};
}

// Helper function to format project data
function formatProject(project: any) {
	return {
		id: project.id,
		name: project.name,
		slug: project.slug,
		description: project.description,
		status: project.status,
		url: project.url,
		twitter: project.twitter,
		slack: project.slack,
		slack_channel: project.slackChannel,
		slack_id: project.slackId,
		facebook: project.facebook,
		logo: project.logo,
		project_visit_count: project.projectVisitCount,
		organization_id: project.organizationId,
		created: project.created,
		modified: project.modified,
	};
}

// Helper function to generate slug from name
function slugify(text: string): string {
	return text
		.toString()
		.toLowerCase()
		.trim()
		.replace(/\s+/g, "-")
		.replace(/[^\w\-]+/g, "")
		.replace(/\-\-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
}

// Helper function to get contributors from GitHub URL
async function getContributorsFromGithubUrl(githubUrl: string): Promise<number[]> {
	try {
		// Expected format: https://github.com/owner/repo
		const urlParts = githubUrl.replace(/\/$/, "").split("/");
		const repoName = urlParts[urlParts.length - 1];
		const owner = urlParts[urlParts.length - 2];

		if (!owner || !repoName) {
			console.error("Invalid GitHub URL format:", githubUrl);
			return [];
		}

		const repo = await prisma.repo.findFirst({
			where: {
				OR: [
					{ repoUrl: githubUrl },
					{ repoUrl: `${githubUrl}.git` },
					{ name: repoName },
				],
			},
			include: {
				contributors: {
					select: {
						id: true,
					},
				},
			},
		});

		if (repo && repo.contributors) {
			return repo.contributors.map((c) => c.id);
		}

		return [];
	} catch (error) {
		console.error("Error fetching contributors from GitHub URL:", error);
		return [];
	}
}

// List all projects with contributors
export async function listProjects(c: Context) {
	try {
		const projects = await prisma.project.findMany({
			include: {
				organization: {
					select: {
						id: true,
						name: true,
					},
				},
				repositories: {
					include: {
						contributors: {
							orderBy: {
								contributions: "desc",
							},
						},
					},
				},
			},
			orderBy: {
				created: "desc",
			},
		});

		const projectData = projects.map((project) => {
			const formattedProject = formatProject(project);

			// Aggregate contributors from all repositories
			const contributorsMap = new Map();
			project.repositories.forEach((repo) => {
				repo.contributors.forEach((contributor) => {
					if (!contributorsMap.has(contributor.id)) {
						contributorsMap.set(contributor.id, contributor);
					}
				});
			});

			const contributors = Array.from(contributorsMap.values())
				.map(formatContributor)
				.sort((a, b) => b.contributions - a.contributions);

			return {
				...formattedProject,
				contributors,
			};
		});

		return c.json({
			count: projectData.length,
			projects: projectData,
		});
	} catch (error) {
		console.error("Error listing projects:", error);
		return c.json({ error: "Failed to retrieve projects" }, 500);
	}
}

// Create a new project
export async function createProject(c: Context) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const body = await c.req.json();
		const { name, description, url, github_url, organization_id, twitter, slack, slack_channel, facebook, logo } =
			body;

		if (!name) {
			return c.json({ error: "Project name is required" }, 400);
		}

		const slug = slugify(name);

		// Check if project with this slug already exists
		const existingProject = await prisma.project.findFirst({
			where: {
				OR: [{ name }, { url: url || undefined }],
			},
		});

		if (existingProject) {
			return c.json({ error: "Project with this name or URL already exists" }, 400);
		}

		// Get contributors from GitHub URL if provided
		let contributorIds: number[] = [];
		if (github_url) {
			contributorIds = await getContributorsFromGithubUrl(github_url);
		}

		// Create the project
		const project = await prisma.project.create({
			data: {
				name,
				description: description || null,
				url: url || null,
				organizationId: organization_id ? parseInt(organization_id) : null,
				twitter: twitter || null,
				slack: slack || null,
				slackChannel: slack_channel || null,
				facebook: facebook || null,
				logo: logo || null,
			},
			include: {
				organization: {
					select: {
						id: true,
						name: true,
					},
				},
				repositories: {
					include: {
						contributors: {
							orderBy: {
								contributions: "desc",
							},
						},
					},
				},
			},
		});

		// If we have a GitHub UR - try to create/link a repository
		if (github_url) {
			try {
				const urlParts = github_url.replace(/\/$/, "").split("/");
				const repoName = urlParts[urlParts.length - 1];

				// Check if repo already exists
				let repo = await prisma.repo.findFirst({
					where: {
						OR: [{ repoUrl: github_url }, { repoUrl: `${github_url}.git` }],
					},
				});

				if (repo) {
					// Link existing repo to project
					await prisma.repo.update({
						where: { id: repo.id },
						data: { projectId: project.id },
					});
				}
			} catch (repoError) {
				console.error("Error linking repository:", repoError);
			}
		}

		// Fetch the complete project with contributors
		const completeProject = await prisma.project.findUnique({
			where: { id: project.id },
			include: {
				organization: {
					select: {
						id: true,
						name: true,
					},
				},
				repositories: {
					include: {
						contributors: {
							orderBy: {
								contributions: "desc",
							},
						},
					},
				},
			},
		});

		if (!completeProject) {
			return c.json({ error: "Failed to retrieve created project" }, 500);
		}

		const formattedProject = formatProject(completeProject);

		// Aggregate contributors from all repositories
		const contributorsMap = new Map();
		completeProject.repositories.forEach((repo) => {
			repo.contributors.forEach((contributor) => {
				if (!contributorsMap.has(contributor.id)) {
					contributorsMap.set(contributor.id, contributor);
				}
			});
		});

		const contributors = Array.from(contributorsMap.values())
			.map(formatContributor)
			.sort((a, b) => b.contributions - a.contributions);

		return c.json(
			{
				...formattedProject,
				contributors,
			},
			201
		);
	} catch (error) {
		console.error("Error creating project:", error);
		return c.json({ error: "Failed to create project" }, 500);
	}
}

// Search projects
export async function searchProjects(c: Context) {
	try {
		const url = new URL(c.req.url);
		const query = url.searchParams.get("q") || "";

		if (!query) {
			return c.json({ error: "Search query parameter 'q' is required" }, 400);
		}

		const projects = await prisma.project.findMany({
			where: {
				OR: [
					{ name: { contains: query, mode: "insensitive" } },
					{ description: { contains: query, mode: "insensitive" } },
					{ url: { contains: query, mode: "insensitive" } },
					{
						repositories: {
							some: {
								OR: [
									{ name: { contains: query, mode: "insensitive" } },
									{ description: { contains: query, mode: "insensitive" } },
									{
										tags: {
											some: {
												name: { contains: query, mode: "insensitive" },
											},
										},
									},
								],
							},
						},
					},
				],
			},
			include: {
				organization: {
					select: {
						id: true,
						name: true,
					},
				},
				repositories: {
					include: {
						contributors: {
							orderBy: {
								contributions: "desc",
							},
						},
					},
				},
			},
			orderBy: {
				created: "desc",
			},
		});

		const projectData = projects.map((project) => {
			const formattedProject = formatProject(project);

			// Aggregate contributors from all repositories
			const contributorsMap = new Map();
			project.repositories.forEach((repo) => {
				repo.contributors.forEach((contributor) => {
					if (!contributorsMap.has(contributor.id)) {
						contributorsMap.set(contributor.id, contributor);
					}
				});
			});

			const contributors = Array.from(contributorsMap.values())
				.map(formatContributor)
				.sort((a, b) => b.contributions - a.contributions);

			return {
				...formattedProject,
				contributors,
			};
		});

		return c.json({
			count: projectData.length,
			projects: projectData,
		});
	} catch (error) {
		console.error("Error searching projects:", error);
		return c.json({ error: "Failed to search projects" }, 500);
	}
}

// Filter projects
export async function filterProjects(c: Context) {
	try {
		const url = new URL(c.req.url);
		const freshness = url.searchParams.get("freshness");
		const stars = url.searchParams.get("stars");
		const forks = url.searchParams.get("forks");
		const tags = url.searchParams.get("tags");

		const where: any = {};

		// Build repository filters
		const repoFilters: any = {};

		if (stars) {
			repoFilters.stars = { gte: parseInt(stars) };
		}

		if (forks) {
			repoFilters.forks = { gte: parseInt(forks) };
		}

		if (freshness) {
			// Freshness could be based on last commit date or modified date
			const now = new Date();
			let dateThreshold: Date;

			switch (freshness.toLowerCase()) {
				case "daily":
					dateThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);
					break;
				case "weekly":
					dateThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
					break;
				case "monthly":
					dateThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
					break;
				default:
					dateThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
			}

			repoFilters.OR = [{ lastCommitDate: { gte: dateThreshold } }, { modified: { gte: dateThreshold } }];
		}

		if (tags) {
			const tagList = tags.split(",").map((tag) => tag.trim());
			repoFilters.tags = {
				some: {
					name: { in: tagList },
				},
			};
		}

		// Apply repository filters if any exist
		if (Object.keys(repoFilters).length > 0) {
			where.repositories = {
				some: repoFilters,
			};
		}

		const projects = await prisma.project.findMany({
			where,
			include: {
				organization: {
					select: {
						id: true,
						name: true,
					},
				},
				repositories: {
					include: {
						contributors: {
							orderBy: {
								contributions: "desc",
							},
						},
					},
				},
			},
			orderBy: {
				created: "desc",
			},
		});

		const projectData = projects.map((project) => {
			const formattedProject = formatProject(project);

			// Aggregate contributors from all repositories
			const contributorsMap = new Map();
			project.repositories.forEach((repo) => {
				repo.contributors.forEach((contributor) => {
					if (!contributorsMap.has(contributor.id)) {
						contributorsMap.set(contributor.id, contributor);
					}
				});
			});

			const contributors = Array.from(contributorsMap.values())
				.map(formatContributor)
				.sort((a, b) => b.contributions - a.contributions);

			return {
				...formattedProject,
				contributors,
			};
		});

		return c.json({
			count: projectData.length,
			projects: projectData,
		});
	} catch (error) {
		console.error("Error filtering projects:", error);
		return c.json({ error: "Failed to filter projects" }, 500);
	}
}
