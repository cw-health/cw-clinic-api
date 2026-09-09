import * as argon2 from 'argon2';

/**
 * Standalone (non-DI) functions so seed scripts can hash fixture passwords
 * identically to the auth module without booting Nest's DI container —
 * see prisma/seed.dev.ts. argon2id per docs/SECURITY.md §1.
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
