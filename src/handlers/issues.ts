import { Context } from "hono";
import prisma from "../utils/db";
import { validateImage, generateUniqueFilename, uploadToR2 } from "../utils/file-upload";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type IssueContext = Context<AppEnv>;

// Helper function to get issue with all related data
async function getIssueWithRelations(issueId: number, userId?: string) {
	return await prisma.issue.findUnique({
		where: { id: issueId },
		include: {
			user: {
				select: {
					id: true,
					username: true,
					email: true,
				},
			},
			domain: {
				select: {
					id: true,
					name: true,
					url: true,
				},
			},
			assignedUser: {
				select: {
					id: true,
					username: true,
				},
			},
			closedBy: {
				select: {
					id: true,
					username: true,
				},
			},
			screenshots: {
				include: {
					user: {
						select: {
							id: true,
							username: true,
						},
					},
				},
				orderBy: {
					created: "desc",
				},
			},
			tags: true,
			upvotedBy: userId
				? {
						where: {
							userId: parseInt(userId),
						},
						select: {
							id: true,
						},
				  }
				: false,
			flaggedBy: userId
				? {
						where: {
							userId: parseInt(userId),
						},
						select: {
							id: true,
						},
				  }
				: false,
			_count: {
				select: {
					upvotedBy: true,
					flaggedBy: true,
				},
			},
		},
	});
}

// Format issue data for response
function formatIssueResponse(issue: any, baseUrl: string) {
	const screenshots = issue.screenshots.map((screenshot: any) => {
		// Build absolute URL for each screenshot
		return `${baseUrl}/${screenshot.image}`;
	});

	// Add legacy screenshot field if it exists
	if (issue.screenshot) {
		screenshots.unshift(`${baseUrl}/${issue.screenshot}`);
	}

	return {
		id: issue.id,
		url: issue.url,
		description: issue.description,
		markdown_description: issue.markdownDescription,
		label: issue.label,
		views: issue.views,
		verified: issue.verified,
		score: issue.score,
		status: issue.status,
		user_agent: issue.userAgent,
		ocr: issue.ocr,
		screenshot: issue.screenshot,
		github_url: issue.githubUrl,
		created: issue.created,
		modified: issue.modified,
		is_hidden: issue.isHidden,
		rewarded: issue.rewarded,
		reporter_ip_address: issue.reporterIpAddress,
		cve_id: issue.cveId,
		cve_score: issue.cveScore,
		public: issue.public,
		token_value: issue.tokenValue,
		user: issue.user
			? {
					id: issue.user.id,
					username: issue.user.username,
			  }
			: null,
		domain: issue.domain
			? {
					id: issue.domain.id,
					name: issue.domain.name,
					url: issue.domain.url,
			  }
			: null,
		assigned_user: issue.assignedUser
			? {
					id: issue.assignedUser.id,
					username: issue.assignedUser.username,
			  }
			: null,
		closed_by: issue.closedBy?.username || null,
		closed_date: issue.closedDate,
		screenshots: screenshots,
		tags: issue.tags || [],
		upvotes: issue._count?.upvotedBy || 0,
		upvotted: issue.upvotedBy ? issue.upvotedBy.length > 0 : false,
		flags: issue._count?.flaggedBy || 0,
		flagged: issue.flaggedBy ? issue.flaggedBy.length > 0 : false,
	};
}

