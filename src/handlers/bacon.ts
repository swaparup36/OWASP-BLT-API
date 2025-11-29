import { Context } from "hono";
import prisma from "../utils/db";
import { BaconContributionType, BaconSubmissionStatus } from "../generated/prisma/enums";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId: string;
	};
};

// Create a new bacon submission
export const createBaconSubmission = async (c: Context<AppEnv>) => {
	try {
		const body = await c.req.json();
		const userId = c.get("userId");

		// Extract fields from request body
		const { github_url, contribution_type, description, status, bacon_amount } = body;

		// Validate required fields
		if (!github_url || !contribution_type || !description) {
			return c.json({ error: "Missing required fields: github_url, contribution_type, and description are required" }, 400);
		}

		// Validate contribution type
		const validContributionTypes = ["security", "non-security"];
		if (!validContributionTypes.includes(contribution_type)) {
			return c.json({ error: "Invalid contribution type. Must be 'security' or 'non-security'" }, 400);
		}

		// Validate status if provided
		const validStatuses = ["in_review", "accepted", "declined"];
		const submissionStatus = status || "in_review";
		if (!validStatuses.includes(submissionStatus)) {
			return c.json({ error: "Invalid status. Must be 'in_review', 'accepted', or 'declined'" }, 400);
		}

		// Validate GitHub PR URL format
		const prUrlPattern = /^https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+$/;
		if (!prUrlPattern.test(github_url)) {
			return c.json({ error: "Invalid GitHub PR link. Expected format: https://github.com/owner/repo/pull/123" }, 400);
		}

		// Map contribution type to enum
		const contributionTypeEnum: BaconContributionType =
			contribution_type === "security" ? "SECURITY_RELATED" : "NON_SECURITY_RELATED";

		// Map status to enum
		const statusEnum: BaconSubmissionStatus =
			submissionStatus === "in_review"
				? "IN_REVIEW"
				: submissionStatus === "accepted"
					? "ACCEPTED"
					: "DECLINED";

		// Parse bacon amount (default to 0)
		const baconAmountValue = typeof bacon_amount === "number" ? bacon_amount : 0;

		// Create submission in database
		const submission = await prisma.baconSubmission.create({
			data: {
				userId: Number.parseInt(userId, 10),
				githubUrl: github_url,
				contributionType: contributionTypeEnum,
				description,
				status: statusEnum,
				baconAmount: baconAmountValue,
			},
			select: {
				id: true,
				githubUrl: true,
				contributionType: true,
				description: true,
				status: true,
				baconAmount: true,
				createdAt: true,
			},
		});

		return c.json(
			{
				message: "Submission created successfully",
				submission_id: submission.id,
				submission: {
					id: submission.id,
					github_url: submission.githubUrl,
					contribution_type: submission.contributionType === "SECURITY_RELATED" ? "security" : "non-security",
					description: submission.description,
					status: submission.status.toLowerCase().replace("_", "_"),
					bacon_amount: submission.baconAmount,
					created_at: submission.createdAt,
				},
			},
			201
		);
	} catch (error) {
		console.error("Error creating bacon submission:", error);

		// Handle Prisma validation errors
		if (error instanceof Error) {
			if (error.message.includes("Foreign key constraint")) {
				return c.json({ error: "Invalid user ID" }, 400);
			}
		}

		return c.json({ error: "Failed to create submission. Please try again." }, 500);
	}
};

// List bacon submissions for the authenticated user
export const listBaconSubmissions = async (c: Context<AppEnv>) => {
	try {
		const userId = c.get("userId");

		const submissions = await prisma.baconSubmission.findMany({
			where: {
				userId: Number.parseInt(userId, 10),
			},
			select: {
				id: true,
				githubUrl: true,
				contributionType: true,
				description: true,
				status: true,
				baconAmount: true,
				createdAt: true,
				modifiedAt: true,
			},
			orderBy: {
				createdAt: "desc",
			},
		});

		const formattedSubmissions = submissions.map((submission) => ({
			id: submission.id,
			github_url: submission.githubUrl,
			contribution_type: submission.contributionType === "SECURITY_RELATED" ? "security" : "non-security",
			description: submission.description,
			status: submission.status.toLowerCase().replace("_", "_"),
			bacon_amount: submission.baconAmount,
			created_at: submission.createdAt,
			modified_at: submission.modifiedAt,
		}));

		return c.json({
			count: formattedSubmissions.length,
			results: formattedSubmissions,
		});
	} catch (error) {
		console.error("Error fetching bacon submissions:", error);
		return c.json({ error: "Failed to fetch submissions" }, 500);
	}
};

