// Electronic signature: the signer re-enters their password at the moment of signing. Callers store who signed,
// when, and a hash of what was signed. Do not weaken this (CLAUDE.md, Rules).
import bcrypt from "bcryptjs";
import type { Actor } from "./access";
import type { Db } from "./db";
import { one } from "./db";
import { AppError } from "./util";

export async function checkPassword(c: Db, actor: Actor, password: string) {
  const row = await one<{ password_hash: string | null }>(c, "select password_hash from app_user where id = $1", [actor.id]);
  if (!password || !row?.password_hash || !(await bcrypt.compare(password, row.password_hash))) {
    throw new AppError("Password is not correct. Your signature was not recorded.", 401);
  }
}
