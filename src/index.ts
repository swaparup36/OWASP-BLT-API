import { Hono } from "hono";
import { login, signup } from "./handlers/auth";
import { listIssues, retrieveIssue, createIssue, getIssueLikes, likeIssue } from "./handlers/issues";
import { listUserIssues, retrieveUserIssue, headUserIssues } from "./handlers/userissues";
import { listProfiles, retrieveProfile, updateProfile, headProfiles } from "./handlers/profile";
import { listDomains, retrieveDomain, createDomain, headDomains, updateDomain, deleteDomain, deleteManager } from "./handlers/domain";
import { checkDomainSecurityTxt } from "./handlers/checkDomainSeqTxt";
import {
	listTimeLogs,
	retrieveTimeLog,
	createTimeLog,
	updateTimeLog,
	deleteTimeLog,
	startTimeLog,
	stopTimeLog,
} from "./handlers/timelog";
import {
	listActivityLogs,
	retrieveActivityLog,
	createActivityLog,
	updateActivityLog,
	deleteActivityLog,
} from "./handlers/activitylog";
import { getOrganizationRepositories, acceptBug, addOrganizationRole, updateOrganizationRole, removeOrganizationRole, createOrganization, getOrganizationDetails, getOrganizationSlackIntegration, getUserOrganizations, getOrganizationBugHunts, getOrganizationIssues, getOrganizationDomains, getOrganizationRoles, getOrganizationTeamOverview } from "./handlers/organization";
import {
	getSlackIntegration,
	getSlackChannels,
	createOrUpdateSlackIntegration,
	initiateSlackOAuth,
	handleSlackOAuthCallback,
	deleteSlackIntegration,
} from "./handlers/slack";
import { listHunts, createHunt, updateHunt, getHuntDetails, editPrize, deletePrize } from "./handlers/bughunt";
import { listHuntsV2 } from "./handlers/bughunts_v2";
import { inviteFriend } from "./handlers/invite";
import { getLeaderboardHandler } from "./handlers/leaderboard";
import { listProjects, createProject, searchProjects, filterProjects } from "./handlers/project";
import { getStats, getStatsDashboard, getWebsiteStats } from "./handlers/stats";
import { listTags, retrieveTag, createTag, updateTag, deleteTag, headTags } from "./handlers/tags";
import { createBaconSubmission, listBaconSubmissions, retrieveBaconSubmission, baconRequestsView, baconView, batchSendBaconTokens, getWalletBalance, initiateTransaction, pendingTransactionsView, updateSubmissionStatus } from "./handlers/bacon";
import { searchBannedApps } from "./handlers/bannedApps";
import { badgeList } from "./handlers/badge";
import { getHomeData } from "./handlers/home";
import { search } from "./handlers/search";
import {
	listTemplates,
	retrieveTemplate,
	retrieveTemplateByName,
	createTemplate,
	batchCreateTemplates,
	updateTemplate,
	batchUpdateTemplates,
	deleteTemplate,
	getTemplateStats,
	headTemplates,
} from "./handlers/templates";
import { setVoteStatus, voteForumPost } from "./handlers/forumVotes";
import { getReminderSettings, updateReminderSettings, deactivateReminderSettings, sendTestReminder } from "./handlers/reminder";
import { addLecture, deleteLecture, editLecture, getLectureData, getStandaloneLecture, markLectureComplete, updateLecturesOrder } from "./handlers/lecture";
import { addSection, getCourseSections, updateSection, deleteSection } from "./handlers/section";
import { createOrUpdateCourse, courseContentManagement, getCourseDetails } from "./handlers/course";
import { educationHome } from "./handlers/education";
import { getInstructorDashboard } from "./handlers/instructor";
import { getHackathonDetail, listHackathons, createHackathonPrize, createHackathonSponsor, updateHackathon, addOrgReposToHackathon, refreshAllHackathonRepositories, refreshSingleRepository } from "./handlers/hackathon";
import { authMiddleware } from "./middleware/auth-middleware";
import { validateOrganizationUser } from "./middleware/organization-middleware";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};

