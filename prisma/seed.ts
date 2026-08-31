/**
 * Seed entrypoint (`npm run seed` / `prisma db seed`). Dispatches to the
 * environment-specific seed script based on NODE_ENV. An unknown/unset
 * target throws rather than silently seeding the wrong profile — see
 * docs/DATABASE.md §5.
 *
 * `npm run seed` invokes this directly via ts-node, bypassing
 * prisma.config.ts's own dotenv loading (that only runs when the Prisma
 * CLI itself invokes the seed hook, e.g. after `migrate dev`) — so this
 * entrypoint loads `.env` itself. A no-op when the vars are already in the
 * environment (CI, Plesk's env var panel).
 */
import 'dotenv/config';

const target = process.env.NODE_ENV;

switch (target) {
  case 'production':
    void import('./seed.prod');
    break;
  case 'test':
    void import('./seed.test');
    break;
  case 'development':
    void import('./seed.dev');
    break;
  default:
    throw new Error(
      `Unknown seed target NODE_ENV="${String(target)}". Expected one of: development, test, production.`,
    );
}
