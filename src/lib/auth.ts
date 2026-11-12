import "server-only";
import bcrypt from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loadActor, type Actor } from "./core";
import { one, pool } from "./db";

const COOKIE = "vms_session";
const MAX_AGE = 60 * 60 * 10; // 10 hours, one working day

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return new TextEncoder().encode(s);
}

export async function login(email: string, password: string): Promise<boolean> {
  const u = await one<{ id: number; password_hash: string | null }>(
    pool,
    "select id, password_hash from app_user where lower(email) = lower($1) and active",
    [email.trim()],
  );
  if (!u?.password_hash || !(await bcrypt.compare(password, u.password_hash))) return false;
  const token = await new SignJWT({ uid: u.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return true;
}

export async function logout() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, or null. Cached for one request. */
export const currentUser = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return (await loadActor(pool, Number(payload.uid))) ?? null;
  } catch {
    return null;
  }
});

export async function requireUser(): Promise<Actor> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
