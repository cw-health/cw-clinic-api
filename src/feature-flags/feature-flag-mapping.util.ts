import type { Clinic, FeatureFlag, FeatureFlagOverride } from '@prisma/client';
import type {
  FeatureFlagDetailResponseDto,
  FeatureFlagResponseDto,
} from './dto/feature-flag-response.dto';

export function toFeatureFlagResponseDto(flag: FeatureFlag): FeatureFlagResponseDto {
  return {
    id: flag.id,
    key: flag.key,
    name: flag.name,
    description: flag.description,
    enabled: flag.enabled,
    scope: flag.scope,
    createdAt: flag.createdAt,
    updatedAt: flag.updatedAt,
  };
}

export type FeatureFlagOverrideWithClinic = FeatureFlagOverride & {
  clinic: Pick<Clinic, 'id' | 'name'> | null;
};

export function toFeatureFlagDetailResponseDto(
  flag: FeatureFlag,
  overrides: FeatureFlagOverrideWithClinic[],
): FeatureFlagDetailResponseDto {
  return {
    ...toFeatureFlagResponseDto(flag),
    overrides: overrides.map((o) => ({
      id: o.id,
      clinicId: o.clinicId,
      clinic: o.clinic ? { id: o.clinic.id, name: o.clinic.name } : null,
      enabled: o.enabled,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    })),
  };
}
