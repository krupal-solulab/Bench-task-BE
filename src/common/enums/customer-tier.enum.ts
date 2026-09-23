// What the BRD's Advanced SLA keys on alongside priority/channel (e.g. Enterprise gets a tighter
// SLA than Standard). Fixed set for v1 - extend here if a later batch needs more granularity.
export enum CustomerTier {
  STANDARD = 'Standard',
  ENTERPRISE = 'Enterprise',
}
