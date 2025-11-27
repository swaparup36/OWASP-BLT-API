import { Context } from "hono";
import prisma from "../utils/db";

type TimeLogContext = Context<{
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
}>;

// Helper function to get timelog with relations
async function getTimeLogWithRelations(timelogId: number) {
	return await prisma.timeLog.findUnique({
		where: { id: timelogId },
		include: {
			user: {
				select: {
					id: true,
					username: true,
					email: true,
				},
			},
			organization: {
				select: {
					id: true,
					name: true,
					url: true,
				},
			},
		},
	});
}

// Format timelog data for response
function formatTimeLogResponse(timelog: any) {
	return {
		id: timelog.id,
		user_id: timelog.userId,
		organization_id: timelog.organizationId,
		user: timelog.user
			? {
					id: timelog.user.id,
					username: timelog.user.username,
					email: timelog.user.email,
			  }
			: null,
		organization: timelog.organization
			? {
					id: timelog.organization.id,
					name: timelog.organization.name,
					url: timelog.organization.url,
			  }
			: null,
		start_time: timelog.startTime,
		end_time: timelog.endTime,
		duration: timelog.duration,
		github_issue_url: timelog.githubIssueUrl,
		created: timelog.created,
	};
}

// List all timelogs with filtering and pagination
export async function listTimeLogs(c: TimeLogContext) {
	try {
		const userId = c.get("userId");
		
		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("page_size") || "10");

		const where = {
			userId: parseInt(userId),
		};

		const totalCount = await prisma.timeLog.count({ where });
		const timelogs = await prisma.timeLog.findMany({
			where,
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				organization: {
					select: {
						id: true,
						name: true,
						url: true,
					},
				},
			},
			skip: (page - 1) * pageSize,
			take: pageSize,
			orderBy: {
				created: "desc",
			},
		});

		const formattedTimeLogs = timelogs.map((timelog) => formatTimeLogResponse(timelog));

        // Pagination
		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		return c.json({
			count: totalCount,
			next: hasNext ? `${url.pathname}?page=${page + 1}&page_size=${pageSize}` : null,
			previous: hasPrevious ? `${url.pathname}?page=${page - 1}&page_size=${pageSize}` : null,
			results: formattedTimeLogs,
		});
	} catch (error) {
		console.error("Error listing timelogs:", error);
		return c.json({ error: "Failed to retrieve timelogs" }, 500);
	}
}

// Retrieve a single timelog by ID
export async function retrieveTimeLog(c: TimeLogContext) {
	try {
		const userId = c.get("userId");
		
		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const timelogId = parseInt(c.req.param("id"));

		if (isNaN(timelogId)) {
			return c.json({ error: "Invalid timelog ID" }, 400);
		}

		const timelog = await getTimeLogWithRelations(timelogId);

		if (!timelog) {
			return c.json({ error: "Time log not found" }, 404);
		}

		if (timelog.userId !== parseInt(userId)) {
			return c.json({ error: "Time log not found" }, 404);
		}

		return c.json(formatTimeLogResponse(timelog));
	} catch (error) {
		console.error("Error retrieving timelog:", error);
		return c.json({ error: "Failed to retrieve timelog" }, 500);
	}
}

// Start a new time log
export async function startTimeLog(c: TimeLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const body = await c.req.json();
		const { organization_url, github_issue_url } = body;

		let organizationId: number | null = null;

		// If organization_url is provided - verify it exists
		if (organization_url) {
			try {
				// Parse and normalize the URL
				const parsedUrl = new URL(organization_url);
				const normalizedUrl = parsedUrl.hostname + parsedUrl.pathname;

				// Try to find the organization with various URL formats
				const organization = await prisma.organization.findFirst({
					where: {
						OR: [
							{ url: { equals: normalizedUrl, mode: "insensitive" } },
							{ url: { equals: `http://${normalizedUrl}`, mode: "insensitive" } },
							{ url: { equals: `https://${normalizedUrl}`, mode: "insensitive" } },
						],
					},
				});

				if (!organization) {
					return c.json(
						{ error: "Organization not found for the given URL." },
						400
					);
				}

				organizationId = organization.id;
			} catch (error) {
				return c.json({ error: "Invalid organization URL format" }, 400);
			}
		}

		// Create the timelog with start time set to now
		const timelog = await prisma.timeLog.create({
			data: {
				userId: parseInt(userId),
				startTime: new Date(),
				githubIssueUrl: github_issue_url || null,
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
				organization: {
					select: {
						id: true,
						name: true,
						url: true,
					},
				},
			},
		});

		return c.json(formatTimeLogResponse(timelog), 201);
	} catch (error) {
		console.error("Error starting time log:", error);
		return c.json(
			{ error: "An unexpected error occurred while starting the time log." },
			500
		);
	}
}

// Stop a time log and calculate duration
export async function stopTimeLog(c: TimeLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const timelogId = parseInt(c.req.param("id"));

		if (isNaN(timelogId)) {
			return c.json({ error: "Invalid timelog ID" }, 400);
		}

		const timelog = await prisma.timeLog.findUnique({
			where: { id: timelogId },
		});

		if (!timelog) {
			return c.json({ error: "Time log not found" }, 404);
		}

		// Check if user owns this timelog
		if (timelog.userId !== parseInt(userId)) {
			return c.json({ error: "Time log not found" }, 404);
		}

		// Check if timelog has a start time
		if (!timelog.startTime) {
			return c.json({ error: "Time log has no start time" }, 400);
		}

		// Check if already stopped
		if (timelog.endTime) {
			return c.json({ error: "Time log already stopped" }, 400);
		}

		const endTime = new Date();
		const duration = Math.floor(
			(endTime.getTime() - timelog.startTime.getTime()) / 1000
		); // in seconds

		// Update the timelog
		const updatedTimelog = await prisma.timeLog.update({
			where: { id: timelogId },
			data: {
				endTime: endTime,
				duration: duration,
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				organization: {
					select: {
						id: true,
						name: true,
						url: true,
					},
				},
			},
		});

		return c.json(formatTimeLogResponse(updatedTimelog), 200);
	} catch (error) {
		console.error("Error stopping time log:", error);
		return c.json(
			{ error: "An unexpected error occurred while stopping the time log." },
			500
		);
	}
}

