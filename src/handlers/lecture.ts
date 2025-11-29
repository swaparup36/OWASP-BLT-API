import { Context } from "hono";
import { BlankInput } from "hono/types";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

// Validates if a URL is valid for video content (YouTube or Vimeo)
const isValidVideoUrl = (url: string): boolean => {
	if (!url) return false;
	try {
		const urlObj = new URL(url);
		const hostname = urlObj.hostname.toLowerCase();
		return (
			hostname.includes("youtube.com") ||
			hostname.includes("youtu.be") ||
			hostname.includes("vimeo.com")
		);
	} catch {
		return false;
	}
};

// Validates if a URL is valid for live content (Zoom, Google Meet, or Vimeo)
const isValidLiveUrl = (url: string): boolean => {
	if (!url) return false;
	try {
		const urlObj = new URL(url);
		const hostname = urlObj.hostname.toLowerCase();
		return (
			hostname.includes("zoom.us") ||
			hostname.includes("meet.google.com") ||
			hostname.includes("vimeo.com")
		);
	} catch {
		return false;
	}
};

// Add a new lecture to a section, or create standalone lecture if sectionId is 0
export const addLecture = async (c: Context<AppEnv, "/lectures", BlankInput>) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const body = await c.req.json();
		const {
			sectionId,
			title,
			contentType,
			description,
			order = 0,
			duration,
			videoUrl,
			liveUrl,
			scheduledTime,
			content,
		} = body;

		if (!title || !contentType) {
			return c.json({ error: "Title and content type are required" }, 400);
		}

		// Map content type to enum value
		const contentTypeMap: Record<string, string> = {
			VIDEO: "VIDEO_LECTURE",
			LIVE: "VIDEO_LECTURE",
			DOCUMENT: "DOCUMENT",
			ARTICLE: "ARTICLE_SESSION",
			QUIZ: "QUIZ",
		};

		const mappedContentType = contentTypeMap[contentType] || contentType;

		// Validate section if sectionId is provided and not 0
		let section = null;
		if (sectionId && sectionId !== 0) {
			section = await prisma.section.findUnique({
				where: { id: parseInt(sectionId) },
				include: { course: true },
			});

			if (!section) {
				return c.json({ error: "Section not found" }, 404);
			}
		}

		// Get user profile
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
		});

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		// Prepare lecture data
		const lectureData: any = {
			title,
			instructorId: user.id,
			sectionId: section ? section.id : null,
			contentType: mappedContentType,
			order: parseInt(order) || 0,
			description: description || null,
			duration: duration ? parseInt(duration) : null,
		};

		// Handle VIDEO content type
		if (contentType === "VIDEO") {
			if (!videoUrl) {
				return c.json({ error: "Video URL is required for video lectures" }, 400);
			}

			if (!isValidVideoUrl(videoUrl)) {
				return c.json(
					{ error: "Only YouTube and Vimeo URLs are allowed for video lectures" },
					400
				);
			}

			lectureData.videoUrl = videoUrl;
			lectureData.content = content || null;
		}
		// Handle LIVE content type
		else if (contentType === "LIVE") {
			if (!liveUrl) {
				return c.json({ error: "Live URL is required for live lectures" }, 400);
			}

			if (!isValidLiveUrl(liveUrl)) {
				return c.json(
					{ error: "Only Zoom, Google Meet or Vimeo URLs are allowed for live lectures" },
					400
				);
			}

			lectureData.liveUrl = liveUrl;
			lectureData.scheduledTime = scheduledTime ? new Date(scheduledTime) : null;
		}
		// Handle DOCUMENT content type
		else if (contentType === "DOCUMENT") {
			if (!content) {
				return c.json({ error: "Content is required for document lectures" }, 400);
			}
			lectureData.content = content;
		}

		// Create the lecture (allow null sectionId for standalone lectures)
		const lecture = await prisma.lecture.create({
			data: lectureData,
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				section: true,
			},
		});

		return c.json(
			{
				message: `Lecture '${title}' was added successfully!`,
				lecture: {
					id: lecture.id,
					title: lecture.title,
					contentType: lecture.contentType,
					description: lecture.description,
					order: lecture.order,
					duration: lecture.duration,
					videoUrl: lecture.videoUrl,
					liveUrl: lecture.liveUrl,
					scheduledTime: lecture.scheduledTime,
					content: lecture.content,
					instructor: lecture.instructor,
					section: lecture.section,
				},
			},
			201
		);
	} catch (error) {
		console.error("Add lecture error:", error);
		return c.json({ error: "An error occurred while adding the lecture" }, 500);
	}
};

