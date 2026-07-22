import { FieldMetadataType, RelationType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';

import { type FlatEntityMaps } from 'src/engine/metadata-modules/flat-entity/types/flat-entity-maps.type';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import {
  APP_SCOPE_ACCESS_APP_FIELD_NAME,
  APP_SCOPE_ACCESS_MEMBER_FIELD_NAME,
  APP_SCOPE_ACCESS_OBJECT_NAME_SINGULAR,
  APP_SCOPE_APP_OBJECT_NAME_SINGULAR,
} from 'src/engine/core-modules/app-scope/constants/app-scope.constants';
import { type AppScopeConfig } from 'src/engine/core-modules/app-scope/types/app-scope-config.type';

type RelationSettings = {
  relationType?: RelationType;
  joinColumnName?: string;
};

const getRelationSettings = (
  field: FlatFieldMetadata,
): RelationSettings | undefined => field.settings as RelationSettings | undefined;

const isManyToOneRelationTo = (
  field: FlatFieldMetadata,
  targetObjectMetadataId: string,
): boolean =>
  field.type === FieldMetadataType.RELATION &&
  getRelationSettings(field)?.relationType === RelationType.MANY_TO_ONE &&
  field.relationTargetObjectMetadataId === targetObjectMetadataId;

export const resolveAppScopeConfig = ({
  flatObjectMetadataMaps,
  flatFieldMetadataMaps,
}: {
  flatObjectMetadataMaps: FlatEntityMaps<FlatObjectMetadata>;
  flatFieldMetadataMaps: FlatEntityMaps<FlatFieldMetadata>;
}): AppScopeConfig | null => {
  const objects = Object.values(
    flatObjectMetadataMaps.byUniversalIdentifier,
  ).filter(isDefined);

  const appObject = objects.find(
    (object) => object.nameSingular === APP_SCOPE_APP_OBJECT_NAME_SINGULAR,
  );

  if (!isDefined(appObject)) {
    return null;
  }

  const appAccessObject = objects.find(
    (object) => object.nameSingular === APP_SCOPE_ACCESS_OBJECT_NAME_SINGULAR,
  );

  const fields = Object.values(
    flatFieldMetadataMaps.byUniversalIdentifier,
  ).filter(isDefined);

  const scopedObjects: AppScopeConfig['scopedObjects'] = {};

  for (const field of fields) {
    if (!isManyToOneRelationTo(field, appObject.id)) {
      continue;
    }

    // The app object itself and the grant junction must never be app-scoped.
    if (
      field.objectMetadataId === appObject.id ||
      field.objectMetadataId === appAccessObject?.id
    ) {
      continue;
    }

    const joinColumnName = getRelationSettings(field)?.joinColumnName;

    if (
      isDefined(joinColumnName) &&
      !isDefined(scopedObjects[field.objectMetadataId])
    ) {
      scopedObjects[field.objectMetadataId] = {
        appRelationFieldName: field.name,
        appJoinColumnName: joinColumnName,
      };
    }
  }

  let appAccess: AppScopeConfig['appAccess'] = null;

  if (isDefined(appAccessObject)) {
    const accessFields = fields.filter(
      (field) => field.objectMetadataId === appAccessObject.id,
    );

    const appField = accessFields.find(
      (field) =>
        isManyToOneRelationTo(field, appObject.id) &&
        field.name === APP_SCOPE_ACCESS_APP_FIELD_NAME,
    );

    const memberField = accessFields.find(
      (field) =>
        field.type === FieldMetadataType.RELATION &&
        getRelationSettings(field)?.relationType === RelationType.MANY_TO_ONE &&
        field.name === APP_SCOPE_ACCESS_MEMBER_FIELD_NAME,
    );

    const appJoinColumnName = appField
      ? getRelationSettings(appField)?.joinColumnName
      : undefined;
    const memberJoinColumnName = memberField
      ? getRelationSettings(memberField)?.joinColumnName
      : undefined;

    if (isDefined(appJoinColumnName) && isDefined(memberJoinColumnName)) {
      appAccess = {
        objectMetadataId: appAccessObject.id,
        appJoinColumnName,
        memberJoinColumnName,
      };
    }
  }

  return {
    appObjectMetadataId: appObject.id,
    appObjectNameSingular: appObject.nameSingular,
    appAccess,
    scopedObjects,
  };
};
