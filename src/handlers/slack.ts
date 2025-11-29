import { Context } from "hono";
import prisma from "../utils/db";
import { IntegrationService } from "../generated/prisma/enums";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type SlackContext = Context<AppEnv>;

// Interface for Slack App client
interface SlackApp {
	client: {
		conversations_list: (options?: { cursor?: string | null }) => Promise<{
			ok: boolean;
			channels: Array<{ id: string; name: string }>;
			response_metadata?: { next_cursor?: string };
		}>;
	};
}

// Helper function to create Slack App instance
function createSlackApp(token: string): SlackApp {
	// This is a mock implementation. In production, you would use the actual Slack SDK
	// Example: const { App } = require('@slack/bolt');
	// return new App({ token });
	return {
		client: {
			conversations_list: async (options) => {
				// Mock implementation - replace with actual Slack API call
				return {
					ok: true,
					channels: [],
					response_metadata: {},
				};
			},
		},
	};
}

// Get Slack integration details for an organization
export async function getSlackIntegration(c: SlackContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Verify organization exists
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
		});

		if (!organization) {
			return c.json({ detail: "Organization not found." }, 404);
		}

		// Find Slack integration
		const integration = await prisma.integration.findFirst({
			where: {
				organizationId: organizationId,
				serviceName: IntegrationService.SLACK,
			},
			include: {
				slackIntegration: true,
			},
		});

		if (!integration || !integration.slackIntegration) {
			return c.json({ detail: "Slack integration not found for this organization." }, 404);
		}

		// Get channel list if bot token exists
		let channels: string[] = [];
		if (integration.slackIntegration.botAccessToken) {
			const app = createSlackApp(integration.slackIntegration.botAccessToken);
			channels = await getChannelNames(app);
		}

		return c.json({
			id: integration.id,
			organization_id: organizationId,
			workspace_name: integration.slackIntegration.workspaceName,
			default_channel_name: integration.slackIntegration.defaultChannelName,
			default_channel_id: integration.slackIntegration.defaultChannelId,
			daily_updates: integration.slackIntegration.dailyUpdates,
			daily_update_time: integration.slackIntegration.dailyUpdateTime,
			welcome_message: integration.slackIntegration.welcomeMessage,
			channels: channels,
			created_at: integration.createdAt,
		});
	} catch (error) {
		console.error("Error retrieving Slack integration:", error);
		return c.json({ detail: "Failed to retrieve Slack integration" }, 500);
	}
}

// Get list of Slack channels for an organization's integration
export async function getSlackChannels(c: SlackContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		const integration = await prisma.integration.findFirst({
			where: {
				organizationId: organizationId,
				serviceName: IntegrationService.SLACK,
			},
			include: {
				slackIntegration: true,
			},
		});

		if (!integration || !integration.slackIntegration?.botAccessToken) {
			return c.json({ detail: "Slack integration not found or not configured." }, 404);
		}

		const app = createSlackApp(integration.slackIntegration.botAccessToken);
		const channels = await getChannelNames(app);

		return c.json({ channels });
	} catch (error) {
		console.error("Error fetching Slack channels:", error);
		return c.json({ detail: "Failed to fetch Slack channels" }, 500);
	}
}

// Create or update Slack integration for an organization
export async function createOrUpdateSlackIntegration(c: SlackContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		const body = await c.req.json();
		const {
			default_channel,
			daily_sizzle_timelogs_status,
			daily_sizzle_timelogs_hour,
			welcome_message,
		} = body;

		// Verify organization exists
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
		});

		if (!organization) {
			return c.json({ detail: "Organization not found." }, 404);
		}

		// Find existing integration
		const existingIntegration = await prisma.integration.findFirst({
			where: {
				organizationId: organizationId,
				serviceName: IntegrationService.SLACK,
			},
			include: {
				slackIntegration: true,
			},
		});

		if (!existingIntegration || !existingIntegration.slackIntegration) {
			return c.json({ detail: "Slack integration not found. Please complete OAuth setup first." }, 404);
		}

		// Get channel ID if channel name is provided
		let channelId = existingIntegration.slackIntegration.defaultChannelId;
		if (default_channel && existingIntegration.slackIntegration.botAccessToken) {
			const app = createSlackApp(existingIntegration.slackIntegration.botAccessToken);
			channelId = await getChannelId(app, default_channel);
		}

		// Update Slack integration
		const updatedSlackIntegration = await prisma.slackIntegration.update({
			where: { id: existingIntegration.slackIntegration.id },
			data: {
				defaultChannelId: channelId || existingIntegration.slackIntegration.defaultChannelId,
				defaultChannelName: default_channel || existingIntegration.slackIntegration.defaultChannelName,
				dailyUpdates: daily_sizzle_timelogs_status === "true" || daily_sizzle_timelogs_status === true,
				dailyUpdateTime: daily_sizzle_timelogs_hour
					? parseInt(daily_sizzle_timelogs_hour)
					: existingIntegration.slackIntegration.dailyUpdateTime,
				welcomeMessage: welcome_message || existingIntegration.slackIntegration.welcomeMessage,
			},
		});

		return c.json({
			detail: "Slack integration updated successfully",
			integration: {
				id: existingIntegration.id,
				organization_id: organizationId,
				workspace_name: updatedSlackIntegration.workspaceName,
				default_channel_name: updatedSlackIntegration.defaultChannelName,
				default_channel_id: updatedSlackIntegration.defaultChannelId,
				daily_updates: updatedSlackIntegration.dailyUpdates,
				daily_update_time: updatedSlackIntegration.dailyUpdateTime,
				welcome_message: updatedSlackIntegration.welcomeMessage,
			},
		});
	} catch (error) {
		console.error("Error updating Slack integration:", error);
		return c.json({ detail: "Failed to update Slack integration" }, 500);
	}
}

