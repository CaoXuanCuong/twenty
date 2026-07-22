import { type ObjectLiteral } from 'typeorm';

import { isDefined } from 'twenty-shared/utils';

import { applyAppScopeFilter } from 'src/engine/core-modules/app-scope/utils/apply-app-scope-filter.util';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { type WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-select-query-builder';

// Reads the app-scope decision from the workspace context and applies the
// filter when relevant. No config = no app-scope model in this workspace.
// null/undefined accessibleAppIds = bypass (non-user context or bypass role).
export const applyAppScopeFilterFromContext = <T extends ObjectLiteral>({
  queryBuilder,
  objectMetadata,
  internalContext,
}: {
  queryBuilder: WorkspaceSelectQueryBuilder<T>;
  objectMetadata: FlatObjectMetadata;
  internalContext: WorkspaceInternalContext;
}): void => {
  const config = internalContext.appScopeConfig;
  const accessibleAppIds = internalContext.appScopeAccessibleAppIds;

  if (!isDefined(config) || !isDefined(accessibleAppIds)) {
    return;
  }

  applyAppScopeFilter({
    queryBuilder,
    objectMetadata,
    flatFieldMetadataMaps: internalContext.flatFieldMetadataMaps,
    config,
    accessibleAppIds,
  });
};
