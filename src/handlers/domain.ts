import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type DomainContext = Context<AppEnv>;

// Format domain data for response
function formatDomainResponse(domain: any) {
	return {
		id: domain.id,
		organization_id: domain.organizationId,
		name: domain.name,
		url: domain.url,
		logo: domain.logo,
		webshot: domain.webshot,
		clicks: domain.clicks,
		email_event: domain.emailEvent,
		color: domain.color,
		github: domain.github,
		email: domain.email,
		twitter: domain.twitter,
		facebook: domain.facebook,
		created: domain.created,
		modified: domain.modified,
		is_active: domain.isActive,
		has_security_txt: domain.hasSecurityTxt,
		security_txt_checked_at: domain.securityTxtCheckedAt,
	};
}

// List all domains with search filtering and pagination
export async function listDomains(c: DomainContext) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		const searchQuery = searchParams.get("search");
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("page_size") || "10");

		const where: any = {};

		if (searchQuery) {
			where.OR = [
				{ url: { contains: searchQuery, mode: "insensitive" } },
				{ name: { contains: searchQuery, mode: "insensitive" } },
			];
		}

        // Pagination and fetching domains
		const totalCount = await prisma.domain.count({ where });
		const domains = await prisma.domain.findMany({
			where,
			skip: (page - 1) * pageSize,
			take: pageSize,
			orderBy: {
				created: "desc",
			},
		});


		const formattedDomains = domains.map(formatDomainResponse);

		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		return c.json({
			count: totalCount,
			next: hasNext ? `${url.pathname}?page=${page + 1}&page_size=${pageSize}` : null,
			previous: hasPrevious ? `${url.pathname}?page=${page - 1}&page_size=${pageSize}` : null,
			results: formattedDomains,
		});
	} catch (error) {
		console.error("Error listing domains:", error);
		return c.json({ error: "Failed to retrieve domains" }, 500);
	}
}

// Retrieve a single domain by ID
export async function retrieveDomain(c: DomainContext) {
	try {
		const domainId = parseInt(c.req.param("id"));

		if (isNaN(domainId)) {
			return c.json({ error: "Invalid domain ID" }, 400);
		}

		const domain = await prisma.domain.findUnique({
			where: { id: domainId },
		});

		if (!domain) {
			return c.json({ error: "Domain not found" }, 404);
		}

		return c.json(formatDomainResponse(domain));
	} catch (error) {
		console.error("Error retrieving domain:", error);
		return c.json({ error: "Failed to retrieve domain" }, 500);
	}
}

// Create a new domain
export async function createDomain(c: DomainContext) {
	try {
		const body = await c.req.json();
		const { name, url, organization_id, logo, webshot, email_event, color, github, email, twitter, facebook } = body;

		if (!name || !url) {
			return c.json({ error: "Name and URL are required" }, 400);
		}

		const existingDomain = await prisma.domain.findUnique({
			where: { name },
		});

		if (existingDomain) {
			return c.json({ error: "Domain with this name already exists" }, 400);
		}

		// Create the domain
		const domain = await prisma.domain.create({
			data: {
				name,
				url,
				organizationId: organization_id ? parseInt(organization_id) : undefined,
				logo,
				webshot,
				emailEvent: email_event,
				color,
				github,
				email,
				twitter,
				facebook,
			},
		});

		return c.json(formatDomainResponse(domain), 201);
	} catch (error) {
		console.error("Error creating domain:", error);
		return c.json({ error: "Failed to create domain" }, 500);
	}
}

// HEAD request to check domain availability
export async function headDomains(c: DomainContext) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		const searchQuery = searchParams.get("search");

		const where: any = {};

		if (searchQuery) {
			where.OR = [
				{ url: { contains: searchQuery, mode: "insensitive" } },
				{ name: { contains: searchQuery, mode: "insensitive" } },
			];
		}

		const totalCount = await prisma.domain.count({ where });

		return c.body(null, 200, {
			"X-Total-Count": totalCount.toString(),
		});
	} catch (error) {
		console.error("Error in HEAD domains:", error);
		return c.body(null, 500);
	}
}
