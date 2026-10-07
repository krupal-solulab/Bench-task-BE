import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role } from '../../../common/enums/role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // Mongoose's transform typings don't carry the schema's field shape through; `any` is the
    // documented escape hatch for this callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.passwordHash;
      return ret;
    },
  },
})
export class User {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 60 })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, enum: Role, default: Role.DEVELOPER })
  role!: Role;

  @Prop({ default: true })
  isActive!: boolean;

  // null only for PlatformAdmin, who isn't scoped to any organization; required for every
  // other role.
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    default: null,
    required: function (this: User) {
      return this.role !== Role.PLATFORM_ADMIN;
    },
  })
  organizationId!: Types.ObjectId | null;

  // Module 11 gap-closure: the user's own display time zone (IANA). Null - every existing user -
  // means "use the browser's", exactly as before.
  @Prop({ type: String, default: null, maxlength: 60 })
  timezone!: string | null;

  // Set for an account created from a project invite (signed in with a generated temporary
  // password): every API call except setting a new password is refused until it is cleared.
  @Prop({ default: false })
  mustChangePassword!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ role: 1 });
UserSchema.index({ isActive: 1 });
UserSchema.index({ organizationId: 1 });