// Initiate Slack OAuth flow
export async function initiateSlackOAuth(c: SlackContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		// Verify organization exists
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
		});

		if (!organization) {
			return c.json({ detail: "Organization not found." }, 404);
		}

		// Get configuration from environment
		const clientId = c.env.SLACK_CLIENT_ID;
		if (!clientId) {
			return c.json({ detail: "Slack client ID not configured" }, 500);
		}

		const scopes = "channels:read,chat:write,groups:read,channels:join,im:write,users:read,team:read,commands";
		
		// Get redirect URI from environment or construct from request
		const host = c.req.header("host") || c.env.APP_HOST;
		const scheme = c.req.header("x-forwarded-proto") || c.req.header("x-forwarded-scheme") || "https";
		
		// Use environment variable if set, otherwise construct from request
		const redirectUri = c.env.OAUTH_REDIRECT_URL || `${scheme}://${host}/v1/oauth/slack/callback`;

		// Build state parameter with organization ID
		const state = encodeURIComponent(JSON.stringify({ organization_id: organizationId }));

		const authUrl =
			`https://slack.com/oauth/v2/authorize` +
			`?client_id=${clientId}` +
			`&scope=${encodeURIComponent(scopes)}` +
			`&state=${state}` +
			`&redirect_uri=${encodeURIComponent(redirectUri)}`;

		return c.json({
			auth_url: authUrl,
			redirect_uri: redirectUri,
		});
	} catch (error) {
		console.error("Error initiating Slack OAuth:", error);
		return c.json({ detail: "Failed to initiate OAuth flow" }, 500);
	}
}

