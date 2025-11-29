import { Context } from "hono";
import { BlankInput } from "hono/types";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

// Add a new section to a course
export const addSection = async (
	c: Context<AppEnv, "/courses/:courseId/sections", BlankInput>
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

		const body = await c.req.json();
		const { title, order = 0 } = body;

		if (!title || title.trim() === "") {
			return c.json({ error: "Section title is required" }, 400);
		}

		// Sanitize input
		const sanitizedTitle = title.trim();
		const sanitizedOrder = parseInt(order.toString()) || 0;

		// Verify the course exists
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
			include: {
				instructor: {
					select: {
						id: true,
						username: true,
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
				{ error: "Only the course instructor can add sections" },
				403
			);
		}

		// Create the section
		const section = await prisma.section.create({
			data: {
				courseId: course.id,
				title: sanitizedTitle,
				order: sanitizedOrder,
			},
			include: {
				course: {
					select: {
						id: true,
						title: true,
						instructor: {
							select: {
								id: true,
								username: true,
							},
						},
					},
				},
			},
		});

		return c.json(
			{
				message: `Section '${sanitizedTitle}' was added successfully!`,
				section: {
					id: section.id,
					title: section.title,
					order: section.order,
					courseId: section.courseId,
					course: section.course,
				},
			},
			201
		);
	} catch (error) {
		console.error("Add section error:", error);
		return c.json(
			{ error: "An error occurred while adding the section" },
			500
		);
	}
};

// Get all sections for a course
export const getCourseSections = async (
	c: Context<AppEnv, "/courses/:courseId/sections", BlankInput>
) => {
	try {
		const courseId = c.req.param("courseId");
		if (!courseId) {
			return c.json({ error: "Course ID is required" }, 400);
		}

		// Verify the course exists
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
		});

		if (!course) {
			return c.json({ error: "Course not found" }, 404);
		}

		// Get all sections for the course ordered by the order field
		const sections = await prisma.section.findMany({
			where: { courseId: parseInt(courseId) },
			orderBy: { order: "asc" },
			include: {
				lectures: {
					orderBy: { order: "asc" },
					select: {
						id: true,
						title: true,
						contentType: true,
						duration: true,
						order: true,
					},
				},
			},
		});

		return c.json(
			{
				courseId: parseInt(courseId),
				sectionsCount: sections.length,
				sections,
			},
			200
		);
	} catch (error) {
		console.error("Get sections error:", error);
		return c.json(
			{ error: "An error occurred while fetching sections" },
			500
		);
	}
};

// Update a section
export const updateSection = async (
	c: Context<AppEnv, "/courses/:courseId/sections/:sectionId", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const courseId = c.req.param("courseId");
		const sectionId = c.req.param("sectionId");

		if (!courseId || !sectionId) {
			return c.json({ error: "Course ID and Section ID are required" }, 400);
		}

		const body = await c.req.json();
		const { title, description, order } = body;

		// Verify the course exists and user is the instructor
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
		});

		if (!course) {
			return c.json({ error: "Course not found" }, 404);
		}

		if (course.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the course instructor can update sections" },
				403
			);
		}

		// Verify the section exists and belongs to this course
		const existingSection = await prisma.section.findUnique({
			where: { id: parseInt(sectionId) },
		});

		if (!existingSection) {
			return c.json({ error: "Section not found" }, 404);
		}

		if (existingSection.courseId !== parseInt(courseId)) {
			return c.json(
				{ error: "Section does not belong to this course" },
				400
			);
		}

		// Prepare update data
		const updateData: any = {};
		if (title !== undefined) updateData.title = title.trim();
		if (description !== undefined) updateData.description = description?.trim() || null;
		if (order !== undefined) updateData.order = parseInt(order.toString()) || 0;

		// Update the section
		const updatedSection = await prisma.section.update({
			where: { id: parseInt(sectionId) },
			data: updateData,
			include: {
				course: {
					select: {
						id: true,
						title: true,
					},
				},
			},
		});

		return c.json(
			{
				message: `Section '${updatedSection.title}' was edited successfully!`,
				section: updatedSection,
			},
			200
		);
	} catch (error) {
		console.error("Update section error:", error);
		return c.json(
			{ error: "An error occurred while updating the section" },
			500
		);
	}
};

