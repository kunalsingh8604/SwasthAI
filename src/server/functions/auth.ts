import { createServerFn } from "@tanstack/react-start";
import { connectDB } from "@/lib/mongodb/db";
import { User } from "@/lib/mongodb/models/User";
import { hashPassword, comparePassword, generateToken, verifyToken } from "@/lib/auth";

export const signUpFn = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string; preferredLanguage?: string }) => data)
  .handler(async ({ data }) => {
    await connectDB();
    const existing = await User.findOne({ email: data.email.toLowerCase() });
    if (existing) {
      throw new Error("User with this email already exists");
    }

    const passwordHash = await hashPassword(data.password);
    const user = await User.create({
      email: data.email.toLowerCase(),
      passwordHash,
      preferredLanguage: data.preferredLanguage || "en",
      displayName: data.email.split("@")[0],
    });

    const token = generateToken({ userId: user._id.toString(), email: user.email });

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
        preferredLanguage: user.preferredLanguage,
      },
      token,
    };
  });

export const signInFn = createServerFn({ method: "POST" })
  .inputValidator((data: { email: string; password: string }) => data)
  .handler(async ({ data }) => {
    await connectDB();
    const user = await User.findOne({ email: data.email.toLowerCase() });
    if (!user) {
      throw new Error("Invalid email or password");
    }

    const isMatch = await comparePassword(data.password, user.passwordHash);
    if (!isMatch) {
      throw new Error("Invalid email or password");
    }

    const token = generateToken({ userId: user._id.toString(), email: user.email });

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
        preferredLanguage: user.preferredLanguage,
      },
      token,
    };
  });

export const getMeFn = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    if (!data.token) return { user: null };
    const decoded = verifyToken(data.token);
    if (!decoded) return { user: null };

    await connectDB();
    const user = await User.findById(decoded.userId).select("-passwordHash");
    if (!user) return { user: null };

    return {
      user: {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName,
        preferredLanguage: user.preferredLanguage,
      },
    };
  });