// Retrieve a single bacon submission
export const retrieveBaconSubmission = async (c: Context<AppEnv>) => {
	try {
		const userId = c.get("userId");
		const submissionId = c.req.param("id");

		if (!submissionId || Number.isNaN(Number.parseInt(submissionId, 10))) {
			return c.json({ error: "Invalid submission ID" }, 400);
		}

		const submission = await prisma.baconSubmission.findFirst({
			where: {
				id: Number.parseInt(submissionId, 10),
				userId: Number.parseInt(userId, 10),
			},
			select: {
				id: true,
				githubUrl: true,
				contributionType: true,
				description: true,
				status: true,
				baconAmount: true,
				createdAt: true,
				modifiedAt: true,
				transactionStatus: true,
				transactionId: true,
			},
		});

		if (!submission) {
			return c.json({ error: "Submission not found" }, 404);
		}

		return c.json({
			id: submission.id,
			github_url: submission.githubUrl,
			contribution_type: submission.contributionType === "SECURITY_RELATED" ? "security" : "non-security",
			description: submission.description,
			status: submission.status.toLowerCase().replace("_", "_"),
			bacon_amount: submission.baconAmount,
			created_at: submission.createdAt,
			modified_at: submission.modifiedAt,
			transaction_status: submission.transactionStatus.toLowerCase(),
			transaction_id: submission.transactionId,
		});
	} catch (error) {
		console.error("Error fetching bacon submission:", error);
		return c.json({ error: "Failed to fetch submission" }, 500);
	}
};

// List and filter bacon submissions (admin/mentor view) - requires auth
export const baconRequestsView = async (c: Context<AppEnv>) => {
	try {
		const userId = c.get("userId");
		const txStatus = c.req.query("tx-status") || "";
		const decisionStatus = c.req.query("decision-status") || "";

		const whereClause: any = {};

		if (txStatus === "pending") {
			whereClause.transactionStatus = "PENDING";
		} else if (txStatus === "completed") {
			whereClause.transactionStatus = "COMPLETED";
		}

		if (decisionStatus === "accepted") {
			whereClause.status = "ACCEPTED";
		} else if (decisionStatus === "declined") {
			whereClause.status = "DECLINED";
		}

		// Fetch all submissions with filters
		const submissions = await prisma.baconSubmission.findMany({
			where: whereClause,
			select: {
				id: true,
				userId: true,
				githubUrl: true,
				contributionType: true,
				description: true,
				status: true,
				baconAmount: true,
				transactionStatus: true,
				transactionId: true,
				createdAt: true,
				modifiedAt: true,
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
			},
			orderBy: {
				createdAt: "desc",
			},
		});

		// Check if the logged-in user is a mentor
		const mentorBadge = await prisma.badge.findFirst({
			where: {
				title: "mentor",
			},
		});

		let isMentor = false;
		if (mentorBadge) {
			const userBadge = await prisma.userBadge.findFirst({
				where: {
					userId: Number.parseInt(userId, 10),
					badgeId: mentorBadge.id,
				},
			});
			isMentor = !!userBadge;
		}

		// Format submissions for response
		const formattedSubmissions = submissions.map((submission) => ({
			id: submission.id,
			user_id: submission.userId,
			user: submission.user,
			github_url: submission.githubUrl,
			contribution_type: submission.contributionType === "SECURITY_RELATED" ? "security" : "non-security",
			description: submission.description,
			status: submission.status.toLowerCase(),
			bacon_amount: submission.baconAmount,
			transaction_status: submission.transactionStatus.toLowerCase(),
			transaction_id: submission.transactionId,
			created_at: submission.createdAt,
			modified_at: submission.modifiedAt,
		}));

		return c.json({
			count: formattedSubmissions.length,
			submissions: formattedSubmissions,
			filters: {
				tx_status: txStatus,
				decision_status: decisionStatus,
			},
			is_mentor: isMentor,
		});
	} catch (error) {
		console.error("Error fetching bacon requests:", error);
		return c.json({ error: "Failed to fetch bacon requests" }, 500);
	}
};