const app = new Hono<AppEnv>();

const v1 = new Hono<AppEnv>();

v1.get("/hello", (c) => {
  return c.json({ message: "Hello from v1!" });
});

// Auth routes
v1.post("/auth/signup", async (c) => signup(c));
v1.post("/auth/login", async (c) => login(c));

// Issue routes
v1.get("/issues", async (c) => listIssues(c));
v1.get("/issues/:id", async (c) => retrieveIssue(c));
v1.post("/issues", authMiddleware, async (c) => createIssue(c));
v1.get("/issues/:id/like", getIssueLikes);
v1.post("/issues/:id/like", authMiddleware, likeIssue);

// User Issue routes (with optional auth for different visibility)
v1.get("/userissues", async (c) => listUserIssues(c));
v1.get("/userissues/:id", async (c) => retrieveUserIssue(c));
v1.on("HEAD", "/userissues", async (c) => headUserIssues(c));

// Profile routes
v1.get("/profile", async (c) => listProfiles(c));
v1.get("/profile/:userId", async (c) => retrieveProfile(c));
v1.put("/profile", authMiddleware, async (c) => updateProfile(c));
v1.on("HEAD", "/profile", async (c) => headProfiles(c));

// Domain routes
v1.get("/domain", async (c) => listDomains(c));
v1.get("/domain/:id", async (c) => retrieveDomain(c));
v1.post("/domain", async (c) => createDomain(c));
v1.put("/domain/:id", authMiddleware, updateDomain);
v1.delete("/domain/:id", authMiddleware, deleteDomain);
v1.delete("/domain/:domain_id/manager/:manager_id", authMiddleware, deleteManager);
v1.post("/domain/:id/check-security-txt", authMiddleware, async (c) => checkDomainSecurityTxt(c));
v1.on("HEAD", "/domain", async (c) => headDomains(c));

// TimeLog routes (all require authentication)
v1.get("/timelogs", authMiddleware, listTimeLogs);
v1.get("/timelogs/:id", authMiddleware, retrieveTimeLog);
v1.post("/timelogs", authMiddleware, createTimeLog);
v1.put("/timelogs/:id", authMiddleware, updateTimeLog);
v1.delete("/timelogs/:id", authMiddleware, deleteTimeLog);
v1.post("/timelogs/start", authMiddleware, startTimeLog);
v1.post("/timelogs/:id/stop", authMiddleware, stopTimeLog);

// ActivityLog routes (all require authentication)
v1.get("/activitylogs", authMiddleware, listActivityLogs);
v1.get("/activitylogs/:id", authMiddleware, retrieveActivityLog);
v1.post("/activitylogs", authMiddleware, createActivityLog);
v1.put("/activitylogs/:id", authMiddleware, updateActivityLog);
v1.delete("/activitylogs/:id", authMiddleware, deleteActivityLog);

// Organization routes
v1.get("/organizations", authMiddleware, getUserOrganizations);
v1.post("/organizations", authMiddleware, createOrganization);
v1.get("/organizations/:id", async (c) => getOrganizationDetails(c));
v1.get("/organizations/:id/bughunts", async (c) => getOrganizationBugHunts(c));
v1.get("/organizations/:id/issues", async (c) => getOrganizationIssues(c));
v1.get("/organizations/:id/domains", async (c) => getOrganizationDomains(c));
v1.get("/organizations/:id/team-overview", async (c) => getOrganizationTeamOverview(c));
v1.get("/organizations/:id/repositories", async (c) => getOrganizationRepositories(c));
v1.get("/organizations/:id/integrations/slack", async (c) => getOrganizationSlackIntegration(c));

// Organization role management routes (require authentication and admin permissions)
v1.get("/organizations/:id/roles", authMiddleware, getOrganizationRoles);
v1.post("/organizations/:id/roles/add", authMiddleware, addOrganizationRole);
v1.post("/organizations/:id/roles/update", authMiddleware, updateOrganizationRole);
v1.post("/organizations/:id/roles/remove", authMiddleware, removeOrganizationRole);