// Edit a lecture
export const editLecture = async (
	c: Context<AppEnv, "/lectures/:lectureId", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const lectureId = c.req.param("lectureId");
		if (!lectureId) {
			return c.json({ error: "Lecture ID is required" }, 400);
		}

		// Get the existing lecture
		const lecture = await prisma.lecture.findUnique({
			where: { id: parseInt(lectureId) },
			include: {
				section: {
					include: {
						course: true,
					},
				},
			},
		});

		if (!lecture) {
			return c.json({ error: "Lecture not found" }, 404);
		}

		// Verify the user is the instructor of the lecture
		if (lecture.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the lecture instructor can edit this lecture" },
				403
			);
		}

		const body = await c.req.json();
		const {
			title,
			contentType,
			description,
			content,
			duration,
			videoUrl,
			liveUrl,
			scheduledTime,
			recordingUrl,
		} = body;

		// Determine if it's a standalone lecture
		const isStandalone = !lecture.sectionId;
		const courseId = lecture.section?.course.id;

		// Map content type to enum value
		const contentTypeMap: Record<string, string> = {
			VIDEO: "VIDEO_LECTURE",
			LIVE: "VIDEO_LECTURE",
			DOCUMENT: "DOCUMENT",
			ARTICLE: "ARTICLE_SESSION",
			QUIZ: "QUIZ",
		};

		const mappedContentType = contentTypeMap[contentType || lecture.contentType] || contentType || lecture.contentType;

		// Prepare update data
		const updateData: any = {
			title: title || lecture.title,
			contentType: mappedContentType,
			description: description !== undefined ? description : lecture.description,
			content: content !== undefined ? content : lecture.content,
			duration: duration !== undefined ? (duration ? parseInt(duration) : null) : lecture.duration,
		};

		// Handle VIDEO content type
		if (contentType === "VIDEO") {
			if (!videoUrl) {
				return c.json({ error: "Video URL is required for video lectures" }, 400);
			}

			if (!isValidVideoUrl(videoUrl)) {
				return c.json(
					{ error: "Only YouTube and Vimeo URLs are allowed for video lectures" },
					400
				);
			}

			updateData.videoUrl = videoUrl;
			updateData.liveUrl = null;
			updateData.scheduledTime = null;
			updateData.recordingUrl = null;
		}
		// Handle LIVE content type
		else if (contentType === "LIVE") {
			if (!liveUrl) {
				return c.json({ error: "Live URL is required for live lectures" }, 400);
			}

			if (!isValidLiveUrl(liveUrl)) {
				return c.json(
					{ error: "Only Zoom, Google Meet or Vimeo URLs are allowed for live lectures" },
					400
				);
			}

			updateData.liveUrl = liveUrl;
			updateData.scheduledTime = scheduledTime ? new Date(scheduledTime) : null;
			updateData.recordingUrl = recordingUrl || null;
			updateData.videoUrl = null;
		}
		// Handle DOCUMENT content type
		else if (contentType === "DOCUMENT") {
			updateData.videoUrl = null;
			updateData.liveUrl = null;
			updateData.scheduledTime = null;
			updateData.recordingUrl = null;
		}

		// Update the lecture
		const updatedLecture = await prisma.lecture.update({
			where: { id: parseInt(lectureId) },
			data: updateData,
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				section: true,
			},
		});

		return c.json(
			{
				message: `Lecture '${updatedLecture.title}' was edited successfully!`,
				lecture: {
					id: updatedLecture.id,
					title: updatedLecture.title,
					contentType: updatedLecture.contentType,
					description: updatedLecture.description,
					order: updatedLecture.order,
					duration: updatedLecture.duration,
					videoUrl: updatedLecture.videoUrl,
					liveUrl: updatedLecture.liveUrl,
					scheduledTime: updatedLecture.scheduledTime,
					recordingUrl: updatedLecture.recordingUrl,
					content: updatedLecture.content,
					instructor: updatedLecture.instructor,
					section: updatedLecture.section,
				},
				isStandalone,
				courseId,
			},
			200
		);
	} catch (error) {
		console.error("Edit lecture error:", error);
		return c.json({ error: "An error occurred while editing the lecture" }, 500);
	}
};

