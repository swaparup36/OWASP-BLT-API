import { Context } from "hono";
import { BlankInput } from "hono/types";
import prisma from "../utils/db";
import { validateImage, uploadToR2, generateUniqueFilename } from "../utils/file-upload";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

// Create or update a course
export const createOrUpdateCourse = async (
	c: Context<AppEnv, "/courses" | "/courses/:id", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ success: false, message: "Unauthorized" }, 401);
		}

		const courseIdParam = c.req.param("id");
		const formData = await c.req.formData();

		const title = formData.get("title") as string;
		const description = formData.get("description") as string;
		const level = (formData.get("level") as string) || "BEGINNER";
		const courseIdFromBody = formData.get("id") as string;
		const thumbnail = formData.get("thumbnail") as File | null;

		// Support both URL param and body param for course ID
		const courseId = courseIdParam || courseIdFromBody;

		// Get tag IDs from form data
		const tagIds: number[] = [];
		formData.forEach((value, key) => {
			if (key === "tags" || key === "tags[]") {
				const tagId = parseInt(value as string);
				if (!isNaN(tagId)) {
					tagIds.push(tagId);
				}
			}
		});

		// Validate required fields
		if (!title || !description) {
			const missingFields: string[] = [];
			if (!title) missingFields.push("Course title");
			if (!description) missingFields.push("Course description");

			return c.json(
				{
					success: false,
					message: `${missingFields.join(", ")} is required`,
				},
				400
			);
		}

		// Validate level
		const validLevels = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];
		if (!validLevels.includes(level)) {
			return c.json(
				{
					success: false,
					message: `Invalid level. Must be one of: ${validLevels.join(", ")}`,
				},
				400
			);
		}

		// Validate thumbnail if provided
		if (thumbnail && thumbnail.size > 0) {
			const validation = validateImage(thumbnail);
			if (!validation.valid) {
				return c.json(
					{
						success: false,
						message: validation.error || "Invalid thumbnail file",
					},
					400
				);
			}

			// Additional check for specific allowed types (jpg, jpeg, png)
			const allowedTypes = ["image/jpeg", "image/png"];
			if (!allowedTypes.includes(thumbnail.type)) {
				return c.json(
					{
						success: false,
						message: "Thumbnail must be a JPG or PNG image",
					},
					400
				);
			}

			// Check max size 5MB
			const maxSize = 5 * 1024 * 1024;
			if (thumbnail.size > maxSize) {
				return c.json(
					{
						success: false,
						message: "Thumbnail file size must not exceed 5MB",
					},
					400
				);
			}
		}

		// Get user profile
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
		});

		if (!user) {
			return c.json(
				{
					success: false,
					message: "User not found",
				},
				404
			);
		}

		// If courseId is provided, check if course exists
		let existingCourse = null;
		if (courseId) {
			existingCourse = await prisma.course.findUnique({
				where: { id: parseInt(courseId) },
			});

			if (!existingCourse) {
				return c.json(
					{
						success: false,
						message: "Course not found",
					},
					404
				);
			}

			// Verify that the user is the instructor of the course
			if (existingCourse.instructorId !== user.id) {
				return c.json(
					{
						success: false,
						message: "You are not authorized to update this course",
					},
					403
				);
			}
		}

		// Handle thumbnail upload if provided
		let thumbnailUrl = existingCourse?.thumbnail || null;
		if (thumbnail && thumbnail.size > 0) {
			const bucket = c.env.BUCKET as R2Bucket;
			if (!bucket) {
				return c.json(
					{
						success: false,
						message: "File storage is not configured",
					},
					500
				);
			}

			try {
				const filename = generateUniqueFilename(thumbnail.name);
				const key = `courses/thumbnails/${filename}`;
				await uploadToR2(bucket, key, thumbnail);

				// Construct public URL (adjust based on your R2 public URL configuration)
				thumbnailUrl = key;
			} catch (error) {
				console.error("Thumbnail upload error:", error);
				return c.json(
					{
						success: false,
						message: "Failed to upload thumbnail",
					},
					500
				);
			}
		}

		// Prepare course data
		const courseData: any = {
			title,
			description,
			instructorId: user.id,
			level: level as "BEGINNER" | "INTERMEDIATE" | "ADVANCED",
		};

		if (thumbnailUrl) {
			courseData.thumbnail = thumbnailUrl;
		}

		// Create or update course
		let course;
		if (existingCourse) {
			course = await prisma.course.update({
				where: { id: existingCourse.id },
				data: courseData,
				include: {
					instructor: {
						select: {
							id: true,
							username: true,
							email: true,
						},
					},
					tags: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
				},
			});
		} else {
			course = await prisma.course.create({
				data: courseData,
				include: {
					instructor: {
						select: {
							id: true,
							username: true,
							email: true,
						},
					},
					tags: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
				},
			});
		}

		// Update tags if provided
		if (tagIds.length > 0) {
			// Verify all tags exist
			const tags = await prisma.tag.findMany({
				where: { id: { in: tagIds } },
			});

			if (tags.length !== tagIds.length) {
				return c.json(
					{
						success: false,
						message: "One or more tags not found",
					},
					400
				);
			}

			// Update course tags
			await prisma.course.update({
				where: { id: course.id },
				data: {
					tags: {
						set: tags.map((tag) => ({ id: tag.id })),
					},
				},
			});

			// Fetch updated course with tags
			course = await prisma.course.findUnique({
				where: { id: course.id },
				include: {
					instructor: {
						select: {
							id: true,
							username: true,
							email: true,
						},
					},
					tags: {
						select: {
							id: true,
							name: true,
							slug: true,
						},
					},
				},
			}) as any;
		}

		return c.json(
			{
				success: true,
				message: existingCourse
					? "Course updated successfully"
					: "Course created successfully",
				course_id: course.id,
				course: {
					id: course.id,
					title: course.title,
					description: course.description,
					level: course.level,
					thumbnail: course.thumbnail,
					instructor: course.instructor,
					tags: course.tags,
					createdAt: course.createdAt,
					updatedAt: course.updatedAt,
				},
			},
			existingCourse ? 200 : 201
		);
	} catch (error) {
		console.error("Error in createOrUpdateCourse:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred. Please try again later.",
			},
			500
		);
	}
};

