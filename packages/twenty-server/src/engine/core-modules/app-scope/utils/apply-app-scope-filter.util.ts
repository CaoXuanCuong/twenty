import { Brackets, type ObjectLiteral } from 'typeorm';

import { type RecordGqlOperationFilter } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { GraphqlQueryFilterFieldParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query-filter/graphql-query-filter-field.parser';
import { type AppScopeConfig } from 'src/engine/core-modules/app-scope/types/app-scope-config.type';
import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-select-query-builder';

// Restricts a query to records whose app is within the caller's accessible set.
// Applies only to the app object (by its own id) and to objects carrying a
// MANY_TO_ONE relation to the app object. Other objects are left untouched.
export const applyAppScopeFilter = <T extends ObjectLiteral>({
  queryBuilder,
  objectMetadata,
  flatFieldMetadataMaps,
  config,
  accessibleAppIds,
}: {
  queryBuilder: WorkspaceSelectQueryBuilder<T>;
  objectMetadata: FlatObjectMetadata;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
  config: AppScopeConfig;
  accessibleAppIds: string[];
}): void => {
  const scopedObject = config.scopedObjects[objectMetadata.id];

  if (!isDefined(scopedObject)) {
    return;
  }

  // No grant means no access to any app-scoped record.
  if (accessibleAppIds.length === 0) {
    queryBuilder.andWhere('1 = 0');

    return;
  }

  const recordFilter: RecordGqlOperationFilter = {
    [scopedObject.appRelationFieldName]: { in: accessibleAppIds },
  };

  const isUpdateOrDeleteQuery =
    queryBuilder.expressionMap.queryType === 'update' ||
    queryBuilder.expressionMap.queryType === 'soft-delete' ||
    queryBuilder.expressionMap.queryType === 'delete';

  const fieldParser = new GraphqlQueryFilterFieldParser(
    objectMetadata,
    flatFieldMetadataMaps,
  );

  const outerQueryBuilder =
    queryBuilder as WorkspaceSelectQueryBuilder<ObjectLiteral>;

  const whereCondition = new Brackets((qb) => {
    Object.entries(recordFilter).forEach(([key, value], index) => {
      fieldParser.parse(
        qb,
        outerQueryBuilder,
        objectMetadata.nameSingular,
        key,
        value,
        index === 0,
        isUpdateOrDeleteQuery,
      );
    });
  });

  if (queryBuilder.expressionMap.wheres.length === 0) {
    queryBuilder.where(whereCondition);
  } else {
    queryBuilder.andWhere(whereCondition);
  }
};
