import { Context } from "hono";
import { BlankInput } from "hono/types";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

// This endpoint allows authenticated users to enroll in a course
export const enrollInCourse = async (
	c: Context<AppEnv, "/courses/:courseId/enroll", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ success: false, message: "Unauthorized. Please login to enroll in courses." }, 401);
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

		// Verify the course exists
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
			select: {
				id: true,
				title: true,
				description: true,
				level: true,
				thumbnail: true,
				instructor: {
					select: {
						id: true,
						username: true,
						email: true,
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

		// Verify the user exists
		const user = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
			select: {
				id: true,
				username: true,
				email: true,
			},
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

		// Check if the user is already enrolled
		const existingEnrollment = await prisma.enrollment.findUnique({
			where: {
				studentId_courseId: {
					studentId: parseInt(userId),
					courseId: parseInt(courseId),
				},
			},
		});

		if (existingEnrollment) {
			return c.json(
				{
					success: true,
					message: "You are already enrolled in this course.",
					enrollment: {
						id: existingEnrollment.id,
						enrolledAt: existingEnrollment.enrolledAt,
						completed: existingEnrollment.completed,
						lastAccessed: existingEnrollment.lastAccessed,
					},
					course: {
						id: course.id,
						title: course.title,
						description: course.description,
						level: course.level,
						thumbnail: course.thumbnail,
						instructor: course.instructor,
					},
				},
				200
			);
		}

		// Create the enrollment
		const enrollment = await prisma.enrollment.create({
			data: {
				studentId: parseInt(userId),
				courseId: parseInt(courseId),
			},
			include: {
				course: {
					select: {
						id: true,
						title: true,
						description: true,
						level: true,
						thumbnail: true,
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
		});

		return c.json(
			{
				success: true,
				message: "You have been successfully enrolled in the course.",
				enrollment: {
					id: enrollment.id,
					enrolledAt: enrollment.enrolledAt,
					completed: enrollment.completed,
					lastAccessed: enrollment.lastAccessed,
				},
				course: enrollment.course,
			},
			201
		);
	} catch (error) {
		console.error("Error in enrollInCourse:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred while enrolling in the course. Please try again later.",
			},
			500
		);
	}
};

// Get user's enrollments
export const getUserEnrollments = async (
	c: Context<AppEnv, "/enrollments", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ success: false, message: "Unauthorized" }, 401);
		}

		const enrollments = await prisma.enrollment.findMany({
			where: {
				studentId: parseInt(userId),
			},
			include: {
				course: {
					select: {
						id: true,
						title: true,
						description: true,
						level: true,
						thumbnail: true,
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
			orderBy: {
				enrolledAt: "desc",
			},
		});

		return c.json(
			{
				success: true,
				count: enrollments.length,
				enrollments: enrollments.map((enrollment) => ({
					id: enrollment.id,
					enrolledAt: enrollment.enrolledAt,
					completed: enrollment.completed,
					lastAccessed: enrollment.lastAccessed,
					course: enrollment.course,
				})),
			},
			200
		);
	} catch (error) {
		console.error("Error in getUserEnrollments:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred while fetching enrollments. Please try again later.",
			},
			500
		);
	}
};


// Unenroll from a course
export const unenrollFromCourse = async (
	c: Context<AppEnv, "/courses/:courseId/enroll", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ success: false, message: "Unauthorized" }, 401);
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

		// Check if the enrollment exists
		const enrollment = await prisma.enrollment.findUnique({
			where: {
				studentId_courseId: {
					studentId: parseInt(userId),
					courseId: parseInt(courseId),
				},
			},
		});

		if (!enrollment) {
			return c.json(
				{
					success: false,
					message: "You are not enrolled in this course.",
				},
				404
			);
		}

		// Delete the enrollment
		await prisma.enrollment.delete({
			where: {
				id: enrollment.id,
			},
		});

		return c.json(
			{
				success: true,
				message: "You have been successfully unenrolled from the course.",
			},
			200
		);
	} catch (error) {
		console.error("Error in unenrollFromCourse:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred while unenrolling from the course. Please try again later.",
			},
			500
		);
	}
};

// Update enrollment progress
export const updateEnrollment = async (
	c: Context<AppEnv, "/courses/:courseId/enroll", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ success: false, message: "Unauthorized" }, 401);
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

		const body = await c.req.json();
		const { completed, lastAccessed } = body;

		// Check if the enrollment exists
		const enrollment = await prisma.enrollment.findUnique({
			where: {
				studentId_courseId: {
					studentId: parseInt(userId),
					courseId: parseInt(courseId),
				},
			},
		});

		if (!enrollment) {
			return c.json(
				{
					success: false,
					message: "You are not enrolled in this course.",
				},
				404
			);
		}

		// Update the enrollment
		const updateData: any = {};
		if (typeof completed === "boolean") {
			updateData.completed = completed;
		}
		if (lastAccessed) {
			updateData.lastAccessed = new Date(lastAccessed);
		} else {
			// Update last accessed to current time if not provided
			updateData.lastAccessed = new Date();
		}

		const updatedEnrollment = await prisma.enrollment.update({
			where: {
				id: enrollment.id,
			},
			data: updateData,
			include: {
				course: {
					select: {
						id: true,
						title: true,
						description: true,
						level: true,
						thumbnail: true,
					},
				},
			},
		});

		return c.json(
			{
				success: true,
				message: "Enrollment updated successfully.",
				enrollment: {
					id: updatedEnrollment.id,
					enrolledAt: updatedEnrollment.enrolledAt,
					completed: updatedEnrollment.completed,
					lastAccessed: updatedEnrollment.lastAccessed,
					course: updatedEnrollment.course,
				},
			},
			200
		);
	} catch (error) {
		console.error("Error in updateEnrollment:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred while updating enrollment. Please try again later.",
			},
			500
		);
	}
};

// Check enrollment status
export const checkEnrollmentStatus = async (
	c: Context<AppEnv, "/courses/:courseId/enroll/status", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ success: false, message: "Unauthorized" }, 401);
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

		const enrollment = await prisma.enrollment.findUnique({
			where: {
				studentId_courseId: {
					studentId: parseInt(userId),
					courseId: parseInt(courseId),
				},
			},
			select: {
				id: true,
				enrolledAt: true,
				completed: true,
				lastAccessed: true,
			},
		});

		if (!enrollment) {
			return c.json(
				{
					success: true,
					enrolled: false,
					message: "You are not enrolled in this course.",
				},
				200
			);
		}

		return c.json(
			{
				success: true,
				enrolled: true,
				enrollment: {
					id: enrollment.id,
					enrolledAt: enrollment.enrolledAt,
					completed: enrollment.completed,
					lastAccessed: enrollment.lastAccessed,
				},
			},
			200
		);
	} catch (error) {
		console.error("Error in checkEnrollmentStatus:", error);
		return c.json(
			{
				success: false,
				message: "An error occurred while checking enrollment status. Please try again later.",
			},
			500
		);
	}
};