// Get course content management data (sections, lectures, and metadata)
export const courseContentManagement = async (
	c: Context<AppEnv, "/courses/:courseId/content", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const courseId = c.req.param("courseId");
		if (!courseId) {
			return c.json({ error: "Course ID is required" }, 400);
		}

		// Fetch the course with all its sections and lectures
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				courseSections: {
					orderBy: { order: "asc" },
					include: {
						lectures: {
							orderBy: { order: "asc" },
							select: {
								id: true,
								title: true,
								contentType: true,
								description: true,
								duration: true,
								order: true,
								videoUrl: true,
								liveUrl: true,
								scheduledTime: true,
							},
						},
					},
				},
				tags: {
					select: {
						id: true,
						name: true,
						slug: true,
					},
				},
			},
		});

		if (!course) {
			return c.json({ error: "Course not found" }, 404);
		}

		// Verify the user is the instructor of the course
		if (course.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the course instructor can manage course content" },
				403
			);
		}

		// Calculate the next section order
		const nextSectionOrder = course.courseSections.length + 1;

		// Define lecture types (matching the enum in the database)
		const lectureTypes = [
			{ value: "VIDEO_LECTURE", label: "Video Lecture" },
			{ value: "ARTICLE_SESSION", label: "Article Session" },
			{ value: "DOCUMENT", label: "Document" },
			{ value: "QUIZ", label: "Quiz" },
		];

		return c.json(
			{
				course: {
					id: course.id,
					title: course.title,
					description: course.description,
					level: course.level,
					thumbnail: course.thumbnail,
					instructor: course.instructor,
					tags: course.tags,
					createdAt: course.createdAt,
					updatedAt: course.updatedAt,
					sections: course.courseSections,
				},
				nextSectionOrder,
				lectureTypes,
			},
			200
		);
	} catch (error) {
		console.error("Course content management error:", error);
		return c.json(
			{ error: "An error occurred while fetching course content" },
			500
		);
	}
};

