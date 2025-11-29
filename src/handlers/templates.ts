import { Context } from "hono";
import prisma from "../utils/db";
import {
	TemplateListQueryParams,
	TemplateListResponse,
	TemplateResponse,
	CreateTemplateRequest,
	UpdateTemplateRequest,
	TemplateBatchCreateRequest,
	TemplateBatchUpdateRequest,
	TemplateStatsResponse,
	TemplateFilterBy,
	TemplateSortField,
	TemplateCategory,
} from "../types/template";

// List templates with pagination, search, filtering, and sorting
export async function listTemplates(c: Context) {
	try {
		const searchQuery = c.req.query("search")?.trim() || "";
		const filterBy = (c.req.query("filter") || "all") as TemplateFilterBy;
		const sortField = (c.req.query("sort") || "name") as TemplateSortField;
		const direction = (c.req.query("dir") || "asc") as "asc" | "desc";
		const page = parseInt(c.req.query("page") || "1", 10);
		const perPage = parseInt(c.req.query("perPage") || "20", 10);
		const category = c.req.query("category") as TemplateCategory | undefined;

		const where: any = {};

		if (searchQuery) {
			where.OR = [
				{ name: { contains: searchQuery, mode: "insensitive" } },
				{ description: { contains: searchQuery, mode: "insensitive" } },
				{ path: { contains: searchQuery, mode: "insensitive" } },
			];
		}

		// Apply category filter
		if (category && Object.values(TemplateCategory).includes(category)) {
			where.category = category;
		}

		// Apply metadata filters
		if (filterBy !== TemplateFilterBy.ALL) {
			switch (filterBy) {
				case TemplateFilterBy.WITH_SIDENAV:
					where.hasSidenav = true;
					break;
				case TemplateFilterBy.WITH_BASE:
					where.extendsBase = true;
					break;
				case TemplateFilterBy.WITH_STYLES:
					where.hasStyleTags = true;
					break;
			}
		}

		// Build order by clause
		const orderBy: any = {};
		orderBy[sortField] = direction;

		// Get total count
		const total = await prisma.template.count({ where });

		// Calculate pagination
		const totalPages = Math.ceil(total / perPage);
		const skip = (page - 1) * perPage;

		// Fetch templates
		const templates = await prisma.template.findMany({
			where,
			orderBy,
			skip,
			take: perPage,
		});

		// Build response
		const response: TemplateListResponse = {
			templates: templates.map((template): TemplateResponse => ({
				id: template.id,
				name: template.name,
				path: template.path,
				category: template.category as TemplateCategory,
				description: template.description || undefined,
				hasSidenav: template.hasSidenav,
				extendsBase: template.extendsBase,
				hasStyleTags: template.hasStyleTags,
				url: template.url || undefined,
				viewCount: template.viewCount,
				modifiedAt: template.modifiedAt,
				createdAt: template.createdAt,
				updatedAt: template.updatedAt,
			})),
			pagination: {
				total,
				page,
				perPage,
				totalPages,
				hasNext: page < totalPages,
				hasPrev: page > 1,
			},
			filters: {
				search: searchQuery || undefined,
				filter: filterBy,
				sort: sortField,
				direction,
				category,
			},
		};

		return c.json(response, 200);
	} catch (error: any) {
		console.error("Error listing templates:", error);
		return c.json({ error: "Failed to list templates", message: error.message }, 500);
	}
}

// Retrieve a single template by ID
export async function retrieveTemplate(c: Context) {
	try {
		const id = parseInt(c.req.param("id"), 10);

		if (isNaN(id)) {
			return c.json({ error: "Invalid template ID" }, 400);
		}

		const template = await prisma.template.findUnique({
			where: { id },
		});

		if (!template) {
			return c.json({ error: "Template not found" }, 404);
		}

		// Increment view count
		await prisma.template.update({
			where: { id },
			data: { viewCount: { increment: 1 } },
		});

		const response: TemplateResponse = {
			id: template.id,
			name: template.name,
			path: template.path,
			category: template.category as TemplateCategory,
			description: template.description || undefined,
			hasSidenav: template.hasSidenav,
			extendsBase: template.extendsBase,
			hasStyleTags: template.hasStyleTags,
			url: template.url || undefined,
			viewCount: template.viewCount + 1,
			modifiedAt: template.modifiedAt,
			createdAt: template.createdAt,
			updatedAt: template.updatedAt,
		};

		return c.json(response, 200);
	} catch (error: any) {
		console.error("Error retrieving template:", error);
		return c.json({ error: "Failed to retrieve template", message: error.message }, 500);
	}
}