// List all issues with filtering and pagination
export async function listIssues(c: IssueContext) {
	try {
		const userId = c.get("userId");
		const url = new URL(c.req.url);
		const searchParams = url.searchParams;
		const status = searchParams.get("status");
		const domainUrl = searchParams.get("domain");
		const searchQuery = searchParams.get("search");
		const page = parseInt(searchParams.get("page") || "1");
		const pageSize = parseInt(searchParams.get("page_size") || "10");

		const where: any = {};

		if (userId) {
			where.OR = [{ isHidden: false }, { isHidden: true, userId: parseInt(userId) }];
		} else {
			where.isHidden = false;
		}

		if (status) {
			where.status = status;
		}

		if (domainUrl) {
			where.domain = {
				url: domainUrl,
			};
		}

		if (searchQuery) {
			where.OR = [
				{ url: { contains: searchQuery, mode: "insensitive" } },
				{ description: { contains: searchQuery, mode: "insensitive" } },
				{ userId: isNaN(parseInt(searchQuery)) ? undefined : parseInt(searchQuery) },
			].filter((condition) => condition.userId !== undefined || condition.url || condition.description);
		}

        // Paginate and fetch issues
		const totalCount = await prisma.issue.count({ where });
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
				domain: {
					select: {
						id: true,
						name: true,
						url: true,
					},
				},
				assignedUser: {
					select: {
						id: true,
						username: true,
					},
				},
				closedBy: {
					select: {
						id: true,
						username: true,
					},
				},
				screenshots: {
					include: {
						user: {
							select: {
								id: true,
								username: true,
							},
						},
					},
					orderBy: {
						created: "desc",
					},
				},
				tags: true,
				upvotedBy: userId
					? {
							where: {
								userId: parseInt(userId),
							},
							select: {
								id: true,
							},
					  }
					: false,
				flaggedBy: userId
					? {
							where: {
								userId: parseInt(userId),
							},
							select: {
								id: true,
							},
					  }
					: false,
				_count: {
					select: {
						upvotedBy: true,
						flaggedBy: true,
					},
				},
			},
			skip: (page - 1) * pageSize,
			take: pageSize,
			orderBy: {
				created: "desc",
			},
		});

		// Get base URL for building absolute URLs
		const baseUrl = `${url.protocol}//${url.host}`;

		// Format issues for response
		const formattedIssues = issues.map((issue) => formatIssueResponse(issue, baseUrl));

		// Build pagination response
		const totalPages = Math.ceil(totalCount / pageSize);
		const hasNext = page < totalPages;
		const hasPrevious = page > 1;

		return c.json({
			count: totalCount,
			next: hasNext ? `${url.pathname}?page=${page + 1}&page_size=${pageSize}` : null,
			previous: hasPrevious ? `${url.pathname}?page=${page - 1}&page_size=${pageSize}` : null,
			results: formattedIssues,
		});
	} catch (error) {
		console.error("Error listing issues:", error);
		return c.json({ error: "Failed to retrieve issues" }, 500);
	}
}


// Retrieve a single issue by ID
export async function retrieveIssue(c: IssueContext) {
	try {
		const userId = c.get("userId");
		const issueId = parseInt(c.req.param("id"));

		if (isNaN(issueId)) {
			return c.json({ error: "Invalid issue ID" }, 400);
		}

		const issue = await getIssueWithRelations(issueId, userId);

		if (!issue) {
			return c.json({ error: "Issue not found" }, 404);
		}

		// Check if user has permission to view hidden issues
		if (issue.isHidden && (!userId || issue.userId !== parseInt(userId))) {
			return c.json({ error: "Issue not found" }, 404);
		}

		// Get base URL for building absolute URLs
		const url = new URL(c.req.url);
		const baseUrl = `${url.protocol}//${url.host}`;

		// Increment view count
		await prisma.issue.update({
			where: { id: issueId },
			data: { views: { increment: 1 } },
		});

		return c.json(formatIssueResponse(issue, baseUrl));
	} catch (error) {
		console.error("Error retrieving issue:", error);
		return c.json({ error: "Failed to retrieve issue" }, 500);
	}
}

