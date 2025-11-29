import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type ForumCommentContext = Context<AppEnv>;

// Create a new forum post
export async function addForumPost(c: ForumCommentContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ status: "error", message: "Authentication required" }, 401);
		}

		const body = await c.req.json();
		const { title, category, description } = body;

		if (!title || !category || !description) {
			return c.json({ status: "error", message: "Missing required fields" }, 400);
		}

		// Validate category is a number
		const categoryId = parseInt(category);
		if (isNaN(categoryId)) {
			return c.json({ status: "error", message: "Invalid category ID" }, 400);
		}

		// Check if category exists
		const categoryExists = await prisma.forumCategory.findUnique({
			where: { id: categoryId },
			select: { id: true },
		});

		if (!categoryExists) {
			return c.json({ status: "error", message: "Category not found" }, 404);
		}

		// Create the forum post
		const post = await prisma.forumPost.create({
			data: {
				userId: parseInt(userId),
				title: title.trim(),
				categoryId: categoryId,
				description: description.trim(),
			},
		});

		return c.json({
			status: "success",
			post_id: post.id,
		});
	} catch (error) {
		console.error("Error adding forum post:", error);
		return c.json({ status: "error", message: "Server error occurred" }, 500);
	}
}

// Add a comment to a forum post
export async function addForumComment(c: ForumCommentContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ status: "error", message: "Authentication required" }, 401);
		}

		const body = await c.req.json();
		const { post_id, content } = body;

		if (!post_id || !content) {
			return c.json({ status: "error", message: "Missing required fields" }, 400);
		}

		// Validate post_id is a number
		const postId = parseInt(post_id);
		if (isNaN(postId)) {
			return c.json({ status: "error", message: "Invalid post ID" }, 400);
		}

		// Check if post exists
		const post = await prisma.forumPost.findUnique({
			where: { id: postId },
			select: { id: true },
		});

		if (!post) {
			return c.json({ status: "error", message: "Post not found" }, 404);
		}

		// Create the comment
		const comment = await prisma.forumComment.create({
			data: {
				postId: postId,
				userId: parseInt(userId),
				content: content.trim(),
			},
		});

		return c.json({
			status: "success",
			comment_id: comment.id,
		});
	} catch (error) {
		console.error("Error adding forum comment:", error);
		return c.json({ status: "error", message: "Server error occurred" }, 500);
	}
}