// Retrieve a template by name
export async function retrieveTemplateByName(c: Context) {
	try {
		const name = c.req.param("name");

		if (!name) {
			return c.json({ error: "Template name is required" }, 400);
		}

		const template = await prisma.template.findUnique({
			where: { name },
		});

		if (!template) {
			return c.json({ error: "Template not found" }, 404);
		}

		// Increment view count
		await prisma.template.update({
			where: { name },
			data: { viewCount: { increment: 1 } },
		});

		const response: TemplateResponse = {
			id: template.id,
			name: template.name,
			path: template.path,
			category: template.category as TemplateCategory,
			description: template.description || undefined,
			hasSidenav: template.hasSidenav,
			extendsBase: template.extendsBase,
			hasStyleTags: template.hasStyleTags,
			url: template.url || undefined,
			viewCount: template.viewCount + 1,
			modifiedAt: template.modifiedAt,
			createdAt: template.createdAt,
			updatedAt: template.updatedAt,
		};

		return c.json(response, 200);
	} catch (error: any) {
		console.error("Error retrieving template by name:", error);
		return c.json({ error: "Failed to retrieve template", message: error.message }, 500);
	}
}

// Create a new template
export async function createTemplate(c: Context) {
	try {
		const body = (await c.req.json()) as CreateTemplateRequest;

		if (!body.name || !body.path) {
			return c.json({ error: "Name and path are required" }, 400);
		}

		// Check if template already exists
		const existing = await prisma.template.findUnique({
			where: { name: body.name },
		});

		if (existing) {
			return c.json({ error: "Template with this name already exists" }, 409);
		}

		// Create template
		const template = await prisma.template.create({
			data: {
				name: body.name,
				path: body.path,
				category: body.category || TemplateCategory.OTHER,
				description: body.description,
				hasSidenav: body.hasSidenav || false,
				extendsBase: body.extendsBase || false,
				hasStyleTags: body.hasStyleTags || false,
				url: body.url,
				modifiedAt: body.modifiedAt,
			},
		});

		const response: TemplateResponse = {
			id: template.id,
			name: template.name,
			path: template.path,
			category: template.category as TemplateCategory,
			description: template.description || undefined,
			hasSidenav: template.hasSidenav,
			extendsBase: template.extendsBase,
			hasStyleTags: template.hasStyleTags,
			url: template.url || undefined,
			viewCount: template.viewCount,
			modifiedAt: template.modifiedAt,
			createdAt: template.createdAt,
			updatedAt: template.updatedAt,
		};

		return c.json(response, 201);
	} catch (error: any) {
		console.error("Error creating template:", error);
		return c.json({ error: "Failed to create template", message: error.message }, 500);
	}
}

// Batch create templates
export async function batchCreateTemplates(c: Context) {
	try {
		const body = (await c.req.json()) as TemplateBatchCreateRequest;

		if (!body.templates || !Array.isArray(body.templates) || body.templates.length === 0) {
			return c.json({ error: "Templates array is required" }, 400);
		}

		// Validate all templates
		for (const template of body.templates) {
			if (!template.name || !template.path) {
				return c.json({ error: "Each template must have name and path" }, 400);
			}
		}

		// Create all templates
		const created = await prisma.template.createMany({
			data: body.templates.map((template) => ({
				name: template.name,
				path: template.path,
				category: template.category || TemplateCategory.OTHER,
				description: template.description,
				hasSidenav: template.hasSidenav || false,
				extendsBase: template.extendsBase || false,
				hasStyleTags: template.hasStyleTags || false,
				url: template.url,
				modifiedAt: template.modifiedAt,
			})),
			skipDuplicates: true,
		});

		return c.json(
			{
				message: `Successfully created ${created.count} templates`,
				count: created.count,
			},
			201
		);
	} catch (error: any) {
		console.error("Error batch creating templates:", error);
		return c.json({ error: "Failed to batch create templates", message: error.message }, 500);
	}
}