// Create a new issue with screenshots and tags
export async function createIssue(c: Context) {
	try {
		const userId = c.get("userId") as string | undefined;

		if (!userId) {
			return c.json({ error: "Authentication required" }, 401);
		}

		const formData = await c.req.formData();
		let tags: number[] = [];
		const tagsJson = formData.get("tags");
		if (tagsJson) {
			try {
				const parsedTags = JSON.parse(tagsJson as string);
				if (Array.isArray(parsedTags)) {
					tags = parsedTags.flat().filter((tag) => typeof tag === "number");
				}
			} catch (e) {
				return c.json({ error: "Invalid tags format" }, 400);
			}
		}

		const screenshots = formData.getAll("screenshots") as File[];

		if (screenshots.length === 0) {
			return c.json({ error: "Upload at least one image!" }, 400);
		}
		if (screenshots.length > 5) {
			return c.json({ error: "Max limit of 5 images!" }, 400);
		}

		const url = formData.get("url") as string;
		const description = formData.get("description") as string;

		if (!url || !description) {
			return c.json({ error: "URL and description are required" }, 400);
		}

		const domainId = formData.get("domain_id");
		const label = formData.get("label") || "GENERAL";
		const markdownDescription = formData.get("markdown_description");
		const userAgent = formData.get("user_agent");

		// Create the issue
		const issue = await prisma.issue.create({
			data: {
				userId: parseInt(userId),
				url: url,
				description: description,
				markdownDescription: markdownDescription as string | undefined,
				label: label as any,
				userAgent: userAgent as string | undefined,
				domainId: domainId ? parseInt(domainId as string) : undefined,
				status: "open",
			},
		});

		// Connect tags if provided
		if (tags.length > 0) {
			await prisma.issue.update({
				where: { id: issue.id },
				data: {
					tags: {
						connect: tags.map((tagId) => ({ id: tagId })),
					},
				},
			});
		}

		// Process and save screenshots
		const uploadedScreenshots: string[] = [];

		for (const screenshot of screenshots) {
			// Validate image
			const validation = validateImage(screenshot);
			if (!validation.valid) {
				// Clean up any already uploaded files
				if (c.env.SCREENSHOTS_BUCKET && uploadedScreenshots.length > 0) {
					for (const path of uploadedScreenshots) {
						try {
							await c.env.SCREENSHOTS_BUCKET.delete(path);
						} catch (e) {
							console.error("Failed to clean up uploaded file:", path, e);
						}
					}
				}
				return c.json({ error: validation.error || "Invalid image" }, 400);
			}

			// Generate unique filename
			const fileName = generateUniqueFilename(screenshot.name);
			const filePath = `screenshots/${fileName}`;

			// Upload to R2 bucket
			if (c.env.SCREENSHOTS_BUCKET) {
				try {
					await uploadToR2(c.env.SCREENSHOTS_BUCKET, filePath, screenshot);
					uploadedScreenshots.push(filePath);
				} catch (uploadError) {
					console.error("Failed to upload file:", uploadError);
					// Clean up any already uploaded files
					for (const path of uploadedScreenshots) {
						try {
							await c.env.SCREENSHOTS_BUCKET.delete(path);
						} catch (e) {
							console.error("Failed to clean up uploaded file:", path, e);
						}
					}
					return c.json({ error: "Failed to upload screenshot" }, 500);
				}
			} else {
				// Fail if R2 bucket is not configured
                return c.json({ error: "Screenshot storage not configured" }, 500);
			}

			// Create IssueScreenshot record
			await prisma.issueScreenshot.create({
				data: {
					image: filePath,
					issueId: issue.id,
					userId: parseInt(userId),
				},
			});
		}

		// Fetch the complete issue with all relations
		const completeIssue = await getIssueWithRelations(issue.id, userId);

		if (!completeIssue) {
			return c.json({ error: "Failed to retrieve created issue" }, 500);
		}

		// Get base URL for building absolute URLs
		const requestUrl = new URL(c.req.url);
		const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

		return c.json(formatIssueResponse(completeIssue, baseUrl), 201);
	} catch (error) {
		console.error("Error creating issue:", error);
		return c.json({ error: "Failed to create issue" }, 500);
	}
}

