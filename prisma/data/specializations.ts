// Baseline medical specialization catalogue — genuinely global reference
// data (docs/DATABASE.md §1: "a shared medicine catalog" analog), seeded
// once and attached to doctors via DoctorSpecialization rather than each
// clinic maintaining its own free-text taxonomy.

export const SPECIALIZATIONS: string[] = [
  'General Medicine',
  'Pediatrics',
  'Cardiology',
  'Dermatology',
  'Orthopedics',
  'Gynecology & Obstetrics',
  'ENT (Otolaryngology)',
  'Ophthalmology',
  'Psychiatry',
  'Neurology',
  'Dentistry',
  'Endocrinology',
  'Gastroenterology',
  'Pulmonology',
  'Urology',
  'General Surgery',
];
