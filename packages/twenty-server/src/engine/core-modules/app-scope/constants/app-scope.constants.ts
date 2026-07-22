// Convention-based names used to discover the app-scope model at runtime.
// The scoping dimension object must be named `app`; the grant junction `appAccess`
// with relation fields `member` (-> workspaceMember) and `app` (-> app).
export const APP_SCOPE_APP_OBJECT_NAME_SINGULAR = 'app';
export const APP_SCOPE_ACCESS_OBJECT_NAME_SINGULAR = 'appAccess';
export const APP_SCOPE_ACCESS_MEMBER_FIELD_NAME = 'member';
export const APP_SCOPE_ACCESS_APP_FIELD_NAME = 'app';

// Roles (by label) that bypass app-scope filtering entirely.
export const APP_SCOPE_BYPASS_ROLE_LABELS = ['Admin', 'Manager'];
