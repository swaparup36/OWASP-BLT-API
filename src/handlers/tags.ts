import { Context } from "hono";
import prisma from "../utils/db";

// Format tag data for response
function formatTagResponse(tag: any) {
	return {
		id: tag.id,
		name: tag.name,
		slug: tag.slug,
		created: tag.created,
	};
}

// List all tags with search filtering and pagination
export async function listTags(c: Context) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		const searchQuery = searchParams.get("search");
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("page_size") || "10");

		const where: any = {};

		if (searchQuery) {
			where.OR = [
				{ name: { contains: searchQuery, mode: "insensitive" } },
				{ slug: { contains: searchQuery, mode: "insensitive" } },
			];
		}

		// Pagination and fetching tags
		const totalCount = await prisma.tag.count({ where });
		const tags = await prisma.tag.findMany({
			where,
			skip: (page - 1) * pageSize,
			take: pageSize,
			orderBy: {
				created: "desc",
			},
		});

		const formattedTags = tags.map(formatTagResponse);

		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		return c.json({
			count: totalCount,
			next: hasNext ? `${url.pathname}?page=${page + 1}&page_size=${pageSize}` : null,
			previous: hasPrevious ? `${url.pathname}?page=${page - 1}&page_size=${pageSize}` : null,
			results: formattedTags,
		});
	} catch (error) {
		console.error("Error listing tags:", error);
		return c.json({ error: "Failed to retrieve tags" }, 500);
	}
}

// Retrieve a single tag by ID
export async function retrieveTag(c: Context) {
	try {
		const tagId = parseInt(c.req.param("id"));

		if (isNaN(tagId)) {
			return c.json({ error: "Invalid tag ID" }, 400);
		}

		const tag = await prisma.tag.findUnique({
			where: { id: tagId },
		});

		if (!tag) {
			return c.json({ error: "Tag not found" }, 404);
		}

		return c.json(formatTagResponse(tag));
	} catch (error) {
		console.error("Error retrieving tag:", error);
		return c.json({ error: "Failed to retrieve tag" }, 500);
	}
}

// Create a new tag
export async function createTag(c: Context) {
	try {
		const body = await c.req.json();
		const { name, slug } = body;

		if (!name || !slug) {
			return c.json({ error: "Name and slug are required" }, 400);
		}

		// Check if tag with same slug already exists
		const existingTag = await prisma.tag.findUnique({
			where: { slug },
		});

		if (existingTag) {
			return c.json({ error: "Tag with this slug already exists" }, 400);
		}

		// Create the tag
		const tag = await prisma.tag.create({
			data: {
				name,
				slug,
			},
		});

		return c.json(formatTagResponse(tag), 201);
	} catch (error) {
		console.error("Error creating tag:", error);
		return c.json({ error: "Failed to create tag" }, 500);
	}
}

// Update an existing tag
export async function updateTag(c: Context) {
	try {
		const tagId = parseInt(c.req.param("id"));

		if (isNaN(tagId)) {
			return c.json({ error: "Invalid tag ID" }, 400);
		}

		const body = await c.req.json();
		const { name, slug } = body;

		// Check if tag exists
		const existingTag = await prisma.tag.findUnique({
			where: { id: tagId },
		});

		if (!existingTag) {
			return c.json({ error: "Tag not found" }, 404);
		}

		// If slug is being updated - check for conflicts
		if (slug && slug !== existingTag.slug) {
			const slugConflict = await prisma.tag.findUnique({
				where: { slug },
			});

			if (slugConflict) {
				return c.json({ error: "Tag with this slug already exists" }, 400);
			}
		}

		// Update the tag
		const tag = await prisma.tag.update({
			where: { id: tagId },
			data: {
				...(name && { name }),
				...(slug && { slug }),
			},
		});

		return c.json(formatTagResponse(tag));
	} catch (error) {
		console.error("Error updating tag:", error);
		return c.json({ error: "Failed to update tag" }, 500);
	}
}

// Delete a tag
export async function deleteTag(c: Context) {
	try {
		const tagId = parseInt(c.req.param("id"));

		if (isNaN(tagId)) {
			return c.json({ error: "Invalid tag ID" }, 400);
		}

		// Check if tag exists
		const existingTag = await prisma.tag.findUnique({
			where: { id: tagId },
		});

		if (!existingTag) {
			return c.json({ error: "Tag not found" }, 404);
		}

		// Delete the tag
		await prisma.tag.delete({
			where: { id: tagId },
		});

		return c.body(null, 204);
	} catch (error) {
		console.error("Error deleting tag:", error);
		return c.json({ error: "Failed to delete tag" }, 500);
	}
}

// HEAD request to check tag count
export async function headTags(c: Context) {
	try {
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		const searchQuery = searchParams.get("search");

		const where: any = {};

		if (searchQuery) {
			where.OR = [
				{ name: { contains: searchQuery, mode: "insensitive" } },
				{ slug: { contains: searchQuery, mode: "insensitive" } },
			];
		}

		const totalCount = await prisma.tag.count({ where });

		return c.body(null, 200, {
			"X-Total-Count": totalCount.toString(),
		});
	} catch (error) {
		console.error("Error in HEAD tags:", error);
		return c.body(null, 500);
	}
}