// Get a standalone lecture for editing
export const getStandaloneLecture = async (
	c: Context<AppEnv, "/lectures/:lectureId/standalone", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const lectureId = c.req.param("lectureId");
		if (!lectureId) {
			return c.json({ error: "Lecture ID is required" }, 400);
		}

		// Get the lecture
		const lecture = await prisma.lecture.findUnique({
			where: { id: parseInt(lectureId) },
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				section: {
					include: {
						course: true,
					},
				},
			},
		});

		if (!lecture) {
			return c.json({ error: "Lecture not found" }, 404);
		}

		// Verify the user is the instructor of the lecture
		if (lecture.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the lecture instructor can access this lecture" },
				403
			);
		}

		// Check if it's a standalone lecture (no section)
		if (lecture.sectionId !== null) {
			return c.json(
				{ error: "This lecture is not a standalone lecture" },
				400
			);
		}

		return c.json(
			{
				lecture: {
					id: lecture.id,
					title: lecture.title,
					contentType: lecture.contentType,
					description: lecture.description,
					order: lecture.order,
					duration: lecture.duration,
					videoUrl: lecture.videoUrl,
					liveUrl: lecture.liveUrl,
					scheduledTime: lecture.scheduledTime,
					recordingUrl: lecture.recordingUrl,
					content: lecture.content,
					instructor: lecture.instructor,
				},
			},
			200
		);
	} catch (error) {
		console.error("Get standalone lecture error:", error);
		return c.json(
			{ error: "An error occurred while fetching the lecture" },
			500
		);
	}
};

// Get lecture data for editing
export const getLectureData = async (
	c: Context<AppEnv, "/lectures/:lectureId/data", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const lectureId = c.req.param("lectureId");
		if (!lectureId) {
			return c.json({ error: "Lecture ID is required" }, 400);
		}

		// Get the lecture
		const lecture = await prisma.lecture.findUnique({
			where: { id: parseInt(lectureId) },
		});

		if (!lecture) {
			return c.json({ error: "Lecture not found" }, 404);
		}

		// Verify the user is the instructor of the lecture
		if (lecture.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the lecture instructor can access this lecture" },
				403
			);
		}

		const data = {
			id: lecture.id,
			title: lecture.title,
			content_type: lecture.contentType,
			video_url: lecture.videoUrl,
			live_url: lecture.liveUrl,
			scheduled_time: lecture.scheduledTime ? lecture.scheduledTime.toISOString() : null,
			recording_url: lecture.recordingUrl,
			content: lecture.content,
			duration: lecture.duration,
			description: lecture.description,
			order: lecture.order,
		};

		return c.json(data, 200);
	} catch (error) {
		console.error("Get lecture data error:", error);
		return c.json(
			{ error: "An error occurred while fetching the lecture data" },
			500
		);
	}
};

