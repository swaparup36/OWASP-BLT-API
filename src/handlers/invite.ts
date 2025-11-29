import { Context } from "hono";
import { BlankInput } from "hono/types";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings & {
		EMAIL_SERVICE_API_KEY?: string;
		EMAIL_FROM?: string;
		SITE_NAME?: string;
		SITE_DOMAIN?: string;
	};
	Variables: {
		userId: string;
	};
};

// Send invitation email to a friend
export const inviteFriend = async (c: Context<AppEnv, "/invite/friend", BlankInput>) => {
	try {
		const userId = c.get("userId");

		const { email } = await c.req.json();

		if (!email) {
			return c.json({ error: "Email is required" }, 400);
		}

		// Validate email format
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(email)) {
			return c.json({ error: "Invalid email format" }, 400);
		}

		// Check if user already exists
		const existingUser = await prisma.user.findUnique({
			where: { email },
		});

		if (existingUser) {
			return c.json({ error: "User already exists" }, 400);
		}

		// Get current user details
		const currentUser = await prisma.user.findUnique({
			where: { id: parseInt(userId) },
			select: {
				id: true,
				username: true,
			},
		});

		if (!currentUser) {
			return c.json({ error: "User not found" }, 404);
		}

		// Get or create InviteFriend record
		let inviteFriend = await prisma.inviteFriend.findFirst({
			where: { senderId: currentUser.id },
		});

		if (!inviteFriend) {
			inviteFriend = await prisma.inviteFriend.create({
				data: {
					senderId: currentUser.id,
				},
			});
		}

		// Build referral link
		const siteDomain = c.env.SITE_DOMAIN || "blt.owasp.org";
		const referralLink = `https://${siteDomain}/referral/?ref=${inviteFriend.referralCode}`;

		// Prepare email data
		const siteName = c.env.SITE_NAME || "OWASP BLT";
		const emailData = {
			to: email,
			from: c.env.EMAIL_FROM || `noreply@${siteDomain}`,
			subject: `Join me on ${siteName}!`,
			htmlContent: generateInviteEmailHTML({
				senderUsername: currentUser.username,
				referralLink,
				siteName,
				siteDomain,
			}),
			textContent: generateInviteEmailText({
				senderUsername: currentUser.username,
				referralLink,
				siteName,
			}),
		};

		// Send email
		const emailResult = await sendInvitationEmail(emailData, c.env.EMAIL_SERVICE_API_KEY);

		if (emailResult.success) {
			return c.json(
				{
					success: true,
					message: "Invitation sent successfully",
					referralLink: referralLink,
					emailStatus: "delivered",
				},
				200
			);
		} else {
			console.error("Failed to send email:", emailResult.error);
			return c.json(
				{
					error: "Email failed to send",
					emailStatus: "failed",
					details: emailResult.error,
				},
				500
			);
		}
	} catch (error) {
		console.error("Error in inviteFriend:", error);
		return c.json(
			{
				error: "Failed to send invitation email for an unexpected reason",
				emailStatus: "error",
			},
			500
		);
	}
};

// Generate HTML content for invitation email
function generateInviteEmailHTML(data: {
	senderUsername: string;
	referralLink: string;
	siteName: string;
	siteDomain: string;
}): string {
	return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Join ${data.siteName}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .container {
            background-color: #f9f9f9;
            border-radius: 8px;
            padding: 30px;
            margin: 20px 0;
        }
        .header {
            text-align: center;
            color: #2c3e50;
            margin-bottom: 30px;
        }
        .content {
            background-color: white;
            padding: 25px;
            border-radius: 5px;
            margin: 20px 0;
        }
        .cta-button {
            display: inline-block;
            background-color: #3498db;
            color: white !important;
            text-decoration: none;
            padding: 12px 30px;
            border-radius: 5px;
            margin: 20px 0;
            text-align: center;
        }
        .cta-button:hover {
            background-color: #2980b9;
        }
        .footer {
            text-align: center;
            color: #7f8c8d;
            font-size: 12px;
            margin-top: 30px;
        }
        .referral-link {
            background-color: #ecf0f1;
            padding: 10px;
            border-radius: 4px;
            word-break: break-all;
            font-family: monospace;
            margin: 10px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${data.siteName}</h1>
        </div>
        <div class="content">
            <h2>You've been invited!</h2>
            <p>Hi there!</p>
            <p><strong>${data.senderUsername}</strong> has invited you to join ${data.siteName}.</p>
            <p>${data.siteName} is a platform where you can contribute to security research, report bugs, and earn rewards!</p>
            
            <div style="text-align: center;">
                <a href="${data.referralLink}" class="cta-button">Accept Invitation</a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <div class="referral-link">
                ${data.referralLink}
            </div>
        </div>
        <div class="footer">
            <p>This invitation was sent by ${data.senderUsername} from ${data.siteDomain}</p>
            <p>If you didn't expect this invitation, you can safely ignore this email.</p>
        </div>
    </div>
</body>
</html>
	`.trim();
}

// Generate plain text content for invitation email
function generateInviteEmailText(data: {
	senderUsername: string;
	referralLink: string;
	siteName: string;
}): string {
	return `
You've been invited to join ${data.siteName}!

Hi there!

${data.senderUsername} has invited you to join ${data.siteName}.

${data.siteName} is a platform where you can contribute to security research, report bugs, and earn rewards!

Join now by clicking the link below:
${data.referralLink}

If you didn't expect this invitation, you can safely ignore this email.
	`.trim();
}

// Send email using email service API
async function sendInvitationEmail(
	emailData: {
		to: string;
		from: string;
		subject: string;
		htmlContent: string;
		textContent: string;
	},
	apiKey?: string
): Promise<{ success: boolean; error?: string }> {
	try {
		// For Cloudflare Workers, you would typically use:
		// 1. SendGrid API
		// 2. Mailgun API
		// 3. AWS SES
		// 4. Cloudflare Email Workers (when available)
		// 5. Any other email service API

		// Example implementation using a generic email API:
		// Uncomment and modify based on your email service provider

		/*
		if (!apiKey) {
			throw new Error("Email service API key not configured");
		}

		const response = await fetch("https://api.emailservice.com/v1/send", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				from: emailData.from,
				to: emailData.to,
				subject: emailData.subject,
				html: emailData.htmlContent,
				text: emailData.textContent,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Email service error: ${errorText}`);
		}

		return { success: true };
		*/

		// Temporary mock implementation for development
		// Replace this with actual email service integration
		console.log("Email would be sent:", {
			to: emailData.to,
			from: emailData.from,
			subject: emailData.subject,
		});

		// Simulate successful email send
		return { success: true };
	} catch (error) {
		console.error("Email sending error:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		};
	}
}