// Accept bug route (require authentication and organization permissions)
v1.post("/organizations/accept_bug/:issue_id/:reward_id", authMiddleware, acceptBug);

// Slack Integration routes
v1.get("/organizations/:id/slack/integration", authMiddleware, getSlackIntegration);
v1.get("/organizations/:id/slack/channels", authMiddleware, getSlackChannels);
v1.post("/organizations/:id/slack/integration", authMiddleware, createOrUpdateSlackIntegration);
v1.post("/organizations/:id/slack/oauth/initiate", authMiddleware, initiateSlackOAuth);
v1.delete("/organizations/:id/slack/integration", authMiddleware, deleteSlackIntegration);

// OAuth callback routes (no auth middleware as Slack will call this)
v1.get("/oauth/slack/callback", handleSlackOAuthCallback);

// Bug Hunt routes
v1.get("/hunts", async (c) => listHunts(c));
v1.get("/hunts/:huntId", async (c) => getHuntDetails(c));
v1.get("/hunts/v2", async (c) => listHuntsV2(c));
v1.post("/organizations/:id/hunts", authMiddleware, validateOrganizationUser, createHunt);
v1.put("/organizations/:id/hunts/:huntId", authMiddleware, validateOrganizationUser, updateHunt);
v1.put("/organizations/:id/prizes/:prizeId", authMiddleware, validateOrganizationUser, editPrize);
v1.delete("/organizations/:id/prizes/:prizeId", authMiddleware, validateOrganizationUser, deletePrize);

// Invite routes (require authentication)
v1.post("/invite/friend", authMiddleware, async (c) => inviteFriend(c));

// Leaderboard routes
v1.get("/leaderboard", async (c) => getLeaderboardHandler(c));

// Project routes
v1.get("/projects", async (c) => listProjects(c));
v1.post("/projects", authMiddleware, async (c) => createProject(c));
v1.get("/projects/search", async (c) => searchProjects(c));
v1.get("/projects/filter", async (c) => filterProjects(c));

// Stats routes
v1.get("/stats", async (c) => getStats(c));
v1.get("/stats/dashboard", async (c) => getStatsDashboard(c));
v1.get("/stats/website", async (c) => getWebsiteStats(c));

// Tag routes
v1.get("/tags", async (c) => listTags(c));
v1.get("/tags/:id", async (c) => retrieveTag(c));
v1.post("/tags", authMiddleware, async (c) => createTag(c));
v1.put("/tags/:id", authMiddleware, async (c) => updateTag(c));
v1.delete("/tags/:id", authMiddleware, async (c) => deleteTag(c));
v1.on("HEAD", "/tags", async (c) => headTags(c));

// Bacon Submission routes (all require authentication)
v1.post("/bacon/submissions", authMiddleware, createBaconSubmission);
v1.get("/bacon/submissions", authMiddleware, listBaconSubmissions);
v1.get("/bacon/submissions/:id", authMiddleware, retrieveBaconSubmission);
v1.post("/bacon/submissions/:id/update-status", authMiddleware, updateSubmissionStatus); // Update submission status (mentor only)
v1.get("/bacon/requests", authMiddleware, baconRequestsView);
v1.get("/bacon", baconView); // Public endpoint with optional auth
v1.post("/bacon/batch-send-tokens", authMiddleware, batchSendBaconTokens); // Batch send tokens
v1.get("/bacon/wallet-balance", authMiddleware, getWalletBalance); // Get wallet balance (mentor only)
v1.get("/bacon/initiate-transaction", authMiddleware, initiateTransaction); // Get pending submissions (mentor only)
v1.post("/bacon/initiate-transaction", authMiddleware, initiateTransaction); // Initiate transaction (mentor only)
v1.get("/bacon/pending-transactions", pendingTransactionsView); // Get pending transactions (users with tokens)

