export interface BranchResponseDto {
  id: string;
  clinicId: string;
  name: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  timezone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}