// Delete a lecture
export const deleteLecture = async (
	c: Context<AppEnv, "/lectures/:lectureId", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const lectureId = c.req.param("lectureId");
		if (!lectureId) {
			return c.json({ error: "Lecture ID is required" }, 400);
		}

		// Get the lecture with section and course details
		const lecture = await prisma.lecture.findUnique({
			where: { id: parseInt(lectureId) },
			include: {
				section: {
					include: {
						course: true,
					},
				},
			},
		});

		if (!lecture) {
			return c.json({ error: "Lecture not found" }, 404);
		}

		// Verify the user is the instructor of the lecture
		if (lecture.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the lecture instructor can delete this lecture" },
				403
			);
		}

		const sectionId = lecture.sectionId;
		const courseId = lecture.section?.course.id;
		const lectureTitle = lecture.title;

		// Delete the lecture
		await prisma.lecture.delete({
			where: { id: parseInt(lectureId) },
		});

		// Reorder remaining lectures in the section if sectionId exists
		if (sectionId) {
			const remainingLectures = await prisma.lecture.findMany({
				where: { sectionId: sectionId },
				orderBy: { order: "asc" },
			});

			// Update order for each lecture sequentially
			for (let i = 0; i < remainingLectures.length; i++) {
				await prisma.lecture.update({
					where: { id: remainingLectures[i].id },
					data: { order: i + 1 },
				});
			}
		}

		return c.json(
			{
				message: `Lecture '${lectureTitle}' was deleted successfully!`,
				courseId: courseId,
			},
			200
		);
	} catch (error) {
		console.error("Delete lecture error:", error);
		return c.json(
			{ error: "An error occurred while deleting the lecture" },
			500
		);
	}
};

// Mark a lecture as completed by a student
export const markLectureComplete = async (
	c: Context<AppEnv, "/lectures/:lectureId/complete", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const lectureId = c.req.param("lectureId");
		if (!lectureId) {
			return c.json({ error: "Lecture ID is required" }, 400);
		}

		// Get the lecture with its section and course
		const lecture = await prisma.lecture.findUnique({
			where: { id: parseInt(lectureId) },
			include: {
				section: {
					include: {
						course: true,
					},
				},
			},
		});

		if (!lecture) {
			return c.json({ error: "Lecture not found" }, 404);
		}

		// Check if the lecture has a section (must be part of a course)
		if (!lecture.sectionId || !lecture.section?.course) {
			return c.json(
				{ error: "This lecture is not part of a course" },
				400
			);
		}

		const course = lecture.section.course;

		// Check if user is enrolled in the course
		const enrollment = await prisma.enrollment.findFirst({
			where: {
				studentId: parseInt(userId),
				courseId: course.id,
			},
		});

		if (!enrollment) {
			return c.json(
				{ error: "You are not enrolled in this course" },
				403
			);
		}

		// Create or update lecture status to COMPLETED
		const existingStatus = await prisma.lectureStatus.findFirst({
			where: {
				studentId: parseInt(userId),
				lectureId: parseInt(lectureId),
			},
		});

		let lectureStatus;
		if (existingStatus) {
			// Update existing status
			lectureStatus = await prisma.lectureStatus.update({
				where: { id: existingStatus.id },
				data: { status: "COMPLETED" },
			});
		} else {
			// Create new status
			lectureStatus = await prisma.lectureStatus.create({
				data: {
					studentId: parseInt(userId),
					lectureId: parseInt(lectureId),
					status: "COMPLETED",
				},
			});
		}

		// Calculate course progress
		// Get all lectures in the course
		const allLectures = await prisma.lecture.findMany({
			where: {
				section: {
					courseId: course.id,
				},
			},
		});

		// Get completed lectures for this student in this course
		const completedLectures = await prisma.lectureStatus.findMany({
			where: {
				studentId: parseInt(userId),
				status: "COMPLETED",
				lecture: {
					section: {
						courseId: course.id,
					},
				},
			},
		});

		// Calculate progress percentage
		const progress = allLectures.length > 0
			? Math.round((completedLectures.length / allLectures.length) * 100)
			: 0;

		return c.json({
			success: true,
			status: lectureStatus.status,
			progress,
			message: "Lecture marked as completed successfully",
		});
	} catch (error) {
		console.error("Mark lecture complete error:", error);
		return c.json(
			{
				status: "error",
				message: "An error occurred, please try again later",
			},
			400
		);
	}
};

