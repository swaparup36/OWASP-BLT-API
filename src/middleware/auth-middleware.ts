import { MiddlewareHandler } from "hono";
import jwt, { JwtPayload } from "jsonwebtoken";

type AuthVariables = { userId: string };

export const authMiddleware: MiddlewareHandler<{
	Bindings: CloudflareBindings;
	Variables: AuthVariables;
}> = async (c, next) => {
	const authHeader = c.req.header("Authorization");

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return c.json({ error: "Authorization header missing or malformed." }, 401);
	}

	const token = authHeader.slice("Bearer ".length).trim();

	if (!token) {
		return c.json({ error: "Authorization header missing or malformed." }, 401);
	}

	const secret = (c.env as { JWT_SECRET?: string }).JWT_SECRET || process.env.JWT_SECRET || "default_secret";

	try {
		const payload = jwt.verify(token, secret) as JwtPayload;
		const userId = payload?.userId;

		if (!userId || typeof userId !== "string") {
			return c.json({ error: "Invalid token payload." }, 401);
		}

		c.set("userId", userId);
		await next();
	} catch (error) {
		console.error("JWT verification failed:", error);
		return c.json({ error: "Invalid or expired token." }, 401);
	}
};
