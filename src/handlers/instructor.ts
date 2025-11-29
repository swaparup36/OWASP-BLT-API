import { Context } from "hono";
import { BlankInput } from "hono/types";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

// Returns dashboard data for the authenticated instructor including courses and standalone lectures
export const getInstructorDashboard = async (
	c: Context<AppEnv, "/instructor/dashboard", BlankInput>
) => {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		// Parse userId to integer
		const userIdInt = parseInt(userId, 10);
		if (isNaN(userIdInt)) {
			return c.json({ error: "Invalid user ID" }, 400);
		}

		// Verify the user exists and get their profile
		const user = await prisma.user.findUnique({
			where: { id: userIdInt },
			include: {
				userProfile: true,
			},
		});

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		// Fetch all tags
		const tags = await prisma.tag.findMany({
			select: {
				id: true,
				name: true,
				slug: true,
				created: true,
			},
			orderBy: {
				name: "asc",
			},
		});

		// Fetch courses where the user is the instructor
		const courses = await prisma.course.findMany({
			where: {
				instructorId: userIdInt,
			},
			include: {
				tags: {
					select: {
						id: true,
						name: true,
						slug: true,
					},
				},
				courseSections: {
					select: {
						id: true,
						title: true,
						order: true,
					},
					orderBy: {
						order: "asc",
					},
				},
				enrollments: {
					select: {
						id: true,
					},
				},
				_count: {
					select: {
						enrollments: true,
						ratings: true,
					},
				},
			},
			orderBy: {
				createdAt: "desc",
			},
		});

		// Fetch standalone lectures (not associated with any section)
		const standaloneLectures = await prisma.lecture.findMany({
			where: {
				instructorId: userIdInt,
				sectionId: null, // Only lectures without a section
			},
			include: {
				tags: {
					select: {
						id: true,
						name: true,
						slug: true,
					},
				},
				_count: {
					select: {
						lectureStatuses: true,
					},
				},
			},
			orderBy: {
				order: "asc",
			},
		});

		// Return the dashboard data
		return c.json(
			{
				tags,
				courses: courses.map((course) => ({
					id: course.id,
					title: course.title,
					description: course.description,
					thumbnail: course.thumbnail,
					level: course.level,
					tags: course.tags,
					sections: course.courseSections,
					enrollmentCount: course._count.enrollments,
					ratingCount: course._count.ratings,
					createdAt: course.createdAt,
					updatedAt: course.updatedAt,
				})),
				standaloneLectures: standaloneLectures.map((lecture) => ({
					id: lecture.id,
					title: lecture.title,
					description: lecture.description,
					contentType: lecture.contentType,
					videoUrl: lecture.videoUrl,
					liveUrl: lecture.liveUrl,
					scheduledTime: lecture.scheduledTime,
					recordingUrl: lecture.recordingUrl,
					duration: lecture.duration,
					tags: lecture.tags,
					order: lecture.order,
					studentCount: lecture._count.lectureStatuses,
				})),
			},
			200
		);
	} catch (error) {
		console.error("Instructor dashboard error:", error);
		return c.json({ error: "Failed to fetch instructor dashboard data" }, 500);
	}
};
