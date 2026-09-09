import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function contextStub(): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  it('bypasses authentication for a @Public() route', () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    expect(guard.canActivate(contextStub())).toBe(true);
  });

  it('handleRequest throws a normalized UnauthorizedException on failure', () => {
    const reflector = {} as Reflector;
    const guard = new JwtAuthGuard(reflector);
    expect(() => guard.handleRequest(new Error('boom'), false)).toThrow(UnauthorizedException);
  });

  it('handleRequest throws when passport reports no error but no user either (e.g. expired token)', () => {
    const reflector = {} as Reflector;
    const guard = new JwtAuthGuard(reflector);
    expect(() => guard.handleRequest(null, false)).toThrow(UnauthorizedException);
  });

  it('handleRequest returns the user on success', () => {
    const reflector = {} as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const user = { sub: 'user-1' };
    expect(guard.handleRequest(null, user)).toBe(user);
  });
});
