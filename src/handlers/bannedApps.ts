import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type BannedAppContext = Context<AppEnv>;

// Format banned app data for response
function formatBannedAppResponse(app: any) {
	return {
		app_name: app.appName,
		app_type: app.appType,
		country_name: app.countryName,
		ban_reason: app.banReason,
		ban_date: app.banDate,
		source_url: app.sourceUrl,
	};
}

// Search banned apps by country
export async function searchBannedApps(c: BannedAppContext) {
	try {
		const url = new URL(c.req.url);
		const country = url.searchParams.get("country")?.trim();

		if (!country) {
			return c.json({ apps: [] });
		}

		const apps = await prisma.bannedApp.findMany({
			where: {
				countryName: {
					contains: country,
					mode: "insensitive",
				},
				isActive: true,
			},
			select: {
				appName: true,
				appType: true,
				countryName: true,
				banReason: true,
				banDate: true,
				sourceUrl: true,
			},
		});

		const formattedApps = apps.map(formatBannedAppResponse);

		return c.json({ apps: formattedApps });
	} catch (error) {
		console.error("Error searching banned apps:", error);
		return c.json({ error: "Failed to search banned apps" }, 500);
	}
}
