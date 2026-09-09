import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  token!: string;

  @IsIn(['IOS', 'ANDROID', 'WEB'])
  platform!: 'IOS' | 'ANDROID' | 'WEB';
}
