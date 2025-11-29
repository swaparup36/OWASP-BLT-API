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
		let { name, url, organization_id, logo, webshot, email_event, color, github, email, twitter, facebook } = body;

		if (!name) {
			return c.json({ error: "Enter domain name" }, 400);
		}

		if (!url) {
			return c.json({ error: "Enter domain url" }, 400);
		}

		// Parse and validate URL
		let parsedUrl: URL;
		try {
			// Add protocol if missing
			const urlWithProtocol = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
			parsedUrl = new URL(urlWithProtocol);
			
			if (!parsedUrl.hostname) {
				return c.json({ error: "Invalid domain url" }, 400);
			}
			
			// Extract just the hostname (netloc)
			url = parsedUrl.hostname;
		} catch (error) {
			return c.json({ error: "Invalid domain url format" }, 400);
		}

		// Normalize domain: remove www. and convert to lowercase
		const normalizedDomain = parsedUrl.hostname.replace(/^www\./i, "").toLowerCase();
		
		// Ensure domain name is consistent with URL processing
		if (name.toLowerCase().replace(/^www\./i, "") === normalizedDomain) {
			name = normalizedDomain;
		} else {
			name = name.trim();
		}

		// Check if domain with this name OR url already exists
		const existingDomain = await prisma.domain.findFirst({
			where: {
				OR: [
					{ name: name },
					{ url: url },
				],
			},
		});

		if (existingDomain) {
			return c.json({ error: "Domain name or url already exist." }, 400);
		}

		// Validate domain URL by making HTTP request
		try {
			const domainUrl = `https://${url}`;
			const response = await fetch(domainUrl, {
				method: 'GET',
				signal: AbortSignal.timeout(5000), // 5 second timeout
			});
			
			if (!response.ok) {
				return c.json({ error: "Domain does not exist." }, 400);
			}
		} catch (error) {
			return c.json({ error: "Domain does not exist." }, 400);
		}

		// Validate social media URLs
		if (facebook && !facebook.includes("facebook.com")) {
			return c.json({ error: "Facebook url should contain facebook.com" }, 400);
		}

		if (twitter && !twitter.includes("twitter.com") && !twitter.includes("x.com")) {
			return c.json({ error: "Twitter url should contain twitter.com or x.com" }, 400);
		}

		if (github && !github.includes("github.com")) {
			return c.json({ error: "Github url should contain github.com" }, 400);
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

// Update an existing domain
export async function updateDomain(c: DomainContext) {
	try {
		const domainId = parseInt(c.req.param("id"));

		if (isNaN(domainId)) {
			return c.json({ error: "Invalid domain ID" }, 400);
		}

		// Check if domain exists
		const existingDomain = await prisma.domain.findUnique({
			where: { id: domainId },
		});

		if (!existingDomain) {
			return c.json({ error: "Domain not found" }, 404);
		}

		const body = await c.req.json();
		let { name, url, organization_id, logo, webshot, email_event, color, github, email, twitter, facebook } = body;

		if (!name) {
			return c.json({ error: "Enter domain name" }, 400);
		}

		if (!url) {
			return c.json({ error: "Enter domain url" }, 400);
		}

		// Parse and validate URL
		let parsedUrl: URL;
		try {
			// Add protocol if missing
			const urlWithProtocol = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
			parsedUrl = new URL(urlWithProtocol);
			
			if (!parsedUrl.hostname) {
				return c.json({ error: "Invalid domain url" }, 400);
			}
			
			// Extract just the hostname (netloc)
			url = parsedUrl.hostname;
		} catch (error) {
			return c.json({ error: "Invalid domain url format" }, 400);
		}

		// Normalize domain: remove www. and convert to lowercase
		const normalizedDomain = parsedUrl.hostname.replace(/^www\./i, "").toLowerCase();
		
		// Normalize the provided name to lowercase
		name = name.toLowerCase();

		// Check if domain with this name OR url already exists (excluding current domain)
		const duplicateDomain = await prisma.domain.findFirst({
			where: {
				OR: [
					{ name: name },
					{ url: url },
				],
				NOT: {
					id: domainId,
				},
			},
		});

		if (duplicateDomain) {
			return c.json({ error: "Domain name or url already exist." }, 400);
		}

		// Validate domain URL by making HTTP request
		try {
			const domainUrl = `https://${url}`;
			const response = await fetch(domainUrl, {
				method: 'GET',
				signal: AbortSignal.timeout(5000), // 5 second timeout
			});
			
			if (!response.ok) {
				return c.json({ error: "Domain does not exist." }, 400);
			}
		} catch (error) {
			return c.json({ error: "Domain does not exist." }, 400);
		}

		// Validate social media URLs
		if (facebook && !facebook.includes("facebook.com")) {
			return c.json({ error: "Facebook url should contain facebook.com" }, 400);
		}

		if (twitter && !twitter.includes("twitter.com") && !twitter.includes("x.com")) {
			return c.json({ error: "Twitter url should contain twitter.com or x.com" }, 400);
		}

		if (github && !github.includes("github.com")) {
			return c.json({ error: "Github url should contain github.com" }, 400);
		}

		// Update the domain
		const updatedDomain = await prisma.domain.update({
			where: { id: domainId },
			data: {
				name,
				url,
				organizationId: organization_id ? parseInt(organization_id) : existingDomain.organizationId,
				logo: logo !== undefined ? logo : existingDomain.logo,
				webshot: webshot !== undefined ? webshot : existingDomain.webshot,
				emailEvent: email_event !== undefined ? email_event : existingDomain.emailEvent,
				color: color !== undefined ? color : existingDomain.color,
				github: github !== undefined ? github : existingDomain.github,
				email: email !== undefined ? email : existingDomain.email,
				twitter: twitter !== undefined ? twitter : existingDomain.twitter,
				facebook: facebook !== undefined ? facebook : existingDomain.facebook,
			},
		});

		return c.json(formatDomainResponse(updatedDomain), 200);
	} catch (error) {
		console.error("Error updating domain:", error);
		return c.json({ error: "Failed to update domain" }, 500);
	}
}

// Delete a domain
export async function deleteDomain(c: DomainContext) {
	try {
		const domainId = parseInt(c.req.param("id"));

		if (isNaN(domainId)) {
			return c.json({ error: "Invalid domain ID" }, 400);
		}

		// Check if domain exists
		const domain = await prisma.domain.findUnique({
			where: { id: domainId },
		});

		if (!domain) {
			return c.json({ error: "Domain not found" }, 404);
		}

		// Delete the domain
		await prisma.domain.delete({
			where: { id: domainId },
		});

		return c.json({ message: "Domain deleted successfully" }, 200);
	} catch (error) {
		console.error("Error deleting domain:", error);
		return c.json({ error: "Failed to delete domain" }, 500);
	}
}

// Delete a manager from a domain
export async function deleteManager(c: DomainContext) {
	try {
		const domainId = parseInt(c.req.param("domain_id"));
		const managerId = parseInt(c.req.param("manager_id"));
		const userId = c.get("userId");

		if (isNaN(domainId)) {
			return c.json({ success: false, message: "Invalid domain ID" }, 400);
		}

		if (isNaN(managerId)) {
			return c.json({ success: false, message: "Invalid manager ID" }, 400);
		}

		if (!userId) {
			return c.json({ success: false, message: "Authentication required" }, 401);
		}

		// Fetch the domain with its organization and managers
		const domain = await prisma.domain.findUnique({
			where: { id: domainId },
			include: {
				organization: {
					select: {
						adminId: true,
					},
				},
				managers: {
					select: {
						id: true,
					},
				},
			},
		});

		if (!domain) {
			return c.json({ success: false, message: "Domain not found." }, 404);
		}

		// Check if the user exists
		const manager = await prisma.user.findUnique({
			where: { id: managerId },
		});

		if (!manager) {
			return c.json({ success: false, message: "User not found." }, 404);
		}

		// Check if the request user is the organization admin
		if (!domain.organization || domain.organization.adminId !== parseInt(userId)) {
			return c.json(
				{
					success: false,
					message: "You do not have permission to delete this manager.",
				},
				403
			);
		}

		// Check if the manager is in the domain's managers list
		const isManager = domain.managers.some((m) => m.id === managerId);

		if (!isManager) {
			return c.json({ success: false, message: "Manager not found in domain." }, 404);
		}

		// Remove the manager from the domain
		await prisma.domain.update({
			where: { id: domainId },
			data: {
				managers: {
					disconnect: { id: managerId },
				},
			},
		});

		return c.json({ success: true }, 200);
	} catch (error) {
		console.error("Error deleting manager:", error);
		return c.json({ success: false, message: "Failed to delete manager" }, 500);
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
