import { hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('hashes a password with an argon2id hash', async () => {
    const hash = await hashPassword('CorrectHorseBatteryStaple1!');
    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('CorrectHorseBatteryStaple1!');
    await expect(verifyPassword(hash, 'CorrectHorseBatteryStaple1!')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('CorrectHorseBatteryStaple1!');
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });

  it('rejects a malformed hash instead of throwing', async () => {
    await expect(verifyPassword('not-a-real-hash', 'anything')).resolves.toBe(false);
  });
});
