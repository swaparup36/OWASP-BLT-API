import { Context } from "hono";
import prisma from "../utils/db";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

type StatsContext = Context<AppEnv>;

// Get statistics for bugs, users, hunts, and domains
export async function getStats(c: StatsContext) {
	try {
		const [bugCount, userCount, huntCount, domainCount] = await Promise.all([
			prisma.issue.count(),
			prisma.user.count(),
			prisma.hunt.count(),
			prisma.domain.count(),
		]);

		return c.json({
			bugs: bugCount,
			users: userCount,
			hunts: huntCount,
			domains: domainCount,
		});
	} catch (error) {
		console.error("Error retrieving stats:", error);
		return c.json({ error: "Failed to retrieve stats" }, 500);
	}
}

// Website stats - Track view counts for each URL route
export async function getWebsiteStats(c: StatsContext) {
	try {
		// Get all IP records grouped by path (exclude /admin paths if needed)
		const pathStats = await prisma.$queryRaw<Array<{ path: string; total_views: bigint }>>`
			SELECT path, SUM(count) as total_views
			FROM ip
			WHERE path NOT LIKE '/admin%'
			GROUP BY path
			ORDER BY total_views DESC
		`;

		// Convert BigInt to number for JSON serialization
		const viewStats = pathStats.reduce((acc, record) => {
			if (record.path) {
				acc[record.path] = Number(record.total_views);
			}
			return acc;
		}, {} as Record<string, number>);

		// Get last 30 days of traffic data
		const thirtyDaysAgo = new Date();
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

		const dailyViews = await prisma.$queryRaw<Array<{ date: Date; daily_count: bigint }>>`
			SELECT DATE(created) as date, SUM(count) as daily_count
			FROM ip
			WHERE path NOT LIKE '/admin%'
				AND created >= ${thirtyDaysAgo}
			GROUP BY DATE(created)
			ORDER BY date
		`;

		// Prepare chart data
		const dates: string[] = [];
		const views: number[] = [];
		for (const day of dailyViews) {
			dates.push(day.date.toISOString().split('T')[0]);
			views.push(Number(day.daily_count));
		}

		// Get unique visitors (unique IP addresses)
		const uniqueVisitorsResult = await prisma.iP.groupBy({
			by: ['address'],
			where: {
				path: {
					not: {
						startsWith: '/admin'
					}
				}
			}
		});
		const uniqueVisitors = uniqueVisitorsResult.length;

		// Calculate total views
		const totalViews = Object.values(viewStats).reduce((sum, count) => sum + count, 0);

		// Calculate traffic status
		let status = "normal";
		if (views.length >= 2) {
			const lastDay = views[views.length - 1] || 0;
			const prevDay = views[views.length - 2] || 0;
			if (lastDay < prevDay * 0.5) {
				status = "danger"; // More than 50% drop
			} else if (lastDay < prevDay * 0.8) {
				status = "warning"; // More than 20% drop
			}
		}

		// Get top 50 user agents
		const userAgents = await prisma.$queryRaw<Array<{ 
			agent: string; 
			total_count: bigint; 
			last_request: Date 
		}>>`
			SELECT agent, SUM(count) as total_count, MAX(created) as last_request
			FROM ip
			WHERE path NOT LIKE '/admin%'
				AND agent IS NOT NULL
			GROUP BY agent
			ORDER BY total_count DESC
			LIMIT 50
		`;

		const formattedUserAgents = userAgents.map(ua => ({
			agent: ua.agent,
			total_count: Number(ua.total_count),
			last_request: ua.last_request
		}));

		// Count unique user agents
		const uniqueAgentsResult = await prisma.iP.groupBy({
			by: ['agent'],
			where: {
				path: {
					not: {
						startsWith: '/admin'
					}
				},
				agent: {
					not: null
				}
			}
		});
		const uniqueAgentsCount = uniqueAgentsResult.length;

		// Get all URL paths with their view counts
		const urlInfo = Object.entries(viewStats)
			.map(([path, count]) => ({
				path,
				view_count: count
			}))
			.sort((a, b) => b.view_count - a.view_count);

		// Web traffic stats summary
		const webStats = {
			dates,
			views,
			total_views: totalViews,
			unique_visitors: uniqueVisitors,
			date: new Date().toISOString(),
			status,
			total_urls: urlInfo.length
		};

		return c.json({
			url_info: urlInfo,
			total_views: totalViews,
			web_stats: webStats,
			user_agents: formattedUserAgents,
			unique_agents_count: uniqueAgentsCount
		});

	} catch (error) {
		console.error("Error retrieving website stats:", error);
		return c.json({ error: "Failed to retrieve website stats" }, 500);
	}
}