// Handle Slack OAuth callback
export async function handleSlackOAuthCallback(c: SlackContext) {
	try {
		const code = c.req.query("code");
		const state = c.req.query("state");
		const error = c.req.query("error");

		if (error) {
			console.error(`Slack OAuth error: ${error}`);
			return c.json({ detail: `OAuth error: ${error}` }, 400);
		}

		if (!code) {
			console.error("Missing 'code' parameter in OAuth callback.");
			return c.json({ detail: "Missing 'code' parameter" }, 400);
		}

		if (!state) {
			console.error("Missing 'state' parameter in OAuth callback.");
			return c.json({ detail: "Missing 'state' parameter" }, 400);
		}

		// Parse state to get organization ID
		let organizationId: number;
		try {
			const stateData = JSON.parse(decodeURIComponent(state));
			const orgIdStr = stateData.organization_id;
			
			if (!orgIdStr || (typeof orgIdStr === 'string' && !/^\d+$/.test(orgIdStr))) {
				console.error(`Invalid organization_id received: ${orgIdStr}`);
				return c.json({ detail: "Invalid organization ID" }, 400);
			}
			
			organizationId = typeof orgIdStr === 'number' ? orgIdStr : parseInt(orgIdStr);
			
			if (isNaN(organizationId)) {
				throw new Error("Invalid organization ID in state");
			}
		} catch (err) {
			console.error(`Error parsing state parameter: ${err}`);
			return c.json({ detail: "Invalid state parameter" }, 400);
		}

		// Exchange code for access token
		const clientId = c.env.SLACK_CLIENT_ID;
		const clientSecret = c.env.SLACK_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			console.error("Slack credentials not configured");
			return c.json({ detail: "Slack credentials not configured" }, 500);
		}

		const host = c.req.header("host") || c.env.APP_HOST;
		const scheme = c.req.header("x-forwarded-proto") || c.req.header("x-forwarded-scheme") || "https";
		
		// Use environment variable if set, otherwise construct from request
		const redirectUri = c.env.OAUTH_REDIRECT_URL || `${scheme}://${host}/v1/oauth/slack/callback`;

		// Call Slack OAuth API
		const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				code: code,
				redirect_uri: redirectUri,
			}),
		});

		const tokenData: any = await tokenResponse.json();

		if (!tokenData.ok) {
			console.error(`Slack OAuth error: ${tokenData.error}`);
			return c.json({ detail: `Slack OAuth error: ${tokenData.error}` }, 400);
		}

		// Validate token data contains required fields
		if (!tokenData.access_token || !tokenData.team) {
			console.error(`Invalid token data received from Slack: ${JSON.stringify(tokenData)}`);
			return c.json({ detail: "Failed to retrieve token from Slack" }, 500);
		}

		// Verify organization exists
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
		});

		if (!organization) {
			console.error(`Organization not found: ${organizationId}`);
			return c.json({ detail: "Organization not found" }, 404);
		}

		// Find or create integration
		let integrationRecord = await prisma.integration.findFirst({
			where: {
				organizationId: organizationId,
				serviceName: IntegrationService.SLACK,
			},
		});

		if (!integrationRecord) {
			integrationRecord = await prisma.integration.create({
				data: {
					serviceName: IntegrationService.SLACK,
					organizationId: organizationId,
				},
			});
		}

		// Create or update Slack integration
		const slackIntegration = await prisma.slackIntegration.upsert({
			where: {
				integrationId: integrationRecord.id,
			},
			create: {
				integrationId: integrationRecord.id,
				botAccessToken: tokenData.access_token,
				workspaceName: tokenData.team?.name || tokenData.team?.id,
				dailyUpdates: false,
			},
			update: {
				botAccessToken: tokenData.access_token,
				workspaceName: tokenData.team?.name || tokenData.team?.id,
			},
		});

		// Check if redirect is requested
		const redirectParam = c.req.query("redirect");
		if (redirectParam === "dashboard" && c.env.FRONTEND_URL) {
			const dashboardUrl = `${c.env.FRONTEND_URL}/organizations/${organizationId}/integrations`;
			return c.redirect(dashboardUrl);
		}

		return c.json({
			detail: "Slack integration configured successfully",
			organization_id: organizationId,
			workspace_name: slackIntegration.workspaceName,
			integration_id: integrationRecord.id,
		});
	} catch (error) {
		console.error("Error handling Slack OAuth callback:", error);
		return c.json({ detail: "Failed to complete OAuth flow" }, 500);
	}
}

// Delete Slack integration for an organization
export async function deleteSlackIntegration(c: SlackContext) {
	try {
		const organizationId = parseInt(c.req.param("id"));

		if (isNaN(organizationId)) {
			return c.json({ detail: "Invalid organization ID" }, 400);
		}

		const integration = await prisma.integration.findFirst({
			where: {
				organizationId: organizationId,
				serviceName: IntegrationService.SLACK,
			},
			include: {
				slackIntegration: true,
			},
		});

		if (!integration) {
			return c.json({ detail: "Slack integration not found" }, 404);
		}

		// Delete the integration (cascade will delete SlackIntegration)
		await prisma.integration.delete({
			where: { id: integration.id },
		});

		return c.json({ detail: "Slack integration deleted successfully" });
	} catch (error) {
		console.error("Error deleting Slack integration:", error);
		return c.json({ detail: "Failed to delete Slack integration" }, 500);
	}
}

// Helper functions

// Fetches channel names from Slack
async function getChannelNames(app: SlackApp): Promise<string[]> {
	let cursor: string | null = null;
	const channels: string[] = [];

	try {
		while (true) {
			const response = await app.client.conversations_list(cursor ? { cursor } : undefined);

			if (response.ok) {
				channels.push(...response.channels.map((channel) => channel.name));
			}

			cursor = response.response_metadata?.next_cursor || null;
			if (!cursor) {
				break;
			}
		}
	} catch (error) {
		console.error("Error fetching channels:", error);
	}

	return channels;
}

// Fetches a Slack channel ID by name
async function getChannelId(app: SlackApp, channelName: string): Promise<string | null> {
	let cursor: string | null = null;

	try {
		const cleanChannelName = channelName.replace(/^#/, "").trim();

		while (true) {
			const response = await app.client.conversations_list(cursor ? { cursor } : undefined);

			for (const channel of response.channels) {
				if (channel.name === cleanChannelName) {
					return channel.id;
				}
			}

			cursor = response.response_metadata?.next_cursor || null;
			if (!cursor) {
				break;
			}
		}
	} catch (error) {
		console.error("Error fetching channel ID:", error);
	}

	return null;
}