// Get a single section's data for editing
export const getSectionData = async (
	c: Context<AppEnv, "/courses/:courseId/sections/:sectionId", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const courseId = c.req.param("courseId");
		const sectionId = c.req.param("sectionId");

		if (!courseId || !sectionId) {
			return c.json({ error: "Course ID and Section ID are required" }, 400);
		}

		// Verify the course exists and user is the instructor
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
		});

		if (!course) {
			return c.json({ error: "Course not found" }, 404);
		}

		if (course.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the course instructor can view section data" },
				403
			);
		}

		// Get the section
		const section = await prisma.section.findUnique({
			where: { id: parseInt(sectionId) },
		});

		if (!section) {
			return c.json({ error: "Section not found" }, 404);
		}

		if (section.courseId !== parseInt(courseId)) {
			return c.json(
				{ error: "Section does not belong to this course" },
				400
			);
		}

		return c.json(
			{
				id: section.id,
				title: section.title,
				description: section.description,
			},
			200
		);
	} catch (error) {
		console.error("Get section data error:", error);
		return c.json(
			{ error: "An error occurred while fetching section data" },
			500
		);
	}
};

// Update the order of sections
export const updateSectionsOrder = async (
	c: Context<AppEnv, "/courses/:courseId/sections/order", BlankInput>
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

		// Verify the course exists and user is the instructor
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
		});

		if (!course) {
			return c.json({ error: "Course not found" }, 404);
		}

		if (course.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the course instructor can update section order" },
				403
			);
		}

		const body = await c.req.json();
		const { sections } = body;

		if (!sections || !Array.isArray(sections)) {
			return c.json({ error: "Sections array is required" }, 400);
		}

		// Update the order of each section
		for (const sectionData of sections) {
			const { id, order } = sectionData;

			if (!id || order === undefined) {
				continue; // Skip invalid entries
			}

			// Verify the section belongs to this course
			const section = await prisma.section.findUnique({
				where: { id: parseInt(id) },
			});

			if (!section || section.courseId !== parseInt(courseId)) {
				continue; // Skip sections that don't belong to this course
			}

			// Update the section order
			await prisma.section.update({
				where: { id: parseInt(id) },
				data: { order: parseInt(order.toString()) },
			});
		}

		return c.json({ status: "success" }, 200);
	} catch (error) {
		console.error("Update sections order error:", error);
		return c.json(
			{
				status: "error",
				message: "An error occurred, please try again later",
			},
			400
		);
	}
};

// Delete a section
export const deleteSection = async (
	c: Context<AppEnv, "/courses/:courseId/sections/:sectionId", BlankInput>
) => {
	try {
		const userId = c.get("userId");
		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const courseId = c.req.param("courseId");
		const sectionId = c.req.param("sectionId");

		if (!courseId || !sectionId) {
			return c.json({ error: "Course ID and Section ID are required" }, 400);
		}

		// Verify the course exists and user is the instructor
		const course = await prisma.course.findUnique({
			where: { id: parseInt(courseId) },
		});

		if (!course) {
			return c.json({ error: "Course not found" }, 404);
		}

		if (course.instructorId !== parseInt(userId)) {
			return c.json(
				{ error: "Only the course instructor can delete sections" },
				403
			);
		}

		// Verify the section exists and belongs to this course
		const existingSection = await prisma.section.findUnique({
			where: { id: parseInt(sectionId) },
		});

		if (!existingSection) {
			return c.json({ error: "Section not found" }, 404);
		}

		if (existingSection.courseId !== parseInt(courseId)) {
			return c.json(
				{ error: "Section does not belong to this course" },
				400
			);
		}

		// Delete the section (will cascade delete associated lectures)
		await prisma.section.delete({
			where: { id: parseInt(sectionId) },
		});

		// Re-order remaining sections
		const remainingSections = await prisma.section.findMany({
			where: { courseId: parseInt(courseId) },
			orderBy: { order: "asc" },
		});

		// Update order for each remaining section sequentially
		for (let i = 0; i < remainingSections.length; i++) {
			await prisma.section.update({
				where: { id: remainingSections[i].id },
				data: { order: i + 1 },
			});
		}

		return c.json(
			{
				message: `Section '${existingSection.title}' was deleted successfully!`,
			},
			200
		);
	} catch (error) {
		console.error("Delete section error:", error);
		return c.json(
			{ error: "An error occurred while deleting the section" },
			500
		);
	}
};