// Combined view for bacon form and requests - works with optional auth
export const baconView = async (c: Context) => {
	try {
		const txStatus = c.req.query("tx-status") || "";
		const decisionStatus = c.req.query("decision-status") || "";

		const whereClause: any = {};

		if (txStatus === "pending") {
			whereClause.transactionStatus = "PENDING";
		} else if (txStatus === "completed") {
			whereClause.transactionStatus = "COMPLETED";
		}

		if (decisionStatus === "accepted") {
			whereClause.status = "ACCEPTED";
		} else if (decisionStatus === "declined") {
			whereClause.status = "DECLINED";
		}

		// Fetch all submissions with filters, ordered by created date descending
		const submissions = await prisma.baconSubmission.findMany({
			where: whereClause,
			select: {
				id: true,
				userId: true,
				githubUrl: true,
				contributionType: true,
				description: true,
				status: true,
				baconAmount: true,
				transactionStatus: true,
				transactionId: true,
				createdAt: true,
				modifiedAt: true,
				user: {
					select: {
						id: true,
						username: true,
						email: true,
					},
				},
			},
			orderBy: {
				createdAt: "desc",
			},
		});

		// Check if user is authenticated and is a mentor
		let isMentor = false;
		const userId = c.get("userId");

		if (userId) {
			// check for mentor badge
			const mentorBadge = await prisma.badge.findFirst({
				where: {
					title: "mentor",
				},
			});

			if (mentorBadge) {
				const userBadge = await prisma.userBadge.findFirst({
					where: {
						userId: Number.parseInt(userId, 10),
						badgeId: mentorBadge.id,
					},
				});
				isMentor = !!userBadge;
			}
		}

		// Format submissions for response
		const formattedSubmissions = submissions.map((submission) => ({
			id: submission.id,
			user_id: submission.userId,
			user: submission.user,
			github_url: submission.githubUrl,
			contribution_type: submission.contributionType === "SECURITY_RELATED" ? "security" : "non-security",
			description: submission.description,
			status: submission.status.toLowerCase(),
			bacon_amount: submission.baconAmount,
			transaction_status: submission.transactionStatus.toLowerCase(),
			transaction_id: submission.transactionId,
			created_at: submission.createdAt,
			modified_at: submission.modifiedAt,
		}));

		return c.json({
			count: formattedSubmissions.length,
			submissions: formattedSubmissions,
			filters: {
				tx_status: txStatus,
				decision_status: decisionStatus,
			},
			is_mentor: isMentor,
			is_authenticated: !!userId,
		});
	} catch (error) {
		console.error("Error fetching bacon view:", error);
		return c.json({ error: "Failed to fetch bacon view" }, 500);
	}
};