// Comprehensive stats dashboard with time period filtering
export async function getStatsDashboard(c: StatsContext) {
	try {
		const period = c.req.query("period") || "30";

		// Define time periods in days
		const periodMap: Record<string, number | "ytd"> = {
			"1": 1,      // 1 day
			"7": 7,      // 1 week
			"30": 30,    // 1 month
			"90": 90,    // 3 months
			"ytd": "ytd", // Year to date
			"365": 365,  // 1 year
			"1825": 1825 // 5 years
		};

		const validPeriod = period in periodMap ? period : "30";
		const days = periodMap[validPeriod];

		// Calculate the date range
		const endDate = new Date();
		let startDate: Date;

		if (days === "ytd") {
			startDate = new Date(endDate.getFullYear(), 0, 1); // January 1st of current year
		} else {
			startDate = new Date(endDate);
			startDate.setDate(startDate.getDate() - days);
		}

		const [
			usersInPeriod,
			totalUsers,
			activeUsersInPeriod,
			issuesInPeriod,
			totalIssues,
			openIssuesInPeriod,
			fixedIssuesInPeriod,
			inReviewIssuesInPeriod,
			invalidIssuesInPeriod,
			domainsInPeriod,
			totalDomains,
			activeDomainsInPeriod,
			organizationsInPeriod,
			totalOrganizations,
			activeOrganizationsInPeriod,
			huntsInPeriod,
			totalHunts,
			activeHuntsInPeriod,
			pointsInPeriod,
			totalPointsResult,
			projectsInPeriod,
			totalProjects,
			activitiesInPeriod,
			totalActivities,
			recentActivities
		] = await Promise.all([
			// Users
			prisma.user.count({
				where: { dateJoined: { gte: startDate } }
			}),
			prisma.user.count(),
			prisma.user.count({
				where: {
					dateJoined: { gte: startDate },
					isActive: true
				}
			}),

			// Issues
			prisma.issue.count({
				where: { created: { gte: startDate } }
			}),
			prisma.issue.count(),
			prisma.issue.count({
				where: {
					created: { gte: startDate },
					status: "open"
				}
			}),
			prisma.issue.count({
				where: {
					created: { gte: startDate },
					status: "fixed"
				}
			}),
			prisma.issue.count({
				where: {
					created: { gte: startDate },
					status: "in_review"
				}
			}),
			prisma.issue.count({
				where: {
					created: { gte: startDate },
					status: "invalid"
				}
			}),

			// Domains
			prisma.domain.count({
				where: { created: { gte: startDate } }
			}),
			prisma.domain.count(),
			prisma.domain.count({
				where: {
					created: { gte: startDate },
					isActive: true
				}
			}),

			// Organizations
			prisma.organization.count({
				where: { created: { gte: startDate } }
			}),
			prisma.organization.count(),
			prisma.organization.count({
				where: {
					created: { gte: startDate },
					isActive: true
				}
			}),

			// Hunts
			prisma.hunt.count({
				where: { created: { gte: startDate } }
			}),
			prisma.hunt.count(),
			prisma.hunt.count({
				where: {
					created: { gte: startDate },
					isPublished: true
				}
			}),

			// Points
			prisma.points.aggregate({
				where: { created: { gte: startDate } },
				_sum: { score: true }
			}),
			prisma.points.aggregate({
				_sum: { score: true }
			}),

			// Projects
			prisma.project.count({
				where: { created: { gte: startDate } }
			}),
			prisma.project.count(),

			// Activities
			prisma.activity.count({
				where: { timestamp: { gte: startDate } }
			}),
			prisma.activity.count(),
			prisma.activity.findMany({
				where: { timestamp: { gte: startDate } },
				orderBy: { timestamp: "desc" },
				take: 5,
				select: {
					id: true,
					title: true,
					description: true,
					timestamp: true
				}
			})
		]);

		const pointsTotal = pointsInPeriod._sum.score || 0;
		const totalPointsAllTime = totalPointsResult._sum.score || 0;

		// Generate time series data for charts
		const monthsToFetch = days === "ytd" 
			? endDate.getMonth() + 1 
			: days > 365 
				? Math.min(12, Math.floor(days / 30))
				: Math.min(12, Math.max(1, Math.floor(days / 30)));

		const issuesTimeSeries: number[] = [];
		const usersTimeSeries: number[] = [];

		for (let i = monthsToFetch - 1; i >= 0; i--) {
			const monthEnd = new Date(endDate);
			monthEnd.setDate(monthEnd.getDate() - (i * 30));
			
			const monthStart = new Date(monthEnd);
			monthStart.setDate(monthStart.getDate() - 30);

				const [monthIssues, monthUsers] = await Promise.all([
					prisma.issue.count({
						where: {
							created: {
								gte: monthStart,
								lte: monthEnd
							}
						}
					}),
					prisma.user.count({
						where: {
							dateJoined: {
								gte: monthStart,
								lte: monthEnd
							}
						}
					})
				]);			issuesTimeSeries.push(monthIssues);
			usersTimeSeries.push(monthUsers);
		}

		// Fill remaining months with zeros if we have less than 12 months
		while (issuesTimeSeries.length < 12) {
			issuesTimeSeries.unshift(0);
			usersTimeSeries.unshift(0);
		}

		// Compile comprehensive stats
		const stats = {
			users: {
				total: usersInPeriod,
				active: activeUsersInPeriod,
				total_all_time: totalUsers,
				active_percentage: usersInPeriod > 0 
					? Math.round((activeUsersInPeriod / usersInPeriod) * 100) 
					: 0
			},
			issues: {
				total: issuesInPeriod,
				open: openIssuesInPeriod,
				total_all_time: totalIssues,
				open_percentage: issuesInPeriod > 0 
					? Math.round((openIssuesInPeriod / issuesInPeriod) * 100) 
					: 0,
				fixed: fixedIssuesInPeriod,
				in_review: inReviewIssuesInPeriod,
				invalid: invalidIssuesInPeriod
			},
			domains: {
				total: domainsInPeriod,
				active: activeDomainsInPeriod,
				total_all_time: totalDomains,
				active_percentage: domainsInPeriod > 0 
					? Math.round((activeDomainsInPeriod / domainsInPeriod) * 100) 
					: 0
			},
			organizations: {
				total: organizationsInPeriod,
				active: activeOrganizationsInPeriod,
				total_all_time: totalOrganizations,
				active_percentage: organizationsInPeriod > 0 
					? Math.round((activeOrganizationsInPeriod / organizationsInPeriod) * 100) 
					: 0
			},
			hunts: {
				total: huntsInPeriod,
				active: activeHuntsInPeriod,
				total_all_time: totalHunts,
				active_percentage: huntsInPeriod > 0 
					? Math.round((activeHuntsInPeriod / huntsInPeriod) * 100) 
					: 0
			},
			points: {
				total: pointsTotal,
				total_all_time: totalPointsAllTime,
				percentage: totalPointsAllTime > 0 
					? Math.round((pointsTotal / totalPointsAllTime) * 100) 
					: 0
			},
			projects: {
				total: projectsInPeriod,
				total_all_time: totalProjects,
				percentage: totalProjects > 0 
					? Math.round((projectsInPeriod / totalProjects) * 100) 
					: 0
			},
			activities: {
				total: activitiesInPeriod,
				total_all_time: totalActivities,
				recent: recentActivities.map(activity => ({
					id: activity.id,
					title: activity.title,
					description: activity.description,
					timestamp: activity.timestamp
				}))
			},
			issues_time_series: issuesTimeSeries,
			users_time_series: usersTimeSeries
		};

		return c.json({
			stats,
			period: validPeriod,
			period_options: [
				{ value: "1", label: "1 Day" },
				{ value: "7", label: "1 Week" },
				{ value: "30", label: "1 Month" },
				{ value: "90", label: "3 Months" },
				{ value: "ytd", label: "Year to Date" },
				{ value: "365", label: "1 Year" },
				{ value: "1825", label: "5 Years" }
			],
			date_range: {
				start: startDate.toISOString(),
				end: endDate.toISOString()
			}
		});

	} catch (error) {
		console.error("Error retrieving dashboard stats:", error);
		return c.json({ error: "Failed to retrieve dashboard stats" }, 500);
	}
}
