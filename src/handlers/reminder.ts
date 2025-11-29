import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

interface EmailPayload {
	to: string;
	subject: string;
	text: string;
	html: string;
}


// Retrieve reminder settings for the authenticated user (Creates default settings if none exist)
export async function getReminderSettings(c: Context<AppEnv>) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const userIdNum = parseInt(userId, 10);

		// Get or create reminder settings
		let settings = await prisma.reminderSettings.findFirst({
			where: {
				userId: userIdNum,
			},
		});

		// Create default settings if none exist
		if (!settings) {
			const now = new Date();
			settings = await prisma.reminderSettings.create({
				data: {
					userId: userIdNum,
					reminderTime: now,
					reminderTimeUtc: now,
					timezone: "UTC",
					isActive: false,
				},
			});
		}

		// Convert UTC time to user's timezone for display
		const userTimezone = settings.timezone || "UTC";
		const utcTime = new Date(settings.reminderTimeUtc);
		
		// Format the time in user's timezone
		const localTime = new Intl.DateTimeFormat("en-US", {
			timeZone: userTimezone,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(utcTime);

		return c.json({
			id: settings.id,
			userId: settings.userId,
			reminderTime: localTime,
			timezone: settings.timezone,
			isActive: settings.isActive,
			lastReminderSent: settings.lastReminderSent,
			createdAt: settings.createdAt,
			updatedAt: settings.updatedAt,
		});
	} catch (error) {
		console.error("Error fetching reminder settings:", error);
		return c.json({ error: "Failed to fetch reminder settings" }, 500);
	}
}


// Update reminder settings for the authenticated user
export async function updateReminderSettings(c: Context<AppEnv>) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const userIdNum = parseInt(userId, 10);
		const body = await c.req.json();

		const { reminderTime, timezone, isActive } = body;

		// Validate input
		if (!reminderTime || !timezone) {
			return c.json({ error: "reminderTime and timezone are required" }, 400);
		}

		// Validate timezone
		try {
			Intl.DateTimeFormat(undefined, { timeZone: timezone });
		} catch (error) {
			return c.json({ error: "Invalid timezone" }, 400);
		}

		// Validate time format (HH:mm:ss or HH:mm)
		const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
		if (!timeRegex.test(reminderTime)) {
			return c.json({ error: "Invalid time format. Use HH:mm:ss or HH:mm" }, 400);
		}

		// Convert local time to UTC
		const today = new Date();
		const [hours, minutes, seconds = "0"] = reminderTime.split(":");
		
		// Create a date string in the user's timezone
		const localDateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
		
		// Parse the local time in the user's timezone
		const localDate = new Date(
			new Date(localDateString).toLocaleString("en-US", { timeZone: timezone })
		);
		
		// Convert to UTC
		const utcDate = new Date(
			localDate.toLocaleString("en-US", { timeZone: "UTC" })
		);

		// Get or create reminder settings
		let settings = await prisma.reminderSettings.findFirst({
			where: {
				userId: userIdNum,
			},
		});

		if (settings) {
			// Update existing settings
			settings = await prisma.reminderSettings.update({
				where: {
					id: settings.id,
				},
				data: {
					reminderTime: localDate,
					reminderTimeUtc: utcDate,
					timezone: timezone,
					isActive: isActive !== undefined ? isActive : settings.isActive,
				},
			});
		} else {
			// Create new settings
			settings = await prisma.reminderSettings.create({
				data: {
					userId: userIdNum,
					reminderTime: localDate,
					reminderTimeUtc: utcDate,
					timezone: timezone,
					isActive: isActive !== undefined ? isActive : false,
				},
			});
		}

		// Format the time in user's timezone for response
		const localTime = new Intl.DateTimeFormat("en-US", {
			timeZone: settings.timezone,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(new Date(settings.reminderTimeUtc));

		return c.json({
			message: "Reminder settings updated successfully",
			settings: {
				id: settings.id,
				userId: settings.userId,
				reminderTime: localTime,
				timezone: settings.timezone,
				isActive: settings.isActive,
				lastReminderSent: settings.lastReminderSent,
				createdAt: settings.createdAt,
				updatedAt: settings.updatedAt,
			},
		});
	} catch (error) {
		console.error("Error updating reminder settings:", error);
		return c.json({ error: "Failed to update reminder settings" }, 500);
	}
}

// Deactivate reminder settings for the authenticated user
export async function deactivateReminderSettings(c: Context<AppEnv>) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const userIdNum = parseInt(userId, 10);

		// Find existing settings
		const settings = await prisma.reminderSettings.findFirst({
			where: {
				userId: userIdNum,
			},
		});

		if (!settings) {
			return c.json({ error: "Reminder settings not found" }, 404);
		}

		// Deactivate the settings
		const updatedSettings = await prisma.reminderSettings.update({
			where: {
				id: settings.id,
			},
			data: {
				isActive: false,
			},
		});

		return c.json({
			message: "Reminder settings deactivated successfully",
			settings: {
				id: updatedSettings.id,
				userId: updatedSettings.userId,
				isActive: updatedSettings.isActive,
			},
		});
	} catch (error) {
		console.error("Error deactivating reminder settings:", error);
		return c.json({ error: "Failed to deactivate reminder settings" }, 500);
	}
}

