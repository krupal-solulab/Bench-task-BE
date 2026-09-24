import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * Module 1's "custom link-type editor" - Org Admin can define new link types beyond the 5
 * defaults. Stored per-org (not per-project) since a link can cross projects and its meaning
 * ("Blocks") must read the same everywhere in the org. `inverseName` is what the *target* side of
 * the link sees (BRD: "linking A→B shows B→A automatically") - for a symmetric type like "Relates
 * To" this is simply equal to `name`. `isBlocking` marks which types participate in the dependency
 * graph's circular-dependency check - generalizes the check beyond a hardcoded "blocks" id so an
 * Admin-renamed or newly-added blocking-style type still gets cycle protection.
 */
@Schema({ _id: false })
export class LinkTypeDefinition {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 40 })
  name!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 40 })
  inverseName!: string;

  @Prop({ default: false })
  isBlocking!: boolean;
}

export const LinkTypeDefinitionSchema = SchemaFactory.createForClass(LinkTypeDefinition);

/** Used for every org whose `linkTypes` is empty (every pre-existing org, and any new one that
 * never opens the link-types settings) - same "hardcoded default + optional override" shape as
 * DEFAULT_ISSUE_TYPES/DEFAULT_SLA_POLICY, so nothing changes until an org deliberately opts in. */
export const DEFAULT_LINK_TYPES: LinkTypeDefinition[] = [
  { id: 'blocks', name: 'Blocks', inverseName: 'Is Blocked By', isBlocking: true },
  { id: 'relates-to', name: 'Relates To', inverseName: 'Relates To', isBlocking: false },
  { id: 'duplicates', name: 'Duplicates', inverseName: 'Is Duplicated By', isBlocking: false },
  { id: 'clones', name: 'Clones', inverseName: 'Is Cloned By', isBlocking: false },
  { id: 'causes', name: 'Causes', inverseName: 'Caused By', isBlocking: false },
];

export interface LinkTypesCarrier {
  linkTypes?: LinkTypeDefinition[];
}

export function resolveLinkTypes(org: LinkTypesCarrier): LinkTypeDefinition[] {
  return org.linkTypes && org.linkTypes.length > 0 ? org.linkTypes : DEFAULT_LINK_TYPES;
}