// Banned Apps routes
v1.get("/banned-apps/search", async (c) => searchBannedApps(c));

// Badge routes
v1.get("/badges", async (c) => badgeList(c));

// Home routes
v1.get("/home", async (c) => getHomeData(c));

// Search routes (supports optional authentication for enhanced results)
v1.get("/search", async (c) => search(c));

// Forum vote routes
v1.post("/forum/vote-status", authMiddleware, setVoteStatus);
v1.post("/forum/vote", authMiddleware, voteForumPost);

// Template routes
v1.get("/templates", async (c) => listTemplates(c));
v1.get("/templates/stats", async (c) => getTemplateStats(c));
v1.get("/templates/:id", async (c) => retrieveTemplate(c));
v1.get("/templates/by-name/:name", async (c) => retrieveTemplateByName(c));
v1.post("/templates", authMiddleware, async (c) => createTemplate(c));
v1.post("/templates/batch", authMiddleware, async (c) => batchCreateTemplates(c));
v1.put("/templates/:id", authMiddleware, async (c) => updateTemplate(c));
v1.put("/templates/batch", authMiddleware, async (c) => batchUpdateTemplates(c));
v1.delete("/templates/:id", authMiddleware, async (c) => deleteTemplate(c));
v1.on("HEAD", "/templates", async (c) => headTemplates(c));

// Reminder Settings routes (all require authentication)
v1.get("/reminder-settings", authMiddleware, getReminderSettings);
v1.post("/reminder-settings", authMiddleware, updateReminderSettings);
v1.delete("/reminder-settings", authMiddleware, deactivateReminderSettings);
v1.post("/reminder-settings/send-test", authMiddleware, sendTestReminder);

// Lecture routes
v1.post("/lectures", authMiddleware, addLecture);
v1.put("/lectures/:lectureId", authMiddleware, editLecture);
v1.get("/lectures/:lectureId/data", authMiddleware, getLectureData);
v1.get("/lectures/:lectureId/standalone", authMiddleware, getStandaloneLecture);
v1.delete("/lectures/:lectureId", authMiddleware, deleteLecture);
v1.post("/lectures/:lectureId/complete", authMiddleware, markLectureComplete);

// Course routes (all require authentication for instructor operations)
v1.post("/courses", authMiddleware, createOrUpdateCourse);
v1.put("/courses/:id", authMiddleware, getCourseDetails);
v1.get("/courses/:courseId/content", authMiddleware, courseContentManagement);

// Education routes
v1.get("/education/home", async (c) => educationHome(c));

// Instructor routes (require authentication)
v1.get("/instructor/dashboard", authMiddleware, getInstructorDashboard);

// Section routes (all require authentication)
v1.post("/courses/:courseId/sections", authMiddleware, addSection);
v1.get("/courses/:courseId/sections", getCourseSections);
v1.put("/courses/:courseId/sections/:sectionId", authMiddleware, updateSection);
v1.delete("/courses/:courseId/sections/:sectionId", authMiddleware, deleteSection);
v1.post("/sections/:sectionId/lectures/order", authMiddleware, updateLecturesOrder);

// Hackathon routes
v1.get("/hackathons", async (c) => listHackathons(c));
v1.get("/hackathons/:slug", async (c) => getHackathonDetail(c));
v1.put("/hackathons/:slug", authMiddleware, updateHackathon);
v1.post("/hackathons/:slug/add-org-repos", authMiddleware, addOrgReposToHackathon);
v1.post("/hackathons/:slug/refresh-repositories", authMiddleware, refreshAllHackathonRepositories);
v1.post("/hackathons/:slug/repositories/:repoId/refresh", authMiddleware, refreshSingleRepository);
v1.post("/hackathons/:slug/prizes", authMiddleware, createHackathonPrize);
v1.post("/hackathons/:slug/sponsors", authMiddleware, createHackathonSponsor);

app.route('/v1', v1);
app.get("/", (c) => {
  return c.text("Hello Hono!");
});

export default app;
