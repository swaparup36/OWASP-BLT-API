import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type OrganizationContext = Context<AppEnv>;

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
