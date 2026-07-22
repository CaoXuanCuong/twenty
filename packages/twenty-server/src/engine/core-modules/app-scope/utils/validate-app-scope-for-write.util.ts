import { isDefined } from 'twenty-shared/utils';

import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import {
  PermissionsException,
  PermissionsExceptionCode,
} from 'src/engine/metadata-modules/permissions/permissions.exception';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';

const extractAppId = (
  row: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === 'string') {
      return value;
    }

    if (
      isDefined(value) &&
      typeof value === 'object' &&
      typeof (value as { id?: unknown }).id === 'string'
    ) {
      return (value as { id: string }).id;
    }
  }

  return undefined;
};

// Blocks writing a record into an app the caller cannot access. Rows whose app
// is left unset are not blocked here (handled by field nullability). Bypass and
// non-scoped objects are no-ops.
export const validateAppScopeForWrite = ({
  objectMetadata,
  internalContext,
  rows,
  shouldBypassPermissionChecks,
}: {
  objectMetadata: FlatObjectMetadata;
  internalContext: WorkspaceInternalContext;
  rows: Array<Record<string, unknown> | undefined | null>;
  shouldBypassPermissionChecks: boolean;
}): void => {
  if (shouldBypassPermissionChecks) {
    return;
  }

  const config = internalContext.appScopeConfig;
  const accessibleAppIds = internalContext.appScopeAccessibleAppIds;

  if (!isDefined(config) || !isDefined(accessibleAppIds)) {
    return;
  }

  const scopedObject = config.scopedObjects[objectMetadata.id];

  if (!isDefined(scopedObject)) {
    return;
  }

  const allowedAppIds = new Set(accessibleAppIds);

  for (const row of rows) {
    if (!isDefined(row)) {
      continue;
    }

    const appId = extractAppId(
      row,
      scopedObject.appJoinColumnName,
      scopedObject.appRelationFieldName,
    );

    if (!isDefined(appId)) {
      continue;
    }

    if (!allowedAppIds.has(appId)) {
      throw new PermissionsException(
        'App-scope: not allowed to write a record for this app',
        PermissionsExceptionCode.PERMISSION_DENIED,
      );
    }
  }
};