// Send a test reminder email to the authenticated user
export async function sendTestReminder(c: Context<AppEnv>) {
	try {
		const userId = c.get("userId");

		if (!userId) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const userIdNum = parseInt(userId, 10);

		// Get user details with profile and organization
		const user = await prisma.user.findUnique({
			where: { id: userIdNum },
			include: {
				userProfile: {
					include: {
						team: true,
					},
				},
			},
		});

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		// Get reminder settings
		const reminderSettings = await prisma.reminderSettings.findFirst({
			where: { userId: userIdNum },
		});

		// Format organization info
		let orgName = "";
		let orgInfoHtml = "";
		if (user.userProfile?.team) {
			orgName = user.userProfile.team.name;
			orgInfoHtml = `
				<div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid #e74c3c;">
					<p style="margin: 0; color: #666; font-size: 14px;"><strong>Organization:</strong> ${orgName}</p>
				</div>
			`;
		}

		// Format reminder time info
		let reminderTimeStr = "";
		let timezoneStr = "";
		let timeInfoHtml = "";
		if (reminderSettings) {
			// Format time in 12-hour format with AM/PM
			const reminderDate = new Date(reminderSettings.reminderTime);
			reminderTimeStr = new Intl.DateTimeFormat("en-US", {
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
				timeZone: reminderSettings.timezone,
			}).format(reminderDate);
			timezoneStr = reminderSettings.timezone;
			timeInfoHtml = `
				<div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin: 20px 0;">
					<p style="margin: 0; color: #666; font-size: 14px;"><strong>Your Reminder Time:</strong> ${reminderTimeStr} (${timezoneStr})</p>
				</div>
			`;
		}

		// Get the base URL from the request
		const url = new URL(c.req.url);
		const baseUrl = `${url.protocol}//${url.host}`;

		// Construct URLs for the email
		const checkInUrl = `${baseUrl}/add-sizzle-checkin/`;
		const settingsUrl = `${baseUrl}/v1/reminder-settings`;

		// Plain text body
		const plainBody = `Hello ${user.username},

This is a test reminder for your daily check-in${orgName ? ` for ${orgName}` : ""}.

${reminderTimeStr ? `Reminder Time: ${reminderTimeStr} (${timezoneStr})` : ""}

Click here to check in: ${checkInUrl}

You can manage your reminder settings at: ${settingsUrl}

Regular check-ins help keep your team informed about your progress and any challenges you might be facing.

Thank you for keeping your team updated!

Best regards,
The BLT Team`;

		// HTML content
		const htmlContent = `
		<html>
		<body style="font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 20px; color: #333;">
			<div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px; border-radius: 5px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
				<div style="background-color: #fff3cd; padding: 10px; border-radius: 4px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
					<p style="margin: 0; color: #856404; font-size: 14px;"><strong>⚠️ This is a test reminder</strong></p>
				</div>
				<h2 style="color: #333; margin-bottom: 20px;">Daily Check-in Reminder</h2>
				<p>Hello <strong>${user.username}</strong>,</p>
				<p>This is a test reminder for your daily check-in${orgName ? ` for <strong>${orgName}</strong>` : ""}! Please log in to update your status.</p>
				${orgInfoHtml}
				${timeInfoHtml}
				<div style="margin: 30px 0; text-align: center;">
					<a href="${checkInUrl}" 
					   style="display: inline-block; background-color: #e74c3c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; text-align: center; min-width: 200px;">
					   Check In Now
					</a>
				</div>
				<p>Regular check-ins help keep your team informed about your progress and any challenges you might be facing.</p>
				<div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center;">
					<p style="font-size: 13px; color: #666;">
						<a href="${settingsUrl}" style="color: #e74c3c; text-decoration: none;">Manage your reminder settings</a>
					</p>
				</div>
				<p style="margin-top: 20px;">Thank you for keeping your team updated!</p>
				<p style="color: #666; font-size: 14px;">Best regards,<br>The BLT Team</p>
			</div>
		</body>
		</html>
		`;

		// TODO: Implement email sending
		// Email payload prepared with the following data:
		const emailPayload: EmailPayload = {
			to: user.email,
			subject: "Test Daily Check-in Reminder",
			text: plainBody,
			html: htmlContent,
		};

		// For now, return the email preview for testing
		return c.json({
			message: "Test reminder email preview generated successfully",
			emailPreview: {
				to: emailPayload.to,
				subject: emailPayload.subject,
				plainText: emailPayload.text,
				html: emailPayload.html,
			},
			note: "Email sending not implemented yet. This is a preview of what would be sent.",
		});
	} catch (error) {
		console.error("Error sending test reminder:", error);
		return c.json(
			{
				error: "Failed to send test reminder",
				details: error instanceof Error ? error.message : "Unknown error",
			},
			500
		);
	}
}
