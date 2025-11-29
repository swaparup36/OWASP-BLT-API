import { MiddlewareHandler } from "hono";
import prisma from "../utils/db";

type OrganizationVariables = { 
	userId: string;
	organizationId: number;
	isOrganizationAdmin: boolean;
	isOrganizationManager: boolean;
};

// Middleware to validate if user is an organization admin or manager
export const validateOrganizationUser: MiddlewareHandler<{
	Bindings: CloudflareBindings;
	Variables: OrganizationVariables;
}> = async (c, next) => {
	const userId = c.get("userId");
	const organizationIdParam = c.req.param("id");

	if (!userId) {
		return c.json({ error: "Authentication required" }, 401);
	}

	if (!organizationIdParam) {
		return c.json({ error: "Organization ID is required" }, 400);
	}

	const organizationId = parseInt(organizationIdParam);

	if (isNaN(organizationId)) {
		return c.json({ error: "Invalid organization ID" }, 400);
	}

	// Check if organization exists and get managers
	const organization = await prisma.organization.findUnique({
		where: { id: organizationId },
		include: {
			managers: {
				select: {
					id: true,
				},
			},
		},
	});

	if (!organization) {
		return c.json({ error: "Organization not found" }, 404);
	}

	// Check if user is an admin (from adminId or managers list)
	const isAdmin = organization.adminId === parseInt(userId);

	// Check if user is in the managers list
	const managerIds = organization.managers.map((m) => m.id);
	const isManager = managerIds.includes(parseInt(userId));

	// Check if user is an OrganizationAdmin
	const organizationAdmin = await prisma.organizationAdmin.findFirst({
		where: {
			organizationId: organizationId,
			userId: parseInt(userId),
			isActive: true,
		},
	});

	const isOrganizationAdmin = !!organizationAdmin || isAdmin;
	const isOrganizationManager = isManager || isOrganizationAdmin;

	if (!isOrganizationAdmin && !isOrganizationManager) {
		return c.json({ error: "You do not have permission to access this organization" }, 403);
	}

	// Set variables for use in handlers
	c.set("organizationId", organizationId);
	c.set("isOrganizationAdmin", isOrganizationAdmin);
	c.set("isOrganizationManager", isOrganizationManager);

	await next();
};
