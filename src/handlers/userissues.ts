import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type UserIssueContext = Context<AppEnv>;

// Get all issues based on user authentication and permissions
export async function listUserIssues(c: UserIssueContext) {
	try {
		const userId = c.get("userId");
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		const search = searchParams.get("search");

		const where: any = {};

		if (!userId) {
			where.isHidden = false;
		} else {
			where.OR = [
				{ isHidden: false },
				{ isHidden: true, userId: parseInt(userId) }
			];
		}

		// Add search filter if provided
		if (search) {
			const searchConditions: any[] = [
				{ user: { username: { contains: search, mode: "insensitive" } } }
			];

			// If search is a valid number, also search by user ID
			const searchAsNumber = parseInt(search);
			if (!isNaN(searchAsNumber)) {
				searchConditions.push({ userId: searchAsNumber });
			}

			// Combine with existing OR conditions
			if (where.OR) {
				where.AND = [
					{ OR: where.OR },
					{ OR: searchConditions }
				];
				delete where.OR;
			} else {
				where.OR = searchConditions;
			}
		}

		const issues = await prisma.issue.findMany({
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
			orderBy: {
				created: "desc",
			},
		});

		return c.json({
			success: true,
			data: issues,
		});
	} catch (error) {
		console.error("Error listing user issues:", error);
		return c.json({ error: "Failed to retrieve issues" }, 500);
	}
}

// Get a single issue by ID
export async function retrieveUserIssue(c: UserIssueContext) {
	try {
		const userId = c.get("userId");
		const issueId = parseInt(c.req.param("id"));

		if (isNaN(issueId)) {
			return c.json({ error: "Invalid issue ID" }, 400);
		}

		const where: any = { id: issueId };

		if (!userId) {
			where.isHidden = false;
		} else {
			where.OR = [
				{ isHidden: false },
				{ isHidden: true, userId: parseInt(userId) }
			];
		}

		const issue = await prisma.issue.findFirst({
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
		});

		if (!issue) {
			return c.json({
				success: false,
				message: "Issue not found",
			}, 404);
		}

		return c.json({
			success: true,
			data: issue,
		});
	} catch (error) {
		console.error("Error retrieving user issue:", error);
		return c.json({ error: "Failed to retrieve issue" }, 500);
	}
}

// Get metadata about the issues collection
export async function headUserIssues(c: UserIssueContext) {
	try {
		const userId = c.get("userId");

		const where: any = {};

		if (!userId) {
			where.isHidden = false;
		} else {
			where.OR = [
				{ isHidden: false },
				{ isHidden: true, userId: parseInt(userId) }
			];
		}

		const count = await prisma.issue.count({ where });

		c.header("X-Total-Count", count.toString());
		return c.body(null, 200);
	} catch (error) {
		console.error("Error getting user issues metadata:", error);
		return c.json({ error: "Failed to retrieve metadata" }, 500);
	}
}
