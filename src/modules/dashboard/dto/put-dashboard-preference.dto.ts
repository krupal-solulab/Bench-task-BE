import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { DASHBOARD_WIDGET_IDS } from '../schemas/dashboard-preference.schema';

export class PutDashboardPreferenceDto {
  @ApiProperty({ enum: DASHBOARD_WIDGET_IDS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(DASHBOARD_WIDGET_IDS, { each: true })
  hiddenWidgets!: string[];

  @ApiProperty({ enum: DASHBOARD_WIDGET_IDS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(DASHBOARD_WIDGET_IDS, { each: true })
  widgetOrder!: string[];
}
