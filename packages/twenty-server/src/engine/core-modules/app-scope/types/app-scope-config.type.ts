// Metadata describing the app-scope model for one workspace.
// Resolved from flat metadata (see resolve-app-scope-config.util).
export type AppScopeConfig = {
  appObjectMetadataId: string;
  appObjectNameSingular: string;
  // The grant junction, when present. Used to load per-member grants.
  appAccess: {
    objectMetadataId: string;
    memberJoinColumnName: string;
    appJoinColumnName: string;
  } | null;
  // objectMetadataId -> the MANY_TO_ONE relation to the app object.
  // appRelationFieldName drives read filtering; appJoinColumnName the write guard.
  scopedObjects: Record<
    string,
    { appRelationFieldName: string; appJoinColumnName: string }
  >;
};
