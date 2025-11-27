import { Hono } from "hono";
import { login, signup } from "./handlers/auth";
import { listIssues, retrieveIssue, createIssue } from "./handlers/issues";
import { listUserIssues, retrieveUserIssue, headUserIssues } from "./handlers/userissues";
import { listProfiles, retrieveProfile, updateProfile, headProfiles } from "./handlers/profile";
import { listDomains, retrieveDomain, createDomain, headDomains } from "./handlers/domain";
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
import { getOrganizationRepositories } from "./handlers/organization";
import { authMiddleware } from "./middleware/auth-middleware";

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
v1.get("/organizations/:id/repositories", async (c) => getOrganizationRepositories(c));

app.route('/v1', v1);
app.get("/", (c) => {
  return c.text("Hello Hono!");
});

export default app;