// Get course details (instructor only)
export const getCourseDetails = async (
	c: Context<AppEnv, "/courses/:id", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ success: false, message: "Unauthorized" }, 401);
		}

		const courseId = c.req.param("id");

		if (!courseId) {
			return c.json(
				{
					success: false,
					message: "Course ID is required",
				},
				400
			);
		}

		// Fetch the course with related data
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				tags: {
					select: {
						id: true,
						name: true,
						slug: true,
					},
				},
			},
		});

		if (!course) {
			return c.json(
				{
					success: false,
					message: "Course not found",
				},
				404
			);
		}

		// Verify that the user is the instructor of the course
		if (course.instructorId !== parseInt(userId)) {
			return c.json(
				{
					success: false,
					message: "You are not authorized to edit this course",
				},
				403
			);
		}

		// Fetch all available tags
		const allTags = await prisma.tag.findMany({
			select: {
				id: true,
				name: true,
				slug: true,
			},
			orderBy: {
				name: "asc",
			},
		});

		return c.json({
			success: true,
			course: {
				id: course.id,
				title: course.title,
				description: course.description,
				level: course.level,
				thumbnail: course.thumbnail,
				instructor: course.instructor,
				tags: course.tags,
				createdAt: course.createdAt,
				updatedAt: course.updatedAt,
			},
			tags: allTags,
		});
	} catch (error) {
		console.error("Error in getCourseDetails:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred. Please try again later.",
			},
			500
		);
	}
};

// Get course content with enrollment status and progress (for students)
export const getCourseContent = async (
	c: Context<AppEnv, "/courses/:courseId/view", BlankInput>
) => {
	try {
		const courseId = c.req.param("courseId");
		const userId = c.get("userId");

		if (!courseId) {
			return c.json(
				{
					success: false,
					message: "Course ID is required",
				},
				400
			);
		}

		// Fetch the course with sections and lectures
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				courseSections: {
					orderBy: { order: "asc" },
					include: {
						lectures: {
							orderBy: { order: "asc" },
							select: {
								id: true,
								title: true,
								contentType: true,
								description: true,
								duration: true,
								order: true,
								videoUrl: true,
								liveUrl: true,
								scheduledTime: true,
							},
						},
					},
				},
				tags: {
					select: {
						id: true,
						name: true,
						slug: true,
					},
				},
			},
		});

		if (!course) {
			return c.json(
				{
					success: false,
					message: "Course not found",
				},
				404
			);
		}

		// Initialize enrollment data
		let isEnrolled = false;
		let isCompleted = false;
		let courseProgress = 0.0;

		// Check enrollment status if user is authenticated
		if (userId) {
			const enrollment = await prisma.enrollment.findFirst({
				where: {
					studentId: parseInt(userId),
					courseId: parseInt(courseId),
				},
			});

			if (enrollment) {
				isEnrolled = true;
				isCompleted = enrollment.completed;

				// Calculate course progress
				const totalLectures = course.courseSections.reduce(
					(sum, section) => sum + section.lectures.length,
					0
				);

				if (totalLectures > 0) {
					// Get all lecture IDs from the course
					const lectureIds = course.courseSections.flatMap(
						(section) => section.lectures.map((lecture) => lecture.id)
					);

					// Fetch completed lecture statuses for this student
					const lectureStatuses = await prisma.lectureStatus.findMany({
						where: {
							studentId: parseInt(userId),
							lectureId: { in: lectureIds },
							status: "COMPLETED",
						},
					});

					courseProgress = (lectureStatuses.length / totalLectures) * 100;
				}
			}
		}

		return c.json({
			success: true,
			course: {
				id: course.id,
				title: course.title,
				description: course.description,
				level: course.level,
				thumbnail: course.thumbnail,
				instructor: course.instructor,
				tags: course.tags,
				sections: course.courseSections,
				createdAt: course.createdAt,
				updatedAt: course.updatedAt,
			},
			enrollment: {
				isEnrolled,
				isCompleted,
				courseProgress: parseFloat(courseProgress.toFixed(2)),
			},
		});
	} catch (error) {
		console.error("Error in getCourseContent:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred. Please try again later.",
			},
			500
		);
	}
};

