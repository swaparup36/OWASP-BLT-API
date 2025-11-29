import type { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};


// Returns education home page data including - featured lectures and courses
export async function educationHome(c: Context<AppEnv>) {
	try {
		const userId = c.get("userId");
		let isInstructor = false;
		
		// If user is authenticated, check if they are an instructor
		if (userId) {
			const userIdNum = parseInt(userId);
			
			if (isNaN(userIdNum)) {
				return c.json({ error: "Invalid user ID" }, 400);
			}
			
			// Check if user has any courses or lectures as instructor
			const [courseCount, lectureCount] = await Promise.all([
				prisma.course.count({
					where: { instructorId: userIdNum }
				}),
				prisma.lecture.count({
					where: { instructorId: userIdNum }
				})
			]);
			
			isInstructor = courseCount > 0 || lectureCount > 0;
		}
		
		// Get featured lectures (lectures without a section)
		const featuredLectures = await prisma.lecture.findMany({
			where: {
				sectionId: null
			},
			select: {
				id: true,
				title: true,
				description: true,
				contentType: true,
				videoUrl: true,
				liveUrl: true,
				scheduledTime: true,
				recordingUrl: true,
				duration: true,
				order: true,
				instructor: {
					select: {
						id: true,
						username: true,
						firstName: true,
						lastName: true
					}
				},
				tags: {
					select: {
						id: true,
						name: true
					}
				}
			},
			orderBy: {
				order: 'asc'
			}
		});
		
		// Get all courses
		const courses = await prisma.course.findMany({
			select: {
				id: true,
				title: true,
				description: true,
				thumbnail: true,
				level: true,
				createdAt: true,
				updatedAt: true,
				instructor: {
					select: {
						id: true,
						username: true,
						firstName: true,
						lastName: true
					}
				},
				tags: {
					select: {
						id: true,
						name: true
					}
				},
				_count: {
					select: {
						enrollments: true,
						courseSections: true
					}
				}
			},
			orderBy: {
				createdAt: 'desc'
			}
		});
		
		return c.json({
			is_instructor: isInstructor,
			featured_lectures: featuredLectures,
			courses: courses
		});
		
	} catch (error) {
		console.error("Error in educationHome:", error);
		return c.json(
			{ 
				error: "Failed to fetch education home data",
				details: error instanceof Error ? error.message : "Unknown error"
			},
			500
		);
	}
}
