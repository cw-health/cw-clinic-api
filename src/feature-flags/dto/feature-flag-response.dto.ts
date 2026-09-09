/** Shape returned to the client for a single flag. */
export interface FeatureFlagResponseDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  scope: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Clinic-override rows attached to the "view details" response only. */
export interface FeatureFlagOverrideResponseDto {
  id: string;
  clinicId: string;
  clinic: { id: string; name: string } | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureFlagDetailResponseDto extends FeatureFlagResponseDto {
  overrides: FeatureFlagOverrideResponseDto[];
}
