import { Context } from "hono";
import prisma from "../utils/db";

type ActivityLogContext = Context<{
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
}>;

// Helper function to get activity log with relations
async function getActivityLogWithRelations(activityLogId: number) {
	return await prisma.activityLog.findUnique({
		where: { id: activityLogId },
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
}

// Format activity log data for response
function formatActivityLogResponse(activityLog: any) {
	return {
		id: activityLog.id,
		user_id: activityLog.userId,
		user: activityLog.user
			? {
					id: activityLog.user.id,
					username: activityLog.user.username,
					email: activityLog.user.email,
			  }
			: null,
		window_title: activityLog.window_title,
		url: activityLog.url,
		recorded_at: activityLog.recordedAt,
		created: activityLog.created,
	};
}

// List all activity logs with filtering and pagination
export async function listActivityLogs(c: ActivityLogContext) {
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

		const totalCount = await prisma.activityLog.count({ where });
		const activityLogs = await prisma.activityLog.findMany({
			where,
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
			},
			skip: (page - 1) * pageSize,
			take: pageSize,
			orderBy: {
				recordedAt: "desc",
			},
		});

		const formattedActivityLogs = activityLogs.map((activityLog) => formatActivityLogResponse(activityLog));

		// Pagination
		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		return c.json({
			count: totalCount,
			next: hasNext ? `${url.pathname}?page=${page + 1}&page_size=${pageSize}` : null,
			previous: hasPrevious ? `${url.pathname}?page=${page - 1}&page_size=${pageSize}` : null,
			results: formattedActivityLogs,
		});
	} catch (error) {
		console.error("Error listing activity logs:", error);
		return c.json({ error: "Failed to retrieve activity logs" }, 500);
	}
}

// Retrieve a single activity log by ID
export async function retrieveActivityLog(c: ActivityLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const activityLogId = parseInt(c.req.param("id"));

		if (isNaN(activityLogId)) {
			return c.json({ error: "Invalid activity log ID" }, 400);
		}

		const activityLog = await getActivityLogWithRelations(activityLogId);

		if (!activityLog) {
			return c.json({ error: "Activity log not found" }, 404);
		}

		if (activityLog.userId !== parseInt(userId)) {
			return c.json({ error: "Activity log not found" }, 404);
		}

		return c.json(formatActivityLogResponse(activityLog));
	} catch (error) {
		console.error("Error retrieving activity log:", error);
		return c.json({ error: "Failed to retrieve activity log" }, 500);
	}
}

// Create a new activity log
export async function createActivityLog(c: ActivityLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const body = await c.req.json();
		const { window_title, url } = body;

		if (!window_title || typeof window_title !== "string") {
			return c.json({ error: "window_title is required and must be a string" }, 400);
		}

		// Create the activity log with current timestamp as recorded_at
		const activityLog = await prisma.activityLog.create({
			data: {
				userId: parseInt(userId),
				window_title: window_title,
				url: url || null,
				recordedAt: new Date(),
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

		return c.json(formatActivityLogResponse(activityLog), 201);
	} catch (error) {
		console.error("Error creating activity log:", error);
		
		if (error instanceof Error) {
			if (error.message.includes("validation") || error.message.includes("constraint")) {
				return c.json({ error: error.message }, 400);
			}
		}
		
		return c.json(
			{ error: "An unexpected error occurred while creating the activity log." },
			500
		);
	}
}

// Update an existing activity log
export async function updateActivityLog(c: ActivityLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const activityLogId = parseInt(c.req.param("id"));

		if (isNaN(activityLogId)) {
			return c.json({ error: "Invalid activity log ID" }, 400);
		}

		const existingActivityLog = await prisma.activityLog.findUnique({
			where: { id: activityLogId },
		});

		if (!existingActivityLog) {
			return c.json({ error: "Activity log not found" }, 404);
		}

		if (existingActivityLog.userId !== parseInt(userId)) {
			return c.json({ error: "Activity log not found" }, 404);
		}

		const body = await c.req.json();
		const { window_title, url, recorded_at } = body;

		const updatedActivityLog = await prisma.activityLog.update({
			where: { id: activityLogId },
			data: {
				window_title: window_title !== undefined ? window_title : existingActivityLog.window_title,
				url: url !== undefined ? url : existingActivityLog.url,
				recordedAt: recorded_at ? new Date(recorded_at) : existingActivityLog.recordedAt,
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

		return c.json(formatActivityLogResponse(updatedActivityLog), 200);
	} catch (error) {
		console.error("Error updating activity log:", error);

		if (error instanceof Error) {
			if (error.message.includes("validation") || error.message.includes("constraint")) {
				return c.json({ error: error.message }, 400);
			}
		}
		
		return c.json({ error: "Failed to update activity log" }, 500);
	}
}

// Delete an activity log
export async function deleteActivityLog(c: ActivityLogContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const activityLogId = parseInt(c.req.param("id"));

		if (isNaN(activityLogId)) {
			return c.json({ error: "Invalid activity log ID" }, 400);
		}

		const activityLog = await prisma.activityLog.findUnique({
			where: { id: activityLogId },
		});

		if (!activityLog) {
			return c.json({ error: "Activity log not found" }, 404);
		}

		if (activityLog.userId !== parseInt(userId)) {
			return c.json({ error: "Activity log not found" }, 404);
		}

		await prisma.activityLog.delete({
			where: { id: activityLogId },
		});

		return c.body(null, 204);
	} catch (error) {
		console.error("Error deleting activity log:", error);
		return c.json({ error: "Failed to delete activity log" }, 500);
	}
}
