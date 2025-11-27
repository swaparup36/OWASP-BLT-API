import { Context } from "hono";
import { BlankInput } from "hono/types";
import prisma from "../utils/db";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

type AppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		userId?: string;
	};
};


export const signup = async (c : Context<AppEnv, "/auth/signup", BlankInput>) => {
    try {
        const { username, email, password, confirmPassword } = await c.req.json();

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [
                    { username },
                    { email }
                ]
            }
        });

        if (existingUser) {
            return c.json({ error: "Username or email already exists." }, 400);
        }

        if (password !== confirmPassword) {
            return c.json({ error: "Passwords do not match." }, 400);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword,
            }
        });

        return c.json({ message: "User registered successfully.", userId: newUser.id }, 200);
    } catch (error) {
        console.error("Signup error:", error);
        return c.json({ error: "An error occurred during signup." }, 500);
    }
}

export const login = async (c : Context<AppEnv, "/auth/login", BlankInput>) => {
    try {
        const { usernameOrEmail, password } = await c.req.json();

        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { username: usernameOrEmail },
                    { email: usernameOrEmail }
                ]
            }
        });

        if (!user) {
            return c.json({ error: "Invalid username/email or password." }, 400);
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return c.json({ error: "Invalid username/email or password." }, 400);
        }

        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "default_secret", { expiresIn: '12h' });

        return c.json({ message: "Login successful.", token }, 200);
    } catch (error) {
        console.error("Login error:", error);
        return c.json({ error: "An error occurred during login." }, 500);
    }
}