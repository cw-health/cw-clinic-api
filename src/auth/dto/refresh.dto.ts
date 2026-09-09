import { IsOptional, IsString } from 'class-validator';

/**
 * Body is only used by mobile clients, which have no cookie jar to rely on
 * (docs/SECURITY.md §1) — they send the SecureStore-persisted refresh
 * token explicitly. Web clients send an empty body; the cookie is
 * authoritative for them.
 */
export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