// Update a template
export async function updateTemplate(c: Context) {
	try {
		const id = parseInt(c.req.param("id"), 10);
		const body = (await c.req.json()) as UpdateTemplateRequest;

		if (isNaN(id)) {
			return c.json({ error: "Invalid template ID" }, 400);
		}

		// Check if template exists
		const existing = await prisma.template.findUnique({
			where: { id },
		});

		if (!existing) {
			return c.json({ error: "Template not found" }, 404);
		}

		// Check for name conflicts if name is being updated
		if (body.name && body.name !== existing.name) {
			const nameExists = await prisma.template.findUnique({
				where: { name: body.name },
			});

			if (nameExists) {
				return c.json({ error: "Template with this name already exists" }, 409);
			}
		}

		// Update template
		const template = await prisma.template.update({
			where: { id },
			data: {
				name: body.name,
				path: body.path,
				category: body.category,
				description: body.description,
				hasSidenav: body.hasSidenav,
				extendsBase: body.extendsBase,
				hasStyleTags: body.hasStyleTags,
				url: body.url,
				modifiedAt: body.modifiedAt,
			},
		});

		const response: TemplateResponse = {
			id: template.id,
			name: template.name,
			path: template.path,
			category: template.category as TemplateCategory,
			description: template.description || undefined,
			hasSidenav: template.hasSidenav,
			extendsBase: template.extendsBase,
			hasStyleTags: template.hasStyleTags,
			url: template.url || undefined,
			viewCount: template.viewCount,
			modifiedAt: template.modifiedAt,
			createdAt: template.createdAt,
			updatedAt: template.updatedAt,
		};

		return c.json(response, 200);
	} catch (error: any) {
		console.error("Error updating template:", error);
		return c.json({ error: "Failed to update template", message: error.message }, 500);
	}
}

// Batch update templates
export async function batchUpdateTemplates(c: Context) {
	try {
		const body = (await c.req.json()) as TemplateBatchUpdateRequest;

		if (!body.updates || !Array.isArray(body.updates) || body.updates.length === 0) {
			return c.json({ error: "Updates array is required" }, 400);
		}

		// Update templates using transaction
		const results = await prisma.$transaction(
			body.updates.map((update) =>
				prisma.template.update({
					where: { id: update.id },
					data: update.data,
				})
			)
		);

		return c.json(
			{
				message: `Successfully updated ${results.length} templates`,
				count: results.length,
			},
			200
		);
	} catch (error: any) {
		console.error("Error batch updating templates:", error);
		return c.json({ error: "Failed to batch update templates", message: error.message }, 500);
	}
}

// Delete a template
export async function deleteTemplate(c: Context) {
	try {
		const id = parseInt(c.req.param("id"), 10);

		if (isNaN(id)) {
			return c.json({ error: "Invalid template ID" }, 400);
		}

		// Check if template exists
		const existing = await prisma.template.findUnique({
			where: { id },
		});

		if (!existing) {
			return c.json({ error: "Template not found" }, 404);
		}

		// Delete template
		await prisma.template.delete({
			where: { id },
		});

		return c.json({ message: "Template deleted successfully" }, 200);
	} catch (error: any) {
		console.error("Error deleting template:", error);
		return c.json({ error: "Failed to delete template", message: error.message }, 500);
	}
}

// Get template statistics
export async function getTemplateStats(c: Context) {
	try {
		const totalTemplates = await prisma.template.count();

		// Get total views
		const viewsResult = await prisma.template.aggregate({
			_sum: {
				viewCount: true,
			},
		});

		// Get category counts
		const categoryGroups = await prisma.template.groupBy({
			by: ["category"],
			_count: true,
		});

		const categoryCounts: Record<string, number> = {};
		for (const group of categoryGroups) {
			categoryCounts[group.category] = group._count;
		}

		// Get filter counts
		const withSidenav = await prisma.template.count({
			where: { hasSidenav: true },
		});

		const withBase = await prisma.template.count({
			where: { extendsBase: true },
		});

		const withStyles = await prisma.template.count({
			where: { hasStyleTags: true },
		});

		const response: TemplateStatsResponse = {
			totalTemplates,
			totalViews: viewsResult._sum.viewCount || 0,
			categoryCounts: categoryCounts as Record<TemplateCategory, number>,
			filterCounts: {
				withSidenav,
				withBase,
				withStyles,
			},
		};

		return c.json(response, 200);
	} catch (error: any) {
		console.error("Error getting template stats:", error);
		return c.json({ error: "Failed to get template statistics", message: error.message }, 500);
	}
}

// HEAD request for templates list
export async function headTemplates(c: Context) {
	try {
		const total = await prisma.template.count();

		c.header("X-Total-Count", total.toString());
		return c.body(null, 200);
	} catch (error: any) {
		console.error("Error in HEAD request:", error);
		return c.body(null, 500);
	}
}