// View course - Get basic course details (public endpoint)
export const viewCourse = async (
	c: Context<AppEnv, "/courses/:courseId/view", BlankInput>
) => {
	try {
		const courseId = c.req.param("courseId");

		if (!courseId) {
			return c.json(
				{
					success: false,
					message: "Course ID is required",
				},
				400
			);
		}

		// Fetch the course with basic information
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				courseSections: {
					orderBy: { order: "asc" },
					include: {
						lectures: {
							orderBy: { order: "asc" },
							select: {
								id: true,
								title: true,
								contentType: true,
								description: true,
								duration: true,
								order: true,
							},
						},
					},
				},
				tags: {
					select: {
						id: true,
						name: true,
						slug: true,
					},
				},
			},
		});

		if (!course) {
			return c.json(
				{
					success: false,
					message: "Course not found",
				},
				404
			);
		}

		return c.json({
			success: true,
			course: {
				id: course.id,
				title: course.title,
				description: course.description,
				level: course.level,
				thumbnail: course.thumbnail,
				instructor: course.instructor,
				tags: course.tags,
				sections: course.courseSections,
				createdAt: course.createdAt,
				updatedAt: course.updatedAt,
			},
		});
	} catch (error) {
		console.error("Error in viewCourse:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred. Please try again later.",
			},
			500
		);
	}
};

// Study course - Get course content with enrollment verification, progress, and lecture statuses
export const studyCourse = async (
	c: Context<AppEnv, "/courses/:courseId/study", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json(
				{
					success: false,
					message: "Unauthorized. Please login to access this course.",
				},
				401
			);
		}

		const courseId = c.req.param("courseId");
		if (!courseId) {
			return c.json(
				{
					success: false,
					message: "Course ID is required",
				},
				400
			);
		}

		// Fetch the course with sections and lectures
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				courseSections: {
					orderBy: { order: "asc" },
					include: {
						lectures: {
							orderBy: { order: "asc" },
							select: {
								id: true,
								title: true,
								contentType: true,
								description: true,
								duration: true,
								order: true,
								videoUrl: true,
								liveUrl: true,
								scheduledTime: true,
							},
						},
					},
				},
				tags: {
					select: {
						id: true,
						name: true,
						slug: true,
					},
				},
			},
		});

		if (!course) {
			return c.json(
				{
					success: false,
					message: "Course not found",
				},
				404
			);
		}

		// Check if user is enrolled in the course
		const enrollment = await prisma.enrollment.findFirst({
			where: {
				studentId: parseInt(userId),
				courseId: parseInt(courseId),
			},
		});

		if (!enrollment) {
			return c.json(
				{
					success: false,
					message: "You are not enrolled in this course.",
				},
				403
			);
		}

		// Calculate course progress
		const totalLectures = course.courseSections.reduce(
			(sum, section) => sum + section.lectures.length,
			0
		);

		let courseProgress = 0.0;
		let completedLecturesCount = 0;

		// Get all lecture IDs from the course
		const lectureIds = course.courseSections.flatMap(
			(section) => section.lectures.map((lecture) => lecture.id)
		);

		// Fetch all lecture statuses for this student and course
		const lectureStatuses = await prisma.lectureStatus.findMany({
			where: {
				studentId: parseInt(userId),
				lectureId: { in: lectureIds },
			},
		});

		// Create a map of lecture statuses for easy lookup
		const lectureStatusMap: { [key: number]: string } = {};
		lectureStatuses.forEach((status) => {
			lectureStatusMap[status.lectureId] = status.status;
			if (status.status === "COMPLETED") {
				completedLecturesCount++;
			}
		});

		if (totalLectures > 0) {
			courseProgress = (completedLecturesCount / totalLectures) * 100;
		}

		// Find the first incomplete lecture for initial display
		let currentLecture = null;
		outerLoop: for (const section of course.courseSections) {
			for (const lecture of section.lectures) {
				const status = lectureStatusMap[lecture.id];
				if (status !== "COMPLETED") {
					currentLecture = lecture;
					break outerLoop;
				}
			}
		}

		// If all lectures are complete or none started, show the first lecture
		if (
			!currentLecture &&
			course.courseSections.length > 0 &&
			course.courseSections[0].lectures.length > 0
		) {
			currentLecture = course.courseSections[0].lectures[0];
		}

		return c.json({
			success: true,
			course: {
				id: course.id,
				title: course.title,
				description: course.description,
				level: course.level,
				thumbnail: course.thumbnail,
				instructor: course.instructor,
				tags: course.tags,
				createdAt: course.createdAt,
				updatedAt: course.updatedAt,
			},
			sections: course.courseSections,
			courseProgress: parseFloat(courseProgress.toFixed(2)),
			totalLectures,
			completedLectures: completedLecturesCount,
			lectureStatuses: lectureStatusMap,
			currentLecture,
			now: new Date().toISOString(),
		});
	} catch (error) {
		console.error("Error in studyCourse:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred. Please try again later.",
			},
			500
		);
	}
};
