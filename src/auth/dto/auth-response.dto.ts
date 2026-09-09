/** Shape returned to Admin/Mobile clients — matches cw-clinic-admin's AuthUser type. */
export interface AuthUserDto {
  id: string;
  name: string;
  email: string;
  role: string | null;
  clinicId: string | null;
  clinicName: string | null;
  permissions: string[];
  /** Platform-level identity flag — true only for a Super Admin (docs/RBAC.md §6). */
  isSuperAdmin: boolean;
}

export interface LoginResponseDto {
  accessToken: string;
  user: AuthUserDto;
  /**
   * Only populated for mobile clients (`X-Client-Platform: mobile`), which
   * store it in Expo SecureStore — web clients get the refresh token
   * exclusively via the httpOnly cookie and never see it in a JS-readable
   * response body (docs/SECURITY.md §1).
   */
  refreshToken?: string;
}