// Batch send bacon tokens to all eligible users
export const batchSendBaconTokens = async (c: Context<AppEnv>) => {
	try {
		// Get all users with non-zero tokens_earned
		const usersWithTokens = await prisma.baconEarning.findMany({
			where: {
				tokensEarned: {
					gt: 0,
				},
			},
			include: {
				user: {
					include: {
						userProfile: {
							select: {
								btcAddress: true,
							},
						},
					},
				},
			},
		});

		if (!usersWithTokens || usersWithTokens.length === 0) {
			return c.json(
				{
					status: "error",
					message: "No eligible users with tokens to send.",
				},
				400
			);
		}

		// Build YAML content
		const yamlOutputs: string[] = [];
		for (const tokenEarning of usersWithTokens) {
			const btcAddress = tokenEarning.user.userProfile?.btcAddress;
			const tokensToSend = tokenEarning.tokensEarned;

			if (btcAddress && Number(tokensToSend) > 0) {
				yamlOutputs.push(`- address: ${btcAddress}\n  runes:\n    BLT•BACON•TOKENS: ${tokensToSend}`);
			}
		}

		if (yamlOutputs.length === 0) {
			return c.json(
				{
					status: "error",
					message: "No users with valid BTC addresses found.",
				},
				400
			);
		}

		const yamlContent = "outputs:\n" + yamlOutputs.join("\n");

		// Payload for POST request
		const payload = {
			yaml_content: yamlContent,
		};

		const ordServerUrl = c.env.ORD_SERVER_URL;
		if (!ordServerUrl) {
			return c.json(
				{
					status: "error",
					message: "ORD_SERVER_URL is not configured in environment variables.",
				},
				500
			);
		}

		try {
			// Send the request to the ORD server
			const response = await fetch(`${ordServerUrl}/send-bacon-tokens`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			const responseData = (await response.json()) as any;

			if (response.ok && responseData.success) {
				await prisma.baconEarning.updateMany({
					where: {
						tokensEarned: {
							gt: 0,
						},
					},
					data: {
						tokensEarned: 0,
					},
				});

				return c.json({
					status: "success",
					message:
						"Tokens successfully sent to all eligible users. If it doesn't appear in the users wallet yet, wait for the miners to confirm the transaction.",
				});
			}

			return c.json(
				{
					status: "error",
					message: responseData.error || "Unknown error occurred while sending tokens.",
				},
				500
			);
		} catch (fetchError) {
			console.error("Error sending request to ORD server:", fetchError);
			return c.json(
				{
					status: "error",
					message: fetchError instanceof Error ? fetchError.message : "Failed to connect to ORD server.",
				},
				500
			);
		}
	} catch (error) {
		console.error("Error in batch send bacon tokens:", error);
		return c.json(
			{
				status: "error",
				message: "An unexpected error occurred while processing the request.",
			},
			500
		);
	}
};

// Get wallet balance (mentor only)
export const getWalletBalance = async (c: Context<AppEnv>) => {
	try {
		const userId = c.get("userId");

		// Check if the user is a mentor
		const mentorBadge = await prisma.badge.findFirst({
			where: {
				title: "mentor",
			},
		});

		if (!mentorBadge) {
			return c.json({ error: "Mentor badge not found" }, 500);
		}

		const isMentor = await prisma.userBadge.findFirst({
			where: {
				userId: Number.parseInt(userId, 10),
				badgeId: mentorBadge.id,
			},
		});

		if (!isMentor) {
			return c.json({ error: "Unauthorized" }, 403);
		}

		const ordServerUrl = c.env.ORD_SERVER_URL;
		if (!ordServerUrl) {
			return c.json({ error: "ORD_SERVER_URL is not configured" }, 500);
		}

		try {
			// Fetch the wallet balance from the ORD server
			const response = await fetch(`${ordServerUrl}/mainnet/wallet-balance`);
			const responseData = (await response.json()) as any;

			if (response.ok && responseData.success) {
				// Parse the balance data
				const balanceData = JSON.parse(responseData.balance);

				return c.json({
					balance: balanceData,
					success: true,
				});
			}

			return c.json(
				{
					error: "Failed to fetch wallet balance",
				},
				500
			);
		} catch (fetchError) {
			console.error("Error fetching wallet balance:", fetchError);
			return c.json(
				{
					error: "There's some problem fetching wallet details",
				},
				500
			);
		}
	} catch (error) {
		console.error("Error in get wallet balance:", error);
		return c.json(
			{
				error: "An unexpected error occurred while fetching wallet balance.",
			},
			500
		);
	}
};

// Initiate transaction (mentor only)
export const initiateTransaction = async (c: Context<AppEnv>) => {
	try {
		const userId = c.get("userId");

		// Check if the user is a mentor
		const mentorBadge = await prisma.badge.findFirst({
			where: {
				title: "mentor",
			},
		});

		if (!mentorBadge) {
			return c.json({ error: "Mentor badge not found" }, 500);
		}

		const isMentor = await prisma.userBadge.findFirst({
			where: {
				userId: Number.parseInt(userId, 10),
				badgeId: mentorBadge.id,
			},
		});

		if (!isMentor) {
			return c.json({ error: "Unauthorized" }, 403);
		}

		// Handle GET request - return submissions data
		if (c.req.method === "GET") {
			// Fetch submissions where status is 'accepted' and transaction is still pending
			const submissions = await prisma.baconSubmission.findMany({
				where: {
					status: "ACCEPTED",
					transactionStatus: "PENDING",
				},
				include: {
					user: {
						select: {
							id: true,
							username: true,
							email: true,
							userProfile: {
								select: {
									btcAddress: true,
								},
							},
						},
					},
				},
				orderBy: {
					userId: "asc",
				},
			});

			// Group submissions by user
			const submissionsByUser: Record<
				number,
				{
					user: {
						id: number;
						username: string | null;
						email: string;
						btc_address: string | null;
					};
					submissions: any[];
					total_bacon: number;
				}
			> = {};

			for (const submission of submissions) {
				const userIdKey = submission.userId;

				if (!submissionsByUser[userIdKey]) {
					submissionsByUser[userIdKey] = {
						user: {
							id: submission.user.id,
							username: submission.user.username,
							email: submission.user.email,
							btc_address: submission.user.userProfile?.btcAddress || null,
						},
						submissions: [],
						total_bacon: 0,
					};
				}

				submissionsByUser[userIdKey].submissions.push({
					id: submission.id,
					github_url: submission.githubUrl,
					contribution_type: submission.contributionType === "SECURITY_RELATED" ? "security" : "non-security",
					description: submission.description,
					bacon_amount: Number(submission.baconAmount),
					created_at: submission.createdAt,
				});

				submissionsByUser[userIdKey].total_bacon += Number(submission.baconAmount);
			}

			return c.json({
				submissions_by_user: submissionsByUser,
			});
		}

		// Handle POST request - process transaction
		if (c.req.method === "POST") {
			const body = await c.req.json();
			const { selected_users, fee_rate, dry_run, network, password } = body;

			// Validate required fields
			if (!network) {
				return c.json({ error: "Network is required" }, 400);
			}

			if (!selected_users || !Array.isArray(selected_users) || selected_users.length === 0) {
				return c.json({ error: "selected_users is required and must be a non-empty array" }, 400);
			}

			const totalBacon = selected_users.reduce((sum: number, user: any) => sum + (user.bacon_amount || 0), 0);
			const ordServerUrl = c.env.ORD_SERVER_URL;
			if (!ordServerUrl) {
				return c.json({ error: "ORD_SERVER_URL is not configured" }, 500);
			}

			// MAINNET LOGIC
			if (network === "mainnet") {
				// Build outputs array for YAML
				const outputs = selected_users.map((user: any) => ({
					address: user.bch_address || user.btc_address,
					runes: {
						"BLT•BACON•TOKENS": user.bacon_amount,
					},
				}));

				// Create YAML content
				const yamlContent =
					"outputs:\n" +
					outputs
						.map(
							(output: any) =>
								`- address: ${output.address}\n  runes:\n    BLT•BACON•TOKENS: ${output.runes["BLT•BACON•TOKENS"]}`
						)
						.join("\n");

				const finalPayload = {
					yaml_content: yamlContent,
					fee_rate: fee_rate,
					dry_run: dry_run,
					password: password || "",
				};

				try {
					const response = await fetch(`${ordServerUrl}/mainnet/send-bacon-tokens`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(finalPayload),
					});

					const responseData = (await response.json()) as any;

					if (response.ok && responseData.txid) {
						const txid = responseData.txid;

						// Update each selected user's BaconSubmission records
						for (const user of selected_users) {
							await prisma.baconSubmission.updateMany({
								where: {
									user: {
										username: user.username,
									},
									status: "ACCEPTED",
									transactionStatus: "PENDING",
								},
								data: {
									transactionId: txid,
									transactionStatus: "COMPLETED",
								},
							});
						}

						return c.json(responseData);
					}

					return c.json(
						{
							error: "Failed to process transaction on mainnet",
							details: responseData,
						},
						500
					);
				} catch (fetchError) {
					console.error("Error sending mainnet transaction:", fetchError);
					return c.json(
						{
							error: "Failed to connect to ORD server for mainnet transaction",
						},
						500
					);
				}
			}
			// REGTEST LOGIC
			else if (network === "regtest") {
				const finalPayload = {
					num_users: selected_users.length,
					fee_rate: fee_rate,
					dry_run: dry_run,
				};

				try {
					const response = await fetch(`${ordServerUrl}/regtest/send-bacon-tokens`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(finalPayload),
					});

					const responseData = (await response.json()) as any;

					if (response.ok) {
						return c.json(responseData);
					}

					return c.json(
						{
							error: "Failed to process transaction on regtest",
							details: responseData,
						},
						500
					);
				} catch (fetchError) {
					console.error("Error sending regtest transaction:", fetchError);
					return c.json(
						{
							error: "Failed to connect to ORD server for regtest transaction",
						},
						500
					);
				}
			} else {
				return c.json({ error: "Invalid network specified. Must be 'mainnet' or 'regtest'" }, 400);
			}
		}

		return c.json({ error: "Method not allowed. Use GET or POST" }, 405);
	} catch (error) {
		console.error("Error in initiate transaction:", error);
		return c.json(
			{
				error: "An unexpected error occurred while processing the transaction.",
			},
			500
		);
	}
};