// View a lecture - accessible by enrolled students or course instructor
export const viewLecture = async (
	c: Context<AppEnv, "/lectures/:lectureId/view", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const lectureId = c.req.param("lectureId");
		if (!lectureId) {
			return c.json({ error: "Lecture ID is required" }, 400);
		}

		// Get the lecture with all related data
		const lecture = await prisma.lecture.findUnique({
			where: { id: parseInt(lectureId) },
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
				section: {
					include: {
						course: {
							include: {
								instructor: {
									select: {
										id: true,
										username: true,
										email: true,
									},
								},
							},
						},
					},
				},
			},
		});

		if (!lecture) {
			return c.json({ error: "Lecture not found" }, 404);
		}

		// Check if user is the instructor
		const isInstructor = lecture.instructorId === parseInt(userId);

		// If not instructor and lecture is part of a course, check enrollment
		let isEnrolled = false;
		if (!isInstructor && lecture.section?.course) {
			const enrollment = await prisma.enrollment.findFirst({
				where: {
					studentId: parseInt(userId),
					courseId: lecture.section.course.id,
				},
			});
			isEnrolled = !!enrollment;
		}

		// If not instructor and not enrolled (or standalone lecture), deny access
		if (!isInstructor && lecture.section?.course && !isEnrolled) {
			return c.json(
				{ error: "You must be enrolled in the course to view this lecture" },
				403
			);
		}

		// Get lecture completion status if user is a student
		let lectureStatus = null;
		if (!isInstructor && lecture.section?.course) {
			lectureStatus = await prisma.lectureStatus.findFirst({
				where: {
					studentId: parseInt(userId),
					lectureId: parseInt(lectureId),
				},
			});
		}

		return c.json({
			lecture: {
				id: lecture.id,
				title: lecture.title,
				contentType: lecture.contentType,
				description: lecture.description,
				order: lecture.order,
				duration: lecture.duration,
				videoUrl: lecture.videoUrl,
				liveUrl: lecture.liveUrl,
				scheduledTime: lecture.scheduledTime,
				recordingUrl: lecture.recordingUrl,
				content: lecture.content,
				instructor: lecture.instructor,
				section: lecture.section,
				completionStatus: lectureStatus?.status || null,
			},
			isInstructor,
			isEnrolled,
		});
	} catch (error) {
		console.error("View lecture error:", error);
		return c.json(
			{ error: "An error occurred while viewing the lecture" },
			500
		);
	}
};

// Update the order of lectures within a section
export const updateLecturesOrder = async (
	c: Context<AppEnv, "/sections/:sectionId/lectures/order", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const sectionId = c.req.param("sectionId");
		if (!sectionId) {
			return c.json({ error: "Section ID is required" }, 400);
		}

		// Get the section with course details
		const section = await prisma.section.findUnique({
			where: { id: parseInt(sectionId) },
			include: {
				course: true,
			},
		});

		if (!section) {
			return c.json({ error: "Section not found" }, 404);
		}

		// Verify the user is the instructor of the course
		if (section.course.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the course instructor can reorder lectures" },
				403
			);
		}

		const body = await c.req.json();
		const lectures = body.lectures;

		if (!lectures || !Array.isArray(lectures)) {
			return c.json(
				{ error: "Lectures array is required" },
				400
			);
		}

		// Update the order for each lecture
		for (const lectureData of lectures) {
			const lectureId = lectureData.id;
			const newOrder = lectureData.order;

			if (!lectureId || newOrder === undefined) {
				continue;
			}

			// Verify the lecture belongs to this section
			const lecture = await prisma.lecture.findFirst({
				where: {
					id: parseInt(lectureId),
					sectionId: parseInt(sectionId),
				},
			});

			if (!lecture) {
				return c.json(
					{ error: `Lecture ${lectureId} not found in this section` },
					404
				);
			}

			// Update the lecture order
			await prisma.lecture.update({
				where: { id: parseInt(lectureId) },
				data: { order: parseInt(newOrder) },
			});
		}

		return c.json({
			status: "success",
			message: "Lecture order updated successfully",
		});
	} catch (error) {
		console.error("Update lectures order error:", error);
		return c.json(
			{
				status: "error",
				message: "An error occurred, please try again later",
			},
			400
		);
	}
};

