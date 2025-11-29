import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type ForumVoteContext = Context<AppEnv>;

// Get vote status for a specific post by the authenticated user
export async function setVoteStatus(c: ForumVoteContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ status: "error", message: "Authentication required" }, 401);
		}

		const body = await c.req.json();
		const { id } = body;

		if (!id) {
			return c.json({ status: "error", message: "Post ID is required" }, 400);
		}

		// Validate id is a number
		const postId = parseInt(id);
		if (isNaN(postId)) {
			return c.json({ status: "error", message: "Invalid post ID" }, 400);
		}

		// Find the vote for this post by the current user
		const vote = await prisma.forumVote.findFirst({
			where: {
				postId: postId,
				userId: parseInt(userId),
			},
			select: {
				upvote: true,
				downvote: true,
			},
		});

		return c.json({
			up_vote: vote?.upvote ?? false,
			down_vote: vote?.downvote ?? false,
		});
	} catch (error) {
		console.error("Error getting vote status:", error);
		return c.json({ status: "error", message: "Server error occurred" }, 500);
	}
}

// Vote on a forum post (upvote or downvote)
export async function voteForumPost(c: ForumVoteContext) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ status: "error", message: "Authentication required" }, 401);
		}

		const body = await c.req.json();
		const { post_id, up_vote = false, down_vote = false } = body;

		if (!post_id) {
			return c.json({ status: "error", message: "Post ID is required" }, 400);
		}

		// Validate post_id is a number
		const postId = parseInt(post_id);
		if (isNaN(postId)) {
			return c.json({ status: "error", message: "Invalid post ID" }, 400);
		}

		// Check if the post exists
		const post = await prisma.forumPost.findUnique({
			where: { id: postId },
		});

		if (!post) {
			return c.json({ status: "error", message: "Post not found" }, 404);
		}

		// Find existing vote
		const existingVote = await prisma.forumVote.findFirst({
			where: {
				postId: postId,
				userId: parseInt(userId),
			},
		});

		// Create or update the vote
		if (existingVote) {
			await prisma.forumVote.update({
				where: { id: existingVote.id },
				data: {
					upvote: up_vote,
					downvote: down_vote,
				},
			});
		} else {
			await prisma.forumVote.create({
				data: {
					postId: postId,
					userId: parseInt(userId),
					upvote: up_vote,
					downvote: down_vote,
				},
			});
		}

		// Update vote counts on the post
		const upVotesCount = await prisma.forumVote.count({
			where: {
				postId: postId,
				upvote: true,
			},
		});

		const downVotesCount = await prisma.forumVote.count({
			where: {
				postId: postId,
				downvote: true,
			},
		});

		// Update the post with new vote counts
		await prisma.forumPost.update({
			where: { id: postId },
			data: {
				upVotes: upVotesCount,
				downVotes: downVotesCount,
			},
		});

		return c.json({
			success: true,
			up_vote: upVotesCount,
			down_vote: downVotesCount,
		});
	} catch (error) {
		console.error("Error voting on forum post:", error);
		return c.json({ status: "error", message: "Server error occurred" }, 500);
	}
}
