import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { users } from "@/db/schema";

export async function createUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<
  | { ok: true; user: { id: string; email: string; name: string | null } }
  | { ok: false; error: string; status: number }
> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email.", status: 400 };
  }
  if (password.length < 8) {
    return {
      ok: false,
      error: "Password must be at least 8 characters.",
      status: 400,
    };
  }

  const db = getDb();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) {
    return { ok: false, error: "An account with that email already exists.", status: 409 };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(users)
    .values({
      email,
      name: input.name?.trim() || email.split("@")[0] || "Member",
      passwordHash,
    })
    .returning({ id: users.id, email: users.email, name: users.name });

  if (!user) {
    return { ok: false, error: "Could not create account.", status: 500 };
  }
  return { ok: true, user };
}
