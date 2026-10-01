import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

// Module 7 gap-closure - see ExternalReference's own doc comment in task.schema.ts for why this is
// a manually-pasted label+URL pair rather than a real GitHub/GitLab connector.
export class AddExternalReferenceDto {
  @ApiProperty({ description: 'A short label, e.g. "PR #42" or "fix/login-bug"' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label!: string;

  @ApiProperty({ description: 'The full URL this reference points to' })
  // require_protocol: a scheme-less "github.com/..." would otherwise pass and then render as a
  // relative in-app href on the frontend.
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true },
    { message: 'url must be a valid http(s) URL' },
  )
  @MaxLength(2000)
  url!: string;
}
