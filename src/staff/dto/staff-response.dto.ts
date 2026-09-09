/** A staff member is a ClinicMembership row, projected together with its User identity fields — never passwordHash (docs/SECURITY.md §9). */
export interface StaffResponseDto {
  /** The ClinicMembership id — the identifier every staff endpoint's `:id` refers to. */
  id: string;
  userId: string;
  clinicId: string;
  firstName: string;
  lastName: string;
  email: string;
  /** ClinicMembership.status — gates login for this clinic (docs/RBAC.md §1); independent of userStatus below. */
  status: string;
  /** The underlying User.status — ACTIVE once the invite is accepted, PENDING until then. */
  userStatus: string;
  role: { id: string; name: string; description: string | null };
  branch: { id: string; name: string; code: string } | null;
  department: { id: string; name: string; code: string } | null;
  /** True while an invitation exists and hasn't been accepted yet — drives the "Resend invite" action in the UI. */
  invitePending: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Returned once, only from create/resend-invite — never persisted or re-fetchable, per UserInvitationsService's own doc comment. */
export interface StaffInviteInfo {
  token: string;
  expiresAt: Date;
}

export interface StaffCreateResponseDto extends StaffResponseDto {
  invite: StaffInviteInfo;
}

/** A role the caller may assign — either a system template or the clinic's own custom Role (never SuperAdmin/Patient — see StaffService.listAssignableRoles). */
export interface AssignableRoleDto {
  id: string;
  name: string;
  description: string | null;
}