// Create a new timelog (general create endpoint)
export async function createTimeLog(c: TimeLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const body = await c.req.json();
		const { start_time, end_time, duration, github_issue_url, organization_url } = body;

		let organizationId: number | null = null;

		// If organization_url is provided, verify it exists
		if (organization_url) {
			try {
				const parsedUrl = new URL(organization_url);
				const normalizedUrl = parsedUrl.hostname + parsedUrl.pathname;

				const organization = await prisma.organization.findFirst({
					where: {
						OR: [
							{ url: { equals: normalizedUrl, mode: "insensitive" } },
							{ url: { equals: `http://${normalizedUrl}`, mode: "insensitive" } },
							{ url: { equals: `https://${normalizedUrl}`, mode: "insensitive" } },
						],
					},
				});

				if (!organization) {
					return c.json(
						{ error: "Organization not found for the given URL." },
						400
					);
				}

				organizationId = organization.id;
			} catch (error) {
				return c.json({ error: "Invalid organization URL format" }, 400);
			}
		}

		// Create the timelog
		const timelog = await prisma.timeLog.create({
			data: {
				userId: parseInt(userId),
				startTime: start_time ? new Date(start_time) : null,
				endTime: end_time ? new Date(end_time) : null,
				duration: duration || null,
				githubIssueUrl: github_issue_url || null,
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
				organization: {
					select: {
						id: true,
						name: true,
						url: true,
					},
				},
			},
		});

		return c.json(formatTimeLogResponse(timelog), 201);
	} catch (error) {
		console.error("Error creating time log:", error);
		return c.json({ error: "Failed to create time log" }, 500);
	}
}

// Update an existing timelog
export async function updateTimeLog(c: TimeLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const timelogId = parseInt(c.req.param("id"));

		if (isNaN(timelogId)) {
			return c.json({ error: "Invalid timelog ID" }, 400);
		}

		// Find the timelog
		const existingTimelog = await prisma.timeLog.findUnique({
			where: { id: timelogId },
		});

		if (!existingTimelog) {
			return c.json({ error: "Time log not found" }, 404);
		}

		// Check if user owns this timelog
		if (existingTimelog.userId !== parseInt(userId)) {
			return c.json({ error: "Time log not found" }, 404);
		}

		const body = await c.req.json();
		const { start_time, end_time, duration, github_issue_url, organization_url } = body;

		let organizationId: number | null | undefined = undefined;

		// If organization_url is provided - verify it exists
		if (organization_url !== undefined) {
			if (organization_url === null) {
				organizationId = null;
			} else {
				try {
					const parsedUrl = new URL(organization_url);
					const normalizedUrl = parsedUrl.hostname + parsedUrl.pathname;

					const organization = await prisma.organization.findFirst({
						where: {
							OR: [
								{ url: { equals: normalizedUrl, mode: "insensitive" } },
								{ url: { equals: `http://${normalizedUrl}`, mode: "insensitive" } },
								{ url: { equals: `https://${normalizedUrl}`, mode: "insensitive" } },
							],
						},
					});

					if (!organization) {
						return c.json(
							{ error: "Organization not found for the given URL." },
							400
						);
					}

					organizationId = organization.id;
				} catch (error) {
					return c.json({ error: "Invalid organization URL format" }, 400);
				}
			}
		}

		// Update the timelog
		const updatedTimelog = await prisma.timeLog.update({
			where: { id: timelogId },
			data: {
				startTime: start_time ? new Date(start_time) : existingTimelog.startTime,
				endTime: end_time ? new Date(end_time) : existingTimelog.endTime,
				duration: duration !== undefined ? duration : existingTimelog.duration,
				githubIssueUrl: github_issue_url !== undefined ? github_issue_url : existingTimelog.githubIssueUrl,
				...(organizationId !== undefined && { organizationId }),
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				organization: {
					select: {
						id: true,
						name: true,
						url: true,
					},
				},
			},
		});

		return c.json(formatTimeLogResponse(updatedTimelog), 200);
	} catch (error) {
		console.error("Error updating time log:", error);
		return c.json({ error: "Failed to update time log" }, 500);
	}
}

// Delete a timelog
export async function deleteTimeLog(c: TimeLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const timelogId = parseInt(c.req.param("id"));

		if (isNaN(timelogId)) {
			return c.json({ error: "Invalid timelog ID" }, 400);
		}

		// Find the timelog
		const timelog = await prisma.timeLog.findUnique({
			where: { id: timelogId },
		});

		if (!timelog) {
			return c.json({ error: "Time log not found" }, 404);
		}

		// Check if user owns this timelog
		if (timelog.userId !== parseInt(userId)) {
			return c.json({ error: "Time log not found" }, 404);
		}

		// Delete the timelog
		await prisma.timeLog.delete({
			where: { id: timelogId },
		});

		return c.body(null, 204);
	} catch (error) {
		console.error("Error deleting time log:", error);
		return c.json({ error: "Failed to delete time log" }, 500);
	}
}
