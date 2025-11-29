import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId: string;
	};
};

type DomainSecurityContext = Context<AppEnv>;

// Check if a domain has a security.txt file (Checks both /.well-known/security.txt and /security.txt)
async function checkSecurityTxt(domainUrl: string): Promise<boolean> {
	const urls = [
		`https://${domainUrl}/.well-known/security.txt`,
		`https://${domainUrl}/security.txt`,
		`http://${domainUrl}/.well-known/security.txt`,
		`http://${domainUrl}/security.txt`,
	];

	for (const url of urls) {
		try {
			const response = await fetch(url, {
				method: "GET",
				signal: AbortSignal.timeout(5000), // 5 second timeout
			});

			if (response.ok) {
				return true;
			}
		} catch (error) {
			// Continue to next URL
			continue;
		}
	}

	return false;
}

// Check domain security.txt status (Requires authentication)
export async function checkDomainSecurityTxt(c: DomainSecurityContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const domainId = parseInt(c.req.param("id"));

		if (isNaN(domainId)) {
			return c.json({ error: "Invalid domain ID" }, 400);
		}

		// Fetch domain with related organization and managers
		const domain = await prisma.domain.findUnique({
			where: { id: domainId },
			include: {
				organization: {
					include: {
						admin: true,
						admins: {
							where: {
								isActive: true,
							},
							include: {
								user: true,
							},
						},
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
			return c.json({ error: "Domain not found" }, 404);
		}

		// Check if the user has permission to manage this domain
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
		});

		if (!user) {
			return c.json({ error: "User not found" }, 401);
		}

		let hasPermission = false;

		// Check if user is superuser
		if (user.isSuperuser) {
			hasPermission = true;
		}
		// Check if user is organization admin or manager
		else if (domain.organization) {
			// Check if user is the organization admin
			if (domain.organization.adminId === parseInt(userId)) {
				hasPermission = true;
			}
			// Check if user is an organization admin/moderator
			else if (
				domain.organization.admins.some(
					(admin) => admin.userId === parseInt(userId) && admin.isActive
				)
			) {
				hasPermission = true;
			}
		}
		// Check if user is a domain manager
		if (!hasPermission && domain.managers.some((manager) => manager.id === parseInt(userId))) {
			hasPermission = true;
		}

		if (!hasPermission) {
			return c.json({ error: "You don't have permission to check this domain" }, 403);
		}

		// Check for security.txt
		const hasSecurityTxt = await checkSecurityTxt(domain.url);

		// Update domain with status
		const updatedDomain = await prisma.domain.update({
			where: { id: domainId },
			data: {
				hasSecurityTxt: hasSecurityTxt,
				securityTxtCheckedAt: new Date(),
			},
		});

		return c.json(
			{
				message: hasSecurityTxt
					? `Security.txt found for ${domain.name}`
					: `No security.txt found for ${domain.name}`,
				domain: {
					id: updatedDomain.id,
					name: updatedDomain.name,
					url: updatedDomain.url,
					has_security_txt: updatedDomain.hasSecurityTxt,
					security_txt_checked_at: updatedDomain.securityTxtCheckedAt,
				},
			},
			200
		);
	} catch (error) {
		console.error("Error checking security.txt:", error);
		return c.json(
			{
				error: "Error checking security.txt",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			500
		);
	}
}