// Get pending transactions (users with non-zero tokens earned)
export const pendingTransactionsView = async (c: Context<AppEnv>) => {
	try {
		// Fetch all users with non-zero tokens_earned
		const pendingTransactions = await prisma.baconEarning.findMany({
			where: {
				tokensEarned: {
					gt: 0,
				},
			},
			include: {
				user: {
					select: {
						id: true,
						username: true,
						email: true,
						userProfile: {
							select: {
								btcAddress: true,
							},
						},
					},
				},
			},
			orderBy: {
				tokensEarned: "desc",
			},
		});

		// Prepare a list of user: address: tokens data
		const transactionsData = pendingTransactions.map((transaction) => ({
			user: transaction.user.username,
			address: transaction.user.userProfile?.btcAddress || null,
			tokens: Number(transaction.tokensEarned),
		}));

		return c.json({
			pending_transactions: transactionsData,
		});
	} catch (error) {
		console.error("Error fetching pending transactions:", error);
		return c.json(
			{
				error: "Failed to fetch pending transactions.",
			},
			500
		);
	}
};

// Update submission status (mentor only)
export const updateSubmissionStatus = async (c: Context<AppEnv>) => {
	try {
		const userId = c.get("userId");
		const submissionId = c.req.param("id");

		if (!submissionId || Number.isNaN(Number.parseInt(submissionId, 10))) {
			return c.json({ error: "Invalid submission ID" }, 400);
		}

		// Check if the user is a mentor
		const mentorBadge = await prisma.badge.findFirst({
			where: {
				title: "mentor",
			},
		});

		if (!mentorBadge) {
			return c.json({ error: "Mentor badge not found" }, 500);
		}

		const isMentor = await prisma.userBadge.findFirst({
			where: {
				userId: Number.parseInt(userId, 10),
				badgeId: mentorBadge.id,
			},
		});

		if (!isMentor) {
			return c.json({ error: "Unauthorized" }, 403);
		}

		// Get the submission
		const submission = await prisma.baconSubmission.findUnique({
			where: {
				id: Number.parseInt(submissionId, 10),
			},
		});

		if (!submission) {
			return c.json({ error: "Submission not found" }, 404);
		}

		// Parse request body
		const body = await c.req.json();
		const { status: newStatus, bacon_amount: newBaconAmount } = body;

		// Prepare update data
		const updateData: any = {};

		// Update status if provided
		if (newStatus) {
			const validStatuses = ["accepted", "declined", "in_review"];
			if (!validStatuses.includes(newStatus)) {
				return c.json(
					{
						error: "Invalid status. Must be 'accepted', 'declined', or 'in_review'",
					},
					400
				);
			}

			// Map status to enum
			const statusEnum: BaconSubmissionStatus =
				newStatus === "accepted" ? "ACCEPTED" : newStatus === "declined" ? "DECLINED" : "IN_REVIEW";

			updateData.status = statusEnum;
		}

		// Update bacon amount if provided
		if (newBaconAmount !== undefined && newBaconAmount !== null) {
			if (typeof newBaconAmount !== "number" || newBaconAmount < 0) {
				return c.json({ error: "Invalid bacon_amount. Must be a non-negative number" }, 400);
			}
			updateData.baconAmount = newBaconAmount;
		}

		// update the submission
		const updatedSubmission = await prisma.baconSubmission.update({
			where: {
				id: Number.parseInt(submissionId, 10),
			},
			data: updateData,
		});

		return c.json({
			success: true,
			new_status: updatedSubmission.status.toLowerCase(),
			new_bacon_amount: Number(updatedSubmission.baconAmount),
		});
	} catch (error) {
		console.error("Error updating submission status:", error);
		return c.json(
			{
				error: "Error updating submission status",
			},
			500
		);
	}
};
