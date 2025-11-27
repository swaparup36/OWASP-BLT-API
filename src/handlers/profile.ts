import { Context } from "hono";
import prisma from "../utils/db";

type AppContext = Context<{
	Bindings: CloudflareBindings;
	Variables: {
		userId: string;
	};
}>;

type ListAppContext = Context<{
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
}>;


// List user profiles with optional search ()
export async function listProfiles(c: ListAppContext) {
	try {
		const searchQuery = c.req.query("search");

		let profiles;

		if (searchQuery) {
			// Check if search query is a number (for id or user__id search)
			const isNumeric = !isNaN(Number(searchQuery));

			profiles = await prisma.userProfile.findMany({
				where: {
					OR: [
						...(isNumeric
							? [
									{ id: Number(searchQuery) },
									{ userId: Number(searchQuery) },
							  ]
							: []),
						{
							user: {
								username: {
									contains: searchQuery,
									mode: "insensitive" as const,
								},
							},
						},
					],
				},
				include: {
					user: {
						select: {
							id: true,
							username: true,
							email: true,
							firstName: true,
							lastName: true,
						},
					},
					team: true,
				},
			});
		} else {
			profiles = await prisma.userProfile.findMany({
				include: {
					user: {
						select: {
							id: true,
							username: true,
							email: true,
							firstName: true,
							lastName: true,
						},
					},
					team: true,
				},
			});
		}

		return c.json(profiles, 200);
	} catch (error) {
		console.error("Error listing profiles:", error);
		return c.json({ error: "Failed to list profiles" }, 500);
	}
}

// Retrieve a user profile by user ID
export async function retrieveProfile(c: ListAppContext) {
	try {
		const userId = c.req.param("userId");

		if (!userId) {
			return c.json({ detail: "User ID is required." }, 400);
		}

		const userProfile = await prisma.userProfile.findFirst({
			where: {
				userId: Number(userId),
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
						firstName: true,
						lastName: true,
					},
				},
				team: true,
				tags: true,
			},
		});

		if (!userProfile) {
			return c.json({ detail: "Not found." }, 404);
		}

		return c.json(userProfile, 200);
	} catch (error) {
		console.error("Error retrieving profile:", error);
		return c.json({ error: "Failed to retrieve profile" }, 500);
	}
}

// Update the authenticated user's profile
export async function updateProfile(c: AppContext) {
	try {
		const userId = c.get("userId");

		// Get the user profile for the authenticated user
		const userProfile = await prisma.userProfile.findFirst({
			where: {
				userId: Number(userId),
			},
		});

		if (!userProfile) {
			return c.json({ detail: "Not found." }, 404);
		}

		// Parse request body
		const body = await c.req.json();

		// Define allowed fields for update
		const allowedFields = [
			"userAvatar",
			"title",
			"role",
			"description",
			"btcAddress",
			"bchAddress",
			"ethAddress",
			"xUsername",
			"linkedinUrl",
			"githubUrl",
			"websiteUrl",
			"discountedHourlyRate",
			"teamId",
			"publicKey",
			"issuesHidden",
		];

		// Filter and prepare update data
		const updateData: any = {};
		for (const field of allowedFields) {
			if (body[field] !== undefined) {
				updateData[field] = body[field];
			}
		}

		// Update the profile
		const updatedProfile = await prisma.userProfile.update({
			where: {
				id: userProfile.id,
			},
			data: updateData,
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
						firstName: true,
						lastName: true,
					},
				},
				team: true,
				tags: true,
			},
		});

		return c.json(updatedProfile, 200);
	} catch (error) {
		console.error("Error updating profile:", error);
		return c.json({ error: "Failed to update profile" }, 500);
	}
}

// HEAD request for profile listing
export async function headProfiles(c: ListAppContext) {
	try {
		const count = await prisma.userProfile.count();
		return c.body(null, 200, {
			"X-Total-Count": count.toString(),
		});
	} catch (error) {
		console.error("Error in HEAD request:", error);
		return c.body(null, 500);
	}
}
